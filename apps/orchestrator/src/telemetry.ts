import { RouterTelemetrySchema, type FallbackStep, type ProviderId, type RouterTelemetry, type RouterTier } from "@contextpane/catalog";
import { config } from "./config.ts";

/**
 * Router telemetry bus. Every tier reports exactly one event per request; the
 * HUD subscribes over WebSocket and the savings panel reads `stats()`.
 */

export type TelemetryListener = (event: RouterTelemetry) => void;

interface TierStats {
  requests: number;
  totalLatencyMs: number;
  totalTokens: number;
  byProvider: Record<string, number>;
}

/** Baseline cost of a full Tier 2 correlate, refined whenever a real one is observed. */
const DEFAULT_TIER2_BASELINE = { tokens: 6200, ms: 4800 };

class TelemetryBus {
  private listeners = new Set<TelemetryListener>();
  private history: RouterTelemetry[] = [];
  private tiers = new Map<RouterTier, TierStats>();
  private savings = { tokens: 0, ms: 0, zeroTokenRequests: 0 };
  private tier2Baseline = { ...DEFAULT_TIER2_BASELINE };
  private counter = 0;

  nextRequestId(prefix = "req"): string {
    this.counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.counter.toString(36)}`;
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(input: Omit<RouterTelemetry, "timestamp" | "liveCloudMode"> & { timestamp?: string }): RouterTelemetry {
    const event = RouterTelemetrySchema.parse({
      ...input,
      timestamp: input.timestamp ?? new Date().toISOString(),
      liveCloudMode: config.liveCloudMode,
    });
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();

    const stats = this.tiers.get(event.tier) ?? { requests: 0, totalLatencyMs: 0, totalTokens: 0, byProvider: {} };
    stats.requests += 1;
    stats.totalLatencyMs += event.latencyMs;
    stats.totalTokens += event.tokensUsed.total;
    stats.byProvider[event.provider] = (stats.byProvider[event.provider] ?? 0) + 1;
    this.tiers.set(event.tier, stats);

    if (event.tier === "Tier 2" && event.provider !== "local" && event.tokensUsed.total > 0) {
      this.tier2Baseline = { tokens: event.tokensUsed.total, ms: event.latencyMs };
    }
    if (event.estimatedSavings) {
      this.savings.tokens += event.estimatedSavings.tokens;
      this.savings.ms += event.estimatedSavings.ms;
      this.savings.zeroTokenRequests += 1;
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[telemetry] listener failed", error);
      }
    }
    return event;
  }

  baselineTier2() {
    return { ...this.tier2Baseline };
  }

  recent(limit = 25): RouterTelemetry[] {
    return this.history.slice(-limit);
  }

  stats() {
    const tiers = Object.fromEntries(
      [...this.tiers.entries()].map(([tier, s]) => [
        tier,
        {
          requests: s.requests,
          avgLatencyMs: s.requests ? Math.round(s.totalLatencyMs / s.requests) : 0,
          totalTokens: s.totalTokens,
          byProvider: s.byProvider,
        },
      ]),
    );
    const totalRequests = [...this.tiers.values()].reduce((n, s) => n + s.requests, 0);
    const totalTokens = [...this.tiers.values()].reduce((n, s) => n + s.totalTokens, 0);
    return {
      totalRequests,
      totalTokens,
      zeroTokenRequests: this.savings.zeroTokenRequests,
      estimatedSavings: {
        tokens: this.savings.tokens,
        ms: this.savings.ms,
        usd: Math.round((this.savings.tokens / 1_000_000) * config.pricing.usdPer1MTokens * 10_000) / 10_000,
      },
      pricing: config.pricing,
      tier2Baseline: this.tier2Baseline,
      tiers,
      subscribers: this.listeners.size,
      liveCloudMode: config.liveCloudMode,
    };
  }
}

export const telemetry = new TelemetryBus();

/* -------------------------------------------------------------------------- */
/* Helpers for tiers                                                           */
/* -------------------------------------------------------------------------- */

export function noKeyStep(provider: ProviderId, modelId: string): FallbackStep {
  return { provider, modelId, outcome: "no-key", latencyMs: 0 };
}

export const ZERO_USAGE = { prompt: 0, completion: 0, total: 0 };

/** Rough token estimate (4 chars/token) used only for savings maths on Tier 0. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
