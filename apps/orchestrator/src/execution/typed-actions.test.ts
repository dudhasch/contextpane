import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { TypedActionSchema, typedActionFromSelection } = await import("@contextpane/catalog");
const { getMcpDataMode, setMcpDataMode } = await import("@contextpane/mcp-azure-iac");
const { msgraphService } = await import("@contextpane/mcp-msgraph");
const { config } = await import("../config.ts");
const { ABAC_CONTAINER_QID, ABAC_STRATEGY, ABAC_STRATEGY_QID } = await import("../local/abac.ts");
const { executeTypedAction, invertTypedAction, typedActionGate, validateTypedAction } = await import("./typed-actions.ts");
const { actionCandidates, clarifierTypedAction, selectTypedAction } = await import("./select-action.ts");
type Ctx = Parameters<typeof clarifierTypedAction>[0];

const bootMode = getMcpDataMode();
const bootAllowExecute = config.allowExecute;
const mutableConfig = config as { allowExecute: boolean };
afterEach(() => {
  setMcpDataMode(bootMode);
  mutableConfig.allowExecute = bootAllowExecute;
});
afterAll(() => setMcpDataMode(bootMode));

const DRIFTED = "lynne.robins.contoso@c4a8shili.onmicrosoft.com";

function customCtx(title: string, body: string, answers: Record<string, string> = {}, extra: Partial<Ctx> = {}): Ctx {
  return {
    tenantId: "tenant-contoso-01",
    custom: { ticket: { title, body }, clarifiedAnswers: answers },
    license: { data: { users: [{ upn: DRIFTED, driftStatus: "drifted" }, { upn: "alex.wilber.contoso@c4a8shili.onmicrosoft.com", driftStatus: "compliant" }] } },
    drift: null,
    ...extra,
  } as unknown as Ctx;
}

