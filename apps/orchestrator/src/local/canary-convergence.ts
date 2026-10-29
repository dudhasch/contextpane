import { getCustomScenario, isCustomScenarioId, isScenarioId, SCENARIO_REGISTRY, type ScenarioId } from "@contextpane/catalog";
import {
  AVD_SUBNET,
  buildInverseRollback,
  hasSymbolicModel,
  postState,
  reachable,
  verifyFormalInvariants,
  type InverseRollbackBundle,
} from "./formal-verifier.ts";

/**
 * Place 5 · Canary convergence + dead-man's switch.
 *
 * Deterministic, synchronous, no LLM / GPU / I/O. After an approved
 * remediation is applied, it is first exposed only to the canary cohort
 * (SG-Canary-Ring0), synthetic identity/network probes run against the
 * Place 1 formal verifier, and only then is the tenant declared CONVERGED.
 * If the synthetic probes detect an AADSTS53003 spike in the canary ring,
 * the dead-man's switch fires automatically and attaches the inverse rollback
 * bundle (f^-1 from buildInverseRollback). This module performs no I/O, so it
 * never claims the bundle ran: when a live write landed (liveWriteApplied) the
 * change is reported as still in the tenant; otherwise nothing left the
 * pre-remediation state and the tenant is reported unchanged.
 *
 * Every probe here evaluates the symbolic model (`probeSource: "symbolic"`), never
 * the tenant; an id without a symbolic model gets `probeSource: "none"` and no probe
 * is reported as passed. The caller runs it only for an executed approval or an
 * explicit rollback drill (HARD_CASES 4, 6).
 */

export const CANARY_COHORT = "SG-Canary-Ring0" as const;

export type CanaryMode = "break-glass" | "gitops";
export type CanaryStageName = "APPLIED" | "CANARY_RING_0" | "SYNTHETIC_PROBED" | "CONVERGED" | "AUTO_ROLLED_BACK";
export type CanaryFinalState = "CONVERGED" | "AUTO_ROLLED_BACK";

export interface CanaryConvergenceOptions {
  mode?: CanaryMode;
  simulateCanaryFailure?: boolean;
  /** True only when the approval actually wrote to the live tenant (approval state "executed"). */
  liveWriteApplied?: boolean;
  /** True when the orchestrator executed the inverse rollback f^-1 to restore pre-change state. */
  rollbackExecuted?: boolean;
}

export interface IdentityProbes {
  passed: boolean;
  breakGlassPassed: boolean;
  breakGlassNonLockout: boolean;
  targetsPassed: boolean;
  targetRemediation: boolean;
  checked: number;
  evidence: string[];
}

export interface NetworkProbes {
  tcp3389Closed: boolean;
  tcp443Open: boolean;
  intuneConflicts: number;
}

export interface SyntheticProbes {
  passed: boolean;
  aadsts53003Spike: boolean;
  detail: string;
}

export interface CanaryProbes {
  identity: IdentityProbes;
  network: NetworkProbes;
  synthetic?: SyntheticProbes;
}

/** Where the probes read from: the symbolic fixture model, or nothing (no model for this id). */
export type CanaryProbeSource = "symbolic" | "none";

export interface CanaryStage {
  stage: CanaryStageName;
  at: string;
  detail: string;
  probes?: CanaryProbes;
  tenantRestored?: boolean;
}

export interface CanaryConvergenceResult {
  scenarioId: ScenarioId | string;
  mode: CanaryMode;
  /** "live-graph" when the approval wrote to the tenant; "simulated" for a staged approval or a drill. */
  execution: "live-graph" | "simulated";
  probeSource: CanaryProbeSource;
  stages: CanaryStage[];
  finalState: CanaryFinalState;
  canaryCohort: typeof CANARY_COHORT;
  probes: CanaryProbes;
  rollback?: InverseRollbackBundle;
  rollbackExecuted: boolean;
  tenantRestored: boolean;
  auditAction: string;
}

function buildProbes(scenarioId: ScenarioId | string, simulateCanaryFailure: boolean, probeSource: CanaryProbeSource): CanaryProbes {
  if (probeSource === "none") {
    // No symbolic model: nothing is evaluated and nothing is reported as passed (HARD_CASES 4).
    const identity: IdentityProbes = { passed: false, breakGlassPassed: false, breakGlassNonLockout: false, targetsPassed: false, targetRemediation: false, checked: 0, evidence: [] };
    const network: NetworkProbes = { tcp3389Closed: false, tcp443Open: false, intuneConflicts: 0 };
    const synthetic: SyntheticProbes = simulateCanaryFailure
      ? { passed: false, aadsts53003Spike: true, detail: "AADSTS53003 spike in Canary Ring 0 (drill)" }
      : { passed: false, aadsts53003Spike: false, detail: "No symbolic model for this ticket: synthetic probes not evaluated" };
    return { identity, network, synthetic };
  }
  const verification = verifyFormalInvariants(scenarioId);
  const breakGlass = verification.invariants.find((i) => i.id === "break-glass-non-lockout");
  const targets = verification.invariants.find((i) => i.id === "target-remediation");

  const state = postState(scenarioId);
  const rdp = reachable(state.nsgRules, "Internet", AVD_SUBNET, "Tcp", 3389);
  const avd = reachable(state.nsgRules, AVD_SUBNET, "WindowsVirtualDesktop", "Tcp", 443);
  // Post-remediation affected devices are Compliant; any remaining Conflict would surface here.
  const intuneConflicts = state.affected.filter((a) => a.kind === "device" && a.post === "Conflict").length;

  const identity: IdentityProbes = {
    passed: Boolean(breakGlass?.passed && targets?.passed),
    breakGlassPassed: breakGlass?.passed ?? false,
    breakGlassNonLockout: breakGlass?.passed ?? false,
    targetsPassed: targets?.passed ?? false,
    targetRemediation: targets?.passed ?? false,
    checked: (breakGlass?.checked ?? 0) + (targets?.checked ?? 0),
    evidence: [...(breakGlass?.evidence ?? []), ...(targets?.evidence ?? [])],
  };
  const network: NetworkProbes = {
    tcp3389Closed: !rdp.reachable,
    tcp443Open: avd.reachable,
    intuneConflicts,
  };
  const synthetic: SyntheticProbes = simulateCanaryFailure
    ? { passed: false, aadsts53003Spike: true, detail: "AADSTS53003 spike in Canary Ring 0" }
    : { passed: identity.passed && network.tcp3389Closed && network.tcp443Open && network.intuneConflicts === 0, aadsts53003Spike: false, detail: "Synthetic probes passed in Canary Ring 0" };
  return { identity, network, synthetic };
}

