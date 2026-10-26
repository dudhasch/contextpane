import { describe, expect, test } from "bun:test";
import { InvalidSchemaError, runChain, type ChainStep } from "./chain.ts";

const correlateSteps = (metaKey: boolean, openWeight: boolean): ChainStep[] => [
  { provider: "modal", modelId: "muse-glimmer-30b", hasKey: openWeight, tier: "Tier 1B" },
  { provider: "baseten", modelId: "meta-models/muse-spark-open-1026", hasKey: false, tier: "Tier 1B" },
  { provider: "meta", modelId: "muse-spark-1.3-contributor", hasKey: metaKey, tier: "Tier 1B" },
  { provider: "meta", modelId: "muse-spark-1.3", hasKey: metaKey, tier: "Tier 2" },
];

describe("runChain", () => {
  test("Meta API alone is a first-class route: unkeyed drop-ins are not recorded", async () => {
    const outcome = await runChain(correlateSteps(true, false), async (step) => step.modelId);
    expect(outcome.winner?.modelId).toBe("muse-spark-1.3-contributor");
    expect(outcome.winner?.tier).toBe("Tier 1B");
    expect(outcome.chain).toEqual([{ provider: "meta", modelId: "muse-spark-1.3-contributor", outcome: "ok", latencyMs: expect.any(Number) }]);
  });

  test("an invalid Tier 1B layout escalates to Tier 2 muse-spark-1.3", async () => {
    const outcome = await runChain(correlateSteps(true, true), async (step) => {
      if (step.tier === "Tier 1B") throw new InvalidSchemaError("layout failed validation", []);
      return step.modelId;
    });
    expect(outcome.winner?.tier).toBe("Tier 2");
    expect(outcome.chain.map((s) => `${s.provider}/${s.modelId}:${s.outcome}`)).toEqual([
      "modal/muse-glimmer-30b:invalid-schema",
      "meta/muse-spark-1.3-contributor:invalid-schema",
      "meta/muse-spark-1.3:ok",
    ]);
  });

  test("with no provider configured every step is reported as no-key", async () => {
    const outcome = await runChain(correlateSteps(false, false), async () => "unreachable");
    expect(outcome.winner).toBeNull();
    expect(outcome.chain.every((s) => s.outcome === "no-key")).toBe(true);
    expect(outcome.chain).toHaveLength(4);
  });
});
