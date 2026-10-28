import { describe, expect, spyOn, test } from "bun:test";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const openai = await import("../router/openai.ts");
const modal = await import("../preflight/modal.ts");
const staging = await import("../preflight/staging.ts");
const { registerCustomTicket, clearCustomTickets, getCustomScenario } = await import("../local/custom-ticket.ts");
const { remediationStore } = await import("../store/remediations.ts");
const { auditLedger } = await import("../store/audit.ts");
const { remediate } = await import("./tier3-remediate.ts");
const { repairableFindings, MAX_REPAIR_ITERATIONS } = await import("./repair-loop.ts");

const TICKET = {
  title: "Grant the finance analyst read access to secrets in kv-contoso-fin-02",
  body: "Lynne Robins needs get/list on secrets in Key Vault kv-contoso-fin-02 after the vault was recreated; the old access policy is gone.",
  customerName: "Contoso Finance",
};

/** Deliberately unguarded: no param() block, no SupportsShouldProcess, a bare mutating cmdlet (what L-08's Auto-Fix used to paper over). */
const UNGUARDED = ["Get-AzKeyVault -VaultName 'kv-contoso-fin-02' | Out-Null", "Set-AzKeyVaultAccessPolicy -VaultName 'kv-contoso-fin-02' -UserPrincipalName 'lynne.robins.contoso@c4a8shili.onmicrosoft.com' -PermissionsToSecrets get,list"].join("\n");
/** Turn 1: the coder adds the attribute and param() but leaves the mutation outside ShouldProcess (still not -WhatIf safe). */
const HALF_REPAIRED = [
  "#Requires -Version 7.0",
  "[CmdletBinding(SupportsShouldProcess = $true)]",
  "param([string]$VaultName = 'kv-contoso-fin-02')",
  "$ErrorActionPreference = 'Stop'",
  "Get-AzKeyVault -VaultName $VaultName | Out-Null",
  "Set-AzKeyVaultAccessPolicy -VaultName $VaultName -UserPrincipalName 'lynne.robins.contoso@c4a8shili.onmicrosoft.com' -PermissionsToSecrets get,list",
  "",
].join("\n");
/** Turn 2: every mutation inside the guard. */
const GUARDED = [
  "#Requires -Version 7.0",
  "[CmdletBinding(SupportsShouldProcess = $true)]",
  "param([string]$VaultName = 'kv-contoso-fin-02')",
  "$ErrorActionPreference = 'Stop'",
  "Get-AzKeyVault -VaultName $VaultName | Out-Null",
  "if ($PSCmdlet.ShouldProcess($VaultName, 'Grant get,list on secrets')) {",
  "  Set-AzKeyVaultAccessPolicy -VaultName $VaultName -UserPrincipalName 'lynne.robins.contoso@c4a8shili.onmicrosoft.com' -PermissionsToSecrets get,list",
  "}",
  "",
].join("\n");
/** Never repairable: a forbidden command the allow-list hard-fails on. */
const FORBIDDEN = ["[CmdletBinding(SupportsShouldProcess = $true)]", "param([string]$VaultName = 'kv-contoso-fin-02')", "if ($PSCmdlet.ShouldProcess($VaultName, 'x')) { Invoke-Expression 'Get-AzKeyVault' }", ""].join("\n");

function coderAnswer(script: string) {
  return {
    toolName: "emit_custom_remediation_template",
    argumentsRaw: JSON.stringify({
      title: "Grant secret access on kv-contoso-fin-02",
      summary: "Adds a get/list access policy for the analyst.",
      powershellScript: script,
      terraformDiff: "",
      graphPatch: "{}",
      rollbackScript: "Remove-AzKeyVaultAccessPolicy -VaultName kv-contoso-fin-02 -UserPrincipalName lynne.robins.contoso@c4a8shili.onmicrosoft.com",
      affectedEntities: [{ type: "resource", id: "kv-contoso-fin-02", change: "access policy: +get,list secrets" }],
      requiredCommands: ["get-azkeyvault", "set-azkeyvaultaccesspolicy"],
      executionSteps: ["[Step 1/2] Read the vault", "[Step 2/2] Set the access policy"],
    }),
    usage: { prompt: 900, completion: 150, total: 1050 },
    latencyMs: 30,
    finishReason: "tool_calls",
  };
}

