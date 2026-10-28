import { Check, FlaskConical, GitPullRequest, RotateCcw, Undo2, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useWorkbench } from "@/store";
import { Button } from "../../ui/Button";
import { OtherTenantsPopover } from "./OtherTenantsPopover";
import { usePreflight } from "./shared";

/* One 32px action row under a 20px control row: the footer stays at 70px. */
const ACTION = "!h-8 !text-12";

/**
 * Permanent approve footer of the code rail: other-tenant trigger and the canary drill on top, then
 * exactly one action row: approve (PR / apply now / rollback drill), console [REVERT] / [OK], or re-apply
 * after a rollback.
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
          Re-Apply Fix Now
        </Button>
        <Button variant="outline" size="md" className={ACTION} onClick={() => confirmAndCloseConsole()}>
          Done
        </Button>
      </div>
    );
  } else if (liveConsoleOpen) {
    actions = (
      <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="live-console-actions">
        <Button variant="danger" size="md" icon={<Undo2 />} disabled={streaming} onClick={() => void revertFromConsole()} data-testid="console-revert-button" className={ACTION}>
          Stage Revert Script
        </Button>
        <Button variant="healthy" size="md" icon={<Check />} disabled={streaming} onClick={() => confirmAndCloseConsole()} data-testid="console-confirm-ok-button" className={`flex-1 ${ACTION}`}>
          Confirm &amp; Close
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
        {closed ? "Already resolved & closed" : "Already resolved & verified"}
      </Button>
    );
  } else if (drawer.approval.state === "pending") {
    actions = (
      <Button
        variant={simulate ? "primary" : "healthy"}
        size="md"
        className={`flex-1 ${ACTION} ${simulate ? "!bg-warning !text-ground hover:!bg-warning/90" : ""}`}
        disabled={preflight.blocked}
        title={preflight.blocked ? "Fix or override the pre-flight first" : undefined}
        onClick={() => void approve("approve")}
        icon={simulate ? <FlaskConical /> : mode === "break-glass" ? <Zap /> : <GitPullRequest />}
      >
        {simulate ? "Run Rollback Simulation (Test Auto-Undo)" : mode === "break-glass" ? "Apply Fix Now" : "Create Pull Request"}
      </Button>
    );
  } else {
    actions = (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="danger" size="md" icon={<Undo2 />} onClick={() => void revertFromConsole()} data-testid="console-revert-button" className={ACTION}>
          Stage Revert Script
        </Button>
        <Button variant="healthy" size="md" icon={<Check />} onClick={() => confirmAndCloseConsole()} data-testid="console-confirm-ok-button" className={`flex-1 ${ACTION}`}>
          Confirm &amp; Close
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
