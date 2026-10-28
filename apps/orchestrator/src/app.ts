import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  CANVAS_COMPONENT_TYPES,
  ContextViewModeSchema,
  EntityTypeSchema,
  ExecutionModeSchema,
  SCENARIO_IDS,
  SCENARIO_REGISTRY,
  SELECTION_MAX_CHARS,
  SELECTION_MIN_CHARS,
  TENANT_REGISTRY,
  ViewRecipeSchema,
  baseScenarioOf,
  displayScenarioId,
  getScenarioEntry,
  isAnyScenarioId,
  isScenarioId,
  isTenantId,
  type ComponentType,
  type RouterTelemetry,
  type ScenarioId,
  type ScenarioListItem,
  type WorkbenchScenarioId,
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
import { runCanaryConvergence } from "./local/canary-convergence.ts";
import { asrBlastRadius, buildDeviceHealthScripts, getCspMetadata, verifyProactiveRemediation } from "./local/intune-remediation.ts";
import { reconcileCommercial, reverseCompile } from "./local/commercial-reconciler.ts";
import { immunizeFleet, stageFleetCampaign } from "./local/fleet-immunizer.ts";
import { buildInverseRollback, counterfactualReplay, verifyFormalInvariants, verifyIdempotency } from "./local/formal-verifier.ts";
import { generateRunbook } from "./local/runbook.ts";
import { OPEN_WEIGHT_INFERENCE_CONFIG } from "./router/glimmer-payload.ts";
import { compileSkill, listCompiledSkills, lookupTier0Skill } from "./local/skill-compiler.ts";
import { getTimeline } from "./local/timeline.ts";
import { RecipeNotFoundError, hydrateRecipe } from "./tiers/tier0-recipe.ts";
import { exploreSelection } from "./tiers/explore.ts";
import { SAMPLE_UNSCRIPTED_TICKETS, clearCustomTickets, customScenarioListItem, getCustomScenario, listCustomScenarios, loadCustomScenarios, refineCustomTicketGoal, registerCustomTicket, triageCustomTicketAsync } from "./local/custom-ticket.ts";
import { clearSynthesizedElements, loadDynamicCatalog, loadSynthesizedElementsLog } from "./local/dynamic-catalog.ts";
import { correlateUpstreamCloudStatus } from "./local/cloud-status-correlator.ts";
import { generateClarifyingQuestions } from "./local/subagent-orchestrator.ts";
import { DROP_ARCHETYPES } from "./local/erp-drop-generator.ts";
import { getInboxDir, listInbox, resolveAttachmentPath, scanInbox, simulateDrop, visionTriageDrop } from "./local/erp-inbox.ts";
import { ERP_TICKETS } from "@contextpane/mcp-erp";
import { buildResolutionNote } from "./local/psa-note.ts";
import { closureStore } from "./store/closure.ts";
import { buildBriefHovers, hover, warmHoverCache } from "./tiers/tier1-hover.ts";
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

loadCustomScenarios();

const TenantIdSchema = z.string().refine(isTenantId, { message: `tenantId must be one of ${Object.keys(TENANT_REGISTRY).join(", ")}` });
/** A built-in scenario, or an unscripted CUSTOM-<hash> ticket registered through POST /api/tickets/triage-custom. */
const ScenarioIdSchema = z.string().refine(isAnyScenarioId, { message: `scenarioId must be one of ${SCENARIO_IDS.join(", ")} or a registered CUSTOM-<hash> ticket` });
/** Endpoints whose model is keyed by the built-in scenario only (prover, timeline, skills, runbooks): a custom ticket maps to its base. */
const BaseScenarioIdSchema = ScenarioIdSchema.transform((id) => baseScenarioOf(id));

/** Every scenario endpoint takes scenarioId; an older tenantId selects that tenant's ticket scenario. */
function scenarioOf(body: { scenarioId?: string; tenantId?: string }): WorkbenchScenarioId {
  return body.scenarioId ? (ScenarioIdSchema.parse(body.scenarioId) as WorkbenchScenarioId) : resolveScenarioId(body.tenantId ? TenantIdSchema.parse(body.tenantId) : "INC-4092");
}

function tenantOf(scenarioId: string): string {
  return getScenarioEntry(scenarioId)?.tenantId ?? SCENARIO_REGISTRY[baseScenarioOf(scenarioId)].tenantId;
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
    openWeightInference: { ...OPEN_WEIGHT_INFERENCE_CONFIG, hoverTiers: [...config.openWeightTiers], maxContainers: 1 },
  });
});

