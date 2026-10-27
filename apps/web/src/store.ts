import { create } from "zustand";
import {
  SCENARIO_REGISTRY,
  SELECTION_MAX_CHARS,
  SELECTION_MIN_CHARS,
  convergeLayout,
  getScenarioEntry,
  isAnyScenarioId,
  isCanvasComponentType,
  isCustomScenarioId,
  registerCustomScenario,
  resolveTenantId,
  scenarioForTenant,
  type ActionApprovalDrawer,
  type AuditEntry,
  type CanvasComponentType,
  type ComponentType,
  type ContextualMiniDashboard,
  type Convergence,
  type EntityType,
  type ExecutionMode,
  type HoverDiagnosticPopover,
  type Layout,
  type ProvenanceCategory,
  type ResolutionStep,
  type RouterTelemetry,
  type ScenarioBrief,
  type ScenarioListItem,
  type SteerLayoutArgs,
  type ViewRecipe,
  type WorkbenchScenarioId,
} from "@contextpane/catalog";
import {
  api,
  streamPost,
  type ApproveResponse,
  type CorrelateResponse,
  type DropArchetype,
  type ErpAttachment,
  type HealthResponse,
  type ProgressEvent,
  type PsaResolutionNote,
  type RemediateResponse,
  type TelemetryStats,
  type VisionResponse,
  type VoiceResponse,
} from "./lib/api";

/** The scenario the workbench shows: a built-in one or an unscripted CUSTOM-<hash> ticket. */
export type ScenarioId = WorkbenchScenarioId;

/** A mini-dashboard spawned from highlighted text, mounted above the macro cards. */
export interface MiniDashboardEntry {
  id: string;
  scenarioId: ScenarioId;
  /** 1-based order of the selection in this scenario (the cyan "Selection #n" badge). */
  index: number;
  selectionText: string;
  card: ContextualMiniDashboard;
  dataPtr: string;
  latencyMs: number;
  modelId: string;
  tokenCount: number;
}

/** Cross-card identity highlight: one UPN or device lit on every open card. */
export interface RowFilter {
  kind: "upn" | "device";
  value: string;
}
import { connectTelemetry } from "./lib/ws";
import { orderWorkItems, type QueueFilter } from "./lib/workitem";

export type CanvasStatus = "idle" | "loading" | "ready" | "error";

export interface Toast {
  id: number;
  tone: "info" | "healthy" | "warning" | "critical" | "meta";
  title: string;
  detail?: string;
  /** Rendered as a link under the detail (e.g. the GitHub PR). */
  href?: string;
  hrefLabel?: string;
  /** One button under the detail, e.g. [Open] on a new ERP drop. */
  action?: { label: string; onClick: () => void };
}

export type DrawerTab = "powershell" | "graph" | "terraform" | "entities" | "formal" | "rollback" | "commercial" | "fleet" | "deviceHealthScript" | "runbook";
export type SystemTab = "savings" | "audit" | "providers" | "skills";
export type FormalData = import("./lib/api").FormalResponse;
export type IntuneHealthData = import("./lib/api").IntuneHealthScript;
export type TimelineData = import("./lib/api").TimelineResponse["timeline"];
export type SkillDef = import("./lib/api").SkillDef;
export type PiiMetrics = import("./lib/api").PiiMetrics;

export interface VisionState {
  status: "idle" | "loading" | "ready" | "error";
  result?: VisionResponse;
  error?: string;
  latencyMs?: number;
}

export interface HoverEntry {
  status: "loading" | "ready" | "error";
  popover?: HoverDiagnosticPopover;
  error?: string;
  latencyMs?: number;
}

/** A left-pane entity the pointer is on: its card lights up in the category colour, the rest dim. */
export interface CardLink {
  target: CanvasComponentType;
  category: ProvenanceCategory;
}

interface WorkbenchState {
  /* data */
  scenarioId: ScenarioId;
  /** The unified work queue: tickets, anomalies, ERP drops and pasted tickets, as the orchestrator lists them. */
  scenarios: ScenarioListItem[];
  brief: ScenarioBrief | null;
  briefStatus: CanvasStatus;
  layout: Layout | null;
  canvasStatus: CanvasStatus;
  canvasError: string | null;
  progress: ProgressEvent[];
  recipes: ViewRecipe[];
  activeRecipeId: string | null;
  hovers: Record<string, HoverEntry>;
  drawer: ActionApprovalDrawer | null;
  drawerOpen: boolean;
  remediateStatus: CanvasStatus;
  remediateProgress: ProgressEvent[];
  approveLog: string[];
  filter: ComponentType[] | null;
  lastVoice: VoiceResponse | null;
  /** Remediated scenarios (notifications/resources/updated); the canvas overlays this with 0 tokens. */
  convergence: Partial<Record<string, Convergence>>;
  /** Emerald pulse on every card right after a convergence push. */
  convergeFlash: boolean;
  resetting: boolean;
  audit: AuditEntry[];
  vision: VisionState;
  drawerTab: DrawerTab;
  /** UPN the drawer was opened for from a hover [Stage License Fix]. */
  drawerFocusUpn: string | null;
  formal: FormalData | null;
  intuneHealth: IntuneHealthData | null;
  canary: import("./lib/api").CanaryTrace | null;
  commercial: import("./lib/api").Commercial | null;
  reverseResult: import("./lib/api").ReverseResult | null;
  fleet: import("./lib/api").Fleet | null;
  simulateCanaryFailure: boolean;
  timeline: TimelineData | null;
  timelineSliceId: string | null;
  compiledSkills: SkillDef[];
  piiMetrics: PiiMetrics | null;

  /* live agency */
  /** Generated mini-dashboards of the scenario on screen, newest first. */
  miniDashboards: MiniDashboardEntry[];
  /** Phrases explored per scenario, in order: drives the cyan "Selection #n" badges in the left pane. */
  selections: Record<string, Array<{ id: string; text: string; index: number }>>;
  exploreStatus: CanvasStatus;
  exploreError: string | null;
  /** Mini-dashboard the pointer-hovered selection pill links to (pulses cyan). */
  linkedSelection: string | null;
  composerOpen: boolean;
  triageStatus: CanvasStatus;
  rowFilter: RowFilter | null;
  resolutionNote: PsaResolutionNote | null;
  resolutionNoteStatus: CanvasStatus;

  /* unified work queue & ERP inbox */
  queueOpen: boolean;
  queueFilter: QueueFilter;
  queueQuery: string;
  /** Work items that arrived (ERP drops) and have not been opened yet: the dot on the queue button. */
  unseen: string[];
  dropStatus: CanvasStatus;

  /* telemetry */
  telemetry: RouterTelemetry | null;
  telemetryHistory: RouterTelemetry[];
  stats: TelemetryStats | null;
  wsConnected: boolean;
  health: HealthResponse | null;

