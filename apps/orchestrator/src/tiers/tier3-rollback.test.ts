import { describe, expect, spyOn, test } from "bun:test";
import { ActionApprovalDrawerSchema } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { approve } = await import("./tier3-remediate.ts");
const { rollbackRemediation } = await import("./tier3-rollback.ts");
const { buildInverseFromSnapshot, touchedSections } = await import("../local/inverse-rollback.ts");
const { captureEntitySnapshot, compareSnapshots } = await import("../local/snapshot.ts");
const { gatherContext, invalidateContext } = await import("../mcp/context.ts");
const { convergenceStore } = await import("../store/convergence.ts");
const { remediationStore } = await import("../store/remediations.ts");
const { closureStore } = await import("../store/closure.ts");
const { auditLedger } = await import("../store/audit.ts");
const { applyScenarioState } = await import("../local/lab.ts");

const LYNNE = "lynne.robins.contoso@c4a8shili.onmicrosoft.com";

function inc4092Drawer(remediationId: string) {
  return ActionApprovalDrawerSchema.parse({
    remediationId,
    ticketId: "INC-4092",
    tenantId: "tenant-contoso-01",
    title: "Fix INC-4092: E5 license upgrade, AVD block and NSG drift for Contoso Finance",
    summary: "Moves the drifted Finance users to SPE_E5, excludes SG-Contoso-Finance-AVD from the legacy block and removes the rogue RDP rule.",
    synthesizedBy: { planner: "deterministic", coder: "deterministic", provider: "local" },
    powershellScript: "[CmdletBinding(SupportsShouldProcess)]\nparam()\nif ($PSCmdlet.ShouldProcess('x')) { Remove-MgGroupMemberByRef; Invoke-MgLicenseUser; Update-MgIdentityConditionalAccessPolicy; Remove-AzNetworkSecurityRuleConfig }",
    terraformDiff: "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n",
    graphPatch: "[]",
    affectedEntities: [{ type: "upn", id: LYNNE, change: "SPE_E3 -> SPE_E5" }],
    verificationStatus: { verdict: "Verified Safe", astCheckPassed: true, terraformFmtPassed: true, terraformValidatePassed: true, sandboxProvider: "local-pwsh", validationLatencyMs: 120, findings: [], whatIfSafe: true },
    staging: null,
    approval: { state: "pending", requiredIdentity: "cloudadmin@c4a8shili.onmicrosoft.com", approvedBy: null, approvedAt: null },
    providerTelemetry: { tier: "Tier 3B", provider: "local", modelId: "deterministic", latencyMs: 10, tokensUsed: 0 },
  });
}

async function quietLedger<T>(run: () => Promise<T>): Promise<T> {
  const spy = spyOn(auditLedger, "append").mockImplementation(((input: unknown) => input) as never);
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}