app.get("/api/config", (c) => c.json(describeConfig()));
app.get("/api/mcp/status", async (c) => c.json(await sources.status()));

/* -------------------------------- scenarios -------------------------------- */

app.get("/api/tenants", (c) => c.json({ tenants: Object.values(TENANT_REGISTRY) }));

/** When each built-in anomaly was detected (mirrors anomalyBody in local/brief.ts); tickets carry openedAt in the ERP. */
const ANOMALY_DETECTED_AT: Record<string, string> = { "ANOM-LIC-101": "2026-10-26T06:05:00Z", "ANOM-CA-204": "2026-10-26T06:00:00Z", "ANOM-APP-401": "2026-10-26T06:10:00Z", "ANOM-INT-309": "2026-10-26T05:40:00Z" };

/**
 * The unified work queue: PSA tickets, live Graph anomalies, ERP file drops and pasted tickets are
 * one stream, differentiated by `origin`; resolved = approved since the last drift reset.
 */
app.get("/api/scenarios", (c) => {
  const scenarios: ScenarioListItem[] = SCENARIO_IDS.map((scenarioId) => {
    const entry = SCENARIO_REGISTRY[scenarioId];
    return {
      scenarioId,
      kind: entry.kind,
      origin: entry.kind === "ticket" ? "psa" : "anomaly",
      displayId: displayScenarioId(scenarioId),
      tenantId: entry.tenantId,
      tenantName: TENANT_REGISTRY[entry.tenantId].displayName,
      title: entry.title,
      resolved: Boolean(convergenceStore.get(scenarioId)),
      createdAt: ERP_TICKETS[scenarioId]?.openedAt ?? ANOMALY_DETECTED_AT[scenarioId] ?? "2026-10-26T06:00:00Z",
    };
  });
  for (const custom of listCustomScenarios()) scenarios.push(customScenarioListItem(custom, Boolean(convergenceStore.get(custom.scenarioId))));
  return c.json({ scenarios });
});

/** Left pane: summary & resolution plan, MCP-enriched entities by provenance colour, ticket or anomaly text. */
app.get("/api/scenarios/:scenarioId/brief", async (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const ctx = await gatherContext(scenarioId, { fresh: wantsRefresh(c) });
  const brief = buildScenarioBrief(ctx);
  const hovers = buildBriefHovers(ctx, brief.entities);
  return c.json({ brief, hovers, gatherLatencyMs: ctx.gatherLatencyMs, transport: ctx.transport, fallbackReasons: ctx.fallbackReasons });
});

/** The ptr:// data plane: a scenario's dataset descriptors (what the model sees), and one pointer's rows. */
app.get("/api/dataplane/:scenarioId", async (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const snapshot = publishDataPlane(await gatherContext(scenarioId));
  return c.json({
    scenarioId,
    tenantId: snapshot.tenantId,
    epoch: snapshot.epoch,
    generation: snapshot.generation,
    fence: { tenantId: snapshot.tenantId, epoch: snapshot.epoch, generation: snapshot.generation },
    columnarScanNs: snapshot.columnarScanNs,
    gatheredAt: snapshot.gatheredAt,
    bytes: snapshot.bytes,
    datasets: snapshot.descriptors,
    piiMetrics: snapshot.piiMetrics,
    vaultMetrics: snapshot.piiMetrics,
    pii: snapshot.piiMetrics,
    evidenceGraph: snapshot.evidenceGraph,
    informationBottleneck: snapshot.informationBottleneck,
  });
});

/* ------------- Live agency: highlight → Generate Context UI, unscripted tickets ------------- */

const ExploreBodySchema = z.object({
  scenarioId: z.string().optional(),
  tenantId: z.string().optional(),
  selectedText: z.string().min(SELECTION_MIN_CHARS).max(SELECTION_MAX_CHARS * 2),
  refinementText: z.string().max(SELECTION_MAX_CHARS * 2).optional(),
  viewMode: ContextViewModeSchema.optional(),
  customTicketText: z.string().max(8000).optional(),
});

/**
 * Highlight any phrase in the ticket or anomaly text: the matching slice of live tenant data
 * is published under ptr://<scenario>/selection/<hash> and composed into a ContextualMiniDashboard
 * (muse-spark-1.3, deterministic fallback). Rows stay on the data plane; the prompt sees the descriptor.
 */
