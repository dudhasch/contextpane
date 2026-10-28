import { useWorkbench } from "@/store";
import { ContextFolds } from "./ContextFolds";
import { PlanSection } from "./PlanSection";
import { TicketBody } from "./TicketBody";
import { TicketHeader } from "./TicketHeader";

/**
 * Context zone (decisions Q2 / Q3): the ticket first, borderless, four stacked sections divided
 * by hairlines: header, the customer's words with enriched entities underlined in their domain
 * colour, the summary & resolution plan (agent / cloud status as one mono line, scope chips inside
 * the steps they steer), and the reference folds pinned to the bottom.
 */
export function ScenarioPane() {
  const brief = useWorkbench((s) => s.brief);
  const status = useWorkbench((s) => s.briefStatus);
  if (!brief) {
    if (status === "error") {
      return <div className="flex h-full items-center justify-center text-13 text-muted">Orchestrator unreachable — start apps/orchestrator on :4000</div>;
    }
    return <ScenarioPaneSkeleton />;
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3.5 pt-1.5" data-testid="scenario-pane">
      <TicketHeader brief={brief} />
      <TicketBody brief={brief} />
      <PlanSection brief={brief} />
      <ContextFolds brief={brief} />
    </div>
  );
}

/**
 * While the brief loads (a live correlate can take ~30 s): the ticket as the queue already knows it
 * (title, requester, body for custom and ERP tickets) and skeleton bars, never a blank pane.
 */
function ScenarioPaneSkeleton() {
  const item = useWorkbench((s) => s.scenarios.find((x) => x.scenarioId === s.scenarioId));
  const ticket = item?.custom?.ticket;
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3.5 pt-1.5" data-testid="scenario-pane-skeleton" aria-busy="true">
      {item ? (
        <header>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-12 font-semibold text-text">{item.displayId}</span>
            <span className="min-w-0 truncate text-11 text-faint">{item.tenantName}</span>
          </div>
          <h2 className="mt-0.5 line-clamp-2 text-15 font-semibold text-text">{item.title}</h2>
        </header>
      ) : (
        <div className="h-5 w-2/3 animate-pulse rounded bg-raised" />
      )}
      <div className="mt-1 flex items-center gap-1.5 font-mono text-11 text-faint">
        <span className="animate-pulse-dot text-signal">✦</span>
        Gathering tenant context and correlating the ticket…
      </div>
      {ticket?.body ? (
        <section className="mt-2 border-t border-hairline pt-2" data-testid="customer-ticket-card">
          <p className="text-13 leading-normal whitespace-pre-line text-text" data-testid="scenario-body">
            {ticket.body}
          </p>
        </section>
      ) : (
        <div className="mt-2 space-y-1.5 border-t border-hairline pt-2">
          <div className="h-3 w-full animate-pulse rounded bg-raised" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-raised" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-raised" />
        </div>
      )}
      <div className="mt-2 space-y-1.5 border-t border-hairline pt-2">
        <div className="h-3 w-1/3 animate-pulse rounded bg-raised" />
        <div className="h-3 w-full animate-pulse rounded bg-raised" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-raised" />
      </div>
    </div>
  );
}
