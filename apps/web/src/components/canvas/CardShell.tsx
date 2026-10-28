import { ChevronDown, CircleCheckBig, FileCode2, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { CATEGORY_META, formatSourceRef, type CanvasComponentType, type HealthState, type SourceRef } from "@contextpane/catalog";
import { healthTone } from "@/lib/format";
import { CAT_CHIP, CAT_TEXT, cardCategory, catStyle } from "@/lib/provenance";
import { selectActiveTimelineSlice, selectConvergence, useWorkbench } from "@/store";
import { Pill, type Tone } from "../ui/Pill";

export interface CardTab {
  id: string;
  label: string;
  badge?: string | number;
}

interface CardShellProps {
  type: CanvasComponentType;
  icon: ReactNode;
  title: string;
  state?: HealthState;
  /** Entity ids from the left pane that spawned this card. */
  triggeredBy: string[];
  /** Crisp two-line summary, always visible. */
  summary: ReactNode;
  /** The card's primary action, shown in the compact state. */
  primaryAction?: ReactNode;
  /** Where the data came from (live tenant read or fixture). */
  source?: string;
  /** Git line provenance of the drifted resource or baseline rule; the badge opens the card's diff. */
  codeLens?: SourceRef | null;
  /** Compact 1-line metadata rendered inside the unified single-row card footer below the table. */
  footerMeta?: ReactNode;
  tabs: CardTab[];
  children: (tab: string) => ReactNode;
}

/** Card #1 (the primary diagnostic card) opens expanded by default; auto-collapses when a Selection Mini-Dashboard is open unless explicitly expanded. */
function useExpanded(type: CanvasComponentType): boolean {
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
  if (state === "critical") return "Action Needed";
  if (state === "warning") return "Warning";
  if (state === "healthy") return "Healthy";
  return "Unknown";
}

/**
 * Shared chrome for every canvas card: semantic provenance accent (border-l-4 in the
 * colour of the left-pane entities that spawned it), ultra-clean compact header & 1-line
 * subtitle by default, technical provenance tags and tabs inside the expanded body.
 */
export function CardShell({ type, icon, title, state, triggeredBy, summary, primaryAction, source, codeLens, footerMeta, tabs, children }: CardShellProps) {
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
  const tab = tabs.some((t) => t.id === activeTab) ? activeTab! : tabs[0]!.id;
  const isLinked = linked?.target === type;
  const dimmed = Boolean(linked) && !isLinked;
  const flashing = highlight === type || (converged && convergeFlash);
  const tone: Tone = effectiveState ? healthTone(effectiveState) : "muted";
  const borderClass =
    converged || sliceHealthy
      ? "border-l-healthy"
      : isTimeTravel && effectiveState === "critical"
        ? "border-l-critical"
        : isTimeTravel && effectiveState === "warning"
          ? "border-l-warning"
          : "border-l-[var(--cat)]";

  return (
    <section
      id={`canvas-${type}`}
      data-component={type}
      data-expanded={expanded || undefined}
      data-converged={converged || sliceHealthy || undefined}
      data-slice={activeSlice?.relativeLabel}
      style={catStyle(category, { ["--flash-color" as string]: converged && convergeFlash ? "var(--color-healthy)" : CATEGORY_META[category].color })}
      className={`card scroll-mt-2 animate-fade-in border-l-4 transition-[opacity,box-shadow] duration-150 ${borderClass} ${isLinked ? "ring-2 ring-[var(--cat)]" : ""} ${dimmed ? "opacity-55" : ""} ${flashing ? "animate-pulse-ring" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className={`shrink-0 [&>svg]:size-4 ${converged || sliceHealthy ? "text-healthy" : CAT_TEXT}`}>{icon}</span>
        <h3 className="min-w-0 truncate text-[13px] font-semibold">{title}</h3>
        {converged ? (
          <Pill tone="healthy" icon={<CircleCheckBig />} mono={false} title={`${convergence!.remediationId} · converged ${convergence!.convergedAt.slice(11, 19)}Z`}>
            Healthy
          </Pill>
        ) : sliceHealthy ? (
          <Pill tone="healthy" icon={<CircleCheckBig />} mono={false} title={sliceCard?.summary ?? activeSlice!.state.summary}>
            Healthy
          </Pill>
        ) : (
          effectiveState && (
            <Pill tone={tone} mono={false}>
              {statusLabel(effectiveState)}
            </Pill>
          )
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!expanded && primaryAction}
          <button
            type="button"
            onClick={() => toggle(type, !expanded)}
            aria-expanded={expanded}
            className="inline-flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted hover:bg-surface hover:text-text"
          >
            {expanded ? "Collapse" : "Expand Details"}
            <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </header>

      <div className="mt-1 text-[12.5px] leading-snug text-muted">{summary}</div>

      {expanded && (
        <div className="mt-2 animate-fade-in">
          <div className="mb-2 flex flex-nowrap items-center justify-between gap-2 border-y border-border-subtle py-1">
            {tabs.length > 1 ? (
              <div className="flex gap-1" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tab}
                    onClick={() => setTab(type, t.id)}
                    className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2 py-1 text-[11.5px] ${t.id === tab ? `${converged || sliceHealthy ? "border-healthy" : "border-[var(--cat)]"} font-medium text-text` : "border-transparent text-muted hover:text-text"}`}
                  >
                    {t.label}
                    {t.badge !== undefined && <span className="rounded bg-surface px-1 font-mono text-[10px] text-faint">{t.badge}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div />
            )}
            {primaryAction && <div className="ml-auto flex shrink-0 items-center gap-1.5">{primaryAction}</div>}
          </div>

          {children(tab)}

          {(codeLens || source || footerMeta || triggeredBy.length > 0) && (
            <footer className="mt-2 flex items-center justify-between gap-2 overflow-hidden whitespace-nowrap border-t border-border-subtle/70 pt-1.5 text-[11px] text-faint" data-testid="card-footer">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
                {codeLens && (
                  <button
                    type="button"
                    data-testid="codelens"
                    onClick={() => setDiffOpen(true, type)}
                    title={`${formatSourceRef(codeLens)} @ ${codeLens.ref}: open the diff`}
                    className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border-subtle px-1.5 font-mono text-[10px] text-faint hover:border-border hover:text-text"
                  >
                    <FileCode2 className="size-3 shrink-0" />
                    <span className="truncate">Source: {formatSourceRef({ ...codeLens, file: codeLens.file.split("/").slice(-2).join("/") })}</span>
                  </button>
                )}
                {source && <span className="shrink-0 font-mono text-[10px] text-faint">{source}</span>}
                {footerMeta && <span className="min-w-0 truncate text-[11px] text-muted">{footerMeta}</span>}
              </div>
              {triggeredBy.length > 0 && (
                <span
                  className={`inline-flex h-5 shrink-0 items-center gap-1 truncate rounded border px-1.5 text-[10px] ${converged || sliceHealthy ? "border-healthy/35 bg-healthy/10 text-healthy" : CAT_CHIP}`}
                  title={`Triggered by: ${triggeredBy.join(", ")}`}
                >
                  <Link2 className="size-3 shrink-0" />
                  <span className="truncate">
                    Triggered by: {triggeredBy.slice(0, 2).map(shortId).join(", ")}
                    {triggeredBy.length > 2 ? ` +${triggeredBy.length - 2}` : ""}
                  </span>
                </span>
              )}
            </footer>
          )}
        </div>
      )}
    </section>
  );
}

