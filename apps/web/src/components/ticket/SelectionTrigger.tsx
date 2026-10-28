import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { CornerDownLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CONTEXT_VIEW_MODES, SELECTION_MAX_CHARS, SELECTION_MIN_CHARS, type ContextViewMode } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { CONTEXT_MODE_LIST, CONTEXT_MODE_META, ContextModeIcon } from "../ui/ContextModeIcons";

interface Pending {
  text: string;
  rect: DOMRect;
  insidePopover?: boolean;
}

function isWithinSelectableSurface(node: Node | null, rootEl: HTMLElement | null): boolean {
  if (!node) return false;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return false;
  if (el.closest('[data-selection-bar="true"], [data-testid="selection-trigger-bar"]')) return false;
  if (rootEl && rootEl.contains(el)) return true;
  if (el.closest('[data-hover-popover="true"], [data-testid="hover-popover"], [data-testid="permission-hover-popover"]')) {
    return true;
  }
  return false;
}

/**
 * Wraps the ticket / anomaly body. When the engineer highlights 3-120 characters inside it (or inside
 * any hover popover portal) a floating action bar appears right above the selection:
 * - Left: `✨ Generate Context UI for "…"`
 * - Middle: auto-focused inline refinement input (e.g. "other apps with the same owner") — press Enter to generate
 * - Right: 4 VectorCraft SVG view-mode icons (Dashboard, Full Card, Quick Comparison, Blast Radius) — press Tab to cycle
 */
export function SelectionTrigger({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refinement, setRefinement] = useState("");
  const [viewMode, setViewMode] = useState<ContextViewMode>("dashboard");
  const explore = useWorkbench((s) => s.exploreSelection);
  const prewarmSelection = useWorkbench((s) => s.prewarmSelectionExplore);
  const discardSpeculative = useWorkbench((s) => s.discardSpeculativeSelection);
  const status = useWorkbench((s) => s.exploreStatus);
  const debounceRef = useRef<number | null>(null);

  const { refs, floatingStyles } = useFloating({
    open: Boolean(pending),
    placement: pending?.insidePopover ? "bottom-start" : "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const readSelection = useCallback(() => {
    const activeEl = document.activeElement;
    if (
      activeEl !== inputRef.current &&
      (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || activeEl?.getAttribute("contenteditable") === "true")
    ) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!isWithinSelectableSurface(range.commonAncestorContainer, rootRef.current)) return;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < SELECTION_MIN_CHARS || text.length > SELECTION_MAX_CHARS) return setPending(null);
    const commonEl =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const popoverEl = commonEl?.closest('[data-hover-popover="true"], [data-testid="hover-popover"], [data-testid="permission-hover-popover"]');
    const rect = popoverEl ? popoverEl.getBoundingClientRect() : range.getBoundingClientRect();
    if (!rect.width && !rect.height) return setPending(null);
    setPending({ text, rect, insidePopover: Boolean(popoverEl) });
    setRefinement("");
    setViewMode("dashboard");
    if (/@|[0-9a-f]{8}-[0-9a-f]{4}/i.test(text)) {
      void prewarmSelection(text, { viewMode: "dashboard" });
    }
  }, [prewarmSelection]);

  // Listen for mouseup and keyup on document so selections inside portal hover popovers also trigger the floating bar
  useEffect(() => {
    const onDocMouseUp = (e: MouseEvent) => {
      const pill = refs.floating.current;
      if (pill && pill.contains(e.target as Node)) return;
      readSelection();
    };
    const onDocKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey) readSelection();
    };
    document.addEventListener("mouseup", onDocMouseUp);
    document.addEventListener("keyup", onDocKeyUp);
    return () => {
      document.removeEventListener("mouseup", onDocMouseUp);
      document.removeEventListener("keyup", onDocKeyUp);
    };
  }, [readSelection, refs.floating]);

  // Silent kinematic pre-fetch on selectionchange ONLY for literal UPN/GUID selections without refinement
  useEffect(() => {
    const onSelectionChange = () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const activeEl = document.activeElement;
      if (
        activeEl !== inputRef.current &&
        (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || activeEl?.getAttribute("contenteditable") === "true")
      ) {
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!isWithinSelectableSurface(range.commonAncestorContainer, rootRef.current)) return;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < SELECTION_MIN_CHARS || text.length > SELECTION_MAX_CHARS) return;
      if (!/@|[0-9a-f]{8}-[0-9a-f]{4}/i.test(text) || refinement.trim().length > 0) return;
      debounceRef.current = window.setTimeout(() => {
        void prewarmSelection(text, { viewMode });
      }, 90);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [prewarmSelection, viewMode, refinement]);

  useEffect(() => {
    if (!pending) return;
    const rect = pending.rect;
    refs.setPositionReference({ getBoundingClientRect: () => rect, contextElement: rootRef.current ?? undefined });
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pending, refs]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const pill = refs.floating.current;
      if (pill && pill.contains(e.target as Node)) return;
      setPending((prev) => {
        if (prev) discardSpeculative();
        return null;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending((prev) => {
          if (prev) discardSpeculative();
          return null;
        });
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [refs.floating, discardSpeculative]);

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
      discardSpeculative();
      setPending(null);
    }
  };

  const activeModeMeta = CONTEXT_MODE_META[viewMode];

  return (
    <>
      <div
        ref={rootRef}
        onMouseUp={readSelection}
        onKeyUp={(e) => (e.shiftKey ? readSelection() : undefined)}
        data-testid="selection-surface"
        className={className}
        style={style}
      >
        {children}
      </div>
      {pending && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            onKeyDown={onBarKeyDown}
            onPointerEnter={() =>
              void prewarmSelection(pending.text, {
                viewMode,
                ...(refinement.trim() ? { refinementText: refinement.trim() } : {}),
              })
            }
            data-selection-bar="true"
            data-testid="selection-trigger-bar"
            className="z-[10001] inline-flex max-w-[96vw] animate-fade-in flex-wrap items-center gap-1 rounded-lg border border-selection/65 bg-[#0B1120]/96 p-1 text-[11.5px] text-selection shadow-popover ring-1 ring-white/10 backdrop-blur-xl"
          >
            {/* Primary Generate button */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => generate()}
              disabled={status === "loading"}
              data-testid="selection-trigger"
              data-selection-trigger-button="true"
              title={`Generate ${activeModeMeta.label} for "${pending.text}"${refinement.trim() ? ` + "${refinement.trim()}"` : ""} (Enter)`}
              className="inline-flex h-6 max-w-[290px] items-center gap-1.5 rounded-md px-2 font-medium text-selection transition-colors hover:bg-selection/18 disabled:opacity-60"
            >
              <Sparkles className="size-3.5 shrink-0" />
              <span data-testid="selection-trigger-button" className="truncate">
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
                    className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] transition-all ${
                      active
                        ? "border border-selection/70 bg-selection/22 font-medium text-selection shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                        : "border border-transparent text-muted hover:bg-elevated/70 hover:text-text"
                    }`}
                  >
                    <ContextModeIcon mode={m.mode} className="size-3.5 shrink-0" />
                    {active && <span className="whitespace-nowrap text-[11px]">{m.shortLabel}</span>}
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