  /* ui */
  diffOpen: boolean;
  /** The card whose diff the modal shows: the NSG HCL diff or a golden-baseline JSON diff. */
  diffCard: CanvasComponentType | null;
  systemOpen: boolean;
  systemTab: SystemTab;
  hotkeysOpen: boolean;
  voiceOpen: boolean;
  /** Cards render compact; an expanded card shows its tabs. */
  expanded: Partial<Record<CanvasComponentType, boolean>>;
  cardTab: Partial<Record<CanvasComponentType, string>>;
  linked: CardLink | null;
  highlightComponent: ComponentType | null;
  /** Resolution-plan checkboxes, `${scenarioId}:${stepId}`. */
  stepsDone: Record<string, boolean>;
  toasts: Toast[];
  /** Tick in the drawer: push the staged branch and `gh pr create` on approval (needs remote origin + gh auth). */
  openPrOnApprove: boolean;
  /** Drawer switch: Emergency Break-Glass (live write + reconcile commit) or Pure GitOps (PR only). */
  executionMode: ExecutionMode;

  /* actions */
  boot(): Promise<void>;
  loadScenarios(): Promise<void>;
  selectScenario(scenarioId: ScenarioId): Promise<void>;
  /** The queue in display order (newest first, resolved last): hotkeys 1-9 and j/k follow it. */
  orderedQueue(): ScenarioListItem[];
  stepQueue(delta: 1 | -1): Promise<void>;
  setQueueOpen(open: boolean): void;
  setQueueFilter(filter: QueueFilter): void;
  setQueueQuery(query: string): void;
  /** `[🎲 Drop Random ERP Ticket]`: the orchestrator writes a folder into input/tickets/ and the watcher ingests it. */
  simulateDrop(archetype?: DropArchetype): Promise<void>;
  /** A folder landed in the inbox (WebSocket push or poll): queue + toast, never an unasked switch. */
  inboxIngested(item: ScenarioListItem, attachments: string[]): Promise<void>;
  inboxRemoved(scenarioId: string): Promise<void>;
  pollInbox(): Promise<void>;
  loadBrief(scenarioId?: ScenarioId, fresh?: boolean): Promise<void>;
  correlate(options?: { fresh?: boolean }): Promise<void>;
  hydrateRecipe(recipeId: string, scenarioId?: ScenarioId): Promise<void>;
  loadRecipes(): Promise<void>;
  pinRecipe(name?: string): Promise<void>;
  unpinRecipe(): void;
  hover(entityId: string, entityType?: EntityType): Promise<void>;
  remediate(): Promise<void>;
  approve(decision?: "approve" | "reject"): Promise<void>;
  voiceSteer(input: { text?: string; audioBase64?: string; mimeType?: string }): Promise<VoiceResponse>;
  applyIntent(intent: SteerLayoutArgs): Promise<void>;
  setFilter(filter: ComponentType[] | null): void;
  setDrawerOpen(open: boolean): void;
  /** Opens the diff of one card (default: the first card on the canvas that has one). */
  setDiffOpen(open: boolean, card?: CanvasComponentType): void;
  setSystemOpen(open: boolean, tab?: SystemTab): void;
  setHotkeysOpen(open: boolean): void;
  setVoiceOpen(open: boolean): void;
  toggleExpanded(type: CanvasComponentType, expanded?: boolean): void;
  setCardTab(type: CanvasComponentType, tab: string): void;
  setLinked(link: CardLink | null): void;
  flashComponent(type: ComponentType | null): void;
  /** Expand a canvas card (optionally on a tab), scroll it into view and pulse it. */
  focusCard(type: ComponentType, tab?: string): void;
  runStep(step: ResolutionStep): void;
  toggleStep(stepId: string): void;
  /** Opens the approval drawer for the scenario on screen (generates the fix first when needed). */
  openRemediation(options?: { tab?: DrawerTab; focusUpn?: string }): void;
  setOpenPrOnApprove(value: boolean): void;
  setExecutionMode(mode: ExecutionMode): void;
  applyConvergence(scenarioId: string, convergence: Convergence | null): void;
  resetDrift(): Promise<void>;
  loadAudit(): Promise<void>;
  setDrawerTab(tab: DrawerTab): void;
  loadDrawerExtras(): Promise<void>;
  loadIntuneHealth(): Promise<void>;
  loadOps(): Promise<void>;
  stageCampaign(): Promise<void>;
  setSimulateCanaryFailure(v: boolean): void;
  compileSkill(): Promise<void>;
  loadSkills(): Promise<void>;
  selectTimelineSlice(sliceId: string): void;
  rollbackNow(): Promise<void>;
  extractVision(attachment: ErpAttachment): Promise<void>;
  /** Highlight → Generate Context UI: spawns a cyan mini-dashboard for the phrase on the canvas. */
  exploreSelection(text: string): Promise<void>;
  dismissMiniDashboard(id: string): void;
  setLinkedSelection(id: string | null): void;
  setComposerOpen(open: boolean): void;
  /** Unscripted ticket: triage the pasted text live and switch the workbench to the new CUSTOM-<hash> ticket. */
  triageCustom(input: { title: string; body: string; customerName?: string }): Promise<void>;
  setRowFilter(filter: RowFilter | null): void;
  loadResolutionNote(): Promise<void>;
  closeTicket(): Promise<void>;
  /** Clears the resolved / closed state so the ticket can be remediated again. */
  reopenTicket(): Promise<void>;
  toast(toast: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;
let telemetryDisposer: (() => void) | null = null;

const hoverKey = (scenarioId: string, entityId: string) => `${scenarioId}|${entityId.toLowerCase()}`;

let inboxPoll: number | null = null;

export const useWorkbench = create<WorkbenchState>()((set, get) => ({
  scenarioId: "INC-4092",
  scenarios: [],
  brief: null,
  briefStatus: "idle",
  layout: null,
  canvasStatus: "idle",
  canvasError: null,
  progress: [],
  recipes: [],
  activeRecipeId: null,
  hovers: {},
  drawer: null,
  drawerOpen: false,
  remediateStatus: "idle",
  remediateProgress: [],
  approveLog: [],
  filter: null,
  lastVoice: null,
  convergence: {},
  convergeFlash: false,
  resetting: false,
  audit: [],
  vision: { status: "idle" },
  drawerTab: "powershell",
  drawerFocusUpn: null,
  formal: null,
  intuneHealth: null,
  canary: null,
  commercial: null,
  reverseResult: null,
  fleet: null,
  simulateCanaryFailure: false,
  timeline: null,
  timelineSliceId: null,
  compiledSkills: [],
  piiMetrics: null,

  miniDashboards: [],
  selections: {},
  exploreStatus: "idle",
  exploreError: null,
  linkedSelection: null,
  composerOpen: false,
  triageStatus: "idle",
  rowFilter: null,
  resolutionNote: null,
  resolutionNoteStatus: "idle",

  queueOpen: false,
  queueFilter: "all",
  queueQuery: "",
  unseen: [],
  dropStatus: "idle",

  telemetry: null,
  telemetryHistory: [],
  stats: null,
  wsConnected: false,
  health: null,

  diffOpen: false,
  diffCard: null,
  systemOpen: false,
  systemTab: "savings",
  hotkeysOpen: false,
  voiceOpen: false,
  expanded: {},
  cardTab: {},
  linked: null,
  highlightComponent: null,
  stepsDone: {},
  toasts: [],
  openPrOnApprove: false,
  executionMode: "break-glass",

  async boot() {
    telemetryDisposer?.();
    telemetryDisposer = connectTelemetry({
      onStatus: (wsConnected) => set({ wsConnected }),
      onHello: (stats, recent) => set({ stats, telemetryHistory: recent, telemetry: recent.at(-1) ?? get().telemetry }),
      onEvent: (event, stats) => set((s) => ({ telemetry: event, stats, telemetryHistory: [...s.telemetryHistory.slice(-49), event] })),
      onAudit: (entry) => set((s) => (s.audit.some((e) => e.id === entry.id) ? {} : { audit: [entry, ...s.audit].slice(0, 100) })),
      onResourcesUpdated: (scenarioId, convergence) => get().applyConvergence(scenarioId, convergence),
      onInboxIngested: (item, _folder, attachments) => void get().inboxIngested(item, attachments),
      onInboxRemoved: (scenarioId) => void get().inboxRemoved(scenarioId),
    });
    // The poll backs the push: a drop never goes unnoticed while the socket reconnects.
    if (inboxPoll) window.clearInterval(inboxPoll);
    inboxPoll = window.setInterval(() => void get().pollInbox(), 5000);
    api
      .labState()
      .then(({ convergence }) => convergence.forEach((c) => get().applyConvergence(c.scenarioId, c)))
      .catch(() => undefined);
    void get().loadAudit();
    api
      .health()
      .then((health) => set({ health, openPrOnApprove: Boolean(health.github?.prOnApprove && health.github.origin && health.github.ghAuthenticated) }))
      .catch(() => set({ health: null }));
    void get().loadScenarios();
    await Promise.all([get().loadRecipes(), get().loadBrief()]);
    await get().correlate();
  },

  async loadScenarios() {
    try {
      const { scenarios } = await api.scenarios();
      // Unscripted tickets live in the orchestrator's registry; mirror them so getScenarioEntry works here too.
      for (const s of scenarios) {
        if (!s.custom) continue;
        registerCustomScenario({
          scenarioId: s.scenarioId as `CUSTOM-${string}`,
          kind: "ticket",
          origin: s.custom.origin,
          tenantId: s.tenantId as "tenant-contoso-01" | "tenant-fabrikam-02",
          title: s.title,
          remediationScope: SCENARIO_REGISTRY[s.custom.baseScenarioId].remediationScope,
          components: s.custom.components,
          baseScenarioId: s.custom.baseScenarioId,
          shortHash: s.custom.shortHash,
          createdAt: s.custom.createdAt,
          ticket: s.custom.ticket,
          extraction: s.custom.extraction,
          ...(s.custom.erpDrop ? { erpDrop: s.custom.erpDrop } : {}),
        });
      }
      set({ scenarios });
    } catch {
      /* orchestrator down; loadBrief toasts */
    }
  },

  orderedQueue() {
    return orderWorkItems(get().scenarios, get().convergence);
  },

  async stepQueue(delta) {
    const queue = get().orderedQueue();
    if (!queue.length) return;
    const i = queue.findIndex((s) => s.scenarioId === get().scenarioId);
    const next = queue[(i + delta + queue.length) % queue.length]!;
    await get().selectScenario(next.scenarioId);
  },

  setQueueOpen: (queueOpen) => set(queueOpen ? { queueOpen, queueQuery: "", voiceOpen: false } : { queueOpen }),
  setQueueFilter: (queueFilter) => set({ queueFilter }),
  setQueueQuery: (queueQuery) => set({ queueQuery }),

  async simulateDrop(archetype = "Random") {
    if (get().dropStatus === "loading") return;
    set({ dropStatus: "loading" });
    try {
      const drop = await api.simulateDrop({ archetype });
      set({ dropStatus: "ready" });
      // The watcher's WebSocket push normally announces the drop first (📥 toast); this covers a missed push.
      await get().inboxIngested(drop.scenario, drop.attachments.map((a) => a.fileName));
    } catch (error) {
      set({ dropStatus: "error" });
      get().toast({ tone: "critical", title: "ERP drop failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  async inboxIngested(item, attachments) {
    const known = get().scenarios.some((s) => s.scenarioId === item.scenarioId);
    await get().loadScenarios();
    if (known || get().scenarioId === item.scenarioId) return;
    set((s) => ({ unseen: s.unseen.includes(item.scenarioId) ? s.unseen : [...s.unseen, item.scenarioId] }));
    get().toast({
      tone: "meta",
      title: `📥 New ERP Drop: ${item.displayId}${attachments.length ? ` (${attachments.join(", ")})` : ""}`,
      detail: `${item.title} · ${item.custom?.extraction.entities.filter((e) => e.resolvedTo).length ?? 0} entities matched live · base ${item.custom?.baseScenarioId ?? "?"}`,
      action: { label: `Open ${item.displayId}`, onClick: () => void get().selectScenario(item.scenarioId) },
    });
  },

  async inboxRemoved(scenarioId) {
    await get().loadScenarios();
    set((s) => ({ unseen: s.unseen.filter((id) => id !== scenarioId) }));
    if (get().scenarioId !== scenarioId) return;
    get().toast({ tone: "warning", title: `${scenarioId} left the inbox`, detail: "Its folder was removed from input/tickets/; showing the next work item." });
    const next = get().orderedQueue().find((s) => s.scenarioId !== scenarioId);
    if (next) await get().selectScenario(next.scenarioId);
  },

  async pollInbox() {
    try {
      const { items } = await api.inbox();
      const known = new Set(get().scenarios.map((s) => s.scenarioId));
      const fresh = items.filter((i) => !known.has(i.scenarioId));
      const gone = get().scenarios.filter((s) => s.origin === "erp-drop" && !items.some((i) => i.scenarioId === s.scenarioId));
      if (!fresh.length && !gone.length) return;
      await get().loadScenarios();
      for (const i of fresh) {
        const item = get().scenarios.find((s) => s.scenarioId === i.scenarioId);
        if (item) await get().inboxIngested(item, i.attachments.map((a) => a.fileName));
      }
      for (const g of gone) await get().inboxRemoved(g.scenarioId);
    } catch {
      /* orchestrator down; the socket status dot says so */
    }
  },

  async selectScenario(scenarioId) {
    if (scenarioId === get().scenarioId && get().layout) {
      set({ queueOpen: false });
      return;
    }
    set((s) => ({
      scenarioId,
      queueOpen: false,
      voiceOpen: false,
      unseen: s.unseen.filter((id) => id !== scenarioId),
      brief: null,
      layout: null,
      expanded: {},
      cardTab: {},
      linked: null,
      drawer: null,
      drawerOpen: false,
      remediateStatus: "idle",
      remediateProgress: [],
      approveLog: [],
      diffOpen: false,
      filter: null,
      vision: { status: "idle" },
      drawerFocusUpn: null,
      miniDashboards: [],
      linkedSelection: null,
      exploreStatus: "idle",
      exploreError: null,
      rowFilter: null,
      resolutionNote: null,
      resolutionNoteStatus: "idle",
      fleet: null,
      commercial: null,
      reverseResult: null,
      formal: null,
      timeline: null,
      timelineSliceId: null,
      canary: null,
    }));
    const { activeRecipeId } = get();
    await Promise.all([get().loadBrief(scenarioId), activeRecipeId ? get().hydrateRecipe(activeRecipeId, scenarioId) : get().correlate()]);
  },

  async loadBrief(scenarioId = get().scenarioId, fresh = false) {
    set({ briefStatus: "loading" });
    try {
      const { brief, hovers } = await api.brief(scenarioId, fresh);
      if (get().scenarioId === scenarioId) {
        const seededHovers: Record<string, HoverEntry> = {};
        if (hovers) {
          for (const [eid, pop] of Object.entries(hovers)) {
            seededHovers[hoverKey(scenarioId, eid)] = { status: "ready", popover: pop, latencyMs: 1 };
          }
        }
        set((s) => ({
          brief,
          briefStatus: "ready",
          ...(Object.keys(seededHovers).length ? { hovers: { ...s.hovers, ...seededHovers } } : {}),
        }));
      }
    } catch (error) {
      set({ briefStatus: "error" });
      get().toast({ tone: "critical", title: "Orchestrator unreachable", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  async correlate(options = {}) {
    const scenarioId = get().scenarioId;
    set({ canvasStatus: "loading", canvasError: null, progress: [] });
    try {
      const result = await streamPost<CorrelateResponse>("/api/correlate", { scenarioId, fresh: options.fresh ?? false }, (event) => {
        set((s) => ({ progress: [...s.progress, event] }));
        // First paint: compact cards from the MCP data, before the model's layout.
        if (event.stage === "mcp_ready" && event.data?.layout && get().scenarioId === scenarioId) set({ layout: event.data.layout as Layout });
      });
      if (get().scenarioId !== scenarioId) return;
      set({ layout: result.layout, canvasStatus: "ready", activeRecipeId: null });
      void get().loadDrawerExtras();
    } catch (error) {
      set({ canvasStatus: "error", canvasError: error instanceof Error ? error.message : String(error) });
    }
  },

  async hydrateRecipe(recipeId, scenarioId = get().scenarioId) {
    set({ canvasStatus: "loading", canvasError: null, progress: [] });
    try {
      const result = await api.hydrate(recipeId, scenarioId);
      if (get().scenarioId !== scenarioId) return;
      set({ layout: result.layout, canvasStatus: "ready", activeRecipeId: recipeId });
      void get().loadDrawerExtras();
    } catch (error) {
      set({ canvasStatus: "error", canvasError: error instanceof Error ? error.message : String(error) });
    }
  },

  async loadRecipes() {
    try {
      const { recipes } = await api.recipes();
      set({ recipes });
    } catch {
      /* orchestrator down; boot() already toasts */
    }
  },

  async pinRecipe(name) {
    const { layout, scenarioId, filter } = get();
    if (!layout) return;
    const componentTypes = (filter ?? layout.components.map((c) => c.type)).filter((t): t is CanvasComponentType => isCanvasComponentType(t));
    const recipeName = name ?? "MSP triage";
    try {
      const { recipe } = await api.pinRecipe({ name: recipeName, scenarioId, componentTypes, description: `Pinned from ${scenarioId}` });
      await get().loadRecipes();
      set({ activeRecipeId: recipe.recipeId });
      get().toast({ tone: "healthy", title: `Pinned "${recipe.name}"`, detail: "Scenario switches now hydrate through Tier 0 with 0 LLM tokens." });
    } catch (error) {
      get().toast({ tone: "critical", title: "Pin failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  unpinRecipe() {
    set({ activeRecipeId: null });
    get().toast({ tone: "info", title: "Recipe released", detail: "The next scenario switch re-correlates through the model router." });
  },

  async hover(entityId, entityType) {
    const scenarioId = get().scenarioId;
    const key = hoverKey(scenarioId, entityId);
    const existing = get().hovers[key];
    if (existing && existing.status !== "error") return;
    set((s) => ({ hovers: { ...s.hovers, [key]: { status: "loading" } } }));
    const started = performance.now();
    try {
      const result = await api.hover({ scenarioId, entityId, ...(entityType ? { entityType } : {}) });
      set((s) => ({ hovers: { ...s.hovers, [key]: { status: "ready", popover: result.popover, latencyMs: Math.round(performance.now() - started) } } }));
    } catch (error) {
      set((s) => ({ hovers: { ...s.hovers, [key]: { status: "error", error: error instanceof Error ? error.message : String(error) } } }));
    }
  },

  async remediate() {
    const scenarioId = get().scenarioId;
    if (get().remediateStatus === "loading") return;
    // A resolved ticket is not remediated twice: show what ran, or point at Reopen.
    if (get().convergence[scenarioId]) {
      if (get().drawer?.ticketId === scenarioId) set({ drawerOpen: true });
      else get().toast({ tone: "warning", title: `${scenarioId} is already resolved`, detail: "Reopen the ticket or reset drift before running remediation again." });
      return;
    }
    set((s) => ({
      remediateStatus: "loading",
      remediateProgress: [],
      drawer: s.drawer?.ticketId === scenarioId ? s.drawer : null,
      drawerOpen: true,
      voiceOpen: false,
      approveLog: [],
    }));
    try {
      const result = await streamPost<RemediateResponse>("/api/remediate", { scenarioId }, (event) => set((s) => ({ remediateProgress: [...s.remediateProgress, event] })));
      // An open ticket is an active incident (break-glass); a proactive anomaly goes through the pipeline.
      const github = get().health?.github;
      set({
        drawer: result.drawer,
        remediateStatus: "ready",
        executionMode: (getScenarioEntry(scenarioId)?.kind ?? "ticket") === "ticket" ? "break-glass" : "gitops",
        // Ad-hoc CUSTOM-/ERP- runs never open a PR unless the box is ticked for that run.
        openPrOnApprove: !isCustomScenarioId(scenarioId) && Boolean(github?.prOnApprove && github.origin && github.ghAuthenticated),
      });
      void get().loadDrawerExtras();
    } catch (error) {
      set({ remediateStatus: "error" });
      get().toast({ tone: "critical", title: "Remediation failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  async approve(decision = "approve") {
    const { drawer } = get();
    if (!drawer) return;
    try {
      const result: ApproveResponse = await api.approve({
        remediationId: drawer.remediationId,
        decision,
        approvedBy: drawer.approval.requiredIdentity,
        ...(decision === "approve" ? { openPullRequest: get().openPrOnApprove, mode: get().executionMode, simulateCanaryFailure: get().simulateCanaryFailure } : {}),
      });
      const { executionLog, ...updated } = result.drawer;
      set({ drawer: updated, approveLog: executionLog, canary: result.canary ?? null });
      if (result.canary?.finalState === "AUTO_ROLLED_BACK") {
        get().toast({
          tone: "critical",
          title: "Health check failed · Auto-rollback restored previous state",
          detail: "Canary health check failed — 1-Click Undo script executed automatically to restore the previous tenant state",
        });
        return;
      }
      if (decision === "reject" || !result.convergence) {
        const prUrl = updated.staging?.prUrl;
        get().toast({
          tone: decision === "reject" ? "warning" : "healthy",
          title: decision === "reject" ? "Remediation rejected" : updated.approval.state === "staged" ? `Staged for the pipeline · ${updated.ticketId}` : `Approved · ${updated.approval.state}`,
          detail: executionLog.find((l) => l.startsWith("Pre-flight re-run")) ?? executionLog[0],
          ...(prUrl ? { href: prUrl, hrefLabel: `GitHub PR #${prUrl.split("/pull/")[1] ?? ""}` } : {}),
        });
        return;
      }
      const c = result.convergence;
      get().applyConvergence(c.scenarioId, c);
      void get().loadScenarios();
      get().toast({
        tone: "healthy",
        title: `${c.execution === "live-graph" ? "Executed live" : "Approved (simulated)"} · ${c.scenarioId} resolved in ${c.latencyMs} ms`,
        detail: `${executionLog.find((l) => l.startsWith("Graph")) ?? "Canvas converged"} · 0 LLM tokens${c.gitBranch ? ` · ${c.gitBranch}` : ""}`,
        ...(c.prUrl ? { href: c.prUrl, hrefLabel: `GitHub PR #${c.prUrl.split("/pull/")[1] ?? ""}` } : {}),
      });
      // Close the drawer so the emerald canvas is what the operator sees next.
      window.setTimeout(() => set({ drawerOpen: false }), 900);
    } catch (error) {
      get().toast({ tone: "critical", title: "Approval failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  async voiceSteer(input) {
    const result = await api.voiceSteer({ tenantId: getScenarioEntry(get().scenarioId)?.tenantId ?? "tenant-contoso-01", ...input });
    set({ lastVoice: result });
    await get().applyIntent(result.intent);
    return result;
  },

  async applyIntent(intent) {
    const components = intent.componentTypes as ComponentType[];
    switch (intent.intent) {
      case "filter":
      case "focus":
        get().setFilter(components.length ? components : null);
        if (intent.intent === "focus" && components[0]) get().focusCard(components[0]);
        get().toast({ tone: "meta", title: `Voice: ${intent.intent}`, detail: components.join(", ") || "no components matched" });
        break;
      case "reset":
        get().setFilter(null);
        get().toast({ tone: "meta", title: "Voice: reset", detail: "Showing every card" });
        break;
      case "switch-scenario":
        if (intent.scenarioId && isAnyScenarioId(intent.scenarioId)) {
          get().toast({ tone: "meta", title: "Voice: open scenario", detail: `${intent.scenarioId} · ${getScenarioEntry(intent.scenarioId)?.title ?? ""}` });
          await get().selectScenario(intent.scenarioId);
        }
        break;
      case "switch-tenant":
        if (intent.tenantId) {
          const scenarioId = scenarioForTenant(resolveTenantId(intent.tenantId));
          get().toast({ tone: "meta", title: "Voice: switch tenant", detail: SCENARIO_REGISTRY[scenarioId].title });
          await get().selectScenario(scenarioId);
        }
        break;
      case "pin":
        await get().pinRecipe(intent.recipeName);
        break;
      case "unpin":
        get().unpinRecipe();
        break;
      case "generate-fix":
        get().openRemediation();
        break;
      default:
        get().toast({ tone: "warning", title: "Voice: not understood", detail: `"${intent.transcript}"` });
    }
  },

  setFilter: (filter) => set({ filter }),
  setDrawerOpen: (drawerOpen) => set(drawerOpen ? { drawerOpen, voiceOpen: false } : { drawerOpen }),
  setDiffOpen(diffOpen, card) {
    if (!diffOpen) return set({ diffOpen });
    const withDiff = (get().layout?.components ?? []).find((c) =>
      c.type === "IaCDriftBanner" ? Boolean(c.props.hclDiff) : (c.type === "EntraSignInTimeline" || c.type === "IntuneDriftCard") && Boolean(c.props.baselineDiff),
    );
    set({ diffOpen, voiceOpen: false, diffCard: card ?? (withDiff && isCanvasComponentType(withDiff.type) ? withDiff.type : null) });
  },
  setSystemOpen: (systemOpen, tab) => {
    set(tab ? { systemOpen, systemTab: tab, ...(systemOpen ? { voiceOpen: false } : {}) } : { systemOpen, ...(systemOpen ? { voiceOpen: false } : {}) });
    if (systemOpen && (tab ?? get().systemTab) === "audit") void get().loadAudit();
    if (systemOpen && (tab ?? get().systemTab) === "skills") void get().loadSkills();
  },
  setHotkeysOpen: (hotkeysOpen) => set({ hotkeysOpen }),
  setVoiceOpen: (voiceOpen) => set({ voiceOpen }),
  toggleExpanded: (type, expanded) => set((s) => ({ expanded: { ...s.expanded, [type]: expanded ?? !s.expanded[type] } })),
  setCardTab: (type, tab) => set((s) => ({ cardTab: { ...s.cardTab, [type]: tab } })),
  setLinked: (linked) => set((s) => (s.linked?.target === linked?.target && s.linked?.category === linked?.category ? {} : { linked })),
  flashComponent: (highlightComponent) => {
    set({ highlightComponent });
    if (highlightComponent) window.setTimeout(() => set((s) => (s.highlightComponent === highlightComponent ? { highlightComponent: null } : {})), 1600);
  },
  focusCard: (type, tab) => {
    if (get().filter && !get().filter!.includes(type)) get().setFilter(null);
    if (isCanvasComponentType(type)) {
      set((s) => ({ expanded: { ...s.expanded, [type]: true }, ...(tab ? { cardTab: { ...s.cardTab, [type]: tab } } : {}) }));
    }
    window.requestAnimationFrame(() => {
      document.getElementById(`canvas-${type}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      get().flashComponent(type);
    });
  },
  runStep: (step) => {
    if (step.action.kind === "stage-fix") {
      get().focusCard(step.target, step.tab);
      get().openRemediation();
    } else {
      get().focusCard(step.target, step.tab);
    }
  },
  toggleStep: (stepId) => {
    const key = `${get().scenarioId}:${stepId}`;
    set((s) => ({ stepsDone: { ...s.stepsDone, [key]: !s.stepsDone[key] } }));
  },
  openRemediation(options = {}) {
    set({ drawerTab: options.tab ?? "powershell", drawerFocusUpn: options.focusUpn ?? null, voiceOpen: false });
    const { drawer, scenarioId } = get();
    if (drawer && drawer.ticketId === scenarioId && drawer.approval.state === "pending") set({ drawerOpen: true });
    else void get().remediate();
  },
  setOpenPrOnApprove: (openPrOnApprove) => set({ openPrOnApprove }),
  setExecutionMode: (executionMode) => set({ executionMode }),

  applyConvergence(scenarioId, convergence) {
    if (!isAnyScenarioId(scenarioId)) return;
    const current = get().convergence[scenarioId];
    if (convergence && current?.remediationId === convergence.remediationId) return;
    if (!convergence && !current) return;
    set((s) => {
      const next = { ...s.convergence };
      if (convergence) next[scenarioId] = convergence;
      else delete next[scenarioId];
      return {
        convergence: next,
        convergeFlash: Boolean(convergence) && s.scenarioId === scenarioId,
        scenarios: s.scenarios.map((x) => (x.scenarioId === scenarioId ? { ...x, resolved: Boolean(convergence) } : x)),
      };
    });
    if (convergence) window.setTimeout(() => set({ convergeFlash: false }), 1800);
    // The ticket converged: draft the Customer & PSA Resolution Note for the left pane.
    if (convergence && get().scenarioId === scenarioId) void get().loadResolutionNote();
    if (!convergence && get().scenarioId === scenarioId) set({ resolutionNote: null, resolutionNoteStatus: "idle" });
  },

  async resetDrift() {
    if (get().resetting) return;
    const started = performance.now();
    const currentId = get().scenarioId;
    const targetScenarioId: ScenarioId = currentId.startsWith("CUSTOM-") ? "INC-4092" : currentId;
    // Revert the canvas at once; the server clears its state and rewrites the lab objects behind this.
    set((s) => ({
      resetting: true,
      scenarioId: targetScenarioId,
      convergence: {},
      drawer: null,
      drawerOpen: false,
      voiceOpen: false,
      remediateStatus: "idle",
      remediateProgress: [],
      approveLog: [],
      vision: { status: "idle" },
      hovers: {},
      stepsDone: {},
      miniDashboards: [],
      selections: {},
      resolutionNote: null,
      resolutionNoteStatus: "idle",
      scenarios: s.scenarios.filter((x) => !x.scenarioId.startsWith("CUSTOM-")).map((x) => ({ ...x, resolved: false })),
    }));
    try {
      const result = await api.resetDrift();
      void get().loadScenarios();
      const live = result.results.filter((r) => r.source === "live-graph").length;
      const failed = result.results.filter((r) => r.failed.length);
      get().toast({
        tone: result.ok ? "info" : "warning",
        title: `Demo drift restored for ${result.results.length} scenarios · ${Math.round(performance.now() - started)} ms`,
        detail: failed.length
          ? `${failed.map((r) => `${r.scenarioId}: ${r.failed[0]?.error ?? "failed"}`).join("; ").slice(0, 240)}`
          : `${live} written live in the lab tenant, ${result.results.length - live} simulated`,
      });
      void get().loadBrief(targetScenarioId, true);
      // A canvas correlated after the approval already carries the live (resolved) state: hydrate it again.
      const recipe = get().activeRecipeId;
      if (recipe) void get().hydrateRecipe(recipe, targetScenarioId);
      else void get().correlate({ fresh: true });
    } catch (error) {
      get().toast({ tone: "critical", title: "Reset failed", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ resetting: false });
    }
  },

  async loadAudit() {
    try {
      const { entries } = await api.audit(100);
      set({ audit: entries });
    } catch {
      /* orchestrator down */
    }
  },

  setDrawerTab: (drawerTab) => set({ drawerTab }),

  async loadDrawerExtras() {
    const scenarioId = get().scenarioId;
    void get().loadIntuneHealth();
    try {
      const [formal, tl, dp, skills] = await Promise.all([api.formal(scenarioId), api.timeline(scenarioId), api.dataplaneDetail(scenarioId), api.skills()]);
      if (get().scenarioId !== scenarioId) return;
      set({ formal, timeline: tl.timeline, timelineSliceId: get().timelineSliceId ?? tl.timeline.slices.at(-2)?.id ?? tl.timeline.slices.at(-1)?.id ?? null, piiMetrics: dp.piiMetrics, compiledSkills: skills.skills });
      void get().loadOps();
    } catch { /* extras are drawer-only; canvas stays clean */ }
  },
  async loadIntuneHealth() {
    const scenarioId = get().scenarioId;
    try {
      const intuneHealth = await api.intuneHealthScript(scenarioId);
      if (get().scenarioId === scenarioId) set({ intuneHealth });
    } catch {
      if (get().scenarioId === scenarioId) set({ intuneHealth: null });
    }
  },
  setSimulateCanaryFailure: (simulateCanaryFailure) => set({ simulateCanaryFailure }),
  async loadOps() {
    const scenarioId = get().scenarioId;
    try {
      const [rec, rev, fl] = await Promise.all([api.commercial(scenarioId), api.reverseCompile(scenarioId), api.fleet(scenarioId)]);
      if (get().scenarioId === scenarioId) set({ commercial: rec.reconciliation, reverseResult: rev.result, fleet: fl.fleet });
    } catch { /* drawer-only extras */ }
  },
  async stageCampaign() {
    try {
      const { campaign } = await api.campaign(get().scenarioId);
      get().toast({ tone: campaign.verified ? "healthy" : "warning", title: `Fix PRs created for ${campaign.branches.length} client tenants`, detail: `${campaign.branches.map((b) => b.branch).join(", ")} · verified in ${campaign.latencyMs} ms` });
    } catch (e) { get().toast({ tone: "critical", title: "Campaign failed", detail: e instanceof Error ? e.message : String(e) }); }
  },
  async loadSkills() {
    try { const { skills } = await api.skills(); set({ compiledSkills: skills }); } catch { /* offline */ }
    try { const dp = await api.dataplaneDetail(get().scenarioId); set({ piiMetrics: dp.piiMetrics }); } catch { /* offline */ }
  },
  async compileSkill() {
    try {
      const { skill, promoted } = await api.compileSkill(get().scenarioId);
      set((s) => ({ compiledSkills: [...s.compiledSkills.filter((x) => x.id !== skill.id), skill] }));
      get().toast({ tone: promoted ? "healthy" : "warning", title: promoted ? "Saved as Instant Auto-Fix Rule" : "Rule not promoted", detail: "Runs in <1ms with 0 AI tokens next time this issue happens" });
    } catch (e) { get().toast({ tone: "critical", title: "Compile failed", detail: e instanceof Error ? e.message : String(e) }); }
  },
  selectTimelineSlice(sliceId) {
    set({ timelineSliceId: sliceId });
    const slice = get().timeline?.slices.find((s) => s.id === sliceId);
    if (slice?.changedCardId) get().flashComponent(slice.changedCardId as ComponentType);
  },
  async rollbackNow() {
    try {
      const r = await api.rollback(get().scenarioId);
      get().applyConvergence(get().scenarioId, null);
      get().toast({ tone: "healthy", title: `Undo completed in ${r.latencyMs} ms`, detail: "Previous tenant state restored; canvas reverted." });
      void get().correlate({ fresh: true });
    } catch (e) { get().toast({ tone: "critical", title: "Rollback failed", detail: e instanceof Error ? e.message : String(e) }); }
  },

  async extractVision(attachment) {
    const scenarioId = get().scenarioId;
    const tenantId = getScenarioEntry(scenarioId)?.tenantId ?? "tenant-contoso-01";
    set({ vision: { status: "loading" } });
    const started = performance.now();
    try {
      let result: VisionResponse;
      if (attachment.url.startsWith("/api/tickets/inbox-attachment/")) {
        // An ERP drop: the orchestrator reads input/tickets/<folder>/<file> itself (deterministic fallback offline).
        result = await api.visionTriage({ scenarioId, fileName: attachment.fileName });
      } else {
        const blob = await (await fetch(attachment.url)).blob();
        const imageDataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("could not read the attachment"));
          reader.readAsDataURL(blob);
        });
        result = await api.visionExtract({ tenantId, ticketId: scenarioId, fileName: attachment.fileName, imageDataUri });
      }
      if (get().scenarioId !== scenarioId) return;
      set({ vision: { status: "ready", result, latencyMs: Math.round(performance.now() - started) } });
      if (result.match) get().focusCard("EntraSignInTimeline", "signins");
    } catch (error) {
      set({ vision: { status: "error", error: error instanceof Error ? error.message : String(error) } });
    }
  },

  async exploreSelection(rawText) {
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, SELECTION_MAX_CHARS);
    const scenarioId = get().scenarioId;
    if (text.length < SELECTION_MIN_CHARS || get().exploreStatus === "loading") return;
    set({ exploreStatus: "loading", exploreError: null });
    const started = performance.now();
    try {
      const customText = get().brief?.extraction ? get().brief?.body : undefined;
      const result = await api.exploreSelection({ scenarioId, selectedText: text, ...(customText ? { customTicketText: customText } : {}) });
      if (get().scenarioId !== scenarioId) return;
      set((s) => {
        const existing = s.selections[scenarioId] ?? [];
        const known = existing.find((x) => x.id === result.card.id);
        const index = known?.index ?? existing.length + 1;
        const selections = known ? s.selections : { ...s.selections, [scenarioId]: [...existing, { id: result.card.id, text, index }] };
        const entry: MiniDashboardEntry = { id: result.card.id, scenarioId, index, selectionText: text, card: result.card, dataPtr: result.dataPtr, latencyMs: Math.round(performance.now() - started), modelId: result.modelId, tokenCount: result.tokenCount };
        return { selections, miniDashboards: [entry, ...s.miniDashboards.filter((m) => m.id !== entry.id)].slice(0, 6), exploreStatus: "ready", linkedSelection: entry.id };
      });
      window.requestAnimationFrame(() => document.getElementById(`mini-${result.card.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
      window.setTimeout(() => set((s) => (s.linkedSelection === result.card.id ? { linkedSelection: null } : {})), 1600);
      get().toast({ tone: "info", title: `Context UI for "${text.length > 40 ? `${text.slice(0, 39)}…` : text}"`, detail: `${result.slice.rowCount} rows · ${result.modelId} · ${result.tokenCount} tokens · ${Math.round(performance.now() - started)} ms · ${result.dataPtr}` });
    } catch (error) {
      set({ exploreStatus: "error", exploreError: error instanceof Error ? error.message : String(error) });
      get().toast({ tone: "critical", title: "Generate Context UI failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },
  dismissMiniDashboard: (id) => set((s) => ({ miniDashboards: s.miniDashboards.filter((m) => m.id !== id), linkedSelection: s.linkedSelection === id ? null : s.linkedSelection })),
  setLinkedSelection: (linkedSelection) => set((s) => (s.linkedSelection === linkedSelection ? {} : { linkedSelection })),
  setComposerOpen: (composerOpen) => set(composerOpen ? { composerOpen, voiceOpen: false } : { composerOpen }),

  async triageCustom(input) {
    if (get().triageStatus === "loading") return;
    set({ triageStatus: "loading" });
    const started = performance.now();
    try {
      const result = await api.triageCustom(input);
      await get().loadScenarios();
      set({ triageStatus: "ready", composerOpen: false });
      const x = result.extraction;
      get().toast({
        tone: "healthy",
        title: `${result.scenario.scenarioId} triaged in ${Math.round(performance.now() - started)} ms`,
        detail: `${x.entities.filter((e) => e.resolvedTo).length}/${x.entities.length} entities matched live · intents ${x.intents.join(", ") || "none"} · base ${x.baseScenarioId} · ${result.dataPtrs.length} ptr://custom pointers · formal ${result.verification.formal.passed ? "passed" : "FAILED"}`,
      });
      await get().selectScenario(result.scenario.scenarioId);
    } catch (error) {
      set({ triageStatus: "error" });
      get().toast({ tone: "critical", title: "Triage failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },
  setRowFilter: (rowFilter) => set((s) => (s.rowFilter?.kind === rowFilter?.kind && s.rowFilter?.value === rowFilter?.value ? {} : { rowFilter })),

  async loadResolutionNote() {
    const scenarioId = get().scenarioId;
    if (!get().convergence[scenarioId]) return;
    set({ resolutionNoteStatus: "loading" });
    try {
      const { note } = await api.resolutionNote(scenarioId);
      if (get().scenarioId === scenarioId) set({ resolutionNote: note, resolutionNoteStatus: "ready" });
    } catch {
      if (get().scenarioId === scenarioId) set({ resolutionNoteStatus: "error" });
    }
  },
  async closeTicket() {
    const scenarioId = get().scenarioId;
    try {
      const result = await api.closeTicket(scenarioId);
      set({ resolutionNote: result.note });
      get().toast({ tone: "healthy", title: `${scenarioId} marked closed in the PSA`, detail: `ticket.closed logged to the audit ledger (${result.audit.id}) with the resolution note attached` });
    } catch (error) {
      get().toast({ tone: "critical", title: "Close failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },
  async reopenTicket() {
    const scenarioId = get().scenarioId;
    try {
      const result = await api.reopenTicket(scenarioId);
      get().applyConvergence(scenarioId, null);
      set((s) => ({ drawer: s.drawer?.ticketId === scenarioId ? null : s.drawer, drawerOpen: false, approveLog: [], canary: null, remediateStatus: "idle" }));
      void get().loadScenarios();
      void get().loadAudit();
      get().toast({ tone: "warning", title: `${scenarioId} reopened`, detail: `ticket.reopened logged (${result.audit.id}). The lab objects stay remediated until you reset drift.` });
    } catch (error) {
      get().toast({ tone: "critical", title: "Reopen failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  toast: (toast) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => get().dismissToast(id), toast.href ? 12_000 : 5200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let convergedCache: {
  layout: Layout | null;
  convergence: Convergence | undefined;
  slice: import("@/lib/api").TimelineSliceItem | null;
  result: Layout | null;
} = { layout: null, convergence: undefined, slice: null, result: null };

export function selectActiveTimelineSlice(
  s: Pick<WorkbenchState, "timeline" | "timelineSliceId">,
): import("@/lib/api").TimelineSliceItem | null {
  if (!s.timeline || !s.timelineSliceId) return null;
  return s.timeline.slices.find((x) => x.id === s.timelineSliceId) ?? null;
}

export function applyTimelineSliceToLayout(
  layout: Layout,
  slice: import("@/lib/api").TimelineSliceItem,
): Layout {
  const isHealthySlice = slice.state.health === "healthy" || slice.kind === "baseline" || slice.kind === "counterfactual";
  const base = isHealthySlice
    ? convergeLayout(layout, { remediatedUpns: [], reclaimedUpns: [] })
    : layout;
  return {
    ...base,
    components: base.components.map((c) => {
      const cardSlice = slice.state.cards?.find((cs) => cs.cardId === c.type);
      const effectiveStatus = cardSlice?.status ?? (isHealthySlice ? "healthy" : ("state" in c.props ? c.props.state : "healthy"));
      switch (c.type) {
        case "LicenseDriftCard":
          return {
            ...c,
            props: {
              ...c.props,
              state: effectiveStatus,
              headline: cardSlice?.summary ?? c.props.headline,
              ...(effectiveStatus === "healthy"
                ? {
                    groupErrors: [],
                    users: c.props.users.map((u) => ({
                      ...u,
                      currentSku: u.expectedSku === "NONE" ? "NONE" : u.expectedSku || c.props.skuPartNumber || "SPE_E5",
                      assignmentPath: u.expectedSku === "NONE" ? ("None" as const) : u.assignmentPath,
                      assignmentState: u.expectedSku === "NONE" ? ("Reclaimed" as const) : ("Active" as const),
                      driftStatus: "compliant" as const,
                    })),
                  }
                : {}),
            },
          };
        case "EntraSignInTimeline": {
          const rawEvents = layout.components.find((orig) => orig.type === "EntraSignInTimeline")?.props;
          const origEvents = rawEvents && "events" in rawEvents ? rawEvents.events : c.props.events;
          let events = c.props.events;
          if (slice.kind === "baseline") {
            const baselinePreDrift = origEvents.filter((e) => e.status === "success" && e.timestamp <= slice.timestamp);
            events =
              baselinePreDrift.length > 0
                ? baselinePreDrift.map((e) => ({ ...e, isHighlighted: false }))
                : c.props.events.map((e) => ({
                    ...e,
                    status: "success" as const,
                    errorCode: 0,
                    errorCodeLabel: undefined,
                    failureReason: undefined,
                    blockingPolicyName: undefined,
                    conditionalAccessStatus: "success" as const,
                    isHighlighted: false,
                  }));
          } else if (slice.kind === "drift" || effectiveStatus === "healthy") {
            if (slice.kind === "drift") {
              const nonFailures = origEvents.filter((e) => e.status !== "failure");
              events = nonFailures.length > 0 ? nonFailures.map((e) => ({ ...e, isHighlighted: false })) : c.props.events;
            } else {
              events = c.props.events.map((e) => ({
                ...e,
                status: "success" as const,
                errorCode: 0,
                errorCodeLabel: undefined,
                failureReason: undefined,
                blockingPolicyName: undefined,
                conditionalAccessStatus: "success" as const,
                isHighlighted: false,
              }));
            }
          } else if (slice.kind === "first-failure") {
            const upToSlice = origEvents.filter((e) => e.timestamp <= slice.timestamp);
            events = upToSlice.some((e) => e.status === "failure") ? upToSlice : origEvents.slice(0, Math.max(1, origEvents.findIndex((e) => e.status === "failure") + 1));
          }
          return {
            ...c,
            props: {
              ...c.props,
              state: effectiveStatus,
              headline: cardSlice?.summary ?? c.props.headline,
              events,
              ...(effectiveStatus === "healthy" || slice.kind === "drift"
                ? {
                    rootCause: null,
                    ...(effectiveStatus === "healthy"
                      ? {
                          policies: c.props.policies.map((p) => ({
                            ...p,
                            role: "in-scope" as const,
                            state: p.fixedState ?? p.state,
                            excludeGroups: p.fixedExcludeGroups ?? p.excludeGroups,
                            drift: [],
                          })),
                        }
                      : {}),
                  }
                : {}),
            },
          };
        }
        case "IaCDriftBanner":
          return {
            ...c,
            props: {
              ...c.props,
              state: effectiveStatus,
              summary: cardSlice?.summary ?? c.props.summary,
              ...(effectiveStatus === "healthy"
                ? {
                    driftState: "in-sync" as const,
                    rogueSecurityRules: [],
                    tagDrift: [],
                    missingSecurityRules: [],
                    azurePolicies: c.props.azurePolicies.map((p) => ({
                      ...p,
                      compliance: "Compliant" as const,
                      nonCompliantResources: 0,
                      detail: p.name.toLowerCase().includes("management port")
                        ? "0 management ports exposed to Internet — TCP/3389 closed"
                        : p.name.toLowerCase().includes("tag")
                          ? "Required tag Environment = Production matches Terraform baseline"
                          : p.detail,
                    })),
                  }
                : {}),
            },
          };
        case "IntuneDriftCard":
          return {
            ...c,
            props: {
              ...c.props,
              state: effectiveStatus,
              headline: cardSlice?.summary ?? c.props.headline,
              ...(effectiveStatus === "healthy"
                ? {
                    affectedDeviceCount: 0,
                    settings: c.props.settings.map((s) => ({ ...s, live: s.golden, status: "in-sync" as const })),
                    policies: c.props.policies.map((p) => (p.role === "duplicate" || p.role === "conflicting" ? { ...p, assignedTo: [] } : p)),
                    devices: c.props.devices.map((d) => ({ ...d, complianceState: "Compliant" as const, detail: "Compliant — matches golden baseline" })),
                  }
                : {}),
            },
          };
        default:
          return c;
      }
    }),
  };
}

/**
 * The layout as the canvas shows it: the model's (or recipe's) layout with the
 * scenario's convergence or time-travel slice overlaid, memoised so zustand selectors stay stable.
 */
export function selectCanvasLayout(
  s: Pick<WorkbenchState, "layout" | "convergence" | "timeline" | "timelineSliceId">,
): Layout | null {
  const convergence = s.layout && isAnyScenarioId(s.layout.ticketId) ? s.convergence[s.layout.ticketId] : undefined;
  const activeSlice = selectActiveTimelineSlice(s);
  const nonNowSlice = activeSlice && activeSlice.relativeLabel !== "NOW" ? activeSlice : null;
  if (
    convergedCache.layout === s.layout &&
    convergedCache.convergence === convergence &&
    convergedCache.slice === nonNowSlice
  ) {
    return convergedCache.result;
  }
  let result = s.layout && convergence ? convergeLayout(s.layout, convergence) : s.layout;
  if (result && nonNowSlice) {
    result = applyTimelineSliceToLayout(result, nonNowSlice);
  }
  convergedCache = { layout: s.layout, convergence, slice: nonNowSlice, result };
  return result;
}

/** Convergence of the scenario on screen, if it was remediated. */
export function selectConvergence(s: Pick<WorkbenchState, "convergence" | "scenarioId">): Convergence | undefined {
  return s.convergence[s.scenarioId];
}

/** Hover cache entry of an entity in the scenario on screen. */
export function selectHover(s: Pick<WorkbenchState, "hovers" | "scenarioId">, entityId: string): HoverEntry | undefined {
  return s.hovers[hoverKey(s.scenarioId, entityId)];
}

/** Components the canvas should render right now (voice filter applied). */
export function visibleComponents(layout: Layout | null, filter: ComponentType[] | null) {
  if (!layout) return [];
  const list = layout.components.filter((c) => c.type !== "HoverDiagnosticPopover" && c.type !== "ActionApprovalDrawer");
  return filter ? list.filter((c) => filter.includes(c.type)) : list;
}