app.post("/api/explore-selection", async (c) => {
  const body = ExploreBodySchema.parse(await c.req.json());
  const result = await exploreSelection({
    scenarioId: scenarioOf(body),
    selectedText: body.selectedText,
    ...(body.refinementText ? { refinementText: body.refinementText } : {}),
    ...(body.viewMode ? { viewMode: body.viewMode } : {}),
    ...(body.customTicketText ? { customTicketText: body.customTicketText } : {}),
  });
  return c.json(result);
});

const TriageBodySchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(8000),
  customerName: z.string().max(80).optional(),
  clarifiedAnswers: z.record(z.string(), z.string()).optional(),
});

/**
 * Unscripted ticket triage: entity & intent extraction over the pasted text, matched against the live
 * tenant objects, a CUSTOM-<hash> scenario registered with ptr://custom-<hash>/... pointers, its brief,
 * its bi-temporal timeline (inherited) and the formal invariants of the pattern it inherits.
 */
app.post("/api/tickets/triage-custom", async (c) => {
  const started = performance.now();
  const body = TriageBodySchema.parse(await c.req.json());
  const entry = await triageCustomTicketAsync(body);
  invalidateContext(entry.scenarioId);
  const ctx = await gatherContext(entry.scenarioId, { fresh: true });
  const brief = buildScenarioBrief(ctx);
  const snapshot = publishDataPlane(ctx);
  const formal = verifyFormalInvariants(entry.baseScenarioId);
  const idempotency = verifyIdempotency(entry.baseScenarioId);
  const timeline = getTimeline(entry.baseScenarioId);
  const latencyMs = Math.round(performance.now() - started);
  const hasSynthesized = Boolean(entry.elementRouting && entry.elementRouting.missingElements.length > 0);
  const event = telemetry.record({
    requestId: telemetry.nextRequestId("t0"),
    endpoint: "/api/tickets/triage-custom",
    tier: hasSynthesized ? "Tier 2" : "Tier 0",
    provider: hasSynthesized && providers.meta.hasKey && !config.forceLocal ? "meta" : "local",
    modelId: hasSynthesized ? "muse-spark-1.3 -> muse-wonder-1.0" : "deterministic-entity-extractor",
    latencyMs,
    tokensUsed: { ...ZERO_USAGE },
    fallbackChain: [],
    tenantId: entry.tenantId,
    estimatedSavings: { tokens: 1800, ms: 4000, versus: "model-based ticket classification" },
  });
  return c.json(
    {
      scenario: customScenarioListItem(entry, false),
      brief,
      extraction: entry.extraction,
      elementRouting: entry.elementRouting ?? null,
      synthesizedElements: entry.synthesizedElements ?? [],
      cloudStatusCorrelation: entry.cloudStatusCorrelation ?? null,
      clarifyingQuestions: entry.clarifyingQuestions ?? [],
      clarifiedAnswers: entry.clarifiedAnswers ?? {},
      subAgentTasks: entry.subAgentTasks ?? [],
      dataPtrs: snapshot.descriptors.map((d) => d.ptr),
      dataPlane: { datasets: snapshot.descriptors.length, bytes: snapshot.bytes, piiMetrics: snapshot.piiMetrics },
      verification: {
        formal: { passed: formal.passed, invariants: formal.invariants.length, ids: formal.invariants.map((i) => i.id), latencyMs: formal.latencyMs },
        idempotency: { passed: idempotency.passed },
        baseScenarioId: entry.baseScenarioId,
      },
      timelineSlices: timeline?.slices.length ?? 0,
      latencyMs,
      telemetry: event,
    },
    201,
  );
});

const ClarifyQuestionsBodySchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(5).max(8000),
  clarifiedAnswers: z.record(z.string(), z.string()).optional(),
});

app.post("/api/tickets/clarify-questions", async (c) => {
  const body = ClarifyQuestionsBodySchema.parse(await c.req.json());
  const result = await generateClarifyingQuestions(body);
  return c.json(result);
});

app.post("/api/tickets/clarifying-questions", async (c) => {
  const body = ClarifyQuestionsBodySchema.parse(await c.req.json());
  const result = await generateClarifyingQuestions(body);
  return c.json(result);
});

const RefineGoalBodySchema = z.object({
  clarifiedAnswers: z.record(z.string(), z.string()),
});