describe("typed action catalog", () => {
  test("the schemas accept the three actions and refuse malformed parameters", () => {
    expect(TypedActionSchema.safeParse({ kind: "abac-conditioned-role-grant", params: { container: "payroll-drop" } }).success).toBe(true);
    expect(TypedActionSchema.safeParse({ kind: "abac-conditioned-role-grant", params: { container: "Payroll Drop'; Remove-AzResourceGroup" } }).success).toBe(false);
    expect(TypedActionSchema.safeParse({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: ["not-a-upn"] } }).success).toBe(false);
    expect(TypedActionSchema.safeParse({ kind: "nsg-baseline-restore", params: { tenantId: "tenant-contoso-01" } }).success).toBe(true);
    expect(TypedActionSchema.safeParse({ kind: "run-powershell", params: {} }).success).toBe(false);
  });

  test("a model selection becomes an action only when it parses as one; 'none' is no action", () => {
    expect(typedActionFromSelection({ kind: "none", params: {}, rationale: "" }).action).toBeNull();
    const bad = typedActionFromSelection({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01" }, rationale: "" });
    expect(bad.action).toBeNull();
    expect(bad.issues.length).toBeGreaterThan(0);
  });

  test("validators only accept entities the context knows", () => {
    expect(validateTypedAction({ kind: "abac-conditioned-role-grant", params: { container: "finance-exports" } }, null)).toHaveLength(1);
    expect(validateTypedAction({ kind: "abac-conditioned-role-grant", params: { container: "payroll-drop" } }, null)).toHaveLength(0);
    const ctx = customCtx("Licence drift", "Lynne cannot open AVD");
    expect(validateTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: [DRIFTED] } }, ctx)).toHaveLength(0);
    expect(validateTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: ["attacker@evil.example"] } }, ctx)[0]).toContain("not a user");
    expect(validateTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-fabrikam-02", upns: [DRIFTED] } }, ctx)[0]).toContain("not the ticket's tenant");
    expect(validateTypedAction({ kind: "nsg-baseline-restore", params: { tenantId: "tenant-contoso-01" } }, ctx)[0]).toContain("no NSG drift");
  });

  test("outside LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE nothing is written and the action stays staged", async () => {
    const spy = spyOn(msgraphService, "setLicenseExtensionState");
    try {
      setMcpDataMode("simulated-lab");
      mutableConfig.allowExecute = true;
      expect(typedActionGate()).toBe("Simulated-Lab mode");
      const res = await executeTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: [DRIFTED] } }, { ticketId: "CUSTOM-T", approvedBy: "admin@lab" });
      expect(res.source).toBe("simulated");
      expect(res.fallbackReason).toBe("Simulated-Lab mode");
      setMcpDataMode("real-tenant");
      mutableConfig.allowExecute = false;
      const inverse = await invertTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: [DRIFTED] } });
      expect(inverse.fallbackReason).toBe("CTX_ALLOW_EXECUTE=false");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("a rejected action never reaches the service, even when execution is enabled", async () => {
    const spy = spyOn(msgraphService, "setLicenseExtensionState");
    try {
      setMcpDataMode("real-tenant");
      mutableConfig.allowExecute = true;
      const res = await executeTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: ["attacker@evil.example"] } }, { ticketId: "CUSTOM-T", approvedBy: "admin@lab" }, customCtx("t", "b"));
      expect(res.ok).toBe(false);
      expect(res.log[0]).toContain("rejected");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("with execution enabled the typed write goes through the lab service with the validated parameters", async () => {
    const spy = spyOn(msgraphService, "setLicenseExtensionState").mockResolvedValue({ source: "live-graph", latencyMs: 12, results: [{ upn: DRIFTED, ok: true, status: 204 }] } as never);
    try {
      setMcpDataMode("real-tenant");
      mutableConfig.allowExecute = true;
      const res = await executeTypedAction({ kind: "license-extension-remediate", params: { tenantId: "tenant-contoso-01", upns: [DRIFTED] } }, { ticketId: "CUSTOM-T", approvedBy: "admin@lab" }, customCtx("t", "b"));
      expect(res.ok).toBe(true);
      expect(res.source).toBe("live");
      expect(spy).toHaveBeenCalledWith("tenant-contoso-01", [DRIFTED], "remediated");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("typed action selection", () => {
  const abacTitle = "Deployment fails on some ABAC policy";
  const abacBody = "Our payroll function cannot write to blob storage, the deployment says RequestDisallowedByPolicy.";

  test("an ABAC ticket steered to a container condition gets the catalog grant from the clarifier answers", async () => {
    const ctx = customCtx(abacTitle, abacBody, { [ABAC_STRATEGY_QID]: ABAC_STRATEGY.condition, [ABAC_CONTAINER_QID]: "payroll-drop container" });
    expect(clarifierTypedAction(ctx)).toEqual({ kind: "abac-conditioned-role-grant", params: { container: "payroll-drop" } });
    const choice = await selectTypedAction(ctx);
    expect(choice.source).toBe("clarifier");
  });

  test("an ABAC exemption or an all-container grant has no typed executor", async () => {
    expect(clarifierTypedAction(customCtx(abacTitle, abacBody, { [ABAC_STRATEGY_QID]: ABAC_STRATEGY.exemption }))).toBeNull();
    const choice = await selectTypedAction(customCtx(abacTitle, abacBody, { [ABAC_STRATEGY_QID]: ABAC_STRATEGY.condition }));
    expect(choice.action).toBeNull();
  });

  test("candidates only offer drifted users and the NSG when drift was gathered", () => {
    const ctx = customCtx("Licence drift", "Lynne cannot open AVD", {}, { drift: { data: {} } } as Partial<Ctx>);
    const candidates = actionCandidates(ctx);
    expect(candidates.map((c) => c.kind)).toEqual(["license-extension-remediate", "nsg-baseline-restore"]);
    expect(candidates[0]!.allowedValues.upns).toEqual([DRIFTED]);
  });

  test("without a model a non-ABAC ticket carries no typed action (approve falls back to the staged script)", async () => {
    const choice = await selectTypedAction(customCtx("Licence drift", "Lynne cannot open AVD"));
    expect(choice.action).toBeNull();
    expect(choice.source).toBe("none");
  });
});
