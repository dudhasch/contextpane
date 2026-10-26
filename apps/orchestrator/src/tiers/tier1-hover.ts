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
import { config, models, providerFor, providers } from "../config.ts";
import { buildHoverDiagnostic, inferEntityType } from "../local/hover.ts";
import { gatherContext, type CorrelationContext } from "../mcp/context.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";

export interface HoverInput {
  tenantId: string;
  entityId: string;
  entityType?: EntityType;
  /** Bypass the hover cache and refresh the MCP context. */
  fresh?: boolean;
}

export interface HoverResult {
  popover: HoverDiagnosticPopover;
  telemetry: RouterTelemetry;
}

// Measured on the Meta API: this wording drew ~100 fewer reasoning tokens than an explicit "refine" instruction.
const SYSTEM_PROMPT = `You are ContextPane's inline diagnostic engine for Microsoft 365 / Entra ID / Azure escalations at a managed service provider.
You receive one hovered entity plus verified context. A deterministic diagnostic is included as ground truth.
Rules: respond only through emit_hover_diagnostic; use only facts present in the context; the headline is one line an MSP engineer can act on, naming the blocking policy and the license gap.`;

/** Model answers per (tenant, entity), so a hover after warm-up renders from memory. */
const HOVER_CACHE_TTL_MS = 10 * 60_000;
const hoverCache = new Map<string, { at: number; args: HoverDiagnosticArgs; provider: RouterTelemetry["provider"]; modelId: string }>();
const hoverKey = (tenantId: string, entityId: string) => `${tenantId}|${entityId.toLowerCase()}`;

function chainSteps(): ChainStep[] {
  return [
    { provider: providers.openWeight.id, modelId: models.openWeightGlimmer, hasKey: providers.openWeight.hasKey },
    { provider: "fireworks", modelId: models.fireworksGlimmer, hasKey: providers.fireworks.hasKey },
    { provider: "baseten", modelId: models.basetenGlimmer, hasKey: providers.baseten.hasKey },
    { provider: "meta", modelId: models.metaHover, hasKey: providers.meta.hasKey },
  ];
}

/** Only what this entity's popover can use: the deterministic diagnostic already carries the rest. */
function hoverContext(ctx: CorrelationContext, entityId: string, entityType: EntityType) {
  const id = entityId.toLowerCase();
  const signIns = ctx.signIns.data.filter((e) => e.upn.toLowerCase() === id || e.errorCodeLabel?.toLowerCase() === id || e.blockingPolicyId === entityId);
  return {
    ticket: { ticketId: ctx.erp.ticket.ticketId, title: ctx.erp.ticket.title },
    sku: { expected: ctx.license.data.sku.skuPartNumber, legacy: ctx.license.data.sku.legacySkuPartNumber, drifted: ctx.license.data.driftedUsers.length },
    user: entityType === "upn" ? (ctx.license.data.users.find((u) => u.upn.toLowerCase() === id) ?? null) : undefined,
    policies: ctx.policies.data.map((p) => ({ id: p.id, displayName: p.displayName, state: p.state, blocks: p.blocks, includeGroupNames: p.includeGroupNames })),
    signIns: (signIns.length ? signIns : ctx.signIns.data.filter((e) => e.status === "failure")).slice(-3).map((e) => ({
      at: e.timestamp,
      upn: e.upn,
      app: e.appDisplayName,
      status: e.status,
      code: e.errorCodeLabel,
      blockedBy: e.blockingPolicyName,
    })),
    nsgDrift:
      entityType === "resource"
        ? { summary: ctx.drift.data.summary, rogueSecurityRules: ctx.drift.data.rogueSecurityRules, tagDrift: ctx.drift.data.tagDrift }
        : undefined,
  };
}

/**
 * Tier 1A — inline hover. Open-weight Muse Glimmer 30B (llama-server on Modal, RunPod or locally) when
 * CTX_OPEN_WEIGHT_BASE_URL is set, otherwise the Meta Model API as a first-class
 * route; Fireworks and Baseten slot in ahead of Meta only when their keys exist.
 * Model answers are cached per (tenant, entity) and pre-fetched for every pill
 * of the ticket (warmHoverCache); the deterministic fallback keeps the popover
 * under the 350 ms budget when no provider answers.
 */