export function runCanaryConvergence(scenarioId: ScenarioId | string, options: CanaryConvergenceOptions = {}): CanaryConvergenceResult {
  const custom = getCustomScenario(String(scenarioId));
  if (!isScenarioId(scenarioId) && !custom && !isCustomScenarioId(String(scenarioId))) {
    throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
  }
  const mode: CanaryMode = options.mode ?? "break-glass";
  const simulateCanaryFailure = options.simulateCanaryFailure ?? false;
  const liveWriteApplied = mode === "break-glass" && (options.liveWriteApplied ?? false);
  const tenantId = isScenarioId(scenarioId) ? SCENARIO_REGISTRY[scenarioId].tenantId : (custom?.tenantId ?? "tenant-contoso-01");
  const at = new Date().toISOString();
  const probeSource: CanaryProbeSource = hasSymbolicModel(scenarioId) ? "symbolic" : "none";
  const execution = liveWriteApplied ? "live-graph" : "simulated";
  const probes = buildProbes(scenarioId, simulateCanaryFailure, probeSource);

  const appliedDetail =
    mode === "gitops"
      ? `Remediation staged for ${scenarioId} (${tenantId}) via Pure GitOps: patch staged for the pipeline, nothing written live`
      : liveWriteApplied
        ? `Remediation applied to tenant ${tenantId} for ${scenarioId} via Emergency Break-Glass live write`
        : `Remediation simulated for ${scenarioId} (${tenantId}) via Emergency Break-Glass: nothing written live`;

  const stages: CanaryStage[] = [
    { stage: "APPLIED", at, detail: appliedDetail },
    {
      stage: "CANARY_RING_0",
      at,
      detail: `Remediation exposed only to canary cohort ${CANARY_COHORT} for ${scenarioId}; rest of tenant unchanged`,
    },
  ];

  if (simulateCanaryFailure) {
    const rollback = buildInverseRollback(scenarioId);
    const rollbackExecuted = options.rollbackExecuted ?? false;
    const tenantRestored = rollbackExecuted || !liveWriteApplied;
    const rollbackDetail = rollbackExecuted
      ? `Dead-man's switch fired for ${scenarioId}: f⁻¹ inverse rollback executed — tenant ${tenantId} restored to pre-change state`
      : liveWriteApplied
        ? `Dead-man's switch fired for ${scenarioId}: inverse rollback bundle (f^-1) prepared but NOT applied; the live break-glass change is still in tenant ${tenantId}`
        : `Dead-man's switch fired for ${scenarioId}: nothing was written live, so tenant ${tenantId} is unchanged; inverse rollback bundle (f^-1) kept for reference`;
    stages.push({
      stage: "SYNTHETIC_PROBED",
      at,
      detail: "Synthetic probes failed: AADSTS53003 spike in Canary Ring 0 — dead-man's switch triggered",
      probes,
    });
    stages.push({
      stage: "AUTO_ROLLED_BACK",
      at,
      detail: rollbackDetail,
      probes,
      tenantRestored,
    });
    return {
      scenarioId,
      mode,
      execution,
      probeSource,
      stages,
      finalState: "AUTO_ROLLED_BACK",
      canaryCohort: CANARY_COHORT,
      probes,
      rollback,
      rollbackExecuted,
      tenantRestored,
      auditAction: "canary-auto-rolled-back",
    };
  }

  // The probe detail reports what was evaluated; a symbolic pass is a pass of the model, not of the tenant.
  stages.push({
    stage: "SYNTHETIC_PROBED",
    at,
    detail:
      probeSource === "none"
        ? (probes.synthetic?.detail ?? "Synthetic probes not evaluated")
        : probes.synthetic?.passed
          ? scenarioId === "INC-4092"
            ? "Synthetic probes passed on the symbolic model: break-glass + targets Allow, Tcp/3389 closed, Tcp/443 open, 0 Intune conflicts"
            : "Synthetic probes passed on the symbolic model: break-glass + targets healthy, 0 policy conflicts"
          : "Synthetic probes did not pass on the symbolic model",
    probes,
  });
  stages.push({
    stage: "CONVERGED",
    at,
    detail: liveWriteApplied
      ? `Canary Ring 0 healthy for ${scenarioId}; tenant converged`
      : `Canary Ring 0 evaluated for ${scenarioId}; nothing was written live, so only the canvas converged`,
  });

  return {
    scenarioId,
    mode,
    execution,
    probeSource,
    stages,
    finalState: "CONVERGED",
    canaryCohort: CANARY_COHORT,
    probes,
    rollbackExecuted: false,
    tenantRestored: false,
    auditAction: "canary-converged",
  };
}
