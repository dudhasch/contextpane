import {
  ContextualMiniDashboardModelArgsSchema,
  ContextualMiniDashboardSchema,
  SELECTION_MAX_CHARS,
  SELECTION_MIN_CHARS,
  formatIssues,
  getComposeMiniDashboardToolDefinition,
  parseToolArguments,
  selectionDataPtr,
  selectionHash,
  type ContextViewMode,
  type ContextualMiniDashboard,
  type RouterTelemetry,
} from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { buildScenarioBrief } from "../local/brief.ts";
import { publishSelection, type SelectionPublication } from "../local/dataplane.ts";
import { buildSelectionSlice, sliceToCard, type SelectionSlice } from "../local/selection.ts";
import { gatherContext, type CorrelationContext } from "../mcp/context.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";

/**
 * Highlight any text → Generate Context UI. The deterministic slicer finds the rows the phrase
 * refers to, publishes them under ptr://<scenario>/selection/<hash> (PII vaulted for the
 * prompt), and muse-spark-1.3 composes the ContextualMiniDashboard from the descriptor and
 * the reference slice. The data plane binds the rows back; the deterministic card answers
 * alone when the model is offline, slow or invalid. Never touches the open-weight GPU.
 */

export interface ExploreInput {
  scenarioId: string;
  selectedText: string;
  /** Optional added query/context from the operator, e.g. "other apps with the same owner". */
  refinementText?: string;
  /** Selected UI view mode (dashboard, full-card, comparison, blast-radius). */
  viewMode?: ContextViewMode;
  /** Free-form ticket text the selection came from (an unscripted ticket), for the prompt only. */
  customTicketText?: string;
}

export interface ExploreResult {
  card: ContextualMiniDashboard;
  dataPtr: string;
  latencyMs: number;
  tier: RouterTelemetry["tier"];
  modelId: string;
  provider: RouterTelemetry["provider"];
  tokenCount: number;
  slice: { kind: SelectionSlice["kind"]; matchedBy: SelectionSlice["matchedBy"]; rowCount: number; searched: SelectionSlice["searched"] };
  descriptor: SelectionPublication["descriptor"];
  telemetry: RouterTelemetry;
}

const SYSTEM_PROMPT = `You compose one ContextualMiniDashboard card for the phrase an MSP engineer highlighted inside a Microsoft 365 / Entra / Intune / Azure ticket.
You get the selection descriptor (pointer, row count, columns, aggregates, a pseudonymised sample) and a deterministic reference card built from the same rows.
Call compose_contextual_mini_dashboard exactly once. Keep every identifier verbatim, keep the reference's sourceQuery and columns unless they are wrong, write a sharper title and subtitle, 2-4 KPIs and 2-5 breakdown bars that add up over the matched rows, and one concrete suggested action. Set rows to {"dataPtr": "<pointer>"}; never write rows.`;

/** `<Mail-ReadWrite-assignment-id>`, `<upn>`, `<SG-BreakGlass-Accounts objectId>`: an id the model did not have. */
export const PLACEHOLDER_RE = /<[A-Za-z][^<>\n]{0,80}>/;

function chainSteps(): ChainStep[] {
  return [{ provider: "meta", modelId: models.metaCatalog, hasKey: providers.meta.hasKey, tier: "Tier 1B" }];
}

export function validateSelectionText(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < SELECTION_MIN_CHARS) throw new Error(`selectedText must be at least ${SELECTION_MIN_CHARS} characters`);
  return trimmed.slice(0, SELECTION_MAX_CHARS);
}

