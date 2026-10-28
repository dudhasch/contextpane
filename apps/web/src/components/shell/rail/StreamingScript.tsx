import { useEffect, useMemo, useState } from "react";
import type { RailStream } from "@/store";
import { GHOST_CLASS } from "../../canvas/Section";

/** Reveal pace: ~12 ms per line, the whole script within 1.2 s however long it is. */
const LINE_MS = 12;
const MAX_REVEAL_MS = 1200;
/** Placeholder bar widths (in characters) while no previous script exists to ghost. */
const PLACEHOLDER = [28, 44, 36, 0, 52, 40, 22, 48, 30, 0, 38, 26];

/**
 * WP6 choreography in the code rail: the script arriving while Muse Code works. Until the coder's
 * script lands, the previous script (or placeholder bars) sits there as ghost lines; then the new
 * script replaces them line by line. With a previous script, lines that are new carry the `+` diff
 * colour; a first script is plain mono. The block reserves every line from the start, so nothing
 * below it jumps while lines morph from ghost to real.
 */
export function StreamingScript({ stream, ticketId, busy }: { stream: RailStream; ticketId: string; busy: boolean }) {
  const lines = useMemo(() => (stream.script ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n"), [stream.script]);
  const previous = useMemo(() => (stream.previous ? new Set(stream.previous.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim())) : null), [stream.previous]);
  const shown = useLineReveal(stream.script === null ? 0 : lines.length, stream.seq);
  const writing = stream.script === null;
  const added = previous ? lines.filter((l) => l.trim() && !previous.has(l.trim())).length : lines.length;
  const doneRevealing = !writing && shown >= lines.length;

  const status = writing
    ? stream.source === "refine"
      ? "rewriting for the new scope…"
      : "generating…"
    : !doneRevealing
      ? `streaming ${shown}/${lines.length}`
      : busy
        ? stream.source === "refine"
          ? `${previous ? `+${added} lines · ` : ""}waiting for the rest of the plan`
          : `${previous ? `+${added} lines · ` : ""}pre-flight running`
        : `${previous ? `+${added} new lines · ` : ""}preview, not staged`;

  return (
    <div className="flex flex-col pb-3" data-testid="rail-stream" data-source={stream.source} data-lines-shown={shown} data-lines-total={writing ? 0 : lines.length}>
      <div className="px-3 pt-2.5 pb-2.5">
        <p className="flex min-w-0 items-baseline gap-1.5 text-12 text-muted">
          <span aria-hidden className={`text-signal ${writing || !doneRevealing || busy ? "motion-safe:animate-pulse-dot" : ""}`}>
            ✦
          </span>
          <span className="min-w-0 truncate">
            {doneRevealing && !busy
              ? "Fix rewritten for the clarified scope · stage it to run the pre-flight"
              : stream.source === "refine"
                ? "Muse Code is rewriting the fix for the clarified scope"
                : "Muse Code is writing the fix"}
          </span>
        </p>
      </div>
      <div className="flex h-9 items-center gap-2 border-y border-hairline bg-surface px-3 font-mono text-11 text-faint">
        <span className="min-w-0 truncate">{ticketId.toLowerCase()}-fix.ps1 · PowerShell 7</span>
        <span className="ml-auto shrink-0" aria-live="polite">
          {status}
        </span>
      </div>
      <pre className="border-b border-hairline bg-ground py-2 font-mono text-11 leading-[1.55] text-text" aria-busy={writing || !doneRevealing || undefined}>
        {writing
          ? ghostSource(stream.previous).map((line, i) => <GhostLine key={`g-${i}`} line={line} />)
          : lines.map((line, i) =>
              i < shown ? (
                <div
                  key={`l-${stream.seq}-${i}`}
                  data-line=""
                  className={`px-3 whitespace-pre-wrap break-words ${previous && line.trim() && !previous.has(line.trim()) ? "diff-line-add" : ""}`}
                >
                  {line || " "}
                </div>
              ) : (
                <GhostLine key={`g-${stream.seq}-${i}`} line={line} />
              ),
            )}
      </pre>
    </div>
  );
}

function ghostSource(previous: string | null): string[] {
  if (previous) return previous.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return PLACEHOLDER.map((n) => (n ? "x".repeat(n) : ""));
}

/** One not-yet-real line: its indentation stays, the rest is a ghost bar that wraps like the text. */
function GhostLine({ line }: { line: string }) {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const rest = line.slice(indent.length).trimEnd();
  return (
    <div className="px-3 whitespace-pre-wrap break-words" data-ghost="">
      {indent}
      {rest ? <span className={GHOST_CLASS}>{rest}</span> : " "}
    </div>
  );
}

/** Count of revealed lines: the first at once, then one every `LINE_MS` (faster for long scripts). */
function useLineReveal(total: number, seq: number): number {
  const [shown, setShown] = useState(() => Math.min(total, 1));
  useEffect(() => {
    if (total === 0) {
      setShown(0);
      return;
    }
    const perLine = Math.min(LINE_MS, MAX_REVEAL_MS / total);
    const started = performance.now();
    setShown(1);
    // A timer, not rAF: the reveal keeps its clock (by elapsed time) even in a background tab.
    const timer = window.setInterval(() => {
      const n = Math.min(total, 1 + Math.floor((performance.now() - started) / perLine));
      setShown(n);
      if (n >= total) window.clearInterval(timer);
    }, Math.max(8, Math.round(perLine)));
    return () => window.clearInterval(timer);
  }, [total, seq]);
  return shown;
}
