import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { ChevronDown, Dices, FilePlus2, FlaskConical, Inbox, ImageIcon, Radar, Search, Sparkles, Ticket } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ScenarioListItem, WorkItemOrigin } from "@contextpane/catalog";
import { ORIGIN_META, ORIGIN_ORDER, matchesFilter, matchesQuery, relativeAge, statusOf, type QueueFilter } from "@/lib/workitem";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { Pill, TONE_TEXT } from "../ui/Pill";

/**
 * The unified work queue. One button in the top bar names the item on screen; its popover is the
 * whole operational stream: search, origin filter pills, rows with origin icon, status and age,
 * and the two ways new work enters (paste a ticket, drop a random ERP folder). Ctrl+K opens it,
 * 1-9 and j/k follow its order, Esc closes it. Nothing else renders until it is opened.
 */

export const ORIGIN_ICON: Record<WorkItemOrigin, ReactNode> = {
  psa: <Ticket />,
  anomaly: <Radar />,
  "erp-drop": <Inbox />,
  unscripted: <Sparkles />,
};

export function OriginBadge({ origin, short = false, className = "" }: { origin: WorkItemOrigin; short?: boolean; className?: string }) {
  const meta = ORIGIN_META[origin];
  return (
    <Pill tone={meta.tone} icon={ORIGIN_ICON[origin]} mono={false} className={className} title={meta.label}>
      {short ? meta.short : meta.label}
    </Pill>
  );
}

const FILTERS: Array<{ id: QueueFilter; label: string }> = [{ id: "all", label: "All" }, ...ORIGIN_ORDER.map((o) => ({ id: o as QueueFilter, label: ORIGIN_META[o].short })), { id: "resolved", label: "Resolved" }];

