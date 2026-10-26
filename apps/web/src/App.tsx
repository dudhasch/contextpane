import { LayoutGrid, Ticket } from "lucide-react";
import { useEffect } from "react";
import { ActionApprovalDrawerSheet } from "./components/canvas/ActionApprovalDrawer";
import { DiffModal } from "./components/canvas/DiffModal";
import { GenUICanvas } from "./components/canvas/GenUICanvas";
import { HotkeysOverlay } from "./components/demo/HotkeysOverlay";
import { RouterSavingsPanel } from "./components/hud/RouterSavingsPanel";
import { TopBar } from "./components/hud/TopBar";
import { VoiceSteerPanel } from "./components/hud/VoiceSteer";
import { PaneHeader, TicketPane } from "./components/ticket/TicketPane";
import { Pill } from "./components/ui/Pill";
import { Toasts } from "./components/ui/Toasts";
import { useDemoHotkeys } from "./hooks/useDemoHotkeys";
import { useWorkbench } from "./store";

export function App() {
  const boot = useWorkbench((s) => s.boot);
  const context = useWorkbench((s) => s.context);
  const layout = useWorkbench((s) => s.layout);
  useDemoHotkeys();
  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <div className="relative flex h-full flex-col">
      <TopBar />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(420px,38%)_1fr]">
        <section className="flex min-h-0 flex-col border-r border-border bg-surface/40">
          <PaneHeader
            icon={<Ticket />}
            title="Context-enriched ERP ticket"
            right={context && <Pill tone="muted">{context.license.source === "live-graph" ? "Graph: live" : "Graph: manifest"} · {context.drift.source === "live-azure" ? "Az: live" : "Az: manifest"}</Pill>}
          />
          <div className="min-h-0 flex-1">
            <TicketPane />
          </div>
        </section>
        <section className="flex min-h-0 flex-col">
          <PaneHeader
            icon={<LayoutGrid />}
            title="Catalog-constrained generative UI"
            right={
              layout && (
                <Pill tone={layout.provenance.provider === "local" ? "primary" : "meta"}>
                  {layout.provenance.tier} · {layout.components.length} components · {layout.provenance.validated ? "zod ✓" : "repaired"}
                </Pill>
              )
            }
          />
          <div className="min-h-0 flex-1">
            <GenUICanvas />
          </div>
        </section>
      </main>
      <RouterSavingsPanel />
      <VoiceSteerPanel />
      <DiffModal />
      <ActionApprovalDrawerSheet />
      <HotkeysOverlay />
      <Toasts />
    </div>
  );
}
