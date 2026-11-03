import { describe, expect, test } from "bun:test";

process.env.LIVE_CLOUD_MODE = "false";
const { telemetry, ZERO_USAGE } = await import("./telemetry.ts");

const base = { endpoint: "/api/x", modelId: "m", latencyMs: 5, fallbackChain: [] };

describe("router savings count only real cache / recipe hits (review L7)", () => {
  test("a model failure or offline fallback is not a saving; a recipe and a cache hit are", () => {
    const before = telemetry.stats();
    telemetry.record({ ...base, requestId: "l7-1", tier: "Tier 1B", provider: "local", tokensUsed: ZERO_USAGE, fallbackChain: [{ provider: "meta", modelId: "m", outcome: "error", latencyMs: 3 }] });
    telemetry.record({ ...base, requestId: "l7-2", tier: "Tier 2", provider: "local", tokensUsed: ZERO_USAGE });
    const afterFailures = telemetry.stats();
    expect(afterFailures.zeroTokenRequests).toBe(before.zeroTokenRequests);
    expect(afterFailures.estimatedSavings.tokens).toBe(before.estimatedSavings.tokens);
    expect(afterFailures.fallbackZeroTokenRequests).toBe(before.fallbackZeroTokenRequests + 2);

    telemetry.record({ ...base, requestId: "l7-3", tier: "Tier 0", provider: "local", tokensUsed: ZERO_USAGE, savingKind: "recipe", estimatedSavings: { tokens: 1200, ms: 3000, versus: "Tier 2" } });
    telemetry.record({ ...base, requestId: "l7-4", tier: "Tier 1A", provider: "meta", tokensUsed: ZERO_USAGE, savingKind: "cache-hit", estimatedSavings: { tokens: 300, ms: 2000, versus: "the generating call" } });
    // estimatedSavings without savingKind is ignored: only an explicit hit counts.
    telemetry.record({ ...base, requestId: "l7-5", tier: "Tier 1B", provider: "local", tokensUsed: ZERO_USAGE, estimatedSavings: { tokens: 900, ms: 2500, versus: "constant" } });
    const after = telemetry.stats();
    expect(after.zeroTokenRequests).toBe(before.zeroTokenRequests + 2);
    expect(after.estimatedSavings.tokens).toBe(before.estimatedSavings.tokens + 1500);
  });
});
