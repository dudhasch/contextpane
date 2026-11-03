import { describe, expect, spyOn, test } from "bun:test";
import type { SteeringParams } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const openai = await import("../router/openai.ts");
const { steeredRequiredCommands, synthesizeCustomRemediation, buildCustomTicketRemediationSync } = await import("./subagent-orchestrator.ts");

const KV = { ticketTitle: "Can't recreate my Key Vault kv-contoso-fin-02", ticketBody: "The vault kv-contoso-fin-02 was deleted last week and is soft-deleted; recreating it fails." };

function steering(strategy: "recover" | "purge-recreate" | "in-place"): SteeringParams {
  const setAt = "2026-11-03T00:00:00.000Z";
  return { version: 1, digest: "test", updatedAt: setAt, remediationStrategy: { value: strategy, source: "operator", setAt }, answers: {} };
}

describe("requiredCommands come from the steering, never from the coder (review item 3)", () => {
  test("a Key Vault ticket gets its strategy's cmdlets; an unsteered or other ticket gets none", () => {
    expect(steeredRequiredCommands({ ...KV, steering: steering("recover") })).toEqual(["get-azkeyvault", "undo-azkeyvaultremoval"]);
    expect(steeredRequiredCommands({ ...KV, steering: steering("purge-recreate") })).toEqual(["get-azkeyvault", "remove-azkeyvault", "new-azkeyvault"]);
    expect(steeredRequiredCommands({ ...KV, steering: steering("in-place") })).toEqual([]);
    expect(steeredRequiredCommands({ ticketTitle: "Teams calls drop", ticketBody: "Calls drop after 10 minutes." })).toEqual([]);
    // A vault that exists: an access-policy ticket steered "recover or update in place" binds no recovery cmdlet.
    const live = { ticketTitle: "Grant the finance analyst read access to secrets in kv-contoso-fin-02", ticketBody: "Lynne Robins needs get/list on secrets in Key Vault kv-contoso-fin-02 after the vault was recreated; the old access policy is gone." };
    expect(steeredRequiredCommands({ ...live, steering: steering("recover") })).toEqual([]);
  });

  test("the deterministic template carries the same contract", () => {
    expect(buildCustomTicketRemediationSync({ scenarioId: "CUSTOM-T1", ...KV, steering: steering("recover") }).requiredCommands).toEqual(["get-azkeyvault", "undo-azkeyvaultremoval"]);
  });

  test("a coder answer that names its own requiredCommands is ignored", async () => {
    const enabledSpy = spyOn(openai, "metaCallsEnabled").mockReturnValue(true);
    const chatSpy = spyOn(openai, "chatWithForcedTool").mockResolvedValue({
      toolName: "emit_custom_remediation_template",
      argumentsRaw: JSON.stringify({
        title: "Recover kv-contoso-fin-02",
        summary: "Recovers the vault.",
        powershellScript: "#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam()\nGet-AzKeyVault -VaultName kv-contoso-fin-02 -InRemovedState\n",
        terraformDiff: "",
        rollbackScript: "",
        // The coder declares a contract its script trivially meets: that must not become the test.
        requiredCommands: ["get-azkeyvault"],
        executionSteps: ["[Step 1/1] Read the vault"],
      }),
      usage: { prompt: 10, completion: 10, total: 20 },
      latencyMs: 5,
      finishReason: "tool_calls",
    });
    try {
      const res = await synthesizeCustomRemediation({ scenarioId: "CUSTOM-T2", ...KV, steering: steering("recover") });
      expect(res._meta?.source).toBe("llm");
      expect(res.requiredCommands).toEqual(["get-azkeyvault", "undo-azkeyvaultremoval"]);
    } finally {
      chatSpy.mockRestore();
      enabledSpy.mockRestore();
    }
  });
});