export async function exploreSelection(input: ExploreInput): Promise<ExploreResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("t1s");
  const selectedText = validateSelectionText(input.selectedText);
  const refinementText = input.refinementText?.replace(/\s+/g, " ").trim().slice(0, SELECTION_MAX_CHARS) || undefined;
  const viewMode = input.viewMode;
  const ctx: CorrelationContext = await gatherContext(input.scenarioId);
  const brief = buildScenarioBrief(ctx);
  const sliceOptions = { ...(refinementText ? { refinementText } : {}), ...(viewMode ? { viewMode } : {}) };
  const slice = buildSelectionSlice(ctx, selectedText, brief.steps, sliceOptions);
  const hash = selectionHash(ctx.ticketId, selectedText, refinementText, viewMode);
  const ptr = selectionDataPtr(ctx.ticketId, hash);
  const publication = publishSelection({ ptr, scenarioId: ctx.ticketId, selectedText, sourceQuery: slice.sourceQuery, rows: slice.rows });
  const reference = sliceToCard(ctx, selectedText, slice, sliceOptions);

  let card = reference;
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let chain: RouterTelemetry["fallbackChain"] = [];
  const steps = chainSteps();

  if (!config.forceLocal && steps.some((s) => s.hasKey) && slice.matchedBy !== "none") {
    const tool = getComposeMiniDashboardToolDefinition();
    const { rows: _rows, ...referenceWithoutRows } = reference;
    const sample = (publication.piiVault.pseudonymize(slice.rows.slice(0, 5)) as Record<string, unknown>[]) ?? [];
    const payload = {
      scenario: { scenarioId: ctx.ticketId, title: brief.title, tenant: ctx.erp.tenant.verifiedDomain },
      selectedText,
      ...(refinementText ? { refinementText } : {}),
      ...(viewMode ? { viewMode } : {}),
      ...(input.customTicketText ? { ticketExcerpt: input.customTicketText.slice(0, 600) } : {}),
      descriptor: { ...publication.descriptor, sample },
      resolutionSteps: brief.steps.map((s, i) => `${i}: ${s.title}`),
      referenceCard: { ...referenceWithoutRows, rows: { dataPtr: ptr } },
    };
    const outcome = await runChain(steps, async (step) => {
      const result = await chatWithForcedTool(
        providers.meta,
        step.modelId,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
        tool,
        { timeoutMs: config.timeouts.exploreMs, temperature: 0, maxTokens: 2500, reasoningEffort: config.reasoning.catalog },
      );
      const parsed = ContextualMiniDashboardModelArgsSchema.safeParse(parseToolArguments(result.argumentsRaw));
      if (!parsed.success) throw new InvalidSchemaError("mini-dashboard failed validation", formatIssues(parsed.error));
      const args = parsed.data;
      const known = new Set(publication.descriptor.columns);
      const columns = args.columns.filter((c) => known.has(c.key));
      // The data plane binds the rows; a wrong pointer or unknown columns fall back to the reference.
      const keepReferenceAction =
        PLACEHOLDER_RE.test(args.suggestedAction.scriptPreview) ||
        slice.kind === "entra-ca-policies" ||
        slice.kind === "workload-identity";
      const keepReferenceHeading =
        slice.kind === "entra-ca-policies" &&
        slice.rows[0]?.role === "blocking" &&
        (/report-only|ca-004/i.test(args.title) || /report-only|ca-004/i.test(args.subtitle));
      const composed = ContextualMiniDashboardSchema.parse({
        ...reference,
        title: keepReferenceHeading ? reference.title : args.title,
        subtitle: keepReferenceHeading ? reference.subtitle : args.subtitle,
        sourceQuery: args.sourceQuery,
        kpis: args.kpis,
        breakdown: args.breakdown,
        columns: columns.length ? columns : reference.columns,
        // A model script with a <placeholder> is not runnable as-is: keep the reference action, which carries the real ids.
        suggestedAction: keepReferenceAction
          ? reference.suggestedAction
          : { ...args.suggestedAction, ...(args.suggestedAction.targetStepIndex !== undefined && args.suggestedAction.targetStepIndex < brief.steps.length ? {} : { targetStepIndex: reference.suggestedAction.targetStepIndex }) },
        rows: slice.rows,
        rowsPtr: ptr,
      });
      return { card: composed, usage: result.usage, pointerOk: args.rows.dataPtr === ptr };
    });
    chain = outcome.chain;
    if (outcome.result && outcome.winner) {
      card = outcome.result.card;
      usage = outcome.result.usage;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
    }
  } else {
    chain = steps.map((s) => ({ provider: s.provider, modelId: s.modelId, outcome: config.forceLocal ? "skipped" : s.hasKey ? "skipped" : "no-key", latencyMs: 0 }));
  }

  const latencyMs = Math.round(performance.now() - started);
  const tier: RouterTelemetry["tier"] = "Tier 1B";
  const event = telemetry.record({
    requestId,
    endpoint: "/api/explore-selection",
    tier,
    provider,
    modelId,
    latencyMs,
    tokensUsed: usage,
    fallbackChain: chain,
    tenantId: ctx.tenantId,
    ...(provider === "local" ? { estimatedSavings: { tokens: 900, ms: 2500, versus: "muse-spark-1.3 mini-dashboard composition" } } : {}),
  });
  return {
    card,
    dataPtr: ptr,
    latencyMs,
    tier,
    modelId,
    provider,
    tokenCount: usage.total,
    slice: { kind: slice.kind, matchedBy: slice.matchedBy, rowCount: slice.rows.length, searched: slice.searched },
    descriptor: publication.descriptor,
    telemetry: event,
  };
}
