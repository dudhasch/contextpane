import { describe, expect, test } from "bun:test";
import { isScenarioId, type ScenarioId } from "@contextpane/catalog";
import {
  baselineNsgRules,
  blastRadiusMatrix,
  buildInverseRollback,
  counterfactualReplay,
  maxSmtSynthesis,
  postState,
  rogueRdpRule,
  synthesizeInverseRollback,
  verifyFormalInvariants,
  verifyIdempotency,
  verifyInverseRollback,
  verifyPccBitmask,
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
    const idem = verifyIdempotency("INC-4092")!;
    expect(idem).not.toBeNull();
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

  test("buildInverseRollback('INC-4092') resolves groups, users and the CA policy at runtime and keeps conditions.users whole", () => {
    const rb = buildInverseRollback("INC-4092");
    expect(rb.powershellScript).toContain("#Requires -Modules Microsoft.Graph.Users, Microsoft.Graph.Users.Actions");
    expect(rb.powershellScript).toContain("Allow-Temp-RDP-Diagnostic-Drift");
    expect(rb.powershellScript).toContain("Get-GroupByName 'SG-Contoso-Finance-Legacy'");
    for (const upn of ["lynne.robins", "diego.siciliani", "patti.fernandez"]) expect(rb.powershellScript).toContain(`Get-MgUser -UserId '${upn}.contoso@c4a8shili.onmicrosoft.com'`);
    expect(rb.powershellScript).toContain("[ContextPane-Demo] Block AVD - Contoso Finance Legacy");
    expect(rb.powershellScript).toContain("Get-CaUsersBody $policy.Conditions.Users");
    // Synthetic ids from before the H-14/H-15 fix must not come back.
    for (const fake of ["6fd2c87f-b296-42f0-b197-1e91e994b900", "6f8a9b0c-1d2e-4f3a-9b8c-7d6e5f4a3b2c", "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d", "d09ae604-9c1e-4b9c-9a5d-000000000001", "907668fd-5d90-4f7c-8a5c-1122334455"]) {
      expect(rb.powershellScript).not.toContain(fake);
    }
    expect(rb.powershellScript).not.toContain("SilentlyContinue | Out-Null; Invoke-MgLicenseUser");
  });

  test("buildInverseRollback('INC-4099') targets BitLocker & Fabrikam devices without leaking Contoso AVD NSG", () => {
    const rb = buildInverseRollback("INC-4099");
    expect(rb.powershellScript).toContain("Get-DeviceConfigurationByName '[ContextPane-Demo] Fabrikam-Legacy-BitLocker-DeviceConfig'");
    expect(rb.powershellScript).toContain("Sync-DeviceByName 'FABRIKAM-LT-1107'");
    expect(rb.powershellScript).toContain("Sync-MgDeviceManagementManagedDevice -ManagedDeviceId $d.Id");
    expect(rb.powershellScript).not.toContain("Invoke-MgDeviceManagementManagedDeviceSyncDevice");
    expect(rb.powershellScript).not.toContain("b1c2d3e4-1111-4222-8333-444455556666");
    expect(rb.powershellScript).not.toContain("nsg-contoso-avd-hostpool-01");
    expect(rb.restores.join(" ")).not.toContain("nsg-contoso-avd-hostpool-01");
  });

  test("rollbacks: CA-001 keeps its include set, CA-004 resolved by name, ANOM-LIC-101 restores per-user licenses", () => {
    const ca = buildInverseRollback("ANOM-CA-204").powershellScript;
    expect(ca).toContain("Get-CaUsersBody $ca001.Conditions.Users");
    expect(ca).not.toContain("excludeGroups = @() } }");
    expect(ca).not.toMatch(/ca00[14][a-d]\d\d-/);
    const lic = buildInverseRollback("ANOM-LIC-101").powershellScript;
    expect(lic).toContain("Set-MgUserLicense -UserId $u.Id -AddLicenses");
    expect(lic).toContain("henrietta.mueller.contoso@");
    expect(lic).not.toContain("/assignLicense");
    const app = buildInverseRollback("ANOM-APP-401").powershellScript;
    expect(app).toContain("New-MgApplicationOwnerByRef");
    expect(app).not.toContain("app-contoso-erp-sync-prod");
  });

  test("Weighted Partial MaxSMT synthesis (ΔW) & 7-bit Proof-Carrying Certificate (0x7F)", () => {
    for (const id of ["INC-4092", "INC-4099", "ANOM-LIC-101", "ANOM-CA-204", "ANOM-INT-309", "ANOM-APP-401"] as const) {
      const r = verifyFormalInvariants(id);
      expect(r.invariantProofMask).toBe(0x7f);
      expect(verifyPccBitmask(r.invariantProofMask)).toBe(true);
      expect(r.minPerturbationCost).toBeGreaterThan(0);
      expect(r.schemaSignature).toContain("0x7f");
      expect(r.maxSmtSynthesis!.optimal).toBe(true);
      expect(r.maxSmtSynthesis!.collateralLockouts).toBe(0);
      expect(r.maxSmtSynthesis!.hardInvariants).toHaveLength(7);
      expect(r.maxSmtSynthesis!.hardInvariants.every((h) => h.passed)).toBe(true);
    }
    const smt = maxSmtSynthesis("INC-4092");
    expect(smt.invariantProofMask).toBe(0x7f);
    expect(smt.minPerturbationCost).toBe(6.5);
    expect(verifyPccBitmask(0x7e)).toBe(false);
    expect(verifyPccBitmask(0x00)).toBe(false);
  });
});
