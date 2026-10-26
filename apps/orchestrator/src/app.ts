import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  COMPONENT_TYPES,
  EntityTypeSchema,
  TENANT_REGISTRY,
  ViewRecipeSchema,
  isTenantId,
  type ComponentType,
  type RouterTelemetry,
} from "@contextpane/catalog";
import { config, describeConfig, providers } from "./config.ts";
import { sources } from "./mcp/clients.ts";
import { gatherContext, invalidateContext } from "./mcp/context.ts";
import { metaModelsResolved } from "./router/meta-models.ts";
import { warmModalSandbox } from "./preflight/modal.ts";
import { githubStatus, listStagedBranches } from "./preflight/staging.ts";
import { recipeStore, slugify } from "./store/recipes.ts";
import { remediationStore } from "./store/remediations.ts";
import { telemetry } from "./telemetry.ts";
import { RecipeNotFoundError, hydrateRecipe } from "./tiers/tier0-recipe.ts";
import { hover, warmHoverCache } from "./tiers/tier1-hover.ts";
import { correlate } from "./tiers/tier2-correlate.ts";
import { approve, remediate } from "./tiers/tier3-remediate.ts";
import { voiceSteer } from "./tiers/voice.ts";
import type { ProgressEvent } from "./tiers/progress.ts";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : config.webOrigin),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "accept"],
  }),
);

// Model ids are swapped for served stand-ins at startup; never route a request on an unresolved id.
app.use("/api/*", async (_c, next) => {
  await metaModelsResolved();
  await next();
});

app.onError((error, c) => {
  console.error(`[orchestrator] ${c.req.method} ${c.req.path} failed:`, error);
  const status = error instanceof RecipeNotFoundError ? 404 : 500;
  return c.json({ error: error.message, path: c.req.path }, status);
});

const TenantIdSchema = z.string().refine(isTenantId, { message: `tenantId must be one of ${Object.keys(TENANT_REGISTRY).join(", ")}` });

/** ?refresh=true (or the older ?fresh=1) bypasses the context and hover caches. */
function wantsRefresh(c: { req: { query: (name: string) => string | undefined } }): boolean {
  return /^(1|true)$/i.test(c.req.query("refresh") ?? c.req.query("fresh") ?? "");
}

function wantsSse(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }): boolean {
  return (c.req.header("accept") ?? "").includes("text/event-stream") || c.req.query("stream") === "1" || c.req.query("stream") === "true";
}

/* ---------------------------------- health --------------------------------- */

app.get("/api/health", async (c) => {
  const [mcp, github] = await Promise.all([sources.status(), githubStatus()]);
  return c.json({
    github,
    ok: true,
    service: "contextpane-orchestrator",
    version: "0.1.0",
    now: new Date().toISOString(),
    liveCloudMode: config.liveCloudMode,
    forceLocal: config.forceLocal,
    providers: Object.values(providers).map((p) => ({ id: p.id, label: p.label, hasKey: p.hasKey })),
    mcp,
    telemetrySubscribers: telemetry.stats().subscribers,
  });
});

app.get("/api/config", (c) => c.json(describeConfig()));
app.get("/api/mcp/status", async (c) => c.json(await sources.status()));

/* --------------------------------- tenants --------------------------------- */

app.get("/api/tenants", (c) => c.json({ tenants: Object.values(TENANT_REGISTRY) }));

app.get("/api/tenants/:tenantId/context", async (c) => {
  const tenantId = TenantIdSchema.parse(c.req.param("tenantId"));
  const ctx = await gatherContext(tenantId, { fresh: wantsRefresh(c) });
  return c.json({
    tenantId,
    ticket: ctx.erp.ticket,
    contract: ctx.erp.contract,
    tenant: ctx.erp.tenant,
    license: { source: ctx.license.source, fallbackReason: ctx.license.fallbackReason, data: ctx.license.data },
    policies: { source: ctx.policies.source, data: ctx.policies.data },
    signIns: { source: ctx.signIns.source, count: ctx.signIns.data.length },
    drift: { source: ctx.drift.source, fallbackReason: ctx.drift.fallbackReason, summary: ctx.drift.data.summary, driftState: ctx.drift.data.driftState, severity: ctx.drift.data.severity },
    gatherLatencyMs: ctx.gatherLatencyMs,
    transport: ctx.transport,
  });
});

