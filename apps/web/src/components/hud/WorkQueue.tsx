import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { ChevronDown, Dices, FilePlus2, Inbox, ImageIcon, Radar, Search, Sparkles, Ticket } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ScenarioListItem, WorkItemOrigin } from "@contextpane/catalog";
import { ORIGIN_META, ORIGIN_ORDER, matchesFilter, matchesQuery, relativeAge, statusOf, type QueueFilter } from "@/lib/workitem";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { Pill, type Tone } from "../ui/Pill";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const queue = useMemo(() => orderedQueue(), [scenarios, convergence, orderedQueue]);
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
        className="relative flex h-7 min-w-0 max-w-[560px] items-center gap-2 rounded-md border border-border bg-elevated pr-2 pl-2 text-[12px] text-text hover:border-primary/50 focus:outline-2 focus:outline-primary"
      >
        {current ? (
          <>
            <span className={`inline-flex shrink-0 [&>svg]:size-3.5 ${TONE_TEXT[ORIGIN_META[current.origin].tone]}`}>{ORIGIN_ICON[current.origin]}</span>
            <span className="shrink-0 font-mono font-semibold">{current.displayId}</span>
            <span className="truncate text-muted">{current.title}</span>
            {status && <span className={`ml-1 shrink-0 rounded-pill border px-1.5 font-mono text-[10px] ${TONE_CLASS[status.tone]}`}>{status.label}</span>}
          </>
        ) : (
          <span className="text-muted">Work queue…</span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
        {unseen.length > 0 && <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-meta font-mono text-[9.5px] font-semibold text-canvas" title={`${unseen.length} new ERP drop(s)`} data-testid="queue-unseen">{unseen.length}</span>}
      </button>

      {open && (
        <FloatingPortal>
          <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={refs.setFloating} style={floatingStyles} className="z-50 w-[680px] max-w-[95vw] animate-fade-in rounded-[10px] border border-border bg-surface shadow-popover" role="listbox" aria-label="Work queue" data-testid="work-queue" onKeyDown={onKey}>
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
              <Search className="size-3.5 shrink-0 text-muted" />
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search id, customer, requester, error code, intent…" className="h-6 min-w-0 flex-1 bg-transparent text-[12px] text-text placeholder:text-faint focus:outline-none" data-testid="work-queue-search" />
              <Kbd>Ctrl K</Kbd>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-3 py-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  data-queue-filter={f.id}
                  className={`inline-flex h-5 items-center gap-1.5 rounded-pill border px-2 font-mono text-[10.5px] transition-colors ${filter === f.id ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted hover:text-text"}`}
                >
                  {f.label} <span className={`rounded px-1 text-[10px] font-semibold ${filter === f.id ? "bg-primary/20 text-primary" : "bg-elevated text-text/90"}`}>{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <ul className="max-h-[360px] overflow-y-auto py-1">
              {rows.length === 0 && <li className="px-3 py-4 text-center text-[12px] text-faint">No work items match.</li>}
              {rows.map((item) => (
                <QueueRow key={item.scenarioId} item={item} active={item.scenarioId === scenarioId} index={queue.indexOf(item) + 1} unseen={unseen.includes(item.scenarioId)} closed={closedId === item.scenarioId} onSelect={() => void select(item.scenarioId)} />
              ))}
            </ul>
            <div className="flex items-center gap-1.5 border-t border-border-subtle px-3 py-2">
              <Button variant="outline" icon={<FilePlus2 />} onClick={() => { setOpen(false); setComposerOpen(true); }} title="Paste any support ticket and triage it live (n)" data-testid="new-ticket-button">
                + Triage Unscripted Ticket
              </Button>
              <Button variant="meta" icon={<Dices />} loading={dropStatus === "loading"} onClick={() => void simulateDrop()} title="Write a random #2026xxx/ticketbody.json + attachment1.png into input/tickets/ and let the inbox watcher ingest it (g)" data-testid="drop-erp-button">
                🎲 Drop Random ERP Ticket
              </Button>
              <span className="ml-auto shrink-0 whitespace-nowrap text-[10.5px] text-faint">
                <Kbd>1</Kbd>–<Kbd>9</Kbd> open · <Kbd>j</Kbd> <Kbd>k</Kbd> step · <Kbd>Esc</Kbd> close
              </span>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

const TONE_TEXT: Record<Tone, string> = { primary: "text-primary", healthy: "text-healthy", warning: "text-warning", critical: "text-critical", meta: "text-meta", muted: "text-muted" };
const TONE_CLASS: Record<Tone, string> = {
  primary: "border-primary/40 bg-primary/12 text-primary",
  healthy: "border-healthy/40 bg-healthy/12 text-healthy",
  warning: "border-warning/40 bg-warning/12 text-warning",
  critical: "border-critical/40 bg-critical/12 text-critical",
  meta: "border-meta/40 bg-meta/12 text-meta",
  muted: "border-border bg-elevated text-muted",
};

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
        className={`grid w-full grid-cols-[18px_18px_auto_1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-elevated ${active ? "bg-primary/8" : ""}`}
      >
        <span className="font-mono text-[10px] text-faint">{index <= 9 ? index : ""}</span>
        <span className={`inline-flex [&>svg]:size-3.5 ${TONE_TEXT[meta.tone]}`} title={meta.label}>
          {ORIGIN_ICON[item.origin]}
        </span>
        <span className="font-mono font-semibold">
          {item.displayId}
          {unseen && !active && <span className="ml-1 inline-block size-1.5 rounded-full bg-meta align-middle" aria-label="new" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate">{item.title}</span>
          <span className="block truncate text-[10.5px] text-faint">
            {meta.label} · {item.tenantName}
            {item.custom?.ticket.requester ? ` · ${item.custom.ticket.requester.displayName}` : ""}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-faint">
          {active && (
            <span className="rounded-pill border border-primary/40 bg-primary/15 px-1.5 font-mono text-[10px] font-medium text-primary">
              Current
            </span>
          )}
          {attachments > 0 && (
            <span className="inline-flex items-center gap-0.5" title={item.custom?.erpDrop?.attachments.map((a) => a.fileName).join(", ")}>
              <ImageIcon className="size-3" />
              {attachments}
            </span>
          )}
          {relativeAge(item.createdAt)}
        </span>
        <span className={`rounded-pill border px-1.5 font-mono text-[10px] ${TONE_CLASS[status.tone]}`}>{status.label}</span>
      </button>
    </li>
  );
}
