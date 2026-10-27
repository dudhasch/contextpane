import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SELECTION_MAX_CHARS, SELECTION_MIN_CHARS } from "@contextpane/catalog";
import { useWorkbench } from "@/store";

interface Pending {
  text: string;
  rect: DOMRect;
}

/**
 * Wraps the ticket / anomaly body. When the engineer highlights 3-120 characters inside it a
 * floating action pill appears right above the selection: `✨ Generate Context UI for "…"`.
 * One click spawns the ContextualMiniDashboard on the right canvas and marks the phrase with
 * a cyan selection badge.
 */
export function SelectionTrigger({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const explore = useWorkbench((s) => s.exploreSelection);
  const status = useWorkbench((s) => s.exploreStatus);

  const { refs, floatingStyles } = useFloating({
    open: Boolean(pending),
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) return setPending(null);
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return setPending(null);
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < SELECTION_MIN_CHARS || text.length > SELECTION_MAX_CHARS) return setPending(null);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return setPending(null);
    setPending({ text, rect });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const rect = pending.rect;
    refs.setPositionReference({ getBoundingClientRect: () => rect, contextElement: containerRef.current ?? undefined });
  }, [pending, refs]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const pill = refs.floating.current;
      if (pill && pill.contains(e.target as Node)) return;
      setPending(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPending(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [refs.floating]);

  const generate = () => {
    if (!pending) return;
    const text = pending.text;
    setPending(null);
    window.getSelection()?.removeAllRanges();
    void explore(text);
  };

  return (
    <>
      <div ref={containerRef} onMouseUp={readSelection} onKeyUp={(e) => (e.shiftKey ? readSelection() : undefined)} data-testid="selection-surface">
        {children}
      </div>
      {pending && (
        <FloatingPortal>
          <button
            ref={refs.setFloating}
            type="button"
            style={floatingStyles}
            onMouseDown={(e) => e.preventDefault()}
            onClick={generate}
            disabled={status === "loading"}
            data-testid="selection-trigger"
            className="z-50 inline-flex h-7 max-w-[420px] animate-fade-in items-center gap-1.5 rounded-md border border-selection/60 bg-[#0B1120]/95 px-2.5 text-[11.5px] text-selection shadow-popover ring-1 ring-white/10 backdrop-blur-xl hover:bg-selection/15 disabled:opacity-60"
          >
            <Sparkles className="size-3.5 shrink-0" />
            <span className="truncate">
              Generate Context UI for "{pending.text.length > 42 ? `${pending.text.slice(0, 41)}…` : pending.text}"
            </span>
          </button>
        </FloatingPortal>
      )}
    </>
  );
}
