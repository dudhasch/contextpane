import { Activity, Building2, Compass, Database, FilePlus2, Mic, Pin, PinOff, RotateCcw } from "lucide-react";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { WorkQueue } from "./WorkQueue";

/** Operational top bar: the unified work queue, Free-Roam startpage, MCP Data Mode toggle, recipe, voice, drift reset; everything meta lives behind System & Audit. */
export function TopBar() {
  const freeRoamOpen = useWorkbench((s) => s.freeRoamOpen);
  const openFreeRoam = useWorkbench((s) => s.openFreeRoam);
  const dataMode = useWorkbench((s) => s.dataMode);
  const togglingDataMode = useWorkbench((s) => s.togglingDataMode);
  const setDataMode = useWorkbench((s) => s.setDataMode);
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
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3">
      <button
        type="button"
        onClick={() => openFreeRoam()}
        title="Return to Free-Roam Startpage (Knowledge & Tenant Explorer)"
        className="flex shrink-0 items-center gap-2 pr-1 text-left transition-opacity hover:opacity-85"
      >
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
          <Building2 className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">ContextPane</span>
      </button>

      <div className="flex min-w-0 shrink items-center gap-1.5">
        <Button
          variant={freeRoamOpen ? "primary" : "outline"}
          icon={<Compass />}
          onClick={() => openFreeRoam()}
          title="Open Free-Roam Startpage — dynamically spawn any dashboard without a ticket"
          data-testid="topbar-freeroam-button"
        >
          Free-Roam Startpage
        </Button>
        <WorkQueue />
        <span className="shrink-0 font-mono text-[11px] text-faint" title="Open work items in the queue" data-testid="queue-open-count">
          {openCount} open
        </span>
        <Button
          variant="outline"
          icon={<FilePlus2 />}
          onClick={() => setComposerOpen(true)}
          title="Paste any unscripted support ticket or outline a cloud engineering project/goal (n)"
          data-testid="topbar-new-ticket-button"
        >
          New Ticket / Outline Project Goal
        </Button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={togglingDataMode}
          onClick={() => void setDataMode(dataMode === "real-tenant" ? "simulated-lab" : "real-tenant")}
          title={
            dataMode === "real-tenant"
              ? "Active: Strict Real Tenant Mode (MCP queries live Microsoft Graph & Azure ARM only, zero simulated fallback). Click to switch to Simulated Lab."
              : "Active: Simulated Lab Mode (MCP includes seeded Contoso/Fabrikam lab fixtures). Click to enforce Strict Real Tenant Mode."
          }
          data-testid="topbar-datamode-toggle"
          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] font-semibold transition-colors ${
            dataMode === "real-tenant"
              ? "border-healthy/50 bg-healthy/15 text-healthy hover:bg-healthy/25"
              : "border-border bg-elevated text-muted hover:border-primary/40 hover:text-text"
          }`}
        >
          <Database className="size-3.5" />
          <span>{dataMode === "real-tenant" ? "Real Tenant Only" : "Simulated Lab"}</span>
        </button>
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
