import type { RouterTelemetry } from "@contextpane/catalog";
import type { TelemetryStats } from "./api";

export interface TelemetryHandlers {
  onEvent: (event: RouterTelemetry, stats: TelemetryStats) => void;
  onHello: (stats: TelemetryStats, recent: RouterTelemetry[]) => void;
  onStatus: (connected: boolean) => void;
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
          | { type: "pong" | "stats"; stats?: TelemetryStats };
        if (data.type === "hello") handlers.onHello(data.stats, data.recent);
        else if (data.type === "telemetry") handlers.onEvent(data.event, data.stats);
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
