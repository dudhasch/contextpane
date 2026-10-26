import { ChevronRight, Database, LayoutGrid, Pin, X } from "lucide-react";
import type { LayoutComponent } from "@contextpane/catalog";
import { selectCanvasLayout, selectConvergence, useWorkbench, visibleComponents } from "@/store";
import { EntraSignInTimelineCard } from "./EntraSignInTimeline";
import { IaCDriftBannerCard } from "./IaCDriftBanner";
import { IntuneDriftCardView } from "./IntuneDriftCard";
import { LicenseDriftCardView } from "./LicenseDriftCard";
import { ProgressRail } from "./ProgressRail";

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
  const components = visibleComponents(layout, filter);

  return (
    <div className="flex h-full flex-col">
      <TenantBreadcrumb cards={components.length} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {status === "loading" && !layout && <ProgressRail events={progress} title="Correlating scenario" busy />}
        {status === "error" && <div className="card border-critical/40 text-sm text-critical">Canvas error: {error}</div>}
        {layout && components.map((c) => <Component key={c.id} component={c} />)}
        {layout && components.length === 0 && status === "ready" && <div className="card text-sm text-muted">No components match the current filter.</div>}
      </div>
    </div>
  );
}

/** One line instead of a tenant header card: tenant › domain › scenario, plus recipe and voice-filter chips. */
function TenantBreadcrumb({ cards }: { cards: number }) {
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
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[12px]" data-testid="tenant-breadcrumb">
      <LayoutGrid className="size-3.5 shrink-0 text-primary" />
      <span className="shrink-0 font-medium">{brief?.tenantName ?? "…"}</span>
      <ChevronRight className="size-3 shrink-0 text-faint" />
      <span className="truncate font-mono text-[11px] text-muted">{brief?.verifiedDomain ?? ""}</span>
      <ChevronRight className="size-3 shrink-0 text-faint" />
      <span className={`shrink-0 font-mono text-[11.5px] ${resolved ? "text-healthy" : "text-text"}`}>#{scenarioId}</span>
      <span className="shrink-0 text-faint">· {cards} {cards === 1 ? "card" : "cards"}{status === "loading" ? " · correlating…" : ""}</span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {recipe && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 text-[10.5px] text-primary" title={recipe.description}>
            <Pin className="size-3" />
            {recipe.name} · 0 tokens
          </span>
        )}
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
