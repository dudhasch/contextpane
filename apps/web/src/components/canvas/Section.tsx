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
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
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

/**
 * Borderless lens section (decision Q3): no box, no fill, no accent bar. One 28px title row
 * (domain word in `--cat`, status as dot + word, chevron, one action row), a summary line,
 * header count toggles, full-bleed content and one faint mono provenance line with an ⓘ popover.
 * Sections are separated by the list's hairline; `isLinked` draws a 2px `--cat` rule on the left.
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
  const category = cardCategory(type);
  const converged = Boolean(convergence);
  const isTimeTravel = Boolean(activeSlice && activeSlice.relativeLabel !== "NOW");
  const sliceCard = isTimeTravel ? activeSlice?.state.cards?.find((c) => c.cardId === type) : undefined;
  const effectiveState = sliceCard?.status ?? state;
  const sliceHealthy = isTimeTravel && effectiveState === "healthy";
  const healthy = converged || sliceHealthy;
  const tab = tabs.some((t) => t.id === activeTab) ? activeTab! : tabs[0]!.id;
  const isLinked = linked?.target === type;
  const dimmed = Boolean(linked) && !isLinked;
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
      style={catStyle(category, { ["--flash-color" as string]: converged && convergeFlash ? "var(--healthy)" : categoryColor(category) })}
      className={`relative scroll-mt-2 bg-ground px-4 pt-1.5 pb-3 animate-fade-in transition-opacity duration-150 ${isLinked ? "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--cat)]" : ""} ${dimmed ? "opacity-55" : ""} ${flashing || isLinked ? "animate-pulse-ring" : ""}`}
    >
      <header className="flex h-7 items-center gap-2">
        <span className={`inline-flex shrink-0 [&>svg]:size-3.5 ${healthy ? "text-healthy" : "text-[color:var(--cat)]"}`}>{icon}</span>
        <h3 className="min-w-0 truncate text-13 font-medium text-text" title={title}>
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

      <div className="line-clamp-2 text-13 text-muted">{summary}</div>

      {expanded && (
        <div className="animate-fade-in">
          {tabs.length > 1 && (
            // Header count toggles: text only, the active one carries a 2px signal underline.
            <div className="mt-1.5 flex min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none]" role="tablist">
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

          <div className={tabs.length > 1 ? "mt-1" : "mt-2"}>{children(tab)}</div>

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

/** Small label/value row used in compact summaries. */
export function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: Tone }) {
  const color = tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "healthy" ? "text-healthy" : "text-text";
  return (
    <span className="inline-flex items-baseline gap-1 text-12">
      <span className="text-faint">{label}</span>
      <span className={`font-mono ${color}`}>{children}</span>
    </span>
  );
}

/**
 * The only path renderer in tables: OMA-URI, registry key or file path as a dim prefix line
 * plus a bold, unwrapped leaf. The full path is in the tooltip and a copy button appears on hover.
 */
export function SmartTechPath({ path, badge, title }: { path: string; badge?: ReactNode; title?: string }) {
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
            {compactPrefix}
          </span>
          {badge && <span className="ml-auto shrink-0 text-11">{badge}</span>}
        </div>
      )}
      <div className="relative flex min-w-0 items-center">
        <span className="truncate font-mono text-12 font-semibold whitespace-nowrap text-text" data-testid="smart-tech-leaf">
          {leaf}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${corePath}`}
          title="Copy full path"
          className="absolute top-1/2 right-0 -translate-y-1/2 bg-ground pl-1 text-faint opacity-0 transition-opacity group-hover/path:opacity-100 hover:text-text focus-visible:opacity-100"
        >
          {copied ? <Check className="size-3 text-healthy" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Data table with the lens look: no box, hairline-2 between rows, faint uppercase head.
 * `bleed` pulls the table to the section's edges (negative margin = the section's 16px padding)
 * and pads the outer cells back in, so text stays on the section's grid.
 */
export function DataTable({
  head,
  rows,
  className = "",
  rowClassName,
  colWidths,
  cellPy = "py-1.5",
  bleed = false,
}: {
  head: string[];
  rows: ReactNode[][];
  className?: string;
  rowClassName?: (index: number) => string;
  colWidths?: string[];
  cellPy?: string;
  bleed?: boolean;
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
        <thead className="sticky top-0 z-10 bg-ground text-11 tracking-wider text-faint uppercase">
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
            <tr key={i} className={`align-top transition-opacity ${rowClassName?.(i) ?? ""}`}>
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
