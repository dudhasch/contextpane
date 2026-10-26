import { getHydrateLayoutToolDefinition, type ComponentType, type Layout, type RouterTelemetry, type ViewRecipe } from "@contextpane/catalog";
import { publishDataPlane } from "../local/dataplane.ts";
import { contextForCorrelation, gatherContext } from "../mcp/context.ts";
import { buildLayout, scenarioComponents } from "../local/hydrate.ts";
import { recipeStore } from "../store/recipes.ts";
import { ZERO_USAGE, estimateTokens, telemetry } from "../telemetry.ts";

/** Size of the hydrate_contextpane_layout tool schema (row sets as { dataPtr }) in tokens. */
const TOOL_SCHEMA_TOKENS = estimateTokens(JSON.stringify(getHydrateLayoutToolDefinition()));

export class RecipeNotFoundError extends Error {
  constructor(recipeId: string) {
    super(`Recipe '${recipeId}' not found`);
    this.name = "RecipeNotFoundError";
  }
}

export interface Tier0Result {
  layout: Layout;
  recipe: ViewRecipe;
  telemetry: RouterTelemetry;
}

/**
 * Tier 0 — zero tokens. Binds the three MCP outputs straight into the pinned
 * recipe's component AST. Target: <150 ms end to end in-process.
 */
export async function hydrateRecipe(recipeId: string, scenarioId: string, options: { fresh?: boolean } = {}): Promise<Tier0Result> {
  const started = performance.now();
  const recipe = recipeStore.get(recipeId);
  if (!recipe) throw new RecipeNotFoundError(recipeId);
  const requestId = telemetry.nextRequestId("t0");

  const ctx = await gatherContext(scenarioId, { fresh: options.fresh ?? false });
  // A recipe pins the order of card types; each scenario renders the ones it has data for,
  // and a card the recipe does not know is appended, so no scenario is shown incomplete.
  const available = scenarioComponents(ctx);
  const pinned = [...recipe.pinnedComponents]
    .sort((a, b) => a.order - b.order)
    .map((p) => p.type as ComponentType)
    .filter((t) => available.includes(t));
  const components = [...pinned, ...available.filter((t) => !pinned.includes(t))];
  const latencyMs = Math.round(performance.now() - started);

  const layout = buildLayout(
    ctx,
    {
      tier: "Tier 0",
      provider: "local",
      modelId: "deterministic",
      latencyMs,
      tokensUsed: 0,
      fallbackChain: [],
      validated: true,
      repaired: [],
    },
    { components, recipeId: recipe.recipeId, layoutId: `layout-${recipe.recipeId}-${ctx.scenarioId.toLowerCase()}-${Date.now().toString(36)}` },
  );

  const baseline = telemetry.baselineTier2();
  const promptTokens = estimateTokens(JSON.stringify(contextForCorrelation(ctx, publishDataPlane(ctx).descriptors))) + TOOL_SCHEMA_TOKENS;
  const completionTokens = estimateTokens(JSON.stringify(layout.components));
  const event = telemetry.record({
    requestId,
    endpoint: `/api/recipe/${recipeId}/hydrate`,
    tier: "Tier 0",
    provider: "local",
    modelId: "deterministic",
    latencyMs: Math.round(performance.now() - started),
    tokensUsed: ZERO_USAGE,
    fallbackChain: [],
    tenantId: ctx.tenantId,
    estimatedSavings: {
      tokens: Math.max(promptTokens + completionTokens, baseline.tokens),
      ms: Math.max(0, baseline.ms - latencyMs),
      versus: "full Tier 2 correlate (muse-spark)",
    },
  });
  layout.provenance.latencyMs = event.latencyMs;
  return { layout, recipe, telemetry: event };
}
