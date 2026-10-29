import type { Convergence } from "@contextpane/catalog";
import { workbenchEvents } from "../events.ts";
import type { EntitySnapshot } from "../local/snapshot.ts";

/**
 * In-memory remediation state per scenario. Set when an approval lands, cleared by
 * POST /api/lab/reset-drift; the web app overlays it on the canvas. The pre-change entity
 * snapshot captured at approve time lives next to it (U-5): the inverse rollback is derived
 * from it and the read-back probe compares the tenant with it.
 */
const state = new Map<string, Convergence>();
const snapshots = new Map<string, EntitySnapshot>();

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

  setSnapshot(scenarioId: string, snapshot: EntitySnapshot) {
    snapshots.set(scenarioId, snapshot);
  },

  snapshot(scenarioId: string): EntitySnapshot | null {
    return snapshots.get(scenarioId) ?? null;
  },

  clear(scenarioId: string, tenantId: string) {
    state.delete(scenarioId);
    snapshots.delete(scenarioId);
    workbenchEvents.publish({
      type: "resources/updated",
      method: "notifications/resources/updated",
      params: { uri: resourceUri(scenarioId), scenarioId, tenantId, state: "drifted", convergence: null },
    });
  },
};
