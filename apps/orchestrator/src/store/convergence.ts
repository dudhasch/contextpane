import type { Convergence } from "@contextpane/catalog";
import { workbenchEvents } from "../events.ts";

/**
 * In-memory remediation state per tenant. Set when an approval lands, cleared by
 * POST /api/lab/reset-drift; the web app overlays it on the canvas.
 */
const state = new Map<string, Convergence>();

function resourceUri(tenantId: string): string {
  return `contextpane://tenants/${tenantId}/canvas`;
}

export const convergenceStore = {
  get(tenantId: string): Convergence | null {
    return state.get(tenantId) ?? null;
  },

  all(): Convergence[] {
    return [...state.values()];
  },

  set(convergence: Convergence) {
    state.set(convergence.tenantId, convergence);
    workbenchEvents.publish({
      type: "resources/updated",
      method: "notifications/resources/updated",
      params: { uri: resourceUri(convergence.tenantId), tenantId: convergence.tenantId, state: "remediated", convergence },
    });
  },

  clear(tenantId: string) {
    state.delete(tenantId);
    workbenchEvents.publish({
      type: "resources/updated",
      method: "notifications/resources/updated",
      params: { uri: resourceUri(tenantId), tenantId, state: "drifted", convergence: null },
    });
  },
};
