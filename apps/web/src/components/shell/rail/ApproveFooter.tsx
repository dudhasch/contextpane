import { Check, FlaskConical, GitPullRequest, Play, RotateCcw, Undo2, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { humanizeStatus } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../../ui/Button";
import { OtherTenantsPopover } from "./OtherTenantsPopover";
import { isReadOnlyBundle, usePreflight, useRevertLabel } from "./shared";

/* One 32px action row under a 20px control row: the footer stays at 70px. */
const ACTION = "!h-8 !text-12";

/**
 * Permanent approve footer of the code rail: other-tenant trigger and the canary drill on top, then
 * exactly one action row: approve (PR / apply now / rollback drill), console revert / confirm while the
 * console awaits sign-off, a quiet resolved line once it is signed off, or re-apply after a rollback.
 */
export function ApproveFooter() {
  const drawer = useWorkbench((s) => s.drawer);
  const status = useWorkbench((s) => s.remediateStatus);
  const remediate = useWorkbench((s) => s.remediate);
  const approve = useWorkbench((s) => s.approve);
  const mode = useWorkbench((s) => s.executionMode);
  const simulate = useWorkbench((s) => s.simulateCanaryFailure);
  const liveConsoleOpen = useWorkbench((s) => s.liveConsoleOpen);
  const streaming = useWorkbench((s) => s.liveConsoleStreaming);
  const reverted = useWorkbench((s) => s.liveConsoleReverted);
  const confirmAndCloseConsole = useWorkbench((s) => s.confirmAndCloseConsole);
  const revertFromConsole = useWorkbench((s) => s.revertFromConsole);
  const resolved = useWorkbench((s) => Boolean(s.drawer && s.convergence[s.drawer.ticketId]));
  const closed = useWorkbench((s) => Boolean(s.drawer && s.resolutionNote?.closed && s.resolutionNote.scenarioId === s.drawer.ticketId));
  const preflight = usePreflight();
  const revert = useRevertLabel();
  // WP6: while a refine or a fix generation streams, the drawer on screen is about to be replaced.
  const regenerating = useWorkbench((s) => s.refiningGoal) || status === "loading";

  let actions: ReactNode;
  if (drawer?.approval.state === "rolled-back" || reverted) {
    actions = (
      <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="post-rollback-actions">
        <Button
          variant="healthy"
          size="md"
          className={`flex-1 ${ACTION}`}
          icon={<Zap />}
          disabled={!drawer}
          onClick={() => {
            useWorkbench.setState({ simulateCanaryFailure: false, liveConsoleReverted: false });
            void approve("approve");
          }}
          data-testid="reapply-fix-button"
        >
          Re-apply fix now
        </Button>
        <Button variant="outline" size="md" className={ACTION} onClick={() => confirmAndCloseConsole()}>
          Done
        </Button>
      </div>
    );
  } else if (liveConsoleOpen) {
    actions = (
      <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="live-console-actions">
        <Button variant="danger" size="md" icon={<Undo2 />} disabled={streaming} onClick={() => void revertFromConsole()} data-testid="console-revert-button" className={ACTION} title={revert.title}>
          {revert.label}
        </Button>
        <Button variant="healthy" size="md" icon={<Check />} disabled={streaming} onClick={() => confirmAndCloseConsole()} data-testid="console-confirm-ok-button" className={`flex-1 ${ACTION}`}>
          Confirm and close
        </Button>
      </div>
    );
  } else if (!drawer) {
    actions = (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="outline" size="md" className={`flex-1 ${ACTION}`} disabled>
          {status === "error" ? "Fix generation failed" : "Preparing fix…"}
        </Button>
        {status === "error" && (
          <Button variant="outline" size="md" icon={<RotateCcw />} className={ACTION} onClick={() => void remediate()}>
            Retry
          </Button>
        )}
      </div>
    );
  } else if (drawer.approval.state === "pending" && resolved) {
    actions = (
      <Button variant="outline" size="md" icon={<Check />} className={`flex-1 ${ACTION}`} disabled title="Reopen the ticket or reset drift to run this fix again">
        {closed ? "Already resolved and closed" : "Already resolved and verified"}
      </Button>
    );
  } else if (drawer.approval.state === "pending") {
    // A read-only bundle (a Free-Roam inventory query) runs a query live; it fixes nothing.
    const liveQuery = mode === "break-glass" && !simulate && isReadOnlyBundle(drawer);
    actions = (
      <Button
        variant={simulate ? "primary" : "healthy"}
        size="md"
        className={`flex-1 ${ACTION} ${simulate ? "!bg-warning !text-ground hover:!bg-warning/90" : ""}`}
        disabled={preflight.blocked || regenerating}
        title={regenerating ? "The fix is being regenerated for the new scope" : preflight.blocked ? "Fix or override the pre-flight first" : undefined}
        onClick={() => void approve("approve")}
        icon={simulate ? <FlaskConical /> : liveQuery ? <Play /> : mode === "break-glass" ? <Zap /> : <GitPullRequest />}
        data-testid="approve-primary"
        data-read-only={liveQuery || undefined}
      >
        {simulate ? "Run rollback drill" : liveQuery ? "Run live query" : mode === "break-glass" ? "Apply fix now" : "Create pull request"}
      </Button>
    );
  } else {
    // Signed off (or moved on to the note): a quiet resolved line; the revert stays one click away.
    const state = drawer.approval.state;
    const summary = resolved ? (closed ? "Resolved · closed in PSA · undo ready" : "Resolved · undo ready") : state === "staged" ? "Staged for the pipeline" : `Approval ${humanizeStatus(state).toLowerCase()}`;
    actions = (
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2" data-testid="approve-footer-resolved">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-12 text-muted">
          <Check className={`size-3.5 shrink-0 ${resolved ? "text-healthy" : "text-faint"}`} aria-hidden />
          {summary}
        </span>
        <Button variant="ghost" size="sm" icon={<Undo2 />} onClick={() => void revertFromConsole()} title={revert.title}>
          {revert.label}
        </Button>
      </div>
    );
  }

  return (
    <footer className="shrink-0 border-t border-hairline bg-surface px-3 py-1.5" data-testid="path-b">
      <div className="flex h-5 min-w-0 items-center gap-3">
        <OtherTenantsPopover />
        <div className="ml-auto flex shrink-0 items-center" data-testid="canary-controls">
          <CanaryCheckbox />
        </div>
      </div>
      <div className="mt-1.5 flex min-w-0 items-center">{actions}</div>
    </footer>
  );
}

function CanaryCheckbox() {
  const simulate = useWorkbench((s) => s.simulateCanaryFailure);
  const setSimulate = useWorkbench((s) => s.setSimulateCanaryFailure);
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 text-11 whitespace-nowrap transition-colors duration-120 ${simulate ? "font-medium text-warning" : "text-muted hover:text-text"}`}
      title="Simulate a post-change health check failure to verify automatic 1-Click Undo rollback"
    >
      <input type="checkbox" className="size-3 accent-[var(--warning)]" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
      {simulate ? "Auto-rollback drill on" : "Test auto-rollback"}
    </label>
  );
}
