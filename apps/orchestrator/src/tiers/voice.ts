import {
  SteerLayoutArgsSchema,
  formatIssues,
  getSteerLayoutToolDefinition,
  parseToolArguments,
  type RouterTelemetry,
  type SteerLayoutArgs,
} from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { parseSteerIntent } from "../local/voice-intent.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, transcribeAudio, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";

export interface VoiceInput {
  tenantId?: string;
  text?: string;
  audioBase64?: string;
  mimeType?: string;
}

export interface VoiceResult {
  transcript: string;
  intent: SteerLayoutArgs;
  transcription: { provider: string; modelId: string; latencyMs: number } | null;
  intentSource: "deterministic" | "model";
  telemetry: RouterTelemetry;
}

const SYSTEM_PROMPT = `You interpret short spoken operator commands for the ContextPane canvas (components: TenantSummaryHeader, LicenseDriftCard, EntraSignInTimeline, IaCDriftBanner; tenants: tenant-contoso-01 "Contoso Finance", tenant-fabrikam-02 "Fabrikam Legal").
Map the command to exactly one intent via steer_contextpane_layout. Prefer filter for "show/only/just", switch-tenant when a tenant is named, pin for "pin/save/remember", generate-fix for fix/remediation/PR requests, reset for "show everything".`;

/**
 * Multimodal voice steering: audio (base64) → muse-voice-transcribe → text, then
 * a deterministic intent parser with muse-spark escalation for ambiguous phrases.
 */
export async function voiceSteer(input: VoiceInput): Promise<VoiceResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("voice");
  const chain: RouterTelemetry["fallbackChain"] = [];
  let transcript = (input.text ?? "").trim();
  let transcription: VoiceResult["transcription"] = null;
  let usage: TokenUsage = { ...ZERO_USAGE };
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic";

  if (input.audioBase64) {
    const bytes = Uint8Array.from(Buffer.from(input.audioBase64, "base64"));
    const steps: ChainStep[] = [{ provider: "meta", modelId: models.metaVoice, hasKey: providers.meta.hasKey && !config.forceLocal }];
    const outcome = await runChain(steps, async (step) => {
      const providerConfig = providers.meta;
      return transcribeAudio(providerConfig, step.modelId, { bytes, mimeType: input.mimeType ?? "audio/webm" }, config.timeouts.voiceMs);
    });
    chain.push(...outcome.chain);
    if (outcome.result && outcome.winner) {
      transcript = outcome.result.text || transcript;
      transcription = { provider: outcome.winner.provider, modelId: outcome.winner.modelId, latencyMs: outcome.result.latencyMs };
      provider = "meta";
      modelId = outcome.winner.modelId;
    } else if (!transcript) {
      throw new Error("Audio received but no transcription provider is configured (set META_API_KEY) and no text fallback was supplied");
    }
  }
  if (!transcript) throw new Error("voice-steer needs `text` or `audioBase64`");

  let intent = parseSteerIntent(transcript);
  let intentSource: VoiceResult["intentSource"] = "deterministic";
  const steerSteps: ChainStep[] = [
    { provider: "baseten", modelId: models.basetenSpark, hasKey: providers.baseten.hasKey },
    { provider: "meta", modelId: models.metaSpark, hasKey: providers.meta.hasKey },
  ];
  if (intent.confidence < 0.7 && !config.forceLocal && steerSteps.some((s) => s.hasKey)) {
    const tool = getSteerLayoutToolDefinition();
    const outcome = await runChain(steerSteps, async (step) => {
      const providerConfig = providers[step.provider as "baseten" | "meta"];
      const result = await chatWithForcedTool(
        providerConfig,
        step.modelId,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ transcript, currentTenantId: input.tenantId ?? null, deterministicGuess: intent }) },
        ],
        tool,
        { timeoutMs: config.timeouts.voiceMs, temperature: 0, maxTokens: 400 },
      );
      const parsed = SteerLayoutArgsSchema.safeParse(parseToolArguments(result.argumentsRaw));
      if (!parsed.success) throw new InvalidSchemaError("steer intent failed validation", formatIssues(parsed.error));
      return { intent: parsed.data, usage: result.usage };
    });
    chain.push(...outcome.chain);
    if (outcome.result && outcome.winner) {
      intent = outcome.result.intent;
      intentSource = "model";
      usage = outcome.result.usage;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
    }
  }

  const event = telemetry.record({
    requestId,
    endpoint: "/api/voice-steer",
    tier: "Voice",
    provider,
    modelId,
    latencyMs: Math.round(performance.now() - started),
    tokensUsed: usage,
    fallbackChain: chain,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  });
  return { transcript, intent, transcription, intentSource, telemetry: event };
}
