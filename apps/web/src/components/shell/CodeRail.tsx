import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { ProgressEvent } from "@/lib/api";
import { useWorkbench, type CodeRailMode, type CodeRailTab } from "@/store";
import { ApproveFooter } from "./rail/ApproveFooter";
import { DiffReview } from "./rail/DiffReview";
import { LiveConsole } from "./rail/LiveConsole";
import { NoteAndDocs } from "./rail/NoteAndDocs";
import { ProverStrip } from "./rail/ProverStrip";
import { ScriptsTab } from "./rail/ScriptsTab";
import { StreamingScript } from "./rail/StreamingScript";
import { TraceTicker } from "./rail/TraceTicker";
import { useHasIntune } from "./rail/shared";

/** Grid widths of the code rail column; App.tsx animates between them. */
export const CODE_RAIL_OPEN_PX = 440;
export const CODE_RAIL_COLLAPSED_PX = 36;

const TABS: Array<{ id: CodeRailTab; label: string }> = [
  { id: "powershell", label: "PowerShell 7" },
  { id: "opentofu", label: "OpenTofu" },
  { id: "graph", label: "Graph" },
];
const DEVICE_HEALTH_TAB: { id: CodeRailTab; label: string } = { id: "devicehealth", label: "Device health" };

/**
 * Right zone of the flight deck: permanent, non-modal "Muse Code" rail. The remediation drawer, the
 * diff modal and the live console are its modes (`codeRailMode`): header tabs, prover strip, view bar,
 * one scroll body, the approve footer, and a 2-line trace ticker at the bottom.
 */
