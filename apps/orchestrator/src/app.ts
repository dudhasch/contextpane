import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  CANVAS_COMPONENT_TYPES,
  EntityTypeSchema,
  ExecutionModeSchema,
  SCENARIO_IDS,
  SCENARIO_REGISTRY,
  TENANT_REGISTRY,
  ViewRecipeSchema,
  isScenarioId,
  isTenantId,
  type ComponentType,
  type RouterTelemetry,
  type ScenarioId,
  type ScenarioListItem,
} from "@contextpane/catalog";
import { config, describeConfig, providers } from "./config.ts";
import { buildScenarioBrief } from "./local/brief.ts";
import { publishDataPlane, resolveDataPtr } from "./local/dataplane.ts";
import { applyScenarioState } from "./local/lab.ts";
import { sources } from "./mcp/clients.ts";
import { gatherContext, invalidateContext, resolveScenarioId } from "./mcp/context.ts";
import { metaModelsResolved } from "./router/meta-models.ts";
import { warmModalSandbox } from "./preflight/modal.ts";
import { githubStatus, listStagedBranches } from "./preflight/staging.ts";
import { auditLedger } from "./store/audit.ts";
import { convergenceStore } from "./store/convergence.ts";
import { recipeStore, slugify } from "./store/recipes.ts";
import { remediationStore } from "./store/remediations.ts";
import { ZERO_USAGE, telemetry } from "./telemetry.ts";
import { buildInverseRollback, counterfactualReplay, verifyFormalInvariants, verifyIdempotency } from "./local/formal-verifier.ts";
import { compileSkill, listCompiledSkills, lookupTier0Skill } from "./local/skill-compiler.ts";
import { getTimeline } from "./local/timeline.ts";
import { RecipeNotFoundError, hydrateRecipe } from "./tiers/tier0-recipe.ts";
import { hover, warmHoverCache } from "./tiers/tier1-hover.ts";
import { correlate } from "./tiers/tier2-correlate.ts";
import { approve, remediate } from "./tiers/tier3-remediate.ts";
import { visionExtract } from "./tiers/vision.ts";
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
const ScenarioIdSchema = z.string().refine(isScenarioId, { message: `scenarioId must be one of ${SCENARIO_IDS.join(", ")}` });

/** Every scenario endpoint takes scenarioId; an older tenantId selects that tenant's ticket scenario. */
function scenarioOf(body: { scenarioId?: string; tenantId?: string }): ScenarioId {
  return body.scenarioId ? ScenarioIdSchema.parse(body.scenarioId) as ScenarioId : resolveScenarioId(body.tenantId ? TenantIdSchema.parse(body.tenantId) : "INC-4092");
}

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

/* -------------------------------- scenarios -------------------------------- */

app.get("/api/tenants", (c) => c.json({ tenants: Object.values(TENANT_REGISTRY) }));

/** Tickets and tenant anomalies for the mode switcher; resolved = approved since the last drift reset. */
app.get("/api/scenarios", (c) => {
  const scenarios: ScenarioListItem[] = SCENARIO_IDS.map((scenarioId) => {
    const entry = SCENARIO_REGISTRY[scenarioId];
    return {
      scenarioId,
      kind: entry.kind,
      tenantId: entry.tenantId,
      tenantName: TENANT_REGISTRY[entry.tenantId].displayName,
      title: entry.title,
      resolved: Boolean(convergenceStore.get(scenarioId)),
    };
  });
  return c.json({ scenarios });
});

/** Left pane: summary & resolution plan, MCP-enriched entities by provenance colour, ticket or anomaly text. */
app.get("/api/scenarios/:scenarioId/brief", async (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId")) as ScenarioId;
  const ctx = await gatherContext(scenarioId, { fresh: wantsRefresh(c) });
  return c.json({ brief: buildScenarioBrief(ctx), gatherLatencyMs: ctx.gatherLatencyMs, transport: ctx.transport, fallbackReasons: ctx.fallbackReasons });
});

