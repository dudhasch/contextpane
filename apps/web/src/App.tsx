import { useCallback, useEffect, useRef, useState } from "react";
import { GenUICanvas } from "./components/canvas/GenUICanvas";
import { HotkeysOverlay } from "./components/demo/HotkeysOverlay";
import { CODE_RAIL_COLLAPSED_PX, CODE_RAIL_OPEN_PX, CodeRail } from "./components/shell/CodeRail";
import { SystemAuditDrawer } from "./components/hud/SystemAuditDrawer";
import { TicketComposer } from "./components/hud/TicketComposer";
import { TopBar } from "./components/hud/TopBar";
import { VoiceSteerPanel } from "./components/hud/VoiceSteer";
import { FreeRoamExplorer } from "./components/landing/FreeRoamExplorer";
import { ScenarioPane } from "./components/ticket/ScenarioPane";
import { SelectionTrigger } from "./components/ticket/SelectionTrigger";
import { Toasts } from "./components/ui/Toasts";
import { useDemoHotkeys } from "./hooks/useDemoHotkeys";
import { useWorkbench } from "./store";

/** Context zone width in px (Q1 flight deck: Context 400 · Lens flex · Code rail 440). */
const DEFAULT_LEFT_PX = 400;
const MIN_LEFT_PX = 340;
const MAX_LEFT_PX = 520;

export function App() {
  const boot = useWorkbench((s) => s.boot);
  const freeRoamOpen = useWorkbench((s) => s.freeRoamOpen);
  const codeRailOpen = useWorkbench((s) => s.codeRailOpen);
  useDemoHotkeys();
  const [leftPx, setLeftPx] = useState<number>(DEFAULT_LEFT_PX);
  const [dragging, setDragging] = useState(false);
  const contextRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  const startResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const container = contextRef.current ?? document.body;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const raw = Math.round(ev.clientX - rect.left);
      setLeftPx(Math.min(MAX_LEFT_PX, Math.max(MIN_LEFT_PX, raw)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const railPx = codeRailOpen ? CODE_RAIL_OPEN_PX : CODE_RAIL_COLLAPSED_PX;

  return (
    <div className="relative flex h-full flex-col">
      <TopBar />
      {/* Flight deck: [context · hairline · lens] · hairline · code rail. The rail sits outside the
          selection surface so highlighting script text never opens a Context Lens. */}
      <div
        className="grid min-h-0 flex-1"
        data-testid="flight-deck"
        style={{
          gridTemplateColumns: `minmax(0, 1fr) 1px ${railPx}px`,
          transition: "grid-template-columns 140ms var(--ease-ops)",
        }}
      >
        <SelectionTrigger
          className="grid min-h-0 min-w-0"
          style={{ gridTemplateColumns: `${leftPx}px 1px minmax(0, 1fr)` }}
        >
          <section ref={contextRef} className="flex min-h-0 min-w-0 flex-col bg-surface" data-testid="zone-context">
            {freeRoamOpen ? <FreeRoamExplorer /> : <ScenarioPane />}
          </section>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize scenario and canvas panes"
            aria-valuenow={leftPx}
            aria-valuemin={MIN_LEFT_PX}
            aria-valuemax={MAX_LEFT_PX}
            data-testid="split-pane-resizer"
            title={`Drag to resize panes · Double-click to reset (${DEFAULT_LEFT_PX}px)`}
            onMouseDown={startResize}
            onDoubleClick={() => setLeftPx(DEFAULT_LEFT_PX)}
            className={`group relative z-10 cursor-col-resize transition-colors duration-120 ${
              dragging ? "bg-signal" : "bg-hairline hover:bg-signal/70"
            }`}
          >
            {/* 9px hit area centred on the 1px hairline. */}
            <div aria-hidden className="absolute inset-y-0 -left-1 -right-1" />
          </div>
          <section className="flex min-h-0 min-w-0 flex-col" data-testid="zone-lens">
            <GenUICanvas />
          </section>
        </SelectionTrigger>
        <div aria-hidden className="bg-hairline" />
        <CodeRail forceIdle={freeRoamOpen} />
      </div>
      <SystemAuditDrawer />
      <TicketComposer />
      <VoiceSteerPanel />
      <HotkeysOverlay />
      <Toasts />
    </div>
  );
}
