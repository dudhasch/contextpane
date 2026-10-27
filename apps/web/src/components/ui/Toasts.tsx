import { ExternalLink, X } from "lucide-react";
import { useWorkbench } from "@/store";
import { Dot, type Tone } from "./Pill";

const TONE_MAP: Record<string, Tone> = { info: "primary", healthy: "healthy", warning: "warning", critical: "critical", meta: "meta" };

export function Toasts() {
  const toasts = useWorkbench((s) => s.toasts);
  const dismiss = useWorkbench((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    // bottom-left on purpose: the approval drawer's [Approve & Execute] button lives bottom-right and must never be covered.
    <div className="pointer-events-none fixed bottom-6 left-6 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto card animate-fade-in flex items-start gap-2 shadow-popover">
          <span className="mt-1">
            <Dot tone={TONE_MAP[t.tone] ?? "primary"} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{t.title}</div>
            {t.detail && <div className="mt-0.5 text-xs text-muted break-words">{t.detail}</div>}
            {t.action && (
              <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="mt-1.5 inline-flex h-6 items-center rounded-md border border-primary/40 bg-primary/12 px-2 text-[11px] font-medium text-primary hover:bg-primary/20" data-testid="toast-action">
                {t.action.label}
              </button>
            )}
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-healthy hover:underline">
                {t.hrefLabel ?? t.href} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} className="text-faint hover:text-text" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
