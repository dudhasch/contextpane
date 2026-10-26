import { afterAll, describe, expect, test } from "bun:test";
import type { OpenAIFunctionTool } from "@contextpane/catalog";
import type { ProviderConfig } from "../config.ts";
import { chatWithForcedTool } from "./openai.ts";

const seen: Array<{ toolChoice: unknown; reasoningEffort: unknown }> = [];
// Mimics the Meta Model API: a named tool_choice is a 400, "auto" answers with a tool call.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { tool_choice: unknown; reasoning_effort?: unknown };
    seen.push({ toolChoice: body.tool_choice, reasoningEffort: body.reasoning_effort });
    if (body.tool_choice !== "auto") {
      return Response.json({ error: { message: 'only `"auto"` is supported for `tool_choice`', param: "tool_choice" } }, { status: 400 });
    }
    return Response.json({
      choices: [{ finish_reason: "tool_calls", message: { content: "Calling the tool.", tool_calls: [{ function: { name: "emit_probe", arguments: '{"ok":true}' } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  },
});
afterAll(() => server.stop(true));

const tool: OpenAIFunctionTool = { type: "function", function: { name: "emit_probe", description: "probe", parameters: { type: "object", properties: {} } } };
const provider = (id: ProviderConfig["id"]): ProviderConfig => ({ id, label: id, baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "test", hasKey: true });

describe("chatWithForcedTool", () => {
  test("a provider that rejects a named tool_choice is retried once with auto, then remembered", async () => {
    seen.length = 0;
    const first = await chatWithForcedTool(provider("baseten"), "m", [{ role: "user", content: "hi" }], tool, { timeoutMs: 5000 });
    expect(first.argumentsRaw).toBe('{"ok":true}');
    expect(seen.map((s) => s.toolChoice)).toEqual([{ type: "function", function: { name: "emit_probe" } }, "auto"]);

    seen.length = 0;
    await chatWithForcedTool(provider("baseten"), "m", [{ role: "user", content: "hi" }], tool, { timeoutMs: 5000 });
    expect(seen.map((s) => s.toolChoice)).toEqual(["auto"]);
  });

  test("the Meta Model API gets auto and reasoning_effort from the first request", async () => {
    seen.length = 0;
    await chatWithForcedTool(provider("meta"), "muse-spark-1.3", [{ role: "user", content: "hi" }], tool, { timeoutMs: 5000, reasoningEffort: "minimal" });
    expect(seen).toEqual([{ toolChoice: "auto", reasoningEffort: "minimal" }]);
  });
});