/** The ptr:// data plane: a scenario's dataset descriptors (what the model sees), and one pointer's rows. */
app.get("/api/dataplane/:scenarioId", async (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId")) as ScenarioId;
  const snapshot = publishDataPlane(await gatherContext(scenarioId));
  return c.json({ scenarioId, gatheredAt: snapshot.gatheredAt, bytes: snapshot.bytes, datasets: snapshot.descriptors, piiMetrics: snapshot.piiMetrics, vaultMetrics: snapshot.piiMetrics, pii: snapshot.piiMetrics });
});

/* -------- Day-2: formal prover, rollback, timeline, skill compiler -------- */

app.get("/api/formal/:scenarioId", (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId")) as ScenarioId;
  const formal = verifyFormalInvariants(scenarioId);
  return c.json({ scenarioId, formal, blastRadius: counterfactualReplay(scenarioId), rollback: buildInverseRollback(scenarioId), idempotency: verifyIdempotency(scenarioId), telemetry: { tier: "Tier 3C", tokensUsed: { total: 0 }, latencyMs: formal.latencyMs } });
});

app.post("/api/rollback", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scenarioId?: string };
  const scenarioId = scenarioOf(body);
  const started = performance.now();
  const rollback = buildInverseRollback(scenarioId);
  const check = verifyIdempotency(scenarioId);
  if (!check.passed) return c.json({ ok: false, error: "inverse rollback idempotency check failed", rollback }, 422);
  return c.json({ ok: true, executed: "simulated", latencyMs: Math.round((performance.now() - started) * 10) / 10, rollback, idempotency: check });
});

app.get("/api/timeline/:scenarioId", (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId")) as ScenarioId;
  const timeline = getTimeline(scenarioId);
  if (!timeline) return c.json({ error: "unknown scenario" }, 404);
  return c.json({ timeline, telemetry: { tier: "Tier 0", tokensUsed: { total: 0 }, latencyMs: 0 } });
});

const CompileBodySchema = z.object({ scenarioId: z.string().optional(), tenantId: z.string().optional() });
const skillDef = (s: ReturnType<typeof listCompiledSkills>[number]) => ({ id: s.id, scenarioId: s.scenarioId, signature: s.signature, tier: s.tier, tokenCost: s.tokenCost, latencyMs: s.latencyMs, fuzz: s.fuzz, createdAt: s.createdAt, version: s.version, badge: `Tier 0 Compiled Skill (${s.fuzz.passed}/${s.fuzz.cases} fuzz verified)` });

app.get("/api/skills", (c) => c.json({ skills: listCompiledSkills().map(skillDef), file: "data/compiled-skills.json" }));

app.post("/api/skills/compile", async (c) => {
  const body = CompileBodySchema.parse(await c.req.json().catch(() => ({})));
  const scenarioId = scenarioOf(body);
  const skill = await compileSkill(scenarioId);
  return c.json({ skill: skillDef(skill), promoted: skill.fuzz.passed === skill.fuzz.cases, telemetry: { tier: "Tier 0", tokensUsed: { total: 0 }, latencyMs: skill.latencyMs } }, 201);
});

app.get("/api/skills/match/:scenarioId", (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId")) as ScenarioId;
  const hit = lookupTier0Skill({ scenarioId });
  return hit ? c.json({ matched: true, skill: skillDef(hit.skill), latencyMs: hit.latencyMs }) : c.json({ matched: false, skill: null });
});

app.get("/api/dataplane", (c) => {
  const ptr = c.req.query("ptr") ?? "";
  const hit = resolveDataPtr(ptr);
  return hit.found ? c.json({ ptr, descriptor: hit.descriptor, rows: hit.value }) : c.json({ error: `'${ptr}' is not published; gather its scenario first` }, 404);
});

app.post("/api/scenarios/:scenarioId/refresh", (c) => {
  invalidateContext(ScenarioIdSchema.parse(c.req.param("scenarioId")));
  return c.json({ ok: true });
});

