import { create } from "zustand";
import {
  SCENARIO_REGISTRY,
  convergeLayout,
  isCanvasComponentType,
  isScenarioId,
  resolveTenantId,
  scenarioForTenant,
  scenariosOfKind,
  type ActionApprovalDrawer,
  type AuditEntry,
  type CanvasComponentType,
  type ComponentType,
  type Convergence,
  type EntityType,
  type ExecutionMode,
  type HoverDiagnosticPopover,
  type Layout,
  type ProvenanceCategory,
  type ResolutionStep,
  type RouterTelemetry,
  type ScenarioBrief,
  type ScenarioId,
  type ScenarioKind,
  type ScenarioListItem,
  type SteerLayoutArgs,
  type ViewRecipe,
} from "@contextpane/catalog";
import {
  api,
  streamPost,
  type ApproveResponse,
  type CorrelateResponse,
  type ErpAttachment,
  type HealthResponse,
  type ProgressEvent,
  type RemediateResponse,
  type TelemetryStats,
  type VisionResponse,
  type VoiceResponse,
} from "./lib/api";
import { connectTelemetry } from "./lib/ws";

export type CanvasStatus = "idle" | "loading" | "ready" | "error";

export interface Toast {
  id: number;
  tone: "info" | "healthy" | "warning" | "critical" | "meta";
  title: string;
  detail?: string;
  /** Rendered as a link under the detail (e.g. the GitHub PR). */
  href?: string;
  hrefLabel?: string;
}

