import type {
  ExecutionMode,
  ActionApprovalDrawer,
  AuditEntry,
  ComponentType,
  Convergence,
  EntityType,
  HoverDiagnosticPopover,
  Layout,
  RouterTelemetry,
  ScenarioBrief,
  ScenarioListItem,
  SteerLayoutArgs,
  ViewRecipe,
  VisionExtraction,
} from "@contextpane/catalog";

/* -------------------------------------------------------------------------- */
/* Response shapes (mirror apps/orchestrator/src/app.ts)                       */
/* -------------------------------------------------------------------------- */

export type ErpAttachment = ScenarioBrief["attachments"][number];

export interface BriefResponse {
  brief: ScenarioBrief;
  gatherLatencyMs: number;
  transport: string;
  fallbackReasons: string[];
}

export interface ProgressEvent {
  stage: string;
  message: string;
  at: string;
  elapsedMs: number;
  data?: Record<string, unknown>;
}

export interface CorrelateResponse {
  layout: Layout;
  telemetry: RouterTelemetry;
  context: { gatherLatencyMs: number; transport: string; sources: Record<string, string>; fallbackReasons: string[] };
}

export interface HydrateResponse {
  layout: Layout;
  recipe: ViewRecipe;
  telemetry: RouterTelemetry;
}

export interface HoverResponse {
  popover: HoverDiagnosticPopover;
  telemetry: RouterTelemetry;
}

export interface RemediateResponse {
  drawer: ActionApprovalDrawer;
  telemetry: RouterTelemetry;
}

export interface ApproveResponse {
  drawer: ActionApprovalDrawer & { executionLog: string[] };
  convergence: Convergence | null;
}

export interface ResetDriftResponse {
  ok: boolean;
  latencyMs: number;
  results: Array<{
    scenarioId: string;
    tenantId: string;
    source: "live-graph" | "simulated";
    fallbackReason?: string;
    latencyMs: number;
    summary: string;
    items: string[];
    failed: Array<{ id: string; status: number; error?: string }>;
  }>;
}

export interface VisionResponse {
  extraction: VisionExtraction | null;
  match: { eventId: string; upn: string; timestamp: string; deltaSeconds: number | null } | null;
  error?: string;
  telemetry: RouterTelemetry;
}

export interface VoiceResponse {
  transcript: string;
  intent: SteerLayoutArgs;
  transcription: { provider: string; modelId: string; latencyMs: number } | null;
  intentSource: "deterministic" | "model";
  telemetry: RouterTelemetry;
}

export interface TelemetryStats {
  totalRequests: number;
  totalTokens: number;
  zeroTokenRequests: number;
  estimatedSavings: { tokens: number; ms: number; usd?: number };
  pricing?: { usdPer1MTokens: number };
  tier2Baseline: { tokens: number; ms: number };
  tiers: Record<string, { requests: number; avgLatencyMs: number; totalTokens: number; byProvider: Record<string, number> }>;
  subscribers: number;
  liveCloudMode: boolean;
}

export interface HealthResponse {
  ok: boolean;
  liveCloudMode: boolean;
  forceLocal: boolean;
  providers: Array<{ id: string; label: string; hasKey: boolean }>;
  mcp: { transport: string; servers: Array<{ name: string; ok: boolean; tools?: number }> };
  github?: { origin: string | null; ghInstalled: boolean; ghAuthenticated: boolean; account: string | null; prOnApprove: boolean; prBase: string };
}

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                               */
/* -------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", accept: "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  scenarios: () => request<{ scenarios: ScenarioListItem[] }>("/api/scenarios"),
  brief: (scenarioId: string, fresh = false) => request<BriefResponse>(`/api/scenarios/${scenarioId}/brief${fresh ? "?refresh=true" : ""}`),
  hydrate: (recipeId: string, scenarioId: string) => request<HydrateResponse>(`/api/recipe/${encodeURIComponent(recipeId)}/hydrate?scenarioId=${scenarioId}`),
  recipes: () => request<{ recipes: ViewRecipe[] }>("/api/recipes"),
  pinRecipe: (body: { name: string; scenarioId: string; componentTypes: ComponentType[]; description?: string }) =>
    request<{ recipe: ViewRecipe }>("/api/recipes", { method: "POST", body: JSON.stringify(body) }),
  deleteRecipe: (recipeId: string) => request<{ removed: boolean }>(`/api/recipes/${encodeURIComponent(recipeId)}`, { method: "DELETE" }),
  hover: (body: { scenarioId: string; entityId: string; entityType?: EntityType }) => request<HoverResponse>("/api/hover", { method: "POST", body: JSON.stringify(body) }),
  correlate: (body: { scenarioId: string; fresh?: boolean }) => request<CorrelateResponse>("/api/correlate", { method: "POST", body: JSON.stringify(body) }),
  remediate: (body: { scenarioId: string }) => request<RemediateResponse>("/api/remediate", { method: "POST", body: JSON.stringify(body) }),
  approve: (body: { remediationId: string; approvedBy?: string; decision?: "approve" | "reject"; openPullRequest?: boolean; mode?: ExecutionMode }) =>
    request<ApproveResponse>("/api/remediate/approve", { method: "POST", body: JSON.stringify(body) }),
  labState: () => request<{ convergence: Convergence[] }>("/api/lab/state"),
  resetDrift: (scenarioId?: string) => request<ResetDriftResponse>("/api/lab/reset-drift", { method: "POST", body: JSON.stringify(scenarioId ? { scenarioId } : {}) }),
  visionExtract: (body: { tenantId: string; ticketId: string; fileName: string; imageDataUri: string }) =>
    request<VisionResponse>("/api/vision-extract", { method: "POST", body: JSON.stringify(body) }),
  audit: (limit = 50) => request<{ entries: AuditEntry[]; file: string }>(`/api/audit?limit=${limit}`),
  voiceSteer: (body: { tenantId?: string; text?: string; audioBase64?: string; mimeType?: string }) =>
    request<VoiceResponse>("/api/voice-steer", { method: "POST", body: JSON.stringify(body) }),
  telemetryStats: () => request<TelemetryStats>("/api/telemetry/stats"),
};

/* -------------------------------------------------------------------------- */
/* SSE                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * POST + text/event-stream. The orchestrator emits `progress` events and a final
 * `result` (or `error`). Returns the parsed result.
 */
export async function streamPost<T>(path: string, body: unknown, onProgress: (event: ProgressEvent) => void, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${path}?stream=1`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw new ApiError(`${response.status} ${response.statusText}`, response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;
  let error: string | null = null;

  const handle = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n")) as unknown;
    if (event === "progress") onProgress(payload as ProgressEvent);
    else if (event === "result") result = payload as T;
    else if (event === "error") error = (payload as { error: string }).error;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (block.trim()) handle(block);
    }
  }
  if (buffer.trim()) handle(buffer);
  if (error) throw new ApiError(error, 500);
  if (result === null) throw new ApiError("stream ended without a result", 500);
  return result;
}
