import { useWorkbench } from "@/store";
import { ContextualMiniDashboardCard } from "../canvas/ContextualMiniDashboard";

/**
 * Mounted Free-Roam lenses, newest first. Rendered as direct children of the lens zone's hairline
 * list (`data-lens-list`), each a borderless ✦ section in the same 16px / 12px gutter as an incident.
 */
export function LensList() {
  const dashboards = useWorkbench((s) => s.freeRoamDashboards);
  const exploreStatus = useWorkbench((s) => s.exploreStatus);

  if (dashboards.length === 0) {
    if (exploreStatus === "loading") return null;
    return (
      <p className="px-4 py-3 text-12 text-faint" data-testid="free-roam-empty">
        No lens open. Pick an object in the tenant tree, a suggestion above, or type a question.
      </p>
    );
  }

  return (
    <>
      {dashboards.map((m) => (
        <div key={m.id} className="px-4 py-3">
          <ContextualMiniDashboardCard entry={m} />
        </div>
      ))}
    </>
  );
}