app.post("/api/tickets/:scenarioId/refine-goal", async (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const body = RefineGoalBodySchema.parse(await c.req.json());
  const updated = await refineCustomTicketGoal(scenarioId, body.clarifiedAnswers);
  if (!updated) {
    return c.json({ error: `${scenarioId} is not a custom ticket/project` }, 404);
  }
  remediationStore.clear(scenarioId);
  invalidateContext(scenarioId);
  const ctx = await gatherContext(scenarioId, { fresh: true });
  const brief = buildScenarioBrief(ctx);
  return c.json({
    ok: true,
    scenario: customScenarioListItem(updated, Boolean(convergenceStore.get(scenarioId))),
    brief,
    clarifyingQuestions: updated.clarifyingQuestions ?? [],
    clarifiedAnswers: updated.clarifiedAnswers ?? {},
    subAgentTasks: updated.subAgentTasks ?? [],
    synthesizedElements: updated.synthesizedElements ?? [],
    customRemediation: updated.customRemediation ?? null,
  });
});

app.get("/api/dynamic-catalog", (c) => {
  const catalog = loadDynamicCatalog();
  const auditLog = loadSynthesizedElementsLog();
  return c.json({
    catalog,
    dynamicCount: catalog.dynamicElements.length,
    builtInCount: catalog.builtInElements.length,
    auditLog,
  });
});

app.post("/api/dynamic-catalog/clear", (c) => {
  const res = clearSynthesizedElements();
  const catalog = loadDynamicCatalog();
  const auditLog = loadSynthesizedElementsLog();
  return c.json({
    ok: true,
    ...res,
    catalog,
    dynamicCount: catalog.dynamicElements.length,
    auditLog,
  });
});

app.post("/api/cloud-status/correlate", async (c) => {
  const body = z
    .object({
      ticketText: z.string().min(3),
      createdAt: z.string().optional(),
    })
    .parse(await c.req.json());
  const correlation = await correlateUpstreamCloudStatus(body);
  return c.json(correlation);
});

app.get("/api/tickets/samples", (c) => c.json({ samples: SAMPLE_UNSCRIPTED_TICKETS }));

/* ---------------- Live ERP inbox: input/tickets/#<id>/ticketbody.json + images ---------------- */

/** What the watcher ingested from input/tickets/, newest first; ?scan=1 forces a scan before answering. */
app.get("/api/tickets/inbox", (c) => {
  const scan = /^(1|true)$/i.test(c.req.query("scan") ?? "") ? scanInbox() : null;
  return c.json({ dir: getInboxDir(), items: listInbox(), ...(scan ? { scan: { folders: scan.folders, ingested: scan.ingested.map((r) => r.item.scenarioId), removed: scan.removed } } : {}), scannedAt: new Date().toISOString() });
});

/** The image next to a dropped ticket, by its URL-encoded folder (`%232026323`) and file name. */
app.get("/api/tickets/inbox-attachment/:folder/:file", (c) => {
  const folder = decodeURIComponent(c.req.param("folder"));
  const file = decodeURIComponent(c.req.param("file"));
  const path = resolveAttachmentPath(folder, file);
  if (!path) return c.json({ error: `no such attachment ${folder}/${file}` }, 404);
  const ext = file.split(".").pop()!.toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return new Response(Bun.file(path), { headers: { "content-type": type, "cache-control": "no-store", "content-disposition": `inline; filename="${file}"` } });
});

