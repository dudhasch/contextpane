import { afterAll, describe, expect, test } from "bun:test";
import { PiiVault, sessionPiiVault, type OpenAIFunctionTool } from "@contextpane/catalog";
import type { ProviderConfig } from "../config.ts";
import { chatWithForcedTool } from "./openai.ts";

const captured: string[] = [];
// Echoes the first upn token it was sent back as the tool argument, like a model writing a script for that user.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const raw = await req.text();
    captured.push(raw);
    const token = raw.match(/upn_tok_\d+/)?.[0] ?? "none";
    return Response.json({
      choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ function: { name: "emit_script", arguments: JSON.stringify({ script: `Set-MgUserLicense -UserId '${token}'` }) } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  },
});
afterAll(() => server.stop(true));

const tool: OpenAIFunctionTool = { type: "function", function: { name: "emit_script", description: "script", parameters: { type: "object", properties: { script: { type: "string" } } } } };
const provider: ProviderConfig = { id: "baseten", label: "test", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "test", hasKey: true };

describe("PII vault on outgoing prompts", () => {
  test("a UPN, the person's name and a public IP in a ticket body never reach the provider, and the answer is mapped back", async () => {
    captured.length = 0;
    const body =
      "Ticket: Megan Bowen (megan.bowen@c4a8shili.onmicrosoft.com) cannot open Teams from 81.2.69.160 since this morning. " +
      "The NSG allows 10.0.0.0/16 and 0.0.0.0/0 on 3389.";
    const result = await chatWithForcedTool(
      provider,
      "m",
      [
        { role: "system", content: "You write PowerShell." },
        { role: "user", content: [{ type: "text", text: body }] },
      ],
      tool,
      { timeoutMs: 5000 },
    );

    expect(captured).toHaveLength(1);
    const prompt = captured[0]!;
    expect(prompt).not.toContain("megan.bowen@c4a8shili.onmicrosoft.com");
    expect(prompt).not.toContain("Megan Bowen");
    expect(prompt).not.toContain("81.2.69.160");
    expect(prompt).toMatch(/upn_tok_\d+/);
    // Network plumbing stays readable for the model.
    expect(prompt).toContain("10.0.0.0/16");
    expect(prompt).toContain("0.0.0.0/0");

    expect(JSON.parse(result.argumentsRaw).script).toBe("Set-MgUserLicense -UserId 'megan.bowen@c4a8shili.onmicrosoft.com'");
    const metrics = sessionPiiVault.metrics();
    expect(metrics.promptsScanned).toBeGreaterThan(0);
    expect(metrics.zeroRawPiiInLlmPrompt).toBe(true);
  });

  test("the metric is computed: a prompt that still carries raw PII flips zeroRawPiiInLlmPrompt", () => {
    const vault = new PiiVault(1);
    expect(vault.recordPrompt(vault.pseudonymizeText("clean adele.vance@contoso.com"))).toEqual([]);
    expect(vault.metrics().zeroRawPiiInLlmPrompt).toBe(true);
    expect(vault.recordPrompt("raw adele.vance@contoso.com slipped through")).toContain("adele.vance@contoso.com");
    expect(vault.metrics()).toMatchObject({ zeroRawPiiInLlmPrompt: false, promptsScanned: 2, rawPiiPromptHits: 1 });
  });
});
