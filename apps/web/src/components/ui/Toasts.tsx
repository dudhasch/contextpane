import { ExternalLink, X } from "lucide-react";
import { useWorkbench } from "@/store";
import { CODE_RAIL_COLLAPSED_PX, CODE_RAIL_OPEN_PX } from "../shell/CodeRail";
import { Dot, type Tone } from "./Pill";

/** Width of the System & audit sheet, which docks against the code rail. */
const SYSTEM_DRAWER_PX = 600;

const TONE_MAP: Record<string, Tone> = { info: "primary", healthy: "healthy", warning: "warning", critical: "critical", meta: "meta" };

export function Toasts() {
  const toasts = useWorkbench((s) => s.toasts);
  const dismiss = useWorkbench((s) => s.dismissToast);
  const codeRailOpen = useWorkbench((s) => s.codeRailOpen);
  const systemOpen = useWorkbench((s) => s.systemOpen);
  if (!toasts.length) return null;
  // Always clear the code rail (440 px, 36 px collapsed) and, when open, the System & audit sheet docked
  // against it: the stack is centred in whatever is left of the deck.
  const reservedPx = (codeRailOpen ? CODE_RAIL_OPEN_PX : CODE_RAIL_COLLAPSED_PX) + 1 + (systemOpen ? SYSTEM_DRAWER_PX : 0);
  return (
    <div
      className="pointer-events-none fixed bottom-4 z-[10000] flex w-80 max-w-sm -translate-x-1/2 flex-col gap-2 transition-[left] duration-150"
      style={{ left: `max(176px, calc((100vw - ${reservedPx}px) / 2))` }}
      data-testid="toast-container"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex animate-fade-in items-start gap-2 rounded-md border border-hairline bg-raised px-3 py-2 shadow-popover">
          <span className="mt-1">
            <Dot tone={TONE_MAP[t.tone] ?? "primary"} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-13 font-semibold">{t.title}</div>
            {t.detail && <div className="mt-0.5 text-12 text-muted break-words">{t.detail}</div>}
            {t.action && (
              <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="mt-1.5 inline-flex h-6 items-center rounded-md border border-hairline px-2 text-11 font-medium text-signal hover:bg-surface" data-testid="toast-action">
                {t.action.label}
              </button>
            )}
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-12 text-healthy hover:underline">
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