/** No git worktree, no Modal, no audit file from the tests (HARD_CASES 11); the coder is the only thing mocked. */
async function withLoopFixture<T>(scripts: string[], run: (seen: Array<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const auditSpy = spyOn(auditLedger, "append").mockImplementation(((input: unknown) => input) as never);
  const modalSpy = spyOn(modal, "modalConfigured").mockReturnValue(false);
  const stageSpy = spyOn(staging, "stageRemediationBranch").mockRejectedValue(new Error("git staging disabled in tests"));
  const enabledSpy = spyOn(openai, "metaCallsEnabled").mockReturnValue(true);
  const seen: Array<Record<string, unknown>> = [];
  let turn = 0;
  const chatSpy = spyOn(openai, "chatWithForcedTool").mockImplementation((async (_provider: unknown, _model: string, messages: Array<{ role: string; content: string }>) => {
    seen.push(JSON.parse(messages.find((m) => m.role === "user")!.content) as Record<string, unknown>);
    const script = scripts[Math.min(turn, scripts.length - 1)]!;
    turn += 1;
    return coderAnswer(script);
  }) as never);
  try {
    return await run(seen);
  } finally {
    chatSpy.mockRestore();
    enabledSpy.mockRestore();
    stageSpy.mockRestore();
    modalSpy.mockRestore();
    auditSpy.mockRestore();
  }
}

function stageUnguarded(script: string, title = TICKET.title) {
  const entry = registerCustomTicket({ ...TICKET, title });
  // The entry's script is what remediate() bundles for a custom ticket; make it the unguarded one.
  entry.customRemediation = {
    title: "Grant secret access on kv-contoso-fin-02",
    summary: "Adds a get/list access policy for the analyst.",
    powershellScript: script,
    terraformDiff: "",
    graphPatch: "{}",
    rollbackScript: "",
    affectedEntities: [{ type: "resource", id: "kv-contoso-fin-02", change: "access policy: +get,list secrets" }],
    requiredCommands: ["get-azkeyvault"],
    executionSteps: ["[Step 1/2] Read the vault", "[Step 2/2] Set the access policy"],
  };
  return entry;
}

describe("write-then-test: sandbox findings feed a Wonder repair turn before the drawer opens (U-2)", () => {
  test("repairableFindings skips infrastructure findings and anything on a Verified Safe verdict", () => {
    expect(repairableFindings({ verdict: "Verified Safe", findings: ["x"] })).toEqual([]);
    expect(repairableFindings({ verdict: "Verified With Warnings", findings: ["Modal sandbox unavailable; validated locally instead", "Git staging skipped: no origin", "-WhatIf is not a full dry run: Set-AzKeyVaultAccessPolicy outside $PSCmdlet.ShouldProcess"] })).toEqual([
      "-WhatIf is not a full dry run: Set-AzKeyVaultAccessPolicy outside $PSCmdlet.ShouldProcess",
    ]);
    expect(MAX_REPAIR_ITERATIONS).toBe(2);
  });

  test("an unguarded script is repaired server-side in two turns and the drawer opens Verified Safe with iterations: 2", async () => {
    const entry = stageUnguarded(UNGUARDED);
    try {
      const { drawer } = await withLoopFixture([HALF_REPAIRED, GUARDED], async (seen) => {
        const result = await remediate({ scenarioId: entry.scenarioId, fresh: true });
        // Two repair turns, each fed the sandbox findings and the rejected script as diff base.
        expect(seen).toHaveLength(2);
        expect(seen[0]!.repairFindings as string[]).toEqual(expect.arrayContaining([expect.stringMatching(/SupportsShouldProcess/)]));
        expect(String(seen[0]!.previousScript)).toBe(UNGUARDED);
        expect(seen[1]!.repairFindings as string[]).toEqual(expect.arrayContaining([expect.stringMatching(/-WhatIf is not a full dry run/)]));
        expect(String(seen[1]!.previousScript)).toBe(HALF_REPAIRED);
        return result;
      });
      const v = drawer.verificationStatus;
      expect(v.verdict).toBe("Verified Safe");
      expect(v.whatIfSafe).toBe(true);
      expect(v.astCheckPassed).toBe(true);
      expect(drawer.powershellScript).toBe(GUARDED);
      expect(v.repair).toBeDefined();
      expect(v.repair!.iterations).toBe(2);
      expect(v.repair!.exhausted).toBe(false);
      expect(v.repair!.rounds.map((r) => [r.verdictBefore, r.verdictAfter])).toEqual([
        ["Verified With Warnings", "Verified With Warnings"],
        ["Verified With Warnings", "Verified Safe"],
      ]);
      expect(v.repair!.rounds.every((r) => r.tokensUsed === 1050 && r.tokensPrompt === 900 && r.scriptChanged)).toBe(true);
      expect(v.precheck?.name).toBe("syntax-heuristic");
      // The drawer's telemetry and the ticket's pipeline records carry the loop's tokens and iterations.
      expect(drawer.providerTelemetry.tokensUsed).toBe(2100);
      expect(drawer.synthesizedBy.provider).toBe("meta");
      const tasks = getCustomScenario(entry.scenarioId)?.subAgentTasks ?? [];
      const s4 = tasks.find((t) => t.stepIndex === 4)!;
      const s5 = tasks.find((t) => t.stepIndex === 5)!;
      expect(s4.iterations).toBe(2);
      expect(s4.tokensUsed).toBe(2100);
      expect(s4.outputSummary).toContain("2 repair iterations");
      expect(s5.source).toBe("sandbox-preflight");
      expect(s5.modelId).toBe("local-pwsh");
      expect(s5.outputSummary).toContain("Verified Safe");
      // The drawer is staged, never auto-approved.
      expect(drawer.approval.state).toBe("pending");
    } finally {
      remediationStore.clear(entry.scenarioId);
      clearCustomTickets("unscripted");
    }
  }, 60000);

  test("when the budget is exhausted the verdict stays Verification Failed with its findings; nothing is forced", async () => {
    const entry = stageUnguarded(FORBIDDEN, "Exhausted budget sample: forbidden command in the vault script");
    try {
      const { drawer } = await withLoopFixture([FORBIDDEN.replace("'x'", "'retry 1'"), FORBIDDEN.replace("'x'", "'retry 2'"), FORBIDDEN.replace("'x'", "'retry 3'")], async (seen) => {
        const result = await remediate({ scenarioId: entry.scenarioId, fresh: true });
        expect(seen).toHaveLength(2);
        return result;
      });
      const v = drawer.verificationStatus;
      expect(v.verdict).toBe("Verification Failed");
      expect(v.astCheckPassed).toBe(false);
      expect(v.findings.some((f) => /Forbidden command: invoke-expression/i.test(f))).toBe(true);
      expect(v.repair!.iterations).toBe(2);
      expect(v.repair!.exhausted).toBe(true);
      expect(v.repair!.rounds.every((r) => r.verdictAfter === "Verification Failed")).toBe(true);
      expect(drawer.approval.state).toBe("pending");
    } finally {
      remediationStore.clear(entry.scenarioId);
      clearCustomTickets("unscripted");
    }
  }, 60000);

  test("offline: no repair turn runs, the loop records why, and the sandbox verdict stands as it is", async () => {
    const entry = stageUnguarded(UNGUARDED, "Offline loop sample: unguarded vault script");
    const auditSpy = spyOn(auditLedger, "append").mockImplementation(((input: unknown) => input) as never);
    const modalSpy = spyOn(modal, "modalConfigured").mockReturnValue(false);
    const stageSpy = spyOn(staging, "stageRemediationBranch").mockRejectedValue(new Error("git staging disabled in tests"));
    try {
      const { drawer } = await remediate({ scenarioId: entry.scenarioId, fresh: true });
      expect(drawer.verificationStatus.verdict).toBe("Verified With Warnings");
      expect(drawer.verificationStatus.repair).toMatchObject({ iterations: 0, exhausted: false, skipped: expect.stringContaining("coder offline") });
      expect(drawer.powershellScript).toBe(UNGUARDED);
    } finally {
      stageSpy.mockRestore();
      modalSpy.mockRestore();
      auditSpy.mockRestore();
      remediationStore.clear(entry.scenarioId);
      clearCustomTickets("unscripted");
    }
  }, 30000);
});
