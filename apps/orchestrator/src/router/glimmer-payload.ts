/**
 * Grammar-constrained hover payloads for the open-weight Muse Glimmer 30B
 * (llama-server). llama-server compiles `response_format: { type: "json_schema" }`
 * into a GBNF grammar, so the model can only emit the HoverDiagnostic shape.
 *
 * The schema mirrors HoverDiagnosticArgs in @contextpane/catalog
 * (HoverDiagnosticPopover minus providerTelemetry/latencyBudgetMs, which the
 * orchestrator stamps). Strict mode: additionalProperties:false everywhere and
 * every property required, with optionals as nullable. That leaves no slot for
 * a hallucinated `dataPtr` / `ptr://…` — the hover diagnostic carries none;
 * ptr:// pointers belong only to the Tier 1B/2 layout data plane.
 *
 * Not wired into tier1-hover.ts yet (parent owns that wiring); this module is
 * the payload the open-weight step will send instead of / in addition to the
 * forced tool call. Python mirror: modal-sandbox/glimmer_open_weights.py.
 */
import type { ChatMessage } from "./openai.ts";

const NO_PTR = "Plain text only; never emit a ptr:// data-plane pointer (the hover diagnostic carries no dataPtr).";

const entityType = { type: "string", enum: ["upn", "group", "device", "policy", "errorCode", "sku", "resource", "setting", "ticket", "contract"] } as const;
const healthState = { type: "string", enum: ["healthy", "warning", "critical", "unknown"] } as const;

export const HOVER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entityId: { type: "string", minLength: 1, description: NO_PTR },
    entityType,
    status: healthState,
    headline: { type: "string", maxLength: 120, description: NO_PTR },
    errorCodeTranslation: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string", description: NO_PTR },
            meaning: { type: "string", maxLength: 240 },
            likelyCause: { type: "string", maxLength: 300 },
            docsUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["code", "meaning", "likelyCause", "docsUrl"],
        },
        { type: "null" },
      ],
    },
    facts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", maxLength: 40 },
          value: { type: "string", maxLength: 200, description: NO_PTR },
          mono: { type: "boolean" },
          tone: { anyOf: [healthState, { type: "null" }] },
        },
        required: ["label", "value", "mono", "tone"],
      },
    },
    quickActions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1, maxLength: 40 },
          kind: {
            type: "string",
            enum: ["inspect-policy", "stage-license-fix", "stage-intune-fix", "view-diff", "generate-fix", "open-sign-in-logs", "custom"],
          },
          description: { anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
          targetEntityId: { anyOf: [{ type: "string", description: NO_PTR }, { type: "null" }] },
          destructive: { type: "boolean" },
        },
        required: ["id", "label", "kind", "description", "targetEntityId", "destructive"],
      },
    },
  },
  required: ["entityId", "entityType", "status", "headline", "errorCodeTranslation", "facts", "quickActions"],
} as const;

export interface HoverResponseFormat {
  type: "json_schema";
  json_schema: { name: "HoverDiagnostic"; strict: true; schema: typeof HOVER_JSON_SCHEMA };
}

/** Fresh (mutable, serialisable) copy per call so callers cannot mutate the shared schema. */
export function buildHoverResponseFormat(): HoverResponseFormat {
  return structuredClone({ type: "json_schema", json_schema: { name: "HoverDiagnostic", strict: true, schema: HOVER_JSON_SCHEMA } });
}

/** Inference flags the llama-server is launched with (see glimmer_open_weights.py INFERENCE_CONFIG). */
export const OPEN_WEIGHT_INFERENCE_CONFIG = {
  grammarConstrained: true,
  kvCacheQuant: "q8_0",
  speculativeDraftMax: 8,
  speculativeDraftMin: 2,
} as const;

export interface OpenWeightHoverPayload {
  model: string;
  messages: ChatMessage[];
  response_format: HoverResponseFormat;
  temperature: number;
  max_tokens: number;
  stream: false;
}

/** Chat payload for one grammar-constrained hover call to the open-weight endpoint. */
export function buildOpenWeightHoverPayload(input: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): OpenWeightHoverPayload {
  return {
    model: input.model,
    messages: input.messages,
    response_format: buildHoverResponseFormat(),
    temperature: input.temperature ?? 0,
    // Glimmer reasons before answering and the server budget is not enforced; mirrors openWeightHoverMaxTokens.
    max_tokens: input.maxTokens ?? 3000,
    stream: false,
  };
}
