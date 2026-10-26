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
import { config, models, providers } from "../config.ts";
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
- In IaCDriftBanner, copy tagDrift, rogueSecurityRules and hclDiff from azureNsgDrift and write a one-line summary beginning with "State: DRIFT DETECTED" or "State: IN SYNC".
- providerTelemetry inside TenantSummaryHeader may be left as zeros; the orchestrator overwrites it.
- Never output prose, markdown or components outside the catalog.`;

function chainSteps(): ChainStep[] {
  return [
    { provider: "baseten", modelId: models.basetenSpark, hasKey: providers.baseten.hasKey },
    { provider: "meta", modelId: models.metaSpark, hasKey: providers.meta.hasKey },
  ];
}

/**
 * Tier 1B / Tier 2 — ticket correlation and layout hydration.
 * Promise.all over the 3 MCP servers → forced hydrate_contextpane_layout on
 * Baseten (open-weight muse-spark-open-1026, Tier 1B) → Meta API (muse-spark-1.3,
 * Tier 2) → deterministic AST hydration. Every component is Zod-validated and
 * any gap is repaired locally so the canvas is always complete.
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
    const payload = { tenantId: ctx.tenantId, ticketId: ctx.ticketId, requestedComponents: wanted, context: contextForModel(ctx) };
    const outcome = await runChain(
      steps,
      async (step) => {
        report("llm:attempt", `Calling ${step.provider} · ${step.modelId} with forced hydrate_contextpane_layout`, { provider: step.provider, modelId: step.modelId });
        const providerConfig = providers[step.provider as "baseten" | "meta"];
        const result = await chatWithForcedTool(
          providerConfig,
          step.modelId,
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(payload) },
          ],
          tool,
          { timeoutMs: config.timeouts.correlateMs, temperature: 0, maxTokens: 6000 },
        );
        const raw = parseToolArguments(result.argumentsRaw);
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
      tier = outcome.winner.provider === "meta" ? "Tier 2" : "Tier 1B";
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
