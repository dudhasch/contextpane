import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { CornerDownLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CONTEXT_VIEW_MODES, SELECTION_MAX_CHARS, SELECTION_MIN_CHARS, type ContextViewMode } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { CONTEXT_MODE_LIST, CONTEXT_MODE_META, ContextModeIcon } from "../ui/ContextModeIcons";

interface Pending {
  text: string;
  rect: DOMRect;
}

/**
 * Wraps the ticket / anomaly body. When the engineer highlights 3-120 characters inside it a
 * floating action bar appears right above the selection:
 * - Left: `✨ Generate Context UI for "…"`
 * - Middle: auto-focused inline refinement input (e.g. "other apps with the same owner") — press Enter to generate
 * - Right: 4 VectorCraft SVG view-mode icons (Dashboard, Full Card, Quick Comparison, Blast Radius) — press Tab to cycle
 */
export function SelectionTrigger({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refinement, setRefinement] = useState("");
  const [viewMode, setViewMode] = useState<ContextViewMode>("dashboard");
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
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < SELECTION_MIN_CHARS || text.length > SELECTION_MAX_CHARS) return setPending(null);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return setPending(null);
    setPending({ text, rect });
    setRefinement("");
    setViewMode("dashboard");
  }, []);

  useEffect(() => {
    if (!pending) return;
    const rect = pending.rect;
    refs.setPositionReference({ getBoundingClientRect: () => rect, contextElement: containerRef.current ?? undefined });
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pending, refs]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const pill = refs.floating.current;
      if (pill && pill.contains(e.target as Node)) return;
      setPending(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPending(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [refs.floating]);

  const generate = useCallback(
    (overrideMode?: ContextViewMode) => {
      if (!pending || status === "loading") return;
      const text = pending.text;
      const trimmedRefinement = refinement.trim();
      const targetMode = overrideMode ?? viewMode;
      setPending(null);
      window.getSelection()?.removeAllRanges();
      void explore(text, {
        ...(trimmedRefinement ? { refinementText: trimmedRefinement } : {}),
        viewMode: targetMode,
      });
    },
    [pending, status, refinement, viewMode, explore],
  );

  const onBarKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const idx = CONTEXT_VIEW_MODES.indexOf(viewMode);
      const delta = e.shiftKey ? -1 : 1;
      const next = CONTEXT_VIEW_MODES[(idx + delta + CONTEXT_VIEW_MODES.length) % CONTEXT_VIEW_MODES.length]!;
      setViewMode(next);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      generate();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPending(null);
    }
  };

  const activeModeMeta = CONTEXT_MODE_META[viewMode];

  return (
    <>
      <div
        ref={containerRef}
        onMouseUp={readSelection}
        onKeyUp={(e) => (e.shiftKey ? readSelection() : undefined)}
        data-testid="selection-surface"
      >
        {children}
      </div>
      {pending && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            onKeyDown={onBarKeyDown}
            data-testid="selection-trigger-bar"
            className="z-50 inline-flex max-w-[96vw] animate-fade-in flex-wrap items-center gap-1 rounded-lg border border-selection/65 bg-[#0B1120]/96 p-1 text-[11.5px] text-selection shadow-popover ring-1 ring-white/10 backdrop-blur-xl"
          >
            {/* Primary Generate button */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => generate()}
              disabled={status === "loading"}
              data-testid="selection-trigger"
              title={`Generate ${activeModeMeta.label} for "${pending.text}"${refinement.trim() ? ` + "${refinement.trim()}"` : ""} (Enter)`}
              className="inline-flex h-6 max-w-[290px] items-center gap-1.5 rounded-md px-2 font-medium text-selection transition-colors hover:bg-selection/18 disabled:opacity-60"
            >
              <Sparkles className="size-3.5 shrink-0" />
              <span className="truncate">
                Generate Context UI for "{pending.text.length > 30 ? `${pending.text.slice(0, 29)}…` : pending.text}"
              </span>
            </button>

            <span className="h-4 w-px bg-selection/25" aria-hidden="true" />

            {/* Auto-focused inline refinement input */}
            <div className="relative inline-flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                placeholder='+ add info (e.g. "other apps with same owner")'
                aria-label="Additional context or query refinement"
                data-testid="selection-refinement-input"
                maxLength={120}
                className="h-6 w-[235px] rounded border border-selection/35 bg-canvas/85 pr-6 pl-2 font-sans text-[11px] text-text placeholder:text-muted/75 focus:border-selection focus:outline-none focus:ring-1 focus:ring-selection/50"
              />
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => generate()}
                title="Press Enter to generate"
                className="absolute right-1 inline-flex size-4 items-center justify-center rounded text-selection/80 hover:bg-selection/20 hover:text-selection"
              >
                <CornerDownLeft className="size-2.5" />
              </button>
            </div>

            <span className="h-4 w-px bg-selection/25" aria-hidden="true" />

            {/* VectorCraft 4-mode SVG icon selector (Tab cycles between modes) */}
            <div
              role="radiogroup"
              aria-label="Context UI view mode (press Tab to cycle)"
              data-testid="selection-mode-group"
              className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-canvas/70 px-1 py-0.5"
            >
              <span
                className="mr-0.5 rounded border border-selection/30 bg-selection/10 px-1 py-0.2 font-mono text-[9px] tracking-tight text-selection/85"
                title="Press Tab to cycle between the 4 UI modes"
              >
                Tab ⇥
              </span>
              {CONTEXT_MODE_LIST.map((m) => {
                const active = viewMode === m.mode;
                return (
                  <button
                    key={m.mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={m.label}
                    data-testid={`selection-mode-${m.mode}`}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setViewMode(m.mode);
                      inputRef.current?.focus({ preventScroll: true });
                    }}
                    onDoubleClick={() => generate(m.mode)}
                    title={`${m.label} — ${m.hint} (Tab to select, Enter to generate)`}
                    className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10.5px] transition-all ${
                      active
                        ? "border border-selection/70 bg-selection/22 font-medium text-selection shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                        : "border border-transparent text-muted hover:bg-elevated/70 hover:text-text"
                    }`}
                  >
                    <ContextModeIcon mode={m.mode} className="size-3.5 shrink-0" />
                    {active && <span className="whitespace-nowrap text-[10px]">{m.shortLabel}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
