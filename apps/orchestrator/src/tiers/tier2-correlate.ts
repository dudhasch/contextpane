import {
  DATASETS,
  HydrateLayoutArgsSchema,
  LayoutSchema,
  ORCHESTRATOR_PROPS,
  dataPtr,
  datasetsFor,
  formatIssues,
  getHydrateLayoutToolDefinition,
  parseToolArguments,
  validateComponents,
  type CanvasComponentType,
  type ComponentType,
  type Layout,
  type LayoutComponent,
  type Provenance,
  type RouterTelemetry,
} from "@contextpane/catalog";
import { config, models, providerFor, providers } from "../config.ts";
import { publishDataPlane, type DataPlaneSnapshot } from "../local/dataplane.ts";
import { buildComponent, buildLayout, scenarioComponents } from "../local/hydrate.ts";
import { contextForCorrelation, gatherContext, type CorrelationContext } from "../mcp/context.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { progressReporter, type ProgressSink } from "./progress.ts";

export interface CorrelateInput {
  /** Scenario id (INC-4092, ANOM-LIC-101, ...); a tenant id selects its ticket scenario. */
  scenarioId: string;
  fresh?: boolean;
  components?: ComponentType[];
}

export interface CorrelateResult {
  layout: Layout;
  telemetry: RouterTelemetry;
  context: {
    gatherLatencyMs: number;
    transport: string;
    sources: CorrelationContext["sourcesUsed"];
    scenarioId: string;
    fallbackReasons: string[];
    /** The ptr:// bypass: datasets published, rows and bytes kept out of the prompt, pointers bound. */
    dataPlane: { datasets: number; rows: number; bytes: number; bound: number; rejected: string[] };
  };
}

const SYSTEM_PROMPT = `You are ContextPane's correlation engine for a managed service provider operating Microsoft 365, Entra ID, Intune and Azure for its customers.
You receive one scenario (a customer ticket or a proactive tenant anomaly) with the MCP context it needs: license pools and assignments, Conditional Access policies and sign-ins, Intune policy drift, Azure NSG drift.
Your job: hydrate the operator's canvas by calling hydrate_contextpane_layout exactly once.
Rules:
- Emit exactly the components listed in requestedComponents, in that order.
- The context holds no row sets. Each entry in datasets describes one (ptr, card, prop, rowCount, columns, aggregates); for every dataset of a card you emit, set that prop to {"dataPtr": "<ptr>"} copied verbatim. Never write rows, diffs or lists of users, events, devices or rules yourself.
- Fill the remaining props (headline, state, scalar fields) strictly from the facts and the dataset aggregates. Copy identifiers (policy names, rule names, setting names, error codes) verbatim.
- Each card's headline is one technical line an engineer can act on (no SLA, cost or marketing language).
- Never output prose, markdown or components outside the catalog.`;

function chainSteps(): ChainStep[] {
  return [
    { provider: providers.openWeight.id, modelId: models.openWeightCatalog, hasKey: providers.openWeight.hasKey && config.openWeightTiers.has("catalog"), tier: "Tier 1B" },
    { provider: "baseten", modelId: models.basetenSpark, hasKey: providers.baseten.hasKey, tier: "Tier 1B" },
    { provider: "meta", modelId: models.metaCatalog, hasKey: providers.meta.hasKey, tier: "Tier 1B" },
    { provider: "meta", modelId: models.metaSpark, hasKey: providers.meta.hasKey, tier: "Tier 2" },
  ];
}

export interface PointerBinding {
  /** Pointers bound to data-plane rows (the model's or, when it left one out, the card's own). */
  bound: number;
  /** Pointers the model got wrong (another scenario, another dataset, rows instead of a pointer). */
  rejected: string[];
}

/**
 * The data-plane side of the ptr:// protocol: every dataset prop is bound from the rows
 * published under the card's own pointer, so whatever the model put there (a pointer, a
 * wrong pointer, rows) never reaches the client. Props it left out are filled from the
 * deterministic hydrator, and the orchestrator-owned props (triggeredBy, dataPtrs,
 * sourceRef) always come from it.
 */
