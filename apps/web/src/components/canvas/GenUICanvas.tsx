import { Bot, Check, ChevronRight, Clock3, Compass, Database, LayoutGrid, Pin, Sparkles, Trash2, Undo2, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LayoutComponent } from "@contextpane/catalog";
import { selectActiveTimelineSlice, selectCanvasLayout, selectConvergence, useWorkbench, visibleComponents } from "@/store";
import { Button } from "../ui/Button";
import { EntraSignInTimelineCard } from "./EntraSignInTimeline";
import { IaCDriftBannerCard } from "./IaCDriftBanner";
import { IntuneDriftCardView } from "./IntuneDriftCard";
import { ContextualMiniDashboardCard } from "./ContextualMiniDashboard";
import { LicenseDriftCardView } from "./LicenseDriftCard";
import { ProgressRail } from "./ProgressRail";
import { RowFilterPill } from "./TableFilter";
import { SynthesizedDynamicCard } from "../cards/SynthesizedDynamicCard";

/**
 * Right pane. Mounts only catalog components the orchestrator returned and Zod
 * validated — there is no generic text/markdown renderer by design. Cards start
 * compact; the left pane expands and focuses them.
 */
export function GenUICanvas() {
  const freeRoamOpen = useWorkbench((s) => s.freeRoamOpen);
  const freeRoamDashboards = useWorkbench((s) => s.freeRoamDashboards);
  const clearFreeRoamDashboards = useWorkbench((s) => s.clearFreeRoamDashboards);
  const dataMode = useWorkbench((s) => s.dataMode);
  const inventory = useWorkbench((s) => s.freeRoamInventory);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const layout = useWorkbench(selectCanvasLayout);
  const status = useWorkbench((s) => s.canvasStatus);
  const error = useWorkbench((s) => s.canvasError);
  const progress = useWorkbench((s) => s.progress);
  const filter = useWorkbench((s) => s.filter);
  const miniDashboards = useWorkbench((s) => s.miniDashboards);
  const exploreStatus = useWorkbench((s) => s.exploreStatus);
  const activeExploreText = useWorkbench((s) => s.activeExploreText);
  const triageStatus = useWorkbench((s) => s.triageStatus);
  const pendingTriageTitle = useWorkbench((s) => s.pendingTriageTitle);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const briefTitle = useWorkbench((s) => s.brief?.title);
  const components = visibleComponents(layout, filter);

  if (freeRoamOpen) {
    return (
      <div className="flex h-full flex-col" data-testid="free-roam-canvas">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[12px]">
          <Compass className="size-3.5 shrink-0 text-selection" />
          <span className="font-medium text-text">Free-Roam Multi-Dashboard Workspace</span>
          <ChevronRight className="size-3 shrink-0 text-faint" />
          <span className="truncate font-mono text-[11px] text-muted">
            {inventory?.tenant.displayName ?? "Contoso"} ({inventory?.tenant.verifiedDomain ?? "c4a8shili.onmicrosoft.com"})
          </span>
          <span className="shrink-0 font-mono text-[11px] text-selection">
            · {freeRoamDashboards.length} {freeRoamDashboards.length === 1 ? "dashboard" : "dashboards"} mounted
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className={`inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] ${
                dataMode === "real-tenant"
                  ? "border-healthy/40 bg-healthy/12 text-healthy"
                  : "border-primary/40 bg-primary/12 text-primary"
              }`}
              data-testid="free-roam-canvas-datamode"
            >
              <Database className="size-3" />
              {dataMode === "real-tenant" ? "Strict Real Tenant (MCP)" : "Simulated Lab (MCP)"}
            </span>
            {freeRoamDashboards.length > 0 && (
              <>
                <Button
                  size="xs"
                  variant="meta"
                  icon={<Wrench />}
                  onClick={() => openRemediation()}
                  title="Stage PowerShell 7 / Graph / Terraform action for the active Free-Roam dashboard"
                >
                  Stage Action
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Trash2 />}
                  onClick={() => clearFreeRoamDashboards()}
                  title="Clear all spawned dashboards from the Free-Roam workspace"
                >
                  Clear ({freeRoamDashboards.length})
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5">
          {triageStatus === "loading" && (
            <SubAgentSynthesisSkeleton
              mode="triage"
              title={pendingTriageTitle ?? "Custom Incident / Project Goal"}
            />
          )}
          {exploreStatus === "loading" && (
            <SelectionSynthesisSkeleton selectionText={activeExploreText ?? "Free-Roam Query"} />
          )}
          {freeRoamDashboards.map((m) => (
            <ContextualMiniDashboardCard key={m.id} entry={m} />
          ))}
          {freeRoamDashboards.length === 0 && exploreStatus !== "loading" && (
            <div className="card flex flex-col items-center justify-center gap-2 border-dashed border-border py-12 text-center">
              <Compass className="size-7 text-selection/70" />
              <div className="text-[13px] font-semibold text-text">
                Free-Roam Knowledge &amp; Telemetry Canvas Ready
              </div>
              <p className="max-w-md text-[11.5px] text-muted">
                Type any cloud architecture question, error code, or tenant query in the left explorer—or click any entity in the live MCP tenant tree—to dynamically spawn interactive dashboards. Highlight any text on any card to recursively drill down.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TenantBreadcrumb cards={components.length} customCards={miniDashboards.length} />
      <TimeTravelScrubber />
      <HistoricalSnapshotBanner />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {(triageStatus === "loading" || refiningGoal) && (
          <SubAgentSynthesisSkeleton
            mode={triageStatus === "loading" ? "triage" : "refine"}
            title={triageStatus === "loading" ? (pendingTriageTitle ?? "Custom Incident / Project Goal") : (briefTitle ?? "Refining Scope & Plan")}
          />
        )}
        {exploreStatus === "loading" && (
          <SelectionSynthesisSkeleton selectionText={activeExploreText ?? "selection"} />
        )}
        {miniDashboards.map((m) => (
          <ContextualMiniDashboardCard key={m.id} entry={m} />
        ))}
        {status === "loading" && !layout && <ProgressRail events={progress} title="Correlating scenario" busy />}
        {status === "error" && <div className="card border-critical/40 text-sm text-critical">Canvas error: {error}</div>}
        {layout && components.map((c) => <Component key={c.id} component={c} />)}
        {layout && components.length === 0 && status === "ready" && <div className="card text-sm text-muted">No components match the current filter.</div>}
      </div>
    </div>
  );
}

const SUB_AGENT_SYNTHESIS_STAGES = [
  { step: 1, name: "Scope Check", role: "Target Scope & Clarifying Options", source: "Ticket & Tenant" },
  { step: 2, name: "Live Telemetry", role: "Live Graph, ARM & Cloud Status Correlation", source: "Graph & ARM" },
  { step: 3, name: "View Layout", role: "Diagnostic Card & Block Layout", source: "Live Context" },
  { step: 4, name: "Remediation Plan", role: "PowerShell 7, Graph JSON & Terraform Diff", source: "Idempotent Fix" },
  { step: 5, name: "Pre-Flight Safety", role: "AST, -WhatIf Guard & 1-Click Undo Verification", source: "Safety Prover" },
] as const;

function SubAgentSynthesisSkeleton({ mode, title }: { mode: "triage" | "refine"; title: string }) {
  const [elapsedMs, setElapsedMs] = useState(100);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - started));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const activeStageIndex = Math.min(4, Math.floor(elapsedMs / 1200));

  return (
    <section
      className="card animate-fade-in border-l-4 border-l-primary bg-surface/95 p-3 shadow-popover"
      data-testid="subagent-synthesis-skeleton"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <Bot className="size-4 text-primary" />
          <span className="text-[12.5px] font-semibold text-text">
            {mode === "triage"
              ? "5-Stage Triage Pipeline · Analyzing Ticket & Live Tenant State"
              : "Updating Resolution Plan, Diagnostic View & Remediation Scripts"}
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-pill border border-primary/45 bg-primary/15 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-primary"
          data-testid="synthesis-elapsed-timer"
        >
          <Sparkles className="size-3 animate-pulse" />
          Live Triage · {elapsedSec}s elapsed
        </span>
      </div>

      <div className="mt-1 truncate text-[11.5px] text-muted">
        Target: <span className="font-medium text-text">{title}</span>
      </div>

      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-5">
        {SUB_AGENT_SYNTHESIS_STAGES.map((st, idx) => {
          const done = idx < activeStageIndex;
          const active = idx === activeStageIndex;
          return (
            <div
              key={st.step}
              className={`rounded-md border p-2 text-[10.5px] transition-all ${
                done
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : active
                    ? "animate-pulse border-primary bg-primary/15 text-text shadow-[0_0_12px_rgba(56,189,248,0.2)]"
                    : "border-border-subtle bg-canvas/60 text-faint"
              }`}
            >
              <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                <span className="font-semibold">
                  {done ? "✓" : active ? "●" : st.step} {st.name}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] opacity-85">{st.role}</div>
              <div className="mt-1 font-mono text-[9.5px] text-primary/90">{st.source}</div>
            </div>
          );
        })}
      </div>

      {/* Shimmer skeleton preview of upcoming SynthesizedDynamicCard */}
      <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-md border border-border-subtle bg-canvas/60 p-2.5">
        <div className="space-y-1.5 rounded border border-border-subtle/70 bg-surface/70 p-2">
          <div className="h-2.5 w-2/3 animate-pulse rounded bg-elevated" />
          <div className="h-2 w-full animate-pulse rounded bg-primary/25" />
          <div className="h-2 w-4/5 animate-pulse rounded bg-elevated" />
        </div>
        <div className="space-y-1.5 rounded border border-border-subtle/70 bg-surface/70 p-2">
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-elevated" />
          <div className="h-2 w-full animate-pulse rounded bg-teal-500/25" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-elevated" />
        </div>
        <div className="space-y-1.5 rounded border border-border-subtle/70 bg-surface/70 p-2">
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-elevated" />
          <div className="h-2 w-full animate-pulse rounded bg-emerald-500/25" />
          <div className="h-2 w-3/5 animate-pulse rounded bg-elevated" />
        </div>
      </div>
    </section>
  );
}

function SelectionSynthesisSkeleton({ selectionText }: { selectionText: string }) {
  const [elapsedMs, setElapsedMs] = useState(100);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - started));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  return (
    <div
      className="card space-y-2 border-l-4 border-l-selection bg-surface/95 p-3 text-[12px] text-selection"
      data-testid="mini-dashboard-loading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="size-3.5 animate-spin rounded-full border-2 border-selection border-t-transparent" />
          <span>
            Analyzing live tenant context for &quot;{selectionText}&quot;...
          </span>
        </div>
        <span className="rounded-pill border border-selection/40 bg-selection/12 px-2 py-0.5 font-mono text-[10.5px]">
          {elapsedSec}s elapsed · Live Query
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((k) => (
          <div key={k} className="rounded border border-border-subtle bg-canvas/70 p-2">
            <div className="h-2 w-1/2 animate-pulse rounded bg-elevated" />
            <div className="mt-1.5 h-3.5 w-2/3 animate-pulse rounded bg-selection/25" />
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoricalSnapshotBanner() {
  const timeline = useWorkbench((s) => s.timeline);
  const activeSlice = useWorkbench(selectActiveTimelineSlice);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const cardCount = useWorkbench((s) => s.layout?.components.length ?? 1);
  const select = useWorkbench((s) => s.selectTimelineSlice);
  if (!timeline || !activeSlice || activeSlice.relativeLabel === "NOW" || activeSlice.kind === "now") {
    return null;
  }
  const nowSlice = timeline.slices.find((s) => s.relativeLabel === "NOW" || s.kind === "now") ?? timeline.slices.at(-2) ?? timeline.slices.at(-1);
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/12 px-3 py-1.5 text-[11.5px] text-amber-200"
      data-testid="historical-snapshot-banner"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Clock3 className="size-3.5 shrink-0 text-amber-400" />
        <span className="font-semibold text-amber-300">
          Historical Snapshot: {formatTimelineStepLabel(activeSlice)}
        </span>
        <span className="truncate text-amber-200/90">
          — {formatTimelineStepDescription(activeSlice, scenarioId, cardCount)} (Pre-incident tenant posture)
        </span>
      </div>
      {nowSlice && (
        <button
          type="button"
          onClick={() => select(nowSlice.id)}
          data-testid="return-to-now-button"
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-amber-400/50 bg-amber-500/20 px-2 font-mono text-[10.5px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/30"
        >
          <Check className="size-3" />
          Return to Now
        </button>
      )}
    </div>
  );
}

function formatTimelineStepLabel(s: { kind?: string; relativeLabel: string; timestamp: string; label: string }): string {
  const hhmm = s.timestamp.slice(11, 16);
  if (s.kind === "baseline" || s.relativeLabel === "T-18m") return `Before Issue (${hhmm})`;
  if (s.kind === "drift" || s.relativeLabel === "T-14m") return `Config Changed (${hhmm})`;
  if (s.kind === "first-failure" || s.relativeLabel === "T-06m") return `First Error (${hhmm})`;
  if (s.kind === "now" || s.relativeLabel === "NOW") return "Now (Active)";
  if (s.kind === "counterfactual" || s.relativeLabel === "T+Fix") return "After Fix (Preview)";
  return s.label;
}

function formatTimelineStepDescription(
  s: { kind?: string; relativeLabel: string; state: { summary: string } },
  scenarioId: string,
  cardCount = 3,
): string {
  const isAvd = scenarioId === "INC-4092";
  if (s.kind === "baseline" || s.relativeLabel === "T-18m") return "Healthy baseline · 0 issues";
  if (s.kind === "drift" || s.relativeLabel === "T-14m") return isAvd ? "Drift introduced · 3 users & port 3389" : "Drift introduced · Config changed";
  if (s.kind === "first-failure" || s.relativeLabel === "T-06m") return isAvd ? "First AVD sign-in error (53003)" : "First user or device error";
  if (s.kind === "now" || s.relativeLabel === "NOW") {
    return `Active incident · ${cardCount} ${cardCount === 1 ? "card" : "cards"} mounted`;
  }
  if (s.kind === "counterfactual" || s.relativeLabel === "T+Fix") return "Preview after fix · All healthy";
  return s.state.summary;
}

/** Clean, self-explanatory Incident Timeline bar. */
function TimeTravelScrubber() {
  const timeline = useWorkbench((s) => s.timeline);
  const sliceId = useWorkbench((s) => s.timelineSliceId);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const cardCount = useWorkbench((s) => s.layout?.components.length ?? 1);
  const select = useWorkbench((s) => s.selectTimelineSlice);
  const load = useWorkbench((s) => s.loadDrawerExtras);
  const convergence = useWorkbench(selectConvergence);
  const rollbackNow = useWorkbench((s) => s.rollbackNow);
  if (!timeline) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[11px] text-faint hover:text-text"
        data-testid="timeline-scrubber"
      >
        <span>🕒 Incident Timeline…</span>
      </button>
    );
  }
  const active = timeline.slices.find((s) => s.id === sliceId);
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-1.5 border-b border-border bg-surface/30 px-3" data-testid="timeline-scrubber">
      <div className="flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-[10.5px] font-medium whitespace-nowrap text-muted">🕒 Timeline:</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {timeline.slices.map((s, idx) => {
            const isSelected = s.id === sliceId;
            const label = formatTimelineStepLabel(s);
            return (
              <div key={s.id} className="flex items-center gap-0.5">
                {idx > 0 && <span className="text-[9px] text-faint">→</span>}
                <button
                  type="button"
                  onClick={() => select(s.id)}
                  title={s.state.summary}
                  className={`h-5 shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] whitespace-nowrap transition-colors ${
                    isSelected
                      ? "border-primary/60 bg-primary/15 font-semibold text-primary"
                      : "border-border-subtle bg-surface text-muted hover:border-border hover:text-text"
                  }`}
                >
                  {label}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {active && !convergence && (
        <span className="min-w-0 truncate text-[10.5px] text-muted">{formatTimelineStepDescription(active, scenarioId, cardCount)}</span>
      )}
      {convergence && (
        <button
          type="button"
          onClick={() => void rollbackNow()}
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-healthy/40 bg-healthy/12 px-2 text-[10.5px] font-medium whitespace-nowrap text-healthy hover:bg-healthy/20"
          data-testid="rollback-button"
        >
          <Undo2 className="size-3 shrink-0" /> Undo Change (Restore Previous State)
        </button>
      )}
    </div>
  );
}

/** One line instead of a tenant header card: tenant › domain › scenario, plus recipe and voice-filter chips. */
function TenantBreadcrumb({ cards, customCards = 0 }: { cards: number; customCards?: number }) {
  const brief = useWorkbench((s) => s.brief);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const status = useWorkbench((s) => s.canvasStatus);
  const filter = useWorkbench((s) => s.filter);
  const setFilter = useWorkbench((s) => s.setFilter);
  const activeRecipeId = useWorkbench((s) => s.activeRecipeId);
  const recipes = useWorkbench((s) => s.recipes);
  const resolved = Boolean(useWorkbench(selectConvergence));
  const recipe = recipes.find((r) => r.recipeId === activeRecipeId);
  const live = brief ? Object.values(brief.sources).filter((v) => v.startsWith("live")).length : 0;
  const total = brief ? Object.keys(brief.sources).length : 0;
  const totalCards = cards + customCards;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[12px]" data-testid="tenant-breadcrumb">
      <LayoutGrid className="size-3.5 shrink-0 text-primary" />
      <span className="shrink-0 font-medium">{brief?.tenantName ?? "…"}</span>
      <ChevronRight className="size-3 shrink-0 text-faint" />
      <span className="truncate font-mono text-[11px] text-muted">{brief?.verifiedDomain ?? ""}</span>
      <ChevronRight className="size-3 shrink-0 text-faint" />
      <span className={`shrink-0 font-mono text-[11.5px] ${resolved ? "text-healthy" : "text-text"}`}>{brief?.displayId ?? `#${scenarioId}`}</span>
      <span className="shrink-0 text-faint">
        · {totalCards} {totalCards === 1 ? "card" : "cards"}
        {customCards > 0 ? <span className="text-selection"> ({cards} + {customCards} custom)</span> : ""}
        {status === "loading" ? " · correlating…" : ""}
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {recipe && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 text-[10.5px] text-primary" title={recipe.description}>
            <Pin className="size-3" />
            {recipe.name} · Pinned
          </span>
        )}
        <RowFilterPill />
        {filter && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-meta/40 bg-meta/12 pr-0.5 pl-1.5 font-mono text-[10.5px] text-meta">
            voice filter: {filter.join(", ")}
            <button type="button" onClick={() => setFilter(null)} aria-label="Clear voice filter" className="grid size-4 place-items-center rounded hover:bg-meta/25">
              <X className="size-3" />
            </button>
          </span>
        )}
        {brief && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-faint" title={Object.entries(brief.sources).map(([k, v]) => `${k}: ${v}`).join("\n")}>
            <Database className="size-3" />
            {live}/{total} live
          </span>
        )}
      </div>
    </div>
  );
}

function Component({ component }: { component: LayoutComponent }) {
  switch (component.type) {
    case "LicenseDriftCard":
      return <LicenseDriftCardView props={component.props} triggeredBy={component.triggeredBy} />;
    case "EntraSignInTimeline":
      return <EntraSignInTimelineCard props={component.props} triggeredBy={component.triggeredBy} />;
    case "IntuneDriftCard":
      return <IntuneDriftCardView props={component.props} triggeredBy={component.triggeredBy} />;
    case "IaCDriftBanner":
      return <IaCDriftBannerCard props={component.props} triggeredBy={component.triggeredBy} />;
    case "SynthesizedDynamicCard":
      return <SynthesizedDynamicCard props={component.props} triggeredBy={component.triggeredBy} />;
    default:
      return null;
  }
}
