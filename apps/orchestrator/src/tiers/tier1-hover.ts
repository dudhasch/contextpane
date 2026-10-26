import {
  HoverDiagnosticArgsSchema,
  HoverDiagnosticPopoverSchema,
  formatIssues,
  getHoverDiagnosticToolDefinition,
  parseToolArguments,
  type EntityType,
  type HoverDiagnosticArgs,
  type HoverDiagnosticPopover,
  type RouterTelemetry,
} from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { buildHoverDiagnostic, inferEntityType } from "../local/hover.ts";
import { contextForModel, gatherContext } from "../mcp/context.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";

export interface HoverInput {
  tenantId: string;
  entityId: string;
  entityType?: EntityType;
}

export interface HoverResult {
  popover: HoverDiagnosticPopover;
  telemetry: RouterTelemetry;
}

const SYSTEM_PROMPT = `You are ContextPane's inline diagnostic engine for Microsoft 365 / Entra ID / Azure escalations at a managed service provider.
You receive one hovered entity plus verified context from the ERP, Microsoft Graph and Azure. A deterministic diagnostic is included as ground truth.
Rules:
- Respond ONLY through the emit_hover_diagnostic tool.
- Use only facts present in the context. Never invent users, policies, resources or error meanings.
- The headline is one line an MSP engineer can act on. Prefer naming the blocking policy and the license gap.
- Keep AADSTS translations consistent with the supplied catalog entry.
- Quick actions must come from the allowed kinds and reference real entity ids.`;

function chainSteps(): ChainStep[] {
  return [
    { provider: "fireworks", modelId: models.fireworksGlimmer, hasKey: providers.fireworks.hasKey },
    { provider: "baseten", modelId: models.basetenGlimmer, hasKey: providers.baseten.hasKey },
    { provider: "meta", modelId: models.metaGlimmer, hasKey: providers.meta.hasKey },
  ];
}

/**
 * Tier 1A — inline hover. Fireworks → Baseten → Meta API, all muse-glimmer-30b,
 * each bounded by CTX_HOVER_TIMEOUT_MS; deterministic fallback keeps the popover
 * well under the 350 ms budget when no provider answers.
 */
export async function hover(input: HoverInput): Promise<HoverResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("t1a");
  const entityType = input.entityType ?? inferEntityType(input.entityId);
  const ctx = await gatherContext(input.tenantId);
  const deterministic = buildHoverDiagnostic(ctx, { entityId: input.entityId, entityType });

  let args: HoverDiagnosticArgs = deterministic;
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let chain: RouterTelemetry["fallbackChain"] = [];

  const steps = chainSteps();
  if (!config.forceLocal && steps.some((s) => s.hasKey)) {
    const tool = getHoverDiagnosticToolDefinition();
    const model = contextForModel(ctx);
    const userPayload = {
      entity: { entityId: input.entityId, entityType },
      deterministicDiagnostic: deterministic,
      context: {
        ticket: model.ticket,
        entraLicenseState: model.entraLicenseState,
        conditionalAccessPolicies: model.conditionalAccessPolicies,
        signInEvents: model.signInEvents.filter((e) => e.upn === input.entityId || e.errorCodeLabel === input.entityId.toUpperCase() || e.status === "failure").slice(-12),
        azureNsgDrift: entityType === "resource" ? { ...model.azureNsgDrift, hclDiff: undefined } : undefined,
      },
    };
    const outcome = await runChain(steps, async (step) => {
      const providerConfig = providers[step.provider as "fireworks" | "baseten" | "meta"];
      const result = await chatWithForcedTool(
        providerConfig,
        step.modelId,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        tool,
        { timeoutMs: config.timeouts.hoverMs, temperature: 0, maxTokens: 1200 },
      );
      const parsed = HoverDiagnosticArgsSchema.safeParse(parseToolArguments(result.argumentsRaw));
      if (!parsed.success) throw new InvalidSchemaError("hover diagnostic failed validation", formatIssues(parsed.error));
      return { args: parsed.data, usage: result.usage };
    });
    chain = outcome.chain;
    if (outcome.result && outcome.winner) {
      args = { ...outcome.result.args, entityId: input.entityId, entityType };
      usage = outcome.result.usage;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
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
    tenantId: input.tenantId,
  });
  return { popover, telemetry: event };
}