export type DrawerTab = "powershell" | "graph" | "terraform" | "entities";
export type SystemTab = "savings" | "audit" | "providers";

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
  mode: ScenarioKind;
  scenarioId: ScenarioId;
  /** Last scenario opened per mode, so the mode switch returns to it. */
  lastByMode: Record<ScenarioKind, ScenarioId>;
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
  convergence: Partial<Record<ScenarioId, Convergence>>;
  /** Emerald pulse on every card right after a convergence push. */
  convergeFlash: boolean;
  resetting: boolean;
  audit: AuditEntry[];
  vision: VisionState;
  drawerTab: DrawerTab;
  /** UPN the drawer was opened for from a hover [Stage License Fix]. */
  drawerFocusUpn: string | null;

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
  setMode(mode: ScenarioKind): Promise<void>;
  selectScenario(scenarioId: ScenarioId): Promise<void>;
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
  extractVision(attachment: ErpAttachment): Promise<void>;
  toast(toast: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;
let telemetryDisposer: (() => void) | null = null;

const hoverKey = (scenarioId: string, entityId: string) => `${scenarioId}|${entityId.toLowerCase()}`;

export const useWorkbench = create<WorkbenchState>()((set, get) => ({
  mode: "ticket",
  scenarioId: "INC-4092",
  lastByMode: { ticket: "INC-4092", anomaly: "ANOM-LIC-101" },
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
    });
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
      set({ scenarios });
    } catch {
      /* orchestrator down; loadBrief toasts */
    }
  },

  async setMode(mode) {
    if (mode === get().mode) return;
    await get().selectScenario(get().lastByMode[mode] ?? scenariosOfKind(mode)[0]!);
  },

  async selectScenario(scenarioId) {
    if (scenarioId === get().scenarioId && get().layout) return;
    const kind = SCENARIO_REGISTRY[scenarioId].kind;
    set((s) => ({
      scenarioId,
      mode: kind,
      lastByMode: { ...s.lastByMode, [kind]: scenarioId },
      brief: null,
      layout: null,
      expanded: {},
      cardTab: {},
      linked: null,
      drawerOpen: false,
      diffOpen: false,
      filter: null,
      vision: { status: "idle" },
      drawerFocusUpn: null,
    }));
    const { activeRecipeId } = get();
    await Promise.all([get().loadBrief(scenarioId), activeRecipeId ? get().hydrateRecipe(activeRecipeId, scenarioId) : get().correlate()]);
  },

  async loadBrief(scenarioId = get().scenarioId, fresh = false) {
    set({ briefStatus: "loading" });
    try {
      const { brief } = await api.brief(scenarioId, fresh);
      if (get().scenarioId === scenarioId) set({ brief, briefStatus: "ready" });
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
    set({ remediateStatus: "loading", remediateProgress: [], drawerOpen: true, approveLog: [] });
    try {
      const result = await streamPost<RemediateResponse>("/api/remediate", { scenarioId }, (event) => set((s) => ({ remediateProgress: [...s.remediateProgress, event] })));
      // An open ticket is an active incident (break-glass); a proactive anomaly goes through the pipeline.
      set({ drawer: result.drawer, remediateStatus: "ready", executionMode: SCENARIO_REGISTRY[scenarioId].kind === "ticket" ? "break-glass" : "gitops" });
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
        ...(decision === "approve" ? { openPullRequest: get().openPrOnApprove, mode: get().executionMode } : {}),
      });
      const { executionLog, ...updated } = result.drawer;
      set({ drawer: updated, approveLog: executionLog });
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
    const result = await api.voiceSteer({ tenantId: SCENARIO_REGISTRY[get().scenarioId].tenantId, ...input });
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
        if (intent.scenarioId && isScenarioId(intent.scenarioId)) {
          get().toast({ tone: "meta", title: "Voice: open scenario", detail: `${intent.scenarioId} · ${SCENARIO_REGISTRY[intent.scenarioId].title}` });
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
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDiffOpen(diffOpen, card) {
    if (!diffOpen) return set({ diffOpen });
    const withDiff = (get().layout?.components ?? []).find((c) =>
      c.type === "IaCDriftBanner" ? Boolean(c.props.hclDiff) : (c.type === "EntraSignInTimeline" || c.type === "IntuneDriftCard") && Boolean(c.props.baselineDiff),
    );
    set({ diffOpen, diffCard: card ?? (withDiff && isCanvasComponentType(withDiff.type) ? withDiff.type : null) });
  },
  setSystemOpen: (systemOpen, tab) => {
    set(tab ? { systemOpen, systemTab: tab } : { systemOpen });
    if (systemOpen && (tab ?? get().systemTab) === "audit") void get().loadAudit();
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
    set({ drawerTab: options.tab ?? "powershell", drawerFocusUpn: options.focusUpn ?? null });
    const { drawer, scenarioId } = get();
    if (drawer && drawer.ticketId === scenarioId && drawer.approval.state === "pending") set({ drawerOpen: true });
    else void get().remediate();
  },
  setOpenPrOnApprove: (openPrOnApprove) => set({ openPrOnApprove }),
  setExecutionMode: (executionMode) => set({ executionMode }),

  applyConvergence(scenarioId, convergence) {
    if (!isScenarioId(scenarioId)) return;
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
  },

  async resetDrift() {
    if (get().resetting) return;
    const started = performance.now();
    const scenarioId = get().scenarioId;
    // Revert the canvas at once; the server clears its state and rewrites the lab objects behind this.
    set((s) => ({
      resetting: true,
      convergence: {},
      drawer: null,
      drawerOpen: false,
      remediateStatus: "idle",
      remediateProgress: [],
      approveLog: [],
      vision: { status: "idle" },
      hovers: {},
      stepsDone: {},
      scenarios: s.scenarios.map((x) => ({ ...x, resolved: false })),
    }));
    try {
      const result = await api.resetDrift();
      const live = result.results.filter((r) => r.source === "live-graph").length;
      const failed = result.results.filter((r) => r.failed.length);
      get().toast({
        tone: result.ok ? "info" : "warning",
        title: `Demo drift restored for ${result.results.length} scenarios · ${Math.round(performance.now() - started)} ms`,
        detail: failed.length
          ? `${failed.map((r) => `${r.scenarioId}: ${r.failed[0]?.error ?? "failed"}`).join("; ").slice(0, 240)}`
          : `${live} written live in the lab tenant, ${result.results.length - live} simulated`,
      });
      void get().loadBrief(scenarioId, true);
      // A canvas correlated after the approval already carries the live (resolved) state: hydrate it again.
      const recipe = get().activeRecipeId;
      if (recipe) void get().hydrateRecipe(recipe);
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

  async extractVision(attachment) {
    const scenarioId = get().scenarioId;
    const tenantId = SCENARIO_REGISTRY[scenarioId].tenantId;
    set({ vision: { status: "loading" } });
    const started = performance.now();
    try {
      const blob = await (await fetch(attachment.url)).blob();
      const imageDataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("could not read the attachment"));
        reader.readAsDataURL(blob);
      });
      const result = await api.visionExtract({ tenantId, ticketId: scenarioId, fileName: attachment.fileName, imageDataUri });
      if (get().scenarioId !== scenarioId) return;
      set({ vision: { status: "ready", result, latencyMs: Math.round(performance.now() - started) } });
      if (result.match) get().focusCard("EntraSignInTimeline", "signins");
    } catch (error) {
      set({ vision: { status: "error", error: error instanceof Error ? error.message : String(error) } });
    }
  },

  toast: (toast) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => get().dismissToast(id), toast.href ? 12_000 : 5200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let convergedCache: { layout: Layout | null; convergence: Convergence | undefined; result: Layout | null } = { layout: null, convergence: undefined, result: null };

/**
 * The layout as the canvas shows it: the model's (or recipe's) layout with the
 * scenario's convergence overlaid, memoised so zustand selectors stay stable.
 */
export function selectCanvasLayout(s: Pick<WorkbenchState, "layout" | "convergence">): Layout | null {
  const convergence = s.layout && isScenarioId(s.layout.ticketId) ? s.convergence[s.layout.ticketId] : undefined;
  if (convergedCache.layout === s.layout && convergedCache.convergence === convergence) return convergedCache.result;
  const result = s.layout && convergence ? convergeLayout(s.layout, convergence) : s.layout;
  convergedCache = { layout: s.layout, convergence, result };
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
