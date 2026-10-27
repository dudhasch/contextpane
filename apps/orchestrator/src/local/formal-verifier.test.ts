import { describe, expect, test } from "bun:test";
import { isScenarioId, type ScenarioId } from "@contextpane/catalog";
import {
  baselineNsgRules,
  blastRadiusMatrix,
  buildInverseRollback,
  counterfactualReplay,
  postState,
  rogueRdpRule,
  synthesizeInverseRollback,
  verifyFormalInvariants,
  verifyIdempotency,
  verifyInverseRollback,
  verifyProactiveRemediationInvariant,
  verifyShadowAdminInvariant,
} from "./formal-verifier.ts";

describe("Tier 3C formal blast-radius prover", () => {
  test("break-glass non-lockout passes for INC-4092 P_post", () => {
    const r = verifyFormalInvariants("INC-4092");
    expect(r.passed).toBe(true);
    expect(r.invariants.find((i) => i.id === "break-glass-non-lockout")?.passed).toBe(true);
  });

  test("break-glass fails with counterexample when P_post lacks exclusion", () => {
    const broken = postState("ANOM-CA-204").policies.map((p) => (p.id === "CA-001" ? { ...p, excludeGroups: [] } : p));
    const r = verifyFormalInvariants("ANOM-CA-204", { postPolicies: broken });
    expect(r.passed).toBe(false);
    const cx = r.counterexamples.find((c) => c.invariant === "break-glass-non-lockout");
    expect(cx).toBeDefined();
    expect(cx!.entity).toContain("bg-admin-01");
    expect(cx!.detail).toContain("SG-BreakGlass-Accounts");
  });

  test("target remediation Block/Drift -> Allow/Compliant for INC-4092", () => {
    const r = verifyFormalInvariants("INC-4092");
    const inv = r.invariants.find((i) => i.id === "target-remediation")!;
    expect(inv.passed).toBe(true);
    expect(inv.checked).toBe(3);
    expect(inv.evidence.join(" ")).toContain("Blocked->Allow");
  });

  test("NSG reachability passes on baseline and fails on rogue RDP override", () => {
    expect(verifyFormalInvariants("INC-4092").invariants.find((i) => i.id === "nsg-reachability")?.passed).toBe(true);
    const broken = verifyFormalInvariants("INC-4092", { postNsgRules: [...baselineNsgRules(), rogueRdpRule()] });
    expect(broken.passed).toBe(false);
    expect(broken.counterexamples.some((c) => c.invariant === "nsg-reachability" && c.context.includes("3389"))).toBe(true);
  });

  test("f^-1 synthesis + idempotency on copy-on-write fork", () => {
    const bundle = buildInverseRollback("INC-4092");
    expect(synthesizeInverseRollback).toBe(buildInverseRollback);
    expect(bundle).toEqual(synthesizeInverseRollback("INC-4092"));
    expect(bundle.powershellScript).toContain("ShouldProcess");
    expect(bundle.hcl + bundle.terraformDiff).toContain("Allow-Temp-RDP-Diagnostic-Drift");
    expect(JSON.parse(bundle.graphPatch).scenarioId).toBe("INC-4092");
    expect(verifyInverseRollback("INC-4092").passed).toBe(true);
    const idem = verifyIdempotency("INC-4092");
    expect(idem.passed).toBe(true);
    expect(idem.idempotent).toBe(true);
    expect(idem.forkIsolated).toBe(true);
    expect(idem.firstHash).toBe(idem.secondHash);
  });

  test("blast-radius matrix counts for INC-4092 (30-day replay)", () => {
    const m = counterfactualReplay("INC-4092");
    expect(m).toEqual(blastRadiusMatrix("INC-4092"));
    expect(m.days).toBe(30);
    expect(m.rows.find((r) => r.cohort === "target")).toMatchObject({ before: "Blocked", after: "Allowed", changedAttempts: 90 });
    expect(m.rows.find((r) => r.cohort === "break-glass")).toMatchObject({ before: "Allowed", after: "Allowed", changedAttempts: 0 });
    expect(m.collateralChanges).toBe(0);
    expect(m.targetBlockedToAllowed).toBe(90);
  });

  test("all scenarios pass and prover is <100ms", () => {
    const started = performance.now();
    for (const id of ["INC-4092", "INC-4099", "ANOM-LIC-101", "ANOM-CA-204", "ANOM-INT-309"] as const) {
      expect(verifyFormalInvariants(id).passed).toBe(true);
    }
    expect(performance.now() - started).toBeLessThan(100);
  });

  test("other scenarios keep exactly 3 invariants (no shadow-admin leak)", () => {
    for (const id of ["INC-4092", "INC-4099", "ANOM-LIC-101", "ANOM-CA-204", "ANOM-INT-309"] as const) {
      const r = verifyFormalInvariants(id);
      expect(r.invariants).toHaveLength(3);
      expect(r.invariants.some((i) => i.id === "shadow-admin-zero-transitive")).toBe(false);
    }
  });

  test("shadow-admin invariant: statement, pass on P_post, pre paths in evidence", () => {
    const inv = verifyShadowAdminInvariant("ANOM-APP-401");
    expect(inv.id).toBe("shadow-admin-zero-transitive");
    expect(inv.statement).toBe("TransitiveTier0ShadowAdmins(P_post)==EMPTY");
    expect(inv.passed).toBe(true);
    expect(inv.counterexamples).toEqual([]);
    expect(inv.evidence.join(" ")).toContain("alex.wilber");
    expect(inv.evidence.join(" ")).toContain("OWNS_APP");
    expect(verifyShadowAdminInvariant("NOPE-000").passed).toBe(false);
  });

  test("ANOM-APP-401 gets 4 invariants and passes (when catalog id available)", () => {
    // ANOM-APP-401 is added to the catalog concurrently; cast via string.
    const id = "ANOM-APP-401" as ScenarioId;
    const r = verifyFormalInvariants(id);
    expect(r.invariants).toHaveLength(4);
    expect(r.invariants.map((i) => i.id)).toContain("shadow-admin-zero-transitive");
    expect(r.passed).toBe(true);
    if (isScenarioId("ANOM-APP-401")) {
      expect(r.scenarioId).toBe("ANOM-APP-401");
    }
  });

  test("proactive-remediation detect verifier: read-only pass, mutating fail", () => {
    const good = [
      "try { $v = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Contoso' -Name Flag -ErrorAction Stop } catch { exit 1 }",
      "if ($v.Flag -eq 1) { Write-Output 'Compliant'; exit 0 } else { Write-Output 'NonCompliant'; exit 1 }",
    ].join("\n");
    const ok = verifyProactiveRemediationInvariant(good);
    expect(ok.passed).toBe(true);
    expect(ok.detectReadOnly).toBe(true);
    expect(ok.hasExitContract).toBe(true);
    expect(ok.outputWithinLimit).toBe(true);

    const mutating = verifyProactiveRemediationInvariant("Set-MgUser -UserId x -AccountEnabled $false\nexit 0\nexit 1");
    expect(mutating.passed).toBe(false);
    expect(mutating.detectReadOnly).toBe(false);
    expect(mutating.counterexamples.some((c) => c.context === "mutating-cmdlet")).toBe(true);

    const rest = verifyProactiveRemediationInvariant("Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/users' -Method Post -Body '{}'\nexit 0\nexit 1");
    expect(rest.passed).toBe(false);
    expect(rest.counterexamples.some((c) => c.context === "mutating-rest-call")).toBe(true);

    const noExit = verifyProactiveRemediationInvariant("Get-Process | Out-Null");
    expect(noExit.passed).toBe(false);
    expect(noExit.hasExitContract).toBe(false);
    expect(noExit.counterexamples.some((c) => c.context === "exit-contract")).toBe(true);

    const oversized = verifyProactiveRemediationInvariant(`Write-Output '${"x".repeat(2100)}'\nexit 0\nexit 1`);
    expect(oversized.passed).toBe(false);
    expect(oversized.outputWithinLimit).toBe(false);

    // Read-only REST GET + commented-out mutating cmdlet stay clean.
    const commented = verifyProactiveRemediationInvariant("# Set-MgUser -AccountEnabled $false\nInvoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/users' -Method Get | Out-Null\nexit 0\nexit 1");
    expect(commented.passed).toBe(true);
  });

  test("buildInverseRollback('INC-4092') populates real SKU GUIDs, 3 target UPNs, and Allow-Temp-RDP-Diagnostic-Drift with zero empty license arrays", () => {
    const rb = buildInverseRollback("INC-4092");
    expect(rb.powershellScript).toContain("6fd2c87f-b296-42f0-b197-1e91e994b900");
    expect(rb.powershellScript).toContain("06ebc4ee-1bb5-47dd-8120-11324bc54e06");
    expect(rb.powershellScript).toContain("Allow-Temp-RDP-Diagnostic-Drift");
    expect(rb.powershellScript).toContain("SG-Contoso-Finance-Legacy");
    expect(rb.powershellScript).toContain("lynne.robins.contoso@c4a8shili.onmicrosoft.com");
    expect(rb.powershellScript).toContain("diego.siciliani.contoso@c4a8shili.onmicrosoft.com");
    expect(rb.powershellScript).toContain("patti.fernandez.contoso@c4a8shili.onmicrosoft.com");
    expect(rb.powershellScript).not.toContain("-AddLicenses @() -RemoveLicenses @()");
  });
});
