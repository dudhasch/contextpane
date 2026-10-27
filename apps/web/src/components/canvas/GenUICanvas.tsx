import { ChevronRight, Database, LayoutGrid, Pin, Undo2, X } from "lucide-react";
import type { LayoutComponent } from "@contextpane/catalog";
import { selectCanvasLayout, selectConvergence, useWorkbench, visibleComponents } from "@/store";
import { EntraSignInTimelineCard } from "./EntraSignInTimeline";
import { IaCDriftBannerCard } from "./IaCDriftBanner";
import { IntuneDriftCardView } from "./IntuneDriftCard";
import { ContextualMiniDashboardCard } from "./ContextualMiniDashboard";
import { LicenseDriftCardView } from "./LicenseDriftCard";
import { ProgressRail } from "./ProgressRail";
import { RowFilterPill } from "./TableFilter";

/**
 * Right pane. Mounts only catalog components the orchestrator returned and Zod
 * validated — there is no generic text/markdown renderer by design. Cards start
 * compact; the left pane expands and focuses them.
 */
export function GenUICanvas() {
  const layout = useWorkbench(selectCanvasLayout);
  const status = useWorkbench((s) => s.canvasStatus);
  const error = useWorkbench((s) => s.canvasError);
  const progress = useWorkbench((s) => s.progress);
  const filter = useWorkbench((s) => s.filter);
  const miniDashboards = useWorkbench((s) => s.miniDashboards);
  const exploreStatus = useWorkbench((s) => s.exploreStatus);
  const components = visibleComponents(layout, filter);

  return (
    <div className="flex h-full flex-col">
      <TenantBreadcrumb cards={components.length} customCards={miniDashboards.length} />
      <TimeTravelScrubber />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {exploreStatus === "loading" && (
          <div className="card flex items-center gap-2 border-l-4 border-l-selection text-[12px] text-muted" data-testid="mini-dashboard-loading">
            <span className="size-3 animate-spin rounded-full border-2 border-selection border-t-transparent" />
            Generating Context UI from the live tenant slice…
          </div>
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

function formatTimelineStepLabel(s: { kind?: string; relativeLabel: string; timestamp: string; label: string }): string {
  const hhmm = s.timestamp.slice(11, 16);
  if (s.kind === "baseline" || s.relativeLabel === "T-18m") return `Before Issue (${hhmm})`;
  if (s.kind === "drift" || s.relativeLabel === "T-14m") return `Config Changed (${hhmm})`;
  if (s.kind === "first-failure" || s.relativeLabel === "T-06m") return `First Error (${hhmm})`;
  if (s.kind === "now" || s.relativeLabel === "NOW") return "Now (Active)";
  if (s.kind === "counterfactual" || s.relativeLabel === "T+Fix") return "After Fix (Preview)";
  return s.label;
}

function formatTimelineStepDescription(s: { kind?: string; relativeLabel: string; state: { summary: string } }, scenarioId: string): string {
  const isAvd = scenarioId === "INC-4092";
  if (s.kind === "baseline" || s.relativeLabel === "T-18m") return isAvd ? "All 5 users working normally" : "All systems healthy before change";
  if (s.kind === "drift" || s.relativeLabel === "T-14m") return isAvd ? "Port 3389 opened & 3 users on E3 license" : "Configuration changed from baseline";
  if (s.kind === "first-failure" || s.relativeLabel === "T-06m") return isAvd ? "First user blocked (AADSTS53003)" : "First user or device error reported";
  if (s.kind === "now" || s.relativeLabel === "NOW") return isAvd ? "3 users blocked · Port 3389 exposed" : "Active issue needs attention";
  if (s.kind === "counterfactual" || s.relativeLabel === "T+Fix") return isAvd ? "Preview: All 3 issues resolved" : "Preview: All issues resolved";
  return s.state.summary;
}

/** Clean, self-explanatory Incident Timeline bar. */
function TimeTravelScrubber() {
  const timeline = useWorkbench((s) => s.timeline);
  const sliceId = useWorkbench((s) => s.timelineSliceId);
  const scenarioId = useWorkbench((s) => s.scenarioId);
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
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface/30 px-3" data-testid="timeline-scrubber">
      <span className="shrink-0 text-[10.5px] font-medium whitespace-nowrap text-muted">🕒 Incident Timeline:</span>
      <div className="flex shrink-0 items-center gap-0.5">
        {timeline.slices.map((s, idx) => {
          const isSelected = s.id === sliceId;
          const label = formatTimelineStepLabel(s);
          return (
            <div key={s.id} className="flex items-center gap-0.5">
              {idx > 0 && <span className="text-[9.5px] text-faint">→</span>}
              <button
                type="button"
                onClick={() => select(s.id)}
                title={s.state.summary}
                className={`h-5 shrink-0 rounded border px-1.5 text-[10.5px] whitespace-nowrap transition-colors ${
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
      {active && !convergence && (
        <span className="ml-auto truncate pl-1.5 text-[10.5px] text-muted">{formatTimelineStepDescription(active, scenarioId)}</span>
      )}
      {convergence && (
        <button
          type="button"
          onClick={() => void rollbackNow()}
          className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded border border-healthy/40 bg-healthy/12 px-1.5 text-[10.5px] font-medium whitespace-nowrap text-healthy hover:bg-healthy/20"
          data-testid="rollback-button"
        >
          <Undo2 className="size-3" /> Undo Change (Restore Previous State)
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
            {recipe.name} · 0 tokens
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
    default:
      return null;
  }
}