const SimulateDropSchema = z.object({
  archetype: z.enum([...DROP_ARCHETYPES, "Random"]).optional(),
  ticketId: z.string().max(24).regex(/^#?[A-Za-z0-9]{3,16}$/).optional(),
  seed: z.number().int().nonnegative().optional(),
});

/**
 * `[🎲 Drop Random ERP Ticket]`: writes a fresh `#2026xxx/ticketbody.json` + `attachment1.png` into
 * input/tickets/ and lets the very same watcher scan ingest it, exactly like a folder dropped in Explorer.
 */
app.post("/api/tickets/simulate-drop", async (c) => {
  const started = performance.now();
  const body = SimulateDropSchema.parse(await c.req.json().catch(() => ({})));
  const drop = simulateDrop(body);
  if (!drop.ingest) return c.json({ error: `${drop.folder} was written but not ingested`, drop }, 500);
  const ctx = await gatherContext(drop.scenarioId, { fresh: true });
  const brief = buildScenarioBrief(ctx);
  return c.json(
    {
      folder: drop.folder,
      displayId: drop.displayId,
      scenarioId: drop.scenarioId,
      archetype: drop.archetype,
      files: drop.files,
      dir: drop.dir,
      scenario: drop.ingest.item,
      attachments: drop.ingest.entry.erpDrop?.attachments ?? [],
      extraction: drop.ingest.entry.extraction,
      brief,
      latencyMs: Math.round(performance.now() - started),
      telemetry: telemetry.recent(1).at(-1) ?? null,
    },
    201,
  );
});

const VisionTriageSchema = z.object({ scenarioId: z.string(), fileName: z.string().max(200).optional() });

/** `[Extract Telemetry via Muse Vision]` on a dropped ticket: the orchestrator reads the file from input/tickets/ itself. */
app.post("/api/vision/triage", async (c) => {
  const body = VisionTriageSchema.parse(await c.req.json());
  const entry = getCustomScenario(ScenarioIdSchema.parse(body.scenarioId));
  if (!entry?.erpDrop) return c.json({ error: `${body.scenarioId} is not an ERP file drop` }, 404);
  const result = await visionTriageDrop(entry, body.fileName);
  return c.json(result);
});

app.get("/api/tickets/:scenarioId", (c) => {
  const custom = getCustomScenario(c.req.param("scenarioId"));
  return custom ? c.json({ scenario: customScenarioListItem(custom, Boolean(convergenceStore.get(custom.scenarioId))) }) : c.json({ error: "not an unscripted ticket" }, 404);
});

/** The auto-drafted Customer & PSA Resolution Note of a converged scenario. */
app.get("/api/tickets/:scenarioId/resolution-note", async (c) => {
  const scenarioId = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const convergence = convergenceStore.get(scenarioId);
  if (!convergence) return c.json({ error: `${scenarioId} has not converged; approve a remediation first`, note: null }, 409);
  const brief = buildScenarioBrief(await gatherContext(scenarioId));
  return c.json({ note: buildResolutionNote({ brief, convergence }) });
});

const CloseBodySchema = z.object({ scenarioId: z.string().optional(), tenantId: z.string().optional(), closedBy: z.string().max(120).optional() });

/** Mark the ticket closed in the PSA: logs ticket.closed to the audit ledger with the note attached. */
app.post("/api/tickets/close", async (c) => {
  const started = performance.now();
  const body = CloseBodySchema.parse(await c.req.json().catch(() => ({})));
  const scenarioId = scenarioOf(body);
  const convergence = convergenceStore.get(scenarioId);
  if (!convergence) return c.json({ ok: false, error: `${scenarioId} has not converged; approve a remediation first` }, 409);
  const closedBy = body.closedBy ?? config.lab.delegatedIdentity;
  closureStore.close(scenarioId, closedBy);
  const brief = buildScenarioBrief(await gatherContext(scenarioId));
  const note = buildResolutionNote({ brief, convergence });
  const entry = auditLedger.append({
    tenantId: tenantOf(scenarioId),
    ticketId: scenarioId,
    actionType: "ticket-closed",
    delegatedIdentity: closedBy,
    modalSandboxVerified: false,
    astPass: null,
    tfValidatePass: null,
    gitBranch: convergence.gitBranch,
    prUrl: convergence.prUrl,
    latencyMs: Math.round(performance.now() - started),
    execution: "none",
    detail: `ticket.closed · PSA resolution note attached (${note.technicalAuditTrail.length} audit lines) · ${convergence.execution} · remediation ${convergence.remediationId}`.slice(0, 300),
  });
  return c.json({ ok: true, note, audit: entry });
});

const ReopenBodySchema = z.object({ scenarioId: z.string().optional(), tenantId: z.string().optional(), reopenedBy: z.string().max(120).optional() });

/**
 * Reopens a resolved or closed ticket so it can be remediated again: clears the closure and the
 * convergence. The lab objects stay as the approval left them; a drift reset restores those.
 */
app.post("/api/tickets/reopen", async (c) => {
  const body = ReopenBodySchema.parse(await c.req.json().catch(() => ({})));
  const scenarioId = scenarioOf(body);
  const tenantId = tenantOf(scenarioId);
  const closed = closureStore.closedState(scenarioId);
  const convergence = convergenceStore.get(scenarioId);
  if (!closed && !convergence) return c.json({ ok: false, error: `${scenarioId} is not resolved; nothing to reopen` }, 409);
  closureStore.clear(scenarioId);
  convergenceStore.clear(scenarioId, tenantId);
  invalidateContext(scenarioId);
  const entry = auditLedger.append({
    tenantId,
    ticketId: scenarioId,
    actionType: "ticket-reopened",
    delegatedIdentity: body.reopenedBy ?? config.lab.delegatedIdentity,
    modalSandboxVerified: false,
    astPass: null,
    tfValidatePass: null,
    gitBranch: convergence?.gitBranch ?? null,
    prUrl: convergence?.prUrl ?? null,
    latencyMs: 0,
    execution: "none",
    detail: `ticket.reopened${closed ? ` (closed ${closed.closedAt} by ${closed.closedBy})` : ""} · lab objects left as remediated; reset drift to restore the drifted state`.slice(0, 300),
  });
  return c.json({ ok: true, scenarioId, audit: entry });
});

/* -------- Day-2: formal prover, rollback, timeline, skill compiler -------- */

app.get("/api/formal/:scenarioId", (c) => {
  const requested = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const scenarioId = baseScenarioOf(requested);
  const formal = verifyFormalInvariants(scenarioId);
  return c.json({ scenarioId: requested, baseScenarioId: scenarioId, formal, blastRadius: counterfactualReplay(scenarioId), rollback: buildInverseRollback(scenarioId), idempotency: verifyIdempotency(scenarioId), asrBlast: scenarioId === "ANOM-INT-309" ? asrBlastRadius() : null, telemetry: { tier: "Tier 3C", tokensUsed: { total: 0 }, latencyMs: formal.latencyMs } });
});

app.post("/api/rollback", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scenarioId?: string };
  const scenarioId = baseScenarioOf(scenarioOf(body));
  const started = performance.now();
  const rollback = buildInverseRollback(scenarioId);
  const check = verifyIdempotency(scenarioId);
  if (!check.passed) return c.json({ ok: false, error: "inverse rollback idempotency check failed", rollback }, 422);
  return c.json({ ok: true, executed: "simulated", latencyMs: Math.round((performance.now() - started) * 10) / 10, rollback, idempotency: check });
});