export function CodeRail({ forceIdle = false }: { forceIdle?: boolean }) {
  const open = useWorkbench((s) => s.codeRailOpen);
  const storeMode = useWorkbench((s) => s.codeRailMode);
  const tab = useWorkbench((s) => s.codeRailTab);
  const toggle = useWorkbench((s) => s.toggleCodeRail);
  const setTab = useWorkbench((s) => s.setCodeRailTab);
  const drawer = useWorkbench((s) => s.drawer);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const remediateProgress = useWorkbench((s) => s.remediateProgress);
  const liveConsoleOpen = useWorkbench((s) => s.liveConsoleOpen);
  const liveConsoleStreaming = useWorkbench((s) => s.liveConsoleStreaming);
  const liveConsoleStep = useWorkbench((s) => s.liveConsoleStep);
  const liveConsoleLines = useWorkbench((s) => s.liveConsoleLines);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const refineProgress = useWorkbench((s) => s.refineProgress);
  const railStream = useWorkbench((s) => s.railStream);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const resolved = useWorkbench((s) => Boolean(s.convergence[s.scenarioId]));
  const hasIntune = useHasIntune();
  // Free-Roam keeps the rail quiet unless it staged its own action (FREE-… bundle or one in flight);
  // a ticket's auto-staged bundle still streaming in the background stays out of it.
  const freeRoamStaged = Boolean(drawer?.ticketId.startsWith("FREE-")) || (remediateStatus === "loading" && Boolean(railStream?.freeRoam));
  const mode: CodeRailMode = forceIdle && !freeRoamStaged ? "idle" : storeMode;
  const tabs = hasIntune ? [...TABS, DEVICE_HEALTH_TAB] : TABS;
  const activeTab: CodeRailTab = tab === "devicehealth" && !hasIntune ? "powershell" : tab;
  const showFooter = mode !== "idle" && (drawer !== null || remediateStatus !== "idle" || mode === "console");
  // WP6: anything the rail is waiting on (fix generation, a scope refine, an approve / revert run).
  const streaming = remediateStatus === "loading" || refiningGoal || liveConsoleStreaming;
  // The arriving script replaces the staged one while it is stale, and previews in the idle rail.
  const showStream = railStream !== null && (mode === "idle" || mode === "staging") && (!drawer || refiningGoal || remediateStatus === "loading");

  const goScripts = () => useWorkbench.setState({ codeRailMode: "staging", liveConsoleOpen: false });
  const selectTab = (t: CodeRailTab) => {
    setTab(t);
    if (drawer && mode !== "staging") goScripts();
  };

  // What the ticker shows: fix generation streams real events; approve / revert report one step line.
  const trace = useMemo((): { key: string; label: string; events: ProgressEvent[]; busy: boolean } => {
    if (remediateStatus === "loading") return { key: "remediate", label: "remediate", events: remediateProgress, busy: true };
    if (refiningGoal) return { key: "refine", label: "refine", events: refineProgress, busy: true };
    if (liveConsoleStreaming) {
      const stage = /revert|rollback/i.test(liveConsoleStep ?? "") ? "rollback" : "approve";
      const last = liveConsoleLines.at(-1);
      const events: ProgressEvent[] = [
        ...(last ? [{ stage: "log", message: last, at: "", elapsedMs: 0 }] : []),
        { stage, message: liveConsoleStep ?? "", at: "", elapsedMs: 0 },
      ];
      return { key: `console-${stage}`, label: stage, events, busy: true };
    }
    return { key: "idle", label: "idle", events: [], busy: false };
  }, [remediateStatus, remediateProgress, refiningGoal, refineProgress, liveConsoleStreaming, liveConsoleStep, liveConsoleLines]);

  let body: ReactNode;
  if (showStream) {
    body = <StreamingScript stream={railStream} ticketId={drawer?.ticketId ?? scenarioId} busy={refiningGoal || remediateStatus === "loading"} />;
  } else if (mode === "idle") {
    body = (
      <div className="px-3 py-3 text-12 text-muted">
        {forceIdle ? (
          <>
            <p>Open a lens to stage an action.</p>
            <p>The staged script for the newest lens lands here.</p>
          </>
        ) : resolved ? (
          <p data-testid="rail-resolved-idle">Resolved · reopen to stage again</p>
        ) : (
          <>
            <p>No remediation staged.</p>
            <p>Scripts stream here when you steer the plan.</p>
          </>
        )}
      </div>
    );
  } else if (mode === "review") {
    body = <DiffReview />;
  } else if (mode === "console") {
    body = <LiveConsole />;
  } else if (!drawer) {
    body = (
      <div className="px-3 py-3 text-12">
        {remediateStatus === "error" ? (
          <p className="text-critical">Failed to prepare the fix. Check the orchestrator log.</p>
        ) : remediateStatus === "loading" ? (
          <p className="text-muted">Preparing fix scripts and running the pre-flight safety checks…</p>
        ) : (
          <p className="text-muted">No remediation staged.</p>
        )}
      </div>
    );
  } else if (mode === "note") {
    body = <NoteAndDocs drawer={drawer} />;
  } else {
    body = <ScriptsTab drawer={drawer} />;
  }

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
            <span className="shrink-0 text-12 font-medium whitespace-nowrap text-text">
              <span aria-hidden className="mr-1 text-signal">
                ✦
              </span>
              Muse Code
            </span>
            <div role="tablist" aria-label="Script" className="flex h-full min-w-0 items-stretch gap-2.5 overflow-hidden">
              {tabs.map((t) => {
                const active = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`code-rail-tab-${t.id}`}
                    onClick={() => selectTab(t.id)}
                    className={`relative inline-flex shrink-0 items-center font-mono text-11 whitespace-nowrap transition-colors duration-120 ${
                      active ? "text-text" : "text-muted hover:text-text"
                    }`}
                  >
                    {t.label}
                    {active && <span aria-hidden className={`absolute inset-x-0 bottom-0 h-0.5 ${mode === "staging" || mode === "idle" ? "bg-signal" : "bg-hairline"}`} />}
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

          {drawer && mode !== "idle" && <ProverStrip drawer={drawer} />}

          {drawer && mode !== "idle" && mode !== "review" && (
            <div className="mt-1 flex h-8 shrink-0 items-center gap-4 border-b border-hairline px-3" role="tablist" aria-label="Rail view">
              <ViewToggle active={mode === "staging"} onClick={goScripts} data-testid="code-rail-open-scripts">
                Scripts
              </ViewToggle>
              {(liveConsoleOpen || liveConsoleLines.length > 0) && (
                <ViewToggle active={mode === "console"} onClick={() => useWorkbench.setState({ codeRailMode: "console", liveConsoleOpen: true })} data-testid="live-console-tab">
                  Console
                </ViewToggle>
              )}
              <ViewToggle active={mode === "note"} onClick={() => useWorkbench.setState({ codeRailMode: "note", liveConsoleOpen: false })} data-testid="runbook-tab">
                Note &amp; docs
              </ViewToggle>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col" data-testid="code-rail-body">
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" data-testid="drawer-scroll-viewport">
              {body}
            </div>
          </div>

          {showFooter && <ApproveFooter />}

          <div className="flex min-h-7 shrink-0 items-center border-t border-hairline px-3 py-1" data-testid="code-rail-footer">
            <TraceTicker key={trace.key} events={trace.events} busy={trace.busy} label={trace.label} />
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
          <div className="flex flex-col items-center gap-1.5" aria-label="Script status" data-streaming={streaming || undefined}>
            {TABS.map((t, i) => (
              <span
                key={t.id}
                title={`${t.label}: ${streaming ? "streaming" : mode}`}
                style={streaming ? { animationDelay: `${i * 160}ms` } : undefined}
                className={`size-1.5 rounded-full transition-colors duration-150 ease-[var(--ease-ops)] ${streaming ? "bg-signal motion-safe:animate-pulse-dot" : mode === "idle" ? "bg-faint" : "bg-signal"}`}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function ViewToggle({ active, onClick, children, ...rest }: { active: boolean; onClick: () => void; children: ReactNode; "data-testid": string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      {...rest}
      className={`relative inline-flex h-full items-center text-11 whitespace-nowrap transition-colors duration-120 ${active ? "text-text" : "text-muted hover:text-text"}`}
    >
      {children}
      {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
    </button>
  );
}
