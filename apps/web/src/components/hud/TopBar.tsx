import { Activity, Building2, ChevronDown, Mic, Pin, PinOff, Radar, RotateCcw, Ticket } from "lucide-react";
import { SCENARIO_REGISTRY, scenariosOfKind, type ScenarioId, type ScenarioKind } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";

/** Operational top bar: mode, scenario, recipe, voice, drift reset; everything meta lives behind System & Audit. */
export function TopBar() {
  const mode = useWorkbench((s) => s.mode);
  const setMode = useWorkbench((s) => s.setMode);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const selectScenario = useWorkbench((s) => s.selectScenario);
  const scenarios = useWorkbench((s) => s.scenarios);
  const activeRecipeId = useWorkbench((s) => s.activeRecipeId);
  const pinRecipe = useWorkbench((s) => s.pinRecipe);
  const unpinRecipe = useWorkbench((s) => s.unpinRecipe);
  const canvasStatus = useWorkbench((s) => s.canvasStatus);
  const voiceOpen = useWorkbench((s) => s.voiceOpen);
  const setVoiceOpen = useWorkbench((s) => s.setVoiceOpen);
  const systemOpen = useWorkbench((s) => s.systemOpen);
  const setSystemOpen = useWorkbench((s) => s.setSystemOpen);
  const resetDrift = useWorkbench((s) => s.resetDrift);
  const resetting = useWorkbench((s) => s.resetting);
  const wsConnected = useWorkbench((s) => s.wsConnected);
  const live = useWorkbench((s) => s.health?.liveCloudMode);

  const ids = scenariosOfKind(mode);
  const resolved = (id: ScenarioId) => scenarios.find((s) => s.scenarioId === id)?.resolved;
  const open = (kind: ScenarioKind) => (scenarios.length ? scenarios.filter((s) => s.kind === kind && !s.resolved).length : scenariosOfKind(kind).filter((id) => !resolved(id)).length);

  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
          <Building2 className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">ContextPane</span>
      </div>

      <div className="flex shrink-0 items-center rounded-md border border-border bg-canvas p-0.5" role="tablist" aria-label="Work mode">
        <ModeTab active={mode === "ticket"} onClick={() => void setMode("ticket")} icon={<Ticket />} label="Tickets" count={open("ticket")} />
        <ModeTab active={mode === "anomaly"} onClick={() => void setMode("anomaly")} icon={<Radar />} label="Tenant Anomalies" count={open("anomaly")} />
      </div>

      <label className="relative flex min-w-0 shrink items-center">
        <select
          value={scenarioId}
          onChange={(e) => void selectScenario(e.target.value as ScenarioId)}
          className="h-7 max-w-[420px] min-w-0 appearance-none truncate rounded-md border border-border bg-elevated pr-7 pl-2.5 text-[12px] text-text focus:outline-2 focus:outline-primary"
          aria-label="Scenario"
        >
          {ids.map((id) => (
            <option key={id} value={id}>
              #{id} · {SCENARIO_REGISTRY[id].title}
              {resolved(id) ? " · resolved" : ""}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" />
      </label>

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

function ModeTab({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors [&>svg]:size-3.5 ${active ? "bg-elevated text-text shadow-sm" : "text-muted hover:text-text"}`}
    >
      {icon}
      {label}
      <span className={`rounded-full px-1.5 font-mono text-[10.5px] ${active ? "bg-primary/20 text-primary" : "bg-surface text-faint"}`}>{count}</span>
    </button>
  );
}
