import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HoverDiagnosticArgsSchema,
  HoverDiagnosticPopoverSchema,
  QuickActionKindSchema,
  formatIssues,
  getHoverDiagnosticToolDefinition,
  parseToolArguments,
  type EntityType,
  type HoverDiagnosticArgs,
  type HoverDiagnosticPopover,
  type RouterTelemetry,
  baseScenarioOf,
} from "@contextpane/catalog";
import { config, models, providerFor, providers } from "../config.ts";
import { scenarioEntities } from "../local/brief.ts";
import { buildHoverDiagnostic, inferEntityType } from "../local/hover.ts";
import { gatherContext, resolveScenarioId, type CorrelationContext } from "../mcp/context.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";

export interface HoverInput {
  /** Scenario id (INC-4092, ANOM-CA-204, ...); a tenant id selects its ticket scenario. */
  scenarioId: string;
  entityId: string;
  entityType?: EntityType;
  /** Bypass the hover cache and refresh the MCP context. */
  fresh?: boolean;
  /** Budget for the open-weight step (the background pre-warm allows for a cold GPU). */
  openWeightTimeoutMs?: number;
}

export interface HoverResult {
  popover: HoverDiagnosticPopover;
  telemetry: RouterTelemetry;
}

// Measured on the Meta API: this wording drew ~100 fewer reasoning tokens than an explicit "refine" instruction.
const SYSTEM_PROMPT = `You are ContextPane's inline diagnostic engine for Microsoft 365 / Entra ID / Azure escalations at a managed service provider.
You receive one hovered entity plus verified context. A deterministic diagnostic is included as ground truth.
Rules: respond only through emit_hover_diagnostic; use only facts present in the context; the headline is one line an MSP engineer can act on, naming the blocking policy, the license gap or the drifted setting.`;

/**
 * The Tier 1A chain. The open-weight GPU is scale-to-zero: it is only ever woken by an
 * explicit refresh (?refresh=true), never by a cache miss, so a new scenario's pills are
 * answered by the hosted Meta step and the L40S stays asleep.
 */
function chainSteps(options: { wakeGpu?: boolean } = {}): ChainStep[] {
  return [
    { provider: providers.openWeight.id, modelId: models.openWeightGlimmer, hasKey: providers.openWeight.hasKey && config.openWeightTiers.has("hover") && options.wakeGpu === true },
    { provider: "fireworks", modelId: models.fireworksGlimmer, hasKey: providers.fireworks.hasKey },
    { provider: "baseten", modelId: models.basetenGlimmer, hasKey: providers.baseten.hasKey },
    { provider: "meta", modelId: models.metaHover, hasKey: providers.meta.hasKey },
  ];
}

/* ------------------------------ hover cache -------------------------------- */

/** One model answer, kept with the telemetry of the call that produced it. */
interface CachedHover {
  generatedAt: string;
  provider: RouterTelemetry["provider"];
  modelId: string;
  /** Wall time of the winning provider call. */
  latencyMs: number;
  tokensUsed: TokenUsage;
  args: HoverDiagnosticArgs;
}

/**
 * Model answers per (tenant, entity), persisted to data/hover-cache.json so a restart
 * serves every pill from disk instead of waking the scale-to-zero GPU again. An entry is
 * reused while it comes from the preferred (first configured) provider; ?refresh=true
 * regenerates it. A fresh clone has no cache file yet and starts from the tracked
 * data/hover-cache.seed.json: genuine Muse Glimmer 30B answers from the Modal L40S.
 */
const HOVER_CACHE_FILE = join(config.dataDir, "hover-cache.json");
const HOVER_SEED_FILE = join(config.dataDir, "hover-cache.seed.json");
const hoverKey = (scope: string, entityId: string) => `${scope}|${entityId.toLowerCase()}`;

/**
 * Cache scope of a scenario. INC-4092 keeps its tenant id, so the tracked Glimmer answers
 * in data/hover-cache.seed.json stay valid; every other scenario has its own scope.
 */
export function hoverScope(scenarioId: string): string {
  // An unscripted ticket reuses the cached answers of the built-in scenario it inherits.
  const base = baseScenarioOf(scenarioId);
  return base === "INC-4092" ? "tenant-contoso-01" : base;
}
/** Set when data/hover-cache.json was created from the seed at this start-up. */
export let hoverCacheSeeded = false;
const hoverCache = loadHoverCache();
/** Entries read from data/hover-cache.json at start-up. */
export const persistedHoverCount = hoverCache.size;

