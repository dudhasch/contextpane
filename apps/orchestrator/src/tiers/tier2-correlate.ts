import {
  HydrateLayoutArgsSchema,
  LayoutSchema,
  formatIssues,
  getHydrateLayoutToolDefinition,
  parseToolArguments,
  validateComponents,
  type ComponentType,
  type Layout,
  type LayoutComponent,
  type Provenance,
  type RouterTelemetry,
} from "@contextpane/catalog";
import { config, models, providerFor, providers } from "../config.ts";
import { DEFAULT_COMPONENT_ORDER, buildComponent } from "../local/hydrate.ts";
import { buildLayout } from "../local/hydrate.ts";
import { contextForModel, gatherContext, type CorrelationContext } from "../mcp/context.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { progressReporter, type ProgressSink } from "./progress.ts";

export interface CorrelateInput {
  tenantId: string;
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
    fallbackReasons: string[];
  };
}

const SYSTEM_PROMPT = `You are ContextPane's correlation engine for a managed service provider operating Microsoft 365, Entra ID and Azure for its customers.
You receive an ERP escalation ticket and contract together with live Entra license state, Conditional Access policies, sign-in events and Azure NSG drift against the Terraform baseline.
Your job: hydrate the operator's canvas by calling hydrate_contextpane_layout exactly once.
Rules:
- Emit the components in this order: TenantSummaryHeader, LicenseDriftCard, EntraSignInTimeline, IaCDriftBanner.
- Fill every prop strictly from the supplied context. Copy identifiers (UPNs, policy names, rule names, tag values, error codes) verbatim.
- driftedCount = erpBilledCount - entraAssignedCount, never negative. Mark users drifted when currentSku != expectedSku.
- In EntraSignInTimeline, highlight the failing sign-ins of the ticket requester and set rootCause to the AADSTS code, blocking policy and target app.
- In IaCDriftBanner, copy tagDrift and rogueSecurityRules from azureNsgDrift and write a one-line summary beginning with "State: DRIFT DETECTED" or "State: IN SYNC".
- Leave out LicenseDriftCard.users, EntraSignInTimeline.events and IaCDriftBanner.hclDiff: the orchestrator copies them verbatim from the MCP data.
- providerTelemetry inside TenantSummaryHeader may be left as zeros; the orchestrator overwrites it.
- Never output prose, markdown or components outside the catalog.`;

function chainSteps(): ChainStep[] {
  return [
    { provider: providers.openWeight.id, modelId: models.openWeightCatalog, hasKey: providers.openWeight.hasKey, tier: "Tier 1B" },
    { provider: "baseten", modelId: models.basetenSpark, hasKey: providers.baseten.hasKey, tier: "Tier 1B" },
    { provider: "meta", modelId: models.metaCatalog, hasKey: providers.meta.hasKey, tier: "Tier 1B" },
    { provider: "meta", modelId: models.metaSpark, hasKey: providers.meta.hasKey, tier: "Tier 2" },
  ];
}

/**
 * The model reasons about the layout but does not re-type MCP data: every prop it
 * leaves out (license users, sign-in events, the HCL diff) is filled from the
 * deterministic hydrator for the same component before Zod validation. This roughly
 * halves the output tokens of a layout.
 */
const VERBATIM_PROPS: Partial<Record<ComponentType, string[]>> = {
  LicenseDriftCard: ["users"],
  EntraSignInTimeline: ["events"],
  IaCDriftBanner: ["hclDiff"],
};

