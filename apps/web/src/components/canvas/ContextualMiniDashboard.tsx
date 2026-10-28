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
import { AlertTriangle, CheckCircle2, ClipboardCopy, ExternalLink, GitCompare, Info, ShieldAlert, Sparkles, Terminal, Wrench, X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ContextViewMode, ContextualMiniDashboard as Card, MetricTone } from "@contextpane/catalog";
import { usePopoverPinning } from "@/hooks/usePopoverPinning";
import { fmtMs, provenanceBadge } from "@/lib/format";
import { catStyle } from "@/lib/provenance";
import { selectActiveTimelineSlice, useWorkbench, type MiniDashboardEntry, type RowFilter } from "@/store";
import { Button } from "../ui/Button";
import { CONTEXT_MODE_LIST, CONTEXT_MODE_META, ContextModeIcon } from "../ui/ContextModeIcons";
import { Pill, TONE_DOT, TONE_TEXT, type Tone } from "../ui/Pill";
import { AGENT_RULE, DataTable, MODULE_FRAME } from "./Section";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const TONE: Record<MetricTone, Tone> = { default: "muted", warning: "warning", critical: "critical", success: "healthy" };
const TONE_VALUE: Record<MetricTone, string> = { default: "text-text", warning: "text-warning", critical: "text-critical", success: "text-healthy" };
const TONE_BAR: Record<MetricTone, string> = { default: "bg-signal", warning: "bg-warning", critical: "bg-critical", success: "bg-healthy" };

const BAD = /noncompliant|conflict|error|drifted|orphaned|failure|expired|rogue|critical|high|report|unverified|disabled|missing|countviolation|shadow|quotaexceeded|near limit|high usage|rejected|mismatch|blocking|permanent|standing|inherited/i;
const GOOD = /^(compliant|active|reclaimed|success|in-sync|available|enabled|low|verified|healthy|allow|golden.*|\d+\s+vcpus?\s+free|active entitlement group|.*pim eligible.*|.*workload identity.*|.*least-privilege.*)$/i;

function classify(row: Record<string, unknown>): RowStatus {
  const values = Object.values(row).map((v) => String(v ?? ""));
  if (values.some((v) => BAD.test(v))) return "bad";
  if (values.some((v) => GOOD.test(v))) return "good";
  return "other";
}

function cellTone(text: string): Tone {
  if (BAD.test(text)) return "critical";
  if (GOOD.test(text) || /golden|oidc|healthy/i.test(text)) return "healthy";
  return "muted";
}

const STATUS_TONE: Record<RowStatus, Tone> = { bad: "critical", good: "healthy", other: "warning" };

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const cellText = (v: unknown, bool: [string, string] = ["yes", "no"]): string =>
  v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? bool[0] : bool[1]) : String(v);

/** Badge columns carry their colour on the value itself (no filled pill, no status column). */
function ValueCell({ text, badge, mono }: { text: string; badge?: boolean; mono?: boolean }) {
  const tone = badge ? cellTone(text) : null;
  // ISO timestamps read as `10-26 07:58:12` in the narrow lens; the full value stays in the tooltip.
  const display = ISO_TS.test(text) ? text.slice(5, 19).replace("T", " ") : text;
  return (
    <span className={`block truncate whitespace-nowrap ${mono || badge ? "font-mono" : ""} ${tone && tone !== "muted" ? TONE_TEXT[tone] : "text-text"}`} title={text}>
      {display}
    </span>
  );
}

/** Hairline sub-head inside a mode body: faint uppercase label, count in mono, hairline-2 above. */
function SubHead({ label, count, aside, tone }: { label: ReactNode; count?: ReactNode; aside?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 border-t border-hairline-2 pt-2 pb-1">
      <span className={`min-w-0 truncate text-11 font-medium tracking-wider uppercase ${tone ? TONE_TEXT[tone] : "text-faint"}`}>{label}</span>
      {count !== undefined && <span className="shrink-0 font-mono text-11 text-faint">{count}</span>}
      {aside && <span className="ml-auto min-w-0 truncate font-mono text-11 text-faint">{aside}</span>}
    </div>
  );
}

/** Stat row: label text-11 faint, value text-15 mono, hairline-2 between stats, no tiles. */
const STAT_CELL = "min-w-0 flex-1 px-3 first:pl-0 last:pr-0";

function StatCell({ label, value, valueClass = "text-text", hint }: { label: string; value: ReactNode; valueClass?: string; hint?: ReactNode }) {
  return (
    <div className={STAT_CELL}>
      <div className="truncate text-11 text-faint" title={label}>
        {label}
      </div>
      <div className={`truncate font-mono text-15 tabular-nums ${valueClass}`}>{value}</div>
      {hint && <div className="truncate text-11 text-muted">{hint}</div>}
    </div>
  );
}

/** ⓘ hover/click popover (floating-ui, same policy as the provenance popover). */
function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      if (next) {
        pinning.cancelClose();
        setOpen(true);
      } else pinning.requestClose();
    },
    placement: "bottom-start",
    middleware: [offset(6), flip({ fallbackPlacements: ["top-start", "bottom-end"] }), shift({ padding: 8 })],
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
        aria-label={label}
        className={`inline-flex shrink-0 items-center rounded transition-colors hover:text-text ${open ? "text-signal" : "text-faint"}`}
        {...getReferenceProps()}
      >
        <Info className="size-3.5" />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({ onPointerDownCapture: pinning.onPointerDownCapture })}
            data-hover-popover="true"
            className="z-[9999] w-[360px] max-w-[calc(100vw-16px)] animate-fade-in rounded-md bg-raised p-3 text-12 whitespace-normal text-text shadow-popover select-text"
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/** `✦ Title "selection"`: the title's first word in `--cat` (selection = signal). */
function splitFirstWord(title: string): [string, string] {
  const space = title.indexOf(" ");
  return space > 0 ? [title.slice(0, space), title.slice(space)] : [title, ""];
}

