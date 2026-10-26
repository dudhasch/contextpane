import { create } from "zustand";
import {
  TENANT_REGISTRY,
  convergeLayout,
  resolveTenantId,
  type ActionApprovalDrawer,
  type AuditEntry,
  type ComponentType,
  type Convergence,
  type EntityType,
  type HoverDiagnosticPopover,
  type Layout,
  type RouterTelemetry,
  type SteerLayoutArgs,
  type TapIssueResult,
  type TenantId,
  type ViewRecipe,
} from "@contextpane/catalog";
import {
  api,
  streamPost,
  type ApproveResponse,
  type CorrelateResponse,
  type HealthResponse,
  type PolicyDetailResponse,
  type ProgressEvent,
  type RemediateResponse,
  type TelemetryStats,
  type TenantContextResponse,
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

export type DrawerTab = "powershell" | "terraform" | "entities";

export interface PolicyInspect {
  policyId: string;
  status: "loading" | "ready" | "error";
  detail?: PolicyDetailResponse;
  error?: string;
}

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
  /** Remediated tenants (notifications/resources/updated); the canvas overlays this with 0 tokens. */
  convergence: Partial<Record<TenantId, Convergence>>;
  /** Emerald pulse on every card right after a convergence push. */
  convergeFlash: boolean;
  resetting: boolean;
  audit: AuditEntry[];
  auditOpen: boolean;
  tap: (TapIssueResult & { status: "ready" }) | { status: "loading"; upn: string } | { status: "error"; upn: string; error: string } | null;
  policyInspect: PolicyInspect | null;
  vision: VisionState;
  drawerTab: DrawerTab;
  /** UPN the drawer was opened for from a hover [Assign SPE_E5]. */
  drawerFocusUpn: string | null;

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
  applyConvergence(tenantId: string, convergence: Convergence | null): void;
  resetDrift(): Promise<void>;
  setAuditOpen(open: boolean): void;
  loadAudit(): Promise<void>;
  issueTap(upn: string): Promise<void>;
  closeTap(): void;
  inspectPolicy(policyId: string): Promise<void>;
  closePolicyInspect(): void;
  openLicenseRemediation(upn?: string): void;
  setDrawerTab(tab: DrawerTab): void;
  extractVision(attachment: { url: string; fileName: string }): Promise<void>;
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
  convergence: {},
  convergeFlash: false,
  resetting: false,
  audit: [],
  auditOpen: false,
  tap: null,
  policyInspect: null,
  vision: { status: "idle" },
  drawerTab: "powershell",
  drawerFocusUpn: null,

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
      onAudit: (entry) => set((s) => (s.audit.some((e) => e.id === entry.id) ? {} : { audit: [entry, ...s.audit].slice(0, 100) })),
      onResourcesUpdated: (tenantId, convergence) => get().applyConvergence(tenantId, convergence),
    });
    api
      .labState()
      .then(({ convergence }) => convergence.forEach((c) => get().applyConvergence(c.tenantId, c)))
      .catch(() => undefined);
    void get().loadAudit();
    api
      .health()
      .then((health) => set({ health, openPrOnApprove: Boolean(health.github?.prOnApprove && health.github.origin && health.github.ghAuthenticated) }))
      .catch(() => set({ health: null }));
    await Promise.all([get().loadRecipes(), get().loadContext()]);
    await get().correlate();
  },

  async setTenant(tenantId) {
    if (tenantId === get().tenantId) return;
    set({ tenantId, hovers: {}, toolbarLineId: null, drawerOpen: false, diffOpen: false, filter: null, policyInspect: null, vision: { status: "idle" } });
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
    set({ remediateStatus: "loading", remediateProgress: [], drawerOpen: true, approveLog: [], drawerTab: "powershell" });
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
      if (decision === "reject" || !result.convergence) {
        get().toast({ tone: decision === "reject" ? "warning" : "healthy", title: decision === "reject" ? "Remediation rejected" : `Approved · ${updated.approval.state}`, detail: executionLog[0] });
        return;
      }
      const c = result.convergence;
      get().applyConvergence(c.tenantId, c);
      get().toast({
        tone: "healthy",
        title: `${c.execution === "live-graph" ? "Executed live" : "Approved (simulated)"} · canvas converged in ${c.latencyMs} ms`,
        detail: `${c.remediatedUpns.length} users → SPE_E5 · Tier 0 push · 0 LLM tokens${c.gitBranch ? ` · ${c.gitBranch}` : ""}`,
        ...(c.prUrl ? { href: c.prUrl, hrefLabel: `GitHub PR #${c.prUrl.split("/pull/")[1] ?? ""}` } : {}),
      });
      // Close the drawer so the emerald canvas is what the operator sees next.
      window.setTimeout(() => set({ drawerOpen: false }), 900);
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
  setSavingsOpen: (savingsOpen) => set(savingsOpen ? { savingsOpen, auditOpen: false } : { savingsOpen }),
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

  applyConvergence(tenantId, convergence) {
    if (!(tenantId in TENANT_REGISTRY)) return;
    const id = tenantId as TenantId;
    const current = get().convergence[id];
    if (convergence && current?.remediationId === convergence.remediationId) return;
    if (!convergence && !current) return;
    set((s) => {
      const next = { ...s.convergence };
      if (convergence) next[id] = convergence;
      else delete next[id];
      return { convergence: next, convergeFlash: Boolean(convergence) && s.tenantId === id };
    });
    if (convergence) window.setTimeout(() => set({ convergeFlash: false }), 1800);
  },

  async resetDrift() {
    if (get().resetting) return;
    const started = performance.now();
    const tenantId = get().tenantId;
    // Revert the canvas at once; the server clears its state and rewrites the lab users behind this.
    set({ resetting: true, convergence: {}, drawer: null, drawerOpen: false, remediateStatus: "idle", remediateProgress: [], approveLog: [], tap: null, policyInspect: null, vision: { status: "idle" }, hovers: {} });
    try {
      const result = await api.resetDrift();
      const graph = result.results.find((r) => r.tenantId === "tenant-contoso-01");
      get().toast({
        tone: result.ok ? "info" : "warning",
        title: `Demo drift restored · canvas ${Math.round(performance.now() - started) < 50 ? "instant" : "reset"}`,
        detail: `${graph?.users.length ?? 0} Contoso users → SPE_E3 (${graph?.source === "live-graph" ? `live Graph ${graph.latencyMs} ms` : (graph?.fallbackReason ?? "simulated")})`,
      });
      void get().loadContext(tenantId, true);
      // A canvas correlated after the approval already carries the live (compliant) state: hydrate it again.
      const card = get().layout?.components.find((c) => c.type === "LicenseDriftCard");
      if (card && card.type === "LicenseDriftCard" && card.props.driftedCount === 0 && tenantId === "tenant-contoso-01") {
        const recipe = get().activeRecipeId;
        if (recipe) void get().hydrateRecipe(recipe);
        else void get().correlate({ fresh: true });
      }
    } catch (error) {
      get().toast({ tone: "critical", title: "Reset failed", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ resetting: false });
    }
  },

  setAuditOpen(auditOpen) {
    set(auditOpen ? { auditOpen, savingsOpen: false } : { auditOpen });
    if (auditOpen) void get().loadAudit();
  },

  async loadAudit() {
    try {
      const { entries } = await api.audit(100);
      set({ audit: entries });
    } catch {
      /* orchestrator down */
    }
  },

  async issueTap(upn) {
    set({ tap: { status: "loading", upn } });
    try {
      const result = await api.issueTap({ tenantId: get().tenantId, upn });
      set({ tap: { ...result, status: "ready" } });
    } catch (error) {
      set({ tap: { status: "error", upn, error: error instanceof Error ? error.message : String(error) } });
    }
  },

  closeTap: () => set({ tap: null }),

  async inspectPolicy(policyId) {
    set({ policyInspect: { policyId, status: "loading" } });
    get().revealComponent("EntraSignInTimeline");
    try {
      const detail = await api.policy(get().tenantId, policyId);
      if (get().policyInspect?.policyId === policyId) set({ policyInspect: { policyId, status: "ready", detail } });
    } catch (error) {
      set({ policyInspect: { policyId, status: "error", error: error instanceof Error ? error.message : String(error) } });
    }
  },

  closePolicyInspect: () => set({ policyInspect: null }),

  openLicenseRemediation(upn) {
    set({ drawerTab: "powershell", drawerFocusUpn: upn ?? null });
    const { drawer, tenantId } = get();
    if (drawer && drawer.tenantId === tenantId && drawer.approval.state === "pending") set({ drawerOpen: true });
    else void get().remediate();
  },

  setDrawerTab: (drawerTab) => set({ drawerTab }),

  async extractVision(attachment) {
    const tenantId = get().tenantId;
    const ticketId = get().context?.ticket.ticketId ?? TENANT_REGISTRY[tenantId].ticketId;
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
      const result = await api.visionExtract({ tenantId, ticketId, fileName: attachment.fileName, imageDataUri });
      if (get().tenantId !== tenantId) return;
      set({ vision: { status: "ready", result, latencyMs: Math.round(performance.now() - started) } });
      if (result.match) get().revealComponent("EntraSignInTimeline");
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
 * tenant's convergence overlaid, memoised so zustand selectors stay stable.
 */
export function selectCanvasLayout(s: Pick<WorkbenchState, "layout" | "convergence" | "tenantId">): Layout | null {
  const convergence = s.layout ? s.convergence[s.layout.tenantId as TenantId] : undefined;
  if (convergedCache.layout === s.layout && convergedCache.convergence === convergence) return convergedCache.result;
  const result = s.layout && convergence ? convergeLayout(s.layout, convergence) : s.layout;
  convergedCache = { layout: s.layout, convergence, result };
  return result;
}

/** Convergence of the tenant on screen, if it was remediated. */
export function selectConvergence(s: Pick<WorkbenchState, "convergence" | "tenantId">): Convergence | undefined {
  return s.convergence[s.tenantId];
}

/** Components the canvas should render right now (voice filter applied). */
export function visibleComponents(layout: Layout | null, filter: ComponentType[] | null) {
  if (!layout) return [];
  const list = layout.components.filter((c) => c.type !== "HoverDiagnosticPopover" && c.type !== "ActionApprovalDrawer");
  return filter ? list.filter((c) => filter.includes(c.type)) : list;
}
