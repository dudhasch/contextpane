import { create } from "zustand";
import {
  TENANT_REGISTRY,
  resolveTenantId,
  type ActionApprovalDrawer,
  type ComponentType,
  type EntityType,
  type HoverDiagnosticPopover,
  type Layout,
  type RouterTelemetry,
  type SteerLayoutArgs,
  type TenantId,
  type ViewRecipe,
} from "@contextpane/catalog";
import {
  api,
  streamPost,
  type ApproveResponse,
  type CorrelateResponse,
  type HealthResponse,
  type ProgressEvent,
  type RemediateResponse,
  type TelemetryStats,
  type TenantContextResponse,
  type VoiceResponse,
} from "./lib/api";
import { connectTelemetry } from "./lib/ws";

export type CanvasStatus = "idle" | "loading" | "ready" | "error";

export interface Toast {
  id: number;
  tone: "info" | "healthy" | "warning" | "critical" | "meta";
  title: string;
  detail?: string;
}

export interface HoverEntry {
  status: "loading" | "ready" | "error";
  popover?: HoverDiagnosticPopover;
  error?: string;
  latencyMs?: number;
}

interface WorkbenchState {
  /* data */
  tenantId: TenantId;
  context: TenantContextResponse | null;
  contextStatus: CanvasStatus;
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

  /* telemetry */
  telemetry: RouterTelemetry | null;
  telemetryHistory: RouterTelemetry[];
  stats: TelemetryStats | null;
  wsConnected: boolean;
  health: HealthResponse | null;

  /* ui */
  diffOpen: boolean;
  savingsOpen: boolean;
  hotkeysOpen: boolean;
  voiceOpen: boolean;
  toolbarLineId: string | null;
  highlightComponent: ComponentType | null;
  toasts: Toast[];
  /** Tick in the drawer: push the staged branch and `gh pr create` on approval (needs remote origin + gh auth). */
  openPrOnApprove: boolean;

