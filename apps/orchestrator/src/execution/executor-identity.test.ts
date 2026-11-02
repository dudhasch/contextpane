import { describe, expect, test } from "bun:test";
import { EXECUTOR_REFUSAL, executorPrelude, executorRefusal, resolveExecutorIdentity, type ExecutorSettings } from "./executor-identity.ts";

const NONE: ExecutorSettings = { clientId: "", tenantId: "", certificateThumbprint: "", managedIdentity: false, allowDelegated: false };
const SP: ExecutorSettings = { ...NONE, clientId: "11111111-2222-3333-4444-555555555555", tenantId: "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea", certificateThumbprint: "A".repeat(40) };
const LAB = { subscriptionId: "20505597-043c-4742-a884-42dc3f621aef", tenantId: "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea" };

describe("executor identity", () => {
  test("with nothing configured free-form execution is refused", () => {
    const identity = resolveExecutorIdentity(NONE);
    expect(identity.mode).toBe("none");
    expect(executorRefusal(identity)).toBe(EXECUTOR_REFUSAL);
  });

  test("a service principal connects for the process and checks it is the connected account", () => {
    const identity = resolveExecutorIdentity(SP);
    expect(identity.mode).toBe("service-principal");
    expect(executorRefusal(identity)).toBeNull();
    const prelude = executorPrelude(identity, LAB, SP);
    expect(prelude).toContain(`Connect-AzAccount -ServicePrincipal -ApplicationId '${SP.clientId}'`);
    expect(prelude).toContain("Disable-AzContextAutosave -Scope Process");
    expect(prelude).toContain(`(Get-AzContext).Account.Id -ne '${SP.clientId}'`);
    expect(prelude).toContain("'AppOnly'");
    expect(prelude).toContain(`Subscription.Id -ne '${LAB.subscriptionId}'`);
    expect(prelude).not.toContain("Get-AzContext -ListAvailable");
  });

  test("malformed service-principal values are refused before they reach a script", () => {
    const identity = resolveExecutorIdentity({ ...SP, clientId: "x'; Remove-AzResourceGroup -Name rg -Force; '" });
    expect(identity.mode).toBe("none");
    expect(executorRefusal(identity)).toContain("CTX_EXECUTOR_CLIENT_ID is not a GUID");
  });

  test("a managed identity connects with -Identity", () => {
    const identity = resolveExecutorIdentity({ ...NONE, managedIdentity: true });
    expect(identity.mode).toBe("managed-identity");
    expect(executorPrelude(identity, LAB, { ...NONE, managedIdentity: true })).toContain("Connect-AzAccount -Identity");
  });

  test("the delegated sign-in is only used behind the explicit legacy flag", () => {
    const identity = resolveExecutorIdentity({ ...NONE, allowDelegated: true });
    expect(identity.mode).toBe("delegated");
    expect(executorPrelude(identity, LAB, NONE)).toContain("Get-AzContext -ListAvailable");
  });
});