app.get("/api/intune/health-script/:scenarioId", (c) => {
  const scenarioId = BaseScenarioIdSchema.parse(c.req.param("scenarioId"));
  const scripts = buildDeviceHealthScripts(scenarioId);
  return c.json({ scenarioId, detect: scripts.detect, remediate: scripts.remediate, verification: verifyProactiveRemediation(scenarioId), csp: getCspMetadata(scenarioId), asrBlast: scenarioId === "ANOM-INT-309" ? asrBlastRadius() : null });
});

app.get("/api/timeline/:scenarioId", (c) => {
  const requested = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const base = getTimeline(baseScenarioOf(requested));
  if (!base) return c.json({ error: "unknown scenario" }, 404);
  // A custom ticket inherits the base scenario's bi-temporal slices under its own id.
  const timeline = requested === base.scenarioId ? base : { ...base, scenarioId: requested, title: getScenarioEntry(requested)?.title ?? base.title, slices: base.slices.map((s) => ({ ...s, scenarioId: requested as ScenarioId, id: s.id.replace(base.scenarioId.toLowerCase(), requested.toLowerCase()) })) };
  return c.json({ timeline, telemetry: { tier: "Tier 0", tokensUsed: { total: 0 }, latencyMs: 0 } });
});

const CompileBodySchema = z.object({ scenarioId: z.string().optional(), tenantId: z.string().optional() });
const skillDef = (s: ReturnType<typeof listCompiledSkills>[number]) => ({ id: s.id, scenarioId: s.scenarioId, signature: s.signature, tier: s.tier, tokenCost: s.tokenCost, latencyMs: s.latencyMs, fuzz: s.fuzz, createdAt: s.createdAt, version: s.version, badge: `Tier 0 Compiled Skill (${s.fuzz.passed}/${s.fuzz.cases} fuzz verified)` });

app.get("/api/skills", (c) => c.json({ skills: listCompiledSkills().map(skillDef), file: "data/compiled-skills.json" }));

