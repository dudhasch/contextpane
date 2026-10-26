import { Check, Copy, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";

/** Modal card for a Temporary Access Pass issued from a hover popover's [Issue TAP]. */
export function TapIssuedCard() {
  const tap = useWorkbench((s) => s.tap);
  const close = useWorkbench((s) => s.closeTap);
  const [copied, setCopied] = useState(false);
  if (!tap) return null;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the code stays selectable */
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/70" onClick={close}>
      <div className="w-[420px] animate-fade-in card shadow-popover" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Temporary Access Pass">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-meta" />
          <span className="text-[13px] font-semibold">{tap.status === "ready" ? "Temporary Access Pass Issued" : tap.status === "loading" ? "Issuing Temporary Access Pass…" : "TAP failed"}</span>
          {tap.status === "ready" && <Pill tone={tap.source === "live-graph" ? "healthy" : "warning"}>{tap.source === "live-graph" ? "live Graph" : "fallback"}</Pill>}
          <button type="button" onClick={close} className="ml-auto text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="font-mono text-[11px] text-muted">{tap.upn}</div>
        {tap.status === "loading" && <div className="mt-3 h-12 animate-pulse rounded-md bg-surface" />}
        {tap.status === "error" && <div className="mt-3 text-[12px] text-critical">{tap.error}</div>}
        {tap.status === "ready" && (
          <>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-meta/40 bg-meta/8 px-3 py-2.5">
              <span className="flex-1 font-mono text-xl tracking-wide text-text select-all" data-testid="tap-code">
                {tap.temporaryAccessPass}
              </span>
              <Button size="sm" variant="outline" icon={copied ? <Check /> : <Copy />} onClick={() => void copy(tap.temporaryAccessPass)}>
                {copied ? "Copied" : "Copy TAP"}
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-faint">Lifetime</dt>
              <dd>{tap.lifetimeInMinutes} min</dd>
              <dt className="text-faint">One-time use</dt>
              <dd>{tap.isUsableOnce ? "Yes" : "No"}</dd>
              <dt className="text-faint">Valid from</dt>
              <dd className="font-mono">{tap.startDateTime.slice(0, 19)}Z</dd>
              <dt className="text-faint">Audit</dt>
              <dd className="font-mono text-muted">{tap.auditId} · code not logged</dd>
            </dl>
            {tap.source === "simulated-fallback" && (
              <div className="mt-3 rounded-md border border-warning/30 bg-warning/8 px-2.5 py-1.5 text-[11px] text-warning" title={tap.fallbackReason}>
                Not issued in Entra: {tap.fallbackReason?.slice(0, 140) ?? "TAP policy unavailable"}. Enable the Temporary Access Pass policy for this user (and grant
                UserAuthenticationMethod.ReadWrite.All) for a live pass.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
