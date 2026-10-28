import { Activity, Building2, Compass, FilePlus2, Mic, Monitor, Moon, Pin, PinOff, RotateCcw, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { WorkQueue } from "./WorkQueue";

const THEME_LABEL: Record<ThemePreference, string> = { dark: "Dark", light: "Light", system: "System" };
const THEME_NEXT: Record<ThemePreference, ThemePreference> = { dark: "light", light: "system", system: "dark" };

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
  const theme = useTheme();
  const connection: { word: string; tone: Tone; title: string } = !wsConnected
    ? { word: "offline", tone: "critical", title: "Orchestrator websocket disconnected" }
    : live
      ? { word: "live", tone: "healthy", title: "Connected · live cloud mode (Microsoft Graph & Azure ARM)" }
      : { word: "sim", tone: "primary", title: "Connected · simulated lab providers" };

  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2.5 border-b border-hairline bg-surface px-3">
      <button
        type="button"
        onClick={() => openFreeRoam()}
        title="Return to Free-Roam Startpage (Knowledge & Tenant Explorer)"
        className="flex shrink-0 items-center gap-2 pr-1 text-left transition-opacity hover:opacity-85"
      >
        <span className="grid size-6 place-items-center rounded-md bg-signal/15 text-signal">
          <Building2 className="size-3.5" />
        </span>
        <span className="text-13 font-semibold tracking-tight">ContextPane</span>
      </button>

      <div className="flex min-w-0 shrink items-center gap-1.5">
        <Button
          variant={freeRoamOpen ? "primary" : "outline"}
          icon={<Compass />}
          onClick={() => openFreeRoam()}
          title="Open Free-Roam Startpage — open any lens without a ticket"
          data-testid="topbar-freeroam-button"
        >
          Free-Roam Startpage
        </Button>
        <WorkQueue />
        <span className="shrink-0 font-mono text-11 text-faint" title="Open work items in the queue" data-testid="queue-open-count">
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
          variant="ghost"
          icon={theme.preference === "light" ? <Sun /> : theme.preference === "system" ? <Monitor /> : <Moon />}
          onClick={() => theme.cycleTheme()}
          aria-label="Toggle theme"
          title={`Theme: ${THEME_LABEL[theme.preference]}${theme.preference === "system" ? ` (${THEME_LABEL[theme.resolved]})` : ""}. Click for ${THEME_LABEL[THEME_NEXT[theme.preference]]}.`}
          data-testid="topbar-theme-toggle"
        />
        <div className="ml-1 flex items-center gap-2 border-l border-hairline pl-2.5 font-mono text-11 text-muted" data-testid="topbar-status-cluster">
          <button
            type="button"
            disabled={togglingDataMode}
            onClick={() => void setDataMode(dataMode === "real-tenant" ? "simulated-lab" : "real-tenant")}
            title={
              dataMode === "real-tenant"
                ? "Data mode: real tenant only (MCP queries live Microsoft Graph & Azure ARM, no simulated fallback). Click for the simulated lab."
                : "Data mode: simulated lab (MCP includes seeded Contoso/Fabrikam fixtures). Click for real tenant only."
            }
            aria-label={`Data mode: ${dataMode === "real-tenant" ? "real tenant only" : "lab"}. Toggle.`}
            data-testid="topbar-datamode-toggle"
            className="inline-flex h-6 items-center rounded px-1 font-sans whitespace-nowrap transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60"
          >
            <span data-testid="freeroam-datamode-toggle" data-mode={dataMode}>
              <span className={dataMode === "real-tenant" ? "text-healthy" : "text-faint"}>Real tenant only</span>
              <span aria-hidden className="text-faint"> / </span>
              <span className={dataMode === "real-tenant" ? "text-faint" : "text-text"}>Lab</span>
            </span>
          </button>
          <Pill variant="status" tone={connection.tone} title={connection.title}>
            <span data-testid="topbar-connection-status">{connection.word}</span>
          </Pill>
          <Button
            variant={systemOpen ? "primary" : "ghost"}
            icon={<Activity />}
            onClick={() => setSystemOpen(!systemOpen)}
            title="Router savings, audit log and live provider status (t)"
          >
            System &amp; Audit
          </Button>
        </div>
      </div>
    </header>
  );
}
