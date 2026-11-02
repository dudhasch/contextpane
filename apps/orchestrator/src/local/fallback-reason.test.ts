import { describe, expect, spyOn, test } from "bun:test";
import { SubAgentTaskRecordSchema } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const openai = await import("../router/openai.ts");
const { MODEL_CALLS_DISABLED } = await import("../router/fallback-cause.ts");
const { buildSubAgentPipelineRecords, generateClarifyingQuestions, synthesizeCustomRemediation } = await import("./subagent-orchestrator.ts");
const { assessTicketElementNeeds } = await import("./dynamic-catalog.ts");

const TICKET = { title: "Key Vault access", body: "Lynne cannot read secrets in kv-contoso-fin-02 since Monday." };

describe("a fallback says why (review item 6)", () => {
  test("offline: every model stage records that model calls are disabled", async () => {
    const clarifier = await generateClarifyingQuestions(TICKET);
    expect(clarifier.fallbackReason).toBe(MODEL_CALLS_DISABLED);
    const coder = await synthesizeCustomRemediation({ scenarioId: "CUSTOM-FB0", ticketTitle: TICKET.title, ticketBody: TICKET.body });
    expect(coder._meta?.fallbackReason).toBe(MODEL_CALLS_DISABLED);
    const routing = await assessTicketElementNeeds({ ...TICKET, matchedSeededComponents: [] });
    expect(routing.fallbackReason).toBe(MODEL_CALLS_DISABLED);
  });

  test("a provider error is logged and carried to the clarifier, the coder and the gatekeeper results", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const enabledSpy = spyOn(openai, "metaCallsEnabled").mockReturnValue(true);
    const chatSpy = spyOn(openai, "chatWithForcedTool").mockRejectedValue(new openai.ProviderHttpError("meta", 429, "rate limited"));
    try {
      const clarifier = await generateClarifyingQuestions(TICKET);
      const coder = await synthesizeCustomRemediation({ scenarioId: "CUSTOM-FB1", ticketTitle: TICKET.title, ticketBody: TICKET.body });
      const routing = await assessTicketElementNeeds({ ...TICKET, matchedSeededComponents: [] });
      for (const reason of [clarifier.fallbackReason, coder._meta?.fallbackReason, routing.fallbackReason]) expect(reason).toContain("meta HTTP 429: rate limited");
      expect(clarifier.source).toBe("fallback-on-error");
      expect(warn.mock.calls.some((c) => String(c[0]).includes("[coder] model path failed"))).toBe(true);
    } finally {
      chatSpy.mockRestore();
      enabledSpy.mockRestore();
      warn.mockRestore();
    }
  });

  test("a reply that fails validation is named as a rejected reply", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const enabledSpy = spyOn(openai, "metaCallsEnabled").mockReturnValue(true);
    const chatSpy = spyOn(openai, "chatWithForcedTool").mockResolvedValue({ toolName: "x", argumentsRaw: JSON.stringify({ title: "t", powershellScript: "short" }), usage: { prompt: 1, completion: 1, total: 2 }, latencyMs: 1, finishReason: "tool_calls" });
    try {
      const coder = await synthesizeCustomRemediation({ scenarioId: "CUSTOM-FB2", ticketTitle: TICKET.title, ticketBody: TICKET.body });
      expect(coder._meta?.fallbackReason).toBe("model reply rejected: no usable powershellScript");
    } finally {
      chatSpy.mockRestore();
      enabledSpy.mockRestore();
      warn.mockRestore();
    }
  });

  test("the pipeline record carries the reason and the schema accepts it", () => {
    const records = buildSubAgentPipelineRecords({
      scenarioId: "CUSTOM-FB3",
      title: TICKET.title,
      body: TICKET.body,
      questions: [],
      elementIds: [],
      gatekeeperModel: "deterministic-router",
      synthesizerModel: "muse-wonder-1.0",
      measurements: { 4: { latencyMs: 5, status: "fallback", source: "fallback-on-error", fallbackReason: "meta HTTP 429: rate limited" } },
    });
    const s4 = records.find((r) => r.stepIndex === 4)!;
    expect(s4.fallbackReason).toBe("meta HTTP 429: rate limited");
    expect(SubAgentTaskRecordSchema.parse(s4).fallbackReason).toBe("meta HTTP 429: rate limited");
    expect(records.find((r) => r.stepIndex === 2)!.fallbackReason).toBeUndefined();
  });
});