/**
 * A ContextualMiniDashboard spawned from highlighted text, rendered as a borderless agent section
 * (✦ + dashed hairline above). 4 VectorCraft view modes as header text toggles:
 * - `dashboard`: stat row, proportional breakdown, filterable table
 * - `full-card`: complete table, entity inspector rows and the remediation script
 * - `comparison`: drifted row vs a healthy row of the same result, peer columns
 * - `blast-radius`: rows grouped into a 4-stage dependency chain
 */
export function ContextualMiniDashboardCard({ entry }: { entry: MiniDashboardEntry }) {
  const rawCard: Card = entry.card;
  const activeSlice = useWorkbench(selectActiveTimelineSlice);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const converged = useWorkbench((s) => Boolean(s.convergence[s.scenarioId]));
  const isBaselineSlice = activeSlice?.kind === "baseline";
  const isPostFixSlice = activeSlice?.kind === "counterfactual" || (converged && (!activeSlice || activeSlice.relativeLabel === "NOW"));

  const card: Card = useMemo(() => {
    if (!isBaselineSlice && !isPostFixSlice) return rawCard;
    const preTimes = ["07:44:12", "07:41:08", "07:38:55", "07:35:20", "07:32:14", "07:29:05", "07:26:40", "07:23:11"];
    const postTimes = ["08:12:10", "08:11:45", "08:11:02", "08:10:48", "08:10:30", "08:10:15", "08:10:05", "08:09:58"];
    const isAvd = scenarioId === "INC-4092";
    const okBadge = isAvd
      ? isBaselineSlice
        ? "AVD Sign-In OK · Compliant"
        : "AVD Sign-In OK (SPE_E5)"
      : "Healthy · Compliant";
    const rows = rawCard.rows.map((r, idx) => {
      const next: Record<string, string | number | boolean | null> = { ...r };
      for (const [k, v] of Object.entries(next)) {
        const str = String(v ?? "");
        if (k === "timestamp" || k === "time" || /^\d{2}:\d{2}:\d{2}$/.test(str) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
          next[k] = isBaselineSlice ? (preTimes[idx] ?? "07:20:00") : (postTimes[idx] ?? "08:12:10");
        } else if (k === "status" || /^failure$/i.test(str)) {
          next[k] = "Success";
        } else if (/53003|blocked|failure|error|drifted|noncompliant/i.test(str)) {
          next[k] = okBadge;
        }
      }
      return next;
    });
    const kpis = rawCard.kpis.map((k) =>
      k.tone === "critical" || k.tone === "warning"
        ? {
            ...k,
            value: /fail|block|error|drift/i.test(k.label) ? "0" : k.value.replace(/Blocked|Failure|Drifted|53003/gi, "Healthy"),
            tone: "success" as const,
          }
        : k,
    );
    const breakdown = rawCard.breakdown.map((b, i) =>
      i === 0
        ? { ...b, label: okBadge, count: rows.length, pct: 100, tone: "success" as const }
        : { ...b, count: 0, pct: 0, tone: "default" as const },
    );
    return { ...rawCard, rows, kpis, breakdown };
  }, [rawCard, isBaselineSlice, isPostFixSlice]);

  const viewMode: ContextViewMode = entry.viewMode ?? card.viewMode ?? "dashboard";
  const refinementText = entry.refinementText ?? card.refinementText;
  const dismiss = useWorkbench((s) => s.dismissMiniDashboard);
  const setViewMode = useWorkbench((s) => s.setMiniDashboardViewMode);
  const linked = useWorkbench((s) => s.linkedSelection);
  const toast = useWorkbench((s) => s.toast);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const freeRoamOpen = useWorkbench((s) => s.freeRoamOpen);
  const stageFreeRoamRemediation = useWorkbench((s) => s.stageFreeRoamRemediation);
  const exploreSelection = useWorkbench((s) => s.exploreSelection);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  const [followUpText, setFollowUpText] = useState("");
  const classifier = useCallback((r: Record<string, unknown>) => classify(r), []);
  const { chip, setChip, counts, filtered } = useStatusFilter(card.rows, classifier);
  const pulsing = linked === entry.id;
  const elapsedSec = Math.max(0.1, Math.round(entry.latencyMs / 100) / 10).toFixed(1);
  const cleanSubtitle = useMemo(() => {
    const base = card.subtitle
      .replace(/\s*·?\s*(?:muse-[a-z0-9.-]+|llama-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|tier\s*\d\w*)/gi, "")
      .replace(/\s*·?\s*\d+\s*tokens?/gi, "")
      .replace(/\s*·?\s*ptr:\/\/[^\s·]+/gi, "")
      .replace(/^(?:\s*·\s*)+|(?:\s*·\s*)+$/g, "")
      .trim();
    const origin = lensOrigin(entry, card.rows.length);
    return base ? `${base} · ${origin}` : origin;
  }, [card.subtitle, entry, card.rows.length]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "healthy", title: `${what} copied`, detail: text.slice(0, 120) });
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const modeMeta = CONTEXT_MODE_META[viewMode];
  // A bounded module like every lens section (incident and Free-Roam alike): hairline frame, dashed
  // agent top edge, 16px inner gutter; tables bleed to the frame's inner edges.
  const [titleAccent, titleRest] = splitFirstWord(card.title);
  const err = card.errorCodeReference;

  return (
    <section
      id={`mini-${entry.id}`}
      data-mini-dashboard={entry.id}
      data-selection-index={entry.index}
      data-view-mode={viewMode}
      style={catStyle("selection", { ["--flash-color" as string]: "var(--signal)" })}
      className={`relative shrink-0 scroll-mt-2 animate-fade-in ${MODULE_FRAME} ${AGENT_RULE} px-4 pt-1.5 pb-3 ${pulsing ? "animate-pulse-ring" : ""}`}
    >
      <header className="flex min-h-7 min-w-0 items-center gap-2 py-0.5">
        <span aria-label="Agent-made section" title="Synthesized from your selection" className="shrink-0 text-13 leading-none text-signal" data-agent-mark="">
          ✦
        </span>
        <h3 className="line-clamp-2 min-w-0 text-13 font-medium text-text" title={card.title}>
          <span className="text-[color:var(--cat)]">{titleAccent}</span>
          {titleRest}
        </h3>
        <span
          className="inline-flex max-w-[35%] min-w-0 shrink-0 items-center"
          title={`Spawned from selection #${entry.index}: "${card.selectionText}"${refinementText ? ` + "${refinementText}"` : ""} · ${modeMeta.label} · Matched in ${elapsedSec}s`}
          data-testid="selection-badge"
        >
          <Pill variant="entity" mono={false} className="max-w-full text-12! text-muted!">
            &quot;{card.selectionText}&quot;{refinementText ? ` + "${refinementText}"` : ""}
          </Pill>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-11 text-faint">{fmtMs(entry.latencyMs)}</span>
          <button
            type="button"
            onClick={() => dismiss(entry.id)}
            aria-label="Dismiss context lens"
            title="Dismiss"
            className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="flex min-w-0 items-center gap-1.5 font-mono text-11 whitespace-nowrap text-faint" title={card.sourceQuery}>
        <span className="min-w-0 truncate">{cleanSubtitle}</span>
        {entry.provider && (
          <>
            <span aria-hidden className="shrink-0">·</span>
            <LensProvenance entry={entry} />
          </>
        )}
        {refinementText && (
          <>
            <span aria-hidden className="shrink-0">·</span>
            <span className="min-w-0 shrink-0 truncate text-muted" data-testid="mini-refinement-pill">
              context: &quot;{refinementText}&quot;
            </span>
          </>
        )}
      </div>

      {/* Mode toggles: text-12, the active one in text-text with a 2px signal underline. */}
      <div
        role="group"
        aria-label="Switch Context UI view mode"
        data-testid="mini-dashboard-mode-switcher"
        className="mt-1.5 flex min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none]"
      >
        {CONTEXT_MODE_LIST.map((m) => {
          const active = viewMode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              aria-pressed={active}
              onClick={() => setViewMode(entry.id, m.mode)}
              data-testid={`mini-mode-${m.mode}`}
              title={`${m.label}: ${m.hint}`}
              className={`relative inline-flex h-6 shrink-0 items-center gap-1.5 text-12 whitespace-nowrap transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
            >
              <ContextModeIcon mode={m.mode} className="size-3.5 shrink-0" />
              {m.shortLabel}
              {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
            </button>
          );
        })}
      </div>

      {/* Error-code reference: one line, the explanation and checks in the ⓘ popover. */}
      {err && (
        <div data-testid="error-code-encyclopedia-banner" className="mt-1.5 flex min-w-0 items-center gap-1.5 text-12">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
          <span className="shrink-0 font-mono text-text">{err.code}</span>
          <span className="shrink-0 text-warning">{err.symbolicName}</span>
          <span className="min-w-0 truncate text-muted" title={err.explanation}>
            {err.explanation}
          </span>
          <InfoPopover label={`${err.code} explanation and checks`}>
            <div className="font-mono text-11 text-faint">
              {err.code} · {err.symbolicName}
            </div>
            <p className="mt-1 text-12 text-text">{err.explanation}</p>
            {err.troubleshootingChecks.length > 0 && (
              <ol className="mt-2 space-y-1 border-t border-hairline pt-2">
                {err.troubleshootingChecks.map((check, idx) => (
                  <li key={idx} data-testid={`error-code-check-${idx + 1}`} className="flex items-baseline gap-2 text-12 text-text">
                    <span className="shrink-0 font-mono text-11 text-faint">{idx + 1}</span>
                    <span>{check}</span>
                  </li>
                ))}
              </ol>
            )}
            <a
              href={err.docsUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="error-code-docs-link"
              className="mt-2 inline-flex items-center gap-1 text-12 text-signal hover:underline"
            >
              MS Learn <ExternalLink className="size-3" />
            </a>
          </InfoPopover>
        </div>
      )}

      {/* KPI stat row (always visible across all 4 modes) */}
      <div className="mt-2 flex min-w-0 divide-x divide-hairline-2">
        {card.kpis.map((k) => (
          <div key={k.label} className={STAT_CELL} data-testid="mini-kpi">
            <div className="truncate text-11 text-faint" title={k.label}>
              {k.label}
            </div>
            <div className={`truncate font-mono text-15 tabular-nums ${TONE_VALUE[k.tone]}`} title={k.value}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {viewMode === "dashboard" && (
        <DashboardModeBody card={card} chip={chip} setChip={setChip} counts={counts} filtered={filtered} rowFilter={rowFilter} bleed />
      )}

      {viewMode === "full-card" && (
        <FullCardModeBody
          card={card}
          chip={chip}
          setChip={setChip}
          counts={counts}
          filtered={filtered}
          rowFilter={rowFilter}
          bleed
          latencyLabel={`${lensOrigin(entry, card.rows.length)} · ${elapsedSec}s`}
          copy={copy}
        />
      )}

      {viewMode === "comparison" && <ComparisonModeBody card={card} rowFilter={rowFilter} bleed />}

      {viewMode === "blast-radius" && <BlastRadiusModeBody card={card} refinementText={refinementText} />}

      {/* The section's one action row: stage, copy, follow-up refinement. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-hairline-2 pt-2">
        <Button
          size="xs"
          variant="outline"
          icon={<Wrench />}
          onClick={() => {
            if (freeRoamOpen) {
              void stageFreeRoamRemediation({
                prompt: card.selectionText,
                title: card.title,
                scriptPreview: card.suggestedAction.scriptPreview,
              });
            } else {
              openRemediation({ tab: "powershell" });
            }
          }}
          title={card.suggestedAction.scriptPreview}
        >
          {card.suggestedAction.label}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          icon={<Terminal />}
          aria-label="Copy command"
          onClick={() => void copy(card.suggestedAction.scriptPreview, "Targeted command")}
          title={`Copy command: ${card.suggestedAction.scriptPreview.split("\n")[0]}`}
        />
        <Button
          size="xs"
          variant="ghost"
          icon={<ClipboardCopy />}
          aria-label="Copy query"
          onClick={() => void copy(card.sourceQuery, "Graph/PowerShell query")}
          title={`Copy Graph/PowerShell query: ${card.sourceQuery}`}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!followUpText.trim()) return;
            void exploreSelection(card.selectionText, {
              refinementText: followUpText.trim(),
              viewMode,
            });
            setFollowUpText("");
          }}
          className="flex min-w-[180px] flex-1 items-center gap-1"
        >
          <input
            type="text"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="Follow-up: refine this lens…"
            data-testid="mini-dashboard-followup-input"
            className="h-6 min-w-0 flex-1 border-b border-hairline bg-transparent text-12 text-text placeholder:text-faint focus:border-signal focus:outline-none"
          />
          {followUpText.trim() && (
            <Button size="xs" type="submit" variant="ghost" icon={<Sparkles />}>
              Refine
            </Button>
          )}
        </form>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

const SOURCE_TEXT: Record<string, string> = {
  "live-graph": "Live Graph query",
  "live-azure": "Live ARM query",
  "seeded-manifest": "Seeded lab data",
  simulated: "Simulated lab data",
  "model-synthesized": "Model-synthesized rows · not tenant data",
  "deterministic-knowledge": "Reference knowledge · not tenant data",
  none: "No tenant rows matched",
};

/** Where the rows of a lens come from and how they were matched (audit H-11: never an unconditional "Live Tenant Query"). */
function lensOrigin(entry: MiniDashboardEntry, rowCount: number): string {
  const source = entry.dataSource ? (SOURCE_TEXT[entry.dataSource] ?? entry.dataSource) : "Tenant data";
  if (entry.dataSource === "none" || entry.dataSource === "model-synthesized" || entry.dataSource === "deterministic-knowledge") return source;
  if (entry.matchedBy === "dataset") return `${source} · the phrase names this dataset, no row names it`;
  return `${source} · ${rowCount} row${rowCount === 1 ? "" : "s"} matched`;
}

/** Which model composed this lens (or that none did), with the time of that call. */
function LensProvenance({ entry }: { entry: MiniDashboardEntry }) {
  const badge = provenanceBadge({ provider: entry.provider ?? "local", modelId: entry.modelId, latencyMs: entry.serverLatencyMs ?? entry.latencyMs });
  const cls = badge.tone === "healthy" ? "text-healthy" : badge.tone === "meta" ? "text-signal" : "text-muted";
  return (
    <span className={`shrink-0 ${cls}`} title={badge.title} data-testid="lens-provenance">
      {badge.label}
    </span>
  );
}

/** Data rows with identity cells (click a UPN or device to highlight it across the lens). */
function LensTable({
  card,
  rows,
  rowFilter,
  bleed,
  numbered = false,
  className = "",
}: {
  card: Card;
  rows: Record<string, unknown>[];
  rowFilter: RowFilter | null;
  bleed: boolean;
  numbered?: boolean;
  className?: string;
}) {
  const identities = rows.map((row) => ({ upn: typeof row.upn === "string" ? row.upn : null, deviceName: typeof row.deviceName === "string" ? row.deviceName : null }));
  return (
    <DataTable
      bleed={bleed}
      className={className}
      cellPy="py-1"
      head={[...(numbered ? ["#"] : []), ...card.columns.map((c) => c.label)]}
      rowClassName={(i) => rowHighlightClass(rowFilter, identities[i] ?? {})}
      rows={rows.map((row, i) => [
        ...(numbered ? [<span className="font-mono text-11 text-faint">{i + 1}</span>] : []),
        ...card.columns.map((c) => {
          const v = row[c.key];
          const cell = <ValueCell text={cellText(v)} badge={c.isBadge} mono={c.mono} />;
          const identity = identities[i]!;
          const isIdentity = (c.key === "upn" && identity.upn) || (c.key === "deviceName" && identity.deviceName);
          return isIdentity ? (
            <IdentityCell kind={c.key === "upn" ? "upn" : "device"} value={String(v)} className="block">
              {cell}
            </IdentityCell>
          ) : (
            cell
          );
        }),
      ])}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 1. DASHBOARD MODE (breakdown bars + filterable top rows)                    */
/* -------------------------------------------------------------------------- */

function DashboardModeBody({
  card,
  chip,
  setChip,
  counts,
  filtered,
  rowFilter,
  bleed,
}: {
  card: Card;
  chip: "all" | "bad" | "good";
  setChip: (c: "all" | "bad" | "good") => void;
  counts: { all: number; bad: number; good: number };
  filtered: Record<string, unknown>[];
  rowFilter: RowFilter | null;
  bleed: boolean;
}) {
  const topRows = filtered.slice(0, 6);
  return (
    <div className="mt-2" data-testid="mini-view-dashboard">
      {card.breakdown.length > 0 && (
        <>
          <SubHead label="Breakdown" count={card.breakdown.length} />
          <div className="space-y-1 pb-1">
            {card.breakdown.map((b) => (
              <div key={b.label} className="grid grid-cols-[minmax(0,160px)_1fr_auto] items-center gap-3 text-12">
                <span className="truncate text-muted" title={b.label}>
                  {b.label}
                </span>
                <span className="h-0.5 overflow-hidden rounded-full bg-raised">
                  <span className={`block h-full ${TONE_BAR[b.tone]}`} style={{ width: `${Math.max(2, Math.min(100, b.pct))}%` }} />
                </span>
                <span className="font-mono text-11 text-faint">
                  {b.count} · {b.pct}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {card.rows.length > 0 && (
        <div className="border-t border-hairline-2 pt-1">
          <FilterChips chip={chip} counts={counts} onChange={setChip} testId="mini-filter-chips" />
          <LensTable card={card} rows={topRows} rowFilter={rowFilter} bleed={bleed} className="max-h-56 overflow-y-auto" />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. FULL CARD MODE (complete table + entity inspector + script)              */
/* -------------------------------------------------------------------------- */

function FullCardModeBody({
  card,
  chip,
  setChip,
  counts,
  filtered,
  rowFilter,
  bleed,
  latencyLabel,
  copy,
}: {
  card: Card;
  chip: "all" | "bad" | "good";
  setChip: (c: "all" | "bad" | "good") => void;
  counts: { all: number; bad: number; good: number };
  filtered: Record<string, unknown>[];
  rowFilter: RowFilter | null;
  bleed: boolean;
  latencyLabel: string;
  copy: (text: string, what: string) => Promise<void>;
}) {
  const primaryCol = card.columns[0];
  const badgeCol = card.columns.find((c) => c.isBadge);
  const entities = card.rows.slice(0, 8);

  return (
    <div className="mt-2" data-testid="mini-view-full-card">
      {/* Source query and timing: one faint mono line. */}
      <div className="flex min-w-0 items-center gap-2 border-t border-hairline-2 py-1.5 font-mono text-11">
        <span className="shrink-0 text-faint uppercase">query</span>
        <span className="min-w-0 flex-1 truncate text-text" title={card.sourceQuery}>
          {card.sourceQuery}
        </span>
        <span className="shrink-0 text-faint">{latencyLabel}</span>
      </div>

      {card.rows.length > 0 && (
        <div className="border-t border-hairline-2 pt-1" data-testid="full-card-complete-table">
          <FilterChips chip={chip} counts={counts} onChange={setChip} testId="full-card-filter-chips" />
          <LensTable card={card} rows={filtered} rowFilter={rowFilter} bleed={bleed} numbered className="max-h-72 overflow-y-auto" />
        </div>
      )}

      {/* Entity inspector: hairline rows, the status word carries the colour. */}
      {entities.length > 0 && (
        <>
          <SubHead label="Entity inspector" count={entities.length} />
          <ul className="divide-y divide-hairline-2">
            {entities.map((row, idx) => {
              const status = classify(row);
              const headingVal = primaryCol ? String(row[primaryCol.key] ?? `Object #${idx + 1}`) : `Object #${idx + 1}`;
              const badgeVal = badgeCol ? String(row[badgeCol.key] ?? status) : status === "bad" ? "Drifted / Risk" : status === "good" ? "Healthy" : "Observed";
              return (
                <li key={idx} className="py-1.5 text-12" data-testid="full-card-entity" data-status={status}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono font-semibold text-text" title={headingVal}>
                      {headingVal}
                    </span>
                    <Pill variant="status" tone={cellTone(badgeVal)} className="ml-auto max-w-[45%]">
                      {badgeVal}
                    </Pill>
                  </div>
                  <dl className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-11">
                    {card.columns.map((c) => {
                      if (c.key === primaryCol?.key) return null;
                      const val = cellText(row[c.key], ["true", "false"]);
                      return (
                        <div key={c.key} className="contents">
                          <dt className="text-faint">{c.label}</dt>
                          <dd className={`truncate text-text ${c.mono ? "font-mono" : ""}`} title={val}>
                            {val}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Remediation script */}
      <SubHead
        label={`Remediation script · ${card.suggestedAction.label}`}
        aside={
          <button
            type="button"
            onClick={() => void copy(card.suggestedAction.scriptPreview, "PowerShell script")}
            className="inline-flex items-center gap-1 font-sans text-11 text-muted hover:text-text"
          >
            <ClipboardCopy className="size-3" /> Copy script
          </button>
        }
      />
      <pre className="max-h-36 overflow-auto rounded-md border border-hairline bg-ground p-2 font-mono text-11 leading-relaxed whitespace-pre-wrap text-text">{card.suggestedAction.scriptPreview}</pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. COMPARISON MODE (live drifted row vs a healthy row of the same result)   */
/* -------------------------------------------------------------------------- */

function ComparisonModeBody({ card, rowFilter, bleed }: { card: Card; rowFilter: RowFilter | null; bleed: boolean }) {
  const compareRows = card.rows.slice(0, 4);
  const primaryCol = card.columns[0];
  const attrColumns = card.columns.slice(1);

  const driftedRow = useMemo(() => card.rows.find((r) => classify(r) === "bad") ?? card.rows[0] ?? {}, [card.rows]);
  const goldenRow = useMemo(() => card.rows.find((r) => classify(r) === "good") ?? null, [card.rows]);

  // Which attributes vary across the compared rows, to mark the deltas (Δ).
  const differingKeys = useMemo(() => {
    const out = new Set<string>();
    for (const c of attrColumns) {
      const vals = new Set(compareRows.map((r) => String(r[c.key] ?? "")));
      if (vals.size > 1) out.add(c.key);
    }
    return out;
  }, [attrColumns, compareRows]);

  // Diff only against a real healthy row of the same result set; never an invented "golden" value.
  const baselineRow = goldenRow && goldenRow !== driftedRow ? goldenRow : null;
  const baselineValue = (key: string): string | null => (baselineRow && baselineRow[key] !== undefined && baselineRow[key] !== null ? String(baselineRow[key]) : null);

  const formatCardTitle = (row: Record<string, string | number | boolean | null>, idx: number): string => {
    const rawPrimary = primaryCol ? String(row[primaryCol.key] ?? "") : "";
    const identityLabel = String(row.displayName ?? row.user ?? row.upn ?? row.deviceName ?? row.resource ?? row.policyName ?? "");
    if (/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.test(rawPrimary)) {
      const hhmm = rawPrimary.slice(11, 16);
      return identityLabel ? `${identityLabel} (${hhmm})` : `${hhmm} UTC · Event #${idx + 1}`;
    }
    return rawPrimary || identityLabel || `Object #${idx + 1}`;
  };

  return (
    <div className="mt-2" data-testid="mini-view-comparison">
      <div className="flex min-w-0 items-center gap-2 border-t border-hairline-2 py-1.5 text-12">
        <GitCompare aria-hidden className="size-3.5 shrink-0 text-signal" />
        <span className="min-w-0 truncate text-text">
          Drifted row vs a healthy row of the same result · {compareRows.length} of {card.rows.length} objects
        </span>
        <span className="ml-auto shrink-0 font-mono text-11 text-faint">
          {differingKeys.size || 1} Δ attribute{differingKeys.size === 1 ? "" : "s"}
        </span>
      </div>

      {/* Drifted state (-) vs healthy reference (+), side by side, a hairline between. */}
      <div className="grid grid-cols-2 divide-x divide-hairline-2 border-t border-hairline-2" data-testid="comparison-remediation-delta">
        <div className="min-w-0 py-1.5 pr-3 text-11">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <span className="truncate text-11 font-medium tracking-wider text-critical uppercase">Drifted state (observed)</span>
          </div>
          <dl className="grid grid-cols-[minmax(80px,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {card.columns.map((c) => {
              const val = String(driftedRow[c.key] ?? "—");
              const targetVal = baselineValue(c.key);
              const isDiff = targetVal !== null && val !== targetVal;
              return (
                <div key={c.key} className="contents">
                  <dt className="truncate text-faint">{c.label}</dt>
                  <dd className={`truncate font-mono ${isDiff ? "font-semibold text-critical" : "text-muted"}`} title={val}>
                    {isDiff ? `- ${val}` : `  ${val}`}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <div className="min-w-0 py-1.5 pl-3 text-11">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <span className={`truncate text-11 font-medium tracking-wider uppercase ${baselineRow ? "text-healthy" : "text-faint"}`}>
              {baselineRow ? `Healthy reference · ${formatCardTitle(baselineRow, 0)}` : "Healthy reference"}
            </span>
            <span className="ml-auto shrink-0 font-mono text-11 text-faint">{baselineRow ? "real row" : "no baseline row"}</span>
          </div>
          {baselineRow ? (
            <dl className="grid grid-cols-[minmax(80px,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              {card.columns.map((c) => {
                const liveVal = String(driftedRow[c.key] ?? "—");
                const targetVal = baselineValue(c.key) ?? "—";
                const isDiff = liveVal !== targetVal;
                return (
                  <div key={c.key} className="contents">
                    <dt className="truncate text-faint">{c.label}</dt>
                    <dd className={`truncate font-mono ${isDiff ? "font-semibold text-healthy" : "text-muted"}`} title={targetVal}>
                      {isDiff ? `+ ${targetVal}` : `  ${targetVal}`}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p className="text-11 text-muted" data-testid="comparison-no-baseline">
              No healthy row in this result set to diff against. Add a peer with the follow-up box (for example &quot;compliant devices&quot;) to compare against a real object.
            </p>
          )}
        </div>
      </div>

      {/* Peer columns: one per compared row, attributes as label / value lines. */}
      <SubHead label="Peers" count={Math.min(3, compareRows.length)} />
      <div className="grid grid-cols-3 divide-x divide-hairline-2">
        {compareRows.slice(0, 3).map((row, idx) => {
          const status = classify(row);
          const title = formatCardTitle(row, idx);
          const isBaseline = status === "good";
          const role = isBaseline ? "Reference" : status === "bad" ? (idx === 0 ? "Primary failing" : `Drifted #${idx + 1}`) : idx === 0 ? "Selected target" : `Peer #${idx + 1}`;
          return (
            <div key={idx} data-testid="comparison-column-card" data-status={status} className="min-w-0 px-3 pb-1 text-11 first:pl-0 last:pr-0">
              <div className="truncate font-mono text-12 font-semibold text-text" title={title}>
                {title}
              </div>
              <Pill variant="status" tone={STATUS_TONE[status]} mono={false}>
                {role}
              </Pill>
              <div className="mt-1 space-y-1">
                {attrColumns.map((c) => {
                  const val = cellText(row[c.key], ["true", "false"]);
                  const hasDelta = differingKeys.has(c.key);
                  return (
                    <div key={c.key} className="min-w-0">
                      <div className="flex items-center justify-between gap-1 text-11 text-faint">
                        <span className="truncate">{c.label}</span>
                        {hasDelta && <span className="shrink-0 font-mono text-signal">Δ</span>}
                      </div>
                      <div
                        className={`truncate ${c.mono ? "font-mono" : ""} ${BAD.test(val) ? "font-medium text-critical" : GOOD.test(val) ? "font-medium text-healthy" : "text-text"}`}
                        title={val}
                      >
                        {val}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* All rows as a matrix, folded when there are more than 3. */}
      {card.rows.length > 3 && (
        <details className="mt-1 border-t border-hairline-2">
          <summary className="cursor-pointer py-1.5 text-12 text-muted hover:text-text">All {card.rows.length} rows as a matrix</summary>
          <DataTable
            bleed={bleed}
            className="max-h-44 overflow-y-auto"
            cellPy="py-1"
            head={card.columns.map((c) => `${c.label}${differingKeys.has(c.key) ? " Δ" : ""}`)}
            rowClassName={(i) => {
              const row = card.rows[i]!;
              return rowHighlightClass(rowFilter, { upn: typeof row.upn === "string" ? row.upn : null, deviceName: typeof row.deviceName === "string" ? row.deviceName : null });
            }}
            rows={card.rows.map((row) => card.columns.map((c) => <ValueCell text={cellText(row[c.key], ["true", "false"])} badge={c.isBadge} mono={c.mono} />))}
          />
        </details>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. BLAST RADIUS & DEPENDENCY GRAPH MODE                                    */
/* -------------------------------------------------------------------------- */

function BlastRadiusModeBody({ card, refinementText }: { card: Card; refinementText?: string }) {
  const stages = useMemo(() => buildBlastRadiusStages(card, refinementText), [card, refinementText]);
  const badCount = useMemo(() => card.rows.filter((r) => classify(r) === "bad").length, [card.rows]);
  const goodCount = useMemo(() => card.rows.filter((r) => classify(r) === "good").length, [card.rows]);
  const filledStages = stages.filter((st) => st.nodes.length > 0).length;
  // Read-only when every command in the suggestion only reads; anything else goes through the approval flow.
  const commands = card.suggestedAction.scriptPreview.match(/\b[A-Z][a-z]+-[A-Za-z]+\b/g) ?? [];
  const readOnly = commands.length > 0 && commands.every((c) => /^(Get|Search|Select|Where|Format|Sort|Measure)-/.test(c)) && !/-Method\s+'?(POST|PATCH|PUT|DELETE)/i.test(card.suggestedAction.scriptPreview);

  return (
    <div className="mt-2" data-testid="mini-view-blast-radius">
      <div className="flex min-w-0 items-center gap-2 border-t border-hairline-2 py-1.5 text-12">
        <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-critical" />
        <span className="min-w-0 truncate text-text">Impact &amp; dependency blast radius</span>
        <span className="ml-auto shrink-0 font-mono text-11 text-faint">
          {card.rows.length} rows · {filledStages} stages · {badCount} impacted
        </span>
      </div>

      {/* Affected cohorts and rollback safety as a stat row */}
      <div className="flex min-w-0 divide-x divide-hairline-2 border-t border-hairline-2 pt-1.5 pb-1" data-testid="blast-cohort-grid">
        <StatCell label="Affected cohort" value={`${badCount || card.rows.length}/${card.rows.length}`} valueClass="text-critical" hint={card.title} />
        <StatCell
          label="Dependency chain"
          value={`${filledStages}/${stages.length}`}
          hint={<span title="Grouped from the rows of this result, not a traced dependency graph">Principal → Object → Policy → Blast</span>}
        />
        <StatCell label="Healthy peers" value={goodCount} valueClass="text-healthy" hint={goodCount ? "in the same result set" : "no healthy row in this result"} />
        <div className={STAT_CELL} data-testid="blast-rollback-safety">
          <div className="truncate text-11 text-faint">Suggested command</div>
          <div className={`inline-flex items-center gap-1 text-13 ${readOnly ? "text-healthy" : "text-warning"}`}>
            {readOnly ? <CheckCircle2 aria-hidden className="size-3.5 shrink-0" /> : <AlertTriangle aria-hidden className="size-3.5 shrink-0" />}
            {readOnly ? "Read-only" : "Changes state"}
          </div>
          <div className="truncate text-11 text-muted" title={card.suggestedAction.label}>
            {card.suggestedAction.label}
          </div>
        </div>
      </div>

      {/* 4-stage chain: two columns of stages, nodes as hairline rows, edges as text arrows. */}
      <div className="grid grid-cols-2 gap-x-6">
        {stages.map((stage, idx) => (
          <div key={stage.title} data-testid={`blast-stage-${idx + 1}`} className="min-w-0">
            <SubHead label={`${idx + 1} · ${stage.title}`} count={stage.nodes.length} aside={idx < stages.length - 1 ? `${stage.edgeLabel} →` : stage.edgeLabel} />
            <ul className="divide-y divide-hairline-2">
              {stage.nodes.map((node, nIdx) => (
                <li key={`${node.label}-${nIdx}`} className="min-w-0 py-1 text-11">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${node.tone === "muted" || node.tone === "meta" ? "bg-signal" : TONE_DOT[node.tone]}`} />
                    <span className="truncate font-mono text-12 font-medium text-text" title={node.label}>
                      {node.label}
                    </span>
                  </div>
                  <div className="truncate pl-3 text-muted" title={node.detail}>
                    {node.detail}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BlastStage {
  title: string;
  edgeLabel: string;
  nodes: Array<{ label: string; detail: string; tone: Tone }>;
}

function buildBlastRadiusStages(card: Card, refinementText?: string): BlastStage[] {
  const rows = card.rows;
  const col0 = card.columns[0]?.key ?? "name";
  const col1 = card.columns[1]?.key ?? "state";
  const col2 = card.columns[2]?.key ?? "detail";

  // Check if this is the peer-apps / workload-identity owner graph
  const hasOwnerUpn = rows.some((r) => "ownerUpn" in r || r.kind === "owner");
  if (hasOwnerUpn) {
    const owners = [...new Set(rows.map((r) => String(r.ownerUpn ?? (r.kind === "owner" ? r.name : "alex.wilber@c4a8shili.onmicrosoft.com"))))];
    const apps = rows.some((r) => "displayName" in r && "appId" in r)
      ? rows.map((r) => ({
          label: String(r.displayName),
          detail: `appId ${String(r.appId).slice(0, 18)}… · ${String(r.credentialSummary ?? r.stateLabel ?? "")}`,
          tone: cellTone(String(r.stateLabel ?? r.posture ?? "critical")),
        }))
      : [
          {
            label: card.title.split("·")[0]?.trim() || "spn-contoso-erp-sync",
            detail: `Selection "${card.selectionText}"`,
            tone: "critical" as Tone,
          },
        ];
    const scopes = rows.some((r) => "highPrivScopes" in r)
      ? rows.map((r) => ({
          label: String(r.highPrivScopes).split(",")[0] ?? "Directory.ReadWrite.All",
          detail: `${String(r.displayName)} · ${String(r.highPrivScopes)}`,
          tone: cellTone(String(r.stateLabel ?? "critical")),
        }))
      : rows
          .filter((r) => r.kind === "application permission" || r.kind === "delegated grant" || r.kind === "client secret")
          .slice(0, 4)
          .map((r) => ({
            label: String(r.name),
            detail: `${String(r.kind)} · ${String(r.detail ?? r.state)}`,
            tone: cellTone(String(r.state ?? "critical")),
          }));

    return [
      {
        title: "Principal / Owner",
        edgeLabel: "owns",
        nodes: owners.slice(0, 3).map((o) => ({
          label: o,
          detail: o.includes("alex.wilber") ? "0 directory roles · Shadow Admin" : "Privileged role holder",
          tone: o.includes("alex.wilber") ? "critical" : "healthy",
        })),
      },
      {
        title: "Service principals",
        edgeLabel: "grants",
        nodes: apps.slice(0, 4),
      },
      {
        title: "Privileged scopes",
        edgeLabel: "impacts",
        nodes: scopes.length
          ? scopes.slice(0, 4)
          : [{ label: "Directory.ReadWrite.All", detail: "Unused high-privilege Graph role", tone: "critical" }],
      },
      {
        title: "Blast radius",
        edgeLabel: "exposure",
        nodes: [
          { label: "Tenant directory takeover", detail: "Non-admin owner can rotate credentials on privileged SPNs", tone: "critical" },
          { label: card.kpis[0] ? `${card.kpis[0].label}: ${card.kpis[0].value}` : "Production Sync", detail: refinementText ? `Query: "${refinementText}"` : card.subtitle, tone: "warning" },
          { label: card.suggestedAction.label, detail: "1-click remediation ready", tone: "healthy" },
        ],
      },
    ];
  }

  // Generic 4-stage dependency graph for any dataset (Users, Sign-ins, CA Policies, Intune, NSG, AVD)
  const primaryNodes = rows.slice(0, 4).map((r) => ({
    label: String(r[col0] ?? card.selectionText),
    detail: String(r[col1] ?? ""),
    tone: classify(r) === "bad" ? ("critical" as Tone) : classify(r) === "good" ? ("healthy" as Tone) : ("warning" as Tone),
  }));

  const stateNodes = card.breakdown.slice(0, 3).map((b) => ({
    label: `${b.label} (${b.count})`,
    detail: `${b.pct}% of matched cohort`,
    tone: TONE[b.tone],
  }));

  const detailNodes = rows.slice(0, 3).map((r) => ({
    label: String(r[col2] ?? r[col1] ?? "Configuration state"),
    detail: `Linked to ${String(r[col0] ?? card.selectionText)}`,
    tone: classify(r) === "bad" ? ("critical" as Tone) : ("muted" as Tone),
  }));

  return [
    {
      title: "Selected anchor",
      edgeLabel: "matches",
      nodes: [
        { label: card.selectionText, detail: refinementText ? `+ "${refinementText}"` : "Highlighted in ticket", tone: "meta" },
        ... card.kpis.slice(0, 2).map((k) => ({ label: `${k.label}: ${k.value}`, detail: "Live telemetry aggregate", tone: TONE[k.tone] })),
      ],
    },
    {
      title: "Matched objects",
      edgeLabel: "enforces",
      nodes: primaryNodes.length ? primaryNodes : [{ label: "0 objects", detail: card.subtitle, tone: "warning" }],
    },
    {
      title: "Posture & controls",
      edgeLabel: "causes",
      nodes: detailNodes.length ? detailNodes : stateNodes,
    },
    {
      title: "Blast radius",
      edgeLabel: "mitigation",
      nodes: [
        ...stateNodes.slice(0, 2),
        { label: card.suggestedAction.label, detail: card.suggestedAction.scriptPreview.split("\n")[0] ?? "", tone: "healthy" },
      ],
    },
  ];
}

export const MINI_TONE = TONE;