/* -------------------------------- Tier 0 ----------------------------------- */

app.get("/api/recipe/:recipeId/hydrate", async (c) => {
  const scenarioId = scenarioOf({ scenarioId: c.req.query("scenarioId"), tenantId: c.req.query("tenantId") });
  const result = await hydrateRecipe(c.req.param("recipeId"), scenarioId, { fresh: wantsRefresh(c) });
  void warmHoverCache(scenarioId);
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
  scenarioId: z.string().optional(),
  componentTypes: z.array(z.enum(CANVAS_COMPONENT_TYPES)).min(1).max(8),
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
    description: body.description ?? `Pinned from ${body.scenarioId ?? body.tenantId ?? "canvas"}`,
    createdFromTenantId: body.tenantId ?? (body.scenarioId && isScenarioId(body.scenarioId) ? SCENARIO_REGISTRY[body.scenarioId].tenantId : null),
    pinnedComponents: body.componentTypes.map((type, order) => ({ type, order, collapsed: true, options: {} })),
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
  scenarioId: z.string().optional(),
  tenantId: z.string().optional(),
  entityId: z.string().min(1),
  entityType: EntityTypeSchema.optional(),
  fresh: z.boolean().optional(),
});

app.post("/api/hover", async (c) => {
  const body = HoverBodySchema.parse(await c.req.json());
  const result = await hover({
    scenarioId: scenarioOf(body),
    entityId: body.entityId,
    ...(body.entityType ? { entityType: body.entityType } : {}),
    fresh: body.fresh || wantsRefresh(c),
  });
  return c.json(result);
});

/* ------------------------------ Tier 1B / 2 -------------------------------- */

const CorrelateBodySchema = z.object({
  scenarioId: z.string().optional(),
  tenantId: z.string().optional(),
  fresh: z.boolean().optional(),
  components: z.array(z.enum(CANVAS_COMPONENT_TYPES)).optional(),
});

app.post("/api/correlate", async (c) => {
  const parsed = CorrelateBodySchema.parse(await c.req.json().catch(() => ({})));
  const body = {
    scenarioId: scenarioOf(parsed),
    fresh: parsed.fresh || wantsRefresh(c),
    ...(parsed.components ? { components: parsed.components as ComponentType[] } : {}),
  };
  // A correlate is the "ticket opened" moment: wake the Modal sandbox now and pre-fetch every hover once it is done.
  warmModalSandbox("correlate");
  if (!wantsSse(c)) {
    const result = await correlate(body);
    void warmHoverCache(body.scenarioId);
    return c.json(result);
  }
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    try {
      const result = await correlate(body, (p: ProgressEvent) => void send("progress", p));
      void warmHoverCache(body.scenarioId);
      await send("result", result);
    } catch (error) {
      await send("error", { error: error instanceof Error ? error.message : String(error) });
    }
  });
});

/* -------------------------------- Tier 3 ----------------------------------- */

const RemediateBodySchema = z.object({
  scenarioId: z.string().optional(),
  tenantId: z.string().optional(),
  fresh: z.boolean().optional(),
});

app.post("/api/remediate", async (c) => {
  const parsed = RemediateBodySchema.parse(await c.req.json().catch(() => ({})));
  const body = { scenarioId: scenarioOf(parsed), ...(parsed.fresh !== undefined ? { fresh: parsed.fresh } : {}) };
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
  mode: ExecutionModeSchema.optional(),
});

/**
 * HITL approval. break-glass: live Graph/ARM writes in LIVE_CLOUD_MODE, a reconcile commit on the
 * fix branch, then a zero-token canvas convergence push. gitops: no live write, a fresh pre-flight,
 * nothing converges. Either way a PR is opened only when openPullRequest is true.
 */
const approveHandler = async (c: Context) => {
  const body = ApproveBodySchema.parse(await c.req.json());
  const { convergence, ...drawer } = await approve(body);
  return c.json({ drawer, convergence });
};
app.post("/api/remediate/approve", approveHandler);
app.post("/api/approve", approveHandler);

