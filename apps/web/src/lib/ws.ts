import type { AuditEntry, Convergence, RouterTelemetry, ScenarioListItem } from "@contextpane/catalog";
import type { TelemetryStats } from "./api";

export interface TelemetryHandlers {
  onEvent: (event: RouterTelemetry, stats: TelemetryStats) => void;
  onHello: (stats: TelemetryStats, recent: RouterTelemetry[]) => void;
  onStatus: (connected: boolean) => void;
  onAudit?: (entry: AuditEntry) => void;
  /** notifications/resources/updated: a scenario's canvas converged (remediated) or was reset (convergence null). */
  onResourcesUpdated?: (scenarioId: string, convergence: Convergence | null) => void;
  /** A ticket folder landed in input/tickets/ (or left it). */
  onInboxIngested?: (item: ScenarioListItem, folder: string, attachments: string[]) => void;
  onInboxRemoved?: (scenarioId: string, folder: string) => void;
}

/**
 * Router telemetry over WebSocket (/ws, proxied by Vite to the orchestrator).
 * Reconnects with backoff; returns a disposer.
 */
export function connectTelemetry(handlers: TelemetryHandlers): () => void {
  let socket: WebSocket | null = null;
  let disposed = false;
  let attempt = 0;
  let timer: number | null = null;

  const open = () => {
    if (disposed) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
      handlers.onStatus(true);
    };
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as
          | { type: "hello"; stats: TelemetryStats; recent: RouterTelemetry[] }
          | { type: "telemetry"; event: RouterTelemetry; stats: TelemetryStats }
          | { type: "pong" | "stats"; stats?: TelemetryStats }
          | { type: "audit"; entry: AuditEntry }
          | { type: "resources/updated"; params: { scenarioId: string; tenantId: string; convergence: Convergence | null } }
          | { type: "inbox/ingested"; item: ScenarioListItem; folder: string; attachments: string[] }
          | { type: "inbox/removed"; scenarioId: string; folder: string };
        if (data.type === "hello") handlers.onHello(data.stats, data.recent);
        else if (data.type === "inbox/ingested") handlers.onInboxIngested?.(data.item, data.folder, data.attachments);
        else if (data.type === "inbox/removed") handlers.onInboxRemoved?.(data.scenarioId, data.folder);
        else if (data.type === "telemetry") handlers.onEvent(data.event, data.stats);
        else if (data.type === "audit") handlers.onAudit?.(data.entry);
        else if (data.type === "resources/updated") handlers.onResourcesUpdated?.(data.params.scenarioId, data.params.convergence);
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      handlers.onStatus(false);
      if (disposed) return;
      attempt += 1;
      timer = window.setTimeout(open, Math.min(8000, 500 * 2 ** attempt));
    };
    socket.onerror = () => socket?.close();
  };
  open();

  return () => {
    disposed = true;
    if (timer) window.clearTimeout(timer);
    socket?.close();
  };
}
