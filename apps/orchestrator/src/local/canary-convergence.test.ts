import { describe, expect, test } from "bun:test";
import { CANARY_COHORT, runCanaryConvergence } from "./canary-convergence.ts";

describe("Place 5 canary convergence + dead-man's switch", () => {
  test("normal: stage order APPLIED->CANARY_RING_0->SYNTHETIC_PROBED->CONVERGED", () => {
    const r = runCanaryConvergence("INC-4092");
    expect(r.scenarioId).toBe("INC-4092");
    expect(r.mode).toBe("break-glass");
    expect(r.stages.map((s) => s.stage)).toEqual(["APPLIED", "CANARY_RING_0", "SYNTHETIC_PROBED", "CONVERGED"]);
    expect(r.finalState).toBe("CONVERGED");
    expect(r.canaryCohort).toBe("SG-Canary-Ring0");
    expect(CANARY_COHORT).toBe("SG-Canary-Ring0");
    expect(r.auditAction).toBe("canary-converged");
  });

  test("gitops APPLIED says staged", () => {
    const r = runCanaryConvergence("INC-4092", { mode: "gitops" });
    expect(r.mode).toBe("gitops");
    expect(r.stages[0]!.stage).toBe("APPLIED");
    expect(r.stages[0]!.detail).toContain("staged");
    expect(r.finalState).toBe("CONVERGED");
  });

  test("probes content: identity break-glass+targets pass, network pinned", () => {
    const r = runCanaryConvergence("INC-4092");
    expect(r.probes.identity.passed).toBe(true);
    expect(r.probes.identity.breakGlassPassed).toBe(true);
    expect(r.probes.identity.breakGlassNonLockout).toBe(true);
    expect(r.probes.identity.targetsPassed).toBe(true);
    expect(r.probes.identity.targetRemediation).toBe(true);
    expect(r.probes.network).toEqual({ tcp3389Closed: true, tcp443Open: true, intuneConflicts: 0 });
    const probed = r.stages.find((s) => s.stage === "SYNTHETIC_PROBED");
    expect(probed?.probes?.network.tcp3389Closed).toBe(true);
  });

  test("dead-man rollback: AADSTS53003 spike -> AUTO_ROLLED_BACK with inverse bundle, pre-state restored", () => {
    const r = runCanaryConvergence("INC-4092", { simulateCanaryFailure: true });
    expect(r.stages.map((s) => s.stage)).toEqual(["APPLIED", "CANARY_RING_0", "SYNTHETIC_PROBED", "AUTO_ROLLED_BACK"]);
    expect(r.stages.find((s) => s.stage === "SYNTHETIC_PROBED")?.detail).toContain("AADSTS53003 spike in Canary Ring 0");
    expect(r.finalState).toBe("AUTO_ROLLED_BACK");
    expect(r.rollback).toBeDefined();
    expect(r.rollback!.powershellScript.length).toBeGreaterThan(0);
    expect(r.rollback!.powershellScript).toContain("ShouldProcess");
    expect(r.rollback!.scenarioId).toBe("INC-4092");
    expect(r.tenantRestored).toBe(true);
    expect(r.stages.find((s) => s.stage === "AUTO_ROLLED_BACK")?.tenantRestored).toBe(true);
    expect(r.rollbackExecuted).toBe(true);
    expect(r.auditAction).toBe("canary-auto-rolled-back");
  });

  test("normal has no rollback execution", () => {
    const r = runCanaryConvergence("INC-4092");
    expect(r.rollback).toBeUndefined();
    expect(r.rollbackExecuted).toBe(false);
    expect(r.tenantRestored).toBe(false);
    expect(r.stages.some((s) => s.stage === "AUTO_ROLLED_BACK")).toBe(false);
  });

  test("all scenarios converge and failure path rolls back", () => {
    for (const id of ["INC-4092", "INC-4099", "ANOM-LIC-101", "ANOM-CA-204", "ANOM-INT-309"] as const) {
      const ok = runCanaryConvergence(id);
      expect(ok.finalState).toBe("CONVERGED");
      expect(ok.probes.identity.passed).toBe(true);
      expect(ok.probes.network).toEqual({ tcp3389Closed: true, tcp443Open: true, intuneConflicts: 0 });
      const bad = runCanaryConvergence(id, { simulateCanaryFailure: true });
      expect(bad.finalState).toBe("AUTO_ROLLED_BACK");
      expect(bad.rollback!.powershellScript.length).toBeGreaterThan(0);
      expect(bad.tenantRestored).toBe(true);
    }
  });
});
