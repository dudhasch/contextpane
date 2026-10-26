import type { Convergence } from "@contextpane/catalog";
import { workbenchEvents } from "../events.ts";

/**
 * In-memory remediation state per scenario. Set when an approval lands, cleared by
 * POST /api/lab/reset-drift; the web app overlays it on the canvas.
 */
const state = new Map<string, Convergence>();

function resourceUri(scenarioId: string): string {
  return `contextpane://scenarios/${scenarioId}/canvas`;
}

export const convergenceStore = {
  get(scenarioId: string): Convergence | null {
    return state.get(scenarioId) ?? null;
  },

  all(): Convergence[] {
    return [...state.values()];
  },

  set(convergence: Convergence) {
    state.set(convergence.scenarioId, convergence);
    workbenchEvents.publish({
      type: "resources/updated",
      method: "notifications/resources/updated",
      params: { uri: resourceUri(convergence.scenarioId), scenarioId: convergence.scenarioId, tenantId: convergence.tenantId, state: "remediated", convergence },
    });
  },

  clear(scenarioId: string, tenantId: string) {
    state.delete(scenarioId);
    workbenchEvents.publish({
      type: "resources/updated",
      method: "notifications/resources/updated",
      params: { uri: resourceUri(scenarioId), scenarioId, tenantId, state: "drifted", convergence: null },
    });
  },
};
