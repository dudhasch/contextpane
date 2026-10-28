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
import { sources } from "../mcp/clients.ts";
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

const SYSTEM_PROMPT = `You are a Principal Microsoft Cloud & Azure Architect (muse-wonder-1.0) composing a bespoke ContextualMiniDashboard card for the phrase an MSP engineer highlighted inside a Microsoft 365 / Entra / Intune / Azure ticket.
You get the selection descriptor (pointer, row count, columns, aggregates, a pseudonymised sample), the active ticket context, optional refinementText (+ add info), and a deterministic reference card.
Call compose_contextual_mini_dashboard exactly once.
CRITICAL RULES:
1. NEVER slap the highlighted text onto an unrelated template (e.g., NEVER mention AADSTS7000222, Directory.ReadWrite.All, or github-actions-erp-sync when the query is about Key Vault RBAC/owners or another domain!).
2. Keep every real identifier verbatim, write a domain-accurate title and subtitle, 2-4 KPIs and 2-5 breakdown bars, and one concrete PowerShell 7 / Azure CLI suggested action.
3. Set rows to {"dataPtr": "<pointer>"}. If descriptor.matchedBy is "none" (an open-ended or custom concept not in the fixed tables), also populate synthesizedRows with 4-5 realistic, domain-accurate rows whose keys match your columns.`;

/** `<Mail-ReadWrite-assignment-id>`, `<upn>`, `<SG-BreakGlass-Accounts objectId>`: an id the model did not have. */
export const PLACEHOLDER_RE = /<[A-Za-z][^<>\n]{0,80}>/;

