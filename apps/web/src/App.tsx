import { useEffect } from "react";
import { ActionApprovalDrawerSheet } from "./components/canvas/ActionApprovalDrawer";
import { DiffModal } from "./components/canvas/DiffModal";
import { GenUICanvas } from "./components/canvas/GenUICanvas";
import { HotkeysOverlay } from "./components/demo/HotkeysOverlay";
import { SystemAuditDrawer } from "./components/hud/SystemAuditDrawer";
import { TicketComposer } from "./components/hud/TicketComposer";
import { TopBar } from "./components/hud/TopBar";
import { VoiceSteerPanel } from "./components/hud/VoiceSteer";
import { ScenarioPane } from "./components/ticket/ScenarioPane";
import { Toasts } from "./components/ui/Toasts";
import { useDemoHotkeys } from "./hooks/useDemoHotkeys";
import { useWorkbench } from "./store";

export function App() {
  const boot = useWorkbench((s) => s.boot);
  useDemoHotkeys();
  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <div className="relative flex h-full flex-col">
      <TopBar />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(440px,40%)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col border-r border-border bg-surface/40">
          <ScenarioPane />
        </section>
        <section className="flex min-h-0 flex-col">
          <GenUICanvas />
        </section>
      </main>
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