function loadHoverCache(): Map<string, CachedHover> {
  if (!existsSync(HOVER_CACHE_FILE) && existsSync(HOVER_SEED_FILE)) {
    try {
      mkdirSync(config.dataDir, { recursive: true });
      copyFileSync(HOVER_SEED_FILE, HOVER_CACHE_FILE);
      hoverCacheSeeded = true;
    } catch (error) {
      console.warn(`  [hover] could not seed ${HOVER_CACHE_FILE}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!existsSync(HOVER_CACHE_FILE)) return new Map();
  try {
    const file = JSON.parse(readFileSync(HOVER_CACHE_FILE, "utf8")) as { entries?: Record<string, CachedHover> };
    // Quick actions are always rebuilt from the scenario context, so an answer cached with a retired action kind stays usable.
    const knownKinds = new Set<string>(QuickActionKindSchema.options);
    return new Map(
      Object.entries(file.entries ?? {})
        .map(([k, e]) => [k, { ...e, args: { ...e.args, quickActions: (e.args?.quickActions ?? []).filter((a) => knownKinds.has(a.kind)) } }] as const)
        .filter(([, e]) => HoverDiagnosticArgsSchema.safeParse(e.args).success),
    );
  } catch (error) {
    console.warn(`  [hover] ignoring unreadable ${HOVER_CACHE_FILE}: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Write through a temp file, so a crash mid-write never leaves half a cache. */
function writeHoverCache(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    mkdirSync(config.dataDir, { recursive: true });
    const entries = Object.fromEntries([...hoverCache].sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(`${HOVER_CACHE_FILE}.tmp`, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
    renameSync(`${HOVER_CACHE_FILE}.tmp`, HOVER_CACHE_FILE);
  } catch (error) {
    console.warn(`  [hover] could not persist the hover cache: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Debounced, so a warm-up burst writes the file once; a pending write is flushed on exit. */
function saveHoverCache(): void {
  saveTimer ??= setTimeout(writeHoverCache, 250);
}

process.on("exit", () => {
  if (saveTimer) writeHoverCache();
});

/** The provider a cache miss is answered by (never the scale-to-zero GPU). */
function preferredProvider(): RouterTelemetry["provider"] | undefined {
  return config.forceLocal ? undefined : chainSteps().find((s) => s.hasKey)?.provider;
}

/** Any cached model answer is served (Muse Glimmer ones included without a GPU configured); ?refresh=true regenerates it. */
function cachedHover(scope: string, entityId: string): CachedHover | undefined {
  if (config.forceLocal) return undefined;
  return hoverCache.get(hoverKey(scope, entityId));
}

/**
 * Facts, quick actions, status and the error translation always come from the
 * deterministic diagnostic of the current context; the model contributes the headline,
 * and only while its verdict still matches (a remediated user gets the fresh headline).
 */
function withGroundTruth(model: HoverDiagnosticArgs, truth: HoverDiagnosticArgs): HoverDiagnosticArgs {
  return { ...truth, headline: model.status === truth.status ? model.headline : truth.headline };
}

/** Only what this entity's popover can use: the deterministic diagnostic already carries the rest. */
function hoverContext(ctx: CorrelationContext, entityId: string, entityType: EntityType) {
  const id = entityId.toLowerCase();
  const signIns = (ctx.signIns?.data ?? []).filter((e) => e.upn.toLowerCase() === id || e.errorCodeLabel?.toLowerCase() === id || e.blockingPolicyId === entityId);
  return {
    scenario: { scenarioId: ctx.scenarioId, title: ctx.erp.ticket?.title ?? ctx.scenarioId },
    user: entityType === "upn" ? (ctx.license?.data.users.find((u) => u.upn.toLowerCase() === id) ?? null) : undefined,
    groups: entityType === "upn" ? (ctx.groupsByUpn.get(id) ?? []) : undefined,
    skuPools: ctx.license?.data.skuPools,
    policies: ctx.policies?.data.map((p) => ({ id: p.id, displayName: p.displayName, state: p.state, blocks: p.blocks, includeGroupNames: p.includeGroupNames })),
    caDrift: ctx.caPosture?.data.policies.map((p) => ({ displayName: p.displayName, state: p.state, drift: p.drift })),
    intuneSettings: ctx.intune?.data.settings,
    signIns: signIns.slice(-3).map((e) => ({ at: e.timestamp, upn: e.upn, app: e.appDisplayName, status: e.status, code: e.errorCodeLabel, blockedBy: e.blockingPolicyName })),
    nsgDrift: entityType === "resource" && ctx.drift ? { summary: ctx.drift.data.summary, rogueSecurityRules: ctx.drift.data.rogueSecurityRules, tagDrift: ctx.drift.data.tagDrift } : undefined,
  };
}

/**
 * Tier 1A — inline hover. Open-weight Muse Glimmer 30B (llama-server on Modal, RunPod or locally) on an
 * explicit refresh, otherwise the Meta Model API as a first-class route; Fireworks and Baseten slot in
 * ahead of Meta only when their keys exist. Model headlines are cached per (scenario, entity) and
 * pre-fetched for every pill of the scenario (warmHoverCache); facts and actions always come from the
 * deterministic diagnostic, which also answers alone when no provider does.
 */
export async function hover(input: HoverInput): Promise<HoverResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("t1a");
  const scenarioId = resolveScenarioId(input.scenarioId);
  const scope = hoverScope(scenarioId);
  const entityType = input.entityType ?? inferEntityType(input.entityId);
  const cached = input.fresh ? undefined : cachedHover(scope, input.entityId);
  if (cached) {
    const modelId = `${cached.modelId} (cached)`;
    const ctx = await gatherContext(scenarioId);
    const latencyMs = Math.round(performance.now() - started);
    return {
      popover: HoverDiagnosticPopoverSchema.parse({
        ...withGroundTruth(cached.args, buildHoverDiagnostic(ctx, { entityId: input.entityId, entityType })),
        latencyBudgetMs: 350,
        providerTelemetry: { tier: "Tier 1A", provider: cached.provider, modelId, latencyMs, tokensUsed: 0 },
      }),
      telemetry: telemetry.record({
        requestId,
        endpoint: "/api/hover",
        tier: "Tier 1A",
        provider: cached.provider,
        modelId,
        latencyMs,
        tokensUsed: ZERO_USAGE,
        fallbackChain: [],
        tenantId: ctx.tenantId,
      }),
    };
  }
  const ctx = await gatherContext(scenarioId, { fresh: input.fresh ?? false });
  const deterministic = buildHoverDiagnostic(ctx, { entityId: input.entityId, entityType });

  let args: HoverDiagnosticArgs = deterministic;
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let chain: RouterTelemetry["fallbackChain"] = [];

  const steps = chainSteps({ wakeGpu: input.fresh === true });
  if (!config.forceLocal && steps.some((s) => s.hasKey)) {
    const tool = getHoverDiagnosticToolDefinition();
    const userPayload = {
      entity: { entityId: input.entityId, entityType },
      deterministicDiagnostic: deterministic,
      context: hoverContext(ctx, input.entityId, entityType),
    };
    const outcome = await runChain(steps, async (step) => {
      const result = await chatWithForcedTool(
        providerFor(step.provider),
        step.modelId,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        tool,
        {
          timeoutMs:
            step.provider === "meta"
              ? config.timeouts.metaHoverMs
              : step.provider === providers.openWeight.id
                ? (input.openWeightTimeoutMs ?? config.timeouts.openWeightHoverMs)
                : config.timeouts.hoverMs,
          temperature: 0,
          maxTokens: step.provider === providers.openWeight.id ? config.openWeightHoverMaxTokens : 1500,
          reasoningEffort: config.reasoning.hover,
        },
      );
      const raw = parseToolArguments(result.argumentsRaw);
      let parsed = HoverDiagnosticArgsSchema.safeParse(raw);
      // One malformed field (e.g. errorCodeTranslation sent as a string) should not cost the whole popover:
      // swap the failing top-level fields for the deterministic ones and validate again.
      if (!parsed.success && raw && typeof raw === "object") {
        const repaired: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          if (typeof key === "string") repaired[key] = (deterministic as Record<string, unknown>)[key];
        }
        parsed = HoverDiagnosticArgsSchema.safeParse(repaired);
      }
      if (!parsed.success) throw new InvalidSchemaError("hover diagnostic failed validation", formatIssues(parsed.error));
      return { args: parsed.data, usage: result.usage };
    });
    chain = outcome.chain;
    if (outcome.result && outcome.winner) {
      args = withGroundTruth({ ...outcome.result.args, entityId: input.entityId, entityType }, deterministic);
      usage = outcome.result.usage;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
      // A fallback answer (Glimmer timed out on an interactive refresh) never replaces a cached Glimmer one.
      if (provider === preferredProvider() || provider === providers.openWeight.id || !cachedHover(scope, input.entityId)) {
        hoverCache.set(hoverKey(scope, input.entityId), {
          generatedAt: new Date().toISOString(),
          provider,
          modelId,
          latencyMs: chain.at(-1)?.latencyMs ?? 0,
          tokensUsed: usage,
          args,
        });
        saveHoverCache();
      }
    }
  } else {
    chain = steps.map((s) => ({ provider: s.provider, modelId: s.modelId, outcome: config.forceLocal ? "skipped" : "no-key", latencyMs: 0 }));
  }

  const latencyMs = Math.round(performance.now() - started);
  const popover = HoverDiagnosticPopoverSchema.parse({
    ...args,
    latencyBudgetMs: 350,
    providerTelemetry: { tier: "Tier 1A", provider, modelId, latencyMs, tokensUsed: usage.total },
  });
  const event = telemetry.record({
    requestId,
    endpoint: "/api/hover",
    tier: "Tier 1A",
    provider,
    modelId,
    latencyMs,
    tokensUsed: usage,
    fallbackChain: chain,
    tenantId: ctx.tenantId,
  });
  return { popover, telemetry: event };
}

const warming = new Set<string>();
/** Shared by every tenant's pre-warm, so the GPU never sees more than this many hovers at once. */
const WARM_CONCURRENCY = 3;
let freeWarmSlots = WARM_CONCURRENCY;
const warmWaiters: Array<() => void> = [];

async function withWarmSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (freeWarmSlots > 0) freeWarmSlots--;
  else await new Promise<void>((resolve) => warmWaiters.push(resolve));
  try {
    return await fn();
  } finally {
    const next = warmWaiters.shift();
    if (next) next();
    else freeWarmSlots++;
  }
}

/** Every entity the left pane and canvas render as a hoverable pill, hero entities first. */
function hoverTargets(ctx: CorrelationContext): Array<{ entityId: string; entityType: EntityType }> {
  const all: Array<{ entityId: string; entityType: EntityType }> = [
    ...scenarioEntities(ctx)
      .filter((e) => e.hoverable)
      .map((e) => ({ entityId: e.id, entityType: e.type })),
    ...(ctx.erp.ticket?.affectedUpns ?? []).map((entityId) => ({ entityId, entityType: "upn" as const })),
    ...(ctx.license?.data.users ?? []).map((u) => ({ entityId: u.upn, entityType: "upn" as const })),
  ];
  const seen = new Set<string>();
  return all.filter((t) => t.entityId && !seen.has(t.entityId.toLowerCase()) && seen.add(t.entityId.toLowerCase()));
}

/**
 * Pre-computes instant hover popovers (<1 ms, 0 GPU calls) for every hoverable entity in a
 * ScenarioBrief so the web client never flashes skeleton bars on hover.
 */
export function buildBriefHovers(
  ctx: CorrelationContext,
  entities: Array<{ id: string; type: EntityType; hoverable?: boolean }>,
): Record<string, HoverDiagnosticPopover> {
  const scope = hoverScope(ctx.ticketId);
  const out: Record<string, HoverDiagnosticPopover> = {};
  for (const e of entities) {
    if (e.hoverable === false) continue;
    const entityType = e.type ?? inferEntityType(e.id);
    const deterministic = buildHoverDiagnostic(ctx, { entityId: e.id, entityType });
    const cached = cachedHover(scope, e.id);
    const args = cached ? withGroundTruth(cached.args, deterministic) : deterministic;
    out[e.id] = HoverDiagnosticPopoverSchema.parse({
      ...args,
      latencyBudgetMs: 350,
      providerTelemetry: {
        tier: "Tier 1A",
        provider: cached ? cached.provider : "local",
        modelId: cached ? `${cached.modelId} (cached)` : "deterministic",
        latencyMs: 1,
        tokensUsed: 0,
      },
    });
  }
  return out;
}

/**
 * Pre-fetch a headline for every hoverable pill of the scenario, hero entities first, a
 * few at a time in the background, so a hover anywhere in the workbench is served from
 * the cache. Misses go to the hosted chain: a warm-up never wakes the open-weight GPU.
 */
export async function warmHoverCache(scenarioOrTenant: string): Promise<{ warmed: number; generated: number; total: number } | undefined> {
  const scenarioId = resolveScenarioId(scenarioOrTenant);
  const scope = hoverScope(scenarioId);
  if (warming.has(scope) || !preferredProvider()) return undefined;
  warming.add(scope);
  try {
    const ctx = await gatherContext(scenarioId);
    const targets = hoverTargets(ctx);
    const missing = targets.filter((t) => !cachedHover(scope, t.entityId));
    // Second pass for answers that came back malformed.
    for (let attempt = 0; attempt < 2; attempt++) {
      await Promise.all(missing.filter((t) => !cachedHover(scope, t.entityId)).map((t) => withWarmSlot(() => hover({ scenarioId, ...t })).catch(() => undefined)));
    }
    return { warmed: targets.filter((t) => cachedHover(scope, t.entityId)).length, generated: missing.length, total: targets.length };
  } finally {
    warming.delete(scope);
  }
}
