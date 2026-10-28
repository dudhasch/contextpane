import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { OpenAIFunctionTool } from "@contextpane/catalog";
import { config, type ProviderConfig } from "../config.ts";
import { buildHoverResponseFormat } from "./glimmer-payload.ts";

/** CTX_ROUTER_DEBUG=1 appends every model answer (no headers, no keys) to data/router-debug.jsonl. */
const DEBUG_DIR = config.dataDir;

/**
 * Minimal OpenAI-compatible chat client with forced function calling.
 * Works unchanged against Baseten, Fireworks and the Meta Model API.
 */

/** OpenAI-style multimodal parts; images travel as base64 data URIs. */
export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
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

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ChatOptions {
  timeoutMs: number;
  temperature?: number;
  /** Includes reasoning tokens on reasoning models, so leave headroom above the visible answer. */
  maxTokens?: number;
  /** Meta Model API: reasoning_effort. Open-weight Muse Glimmer: the template's reasoning_strength. */
  reasoningEffort?: ReasoningEffort;
}

const OPEN_WEIGHT_PROVIDERS = new Set<string>(["modal-open-weights", "runpod", "local-glimmer-30b"]);

/** Muse Glimmer cannot switch reasoning off; its chat template takes low | medium | high | xhigh. */
function reasoningParams(provider: ProviderConfig, effort: ReasoningEffort | undefined): Record<string, unknown> {
  if (!effort) return {};
  if (provider.id === "meta") return { reasoning_effort: effort };
  if (!OPEN_WEIGHT_PROVIDERS.has(provider.id)) return {};
  const strength = effort === "minimal" || effort === "low" ? "low" : effort;
  return { chat_template_kwargs: { reasoning_strength: strength } };
}

/**
 * Providers that reject a named tool_choice. The Meta Model API only accepts
 * `"auto"` (HTTP 400 otherwise); any other provider answering that way is added
 * on its first 400 and served with `"auto"` from then on.
 */
const autoToolChoiceOnly = new Set<string>(["meta"]);

/** Open-weight Glimmer hover calls carry the strict HoverDiagnostic JSON schema (GBNF on llama-server). */
const OPEN_WEIGHT_PROVIDER_IDS = new Set(["modal-open-weights", "runpod", "local-glimmer-30b"]);

function rejectsNamedToolChoice(error: unknown): boolean {
  return error instanceof ProviderHttpError && error.status === 400 && /tool_choice/i.test(error.message);
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
  const post = async (named: boolean): Promise<Response> => {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(provider) },
      body: JSON.stringify({
        model,
        // With "auto" the single tool is still the only way to answer; say so explicitly.
        messages: named ? messages : [...messages, { role: "system", content: `Answer by calling the ${tool.function.name} tool exactly once. Do not reply with text.` }],
        tools: [tool],
        ...(OPEN_WEIGHT_PROVIDER_IDS.has(provider.id) && tool.function.name === "emit_hover_diagnostic" ? { response_format: buildHoverResponseFormat() } : {}),
        tool_choice: named ? { type: "function", function: { name: tool.function.name } } : "auto",
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 4096,
        ...reasoningParams(provider, options.reasoningEffort),
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ProviderHttpError(provider.id, response.status, await response.text());
    return response;
  };
  try {
    let response: Response;
    try {
      response = await post(!autoToolChoiceOnly.has(provider.id));
    } catch (error) {
      if (autoToolChoiceOnly.has(provider.id) || !rejectsNamedToolChoice(error)) throw error;
      autoToolChoiceOnly.add(provider.id);
      response = await post(false);
    }
    const latencyMs = Math.round(performance.now() - started);
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
    if (process.env.CTX_ROUTER_DEBUG) {
      mkdirSync(DEBUG_DIR, { recursive: true });
      appendFileSync(
        join(DEBUG_DIR, "router-debug.jsonl"),
        `${JSON.stringify({ at: new Date().toISOString(), provider: provider.id, model, tool: tool.function.name, toolName, finishReason: choice?.finish_reason ?? null, usage: json.usage, latencyMs, argumentsRaw })}\n`,
      );
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

/**
 * Speech to text. The Meta Model API has no /audio/transcriptions: muse-voice-transcribe
 * is served by POST /asr/transcribe with a JSON `request` part and an `audio` part, and
 * accepts 16-bit mono PCM WAV at 16 or 24 kHz only (see router/wav.ts). Other providers
 * get the OpenAI-compatible /audio/transcriptions.
 */
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
  const blob = new Blob([audio.bytes.buffer.slice(audio.bytes.byteOffset, audio.bytes.byteOffset + audio.bytes.byteLength) as ArrayBuffer], { type: audio.mimeType });
  try {
    const form = new FormData();
    const meta = provider.id === "meta";
    if (meta) {
      form.append("request", new Blob([JSON.stringify({ model, audioEncoding: "WAV" })], { type: "application/json" }), "request.json");
      form.append("audio", blob, audio.fileName ?? "voice.wav");
    } else {
      form.append("model", model);
      form.append("response_format", "json");
      form.append("file", blob, audio.fileName ?? "voice.webm");
    }
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}${meta ? "/asr/transcribe" : "/audio/transcriptions"}`, {
      method: "POST",
      headers: authHeader(provider),
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new ProviderHttpError(provider.id, response.status, await response.text());
    const json = (await response.json()) as { text?: string; transcript?: string };
    const text = (json.transcript ?? json.text ?? "").trim();
    const latencyMs = Math.round(performance.now() - started);
    if (process.env.CTX_ROUTER_DEBUG) {
      mkdirSync(DEBUG_DIR, { recursive: true });
      // Transcript length only: the spoken command may name users.
      appendFileSync(join(DEBUG_DIR, "router-debug.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), provider: provider.id, model, tool: "asr-transcribe", latencyMs, transcriptChars: text.length })}\n`);
    }
    return { text, latencyMs };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ProviderTimeoutError(provider.id, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