export function WorkQueue() {
  const open = useWorkbench((s) => s.queueOpen);
  const setOpen = useWorkbench((s) => s.setQueueOpen);
  const freeRoamOpen = useWorkbench((s) => s.freeRoamOpen);
  const openFreeRoam = useWorkbench((s) => s.openFreeRoam);
  const dataMode = useWorkbench((s) => s.dataMode);
  const scanAnomalies = useWorkbench((s) => s.scanAnomalies);
  const scanningAnomalies = useWorkbench((s) => s.scanningAnomalies);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const scenarios = useWorkbench((s) => s.scenarios);
  const convergence = useWorkbench((s) => s.convergence);
  const unseen = useWorkbench((s) => s.unseen);
  const filter = useWorkbench((s) => s.queueFilter);
  const setFilter = useWorkbench((s) => s.setQueueFilter);
  const query = useWorkbench((s) => s.queueQuery);
  const setQuery = useWorkbench((s) => s.setQueueQuery);
  const select = useWorkbench((s) => s.selectScenario);
  const orderedQueue = useWorkbench((s) => s.orderedQueue);
  const setComposerOpen = useWorkbench((s) => s.setComposerOpen);
  const simulateDrop = useWorkbench((s) => s.simulateDrop);
  const dropStatus = useWorkbench((s) => s.dropStatus);
  const closedId = useWorkbench((s) => (s.resolutionNote?.closed ? s.resolutionNote.scenarioId : null));
  const includeSeeded = useWorkbench((s) => s.includeSeededOverride ?? s.dataMode !== "real-tenant");
  const setIncludeSeeded = useWorkbench((s) => s.setIncludeSeeded);
  const inputRef = useRef<HTMLInputElement>(null);

  const queue = useMemo(() => orderedQueue(), [scenarios, convergence, orderedQueue, includeSeeded]);
  const current = queue.find((s) => s.scenarioId === scenarioId);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, queue.filter((s) => matchesFilter(s, f.id, convergence)).length])) as Record<QueueFilter, number>, [queue, convergence]);
  const rows = queue.filter((s) => matchesFilter(s, filter, convergence) && matchesQuery(s, query));

  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.floating.current?.contains(target) || refs.reference.current instanceof Node && refs.reference.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, refs.floating, refs.reference, setOpen]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    // The search input owns focus, so the advertised 1–9 hotkeys are handled here while the query is empty.
    if (query === "" && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const item = queue[Number(e.key) - 1];
      if (item) {
        e.preventDefault();
        void select(item.scenarioId);
      }
      return;
    }
    if (e.key === "Enter" && rows[0]) {
      e.preventDefault();
      void select(rows[0].scenarioId);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = rows.findIndex((r) => r.scenarioId === scenarioId);
      const next = rows[(i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
      if (next) void select(next.scenarioId);
    }
  };

  const status = current ? statusOf(current, closedId === current.scenarioId) : null;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Work queue · Ctrl+K"
        data-testid="work-queue-button"
        className="relative flex h-7 min-w-0 max-w-[560px] items-center gap-2 rounded-md border border-hairline bg-raised pr-2 pl-2 text-12 whitespace-nowrap text-text hover:border-signal/50 focus:outline-2 focus:outline-signal"
      >
        {!freeRoamOpen && current ? (
          <>
            <span className={`inline-flex shrink-0 [&>svg]:size-3.5 ${TONE_TEXT[ORIGIN_META[current.origin].tone]}`}>{ORIGIN_ICON[current.origin]}</span>
            <span className="shrink-0 font-mono font-semibold">{current.displayId}</span>
            <span className="min-w-0 truncate text-muted">{current.title}</span>
            {status && (
              <Pill variant="status" tone={status.tone} mono={false} className="ml-1 shrink-0">
                {status.label}
              </Pill>
            )}
          </>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
            {freeRoamOpen ? `Work queue · ${queue.length}` : "Work queue"}
            <Kbd>Ctrl K</Kbd>
          </span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
        {unseen.length > 0 && <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-signal font-mono text-11 font-semibold text-signal-ink" title={`${unseen.length} new ERP drop(s)`} data-testid="queue-unseen">{unseen.length}</span>}
      </button>

      {open && (
        <FloatingPortal>
          {/* Transparent click-catcher: the popover closes on an outside click without dimming the deck. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={refs.setFloating} style={floatingStyles} className="z-50 w-[680px] max-w-[95vw] animate-fade-in rounded-md border border-hairline bg-surface shadow-popover" role="listbox" aria-label="Work queue" data-testid="work-queue" onKeyDown={onKey}>
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
              <Search className="size-3.5 shrink-0 text-muted" />
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search id, customer, requester, error code, intent…" className="h-6 min-w-0 flex-1 bg-transparent text-12 text-text placeholder:text-faint focus:outline-none" data-testid="work-queue-search" />
              <Kbd>Ctrl K</Kbd>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-3 py-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  data-queue-filter={f.id}
                  aria-pressed={filter === f.id}
                  className={`relative inline-flex h-6 items-center gap-1 text-12 transition-colors ${filter === f.id ? "text-text" : "text-muted hover:text-text"}`}
                >
                  {f.label} <span className="font-mono text-11 text-faint">{counts[f.id] ?? 0}</span>
                  {filter === f.id && <span aria-hidden className="absolute inset-x-0 -bottom-1.5 h-0.5 bg-signal" />}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void setIncludeSeeded(!includeSeeded)}
                aria-pressed={includeSeeded}
                title={includeSeeded ? "Seeded demo tickets (INC-4092, INC-4099, ANOM-*) are listed first · click to hide them" : "Show the seeded demo tickets (INC-4092, INC-4099, ANOM-*) at the top of the queue"}
                data-testid="queue-seeded-chip"
                className={`ml-auto inline-flex h-6 items-center gap-1 text-12 transition-colors [&>svg]:size-3 ${includeSeeded ? "text-text" : "text-muted hover:text-text"}`}
              >
                <FlaskConical className={includeSeeded ? "text-signal" : ""} /> Seeded demo tickets {includeSeeded ? "on" : "off"}
              </button>
            </div>
            <ul className="max-h-[360px] divide-y divide-hairline-2 overflow-y-auto">
              {rows.length === 0 && (
                <li className="px-3 py-4 text-center text-12 text-faint">
                  {dataMode === "real-tenant" && !includeSeeded
                    ? "No custom tickets or live anomalies in the queue yet. Turn on seeded demo tickets, scan for anomalies or triage an unscripted ticket."
                    : "No work items match."}
                </li>
              )}
              {rows.map((item) => (
                <QueueRow key={item.scenarioId} item={item} active={!freeRoamOpen && item.scenarioId === scenarioId} index={queue.indexOf(item) + 1} unseen={unseen.includes(item.scenarioId)} closed={closedId === item.scenarioId} onSelect={() => void select(item.scenarioId)} />
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline px-3 py-2">
              <Button variant="outline" icon={<FilePlus2 />} onClick={() => { setOpen(false); setComposerOpen(true); }} title="Paste any support ticket and triage it live (n)" data-testid="new-ticket-button">
                Triage unscripted ticket
              </Button>
              <Button
                variant="outline"
                icon={<Radar />}
                loading={scanningAnomalies}
                onClick={() => void scanAnomalies()}
                title="Scan live MCP tenant endpoints for license drift, Conditional Access posture issues, expired secrets, and NSG drift"
                data-testid="queue-scan-anomalies-button"
              >
                Scan for anomalies
              </Button>
              {dataMode !== "real-tenant" && (
                <Button variant="outline" icon={<Dices />} loading={dropStatus === "loading"} onClick={() => void simulateDrop()} title="Write a random #2026xxx/ticketbody.json + attachment1.png into input/tickets/ and let the inbox watcher ingest it (g)" data-testid="drop-erp-button">
                  Drop random ERP ticket
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  openFreeRoam();
                }}
              >
                Free-Roam start page
              </Button>
              <span className="ml-auto shrink-0 whitespace-nowrap text-11 text-faint">
                <Kbd>1</Kbd>–<Kbd>9</Kbd> open · <Kbd>j</Kbd> <Kbd>k</Kbd> step · <Kbd>Esc</Kbd> close
              </span>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}


function QueueRow({ item, active, index, unseen, closed, onSelect }: { item: ScenarioListItem; active: boolean; index: number; unseen: boolean; closed: boolean; onSelect: () => void }) {
  const prewarmQueue = useWorkbench((s) => s.prewarmQueueScenario);
  const meta = ORIGIN_META[item.origin];
  const status = statusOf(item, closed);
  const attachments = item.custom?.erpDrop?.attachments.length ?? 0;
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        onMouseEnter={() => {
          if (!active) {
            window.setTimeout(() => void prewarmQueue(item.scenarioId), 60);
          }
        }}
        data-work-item={item.scenarioId}
        className={`grid w-full grid-cols-[18px_18px_auto_1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-left text-12 transition-colors hover:bg-raised ${active ? "bg-signal/8" : ""}`}
      >
        <span className="font-mono text-11 text-faint">{index <= 9 ? index : ""}</span>
        <span className={`inline-flex [&>svg]:size-3.5 ${TONE_TEXT[meta.tone]}`} title={meta.label}>
          {ORIGIN_ICON[item.origin]}
        </span>
        <span className="font-mono font-semibold">
          {item.displayId}
          {unseen && !active && <span className="ml-1 inline-block size-1.5 rounded-full bg-signal align-middle" aria-label="new" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate">{item.title}</span>
          <span className="block truncate text-11 text-faint">
            {meta.label} · {item.tenantName}
            {item.custom?.ticket.requester ? ` · ${item.custom.ticket.requester.displayName}` : ""}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-11 text-faint">
          {active && <span className="font-medium text-signal">current</span>}
          {attachments > 0 && (
            <span className="inline-flex items-center gap-0.5" title={item.custom?.erpDrop?.attachments.map((a) => a.fileName).join(", ")}>
              <ImageIcon className="size-3" />
              {attachments}
            </span>
          )}
          {relativeAge(item.createdAt)}
        </span>
        <Pill variant="status" tone={status.tone} mono={false} className="justify-self-end">
          {status.label}
        </Pill>
      </button>
    </li>
  );
}
