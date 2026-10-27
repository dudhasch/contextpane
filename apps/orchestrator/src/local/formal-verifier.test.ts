import { describe, expect, test } from "bun:test";
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
});