  /* actions */
  boot(): Promise<void>;
  setTenant(tenantId: TenantId): Promise<void>;
  loadContext(tenantId?: TenantId, fresh?: boolean): Promise<void>;
  correlate(options?: { fresh?: boolean }): Promise<void>;
  hydrateRecipe(recipeId: string, tenantId?: TenantId): Promise<void>;
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
  setDiffOpen(open: boolean): void;
  setSavingsOpen(open: boolean): void;
  setHotkeysOpen(open: boolean): void;
  setVoiceOpen(open: boolean): void;
  setToolbarLine(lineId: string | null): void;
  flashComponent(type: ComponentType | null): void;
  /** Smooth-scroll a canvas card into view and pulse-highlight it. */
  revealComponent(type: ComponentType): void;
  setOpenPrOnApprove(value: boolean): void;
  toast(toast: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;
let telemetryDisposer: (() => void) | null = null;

export const useWorkbench = create<WorkbenchState>()((set, get) => ({
  tenantId: "tenant-contoso-01",
  context: null,
  contextStatus: "idle",
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

  telemetry: null,
  telemetryHistory: [],
  stats: null,
  wsConnected: false,
  health: null,

  diffOpen: false,
  savingsOpen: false,
  hotkeysOpen: false,
  voiceOpen: false,
  toolbarLineId: null,
  highlightComponent: null,
  toasts: [],
  openPrOnApprove: false,

  async boot() {
    telemetryDisposer?.();
    telemetryDisposer = connectTelemetry({
      onStatus: (wsConnected) => set({ wsConnected }),
      onHello: (stats, recent) => set({ stats, telemetryHistory: recent, telemetry: recent.at(-1) ?? get().telemetry }),
      onEvent: (event, stats) => set((s) => ({ telemetry: event, stats, telemetryHistory: [...s.telemetryHistory.slice(-49), event] })),
    });
    api
      .health()
      .then((health) => set({ health, openPrOnApprove: Boolean(health.github?.prOnApprove && health.github.origin && health.github.ghAuthenticated) }))
      .catch(() => set({ health: null }));
    await Promise.all([get().loadRecipes(), get().loadContext()]);
    await get().correlate();
  },

  async setTenant(tenantId) {
    if (tenantId === get().tenantId) return;
    set({ tenantId, hovers: {}, toolbarLineId: null, drawerOpen: false, diffOpen: false, filter: null });
    const { activeRecipeId } = get();
    await get().loadContext(tenantId);
    if (activeRecipeId) await get().hydrateRecipe(activeRecipeId, tenantId);
    else await get().correlate();
  },

  async loadContext(tenantId = get().tenantId, fresh = false) {
    set({ contextStatus: "loading" });
    try {
      const context = await api.tenantContext(tenantId, fresh);
      if (get().tenantId === tenantId) set({ context, contextStatus: "ready" });
    } catch (error) {
      set({ contextStatus: "error" });
      get().toast({ tone: "critical", title: "Orchestrator unreachable", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  async correlate(options = {}) {
    const tenantId = get().tenantId;
    set({ canvasStatus: "loading", canvasError: null, progress: [] });
    try {
      const result = await streamPost<CorrelateResponse>("/api/correlate", { tenantId, fresh: options.fresh ?? false }, (event) => {
        set((s) => ({ progress: [...s.progress, event] }));
        // First paint: the header arrives with the MCP data, before the model's layout.
        if (event.stage === "mcp_ready" && event.data?.layout && get().tenantId === tenantId) set({ layout: event.data.layout as Layout });
      });
      if (get().tenantId !== tenantId) return;
      set({ layout: result.layout, canvasStatus: "ready", activeRecipeId: null });
    } catch (error) {
      set({ canvasStatus: "error", canvasError: error instanceof Error ? error.message : String(error) });
    }
  },

  async hydrateRecipe(recipeId, tenantId = get().tenantId) {
    set({ canvasStatus: "loading", canvasError: null, progress: [] });
    try {
      const result = await api.hydrate(recipeId, tenantId);
      if (get().tenantId !== tenantId) return;
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
    const { layout, tenantId, filter } = get();
    if (!layout) return;
    const componentTypes = (filter ?? layout.components.map((c) => c.type)).filter(
      (t): t is ComponentType => t !== "HoverDiagnosticPopover" && t !== "ActionApprovalDrawer",
    );
    const tenant = TENANT_REGISTRY[tenantId];
    // The banner renders the pinned count itself, so the name must not carry it (otherwise "· 4 pinned · 4 pinned").
    const recipeName = name ?? `${tenant.displayName} triage`;
    try {
      const { recipe } = await api.pinRecipe({ name: recipeName, tenantId, componentTypes, description: `Pinned from ${tenant.ticketId}` });
      await get().loadRecipes();
      set({ activeRecipeId: recipe.recipeId });
      get().toast({ tone: "healthy", title: `Pinned "${recipe.name}"`, detail: "Tenant switches now hydrate through Tier 0 with 0 LLM tokens." });
    } catch (error) {
      get().toast({ tone: "critical", title: "Pin failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  unpinRecipe() {
    set({ activeRecipeId: null });
    get().toast({ tone: "info", title: "Recipe released", detail: "Next tenant switch will re-correlate through the model router." });
  },

  async hover(entityId, entityType) {
    const key = entityId.toLowerCase();
    const existing = get().hovers[key];
    if (existing && existing.status !== "error") return;
    set((s) => ({ hovers: { ...s.hovers, [key]: { status: "loading" } } }));
    const started = performance.now();
    try {
      const result = await api.hover({ tenantId: get().tenantId, entityId, ...(entityType ? { entityType } : {}) });
      set((s) => ({ hovers: { ...s.hovers, [key]: { status: "ready", popover: result.popover, latencyMs: Math.round(performance.now() - started) } } }));
    } catch (error) {
      set((s) => ({ hovers: { ...s.hovers, [key]: { status: "error", error: error instanceof Error ? error.message : String(error) } } }));
    }
  },

  async remediate() {
    const tenantId = get().tenantId;
    if (get().remediateStatus === "loading") return;
    set({ remediateStatus: "loading", remediateProgress: [], drawerOpen: true, approveLog: [] });
    try {
      const result = await streamPost<RemediateResponse>("/api/remediate", { tenantId }, (event) =>
        set((s) => ({ remediateProgress: [...s.remediateProgress, event] })),
      );
      set({ drawer: result.drawer, remediateStatus: "ready" });
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
        ...(decision === "approve" ? { openPullRequest: get().openPrOnApprove } : {}),
      });
      const { executionLog, ...updated } = result.drawer;
      set({ drawer: updated, approveLog: executionLog });
      get().toast({
        tone: decision === "reject" ? "warning" : "healthy",
        title: decision === "reject" ? "Remediation rejected" : `Approved · ${updated.approval.state}`,
        detail: updated.staging?.prUrl ?? executionLog[0],
      });
    } catch (error) {
      get().toast({ tone: "critical", title: "Approval failed", detail: error instanceof Error ? error.message : String(error) });
    }
  },

  async voiceSteer(input) {
    const result = await api.voiceSteer({ tenantId: get().tenantId, ...input });
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
        get().toast({ tone: "meta", title: `Voice: ${intent.intent}`, detail: components.join(", ") || "no components matched" });
        break;
      case "reset":
        get().setFilter(null);
        get().toast({ tone: "meta", title: "Voice: reset", detail: "Showing every pinned component" });
        break;
      case "switch-tenant":
        if (intent.tenantId) {
          get().toast({ tone: "meta", title: "Voice: switch tenant", detail: TENANT_REGISTRY[resolveTenantId(intent.tenantId)].displayName });
          await get().setTenant(resolveTenantId(intent.tenantId));
        }
        break;
      case "pin":
        await get().pinRecipe(intent.recipeName);
        break;
      case "unpin":
        get().unpinRecipe();
        break;
      case "generate-fix":
        await get().remediate();
        break;
      default:
        get().toast({ tone: "warning", title: "Voice: not understood", detail: `"${intent.transcript}"` });
    }
  },

  setFilter: (filter) => set({ filter }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDiffOpen: (diffOpen) => set({ diffOpen }),
  setSavingsOpen: (savingsOpen) => set({ savingsOpen }),
  setHotkeysOpen: (hotkeysOpen) => set({ hotkeysOpen }),
  setVoiceOpen: (voiceOpen) => set({ voiceOpen }),
  setToolbarLine: (toolbarLineId) => set({ toolbarLineId }),
  flashComponent: (highlightComponent) => {
    set({ highlightComponent });
    if (highlightComponent) window.setTimeout(() => set((s) => (s.highlightComponent === highlightComponent ? { highlightComponent: null } : {})), 1600);
  },
  revealComponent: (type) => {
    if (get().filter && !get().filter!.includes(type)) get().setFilter(null);
    window.requestAnimationFrame(() => {
      document.getElementById(`canvas-${type}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      get().flashComponent(type);
    });
  },
  setOpenPrOnApprove: (openPrOnApprove) => set({ openPrOnApprove }),
  toast: (toast) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => get().dismissToast(id), 5200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Components the canvas should render right now (voice filter applied). */
export function visibleComponents(layout: Layout | null, filter: ComponentType[] | null) {
  if (!layout) return [];
  const list = layout.components.filter((c) => c.type !== "HoverDiagnosticPopover" && c.type !== "ActionApprovalDrawer");
  return filter ? list.filter((c) => filter.includes(c.type)) : list;
}