function fillVerbatimProps(raw: unknown, ctx: CorrelationContext): unknown {
  const components = (raw as { components?: unknown })?.components;
  if (!Array.isArray(components)) return raw;
  const zero = { tier: "Tier 1B" as const, provider: "local" as const, modelId: "deterministic", latencyMs: 0, tokensUsed: 0 };
  return {
    ...(raw as Record<string, unknown>),
    components: components.map((c: { type?: ComponentType; props?: Record<string, unknown> }) => {
      const reference = c?.type ? buildComponent(c.type, ctx, zero) : null;
      if (!reference || !c.props || typeof c.props !== "object") return c;
      const props = { ...c.props };
      const verbatim = VERBATIM_PROPS[reference.type] ?? [];
      // Verbatim MCP data always comes from the hydrator (the model sometimes sends "" instead of omitting it).
      for (const [key, value] of Object.entries(reference.props)) {
        if (verbatim.includes(key) || props[key] === undefined || props[key] === null) props[key] = value;
      }
      return { ...c, props };
    }),
  };
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
  const ctx = await gatherContext(input.tenantId, { fresh: input.fresh ?? false });
  const fallbackReasons = [ctx.license.fallbackReason, ctx.policies.fallbackReason, ctx.signIns.fallbackReason, ctx.drift.fallbackReason].filter(
    (r): r is string => Boolean(r),
  );
  report("mcp:done", `MCP context gathered in ${ctx.gatherLatencyMs} ms`, {
    latencyMs: ctx.gatherLatencyMs,
    transport: ctx.transport,
    sources: ctx.sourcesUsed,
    users: ctx.license.data.users.length,
    signIns: ctx.signIns.data.length,
    policies: ctx.policies.data.length,
    driftState: ctx.drift.data.driftState,
  });
  if (sink) {
    // First paint: the header and live source badges render from MCP data while the model correlates.
    const firstPaint = buildLayout(
      ctx,
      { tier: "Tier 0", provider: "local", modelId: "mcp-first-paint", latencyMs: ctx.gatherLatencyMs, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] },
      { components: ["TenantSummaryHeader"] },
    );
    report("mcp_ready", "TenantSummaryHeader painted from live MCP data", { layout: firstPaint, sources: ctx.sourcesUsed });
  }

  const wanted = input.components ?? DEFAULT_COMPONENT_ORDER;
  const steps = chainSteps();
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let tier: RouterTelemetry["tier"] = "Tier 1B";
  let chain: RouterTelemetry["fallbackChain"] = [];
  let modelComponents: LayoutComponent[] | null = null;
  let validated = true;
  const repaired: string[] = [];

  if (!config.forceLocal && steps.some((s) => s.hasKey)) {
    const tool = getHydrateLayoutToolDefinition();
    const modelContext = contextForModel(ctx);
    const payload = {
      tenantId: ctx.tenantId,
      ticketId: ctx.ticketId,
      requestedComponents: wanted,
      // The diff body is copied in by the orchestrator, so the model never needs to read it either.
      context: { ...modelContext, azureNsgDrift: { ...modelContext.azureNsgDrift, hclDiff: undefined } },
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
        const raw = fillVerbatimProps(parseToolArguments(result.argumentsRaw), ctx);
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
    const telemetryProps = { tier, provider, modelId, latencyMs: latencySoFar, tokensUsed: usage.total };
    const byType = new Map<ComponentType, LayoutComponent>();
    for (const c of modelComponents) if (!byType.has(c.type)) byType.set(c.type, c);
    const components: LayoutComponent[] = [];
    for (const type of wanted) {
      const fromModel = byType.get(type);
      if (fromModel) {
        if (fromModel.type === "TenantSummaryHeader") fromModel.props.providerTelemetry = telemetryProps;
        components.push(fromModel);
      } else {
        const rebuilt = buildComponent(type, ctx, telemetryProps);
        if (rebuilt) {
          components.push(rebuilt);
          repaired.push(rebuilt.id);
        }
      }
    }
    layout = LayoutSchema.parse({
      layoutId: `layout-${ctx.tenantId}-${Date.now().toString(36)}`,
      tenantId: ctx.tenantId,
      ticketId: ctx.ticketId,
      components,
      generatedAt: new Date().toISOString(),
      recipeId: null,
      provenance: { ...provenance, repaired },
    });
    if (repaired.length) report("repair", `Deterministic hydrator rebuilt ${repaired.length} component(s)`, { repaired });
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
    tenantId: input.tenantId,
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
    context: { gatherLatencyMs: ctx.gatherLatencyMs, transport: ctx.transport, sources: ctx.sourcesUsed, fallbackReasons },
  };
}
