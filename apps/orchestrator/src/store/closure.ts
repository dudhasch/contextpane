import type { CanaryConvergenceResult } from "../local/canary-convergence.ts";

/**
 * Per-scenario ticket-closure state that outlives one request: the last canary trace an
 * approval produced (the PSA note quotes its probes) and whether the ticket was marked
 * closed in the PSA. Cleared by a drift reset together with the convergence.
 */
const canaries = new Map<string, CanaryConvergenceResult>();
const closed = new Map<string, { closedAt: string; closedBy: string }>();

export const closureStore = {
  setCanary(scenarioId: string, canary: CanaryConvergenceResult) {
    canaries.set(scenarioId, canary);
  },
  canary(scenarioId: string): CanaryConvergenceResult | null {
    return canaries.get(scenarioId) ?? null;
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
  },
};
