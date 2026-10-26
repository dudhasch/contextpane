import { LayoutGrid, Pin, X } from "lucide-react";
import type { LayoutComponent } from "@contextpane/catalog";
import { selectCanvasLayout, useWorkbench, visibleComponents } from "@/store";
import { Pill } from "../ui/Pill";
import { EntraSignInTimelineCard } from "./EntraSignInTimeline";
import { IaCDriftBannerCard } from "./IaCDriftBanner";
import { LicenseDriftCardView } from "./LicenseDriftCard";
import { ProgressRail } from "./ProgressRail";
import { TenantSummaryHeaderCard } from "./TenantSummaryHeader";

/**
 * Right pane. Mounts only catalog components the orchestrator returned and Zod
 * validated — there is no generic text/markdown renderer by design.
 */
export function GenUICanvas() {
  const layout = useWorkbench(selectCanvasLayout);
  const status = useWorkbench((s) => s.canvasStatus);
  const error = useWorkbench((s) => s.canvasError);
  const progress = useWorkbench((s) => s.progress);
  const filter = useWorkbench((s) => s.filter);
  const setFilter = useWorkbench((s) => s.setFilter);
  const activeRecipeId = useWorkbench((s) => s.activeRecipeId);
  const recipes = useWorkbench((s) => s.recipes);
  const components = visibleComponents(layout, filter);
  const recipe = recipes.find((r) => r.recipeId === activeRecipeId);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-2">
      {status === "loading" && <ProgressRail events={progress} title={activeRecipeId ? `Hydrating recipe (Tier 0)` : "Correlating ticket (Tier 1B/2)"} busy />}
      {status === "error" && <div className="card border-critical/40 text-sm text-critical">Canvas error: {error}</div>}
      {(filter || recipe) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {recipe && layout && (
            <Pill tone="primary" icon={<Pin />} title={recipe.description}>
              {recipe.name} • {components.length} components pinned • {layout.provenance.tokensUsed} LLM tokens • {layout.provenance.latencyMs}ms
            </Pill>
          )}
          {filter && (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-meta/40 bg-meta/12 pr-1 pl-2 font-mono text-[11px] leading-none whitespace-nowrap text-meta">
              <LayoutGrid className="size-3 shrink-0" />
              <span className="truncate">voice filter: {filter.join(", ")}</span>
              <button
                type="button"
                onClick={() => setFilter(null)}
                aria-label="Clear voice filter"
                title="Clear voice filter"
                className="grid size-4 place-items-center rounded-full text-meta/80 hover:bg-meta/25 hover:text-text"
              >
                <X className="size-3" />
              </button>
            </span>
          )}
        </div>
      )}
      {layout && components.map((c) => <Component key={c.id} component={c} repaired={layout.provenance.repaired.includes(c.id)} />)}
      {layout && components.length === 0 && status === "ready" && <div className="card text-sm text-muted">No components match the current filter.</div>}
    </div>
  );
}

function Component({ component, repaired }: { component: LayoutComponent; repaired: boolean }) {
  const provenance = useWorkbench((s) => s.layout!.provenance);
  switch (component.type) {
    case "TenantSummaryHeader":
      return <TenantSummaryHeaderCard props={component.props} provenance={provenance} repaired={repaired} />;
    case "LicenseDriftCard":
      return <LicenseDriftCardView props={component.props} provenance={provenance} repaired={repaired} />;
    case "EntraSignInTimeline":
      return <EntraSignInTimelineCard props={component.props} provenance={provenance} repaired={repaired} />;
    case "IaCDriftBanner":
      return <IaCDriftBannerCard props={component.props} provenance={provenance} repaired={repaired} />;
    default:
      return null;
  }
}
