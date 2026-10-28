import type {
  ExecutionMode,
  ActionApprovalDrawer,
  AuditEntry,
  ClarifyingQuestion,
  ComponentType,
  ContextViewMode,
  ContextualMiniDashboard,
  Convergence,
  ScenarioId,
  SubAgentTaskRecord,
  TicketExtraction,
  EntityType,
  HoverDiagnosticPopover,
  Layout,
  RouterTelemetry,
  ScenarioBrief,
  ScenarioListItem,
  SteerLayoutArgs,
  SteeringParams,
  SteeringSource,
  SynthesizedDynamicCard,
  ViewRecipe,
  VisionExtraction,
  WorkbenchScenarioId,
} from "@contextpane/catalog";

/* -------------------------------------------------------------------------- */
/* Response shapes (mirror apps/orchestrator/src/app.ts)                       */
/* -------------------------------------------------------------------------- */

export type ErpAttachment = ScenarioBrief["attachments"][number];

export interface BriefResponse {
  brief: ScenarioBrief;
  hovers?: Record<string, HoverDiagnosticPopover>;
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

export interface CanaryTrace {
  scenarioId: string;
  mode: string;
  /** "live-graph" when the approval wrote to the tenant; "simulated" for a staged approval or a drill. */
  execution?: "live-graph" | "simulated";
  /** "symbolic": probes evaluated the fixture model; "none": no model for this ticket, nothing evaluated. */
  probeSource?: "symbolic" | "none";
  finalState: "CONVERGED" | "AUTO_ROLLED_BACK";
  canaryCohort: string;
  /** True only when the orchestrator executed the inverse and it landed. */
  rollbackExecuted?: boolean;
  tenantRestored?: boolean;
  stages: Array<{ stage: string; detail: string; probes?: unknown }>;
  probes: { identity: { passed: boolean }; network: { tcp3389Closed?: boolean; tcp443Open?: boolean; intuneConflicts?: number } };
}
export interface ApproveResponse {
  drawer: ActionApprovalDrawer & { executionLog: string[] };
  convergence: Convergence | null;
  canary?: CanaryTrace | null;
}
export interface CommercialSkuRow {
  sku: string;
  skuName: string;
  unitPriceMonthly: number;
  prepaid: number;
  enabled: number;
  consumed: number;
  available: number;
  orphaned: number;
}
export interface Commercial {
  contractId: string;
  neededSeats?: number;
  skus?: CommercialSkuRow[];
  pathA: { label: string; reclaim: Record<string, number>; netDeltaMonthly: number; wasteEliminatedMonthly: number };
  pathB: { label: string; increment: Record<string, number>; netDeltaMonthly: number };
  recommendation: string;
}
export interface ReverseResult { hcl: string; imports: string[]; tofuPlanSummary?: string; expectedPlanSummary?: string; shadowFindings: Array<{ kind: string; resources: string[]; detail: string }> }
export interface Fleet { signature: string; affectedCount: number; tenants: Array<{ tenant: string; affected: boolean }> }

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

export interface AsrBlast { executions: number; workstations: number; binary: string; exclusionStaged: boolean; detail: string }
export interface FormalResponse {
  scenarioId: string;
  formal: {
    /** null: not provable (an ad-hoc ticket has no symbolic model). */
    passed: boolean | null;
    note?: string;
    latencyMs: number;
    invariantProofMask?: number;
    minPerturbationCost?: number;
    schemaSignature?: string;
    maxSmtSynthesis?: {
      optimal: boolean;
      invariantProofMask: number;
      minPerturbationCost: number;
      collateralLockouts: number;
      schemaSignature: string;
      hardInvariants: Array<{ bit: number; mask: number; id: string; passed: boolean; statement: string }>;
    };
    invariants: Array<{ id: string; statement: string; passed: boolean; checked: number; evidence: string[]; counterexamples: unknown[] }>;
    asrBlast?: AsrBlast | null;
  };
  blastRadius: { targetBlockedToAllowed: number; breakGlassAllowedToAllowed: number; collateralChanges: number; rows: Array<{ cohort: string; entities: string[]; before: string; after: string; attempts: number }> };
  rollback: { powershellScript: string; terraformDiff: string; graphPatch: string; restores: string[] };
  /** null: no symbolic model for this ticket, so no fixture transform was checked. */
  idempotency: { passed: boolean; idempotent: boolean } | null;
  asrBlast?: AsrBlast | null;
}
export interface IntuneHealthCsp { settingName: string; cspUri?: string; registryPath?: string; tattooedOnUnassign?: boolean }
export interface IntuneHealthScript { scenarioId: string; detect: string; remediate: string; verification: { passed: boolean; detectReadOnly: boolean; proof: string }; csp: IntuneHealthCsp[]; asrBlast: AsrBlast | null }
export type IntuneHealthScriptResponse = IntuneHealthScript;
export interface TimelineSliceState {
  summary: string;
  health: "healthy" | "warning" | "critical";
  affectedEntities?: string[];
  entities?: Array<{ id: string; status: string; health: "healthy" | "warning" | "critical"; note?: string }>;
  cards?: Array<{ cardId: string; status: "healthy" | "warning" | "critical"; summary: string }>;
  statuses?: Record<string, string>;
}
export interface TimelineSliceItem {
  id: string;
  kind?: string;
  label: string;
  relativeLabel: string;
  timestamp: string;
  validFrom: string;
  validTo: string | null;
  changedCardId: string | null;
  state: TimelineSliceState;
}
export interface TimelineResponse {
  timeline: {
    scenarioId: string;
    slices: TimelineSliceItem[];
  };
}
export interface SkillDef {
  id: string;
  scenarioId: string;
  tier: number;
  tokenCost: number;
  latencyMs: number;
  fuzz: { cases: number; passed: number };
  invariantProofMask?: number;
  minPerturbationCost?: number;
  schemaSignature?: string;
  badge: string;
}
export interface PiiMetrics { piiFieldsVaulted: number; zeroRawPiiInLlmPrompt: boolean; promptsScanned?: number; rawPiiPromptHits?: number; sampleMappings: Record<string, string>; tokenMappings?: Record<string, string> }
export interface DataPlaneDetailResponse {
  scenarioId?: string;
  tenantId?: string;
  epoch?: number;
  generation?: number;
  fence?: { tenantId: string; epoch: number; generation: number };
  columnarScanNs?: number;
  bytes?: number;
  datasets?: Array<{
    ptr: string;
    component: string;
    prop: string;
    rowCount: number;
    bytes: number;
    burstiness?: number;
    log2RowBucket?: number;
    kAnonymitySuppressed?: boolean;
    columnarScanNs?: number;
  }>;
  piiMetrics: PiiMetrics;
  evidenceGraph?: {
    scenarioId: string;
    tenantId: string;
    epoch: number;
    builtInMs: number;
    nodeCount: number;
    edgeCount: number;
    driftedNodeCount: number;
    counterfactuals: Array<{
      removedNodeId: string;
      removedLabel: string;
      kind: string;
      deltaRisk: number;
      unblockedEntities: number;
      wasteEliminatedUsd: number;
      residualBlastRadiusRisk: number;
    }>;
  };
  informationBottleneck?: {
    humanCapacityBits: number;
    viewportEntropyBits: number;
    uncollapsedEntropyBits: number;
    mutualInfoScore: number;
    withinBudget: boolean;
    compressionRatio: number;
  };
}

export interface ExploreSelectionResponse {
  card: ContextualMiniDashboard;
  dataPtr: string;
  latencyMs: number;
  tier: RouterTelemetry["tier"];
  modelId: string;
  provider: RouterTelemetry["provider"];
  tokenCount: number;
  slice: { kind: string; matchedBy: "rows" | "dataset" | "none"; rowCount: number; searched: Array<{ kind: string; rows: number; matched: number }>; dataSource?: string };
  telemetry: RouterTelemetry;
}

export interface TriageCustomResponse {
  scenario: ScenarioListItem;
  brief: ScenarioBrief;
  extraction: TicketExtraction;
  clarifyingQuestions?: ClarifyingQuestion[];
  clarifiedAnswers?: Record<string, string>;
  subAgentTasks?: SubAgentTaskRecord[];
  dataPtrs: string[];
  dataPlane: { datasets: number; bytes: number; piiMetrics: PiiMetrics };
  verification: { formal: { passed: boolean | null; invariants: number; ids: string[]; latencyMs: number }; idempotency: { passed: boolean | null }; baseScenarioId: ScenarioId };
  timelineSlices: number;
  latencyMs: number;
  telemetry: RouterTelemetry;
}

export interface ClarifyQuestionsResponse {
  questions: ClarifyingQuestion[];
  modelUsed: string;
  latencyMs: number;
}

export interface RefineGoalResponse {
  ok: boolean;
  scenario: ScenarioListItem;
  brief: ScenarioBrief;
  clarifyingQuestions: ClarifyingQuestion[];
  clarifiedAnswers: Record<string, string>;
  subAgentTasks: SubAgentTaskRecord[];
}

/** PATCH /api/tickets/:id/steer (U-1): one steering interaction, one coder call, the re-staged drawer. */
export interface SteerBody {
  clarifier?: Record<string, string>;
  params?: Record<string, string | boolean | string[]>;
  rowClick?: { key: string; value: string; label?: string };
  source?: SteeringSource;
  rerun?: "coder" | "coder+ui";
}
export interface SteerResponse {
  ok: boolean;
  scenario: ScenarioListItem;
  brief: ScenarioBrief;
  steering: SteeringParams;
  previousVersion: number;
  clarifiedAnswers: Record<string, string>;
  clarifyingQuestions: ClarifyingQuestion[];
  subAgentTasks: SubAgentTaskRecord[];
  synthesizedElements: SynthesizedDynamicCard[];
  customRemediation: { title: string; summary: string; powershellScript: string } | null;
  /** Unified diff from the previous script to the re-parameterised one; "" when nothing changed. */
  scriptDiff: string;
  cardResynthesized: boolean;
  drawer: ActionApprovalDrawer | null;
  coder: { modelId: string; source: string; latencyMs: number; tokensUsed: number; usage?: { prompt: number; completion: number; total: number } };
  latencyMs: number;
  telemetry: RouterTelemetry;
}

/** POST /api/rollback (U-5): what the server did, and the read-back against the pre-change snapshot. */
export interface RollbackResponse {
  ok: boolean;
  scenarioId: string;
  /** True only when a live inverse landed and the read-back matches the snapshot. */
  executed: boolean;
  execution: "live-graph" | "simulated" | "none";
  reason: string;
  latencyMs: number;
  inverseSource: "pre-snapshot" | "static-reference" | "none";
  rollback: { powershellScript: string; terraformDiff: string; graphPatch: string; restores: string[]; note?: string; sections?: string[] };
  executionLog: string[];
  canary: { probeSource: "live-read" | "simulated-read"; matchesPreSnapshot: boolean; differences: Array<{ path: string; before: unknown; after: unknown }>; capturedAt: string } | null;
  preSnapshotAt: string | null;
  convergenceCleared: boolean;
  error?: string;
}

export interface SampleTicket { id: string; title: string; body: string; customerName: string }

/* ERP inbox: input/tickets/#<id>/ticketbody.json + images */
export interface InboxItem { folder: string; displayId: string; scenarioId: WorkbenchScenarioId; title: string; ingestedAt: string; createdAt: string; attachments: ErpAttachment[]; resolved: boolean }
export interface InboxResponse { dir: string; items: InboxItem[]; scannedAt: string }
export type DropArchetype = "AVD" | "Intune" | "CA" | "WorkloadIdentity" | "Licensing" | "Mixed" | "Random";
export interface SimulateDropResponse {
  folder: string;
  displayId: string;
  scenarioId: WorkbenchScenarioId;
  archetype: Exclude<DropArchetype, "Random">;
  files: string[];
  dir: string;
  scenario: ScenarioListItem;
  attachments: ErpAttachment[];
  extraction: TicketExtraction;
  brief: ScenarioBrief;
  latencyMs: number;
}
export interface VisionTriageResponse extends VisionResponse { scenarioId: string; attachment: ErpAttachment; source: "muse-vision" | "deterministic" }

export interface PsaResolutionNote {
  scenarioId: string;
  ticketTitle: string;
  tenantName: string;
  status: "RESOLVED & VERIFIED" | "CLOSED";
  resolvedAt: string;
  execution: "live-graph" | "simulated";
  customerSummary: string;
  rootCause: string;
  resolution: string;
  technicalAuditTrail: string[];
  markdown: string;
  closed: { closedAt: string; closedBy: string } | null;
  remediationId: string;
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

export interface OpenWeightInference { grammarConstrained: boolean; kvCacheQuant: string; speculativeDraftMax: number; speculativeDraftMin: number; maxContainers: number }

export type McpDataMode = "real-tenant" | "simulated-lab";

export interface FreeRoamEntityItem {
  id: string;
  label: string;
  sublabel: string;
  badge: string;
  tone: "default" | "warning" | "critical" | "success";
  queryPrompt: string;
}

export interface FreeRoamCategory {
  id: string;
  title: string;
  source: string;
  count: number;
  items: FreeRoamEntityItem[];
}

export interface FreeRoamInventory {
  dataMode: McpDataMode;
  tenant: {
    tenantId: string;
    displayName: string;
    verifiedDomain: string;
    entraTenantId: string;
  };
  sourcesUsed: Record<string, string>;
  fallbackReasons: string[];
  summary: {
    users: number;
    groups: number;
    skuPools: number;
    caPolicies: number;
    signInEvents: number;
    intuneDevices: number;
    azureResources: number;
    azurePolicies: number;
  };
  categories: FreeRoamCategory[];
  gatheredAt: string;
}

export interface AnomalyScanResponse {
  dataMode: McpDataMode;
  scannedAt: string;
  detectedCount: number;
  newlyRegistered: ScenarioListItem[];
  findings: Array<{
    id: string;
    category: string;
    severity: "critical" | "warning";
    title: string;
    detail: string;
    source: string;
  }>;
  scenarios: ScenarioListItem[];
}

export interface HealthResponse {
  ok: boolean;
  liveCloudMode: boolean;
  dataMode?: McpDataMode;
  forceLocal: boolean;
  providers: Array<{ id: string; label: string; hasKey: boolean }>;
  mcp: { transport: string; servers: Array<{ name: string; ok: boolean; tools?: number }> };
  github?: { origin: string | null; ghInstalled: boolean; ghAuthenticated: boolean; account: string | null; prOnApprove: boolean; prBase: string };
  openWeightInference?: OpenWeightInference;
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

export interface DynamicCatalogResponse {
  catalog: {
    version: string;
    builtInElements: string[];
    dynamicElements: Array<{
      elementId: string;
      title: string;
      domain: string;
      reason: string;
      requiredPrimitives: string[];
      createdAt: string;
      lastUsedAt: string;
      reuseCount: number;
      gatekeeperModel: string;
      synthesizerModel: string;
      tsxStubPath: string;
    }>;
  };
  dynamicCount: number;
  builtInCount: number;
  auditLog: Array<{
    id: string;
    timestamp: string;
    triggerTicketId: string;
    ticketPrompt: string;
    elementId: string;
    title: string;
    domain: string;
    gatekeeperModel: string;
    modelUsed: string;
    latencyMs: number;
    reusedFromCatalog: boolean;
    reuseCount: number;
    tsxStubPath: string;
  }>;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  /** includeSeeded: true / false forces the seeded demo tickets in / out; undefined follows the server's data mode. */
  scenarios: (includeSeeded?: boolean) => request<{ scenarios: ScenarioListItem[] }>(`/api/scenarios${includeSeeded === undefined ? "" : `?includeSeeded=${includeSeeded ? 1 : 0}`}`),
  brief: (scenarioId: string, fresh = false) => request<BriefResponse>(`/api/scenarios/${scenarioId}/brief${fresh ? "?refresh=true" : ""}`),
  hydrate: (recipeId: string, scenarioId: string) => request<HydrateResponse>(`/api/recipe/${encodeURIComponent(recipeId)}/hydrate?scenarioId=${scenarioId}`),
  recipes: () => request<{ recipes: ViewRecipe[] }>("/api/recipes"),
  pinRecipe: (body: { name: string; scenarioId: string; componentTypes: ComponentType[]; description?: string }) =>
    request<{ recipe: ViewRecipe }>("/api/recipes", { method: "POST", body: JSON.stringify(body) }),
  deleteRecipe: (recipeId: string) => request<{ removed: boolean }>(`/api/recipes/${encodeURIComponent(recipeId)}`, { method: "DELETE" }),
  hover: (body: { scenarioId: string; entityId: string; entityType?: EntityType }) => request<HoverResponse>("/api/hover", { method: "POST", body: JSON.stringify(body) }),
  correlate: (body: { scenarioId: string; fresh?: boolean }) => request<CorrelateResponse>("/api/correlate", { method: "POST", body: JSON.stringify(body) }),
  remediate: (body: { scenarioId: string }) => request<RemediateResponse>("/api/remediate", { method: "POST", body: JSON.stringify(body) }),
  autofixRemediation: (remediationId: string) =>
    request<{ drawer: ActionApprovalDrawer }>(`/api/remediate/${encodeURIComponent(remediationId)}/autofix`, { method: "POST", body: "{}" }),
  overrideRemediation: (remediationId: string, body: { justification: string; operator?: string }) =>
    request<{ drawer: ActionApprovalDrawer }>(`/api/remediate/${encodeURIComponent(remediationId)}/override`, { method: "POST", body: JSON.stringify(body) }),
  approve: (body: { remediationId: string; approvedBy?: string; decision?: "approve" | "reject"; openPullRequest?: boolean; mode?: ExecutionMode; simulateCanaryFailure?: boolean }) =>
    request<ApproveResponse>("/api/remediate/approve", { method: "POST", body: JSON.stringify(body) }),
  labState: () => request<{ convergence: Convergence[] }>("/api/lab/state"),
  resetDrift: (scenarioId?: string) => request<ResetDriftResponse>("/api/lab/reset-drift", { method: "POST", body: JSON.stringify(scenarioId ? { scenarioId } : {}) }),
  visionExtract: (body: { tenantId: string; ticketId: string; fileName: string; imageDataUri: string }) =>
    request<VisionResponse>("/api/vision-extract", { method: "POST", body: JSON.stringify(body) }),
  audit: (limit = 50) => request<{ entries: AuditEntry[]; file: string }>(`/api/audit?limit=${limit}`),
  voiceSteer: (body: { tenantId?: string; text?: string; audioBase64?: string; mimeType?: string }) =>
    request<VoiceResponse>("/api/voice-steer", { method: "POST", body: JSON.stringify(body) }),
  telemetryStats: () => request<TelemetryStats>("/api/telemetry/stats"),
  formal: (scenarioId: string) => request<FormalResponse>(`/api/formal/${scenarioId}`),
  intuneHealthScript: (scenarioId: string) => request<IntuneHealthScript>(`/api/intune/health-script/${scenarioId}`),
  timeline: (scenarioId: string) => request<TimelineResponse>(`/api/timeline/${scenarioId}`),
  skills: () => request<{ skills: SkillDef[] }>("/api/skills"),
  compileSkill: (scenarioId: string) => request<{ skill: SkillDef; promoted: boolean }>("/api/skills/compile", { method: "POST", body: JSON.stringify({ scenarioId }) }),
  rollback: (scenarioId: string) => request<RollbackResponse>("/api/rollback", { method: "POST", body: JSON.stringify({ scenarioId }) }),
  dataplaneDetail: (scenarioId: string) => request<DataPlaneDetailResponse>(`/api/dataplane/${scenarioId}`),
  commercial: (scenarioId: string) => request<{ reconciliation: Commercial }>(`/api/reconcile/commercial/${scenarioId}`),
  reverseCompile: (scenarioId: string) => request<{ result: ReverseResult }>("/api/iac/reverse-compile", { method: "POST", body: JSON.stringify({ scenarioId }) }),
  fleet: (scenarioId: string) => request<{ fleet: Fleet }>(`/api/fleet/immunize/${scenarioId}`),
  campaign: (scenarioId: string) => request<{ campaign: { campaignId: string; branches: Array<{ tenant: string; branch: string }>; verified: boolean; latencyMs: number } }>(`/api/fleet/campaign/${scenarioId}`, { method: "POST", body: "{}" }),
  runbookUrl: (scenarioId: string) => `/api/runbooks/${scenarioId}.md`,
  exploreSelection: (body: { scenarioId: string; selectedText: string; refinementText?: string; viewMode?: ContextViewMode; customTicketText?: string; prefetch?: boolean }) =>
    request<ExploreSelectionResponse>("/api/explore-selection", { method: "POST", body: JSON.stringify(body) }),
  triageCustom: (body: { title: string; body: string; customerName?: string; clarifiedAnswers?: Record<string, string> }) =>
    request<TriageCustomResponse>("/api/tickets/triage-custom", { method: "POST", body: JSON.stringify(body) }),
  clarifyQuestions: (body: { title: string; body: string; clarifiedAnswers?: Record<string, string> }) =>
    request<ClarifyQuestionsResponse>("/api/tickets/clarify-questions", { method: "POST", body: JSON.stringify(body) }),
  steer: (scenarioId: string, body: SteerBody) =>
    request<SteerResponse>(`/api/tickets/${encodeURIComponent(scenarioId)}/steer`, { method: "PATCH", body: JSON.stringify(body) }),
  refineGoal: (scenarioId: string, clarifiedAnswers: Record<string, string>) =>
    request<RefineGoalResponse>(`/api/tickets/${encodeURIComponent(scenarioId)}/refine-goal`, {
      method: "POST",
      body: JSON.stringify({ clarifiedAnswers }),
    }),
  ticketSamples: () => request<{ samples: SampleTicket[] }>("/api/tickets/samples"),
  inbox: () => request<InboxResponse>("/api/tickets/inbox"),
  simulateDrop: (body: { archetype?: DropArchetype; ticketId?: string } = {}) => request<SimulateDropResponse>("/api/tickets/simulate-drop", { method: "POST", body: JSON.stringify(body) }),
  visionTriage: (body: { scenarioId: string; fileName?: string }) => request<VisionTriageResponse>("/api/vision/triage", { method: "POST", body: JSON.stringify(body) }),
  resolutionNote: (scenarioId: string) => request<{ note: PsaResolutionNote }>(`/api/tickets/${encodeURIComponent(scenarioId)}/resolution-note`),
  closeTicket: (scenarioId: string, closedBy?: string) => request<{ ok: boolean; note: PsaResolutionNote; audit: AuditEntry }>("/api/tickets/close", { method: "POST", body: JSON.stringify({ scenarioId, ...(closedBy ? { closedBy } : {}) }) }),
  reopenTicket: (scenarioId: string) => request<{ ok: boolean; scenarioId: string; audit: AuditEntry }>("/api/tickets/reopen", { method: "POST", body: JSON.stringify({ scenarioId }) }),
  dynamicCatalog: () => request<DynamicCatalogResponse>("/api/dynamic-catalog"),
  clearDynamicCatalog: () => request<{ ok: boolean; removed: number }>("/api/dynamic-catalog/clear", { method: "POST", body: "{}" }),
  getDataMode: () => request<{ dataMode: McpDataMode; liveCloudMode: boolean }>("/api/settings/data-mode"),
  setDataMode: (dataMode: McpDataMode) =>
    request<{ ok: boolean; dataMode: McpDataMode; liveCloudMode: boolean; scenarios: ScenarioListItem[] }>("/api/settings/data-mode", {
      method: "POST",
      body: JSON.stringify({ dataMode }),
    }),
  freeRoamInventory: (tenantId?: string) =>
    request<FreeRoamInventory>(`/api/free-roam/inventory${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
  freeRoamSpawn: (body: { prompt: string; refinementText?: string; scope?: "hybrid" | "tenant-only" | "knowledge"; viewMode?: ContextViewMode; tenantId?: string }) =>
    request<ExploreSelectionResponse>("/api/free-roam/spawn", { method: "POST", body: JSON.stringify(body) }),
  freeRoamRemediate: (body: { prompt: string; title?: string; scriptPreview?: string; tenantId?: string }) =>
    request<RemediateResponse>("/api/free-roam/remediate", { method: "POST", body: JSON.stringify(body) }),
  scanAnomalies: (tenantId?: string) =>
    request<AnomalyScanResponse>("/api/anomalies/scan", { method: "POST", body: JSON.stringify(tenantId ? { tenantId } : {}) }),
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
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(detail?.error ?? `${response.status} ${response.statusText}`, response.status);
  }
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
