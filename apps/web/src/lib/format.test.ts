import { describe, expect, test } from "bun:test";
import { humanizeSource, humanizeStatus, isOpenWeightProvider, provenanceBadge, stageLabel } from "./format";

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

describe("stageLabel", () => {
  test("sub-agent stage ids read as plain English", () => {
    expect(stageLabel("agent:3:routed")).toBe("Plan routed");
    expect(stageLabel("agent:1:start")).toBe("Clarifier");
    expect(stageLabel("agent:4:done")).toBe("Coder done");
    expect(stageLabel("agent:9:done")).toBe("Agent 9 done");
  });
  test("pipeline stage ids and unknown ids", () => {
    expect(stageLabel("plan:start")).toBe("Planning");
    expect(stageLabel("bundle:ready")).toBe("Bundle ready");
    expect(stageLabel("mcp:done")).toBe("MCP data in");
    expect(stageLabel("preflight:done")).toBe("Pre-flight done");
    expect(stageLabel("synth:start")).toBe("Synth");
    expect(stageLabel("cache_warm")).toBe("Cache warm");
  });
});

describe("enum slugs", () => {
  test("sources and statuses render natural English", () => {
    expect(humanizeSource("seeded-manifest")).toBe("Lab");
    expect(humanizeSource("live-graph")).toBe("Live Graph read");
    expect(humanizeStatus("report-only")).toBe("Report-only");
    expect(humanizeStatus("break-glass")).toBe("Break-glass");
  });
});
