import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { Check, ChevronDown, Copy, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { formatSourceRef, type CanvasComponentType, type HealthState, type SourceRef } from "@contextpane/catalog";
import { usePopoverPinning } from "@/hooks/usePopoverPinning";
import { healthTone } from "@/lib/format";
import { cardCategory, catStyle, categoryColor } from "@/lib/provenance";
import { selectActiveTimelineSlice, selectConvergence, useWorkbench } from "@/store";
import { Pill, type Tone } from "../ui/Pill";

export interface CardTab {
  id: string;
  label: string;
  badge?: string | number;
}

export interface SectionProps {
  type: CanvasComponentType;
  icon: ReactNode;
  title: string;
  /** Word of the title rendered in the domain colour; defaults to the first word. */
  titleAccent?: string;
  state?: HealthState;
  /** Entity ids from the left pane that spawned this section (listed in the ⓘ popover). */
  triggeredBy: string[];
  /** One summary line under the title, always visible. */
  summary: ReactNode;
  /** The section's one action row, shown in the title row while expanded. */
  primaryAction?: ReactNode;
  /** Where the data came from (live tenant read or fixture). */
  source?: string;
  /** Git line provenance of the drifted resource or baseline rule; the ref opens the diff. */
  codeLens?: SourceRef | null;
  /** Short metadata on the provenance line (e.g. `3 profiles`). */
  footerMeta?: ReactNode;
  /** Long-form provenance shown only in the ⓘ popover (profile list, pool summary…). */
  details?: ReactNode;
  tabs: CardTab[];
  children: (tab: string) => ReactNode;
  /** Agent-made section (decision Q5): `✦` before the title and a dashed hairline above instead of the solid one. */
  synthesized?: boolean;
  /** Right-aligned controls in the count-toggles row under the title (e.g. a filter input); shown while expanded. */
  toolbar?: ReactNode;
  /**
   * WP6: an agent is regenerating this section. It stays mounted; the summary line ghosts in place
   * and the section is `aria-busy`. Cell-level ghosts inside the body use `<Ghost>`.
   */
  ghost?: boolean;
}

/** Card #1 (the primary diagnostic card) opens expanded by default; auto-collapses when a Selection Mini-Dashboard is open unless explicitly expanded. */
export function useExpanded(type: CanvasComponentType): boolean {
  return useWorkbench((s) => {
    const explicit = s.expanded[type];
    if (explicit !== undefined) return explicit;
    if (s.miniDashboards.length > 0) return false;
    if (type === "SynthesizedDynamicCard") return true;
    const canvasCards =
      s.layout?.components.filter(
        (c) => c.type !== "HoverDiagnosticPopover" && c.type !== "ActionApprovalDrawer",
      ) ?? [];
    return canvasCards.length === 1 || canvasCards[0]?.type === type;
  });
}

const shortId = (id: string) => (id.includes("@") ? id.split("@")[0]! : id.replace("[ContextPane-Demo] ", ""));

function statusLabel(state?: HealthState): string {
  if (state === "critical") return "Action needed";
  if (state === "warning") return "Warning";
  if (state === "healthy") return "Healthy";
  return "Unknown";
}

/** `Intune Policy Conflict` → ["Intune", " Policy Conflict"]; the accent word must start the title or appear in it. */
function splitTitle(title: string, accent?: string): [string, string, string] {
  if (accent) {
    const at = title.indexOf(accent);
    if (at >= 0) return [title.slice(0, at), accent, title.slice(at + accent.length)];
  }
  const space = title.indexOf(" ");
  return space > 0 ? ["", title.slice(0, space), title.slice(space)] : ["", title, ""];
}

/** Dashed agent rule (decision Q5): an agent-made module keeps its hairline frame, its top edge dashed. */
export const AGENT_RULE = "[border-top-style:dashed]";

/**
 * Bounded lens module (WP10): a 1px hairline frame on `bg-surface`, sitting on the `bg-ground` lens
 * list with a 10px gap. Nested blocks read `--module` for sticky table heads and hover masks.
 */
export const MODULE_FRAME = "rounded-md border border-hairline bg-surface [--module:var(--surface)]";

/**
 * Lens section, a bounded module: one 28px title row (domain word in `--cat`, status as dot + word,
 * chevron, one action row), a summary line, header count toggles, content that bleeds to the frame's
 * inner edge and one faint mono provenance line with an ⓘ popover. `isLinked` draws a 2px `--cat`
 * rule over the frame's left edge.
 */
export function Section({
  type,
  icon,
  title,
  titleAccent,
  state,
  triggeredBy,
  summary,
  primaryAction,
  source,
  codeLens,
  footerMeta,
  details,
  tabs,
  children,
  synthesized = false,
  toolbar,
  ghost = false,
}: SectionProps) {
  const setDiffOpen = useWorkbench((s) => s.setDiffOpen);
  const expanded = useExpanded(type);
  const toggle = useWorkbench((s) => s.toggleExpanded);
  const activeTab = useWorkbench((s) => s.cardTab[type]);
  const setTab = useWorkbench((s) => s.setCardTab);
  const linked = useWorkbench((s) => s.linked);
  const highlight = useWorkbench((s) => s.highlightComponent);
  const convergence = useWorkbench(selectConvergence);
  const convergeFlash = useWorkbench((s) => s.convergeFlash);
  const activeSlice = useWorkbench(selectActiveTimelineSlice);
  // A re-correlate or scope refine keeps sections mounted: the activity is a pulse on the header mark,
  // never a dim of the data, so a plan-step hover link does not dim the lens while it re-correlates.
  // Neither the frame nor the data body carries an opacity animation: a `both`-filled fade replayed
  // whenever the body remounted mid-correlate (layout swaps flip `useExpanded`) or `animate-pulse-ring`
  // came and went, left the table at a fractional opacity on a throttled frame clock, and its fill
  // silently overrode `opacity-55`.
  const correlating = useWorkbench((s) => s.canvasStatus === "loading" || s.refiningGoal);
  const category = cardCategory(type);
  const converged = Boolean(convergence);
  const isTimeTravel = Boolean(activeSlice && activeSlice.relativeLabel !== "NOW");
  const sliceCard = isTimeTravel ? activeSlice?.state.cards?.find((c) => c.cardId === type) : undefined;
  const effectiveState = sliceCard?.status ?? state;
  const sliceHealthy = isTimeTravel && effectiveState === "healthy";
  const healthy = converged || sliceHealthy;
  const tab = tabs.some((t) => t.id === activeTab) ? activeTab! : tabs[0]!.id;
  const isLinked = linked?.target === type;
  const dimmed = Boolean(linked) && !isLinked && !correlating;
  const flashing = highlight === type || (converged && convergeFlash);
  const tone: Tone = effectiveState ? healthTone(effectiveState) : "muted";
  const [before, accent, after] = splitTitle(title, titleAccent);
  const hasProvenance = Boolean(codeLens || source || footerMeta || details || triggeredBy.length > 0);

  return (
    <section
      id={`canvas-${type}`}
      data-component={type}
      data-expanded={expanded || undefined}
      data-converged={healthy || undefined}
      data-slice={activeSlice?.relativeLabel}
      data-linked={isLinked || undefined}
      data-ghost={ghost || undefined}
      aria-busy={ghost || undefined}
      data-correlating={correlating || undefined}
      style={catStyle(category, { ["--flash-color" as string]: converged && convergeFlash ? "var(--healthy)" : categoryColor(category) })}
      className={`relative scroll-mt-2 ${MODULE_FRAME} px-4 pt-1.5 pb-3 transition-opacity duration-150 ${isLinked ? "before:absolute before:-inset-y-px before:-left-px before:w-0.5 before:rounded-l-md before:bg-[var(--cat)]" : ""} ${dimmed ? "opacity-55" : ""} ${flashing || isLinked ? "animate-pulse-ring" : ""} ${synthesized ? AGENT_RULE : ""}`}
    >
      <header className={`flex items-center gap-2 ${synthesized ? "min-h-7 py-0.5" : "h-7"}`}>
        <span
          className={`inline-flex shrink-0 [&>svg]:size-3.5 ${healthy ? "text-healthy" : "text-[color:var(--cat)]"} ${correlating && !synthesized ? "motion-safe:animate-pulse-dot" : ""}`}
          title={correlating ? "Re-correlating: the values shown stay live until the new layout lands" : undefined}
        >
          {icon}
        </span>
        {synthesized && (
          <span
            aria-label="Agent-made section"
            title="Synthesized by the agent"
            className={`-mr-1 shrink-0 text-13 leading-none text-signal ${correlating ? "motion-safe:animate-pulse-dot" : ""}`}
            data-agent-mark=""
          >
            ✦
          </span>
        )}
        {/* Agent-written titles run long: they wrap to two lines instead of truncating. */}
        <h3 className={`min-w-0 text-13 font-medium text-text ${synthesized ? "line-clamp-2" : "truncate"}`} title={title}>
          {before}
          <span className="text-[color:var(--cat)]">{accent}</span>
          {after}
        </h3>
        {converged ? (
          <Pill variant="status" tone="healthy" mono={false} title={`${convergence!.remediationId} · converged ${convergence!.convergedAt.slice(11, 19)}Z`}>
            Healthy
          </Pill>
        ) : sliceHealthy ? (
          <Pill variant="status" tone="healthy" mono={false} title={sliceCard?.summary ?? activeSlice!.state.summary}>
            Healthy
          </Pill>
        ) : (
          effectiveState && (
            <Pill variant="status" tone={tone} mono={false}>
              {statusLabel(effectiveState)}
            </Pill>
          )
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {expanded && primaryAction}
          <button
            type="button"
            onClick={() => toggle(type, !expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand details"}
            title={expanded ? "Collapse" : "Expand details"}
            className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal"
          >
            <ChevronDown className={`size-3.5 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </header>

      <div className="line-clamp-2 text-13 text-muted">
        <Ghost pending={ghost}>{summary}</Ghost>
      </div>

      {expanded && (
        <div>
          {(tabs.length > 1 || toolbar) && (
            <div className="mt-1.5 flex min-w-0 items-center gap-3">
              {tabs.length > 1 && (
                // Header count toggles: text only, the active one carries a 2px signal underline.
                <div className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto [scrollbar-width:none]" role="tablist">
                  {tabs.map((t) => {
                    const active = t.id === tab;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setTab(type, t.id)}
                        className={`relative inline-flex h-6 shrink-0 items-center gap-1.5 text-12 whitespace-nowrap transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
                      >
                        {t.label}
                        {t.badge !== undefined && <span className="font-mono text-11 text-faint">{t.badge}</span>}
                        {active && <span aria-hidden className={`absolute inset-x-0 bottom-0 h-0.5 ${healthy ? "bg-healthy" : "bg-signal"}`} />}
                      </button>
                    );
                  })}
                </div>
              )}
              {toolbar && <div className="ml-auto flex shrink-0 items-center gap-1.5">{toolbar}</div>}
            </div>
          )}

          <div className={tabs.length > 1 || toolbar ? "mt-1" : "mt-2"}>{children(tab)}</div>

          {hasProvenance && (
            <ProvenanceLine
              type={type}
              source={source}
              codeLens={codeLens}
              footerMeta={footerMeta}
              details={details}
              triggeredBy={triggeredBy}
              onOpenDiff={() => setDiffOpen(true, type)}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** `source · fabrikam/disk-encryption.json:L7 · 3 profiles · ⓘ` — one faint mono line, details in the ⓘ popover. */
function ProvenanceLine({
  type,
  source,
  codeLens,
  footerMeta,
  details,
  triggeredBy,
  onOpenDiff,
}: {
  type: CanvasComponentType;
  source?: string;
  codeLens?: SourceRef | null;
  footerMeta?: ReactNode;
  details?: ReactNode;
  triggeredBy: string[];
  onOpenDiff: () => void;
}) {
  const shortRef = codeLens ? formatSourceRef({ ...codeLens, file: codeLens.file.split("/").slice(-2).join("/") }) : null;
  const sep = <span aria-hidden className="shrink-0 text-faint/70">·</span>;
  // Without a named data source the git ref is the source: label it so the line reads `source · file:L7`.
  const label = source ?? (codeLens ? "source" : undefined);
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-11 whitespace-nowrap text-faint" data-testid="card-footer">
      {label && <span className="shrink-0">{label}</span>}
      {label && codeLens && sep}
      {codeLens && (
        <button
          type="button"
          data-testid="codelens"
          onClick={onOpenDiff}
          title={`${formatSourceRef(codeLens)} @ ${codeLens.ref}: open the diff`}
          className="min-w-0 shrink truncate text-faint underline-offset-2 hover:text-signal hover:underline"
        >
          {shortRef}
        </button>
      )}
      {footerMeta && (label || codeLens) && sep}
      {footerMeta && <span className="min-w-0 truncate">{footerMeta}</span>}
      {(source || codeLens || footerMeta) && sep}
      <ProvenancePopover type={type} source={source} codeLens={codeLens} details={details} triggeredBy={triggeredBy} onOpenDiff={onOpenDiff} />
    </div>
  );
}

function ProvenancePopover({
  type,
  source,
  codeLens,
  details,
  triggeredBy,
  onOpenDiff,
}: {
  type: CanvasComponentType;
  source?: string;
  codeLens?: SourceRef | null;
  details?: ReactNode;
  triggeredBy: string[];
  onOpenDiff: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      if (next) {
        pinning.cancelClose();
        setOpen(true);
      } else pinning.requestClose();
    },
    placement: "top-start",
    middleware: [offset(6), flip({ fallbackPlacements: ["bottom-start", "top-end"] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const close = useCallback(() => setOpen(false), []);
  const pinning = usePopoverPinning(refs.floating, close);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 120, close: 160 }, handleClose: safePolygon({ buffer: 4 }) }),
    useClick(context),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label="Provenance details"
        data-provenance="info"
        className={`inline-flex shrink-0 items-center rounded transition-colors hover:text-text ${open ? "text-signal" : "text-faint"}`}
        {...getReferenceProps()}
      >
        <Info className="size-3" />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({ onPointerDownCapture: pinning.onPointerDownCapture })}
            data-hover-popover="true"
            data-provenance="popover"
            data-provenance-for={type}
            className="z-[9999] w-[340px] max-w-[calc(100vw-16px)] animate-fade-in rounded-md bg-raised p-3 text-12 whitespace-normal text-text shadow-popover select-text"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              {triggeredBy.length > 0 && (
                <>
                  <dt className="text-11 text-faint">Triggered by</dt>
                  <dd className="min-w-0 font-mono text-11 break-words" data-provenance="triggered-by" title={triggeredBy.join(", ")}>
                    {triggeredBy.map(shortId).join(", ")}
                  </dd>
                </>
              )}
              {codeLens && (
                <>
                  <dt className="text-11 text-faint">Code lens</dt>
                  <dd className="min-w-0">
                    <button type="button" onClick={onOpenDiff} className="text-left font-mono text-11 break-words text-signal hover:underline" data-provenance="codelens">
                      {formatSourceRef(codeLens)} @ {codeLens.ref}
                    </button>
                  </dd>
                </>
              )}
              {source && (
                <>
                  <dt className="text-11 text-faint">Source</dt>
                  <dd className="min-w-0 font-mono text-11 text-muted">{source}</dd>
                </>
              )}
            </dl>
            {details && <div className="mt-2 border-t border-hairline pt-2 text-11 text-muted">{details}</div>}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * Pending value (WP6 choreography). The old value keeps its box, so nothing shifts: its text turns
 * transparent and each line box paints as a `--raised` hairline bar that pulses until the agent's
 * value lands, then the new value fades in (150 ms, `--ease-ops`). Inline, so it wraps exactly like
 * the text it stands in for; no spinner.
 */
export function Ghost({ pending = false, children, className = "" }: { pending?: boolean; children: ReactNode; className?: string }) {
  const settled = useSettleFade(pending);
  return (
    <span
      data-ghost={pending ? "" : undefined}
      aria-busy={pending || undefined}
      className={`${pending ? GHOST_CLASS : settled ? "animate-fade-in" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Class string for a ghosted inline box (`Ghost` uses it; a block that cannot be wrapped in a span, a
 * table cell or a meter track, can apply it directly). Text and every descendant colour go transparent,
 * the line boxes keep a `--raised` fill (cloned per line) and pulse.
 */
export const GHOST_CLASS =
  "rounded-sm bg-raised text-transparent decoration-transparent box-decoration-clone select-none transition-colors duration-150 ease-[var(--ease-ops)] motion-safe:animate-pulse-dot [&_*]:border-transparent [&_*]:bg-transparent [&_*]:text-transparent [&_*]:decoration-transparent [&_svg]:opacity-0";

/** True for one render cycle after `pending` falls, so the refilled value fades in once. */
export function useSettleFade(pending: boolean): boolean {
  const was = useRef(pending);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (was.current && !pending) setSettled(true);
    if (pending) setSettled(false);
    was.current = pending;
  }, [pending]);
  return settled;
}

/**
 * A script or diff whose new text has not arrived: each old line keeps its indentation and becomes a
 * ghost bar of its own width, in the same mono metrics as `DiffView` / the rail's code block, so the
 * block keeps its height when the real lines replace it.
 */
export function GhostLines({ lines, className = "" }: { lines: string[]; className?: string }) {
  return (
    <pre aria-busy data-ghost="" className={`overflow-hidden bg-ground py-1 font-mono text-11 leading-[1.55] ${className}`}>
      {lines.map((line, i) => {
        const indent = /^\s*/.exec(line)?.[0] ?? "";
        const rest = line.slice(indent.length).trimEnd();
        return (
          <div key={i} className="px-3 whitespace-pre">
            {indent}
            {rest ? <span className={GHOST_CLASS}>{rest}</span> : " "}
          </div>
        );
      })}
    </pre>
  );
}

/** Small label/value row used in compact summaries. */
/** Label + mono value. `valueFirst` reads as a count in running text ("5 users"), not a key ("Users 5"). */
export function Stat({ label, children, tone, valueFirst = false }: { label: string; children: ReactNode; tone?: Tone; valueFirst?: boolean }) {
  const color = tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "healthy" ? "text-healthy" : "text-text";
  const value = <span className={`font-mono ${color}`}>{children}</span>;
  const name = <span className={valueFirst ? "text-muted" : "text-faint"}>{label}</span>;
  return (
    <span className="inline-flex items-baseline gap-1 text-12">
      {valueFirst ? (
        <>
          {value}
          {name}
        </>
      ) : (
        <>
          {name}
          {value}
        </>
      )}
    </span>
  );
}

/**
 * The only path renderer in tables: OMA-URI, registry key or file path as a dim prefix line
 * plus a bold, unwrapped leaf. The full path is in the tooltip and a copy button appears on hover.
 */
export function SmartTechPath({ path, badge, title, ghost = false }: { path: string; badge?: ReactNode; title?: string; ghost?: boolean }) {
  const [copied, setCopied] = useState(false);
  const parenMatch = path.match(/^(.*?)\s*(\([^)]+\))$/);
  const corePath = parenMatch ? parenMatch[1]!.trim() : path.trim();
  const lastSep = Math.max(corePath.lastIndexOf("/"), corePath.lastIndexOf("\\"));
  const rawPrefix = lastSep >= 0 ? corePath.slice(0, lastSep + 1) : "";
  const leaf = lastSep >= 0 ? corePath.slice(lastSep + 1) : corePath;

  let compactPrefix = rawPrefix;
  if (rawPrefix.length > 42) {
    const sep = rawPrefix.includes("\\") ? "\\" : "/";
    const parts = rawPrefix.split(/[\\/]/).filter(Boolean);
    if (parts.length > 4) {
      compactPrefix = `${parts[0]}${sep}…${sep}${parts.slice(-2).join(sep)}${sep}`;
    }
  }

  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(corePath).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="group/path min-w-0" title={title ?? path} data-testid="smart-tech-path">
      {(compactPrefix || badge) && (
        // The badge sits on the dim prefix line so the bold leaf keeps the full column width.
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-11 whitespace-nowrap text-faint" data-testid="smart-tech-prefix">
            <Ghost pending={ghost}>{compactPrefix}</Ghost>
          </span>
          {badge && <span className="ml-auto shrink-0 text-11">{badge}</span>}
        </div>
      )}
      <div className="relative flex min-w-0 items-center">
        <span className="truncate font-mono text-12 font-semibold whitespace-nowrap text-text" data-testid="smart-tech-leaf">
          <Ghost pending={ghost}>{leaf}</Ghost>
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${corePath}`}
          title="Copy full path"
          className="absolute top-1/2 right-0 -translate-y-1/2 bg-[var(--module,var(--ground))] pl-1 text-faint opacity-0 transition-opacity group-hover/path:opacity-100 hover:text-text focus-visible:opacity-100"
        >
          {copied ? <Check className="size-3 text-healthy" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Data table with the lens look: hairline-2 between rows, faint uppercase head on the enclosing
 * module's fill (`--module`). `bleed` pulls the table to the module frame's inner edges (negative
 * margin = the section's 16px padding) and pads the outer cells back in, so text stays on the grid.
 */
export function DataTable({
  head,
  rows,
  className = "",
  rowClassName,
  colWidths,
  cellPy = "py-1.5",
  bleed = false,
  onRowClick,
}: {
  head: string[];
  rows: ReactNode[][];
  className?: string;
  rowClassName?: (index: number) => string;
  colWidths?: string[];
  cellPy?: string;
  bleed?: boolean;
  /** Rows become buttons: a lens row click steers the fix (U-1). */
  onRowClick?: (index: number) => void;
}) {
  const edge = bleed ? "first:pl-4 last:pr-4" : "first:pl-0 last:pr-0";
  return (
    <div className={`overflow-x-auto ${bleed ? "-mx-4" : ""} ${className}`}>
      <table className={`w-full text-12 ${colWidths ? "table-fixed" : ""}`}>
        {colWidths && (
          <colgroup>
            {colWidths.map((w, idx) => (
              <col key={idx} style={{ width: w }} />
            ))}
          </colgroup>
        )}
        <thead className="sticky top-0 z-10 bg-[var(--module,var(--ground))] text-11 tracking-wider text-faint uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} className={`px-2.5 py-1 text-left font-medium whitespace-nowrap shadow-[inset_0_-1px_0_var(--hairline-2)] ${edge}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-2">
          {rows.map((r, i) => (
            <tr
              key={i}
              className={`align-top transition-opacity ${onRowClick ? "cursor-pointer hover:bg-raised focus-visible:outline-1 focus-visible:outline-signal" : ""} ${rowClassName?.(i) ?? ""}`}
              {...(onRowClick
                ? {
                    onClick: () => onRowClick(i),
                    onKeyDown: (e: ReactKeyboardEvent<HTMLTableRowElement>) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(i);
                      }
                    },
                    tabIndex: 0,
                    role: "button",
                    "data-testid": `lens-row-${i}`,
                  }
                : {})}
            >
              {r.map((cell, j) => (
                <td key={j} className={`px-2.5 ${cellPy} ${edge}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
