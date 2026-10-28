import { describe, expect, test } from "bun:test";
import { isOpenWeightProvider, provenanceBadge } from "./format";

describe("provenanceBadge", () => {
  test("cached Glimmer answer names the open weights, the host and the generation time", () => {
    const b = provenanceBadge({ provider: "modal-open-weights", modelId: "muse-glimmer-30b (cached)", latencyMs: 3, cached: true, generatedLatencyMs: 22828 });
    expect(b.label).toBe("Muse Glimmer 30B · Modal L40S · 22.8 s · cached");
    expect(b.tone).toBe("healthy");
  });
  test("live Meta answer and deterministic answer", () => {
    expect(provenanceBadge({ provider: "meta", modelId: "muse-spark-1.3", latencyMs: 2400 }).label).toBe("muse-spark-1.3 · Meta API · 2.4 s");
    expect(provenanceBadge({ provider: "local", modelId: "deterministic", latencyMs: 1 }).label).toBe("deterministic · 0 tokens");
    expect(isOpenWeightProvider("meta")).toBe(false);
  });
});
