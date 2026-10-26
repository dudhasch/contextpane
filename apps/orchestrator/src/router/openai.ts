import type { OpenAIFunctionTool } from "@contextpane/catalog";
import type { ProviderConfig } from "../config.ts";

/**
 * Minimal OpenAI-compatible chat client with forced function calling.
 * Works unchanged against Baseten, Fireworks and the Meta Model API.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ForcedToolCallResult {
  toolName: string;
  argumentsRaw: string;
  usage: TokenUsage;
  latencyMs: number;
  finishReason: string | null;
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    body: string,
  ) {
    super(`${provider} HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "ProviderHttpError";
  }
}

export class ProviderTimeoutError extends Error {
  constructor(provider: string, timeoutMs: number) {
    super(`${provider} timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export class NoKeyError extends Error {
  constructor(provider: string) {
    super(`${provider}: no API key configured`);
    this.name = "NoKeyError";
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Self-hosted vLLM may run without --api-key, so the bearer header is optional. */
function authHeader(provider: ProviderConfig): Record<string, string> {
  return provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {};
}

export interface ChatOptions {
  timeoutMs: number;
  temperature?: number;
  maxTokens?: number;
}

export async function chatWithForcedTool(
  provider: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  tool: OpenAIFunctionTool,
  options: ChatOptions,
): Promise<ForcedToolCallResult> {
  if (!provider.hasKey) throw new NoKeyError(provider.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(provider) },
      body: JSON.stringify({
        model,
        messages,
        tools: [tool],
        tool_choice: { type: "function", function: { name: tool.function.name } },
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) throw new ProviderHttpError(provider.id, response.status, await response.text());
    const json = (await response.json()) as ChatCompletionResponse;
    const choice = json.choices?.[0];
    const call = choice?.message?.tool_calls?.[0]?.function;
    let argumentsRaw = call?.arguments ?? "";
    let toolName = call?.name ?? "";
    // Some servers answer a forced tool with plain JSON content instead of a tool_call.
    if (!argumentsRaw && choice?.message?.content) {
      argumentsRaw = choice.message.content;
      toolName = tool.function.name;
    }
    if (!argumentsRaw) throw new Error(`${provider.id}: response contained no tool call`);
    return {
      toolName,
      argumentsRaw,
      usage: {
        prompt: json.usage?.prompt_tokens ?? 0,
        completion: json.usage?.completion_tokens ?? 0,
        total: json.usage?.total_tokens ?? (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
      },
      latencyMs,
      finishReason: choice?.finish_reason ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ProviderTimeoutError(provider.id, options.timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface TranscriptionResult {
  text: string;
  latencyMs: number;
}

/** OpenAI-compatible /audio/transcriptions (multipart). */
export async function transcribeAudio(
  provider: ProviderConfig,
  model: string,
  audio: { bytes: Uint8Array; mimeType: string; fileName?: string },
  timeoutMs: number,
): Promise<TranscriptionResult> {
  if (!provider.hasKey) throw new NoKeyError(provider.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "json");
    form.append("file", new Blob([audio.bytes.buffer.slice(audio.bytes.byteOffset, audio.bytes.byteOffset + audio.bytes.byteLength) as ArrayBuffer], { type: audio.mimeType }), audio.fileName ?? "voice.webm");
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: authHeader(provider),
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new ProviderHttpError(provider.id, response.status, await response.text());
    const json = (await response.json()) as { text?: string };
    return { text: (json.text ?? "").trim(), latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ProviderTimeoutError(provider.id, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
