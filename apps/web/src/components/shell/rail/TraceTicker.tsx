import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "@/lib/api";
import { stageLabel } from "@/lib/format";
import { cleanProgressMessage } from "../../canvas/ProgressRail";

const FINISHED_STAGE = /(^|:)(done|routed|ready)$/;

function fmtMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/**
 * Two mono lines in the code-rail footer: the last two progress events of the operation in flight
 * (fix generation, approve, rollback) with the elapsed time on the right; `idle` when nothing runs.
 * Same `ProgressEvent[]` input as `ProgressRail`, so a streaming source can feed it directly. Remount
 * it (React `key`) per operation so the elapsed clock restarts.
 */
export function TraceTicker({ events, busy, label }: { events: ProgressEvent[]; busy: boolean; label?: string }) {
  // Between events the last stage keeps running, so its time ticks locally from the moment it arrived.
  const mountedAt = useRef(performance.now());
  const lastArrival = useRef({ count: 0, at: performance.now() });
  if (events.length !== lastArrival.current.count) lastArrival.current = { count: events.length, at: performance.now() };
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(t);
  }, [busy]);

  if (!busy) {
    return (
      <span className="font-mono text-11 text-faint" data-trace="idle">
        idle
      </span>
    );
  }

  const totalMs = Math.max(0, Math.round(now - mountedAt.current));
  const shown = events.slice(-2);
  const offset = events.length - shown.length;
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3" data-trace={label ?? "busy"} aria-live="polite">
      <ol className="min-w-0 flex-1 font-mono text-11">
        {shown.length === 0 && <li className="truncate text-faint">{label ? `${stageLabel(label)} · ` : ""}connecting…</li>}
        {shown.map((e, i) => {
          const last = offset + i === events.length - 1;
          // A finished stage (`agent:3:done`, `bundle:ready`) keeps its own time; only a running one ticks.
          const ms = last && !FINISHED_STAGE.test(e.stage) ? e.elapsedMs + Math.max(0, Math.round(now - lastArrival.current.at)) : e.elapsedMs;
          return (
            <li key={`${e.stage}-${offset + i}`} className="flex min-w-0 items-baseline gap-2">
              <span className="w-14 shrink-0 text-right text-faint">+{fmtMs(ms)}</span>
              <span className={`shrink-0 ${last ? "text-signal" : "text-muted"}`} title={e.stage}>
                {stageLabel(e.stage)}
              </span>
              <span className={`min-w-0 truncate ${last ? "text-text" : "text-muted"}`} title={cleanProgressMessage(e.message)}>
                {cleanProgressMessage(e.message)}
              </span>
            </li>
          );
        })}
      </ol>
      <span className="shrink-0 font-mono text-11 text-muted" data-testid="progress-elapsed">
        {(totalMs / 1000).toFixed(1)} s
      </span>
    </div>
  );
}