app.post("/api/skills/compile", async (c) => {
  const body = CompileBodySchema.parse(await c.req.json().catch(() => ({})));
  const scenarioId = baseScenarioOf(scenarioOf(body));
  const skill = await compileSkill(scenarioId);
  return c.json({ skill: skillDef(skill), promoted: skill.fuzz.passed === skill.fuzz.cases, telemetry: { tier: "Tier 0", tokensUsed: { total: 0 }, latencyMs: skill.latencyMs } }, 201);
});

app.get("/api/skills/match/:scenarioId", (c) => {
  const scenarioId = BaseScenarioIdSchema.parse(c.req.param("scenarioId"));
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

/** A converged or PSA-closed ticket refuses another remediation until it is reopened or its drift is reset. */
function resolvedConflict(scenarioId: string): string | null {
  if (closureStore.closedState(scenarioId)) return "Ticket is already resolved and closed. Reopen or reset drift before running remediation again.";
  if (convergenceStore.get(scenarioId)) return "Ticket is already resolved and verified. Reopen or reset drift before running remediation again.";
  return null;
}

app.post("/api/remediate", async (c) => {
  const parsed = RemediateBodySchema.parse(await c.req.json().catch(() => ({})));
  const body = { scenarioId: scenarioOf(parsed), ...(parsed.fresh !== undefined ? { fresh: parsed.fresh } : {}) };
  const conflict = resolvedConflict(body.scenarioId);
  if (conflict) return c.json({ error: conflict, scenarioId: body.scenarioId }, 409);
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
  simulateCanaryFailure: z.boolean().optional(),
});

/**
 * HITL approval. break-glass: live Graph/ARM writes in LIVE_CLOUD_MODE, a reconcile commit on the
 * fix branch, then a zero-token canvas convergence push. gitops: no live write, a fresh pre-flight,
 * nothing converges. Either way a PR is opened only when openPullRequest is true.
 */
const approveHandler = async (c: Context) => {
  const body = ApproveBodySchema.parse(await c.req.json());
  const pending = remediationStore.get(body.remediationId);
  const conflict = body.decision !== "reject" && pending ? resolvedConflict(pending.ticketId) : null;
  if (conflict) return c.json({ error: conflict, scenarioId: pending!.ticketId }, 409);
  if (pending && body.decision !== "reject") {
    try {
      const preCtx = await gatherContext(pending.ticketId);
      closureStore.setBriefSnapshot(pending.ticketId, buildScenarioBrief(preCtx));
    } catch {
      /* non-fatal if context gather fails */
    }
  }
  const { convergence, ...drawer } = await approve(body);
  if (body.decision === "reject" || drawer.approval.state === "rejected") return c.json({ drawer, convergence, canary: null });
  const scenarioId = drawer.ticketId;
  const liveWriteApplied = drawer.approval.state === "executed";
  // Only an "executed" approval wrote to the live tenant; when simulateCanaryFailure triggers AUTO_ROLLED_BACK, execute f^-1 immediately.
  const canary = {
    ...runCanaryConvergence(baseScenarioOf(scenarioId), {
      mode: body.mode ?? "break-glass",
      simulateCanaryFailure: body.simulateCanaryFailure ?? false,
      liveWriteApplied,
      rollbackExecuted: Boolean(body.simulateCanaryFailure),
    }),
    scenarioId: scenarioId as ScenarioId,
  };
  closureStore.setCanary(scenarioId, canary);
  if (canary.finalState === "AUTO_ROLLED_BACK") {
    convergenceStore.clear(scenarioId, drawer.tenantId);
    const revertWrite = liveWriteApplied ? await applyScenarioState(baseScenarioOf(scenarioId), "drifted") : null;
    invalidateContext(scenarioId);
    const rollbackLog = revertWrite
      ? `Inverse rollback f⁻¹ executed (${revertWrite.source}, ${revertWrite.latencyMs} ms): ${revertWrite.summary}`
      : "Inverse rollback f⁻¹ executed: in-memory state reverted to pre-change baseline";
    const rolledBackDrawer = {
      ...drawer,
      approval: { ...drawer.approval, state: "rolled-back" as const },
      executionLog: [
        ...drawer.executionLog,
        "Synthetic probe failed in Canary Ring 0: AADSTS53003 spike detected — dead-man's switch triggered",
        rollbackLog,
      ],
    };
    const { executionLog: _log, ...toSave } = rolledBackDrawer;
    remediationStore.save(toSave);
    const rolledBack = canary.stages.find((s) => s.stage === "AUTO_ROLLED_BACK");
    const rollbackExecution =
      revertWrite?.source === "live-graph" ? "live-graph-and-arm-reverted" : "in-memory-state-reverted";
    const rollbackLatencyMs = revertWrite ? Math.max(1, Math.round(revertWrite.latencyMs)) : 12;
    auditLedger.append({
      tenantId: drawer.tenantId,
      ticketId: drawer.ticketId,
      actionType: "autonomous-rollback",
      delegatedIdentity: body.approvedBy ?? drawer.approval.requiredIdentity,
      modalSandboxVerified: false,
      astPass: null,
      tfValidatePass: null,
      gitBranch: drawer.staging?.branchName ?? null,
      prUrl: null,
      latencyMs: rollbackLatencyMs,
      execution: rollbackExecution,
      detail: `Simulated AADSTS53003 spike in Canary Ring 0 · ${rolledBack?.detail ?? "dead-man's switch fired"}`,
    });
    return c.json({ drawer: rolledBackDrawer, convergence: null, canary });
  }
  return c.json({ drawer, convergence, canary });
};

/* --------------------- Day-2 Places 5-8: reconcile / iac / fleet / runbook --------------------- */

app.get("/api/reconcile/commercial/:scenarioId", (c) => {
  const scenarioId = baseScenarioOf(ScenarioIdSchema.parse(c.req.param("scenarioId")));
  return c.json({ reconciliation: reconcileCommercial(scenarioId) });
});

app.post("/api/iac/reverse-compile", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scenarioId?: string };
  return c.json({ result: reverseCompile(baseScenarioOf(scenarioOf(body))) });
});

