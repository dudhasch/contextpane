import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkbench, type CodeRailMode, type CodeRailTab } from "@/store";
import { Button } from "../ui/Button";

/** Grid widths of the code rail column; App.tsx animates between them. */
export const CODE_RAIL_OPEN_PX = 440;
export const CODE_RAIL_COLLAPSED_PX = 36;

const TABS: Array<{ id: CodeRailTab; label: string }> = [
  { id: "powershell", label: "PowerShell 7" },
  { id: "opentofu", label: "OpenTofu" },
  { id: "graph", label: "Graph" },
];

const MODE_LINE: Record<Exclude<CodeRailMode, "idle">, string> = {
  staging: "Remediation staged. Scripts, pre-flight and approval are in the drawer.",
  review: "Diff ready for review.",
  console: "Live console is running.",
  note: "Resolution note drafted.",
};

/**
 * Right zone of the flight deck: permanent, non-modal "Muse Code" rail. WP1 ships the container
 * (header, tabs, body states, footer, collapsed strip); WP4 moves the drawer content into it.
 */
export function CodeRail({ forceIdle = false }: { forceIdle?: boolean }) {
  const open = useWorkbench((s) => s.codeRailOpen);
  const storeMode = useWorkbench((s) => s.codeRailMode);
  const tab = useWorkbench((s) => s.codeRailTab);
  const toggle = useWorkbench((s) => s.toggleCodeRail);
  const setTab = useWorkbench((s) => s.setCodeRailTab);
  const setDrawerOpen = useWorkbench((s) => s.setDrawerOpen);
  const hasDrawer = useWorkbench((s) => s.drawer !== null);
  const mode: CodeRailMode = forceIdle ? "idle" : storeMode;

  return (
    <aside
      data-testid="code-rail"
      data-open={open}
      data-mode={mode}
      aria-label="Muse Code rail"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
    >
      {open ? (
        <>
          <div className="flex h-[34px] shrink-0 items-center gap-3 border-b border-hairline pr-1.5 pl-3">
            <span className="shrink-0 text-12 font-medium text-text">
              <span aria-hidden className="mr-1 text-signal">
                ✦
              </span>
              Muse Code
            </span>
            <div role="tablist" aria-label="Script" className="flex h-full min-w-0 items-stretch gap-3">
              {TABS.map((t) => {
                const active = t.id === tab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`code-rail-tab-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={`relative inline-flex items-center font-mono text-11 whitespace-nowrap transition-colors duration-120 ${
                      active ? "text-text" : "text-muted hover:text-text"
                    }`}
                  >
                    {t.label}
                    {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label="Collapse code rail"
              title="Collapse code rail (Ctrl+. / ⌘.)"
              data-testid="code-rail-toggle"
              className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-120 hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="code-rail-body">
            {mode === "idle" ? (
              <div className="text-12 text-muted">
                <p>No remediation staged.</p>
                <p>Scripts stream here when you steer the plan.</p>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <p className="text-12 text-muted">{MODE_LINE[mode]}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDrawerOpen(true)}
                  disabled={!hasDrawer}
                  title={hasDrawer ? "Open the remediation scripts" : "The fix is still being generated"}
                  data-testid="code-rail-open-scripts"
                >
                  Open scripts
                </Button>
              </div>
            )}
          </div>

          <div className="flex h-7 shrink-0 items-center border-t border-hairline px-3" data-testid="code-rail-footer">
            <span className="truncate font-mono text-11 text-muted">idle</span>
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center gap-3 py-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-label="Expand code rail"
            title="Expand code rail (Ctrl+. / ⌘.)"
            data-testid="code-rail-toggle"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-120 hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="text-11 whitespace-nowrap text-muted [writing-mode:vertical-rl]">Muse Code</span>
          <div className="flex flex-col items-center gap-1.5" aria-label="Script status">
            {TABS.map((t) => (
              <span key={t.id} title={`${t.label}: idle`} className="size-1.5 rounded-full bg-faint" />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
