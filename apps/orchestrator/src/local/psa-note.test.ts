import { describe, expect, test } from "bun:test";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("./brief.ts");
const { buildResolutionNote } = await import("./psa-note.ts");
const { runCanaryConvergence } = await import("./canary-convergence.ts");
const { closureStore } = await import("../store/closure.ts");
const { remediationStore } = await import("../store/remediations.ts");

describe("auto-drafted Customer & PSA Resolution Note", () => {
  test("after convergence the note carries the customer summary and the full technical audit trail", async () => {
    const ctx = await gatherContext("INC-4092", { fresh: true });
    const brief = buildScenarioBrief(ctx);
    const remediationId = "rem-test-psa-note";
    remediationStore.save({
      remediationId,
      ticketId: "INC-4092",
      tenantId: "tenant-contoso-01",
      title: "Fix INC-4092: E5 license upgrade, AVD block and NSG drift for Contoso Finance",
      summary: "Assigns SPE_E5 to 3 drifted members of SG-Contoso-Finance-AVD and removes the rogue RDP rule.",
      synthesizedBy: { planner: "deterministic", coder: "deterministic", provider: "local" },
      powershellScript: "[CmdletBinding(SupportsShouldProcess)] param() if ($PSCmdlet.ShouldProcess('x')) { Set-MgUserLicense }",
      terraformDiff: "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n",
      graphPatch: "[]",
      affectedEntities: [{ type: "upn", id: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", change: "SPE_E3 -> SPE_E5" }],
      verificationStatus: { verdict: "Verified Safe", astCheckPassed: true, terraformFmtPassed: true, terraformValidatePassed: true, sandboxProvider: "local-pwsh", validationLatencyMs: 120, findings: [], whatIfSafe: true },
      staging: { branchName: "fix/INC-4092-contoso-remediation", commitSha: "0123456789abcdef", filesChanged: ["demo-iac/remediations/INC-4092/Invoke-Remediate.ps1", "demo-iac/remediations/INC-4092/reconciled-state.json"], prTitle: "fix(INC-4092)", pushed: false, prUrl: null },
      approval: { state: "simulated", mode: "break-glass", requiredIdentity: "cloudadmin@c4a8shili.onmicrosoft.com", approvedBy: "cloudadmin@c4a8shili.onmicrosoft.com", approvedAt: "2026-10-27T10:00:00Z" },
      providerTelemetry: { tier: "Tier 3B", provider: "local", modelId: "deterministic", latencyMs: 10, tokensUsed: 0 },
    });
    const canary = runCanaryConvergence("INC-4092", { mode: "break-glass" });
    closureStore.setCanary("INC-4092", canary);
    const convergence = {
      scenarioId: "INC-4092",
      tenantId: "tenant-contoso-01",
      remediationId,
      ticketId: "INC-4092",
      convergedAt: "2026-10-27T10:00:05Z",
      latencyMs: 812,
      prUrl: null,
      gitBranch: "fix/INC-4092-contoso-remediation",
      execution: "simulated" as const,
      remediatedUpns: ["lynne.robins.contoso@c4a8shili.onmicrosoft.com", "alex.wilber.contoso@c4a8shili.onmicrosoft.com"],
      reclaimedUpns: [],
    };
    const note = buildResolutionNote({ brief, convergence });
    expect(note.status).toBe("RESOLVED & VERIFIED");
    expect(note.customerSummary).toContain("SPE_E5");
    expect(note.customerSummary).toContain("Emergency Break-Glass");
    expect(note.customerSummary).toContain("2 accounts");
    const trail = note.technicalAuditTrail.join("\n");
    expect(trail).toMatch(/Formal invariants: 3\/3 proved/);
    expect(trail).toContain("break-glass-non-lockout");
    expect(trail).toMatch(/Canary probes: APPLIED → CANARY_RING_0 → SYNTHETIC_PROBED → CONVERGED/);
    expect(trail).toContain("identity probe passed");
    expect(trail).toContain("fix/INC-4092-contoso-remediation @ 0123456");
    expect(trail).toMatch(/Inverse rollback f⁻¹ archived: \d+ restore/);
    expect(trail).toContain("Pre-flight: Verified Safe");
    expect(note.markdown).toContain("# INC-4092");
    expect(note.markdown).toContain("## Technical audit trail");
    expect(note.closed).toBeNull();

    closureStore.close("INC-4092", "cloudadmin@c4a8shili.onmicrosoft.com");
    const closedNote = buildResolutionNote({ brief, convergence });
    expect(closedNote.status).toBe("CLOSED");
    expect(closedNote.markdown).toContain("CLOSED · closed");
    closureStore.clear("INC-4092");
  });
});
