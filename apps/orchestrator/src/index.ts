import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { TENANT_REGISTRY, type RouterTelemetry } from "@contextpane/catalog";
import { app } from "./app.ts";
import { config, describeConfig, providers } from "./config.ts";
import { gatherContext } from "./mcp/context.ts";
import { warmModalSandbox } from "./preflight/modal.ts";
import { resolveMetaModels } from "./router/meta-models.ts";
import { telemetry } from "./telemetry.ts";
import { warmHoverCache } from "./tiers/tier1-hover.ts";

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

// Warm-up, all in the background: wake the Modal sandbox, mint the Graph/ARM tokens and
// gather the context for every tenant, resolve the Meta model ids, then pre-fetch every hover.
const warmStarted = performance.now();
warmModalSandbox("startup");
const contexts = Promise.all(Object.keys(TENANT_REGISTRY).map((tenantId) => gatherContext(tenantId).catch(() => null)));
const metaModels = config.forceLocal
  ? Promise.resolve()
  : resolveMetaModels()
      .then((r) => {
        if (!r) return;
        for (const s of r.substituted) console.log(`  [meta] ${s.configured} is not served → ${s.using}`);
        if (r.missing.length) console.warn(`  [meta] not served and no stand-in: ${r.missing.join(", ")}`);
      })
      .catch((error) => console.warn(`  [meta] model check skipped: ${error instanceof Error ? error.message : String(error)}`));
void Promise.all([contexts, metaModels]).then(async ([gathered]) => {
  const live = gathered.filter((c) => c && c.sourcesUsed.msgraph !== "seeded-manifest").length;
  console.log(`  [warm] MCP context for ${gathered.filter(Boolean).length} tenants (${live} live) in ${Math.round(performance.now() - warmStarted)} ms`);
  const hovers = await warmHoverCache("tenant-contoso-01");
  if (hovers) console.log(`  [warm] ${hovers.warmed}/${hovers.total} ticket hovers cached in ${Math.round(performance.now() - warmStarted)} ms`);
});
