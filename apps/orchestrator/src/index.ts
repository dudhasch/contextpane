import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import type { RouterTelemetry } from "@contextpane/catalog";
import { app } from "./app.ts";
import { config, describeConfig, providers } from "./config.ts";
import { telemetry } from "./telemetry.ts";

/**
 * Bun entrypoint: Hono HTTP app + WebSocket telemetry feed on /ws.
 */
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

app.get(
  "/ws",
  upgradeWebSocket(() => {
    let unsubscribe: (() => void) | null = null;
    return {
      onOpen(_event, ws) {
        ws.send(JSON.stringify({ type: "hello", stats: telemetry.stats(), recent: telemetry.recent(10), config: describeConfig() }));
        unsubscribe = telemetry.subscribe((event: RouterTelemetry) => {
          ws.send(JSON.stringify({ type: "telemetry", event, stats: telemetry.stats() }));
        });
      },
      onMessage(event, ws) {
        if (String(event.data) === "ping") ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
        if (String(event.data) === "stats") ws.send(JSON.stringify({ type: "stats", stats: telemetry.stats() }));
      },
      onClose() {
        unsubscribe?.();
        unsubscribe = null;
      },
    };
  }),
);

const server = Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
  websocket,
  idleTimeout: 120,
});

const keyed = Object.values(providers).filter((p) => p.hasKey).map((p) => p.id);
console.log(`\n  ContextPane orchestrator  http://localhost:${server.port}`);
console.log(`  LIVE_CLOUD_MODE=${config.liveCloudMode}  MCP=${config.mcpTransport}  providers=${keyed.length ? keyed.join(",") : "none (deterministic fallback)"}${config.forceLocal ? "  CTX_FORCE_LOCAL=true" : ""}`);
console.log(`  WS telemetry ws://localhost:${server.port}/ws · SSE /api/telemetry/stream\n`);
