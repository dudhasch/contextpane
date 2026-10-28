import {
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Compass,
  Database,
  FolderKanban,
  Layers,
  Plus,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import type { ContextViewMode } from "@contextpane/catalog";
import { humanizeSource, SOURCE_LABEL } from "@/lib/format";
import { displayInventoryItem } from "@/lib/pseudonym";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { CONTEXT_MODE_LIST, ContextModeIcon } from "../ui/ContextModeIcons";
import { Pill, type Tone } from "../ui/Pill";

const QUICK_TENANT_CHIPS: Array<{ label: string; prompt: string; viewMode: ContextViewMode }> = [
  { label: "Azure VMs (Get-AzVM)", prompt: "what vms do we have ?", viewMode: "dashboard" },
  { label: "Azure ARM Resources", prompt: "what resources do we have ?", viewMode: "dashboard" },
  { label: "Users & License Drift", prompt: "Entra ID users, SKU assignments, and disabled accounts holding licenses", viewMode: "dashboard" },
  { label: "Conditional Access Posture", prompt: "Conditional Access policies, report-only drift, and break-glass exclusions", viewMode: "comparison" },
  { label: "Failed Sign-In Audit", prompt: "Failed Entra sign-in events, AADSTS error codes, and blocking policies", viewMode: "dashboard" },
  { label: "Workload Identities & OIDC", prompt: "Service principal client secret expiry, OIDC federation, and app permissions", viewMode: "blast-radius" },
  { label: "Intune Device Compliance", prompt: "Non-compliant and conflicting Intune managed devices and settings catalog", viewMode: "full-card" },
  { label: "Azure Quotas & Policies", prompt: "Azure regional vCPU compute quotas, NSG rules, and policy compliance", viewMode: "dashboard" },
];

const QUICK_KNOWLEDGE_CHIPS: Array<{ label: string; prompt: string; viewMode: ContextViewMode }> = [
  { label: "Token Protection vs CAE", prompt: "Compare Entra ID Conditional Access Token Protection vs Continuous Access Evaluation (CAE)", viewMode: "comparison" },
  { label: "Private Link vs Service Endpoints", prompt: "Compare Azure Private Link (Private Endpoints) vs VNet Service Endpoints for PaaS security", viewMode: "comparison" },
  { label: "Zero Trust Break-Glass", prompt: "Zero Trust emergency break-glass account architecture, FIDO2 binding, and monitoring", viewMode: "full-card" },
  { label: "OIDC vs Client Secrets", prompt: "Workload Identity Federation (OIDC) subject claims vs static client secrets (AADSTS7000222 / AADSTS70021)", viewMode: "blast-radius" },
  { label: "AVD Reverse Connect", prompt: "Azure Virtual Desktop Reverse Connect TLS 443 transport vs inbound TCP 3389 RDP exposure", viewMode: "dashboard" },
];

const TONE_MAP: Record<"default" | "warning" | "critical" | "success", Tone> = {
  default: "muted",
  warning: "warning",
  critical: "critical",
  success: "healthy",
};

export function FreeRoamExplorer() {
  const dataMode = useWorkbench((s) => s.dataMode);
  const togglingDataMode = useWorkbench((s) => s.togglingDataMode);
  const setDataMode = useWorkbench((s) => s.setDataMode);
  const inventory = useWorkbench((s) => s.freeRoamInventory);
  const inventoryStatus = useWorkbench((s) => s.freeRoamInventoryStatus);
  const loadInventory = useWorkbench((s) => s.loadFreeRoamInventory);
  const scope = useWorkbench((s) => s.freeRoamScope);
  const setScope = useWorkbench((s) => s.setFreeRoamScope);
  const spawnDashboard = useWorkbench((s) => s.spawnFreeRoamDashboard);
  const stageRemediation = useWorkbench((s) => s.stageFreeRoamRemediation);
  const exploreStatus = useWorkbench((s) => s.exploreStatus);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const scanAnomalies = useWorkbench((s) => s.scanAnomalies);
  const scanningAnomalies = useWorkbench((s) => s.scanningAnomalies);
  const dashboards = useWorkbench((s) => s.freeRoamDashboards);
  const savedBoards = useWorkbench((s) => s.savedBoards);
  const saveBoard = useWorkbench((s) => s.saveCurrentFreeRoamBoard);
  const loadBoard = useWorkbench((s) => s.loadSavedFreeRoamBoard);
  const deleteBoard = useWorkbench((s) => s.deleteSavedFreeRoamBoard);

  const [prompt, setPrompt] = useState("");
  const [refinement, setRefinement] = useState("");
  const [viewMode, setViewMode] = useState<ContextViewMode>("dashboard");
  const [boardName, setBoardName] = useState("");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    users: true,
    "ca-policies": true,
    "sku-pools": false,
  });

  const toggleCat = (id: string) =>
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleSpawn = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (prompt.trim().length < 2) return;
    void spawnDashboard(prompt.trim(), {
      ...(refinement.trim() ? { refinementText: refinement.trim() } : {}),
      scope,
      viewMode,
    });
  };

  const handleStageScript = () => {
    const targetPrompt =
      prompt.trim() ||
      dashboards[0]?.selectionText ||
      "Audit and remediate live tenant Conditional Access and licensing posture";
    void stageRemediation({
      prompt: targetPrompt,
      title: `Free-Roam Action · ${targetPrompt.slice(0, 56)}`,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="free-roam-explorer">
      {/* Top Banner */}
      <header className="shrink-0 border-b border-border bg-surface/90 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-selection/15 text-selection">
              <Compass className="size-3.5" />
            </span>
            <div>
              <h1 className="text-[13px] font-semibold tracking-tight text-text">
                Free-Roam Startpage · Knowledge &amp; Tenant Explorer
              </h1>
              <p className="text-[11px] text-muted">
                Open any lens on live MCP tenant telemetry or cloud architecture knowledge without opening a ticket
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={togglingDataMode}
              onClick={() => void setDataMode(dataMode === "real-tenant" ? "simulated-lab" : "real-tenant")}
              data-testid="freeroam-datamode-toggle"
              title="Toggle MCP Data Mode between Strict Real Tenant (zero mock fallback) and Simulated Lab"
              className={`inline-flex h-6 items-center gap-1.5 rounded-pill border px-2.5 font-mono text-[11px] font-semibold transition-colors ${
                dataMode === "real-tenant"
                  ? "border-healthy/50 bg-healthy/15 text-healthy hover:bg-healthy/25"
                  : "border-primary/40 bg-primary/12 text-primary hover:bg-primary/20"
              }`}
            >
              <Database className="size-3" />
              {dataMode === "real-tenant" ? "MCP: Real Tenant Only" : "MCP: Simulated Lab"}
            </button>
          </div>
        </div>
      </header>

      {/* Scrollable Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {/* Universal Knowledge & Telemetry Composer */}
        <form
          onSubmit={handleSpawn}
          className="rounded-lg border border-selection/35 bg-surface p-3 shadow-sm"
          data-testid="free-roam-composer"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-selection">
              <Wand2 className="size-3.5" />
              <span>Open a Triage Lens or Knowledge Matrix</span>
            </div>
            <span className="font-mono text-[10px] text-faint">muse-wonder-1.0 · MCP Grounded</span>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="Ask anything or query your tenant (e.g. 'Show all Conditional Access policies & break-glass exclusions', 'Compare Private Link vs Service Endpoints', 'AADSTS70021 OIDC claims')..."
            data-testid="free-roam-prompt-input"
            className="w-full resize-none rounded-md border border-border bg-canvas/80 px-2.5 py-2 text-[12px] text-text placeholder:text-faint focus:border-selection focus:outline-none"
          />

          <input
            type="text"
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            placeholder="Optional refinement / constraint (e.g. 'focus on privileged roles', 'include PowerShell 7 audit script')..."
            data-testid="free-roam-refinement-input"
            className="mt-1.5 h-7 w-full rounded-md border border-border-subtle bg-canvas/60 px-2.5 text-[11px] text-text placeholder:text-faint focus:border-selection focus:outline-none"
          />

          {/* Scope + ViewMode Bar */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-canvas/70 p-0.5 text-[11px]">
              {(
                [
                  { id: "hybrid", label: "Hybrid (MCP + AI)" },
                  { id: "tenant-only", label: "Strict Tenant MCP" },
                  { id: "knowledge", label: "Cloud Knowledge" },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScope(s.id)}
                  data-testid={`free-roam-scope-${s.id}`}
                  className={`rounded px-2 py-0.5 transition-colors ${
                    scope === s.id
                      ? "bg-selection/20 font-medium text-selection"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-canvas/70 p-0.5">
              {CONTEXT_MODE_LIST.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  onClick={() => setViewMode(m.mode)}
                  title={`${m.label}: ${m.hint}`}
                  data-testid={`free-roam-mode-${m.mode}`}
                  className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] transition-colors ${
                    viewMode === m.mode
                      ? "bg-selection/20 font-medium text-selection"
                      : "text-muted hover:text-text"
                  }`}
                >
                  <ContextModeIcon mode={m.mode} className="size-3" />
                  <span>{m.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button
              type="submit"
              variant="primary"
              icon={<Sparkles />}
              loading={exploreStatus === "loading"}
              disabled={prompt.trim().length < 2}
              data-testid="free-roam-spawn-button"
            >
              Open Lens
            </Button>
            <Button
              type="button"
              variant="meta"
              icon={<Wrench />}
              loading={remediateStatus === "loading"}
              onClick={handleStageScript}
              title="Synthesize a PowerShell 7 / Graph / Terraform remediation bundle with AST & -WhatIf Pre-Flight verification"
              data-testid="free-roam-stage-script-button"
            >
              Stage Action &amp; Pre-Flight Script
            </Button>
            <Button
              type="button"
              variant="outline"
              icon={<Radar />}
              loading={scanningAnomalies}
              onClick={() => void scanAnomalies()}
              title="Scan MCP endpoints (Entra ID, Intune, Azure ARM) for live anomalies and add findings to the Work Queue"
              data-testid="free-roam-scan-anomalies-button"
              className="ml-auto"
            >
              Scan Tenant for Anomalies
            </Button>
          </div>
        </form>

        {/* 1-Click Quick-Spawn Chips: Live Tenant Posture */}
        <section className="rounded-lg border border-border-subtle bg-surface/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
              <Layers className="size-3 text-primary" />
              1-Click Live Tenant Posture Lenses (via MCP)
            </span>
            <span className="font-mono text-[10px] text-muted">
              {dataMode === "real-tenant" ? "Live Graph & ARM" : SOURCE_LABEL["simulated-lab"]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TENANT_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => {
                  setPrompt(chip.prompt);
                  setViewMode(chip.viewMode);
                  void spawnDashboard(chip.prompt, { scope: "hybrid", viewMode: chip.viewMode });
                }}
                data-testid={`quick-tenant-chip-${chip.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="inline-flex items-center gap-1 rounded-pill border border-border bg-elevated/80 px-2.5 py-1 text-[11px] text-text transition-colors hover:border-selection/50 hover:bg-selection/10 hover:text-selection"
              >
                <Plus className="size-3 text-selection" />
                {chip.label}
              </button>
            ))}
          </div>
        </section>

        {/* 1-Click Quick-Spawn Chips: Cloud & Security Knowledge */}
        <section className="rounded-lg border border-border-subtle bg-surface/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
              <BookOpen className="size-3 text-meta" />
              Cloud, Identity &amp; Security Reference Matrices
            </span>
            <span className="font-mono text-[10px] text-faint">Principal Architect Encyclopedia</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_KNOWLEDGE_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => {
                  setPrompt(chip.prompt);
                  setViewMode(chip.viewMode);
                  void spawnDashboard(chip.prompt, { scope: "knowledge", viewMode: chip.viewMode });
                }}
                data-testid={`quick-knowledge-chip-${chip.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="inline-flex items-center gap-1 rounded-pill border border-border bg-elevated/80 px-2.5 py-1 text-[11px] text-text transition-colors hover:border-meta/50 hover:bg-meta/10 hover:text-meta"
              >
                <Sparkles className="size-3 text-meta" />
                {chip.label}
              </button>
            ))}
          </div>
        </section>

        {/* Live MCP Tenant Entity Tree */}
        <section
          className="rounded-lg border border-border-subtle bg-surface/70 p-2.5"
          data-testid="free-roam-entity-tree"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-healthy" />
              <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                Live MCP Tenant Explorer ({inventory?.tenant.displayName ?? "Contoso"} · {inventory?.tenant.verifiedDomain ?? ""})
              </span>
            </div>
            <button
              type="button"
              onClick={() => void loadInventory()}
              title="Refresh MCP tenant inventory"
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-text"
            >
              <RefreshCw className={`size-2.5 ${inventoryStatus === "loading" ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {inventory && (
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              <div className="rounded border border-border-subtle bg-canvas/60 px-2 py-1">
                <div className="text-[10px] text-faint uppercase">Users</div>
                <div className="font-mono text-[12px] font-semibold text-text">{inventory.summary.users}</div>
              </div>
              <div className="rounded border border-border-subtle bg-canvas/60 px-2 py-1">
                <div className="text-[10px] text-faint uppercase">CA Policies</div>
                <div className="font-mono text-[12px] font-semibold text-text">{inventory.summary.caPolicies}</div>
              </div>
              <div className="rounded border border-border-subtle bg-canvas/60 px-2 py-1">
                <div className="text-[10px] text-faint uppercase">SKU Pools</div>
                <div className="font-mono text-[12px] font-semibold text-text">{inventory.summary.skuPools}</div>
              </div>
              <div className="rounded border border-border-subtle bg-canvas/60 px-2 py-1">
                <div className="text-[10px] text-faint uppercase">ARM Objects</div>
                <div className="font-mono text-[12px] font-semibold text-text">
                  {inventory.summary.azureResources + inventory.summary.azurePolicies}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {(inventory?.categories ?? []).map((cat) => {
              const isOpen = Boolean(openCategories[cat.id]);
              const isLiveSource = cat.source.startsWith("live");
              return (
                <div key={cat.id} className="rounded-md border border-border-subtle bg-canvas/40">
                  <button
                    type="button"
                    onClick={() => toggleCat(cat.id)}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11.5px] font-medium text-text hover:bg-elevated/60"
                  >
                    <div className="flex items-center gap-1.5">
                      {isOpen ? (
                        <ChevronDown className="size-3.5 text-muted" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted" />
                      )}
                      <span>{cat.title}</span>
                      <span className="rounded bg-elevated px-1.5 font-mono text-[10px] text-muted">
                        {cat.count}
                      </span>
                    </div>
                    <Pill tone={isLiveSource ? "healthy" : "muted"}>
                      {cat.source === "seeded-manifest" ? SOURCE_LABEL["simulated-lab"] : humanizeSource(cat.source)}
                    </Pill>
                  </button>
                  {isOpen && (
                    <div className="max-h-48 divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle bg-surface/80">
                      {cat.items.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-faint">
                          No objects returned by MCP in {humanizeSource(dataMode)} mode.
                        </div>
                      ) : (
                        cat.items.map((item) => {
                          const shown = displayInventoryItem(item, cat, dataMode);
                          return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              void spawnDashboard(item.queryPrompt, {
                                scope: "hybrid",
                                viewMode: "dashboard",
                              })
                            }
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-selection/10"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-text">{shown.label}</div>
                              <div className="truncate font-mono text-[10px] text-faint">{shown.sublabel}</div>
                            </div>
                            <Pill tone={TONE_MAP[item.tone]}>{item.badge}</Pill>
                          </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Saved Free-Roam Boards */}
        <section className="rounded-lg border border-border-subtle bg-surface/60 p-2.5" data-testid="free-roam-saved-boards">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
              <FolderKanban className="size-3 text-selection" />
              Saved Lens Boards ({savedBoards.length})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="Board name (e.g. 'Morning Tenant Posture Audit')..."
              className="h-7 flex-1 rounded border border-border bg-canvas/80 px-2 text-[11px] text-text placeholder:text-faint focus:border-selection focus:outline-none"
            />
            <Button
              size="xs"
              variant="outline"
              icon={<Bookmark />}
              disabled={dashboards.length === 0}
              onClick={() => {
                saveBoard(boardName);
                setBoardName("");
              }}
            >
              Save Current ({dashboards.length})
            </Button>
          </div>

          {savedBoards.length > 0 && (
            <div className="mt-2 space-y-1">
              {savedBoards.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-canvas/50 px-2.5 py-1 text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => loadBoard(b.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium text-text hover:text-selection"
                  >
                    <span className="truncate">{b.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-faint">
                      ({b.dashboards.length} cards)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteBoard(b.id)}
                    className="text-faint hover:text-critical"
                    title="Delete saved board"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