app.get("/api/staging/branches", async (c) => c.json({ branches: await listStagedBranches() }));

/* ------------------------------ demo lab state ----------------------------- */

app.get("/api/lab/state", (c) => c.json({ convergence: convergenceStore.all() }));

const ResetDriftBodySchema = z.object({ scenarioId: z.string().optional(), tenantId: z.string().optional() });

/**
 * Restores the drifted demo state between video takes, per scenario: the license
 * extensions go back to their drifted values, the [ContextPane-Demo] Conditional Access
 * and Intune objects back to their drifted configuration, and the in-memory convergence
 * is cleared. No seed script, no model call. Without a scenario every scenario is reset.
 */
app.post("/api/lab/reset-drift", async (c) => {
  const started = performance.now();
  const body = ResetDriftBodySchema.parse(await c.req.json().catch(() => ({})));
  const scenarioIds: ScenarioId[] = body.scenarioId || body.tenantId ? [scenarioOf(body)] : [...SCENARIO_IDS];
  const results = await Promise.all(
    scenarioIds.map(async (scenarioId) => {
      const tenantId = SCENARIO_REGISTRY[scenarioId].tenantId;
      // The canvas reverts on this push at once; the Graph writes land behind it.
      convergenceStore.clear(scenarioId, tenantId);
      const write = await applyScenarioState(scenarioId, "drifted");
      invalidateContext(scenarioId);
      const failed = write.results.filter((r) => !r.ok);
      auditLedger.append({
        tenantId,
        ticketId: scenarioId,
        actionType: "drift-reset",
        delegatedIdentity: config.lab.delegatedIdentity,
        modalSandboxVerified: false,
        astPass: null,
        tfValidatePass: null,
        gitBranch: null,
        prUrl: null,
        latencyMs: write.latencyMs,
        execution: write.source === "live-graph" && !failed.length ? "live-graph" : "simulated",
        detail: `${write.summary}${write.fallbackReason ? ` (${write.fallbackReason.slice(0, 160)})` : ""}`.slice(0, 300),
      });
      return { scenarioId, tenantId, source: write.source, fallbackReason: write.fallbackReason, latencyMs: write.latencyMs, summary: write.summary, items: write.results.map((r) => r.id), failed };
    }),
  );
  return c.json({ ok: results.every((r) => r.failed.length === 0), latencyMs: Math.round(performance.now() - started), results });
});

/* --------------------------------- vision ---------------------------------- */

const VisionBodySchema = z.object({
  tenantId: TenantIdSchema.default("tenant-contoso-01"),
  ticketId: z.string().max(40).optional(),
  fileName: z.string().max(200).optional(),
  imageDataUri: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,/, "imageDataUri must be a base64 PNG, JPEG or WebP data URI"),
});

app.post("/api/vision-extract", async (c) => {
  const body = VisionBodySchema.parse(await c.req.json());
  const result = await visionExtract(body);
  return c.json(result, result.extraction ? 200 : 502);
});

/* ---------------------------------- audit ---------------------------------- */

app.get("/api/audit", (c) =>
  c.json({ entries: auditLedger.list(Number.parseInt(c.req.query("limit") ?? "50", 10), c.req.query("tenantId")), file: auditLedger.path() }),
);

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
      "GET  /api/scenarios · GET /api/scenarios/:scenarioId/brief",
      "GET  /api/recipe/:recipeId/hydrate?scenarioId=",
      "POST /api/hover",
      "POST /api/correlate  (Accept: text/event-stream for progress)",
      "POST /api/remediate  (Accept: text/event-stream for progress)",
      "POST /api/remediate/approve  (alias POST /api/approve)",
      "POST /api/lab/reset-drift · GET /api/lab/state",
      "POST /api/vision-extract",
      "GET  /api/audit",
      "POST /api/voice-steer",
      "GET  /api/recipes · POST /api/recipes",
      "GET  /api/telemetry/stats · GET /api/telemetry/stream · WS /ws",
    ],
  }),
);
