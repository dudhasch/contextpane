import { Activity, Building2, FilePlus2, Mic, Pin, PinOff, RotateCcw } from "lucide-react";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { WorkQueue } from "./WorkQueue";

/** Operational top bar: the unified work queue, recipe, voice, drift reset; everything meta lives behind System & Audit. */
export function TopBar() {
  const activeRecipeId = useWorkbench((s) => s.activeRecipeId);
  const pinRecipe = useWorkbench((s) => s.pinRecipe);
  const unpinRecipe = useWorkbench((s) => s.unpinRecipe);
  const canvasStatus = useWorkbench((s) => s.canvasStatus);
  const voiceOpen = useWorkbench((s) => s.voiceOpen);
  const setVoiceOpen = useWorkbench((s) => s.setVoiceOpen);
  const setComposerOpen = useWorkbench((s) => s.setComposerOpen);
  const systemOpen = useWorkbench((s) => s.systemOpen);
  const setSystemOpen = useWorkbench((s) => s.setSystemOpen);
  const resetDrift = useWorkbench((s) => s.resetDrift);
  const resetting = useWorkbench((s) => s.resetting);
  const wsConnected = useWorkbench((s) => s.wsConnected);
  const live = useWorkbench((s) => s.health?.liveCloudMode);
  const openCount = useWorkbench((s) => s.scenarios.filter((x) => !x.resolved && !s.convergence[x.scenarioId]).length);

  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
          <Building2 className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">ContextPane</span>
      </div>

      <div className="flex min-w-0 shrink items-center gap-2">
        <WorkQueue />
        <span className="shrink-0 font-mono text-[10.5px] text-faint" title="Open work items in the queue" data-testid="queue-open-count">
          {openCount} open
        </span>
        <Button
          variant="outline"
          icon={<FilePlus2 />}
          onClick={() => setComposerOpen(true)}
          title="Paste any unscripted support ticket or outline a cloud engineering project/goal (n)"
          data-testid="topbar-new-ticket-button"
        >
          + New Ticket / Outline Project Goal
        </Button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {activeRecipeId ? (
          <Button variant="primary" icon={<PinOff />} onClick={unpinRecipe} title="Release the pinned recipe (p)">
            Recipe Pinned
          </Button>
        ) : (
          <Button variant="outline" icon={<Pin />} onClick={() => void pinRecipe()} disabled={canvasStatus !== "ready"} title="Pin the canvas as a View Recipe: later scenario switches hydrate with 0 LLM tokens (p)">
            Pin Recipe
          </Button>
        )}
        <Button variant={voiceOpen ? "meta" : "outline"} icon={<Mic />} onClick={() => setVoiceOpen(!voiceOpen)} title="Voice Steer (v)">
          Voice Steer
        </Button>
        <Button variant="outline" icon={<RotateCcw />} onClick={() => void resetDrift()} loading={resetting} title="Restore the drifted lab state of every scenario for the next demo take (0)">
          Reset Drift
        </Button>
        <Button
          variant={systemOpen ? "primary" : "ghost"}
          icon={<Activity />}
          onClick={() => setSystemOpen(!systemOpen)}
          title="Router savings, audit log and live provider status (t)"
          className="relative"
        >
          System &amp; Audit
          <span className={`absolute top-1 right-1 size-1.5 rounded-full ${wsConnected ? (live ? "bg-healthy" : "bg-primary") : "bg-critical"}`} aria-hidden />
        </Button>
      </div>
    </header>
  );
}