app.post("/api/tenants/:tenantId/refresh", (c) => {
  invalidateContext(c.req.param("tenantId"));
  return c.json({ ok: true });
});

/* -------------------------------- Tier 0 ----------------------------------- */

app.get("/api/recipe/:recipeId/hydrate", async (c) => {
  const tenantId = TenantIdSchema.parse(c.req.query("tenantId") ?? "tenant-contoso-01");
  const result = await hydrateRecipe(c.req.param("recipeId"), tenantId, { fresh: wantsRefresh(c) });
  void warmHoverCache(tenantId);
  return c.json(result);
});

/* -------------------------------- recipes ---------------------------------- */

app.get("/api/recipes", (c) => c.json({ recipes: recipeStore.list(), file: recipeStore.path() }));

app.get("/api/recipes/:recipeId", (c) => {
  const recipe = recipeStore.get(c.req.param("recipeId"));
  if (!recipe) throw new RecipeNotFoundError(c.req.param("recipeId"));
  return c.json({ recipe });
});

const PinRecipeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  tenantId: z.string().optional(),
  componentTypes: z.array(z.enum(COMPONENT_TYPES)).min(1).max(8),
  hotkey: z.string().max(1).optional(),
});

/** Pin the current canvas as a zero-token recipe. */
app.post("/api/recipes", async (c) => {
  const body = PinRecipeSchema.parse(await c.req.json());
  const base = recipeStore.get("default")!;
  const recipeId = slugify(body.name);
  const recipe = recipeStore.save({
    recipeId,
    name: body.name,
    description: body.description ?? `Pinned from ${body.tenantId ?? "canvas"}`,
    createdFromTenantId: body.tenantId ?? null,
    pinnedComponents: body.componentTypes.map((type, order) => ({ type, order, collapsed: false, options: {} })),
    mcpBindings: base.mcpBindings.filter((b) => (body.componentTypes as ComponentType[]).includes(b.component)),
    ...(body.hotkey ? { hotkey: body.hotkey } : {}),
  });
  return c.json({ recipe }, 201);
});

app.put("/api/recipes/:recipeId", async (c) => {
  const body = ViewRecipeSchema.partial().parse(await c.req.json());
  const existing = recipeStore.get(c.req.param("recipeId"));
  if (!existing) throw new RecipeNotFoundError(c.req.param("recipeId"));
  const recipe = recipeStore.save({ ...existing, ...body, recipeId: existing.recipeId });
  return c.json({ recipe });
});

app.delete("/api/recipes/:recipeId", (c) => {
  const removed = recipeStore.delete(c.req.param("recipeId"));
  return c.json({ removed });
});

/* -------------------------------- Tier 1A ---------------------------------- */

const HoverBodySchema = z.object({
  tenantId: TenantIdSchema.default("tenant-contoso-01"),
  entityId: z.string().min(1),
  entityType: EntityTypeSchema.optional(),
  fresh: z.boolean().optional(),
});

app.post("/api/hover", async (c) => {
  const body = HoverBodySchema.parse(await c.req.json());
  const result = await hover({ ...body, fresh: body.fresh || wantsRefresh(c) });
  return c.json(result);
});

/* ------------------------------ Tier 1B / 2 -------------------------------- */

const CorrelateBodySchema = z.object({
  tenantId: TenantIdSchema.default("tenant-contoso-01"),
  fresh: z.boolean().optional(),
  components: z.array(z.enum(COMPONENT_TYPES)).optional(),
});

