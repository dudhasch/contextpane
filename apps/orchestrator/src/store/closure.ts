import type { ScenarioBrief } from "@contextpane/catalog";
import type { CanaryConvergenceResult } from "../local/canary-convergence.ts";

/**
 * Per-scenario ticket-closure state that outlives one request: the last canary trace an
 * approval produced (the PSA note quotes its probes), the pre-remediation brief snapshot,
 * and whether the ticket was marked closed in the PSA. Cleared by a drift reset together
 * with the convergence.
 */
const canaries = new Map<string, CanaryConvergenceResult>();
const closed = new Map<string, { closedAt: string; closedBy: string }>();
const briefs = new Map<string, ScenarioBrief>();

export const closureStore = {
  setCanary(scenarioId: string, canary: CanaryConvergenceResult) {
    canaries.set(scenarioId, canary);
  },
  canary(scenarioId: string): CanaryConvergenceResult | null {
    return canaries.get(scenarioId) ?? null;
  },
  setBriefSnapshot(scenarioId: string, brief: ScenarioBrief) {
    briefs.set(scenarioId, brief);
  },
  briefSnapshot(scenarioId: string): ScenarioBrief | null {
    return briefs.get(scenarioId) ?? null;
  },
  close(scenarioId: string, closedBy: string) {
    const entry = { closedAt: new Date().toISOString(), closedBy };
    closed.set(scenarioId, entry);
    return entry;
  },
  closedState(scenarioId: string) {
    return closed.get(scenarioId) ?? null;
  },
  clear(scenarioId: string) {
    canaries.delete(scenarioId);
    closed.delete(scenarioId);
    briefs.delete(scenarioId);
  },
};
