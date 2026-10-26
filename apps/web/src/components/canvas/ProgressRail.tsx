import { Check, Loader2 } from "lucide-react";
import type { ProgressEvent } from "@/lib/api";

/** Stage-by-stage progress from the orchestrator's SSE stream. */
export function ProgressRail({ events, title, busy }: { events: ProgressEvent[]; title: string; busy: boolean }) {
  return (
    <div className="card animate-fade-in">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        {busy ? <Loader2 className="size-4 animate-spin text-primary" /> : <Check className="size-4 text-healthy" />}
        {title}
      </div>
      <ol className="space-y-1 font-mono text-[11px]">
        {events.length === 0 && <li className="text-faint">connecting…</li>}
        {events.map((e, i) => {
          const last = i === events.length - 1;
          return (
            <li key={`${e.stage}-${i}`} className="flex items-start gap-2">
              <span className="w-14 shrink-0 text-right text-faint">+{e.elapsedMs} ms</span>
              <span className={`w-24 shrink-0 truncate ${last && busy ? "text-primary" : "text-muted"}`}>{e.stage}</span>
              <span className={last && busy ? "text-text" : "text-muted"}>{e.message}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