/** Small label/value row used in compact summaries. */
export function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: Tone }) {
  const color = tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "healthy" ? "text-healthy" : "text-text";
  return (
    <span className="inline-flex items-baseline gap-1 text-[11.5px]">
      <span className="text-faint">{label}</span>
      <span className={`font-mono ${color}`}>{children}</span>
    </span>
  );
}

/**
 * Formats OMA-URI, registry keys, or technical file paths into a compact muted prefix line
 * + bold leaf identifier with whitespace-nowrap and a full hover tooltip, preventing mid-word character splits.
 */
export function SmartTechPath({ path, badge }: { path: string; badge?: ReactNode }) {
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

  return (
    <div className="min-w-0 leading-tight" title={path} data-testid="smart-tech-path">
      {compactPrefix && (
        <div className="truncate font-mono text-[10px] leading-tight whitespace-nowrap text-faint" data-testid="smart-tech-prefix">
          {compactPrefix}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[11px] font-semibold leading-snug whitespace-nowrap text-text" data-testid="smart-tech-leaf">
          {leaf}
        </span>
        {badge && <span className="shrink-0">{badge}</span>}
      </div>
    </div>
  );
}

/** Generic data table with the canvas look and optional proportioned column widths. */
export function DataTable({
  head,
  rows,
  className = "",
  rowClassName,
  colWidths,
  cellPy = "py-2",
}: {
  head: string[];
  rows: ReactNode[][];
  className?: string;
  rowClassName?: (index: number) => string;
  colWidths?: string[];
  cellPy?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-md border border-border-subtle ${className}`}>
      <table className={`w-full text-[11.5px] ${colWidths ? "table-fixed" : ""}`}>
        {colWidths && (
          <colgroup>
            {colWidths.map((w, idx) => (
              <col key={idx} style={{ width: w }} />
            ))}
          </colgroup>
        )}
        <thead className="sticky top-0 z-10 bg-slate-950/95 text-[10px] tracking-wider text-faint uppercase backdrop-blur-sm">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-border-subtle align-middle transition-opacity ${rowClassName?.(i) ?? ""}`}>
              {r.map((cell, j) => (
                <td key={j} className={`px-2.5 ${cellPy}`}>
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