function chainSteps(): ChainStep[] {
  return [
    { provider: "meta", modelId: models.metaWonder, hasKey: providers.meta.hasKey, tier: "Tier 1B" },
    { provider: "meta", modelId: models.metaCatalog, hasKey: providers.meta.hasKey, tier: "Tier 1B" },
  ];
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
  const publication = publishSelection({ ptr, scenarioId: ctx.ticketId, selectedText, sourceQuery: slice.sourceQuery, rows: slice.rows, tenantId: ctx.tenantId });
  const reference = sliceToCard(ctx, selectedText, slice, sliceOptions);

  let card = reference;
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";
  let chain: RouterTelemetry["fallbackChain"] = [];
  const steps = chainSteps();

  if (!config.forceLocal && steps.some((s) => s.hasKey)) {
    const strictRealTenant = sources.getDataMode() === "real-tenant";
    const isOpenEndedSynthesis = !strictRealTenant && slice.matchedBy === "none";
    const baseTool = getComposeMiniDashboardToolDefinition();
    const baseParams = baseTool.function.parameters as Record<string, unknown>;
    const baseProps = (baseParams.properties as Record<string, unknown>) ?? {};
    const baseReq = Array.isArray(baseParams.required) ? (baseParams.required as string[]) : [];
    const tool = {
      ...baseTool,
      function: {
        ...baseTool.function,
        parameters: {
          ...baseParams,
          required: isOpenEndedSynthesis ? [...new Set([...baseReq, "synthesizedRows"])] : baseReq,
          properties: {
            ...baseProps,
            ...(isOpenEndedSynthesis
              ? {
                  synthesizedRows: {
                    type: "array",
                    description: "Provide 4-5 domain-accurate rows whose keys exactly match the keys in columns.",
                    items: { type: "object" },
                  },
                }
              : {}),
          },
        },
      },
    };
    const { rows: _rows, ...referenceWithoutRows } = reference;
    const sample = isOpenEndedSynthesis
      ? []
      : ((publication.piiVault.pseudonymize(slice.rows.slice(0, 5)) as Record<string, unknown>[]) ?? []);
    const payload = {
      scenario: {
        scenarioId: ctx.ticketId,
        title: brief.title,
        summary: brief.summary,
        tenant: ctx.erp.tenant.verifiedDomain,
        subscriptionId: ctx.resourceInventory?.data.subscriptionId || config.lab.subscriptionId,
      },
      selectedText,
      ...(refinementText ? { refinementText } : {}),
      ...(viewMode ? { viewMode } : {}),
      ...(input.customTicketText ? { ticketExcerpt: input.customTicketText.slice(0, 600) } : {}),
      descriptor: isOpenEndedSynthesis
        ? { dataPtr: ptr, matchedBy: "none", instruction: "Synthesize bespoke columns, synthesizedRows (4-5 rows), kpis, breakdown, and PowerShell 7 suggestedAction for selectedText + refinementText." }
        : { ...publication.descriptor, matchedBy: slice.matchedBy, sample },
      resolutionSteps: brief.steps.map((s, i) => `${i}: ${s.title}`),
      ...(isOpenEndedSynthesis ? {} : { referenceCard: { ...referenceWithoutRows, rows: { dataPtr: ptr } } }),
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
        { timeoutMs: config.timeouts.exploreMs, temperature: 0.1, maxTokens: 2800, reasoningEffort: config.reasoning.catalog },
      );
      const rawArgs = parseToolArguments(result.argumentsRaw) as Record<string, unknown>;
      const synthesizedRowsRaw = Array.isArray(rawArgs?.synthesizedRows) ? (rawArgs.synthesizedRows as Array<Record<string, unknown>>) : null;
      const parsed = ContextualMiniDashboardModelArgsSchema.safeParse(rawArgs);
      if (!parsed.success) throw new InvalidSchemaError("mini-dashboard failed validation", formatIssues(parsed.error));
      const args = parsed.data;
      const isCustomSynthesized = isOpenEndedSynthesis && synthesizedRowsRaw && synthesizedRowsRaw.length > 0;
      const sanitizedSynthRows = isCustomSynthesized
        ? synthesizedRowsRaw.slice(0, 12).map((r) => {
            const clean: Record<string, string | number | boolean | null> = {};
            for (const [k, v] of Object.entries(r)) {
              if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
                clean[k] = v;
              } else if (v !== undefined) {
                clean[k] = String(v);
              }
            }
            return clean;
          })
        : null;
      const known = new Set(publication.descriptor.columns);
      const columns = isCustomSynthesized
        ? args.columns
        : args.columns.filter((c) => known.has(c.key));
      const keepReferenceAction =
        !isCustomSynthesized &&
        PLACEHOLDER_RE.test(args.suggestedAction.scriptPreview);
      const mentionsWrongScenario =
        ctx.ticketId !== "INC-4092" && (/inc-4092/i.test(args.title) || /inc-4092/i.test(args.subtitle));
      const keepReferenceHeading =
        (!isCustomSynthesized &&
          slice.kind === "entra-ca-policies" &&
          slice.rows[0]?.role === "blocking" &&
          (/report-only|ca-004/i.test(args.title) || /report-only|ca-004/i.test(args.subtitle))) ||
        mentionsWrongScenario ||
        (strictRealTenant && (slice.kind === "azure-vms" || slice.kind === "azure-resources"));
      const keepReferenceMetrics =
        mentionsWrongScenario ||
        (strictRealTenant && (slice.kind === "azure-vms" || slice.kind === "azure-resources"));
      const finalRows = sanitizedSynthRows && sanitizedSynthRows.length > 0 ? sanitizedSynthRows : slice.rows;
      if (sanitizedSynthRows && sanitizedSynthRows.length > 0) {
        publishSelection({ ptr, scenarioId: ctx.ticketId, selectedText, sourceQuery: args.sourceQuery, rows: finalRows, tenantId: ctx.tenantId, epoch: publication.fence.epoch, generation: publication.fence.generation });
      }
      const composed = ContextualMiniDashboardSchema.parse({
        ...reference,
        title: keepReferenceHeading ? reference.title : args.title,
        subtitle: keepReferenceHeading ? reference.subtitle : args.subtitle,
        sourceQuery: keepReferenceHeading ? reference.sourceQuery : args.sourceQuery,
        kpis: keepReferenceMetrics ? reference.kpis : args.kpis,
        breakdown: keepReferenceMetrics ? reference.breakdown : args.breakdown,
        columns: columns.length ? columns : reference.columns,
        suggestedAction: keepReferenceAction
          ? reference.suggestedAction
          : { ...args.suggestedAction, ...(args.suggestedAction.targetStepIndex !== undefined && args.suggestedAction.targetStepIndex < brief.steps.length ? {} : { targetStepIndex: reference.suggestedAction.targetStepIndex }) },
        // STRICT RULE: ONLY attach errorCodeReference when the user's selectedText or refinementText explicitly matched an error code in reference.errorCodeReference!
        ...(reference.errorCodeReference ? { errorCodeReference: reference.errorCodeReference } : {}),
        rows: finalRows,
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