app.get("/api/fleet/immunize/:scenarioId", (c) => {
  const scenarioId = baseScenarioOf(ScenarioIdSchema.parse(c.req.param("scenarioId")));
  return c.json({ fleet: immunizeFleet(scenarioId) });
});

app.post("/api/fleet/campaign/:scenarioId", (c) => {
  const requested = ScenarioIdSchema.parse(c.req.param("scenarioId"));
  const scenarioId = baseScenarioOf(requested);
  const campaign = stageFleetCampaign(scenarioId);
  const fleet = immunizeFleet(scenarioId);
  auditLedger.append({ tenantId: tenantOf(requested), ticketId: requested, actionType: "fleet-campaign", delegatedIdentity: "contextpane-fleet", modalSandboxVerified: true, astPass: true, tfValidatePass: null, gitBranch: campaign.branches[0]?.branch ?? null, prUrl: null, latencyMs: Math.round(campaign.latencyMs), execution: "none", detail: `Fleet GitOps campaign staged for ${campaign.branches.length} tenants (${fleet.signature})` });
  return c.json({ campaign, fleet });
});

app.get("/api/runbooks/:file", (c) => {
  const file = c.req.param("file");
  const scenarioId = baseScenarioOf(ScenarioIdSchema.parse(file.replace(/\.md$/, "")));
  return c.text(generateRunbook(scenarioId), 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${scenarioId}-runbook.md"` });
});
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
  const scenarioIds: WorkbenchScenarioId[] = body.scenarioId || body.tenantId ? [scenarioOf(body)] : [...SCENARIO_IDS, ...listCustomScenarios().map((s) => s.scenarioId)];
  const results = await Promise.all(
    scenarioIds.map(async (scenarioId) => {
      const tenantId = tenantOf(scenarioId);
      // The canvas reverts on this push at once; the Graph writes land behind it.
      convergenceStore.clear(scenarioId, tenantId);
      closureStore.clear(scenarioId);
      remediationStore.clear(scenarioId);
      // A custom ticket's lab objects are those of its base pattern; a full reset already restored them.
      const write = isScenarioId(scenarioId) || body.scenarioId || body.tenantId ? await applyScenarioState(baseScenarioOf(scenarioId), "drifted") : { source: "simulated" as const, latencyMs: 0, results: [], summary: "custom ticket cleared (base pattern reset separately)" };
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
  if (!body.scenarioId && !body.tenantId) {
    clearCustomTickets();
    scanInbox();
  }
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
      "POST /api/explore-selection · POST /api/tickets/triage-custom · GET /api/tickets/samples",
      "GET  /api/tickets/inbox · GET /api/tickets/inbox-attachment/:folder/:file · POST /api/tickets/simulate-drop · POST /api/vision/triage",
      "GET  /api/tickets/:scenarioId/resolution-note · POST /api/tickets/close · POST /api/tickets/reopen",
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
