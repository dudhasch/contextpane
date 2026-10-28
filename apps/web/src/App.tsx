import { useCallback, useEffect, useRef, useState } from "react";
import { ActionApprovalDrawerSheet } from "./components/canvas/ActionApprovalDrawer";
import { DiffModal } from "./components/canvas/DiffModal";
import { GenUICanvas } from "./components/canvas/GenUICanvas";
import { HotkeysOverlay } from "./components/demo/HotkeysOverlay";
import { SystemAuditDrawer } from "./components/hud/SystemAuditDrawer";
import { TicketComposer } from "./components/hud/TicketComposer";
import { TopBar } from "./components/hud/TopBar";
import { VoiceSteerPanel } from "./components/hud/VoiceSteer";
import { ScenarioPane } from "./components/ticket/ScenarioPane";
import { SelectionTrigger } from "./components/ticket/SelectionTrigger";
import { Toasts } from "./components/ui/Toasts";
import { useDemoHotkeys } from "./hooks/useDemoHotkeys";
import { useWorkbench } from "./store";

const DEFAULT_LEFT_PCT = 40;
const MIN_LEFT_PCT = 28;
const MAX_LEFT_PCT = 58;

export function App() {
  const boot = useWorkbench((s) => s.boot);
  useDemoHotkeys();
  const [leftPct, setLeftPct] = useState<number>(DEFAULT_LEFT_PCT);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  const startResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const container = containerRef.current ?? document.body;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rawPct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(MAX_LEFT_PCT, Math.max(MIN_LEFT_PCT, Math.round(rawPct * 10) / 10));
      setLeftPct(clamped);
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

  return (
    <div ref={containerRef} className="relative flex h-full flex-col">
      <TopBar />
      <SelectionTrigger
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `minmax(380px, ${leftPct}%) 6px minmax(0, 1fr)`,
        }}
      >
        <section className="flex min-h-0 flex-col bg-surface/40">
          <ScenarioPane />
        </section>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize scenario and canvas panes"
          aria-valuenow={Math.round(leftPct)}
          aria-valuemin={MIN_LEFT_PCT}
          aria-valuemax={MAX_LEFT_PCT}
          data-testid="split-pane-resizer"
          title="Drag to resize panes · Double-click to reset (40/60)"
          onMouseDown={startResize}
          onDoubleClick={() => setLeftPct(DEFAULT_LEFT_PCT)}
          className={`group relative z-10 flex cursor-col-resize items-center justify-center transition-colors ${
            dragging ? "bg-accent/20" : "hover:bg-accent/10"
          }`}
        >
          <div
            className={`h-full w-px transition-colors ${
              dragging ? "bg-accent" : "bg-border group-hover:bg-accent/70"
            }`}
          />
          <div
            className={`absolute h-8 w-1 rounded-full transition-all ${
              dragging
                ? "bg-accent opacity-100 scale-y-110"
                : "bg-ink-dim/30 opacity-0 group-hover:opacity-100 group-hover:bg-accent/80"
            }`}
          />
        </div>
        <section className="flex min-h-0 flex-col">
          <GenUICanvas />
        </section>
      </SelectionTrigger>
      <SystemAuditDrawer />
      <TicketComposer />
      <VoiceSteerPanel />
      <DiffModal />
      <ActionApprovalDrawerSheet />
      <HotkeysOverlay />
      <Toasts />
    </div>
  );
}
