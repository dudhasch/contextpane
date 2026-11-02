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

describe("PII vault scoping and free-text coverage", () => {
  test("a reply may rehydrate only tokens its own prompt carried: another tenant's token stays a token", async () => {
    // Mint a token for a tenant B user first, in a prompt sent for tenant B.
    const otherTenant = sessionPiiVault.pseudonymizeText("isaiah.langer@fabrikam-legal.com");
    sessionPiiVault.exposeTo({ tenantId: "tenant-fabrikam-02", ticketId: "CUSTOM-B" }, otherTenant);
    const foreign = otherTenant.match(/upn_tok_\d+/)![0];
    const reply = sessionPiiVault.depseudonymizeJsonText(JSON.stringify({ script: `Remove-MgUser -UserId '${foreign}'` }), new Set());
    expect(reply).toContain(foreign);
    expect(reply).not.toContain("isaiah.langer@fabrikam-legal.com");
    expect(sessionPiiVault.metrics().refusedRehydrations).toBeGreaterThan(0);
  });

  test("scoped calls rehydrate tokens earlier prompts of the same ticket carried", async () => {
    const scope = { tenantId: "tenant-contoso-01", ticketId: "CUSTOM-SCOPE" };
    const first = sessionPiiVault.pseudonymizeText("alex.wilber@contoso.com");
    const allowed = sessionPiiVault.exposeTo(scope, first);
    const token = first.match(/upn_tok_\d+/)![0];
    expect(allowed.has(token)).toBe(true);
    expect(sessionPiiVault.exposedTokens(scope).has(token)).toBe(true);
    expect(sessionPiiVault.exposedTokens({ tenantId: "tenant-fabrikam-02", ticketId: "CUSTOM-SCOPE" }).has(token)).toBe(false);
    expect(sessionPiiVault.depseudonymizeJsonText(`"${token}"`, sessionPiiVault.exposedTokens(scope))).toBe('"alex.wilber@contoso.com"');
  });

  test("known user object ids, device names and phone numbers in free text are vaulted and scanned", () => {
    const vault = new PiiVault(2);
    vault.registerPersonsFrom({ users: [{ upn: "lee.gu@contoso.com", displayName: "Lee Gu", id: "6e7b768e-07e2-4810-8459-485f84f8f204" }], devices: [{ deviceName: "CONTOSO-LT-0417", upn: "lee.gu@contoso.com" }] });
    const text = "User 6e7b768e-07e2-4810-8459-485f84f8f204 on CONTOSO-LT-0417 called from +49 30 1234 5678 or (425) 555-0100; tenant 4cc41c20-8b01-40a3-93c6-b4f1e846f6ea, build 10.0.22631.";
    expect(vault.scanForRawPii(text).sort()).toEqual(["(425) 555-0100", "+49 30 1234 5678", "6e7b768e-07e2-4810-8459-485f84f8f204", "CONTOSO-LT-0417"].sort());
    const out = vault.pseudonymizeText(text);
    expect(out).not.toContain("6e7b768e-07e2-4810-8459-485f84f8f204");
    expect(out).not.toContain("CONTOSO-LT-0417");
    expect(out).not.toContain("1234 5678");
    expect(out).not.toContain("555-0100");
    expect(out).toMatch(/userId_tok_\d+/);
    expect(out).toMatch(/device_tok_\d+/);
    expect(out).toMatch(/phone_tok_\d+/);
    // A GUID that is not a known user (tenant id) and a version string stay readable.
    expect(out).toContain("4cc41c20-8b01-40a3-93c6-b4f1e846f6ea");
    expect(out).toContain("10.0.22631");
    expect(vault.scanForRawPii(out)).toEqual([]);
    expect(vault.depseudonymize(out)).toBe(text);
  });

  test("image parts are refused unless the caller opts in", async () => {
    captured.length = 0;
    const messages = [{ role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } }] }];
    await expect(chatWithForcedTool(provider, "m", messages, tool, { timeoutMs: 5000 })).rejects.toThrow(/CTX_VISION_SEND_IMAGES/);
    expect(captured).toHaveLength(0);
    await chatWithForcedTool(provider, "m", messages, tool, { timeoutMs: 5000, allowImages: true });
    expect(captured).toHaveLength(1);
  });
});
