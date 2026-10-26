import {
  VisionExtractionSchema,
  formatIssues,
  parseToolArguments,
  toAadstsLabel,
  zodToToolParameters,
  type OpenAIFunctionTool,
  type RouterTelemetry,
  type VisionExtraction,
} from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { sources } from "../mcp/clients.ts";
import { InvalidSchemaError, runChain } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";

export interface VisionInput {
  tenantId: string;
  ticketId?: string;
  fileName?: string;
  /** data:image/png;base64,... */
  imageDataUri: string;
}

export interface VisionMatch {
  eventId: string;
  upn: string;
  timestamp: string;
  /** Seconds between the screenshot's timestamp and the matched sign-in. */
  deltaSeconds: number | null;
}

export interface VisionResult {
  extraction: VisionExtraction | null;
  match: VisionMatch | null;
  error?: string;
  telemetry: RouterTelemetry;
}

const VISION_TOOL: OpenAIFunctionTool = {
  type: "function",
  function: {
    name: "extract_ticket_telemetry",
    description: "Report the identifiers visible in a customer's error screenshot attached to an MSP ticket.",
    parameters: zodToToolParameters(VisionExtractionSchema),
  },
};

const SYSTEM_PROMPT = `You read screenshots customers attach to managed-service tickets (Windows App / Azure Virtual Desktop / Entra sign-in errors).
Transcribe identifiers exactly as shown: error code, application (client) id, correlation id, timestamp, device name, join type and compliance.
Never guess a value that is not visible; use an empty string instead. Respond only through extract_ticket_telemetry.`;

/** The sign-in event the screenshot shows: same AADSTS code and app id, nearest in time. */
async function matchSignIn(tenantId: string, extraction: VisionExtraction): Promise<VisionMatch | null> {
  const events = (await sources.msgraph.getSignInEvents(tenantId)).data;
  const code = Number.parseInt(extraction.errorCode.replace(/\D/g, ""), 10);
  const at = Date.parse(extraction.timestamp);
  const candidates = events.filter(
    (e) => (Number.isFinite(code) && (e.errorCode === code || e.errorCodeLabel === toAadstsLabel(code))) && (!extraction.appId || e.appId.toLowerCase() === extraction.appId.toLowerCase()),
  );
  if (!candidates.length) return null;
  const scored = candidates.map((e) => ({ e, delta: Number.isFinite(at) ? Math.abs(Date.parse(e.timestamp) - at) / 1000 : null }));
  scored.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  const best = scored[0]!;
  return { eventId: best.e.id, upn: best.e.upn, timestamp: best.e.timestamp, deltaSeconds: best.delta === null ? null : Math.round(best.delta) };
}

/**
 * Tier 2 · Vision — the ticket's screenshot goes to muse-spark-1.3 as an image part and
 * comes back as Zod-validated telemetry, matched against the sign-in log. No model, no
 * extraction: there is no deterministic way to read pixels, so this reports an error instead.
 */
export async function visionExtract(input: VisionInput): Promise<VisionResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("vision");
  let usage: TokenUsage = { ...ZERO_USAGE };
  const outcome = await runChain([{ provider: "meta", modelId: models.metaVision, hasKey: providers.meta.hasKey && !config.forceLocal, tier: "Vision" }], async (step) => {
    const result = await chatWithForcedTool(
      providers.meta,
      step.modelId,
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Ticket ${input.ticketId ?? "?"} attachment ${input.fileName ?? "screenshot.png"}. Extract the telemetry.` },
            { type: "image_url", image_url: { url: input.imageDataUri } },
          ],
        },
      ],
      VISION_TOOL,
      { timeoutMs: config.timeouts.visionMs, temperature: 0, maxTokens: 3000, reasoningEffort: "low" },
    );
    const parsed = VisionExtractionSchema.safeParse(parseToolArguments(result.argumentsRaw));
    if (!parsed.success) throw new InvalidSchemaError("vision extraction failed validation", formatIssues(parsed.error));
    usage = result.usage;
    return parsed.data;
  });

  const extraction = outcome.result;
  const match = extraction ? await matchSignIn(input.tenantId, extraction).catch(() => null) : null;
  const event = telemetry.record({
    requestId,
    endpoint: "/api/vision-extract",
    tier: "Vision",
    provider: extraction ? "meta" : "local",
    modelId: extraction ? models.metaVision : "none",
    latencyMs: Math.round(performance.now() - started),
    tokensUsed: usage,
    fallbackChain: outcome.chain,
    tenantId: input.tenantId,
  });
  const error = extraction ? undefined : (outcome.chain.at(-1)?.error ?? (providers.meta.hasKey ? "vision model unavailable" : "No META_API_KEY: vision needs the Meta Model API"));
  return { extraction, match, ...(error ? { error } : {}), telemetry: event };
}