app.post("/api/correlate", async (c) => {
  const parsed = CorrelateBodySchema.parse(await c.req.json().catch(() => ({})));
  const body = { ...parsed, fresh: parsed.fresh || wantsRefresh(c) };
  // A correlate is the "ticket opened" moment: wake the Modal sandbox now and pre-fetch every hover once it is done.
  warmModalSandbox("correlate");
  if (!wantsSse(c)) {
    const result = await correlate(body);
    void warmHoverCache(body.tenantId);
    return c.json(result);
  }
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    try {
      const result = await correlate(body, (p: ProgressEvent) => void send("progress", p));
      void warmHoverCache(body.tenantId);
      await send("result", result);
    } catch (error) {
      await send("error", { error: error instanceof Error ? error.message : String(error) });
    }
  });
});

/* -------------------------------- Tier 3 ----------------------------------- */

const RemediateBodySchema = z.object({
  tenantId: TenantIdSchema.default("tenant-contoso-01"),
  fresh: z.boolean().optional(),
});

app.post("/api/remediate", async (c) => {
  const body = RemediateBodySchema.parse(await c.req.json().catch(() => ({})));
  if (!wantsSse(c)) return c.json(await remediate(body));
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    try {
      const result = await remediate(body, (p: ProgressEvent) => void send("progress", p));
      await send("result", result);
    } catch (error) {
      await send("error", { error: error instanceof Error ? error.message : String(error) });
    }
  });
});

app.get("/api/remediations", (c) => c.json({ remediations: remediationStore.list(c.req.query("tenantId")) }));

app.get("/api/remediations/:remediationId", (c) => {
  const drawer = remediationStore.get(c.req.param("remediationId"));
  if (!drawer) return c.json({ error: "not found" }, 404);
  return c.json({ drawer });
});

const ApproveBodySchema = z.object({
  remediationId: z.string().min(1),
  approvedBy: z.string().optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  openPullRequest: z.boolean().optional(),
});

app.post("/api/approve", async (c) => {
  const body = ApproveBodySchema.parse(await c.req.json());
  const drawer = await approve(body);
  return c.json({ drawer });
});

app.get("/api/staging/branches", async (c) => c.json({ branches: await listStagedBranches() }));

/* ---------------------------------- Voice ---------------------------------- */

const VoiceBodySchema = z.object({
  tenantId: z.string().optional(),
  text: z.string().max(2000).optional(),
  audioBase64: z.string().max(12_000_000).optional(),
  mimeType: z.string().max(80).optional(),
});

app.post("/api/voice-steer", async (c) => {
  const body = VoiceBodySchema.parse(await c.req.json());
  const result = await voiceSteer(body);
  return c.json(result);
});

/* -------------------------------- telemetry -------------------------------- */

app.get("/api/telemetry/stats", (c) => c.json(telemetry.stats()));
app.get("/api/telemetry/recent", (c) => c.json({ events: telemetry.recent(Number.parseInt(c.req.query("limit") ?? "25", 10)) }));

/** SSE mirror of the WebSocket telemetry feed (for clients that cannot open /ws). */
app.get("/api/telemetry/stream", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = telemetry.subscribe((event: RouterTelemetry) => void stream.writeSSE({ event: "telemetry", data: JSON.stringify(event) }));
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ stats: telemetry.stats(), recent: telemetry.recent(10) }) });
    stream.onAbort(() => unsubscribe());
    while (!stream.aborted) {
      await stream.sleep(15_000);
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  }),
);

app.get("/", (c) =>
  c.json({
    service: "contextpane-orchestrator",
    endpoints: [
      "GET  /api/health",
      "GET  /api/recipe/:recipeId/hydrate?tenantId=",
      "POST /api/hover",
      "POST /api/correlate  (Accept: text/event-stream for progress)",
      "POST /api/remediate  (Accept: text/event-stream for progress)",
      "POST /api/approve",
      "POST /api/voice-steer",
      "GET  /api/recipes · POST /api/recipes",
      "GET  /api/telemetry/stats · GET /api/telemetry/stream · WS /ws",
    ],
  }),
);
