import type { FallbackStep, ProviderId, RouterTier } from "@contextpane/catalog";
import { NoKeyError, ProviderTimeoutError } from "./openai.ts";

/**
 * Provider fallback chain. Each step is attempted in order until one returns a
 * value; every attempt is recorded so the HUD can show the full fallback path.
 * Providers without a key are optional drop-ins: once any step is configured they
 * are left out entirely, so a first-class Meta API answer is not logged as a fallback.
 */

export interface ChainStep {
  provider: ProviderId;
  modelId: string;
  hasKey: boolean;
  /** Router tier this step answers as (correlate escalates Tier 1B → Tier 2). */
  tier?: RouterTier;
}

export class InvalidSchemaError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "InvalidSchemaError";
  }
}

export interface ChainOutcome<T> {
  result: T | null;
  winner: ChainStep | null;
  chain: FallbackStep[];
}

export async function runChain<T>(
  steps: ChainStep[],
  attempt: (step: ChainStep) => Promise<T>,
  onStep?: (step: ChainStep, outcome: FallbackStep) => void,
): Promise<ChainOutcome<T>> {
  const chain: FallbackStep[] = [];
  const configured = steps.filter((s) => s.hasKey);
  for (const step of configured.length ? configured : steps) {
    if (!step.hasKey) {
      const outcome: FallbackStep = { provider: step.provider, modelId: step.modelId, outcome: "no-key", latencyMs: 0 };
      chain.push(outcome);
      onStep?.(step, outcome);
      continue;
    }
    const started = performance.now();
    try {
      const result = await attempt(step);
      const outcome: FallbackStep = { provider: step.provider, modelId: step.modelId, outcome: "ok", latencyMs: Math.round(performance.now() - started) };
      chain.push(outcome);
      onStep?.(step, outcome);
      return { result, winner: step, chain };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      const outcome: FallbackStep = {
        provider: step.provider,
        modelId: step.modelId,
        latencyMs,
        outcome:
          error instanceof NoKeyError
            ? "no-key"
            : error instanceof ProviderTimeoutError
              ? "timeout"
              : error instanceof InvalidSchemaError
                ? "invalid-schema"
                : "error",
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      };
      chain.push(outcome);
      onStep?.(step, outcome);
      console.warn(`[router] ${step.provider}/${step.modelId} -> ${outcome.outcome}: ${outcome.error}`);
    }
  }
  return { result: null, winner: null, chain };
}
