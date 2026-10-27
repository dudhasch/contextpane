import type { AuditEntry, Convergence, ScenarioListItem } from "@contextpane/catalog";

/**
 * Workbench state pushes that are not router telemetry. The WebSocket forwards
 * each message as-is; a resources/updated message mirrors MCP's
 * notifications/resources/updated so the canvas converges with 0 LLM tokens.
 */
export type WorkbenchEvent =
  | { type: "audit"; entry: AuditEntry }
  /** A ticket folder landed in (or left) input/tickets/: the unified queue updates at once. */
  | { type: "inbox/ingested"; item: ScenarioListItem; folder: string; attachments: string[] }
  | { type: "inbox/removed"; scenarioId: string; folder: string }
  | {
      type: "resources/updated";
      method: "notifications/resources/updated";
      params: { uri: string; scenarioId: string; tenantId: string; state: "remediated" | "drifted"; convergence: Convergence | null };
    };

type Listener = (event: WorkbenchEvent) => void;

class WorkbenchEventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: WorkbenchEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[events] listener failed", error);
      }
    }
  }
}

export const workbenchEvents = new WorkbenchEventBus();
