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
  tabs: CardTab[];
  children: (tab: string) => ReactNode;
}

/** A scenario with a single card opens it expanded; with several, every card starts compact. */
function useExpanded(type: CanvasComponentType): boolean {
  return useWorkbench((s) => {
    const explicit = s.expanded[type];
    if (explicit !== undefined) return explicit;
    return (s.layout?.components.filter((c) => c.type !== "HoverDiagnosticPopover" && c.type !== "ActionApprovalDrawer").length ?? 0) === 1;
  });
}

const shortId = (id: string) => (id.includes("@") ? id.split("@")[0]! : id.replace("[ContextPane-Demo] ", ""));

/**
 * Shared chrome for every canvas card: semantic provenance accent (border-l-4 in the
 * colour of the left-pane entities that spawned it), compact by default, tabs on
 * expand, a coloured ring while a linked entity is hovered, emerald once remediated.
 */
export function CardShell({ type, icon, title, state, triggeredBy, summary, primaryAction, source, codeLens, tabs, children }: CardShellProps) {
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
      <header className="flex items-center gap-2">
        <span className={`[&>svg]:size-4 ${converged || sliceHealthy ? "text-healthy" : CAT_TEXT}`}>{icon}</span>
        <h3 className="max-w-[50%] shrink-0 truncate text-[13px] font-semibold">{title}</h3>
        {converged ? (
          <Pill tone="healthy" icon={<CircleCheckBig />} title={`${convergence!.remediationId} · ${convergence!.execution} · converged ${convergence!.convergedAt.slice(11, 19)}Z, 0 LLM tokens`}>
            Compliant / Resolved
          </Pill>
        ) : sliceHealthy ? (
          <Pill tone="healthy" icon={<CircleCheckBig />} title={`${activeSlice!.label} · ${activeSlice!.relativeLabel} · ${sliceCard?.summary ?? activeSlice!.state.summary}`}>
            compliant · {activeSlice!.relativeLabel}
          </Pill>
        ) : isTimeTravel && effectiveState ? (
          <Pill tone={tone} title={`${activeSlice!.label} · ${activeSlice!.relativeLabel} · ${sliceCard?.summary ?? activeSlice!.state.summary}`}>
            {effectiveState} · {activeSlice!.relativeLabel}
          </Pill>
        ) : (
          effectiveState && <Pill tone={tone}>{effectiveState}</Pill>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {triggeredBy.length > 0 && (
            <span
              className={`hidden h-5 min-w-0 items-center gap-1 truncate rounded border px-1.5 text-[10.5px] lg:inline-flex ${CAT_CHIP}`}
              title={`Triggered by: ${triggeredBy.join(", ")}`}
            >
              <Link2 className="size-3 shrink-0" />
              <span className="truncate">Triggered by: {triggeredBy.slice(0, 2).map(shortId).join(", ")}{triggeredBy.length > 2 ? ` +${triggeredBy.length - 2}` : ""}</span>
            </span>
          )}
          {codeLens && (
            <button
              type="button"
              data-testid="codelens"
              onClick={() => setDiffOpen(true, type)}
              title={`${formatSourceRef(codeLens)} @ ${codeLens.ref}: open the diff`}
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border-subtle px-1.5 font-mono text-[10px] text-faint hover:border-border hover:text-text"
            >
              <FileCode2 className="size-3 shrink-0" />
              <span className="truncate">{formatSourceRef({ ...codeLens, file: codeLens.file.split("/").slice(-2).join("/") })}</span>
            </button>
          )}
          {source && <span className="shrink-0 font-mono text-[10px] text-faint">{source}</span>}
        </div>
      </header>

      <div className="mt-1.5">{summary}</div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {primaryAction}
        <button
          type="button"
          onClick={() => toggle(type, !expanded)}
          aria-expanded={expanded}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted hover:bg-surface hover:text-text"
        >
          {expanded ? "Collapse" : "Expand Details"}
          <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {expanded && (
        <div className="mt-2 animate-fade-in border-t border-border-subtle pt-2">
          {tabs.length > 1 && (
            <div className="mb-2 flex gap-1 border-b border-border-subtle" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === tab}
                  onClick={() => setTab(type, t.id)}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2 py-1 text-[11.5px] ${t.id === tab ? "border-[var(--cat)] text-text" : "border-transparent text-muted hover:text-text"}`}
                >
                  {t.label}
                  {t.badge !== undefined && <span className="rounded bg-surface px-1 font-mono text-[10px] text-faint">{t.badge}</span>}
                </button>
              ))}
            </div>
          )}
          {children(tab)}
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

/** Generic data table with the canvas look. */
export function DataTable({ head, rows, className = "", rowClassName }: { head: string[]; rows: ReactNode[][]; className?: string; rowClassName?: (index: number) => string }) {
  return (
    <div className={`overflow-x-auto rounded-md border border-border-subtle ${className}`}>
      <table className="w-full text-[11.5px]">
        <thead className="bg-surface text-[10px] tracking-wider text-faint uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-border-subtle align-middle transition-opacity ${rowClassName?.(i) ?? ""}`}>
              {r.map((cell, j) => (
                <td key={j} className="px-2.5 py-1.5">
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