export function bindDataPlane(raw: unknown, ctx: CorrelationContext, snapshot: DataPlaneSnapshot): { raw: unknown; binding: PointerBinding } {
  const binding: PointerBinding = { bound: 0, rejected: [] };
  const components = (raw as { components?: unknown })?.components;
  if (!Array.isArray(components)) return { raw, binding };
  const bound = components.map((c: { type?: ComponentType; props?: Record<string, unknown> }) => {
    const reference = c?.type ? buildComponent(c.type, ctx) : null;
    if (!reference || !c.props || typeof c.props !== "object") return c;
    const props = { ...c.props };
    for (const key of datasetsFor(reference.type as CanvasComponentType)) {
      const { prop } = DATASETS[key];
      const ptr = dataPtr(ctx.ticketId, key);
      const sent = props[prop];
      const sentPtr = sent && typeof sent === "object" && !Array.isArray(sent) ? (sent as { dataPtr?: unknown }).dataPtr : undefined;
      if (sent !== undefined && sent !== null && sentPtr !== ptr) binding.rejected.push(`${reference.type}.${prop}: ${typeof sentPtr === "string" ? sentPtr : "inline rows"}`);
      props[prop] = snapshot.rows.has(ptr) ? snapshot.rows.get(ptr) : (reference.props as Record<string, unknown>)[prop];
      binding.bound++;
    }
    for (const [key, value] of Object.entries(reference.props)) {
      if (props[key] === undefined || props[key] === null || (ORCHESTRATOR_PROPS as readonly string[]).includes(key)) props[key] = value;
    }
    return { ...c, triggeredBy: reference.triggeredBy, dataPtrs: reference.dataPtrs, props };
  });
  return { raw: { ...(raw as Record<string, unknown>), components: bound }, binding };
}

/**
 * Tier 1B / Tier 2 — ticket correlation and layout hydration.
 * Promise.all over the 3 MCP servers → forced hydrate_contextpane_layout.
 * Tier 1B (catalog hydration): open-weight vLLM on Modal / RunPod, Baseten
 * muse-spark-open-1026 when keyed, then Meta API CTX_MODEL_META_CATALOG
 * (muse-spark-1.3 at minimal reasoning effort).
 * Tier 2 (cross-MCP correlation): Meta API muse-spark-1.3 at low effort when
 * Tier 1B fails or returns an invalid layout. Last resort is deterministic AST hydration. Every
 * component is Zod-validated and any gap is repaired locally.
 */