describe("U-5: approve captures the pre-change snapshot, rollback derives f⁻¹ from it and reads the tenant back", () => {
  test("simulated mode, INC-4092: approve -> lab state moves -> rollback -> the read-back deep-equals the snapshot", async () => {
    await quietLedger(async () => {
      // Start from the drifted lab state (the in-process MCP services keep it in memory).
      await applyScenarioState("INC-4092", "drifted");
      invalidateContext("INC-4092");
      convergenceStore.clear("INC-4092", "tenant-contoso-01");
      closureStore.clear("INC-4092");
      const drawer = inc4092Drawer(`rem-test-u5-${Date.now().toString(36)}`);
      remediationStore.save(drawer);
      try {
        const approved = await approve({ remediationId: drawer.remediationId, decision: "approve", mode: "break-glass", openPullRequest: false });
        // Nothing live: the approval is simulated, but the snapshot was captured and the lab write ran against the in-process state.
        expect(approved.approval.state).toBe("simulated");
        expect(approved.convergence).not.toBeNull();
        expect(approved.convergence!.execution).toBe("simulated");
        expect(approved.convergence!.preSnapshotAt).toBeTruthy();
        expect(approved.convergence!.inverseExecutable).toBe(false);
        expect(approved.convergence!.inverseReason).toBe("nothing was written live");
        expect(approved.executionLog.some((l) => l.startsWith("Pre-change snapshot captured"))).toBe(true);
        expect(approved.executionLog.some((l) => /Graph write simulated \(LIVE_CLOUD_MODE=false\)/.test(l))).toBe(true);

        const pre = convergenceStore.snapshot("INC-4092");
        expect(pre).not.toBeNull();
        expect(pre!.users.map((u) => u.upn)).toContain(LYNNE);
        expect(pre!.users.find((u) => u.upn === LYNNE)!.currentSku).toBe("SPE_E3");
        const blockAvd = pre!.caPolicies.find((p) => p.displayName.includes("Block AVD"))!;
        expect(blockAvd.state).toBe("enabled");
        expect(blockAvd.excludeGroups).not.toContain("SG-Contoso-Finance-AVD");
        expect(pre!.nsg?.rules.some((r) => r.name === "Allow-Temp-RDP-Diagnostic-Drift")).toBe(true);

        // The lab write moved the in-process Conditional Access state: the probe sees the difference.
        invalidateContext("INC-4092");
        const mid = await captureEntitySnapshot(await gatherContext("INC-4092", { fresh: true }), pre!.users.map((u) => u.upn));
        const moved = compareSnapshots(pre!, mid);
        expect(moved.equal).toBe(false);
        expect(moved.differences.some((d) => d.path.includes("Block AVD") && d.path.endsWith(".state"))).toBe(true);

        // The inverse is derived from the snapshot and the executed bundle, not from the scenario id.
        const inverse = buildInverseFromSnapshot(pre!, drawer);
        expect(inverse.inverseSource).toBe("pre-snapshot");
        expect(inverse.sections).toEqual(expect.arrayContaining(["users", "conditional-access", "nsg"]));
        expect(inverse.powershellScript).toContain("Update-MgIdentityConditionalAccessPolicy");
        expect(inverse.powershellScript).toMatch(/includeGroups = .*excludeGroups = /s);
        expect(inverse.powershellScript).toContain(`Get-MgUser -UserId '${LYNNE}'`);
        expect(inverse.powershellScript).toContain("Invoke-MgLicenseUser -UserId $u.Id");
        expect(inverse.powershellScript).toContain("Allow-Temp-RDP-Diagnostic-Drift");
        expect(inverse.powershellScript).toContain("Set-AzNetworkSecurityGroup");
        expect(inverse.powershellScript).not.toMatch(/-ErrorAction SilentlyContinue/);
        const caPatch = inverse.graphRequests.find((r) => r.method === "PATCH" && r.url.includes("/identity/conditionalAccess/policies/"))!;
        const users = (caPatch.body as { conditions: { users: { includeGroups: string[]; excludeGroups: string[] } } }).conditions.users;
        expect(users.includeGroups.length).toBeGreaterThan(0);
        expect(Array.isArray(users.excludeGroups)).toBe(true);

        // Rollback: simulated inverse through the lab write path, canvas back to drifted, read-back equals the snapshot.
        const result = await rollbackRemediation("INC-4092");
        expect(result.executed).toBe(false);
        expect(result.execution).toBe("simulated");
        expect(result.inverseSource).toBe("pre-snapshot");
        expect(result.convergenceCleared).toBe(true);
        expect(result.reason).toContain("LIVE_CLOUD_MODE=false");
        expect(result.canary).not.toBeNull();
        expect(result.canary!.probeSource).toBe("simulated-read");
        expect(result.canary!.matchesPreSnapshot).toBe(true);
        expect(result.canary!.differences).toEqual([]);
        expect(result.executionLog.some((l) => l.startsWith("Inverse f⁻¹ derived from the pre-change snapshot"))).toBe(true);
        expect(result.executionLog.some((l) => /LIVE_CLOUD_MODE=false: inverse simulated/.test(l))).toBe(true);
        expect(result.executionLog.join("\n")).not.toMatch(/tenant restored|PREVIOUS STATE RESTORED/i);
        expect(convergenceStore.get("INC-4092")).toBeNull();
        expect(remediationStore.get(drawer.remediationId)?.approval.state).toBe("rolled-back");

        invalidateContext("INC-4092");
        const post = await captureEntitySnapshot(await gatherContext("INC-4092", { fresh: true }), pre!.users.map((u) => u.upn));
        const { capturedAt: _a, sources: _s, ...preState } = pre!;
        const { capturedAt: _b, sources: _t, ...postState } = post;
        expect(postState).toEqual(preState);
      } finally {
        remediationStore.clear("INC-4092");
        convergenceStore.clear("INC-4092", "tenant-contoso-01");
        closureStore.clear("INC-4092");
        await applyScenarioState("INC-4092", "drifted");
        invalidateContext("INC-4092");
      }
    });
  }, 30000);

  test("nothing approved: the static reference script is staged and nothing is claimed", async () => {
    await quietLedger(async () => {
      convergenceStore.clear("ANOM-CA-204", "tenant-contoso-01");
      const r = await rollbackRemediation("ANOM-CA-204");
      expect(r.executed).toBe(false);
      expect(r.execution).toBe("none");
      expect(r.inverseSource).toBe("static-reference");
      expect(r.reason).toContain("static reference");
      expect(r.canary).toBeNull();
      expect(r.convergenceCleared).toBe(false);
      expect(r.rollback.powershellScript).toContain("ShouldProcess");
    });
  });

  test("a staged Free-Roam action has nothing to revert and /api/rollback says so instead of throwing (HARD_CASES 29)", async () => {
    const { app } = await import("../app.ts");
    const res = await app.request("/api/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "FREE-1A2B3C4D" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { executed: boolean; execution: string; reason: string; rollback: { note?: string; restores: string[] } };
    expect(body.executed).toBe(false);
    expect(body.execution).toBe("none");
    expect(body.reason).toBe("staged action, nothing to revert");
    expect(body.rollback.restores).toEqual([]);
  });

  test("the workload-identity inverse removes fix-created FICs by their looked-up id and restores owners and app roles (H-19)", async () => {
    const ctx = await gatherContext("ANOM-APP-401", { fresh: true });
    const pre = await captureEntitySnapshot(ctx);
    expect(pre.workloadIdentity?.displayName).toBe("spn-contoso-erp-sync");
    const inverse = buildInverseFromSnapshot(pre, {
      powershellScript: "New-MgApplicationFederatedIdentityCredential -ApplicationId x; Remove-MgApplicationOwnerByRef; Remove-MgServicePrincipalAppRoleAssignment",
      graphPatch: "[]",
      terraformDiff: "",
      affectedEntities: [],
    });
    expect(touchedSections(pre, { powershellScript: "New-MgApplicationFederatedIdentityCredential", graphPatch: "", terraformDiff: "", affectedEntities: [] })).toEqual(["workload-identity"]);
    expect(inverse.sections).toEqual(["workload-identity"]);
    expect(inverse.powershellScript).toContain("Get-MgApplicationFederatedIdentityCredential -ApplicationId $app.Id | Where-Object { $_.Name -notin");
    expect(inverse.powershellScript).toContain("-FederatedIdentityCredentialId $fic.Id");
    expect(inverse.powershellScript).not.toMatch(/-FederatedIdentityCredentialId '[^$]/);
    expect(inverse.powershellScript).toContain("New-MgApplicationOwnerByRef");
    expect(inverse.powershellScript).toContain("New-MgServicePrincipalAppRoleAssignment");
    expect(inverse.restores[0]).toContain("spn-contoso-erp-sync");
  });
});
