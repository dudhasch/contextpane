import { ClipboardCopy } from "lucide-react";
import { useWorkbench } from "@/store";
import { Button } from "../../ui/Button";
import { useCopy } from "./shared";

/**
 * Rail `console` mode: what the orchestrator reported for the approve / revert run, as a full-bleed
 * mono log. The [OK] / [REVERT] sign-off lives in the approve footer under it.
 */
export function LiveConsole() {
  const step = useWorkbench((s) => s.liveConsoleStep);
  const lines = useWorkbench((s) => s.liveConsoleLines);
  const streaming = useWorkbench((s) => s.liveConsoleStreaming);
  const reverted = useWorkbench((s) => s.liveConsoleReverted);
  const copy = useCopy();
  const stepTone = reverted ? "text-warning" : streaming ? "text-signal" : "text-healthy";

  return (
    <div className="flex flex-col pb-3" data-testid="live-execution-console">
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${streaming ? "animate-pulse-dot bg-signal" : reverted ? "bg-warning" : "bg-healthy"}`}
        />
        <span className="font-mono text-11 font-medium text-text">&gt;_ Live execution output</span>
        <Button size="xs" variant="ghost" icon={<ClipboardCopy />} className="ml-auto" onClick={() => void copy(lines.join("\n"), "Live execution console output")}>
          Copy log
        </Button>
      </div>
      {step && (
        <div className={`border-t border-hairline px-3 py-1.5 font-mono text-12 break-words ${stepTone}`} data-testid="live-console-step-header">
          {step}
        </div>
      )}
      <div className="space-y-0.5 border-y border-hairline bg-ground px-3 py-2 font-mono text-11 leading-[1.6]">
        {lines.length === 0 && !streaming && <div className="text-faint">No output reported.</div>}
        {lines.map((line, i) => {
          const isSuccess = line.includes("✓") || line.includes("PASSED");
          const isWarn = line.includes("⚠") || line.includes("↩") || line.includes("Rollback");
          return (
            <div key={i} className={`whitespace-pre-wrap break-words ${isSuccess ? "text-healthy" : isWarn ? "text-warning" : "text-text"}`}>
              {line}
            </div>
          );
        })}
        {streaming && (
          <div className="flex items-center gap-2 text-signal">
            <span aria-hidden className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-signal" />
            <span>Awaiting Microsoft Graph &amp; Azure ARM confirmation…</span>
          </div>
        )}
      </div>
    </div>
  );
}