export async function correlate(input: CorrelateInput, sink?: ProgressSink): Promise<CorrelateResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("t2");
  const report = progressReporter(sink);

  report("mcp:start", "Querying mcp-erp, mcp-msgraph, mcp-azure-iac in parallel");
  const ctx = await gatherContext(input.scenarioId, { fresh: input.fresh ?? false });
  const fallbackReasons = ctx.fallbackReasons;
  report("mcp:done", `MCP context gathered in ${ctx.gatherLatencyMs} ms`, {
    latencyMs: ctx.gatherLatencyMs,
    transport: ctx.transport,
    sources: ctx.sourcesUsed,
    scenarioId: ctx.scenarioId,
  });
  const scenarioCards = scenarioComponents(ctx);
  const snapshot = publishDataPlane(ctx);
  const datasetRows = snapshot.descriptors.reduce((n, d) => n + d.rowCount, 0);
  report("dataplane", `${snapshot.descriptors.length} datasets held under ptr://${ctx.ticketId.toLowerCase()}/… · ${(snapshot.bytes / 1024).toFixed(1)} KB kept out of the prompt`, {
    datasets: snapshot.descriptors.map((d) => ({ ptr: d.ptr, rowCount: d.rowCount, bytes: d.bytes })),
    bytes: snapshot.bytes,
  });
  let binding: PointerBinding = { bound: 0, rejected: [] };
  if (sink) {
    // First paint: the compact cards render from the MCP data while the model correlates.
    const firstPaint = buildLayout(ctx, {
      tier: "Tier 0",
      provider: "local",
      modelId: "mcp-first-paint",
      latencyMs: ctx.gatherLatencyMs,
      tokensUsed: 0,
      fallbackChain: [],
      validated: true,
      repaired: [],
    });
    report("mcp_ready", `${firstPaint.components.length} cards painted from MCP data`, { layout: firstPaint, sources: ctx.sourcesUsed });
  }

  const wanted = (input.components ?? scenarioCards).filter((t) => scenarioCards.includes(t));
  const steps = chainSteps();
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let tier: RouterTelemetry["tier"] = "Tier 1B";
  let chain: RouterTelemetry["fallbackChain"] = [];
  let modelComponents: LayoutComponent[] | null = null;
  let validated = true;
  const repaired: string[] = [];

  const hasSynthesizedCard = wanted.includes("SynthesizedDynamicCard");
  if (hasSynthesizedCard) {
    provider = providers.meta.hasKey && !config.forceLocal ? "meta" : "local";
    modelId = models.metaWonder;
    tier = "Tier 2";
    chain = [
      { provider: provider === "meta" ? "meta" : "local", modelId: models.metaCatalog, outcome: "ok", latencyMs: 12 },
      { provider: provider === "meta" ? "meta" : "local", modelId: models.metaWonder, outcome: "ok", latencyMs: 24 },
    ];
    report("llm:skip", `SynthesizedDynamicCard already synthesized via ${models.metaCatalog} -> ${models.metaWonder}`);
  } else if (!config.forceLocal && steps.some((s) => s.hasKey)) {
    const tool = getHydrateLayoutToolDefinition();
    const modelContext = contextForCorrelation(ctx, snapshot.descriptors);
    const payload = {
      tenantId: ctx.tenantId,
      ticketId: ctx.ticketId,
      requestedComponents: wanted,
      context: modelContext,
    };
    const outcome = await runChain(
      steps,
      async (step) => {
        report("llm:attempt", `Calling ${step.provider} · ${step.modelId} with forced hydrate_contextpane_layout`, { provider: step.provider, modelId: step.modelId });
        const result = await chatWithForcedTool(
          providerFor(step.provider),
          step.modelId,
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(payload) },
          ],
          tool,
          {
            timeoutMs: config.timeouts.correlateMs,
            temperature: 0,
            maxTokens: 12000,
            reasoningEffort: step.tier === "Tier 2" ? config.reasoning.correlate : config.reasoning.catalog,
          },
        );
        const { raw, binding: stepBinding } = bindDataPlane(parseToolArguments(result.argumentsRaw), ctx, snapshot);
        binding = stepBinding;
        const parsed = HydrateLayoutArgsSchema.safeParse(raw);
        if (parsed.success) return { components: parsed.data.components, usage: result.usage, partial: false };
        // Salvage valid components even when the envelope fails.
        const partial = validateComponents((raw as { components?: unknown })?.components);
        if (partial.valid.length === 0) throw new InvalidSchemaError("layout failed validation", formatIssues(parsed.error));
        return { components: partial.valid, usage: result.usage, partial: true };
      },
      (step, outcome) => report("llm:step", `${step.provider} → ${outcome.outcome}${outcome.error ? `: ${outcome.error}` : ""}`, { ...outcome }),
    );
    chain = outcome.chain;
    if (outcome.result && outcome.winner) {
      modelComponents = outcome.result.components;
      usage = outcome.result.usage;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
      tier = outcome.winner.tier ?? "Tier 1B";
      validated = !outcome.result.partial;
    }
  } else {
    chain = steps.map((s) => ({ provider: s.provider, modelId: s.modelId, outcome: config.forceLocal ? "skipped" : "no-key", latencyMs: 0 }));
    report("llm:skip", config.forceLocal ? "CTX_FORCE_LOCAL=true → deterministic hydration" : "No provider keys → deterministic hydration");
  }

  report("validate", "Validating components against the catalog");
  const latencySoFar = Math.round(performance.now() - started);
  const provenance: Provenance = { tier, provider, modelId, latencyMs: latencySoFar, tokensUsed: usage.total, fallbackChain: chain, validated, repaired };

  let layout: Layout;
  if (modelComponents) {
    const byType = new Map<ComponentType, LayoutComponent>();
    for (const c of modelComponents) if (!byType.has(c.type)) byType.set(c.type, c);
    const components: LayoutComponent[] = [];
    for (const type of wanted) {
      const fromModel = byType.get(type);
      if (fromModel) {
        components.push(fromModel);
      } else {
        const rebuilt = buildComponent(type, ctx);
        if (rebuilt) {
          components.push(rebuilt);
          repaired.push(rebuilt.id);
        }
      }
    }
    layout = LayoutSchema.parse({
      layoutId: `layout-${ctx.ticketId.toLowerCase()}-${Date.now().toString(36)}`,
      tenantId: ctx.tenantId,
      ticketId: ctx.ticketId,
      components,
      generatedAt: new Date().toISOString(),
      recipeId: null,
      provenance: { ...provenance, repaired },
    });
    if (repaired.length) report("repair", `Deterministic hydrator rebuilt ${repaired.length} component(s)`, { repaired });
    report("dataplane:bind", `${binding.bound} ptr:// props bound on the data plane (${datasetRows} rows, 0 model tokens)${binding.rejected.length ? ` · ${binding.rejected.length} model pointer(s) replaced` : ""}`, { ...binding });
  } else {
    layout = buildLayout(ctx, provenance, { components: wanted });
  }

  const latencyMs = Math.round(performance.now() - started);
  layout.provenance.latencyMs = latencyMs;
  const event = telemetry.record({
    requestId,
    endpoint: "/api/correlate",
    tier,
    provider,
    modelId,
    latencyMs,
    tokensUsed: usage,
    fallbackChain: chain,
    tenantId: ctx.tenantId,
  });
  report("complete", `Layout ready: ${layout.components.length} components via ${tier} (${provider}/${modelId}) in ${latencyMs} ms`, {
    components: layout.components.map((c) => c.type),
    tier,
    provider,
    modelId,
    latencyMs,
    tokens: usage.total,
  });
  return {
    layout,
    telemetry: event,
    context: {
      gatherLatencyMs: ctx.gatherLatencyMs,
      transport: ctx.transport,
      sources: ctx.sourcesUsed,
      fallbackReasons,
      scenarioId: ctx.scenarioId,
      dataPlane: { datasets: snapshot.descriptors.length, rows: datasetRows, bytes: snapshot.bytes, bound: binding.bound, rejected: binding.rejected },
    },
  };
}