export async function hover(input: HoverInput): Promise<HoverResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("t1a");
  const entityType = input.entityType ?? inferEntityType(input.entityId);
  const cached = input.fresh ? undefined : hoverCache.get(hoverKey(input.tenantId, input.entityId));
  if (cached && Date.now() - cached.at < HOVER_CACHE_TTL_MS) {
    const modelId = `${cached.modelId} (cached)`;
    const latencyMs = Math.round(performance.now() - started);
    return {
      popover: HoverDiagnosticPopoverSchema.parse({
        ...cached.args,
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
        tenantId: input.tenantId,
      }),
    };
  }
  const ctx = await gatherContext(input.tenantId, { fresh: input.fresh ?? false });
  const deterministic = buildHoverDiagnostic(ctx, { entityId: input.entityId, entityType });

  let args: HoverDiagnosticArgs = deterministic;
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let chain: RouterTelemetry["fallbackChain"] = [];

  const steps = chainSteps();
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
                ? config.timeouts.openWeightHoverMs
                : config.timeouts.hoverMs,
          temperature: 0,
          maxTokens: 1500,
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
      args = { ...outcome.result.args, entityId: input.entityId, entityType };
      usage = outcome.result.usage;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
      hoverCache.set(hoverKey(input.tenantId, input.entityId), { at: Date.now(), args, provider, modelId });
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

const warming = new Set<string>();
const WARM_CONCURRENCY = 3;

/** Every entity the ticket pane and canvas render as a hoverable pill, hero entities first. */
function hoverTargets(ctx: CorrelationContext): Array<{ entityId: string; entityType: EntityType }> {
  const ticket = ctx.erp.ticket;
  const lastFailure = ctx.signIns.data.filter((e) => e.status === "failure").at(-1);
  const all: Array<{ entityId: string; entityType: EntityType }> = [
    ...ticket.affectedUpns.slice(0, 1).map((entityId) => ({ entityId, entityType: "upn" as const })),
    ...ticket.affectedGroups.slice(0, 1).map((entityId) => ({ entityId, entityType: "group" as const })),
    ...(lastFailure?.errorCodeLabel ? [{ entityId: lastFailure.errorCodeLabel, entityType: "errorCode" as const }] : []),
    ...ticket.entities.map((e) => ({ entityId: e.id, entityType: e.type as EntityType })),
    ...ticket.affectedGroups.map((entityId) => ({ entityId, entityType: "group" as const })),
    ...ticket.affectedUpns.map((entityId) => ({ entityId, entityType: "upn" as const })),
    ...ctx.license.data.users.map((u) => ({ entityId: u.upn, entityType: "upn" as const })),
    ...ctx.signIns.data.flatMap((e) => (e.errorCodeLabel ? [{ entityId: e.errorCodeLabel, entityType: "errorCode" as const }] : [])),
    { entityId: ctx.drift.data.resourceName, entityType: "resource" as const },
  ];
  const seen = new Set<string>();
  return all.filter((t) => t.entityId && !seen.has(t.entityId.toLowerCase()) && seen.add(t.entityId.toLowerCase()));
}

/**
 * Pre-fetch a popover for every hoverable pill of the ticket (all users, the groups,
 * the AADSTS codes, the NSG and host pool), hero entities first, a few at a time in
 * the background so a hover anywhere in the workbench is served from the cache.
 */
export async function warmHoverCache(tenantId: string): Promise<{ warmed: number; total: number } | undefined> {
  if (warming.has(tenantId) || config.forceLocal || !chainSteps().some((s) => s.hasKey)) return undefined;
  warming.add(tenantId);
  try {
    const ctx = await gatherContext(tenantId);
    const fresh = (t: { entityId: string }) => {
      const cached = hoverCache.get(hoverKey(tenantId, t.entityId));
      return cached !== undefined && Date.now() - cached.at < HOVER_CACHE_TTL_MS;
    };
    const targets = hoverTargets(ctx);
    const queue = targets.filter((t) => !fresh(t));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await hover({ tenantId, ...next }).catch(() => undefined);
    };
    await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
    return { warmed: targets.filter(fresh).length, total: targets.length };
  } finally {
    warming.delete(tenantId);
  }
}
