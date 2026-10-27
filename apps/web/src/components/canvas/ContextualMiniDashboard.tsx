import { ArrowRight, ClipboardCopy, ShieldAlert, Sparkles, Wand2, Wrench, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { ContextViewMode, ContextualMiniDashboard as Card, MetricTone } from "@contextpane/catalog";
import { fmtMs } from "@/lib/format";
import { selectActiveTimelineSlice, useWorkbench, type MiniDashboardEntry, type RowFilter } from "@/store";
import { Button } from "../ui/Button";
import { CONTEXT_MODE_LIST, CONTEXT_MODE_META, ContextModeIcon } from "../ui/ContextModeIcons";
import { Pill, type Tone } from "../ui/Pill";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const TONE: Record<MetricTone, Tone> = { default: "muted", warning: "warning", critical: "critical", success: "healthy" };
const TONE_TEXT: Record<MetricTone, string> = { default: "text-text", warning: "text-warning", critical: "text-critical", success: "text-healthy" };
const TONE_BAR: Record<MetricTone, string> = { default: "bg-primary/70", warning: "bg-warning", critical: "bg-critical", success: "bg-healthy" };

const BAD = /noncompliant|conflict|error|drifted|orphaned|failure|expired|rogue|critical|high|report|unverified|disabled|missing|countviolation|shadow/i;
const GOOD = /^(compliant|active|reclaimed|success|in-sync|available|enabled|low|verified|healthy|allow|golden.*)$/i;

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

/**
 * A ContextualMiniDashboard spawned from highlighted text: supports 4 VectorCraft view modes:
 * - `dashboard`: KPI tiles, proportional breakdown, dynamic table & targeted action
 * - `full-card`: Deep entity posture inspector with attribute cards & expanded PowerShell remediation block
 * - `comparison`: Side-by-side peer cohort & golden baseline comparison matrix
 * - `blast-radius`: Visual 4-stage dependency & ownership blast-radius graph
 */
export function ContextualMiniDashboardCard({ entry }: { entry: MiniDashboardEntry }) {
  const rawCard: Card = entry.card;
  const activeSlice = useWorkbench(selectActiveTimelineSlice);
  const converged = useWorkbench((s) => Boolean(s.convergence[s.scenarioId]));
  const isBaselineSlice = activeSlice?.kind === "baseline";
  const isPostFixSlice = activeSlice?.kind === "counterfactual" || (converged && (!activeSlice || activeSlice.relativeLabel === "NOW"));

  const card: Card = useMemo(() => {
    if (!isBaselineSlice && !isPostFixSlice) return rawCard;
    const preTimes = ["07:44:12", "07:41:08", "07:38:55", "07:35:20", "07:32:14", "07:29:05", "07:26:40", "07:23:11"];
    const postTimes = ["08:12:10", "08:11:45", "08:11:02", "08:10:48", "08:10:30", "08:10:15", "08:10:05", "08:09:58"];
    const okBadge = isBaselineSlice ? "AVD Sign-In OK · Compliant" : "AVD Sign-In OK (SPE_E5)";
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
  const rowFilter = useWorkbench((s) => s.rowFilter);
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
    return base ? `${base} · Live Tenant Query · Matched in ${elapsedSec}s` : `Live Tenant Query · Matched in ${elapsedSec}s`;
  }, [card.subtitle, elapsedSec]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "healthy", title: `${what} copied`, detail: text.slice(0, 120) });
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const modeMeta = CONTEXT_MODE_META[viewMode];

  return (
    <section
      id={`mini-${entry.id}`}
      data-mini-dashboard={entry.id}
      data-selection-index={entry.index}
      data-view-mode={viewMode}
      style={{ ["--cat" as string]: "var(--color-selection)", ["--flash-color" as string]: "var(--color-selection)" }}
      className={`card scroll-mt-2 animate-fade-in border-l-4 border-l-selection transition-[box-shadow] duration-150 ${pulsing ? "ring-2 ring-selection animate-pulse-ring" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-selection" />
        <h3 className="min-w-[180px] flex-1 text-[13px] font-semibold leading-snug" title={card.title}>
          {card.title}
        </h3>

        {/* VectorCraft 4-mode switcher on the card */}
        <div
          role="group"
          aria-label="Switch Context UI view mode"
          data-testid="mini-dashboard-mode-switcher"
          className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface p-0.5"
        >
          {CONTEXT_MODE_LIST.map((m) => {
            const active = viewMode === m.mode;
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => setViewMode(entry.id, m.mode)}
                data-testid={`mini-mode-${m.mode}`}
                title={`${m.label}: ${m.hint}`}
                className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10.5px] transition-colors ${
                  active
                    ? "border border-selection/60 bg-selection/18 font-medium text-selection"
                    : "text-muted hover:bg-elevated/60 hover:text-text"
                }`}
              >
                <ContextModeIcon mode={m.mode} className="size-3 shrink-0" />
                <span className="hidden sm:inline">{m.shortLabel}</span>
              </button>
            );
          })}
        </div>

        <span
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-selection/45 bg-selection/12 px-1.5 font-mono text-[10.5px] text-selection"
          title={`Selection #${entry.index} · ${modeMeta.label} · Live Tenant Query · Matched in ${elapsedSec}s`}
          data-testid="selection-badge"
        >
          <Wand2 className="size-3" />
          Spawned from selection: "{card.selectionText.length > 24 ? `${card.selectionText.slice(0, 23)}…` : card.selectionText}"
          {refinementText ? ` + "${refinementText.length > 22 ? `${refinementText.slice(0, 21)}…` : refinementText}"` : ""} · {fmtMs(entry.latencyMs)}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="xs" variant="outline" icon={<ClipboardCopy />} onClick={() => void copy(card.sourceQuery, "Graph/PowerShell query")} title={card.sourceQuery}>
            Copy Graph/PowerShell Query
          </Button>
          <button
            type="button"
            onClick={() => dismiss(entry.id)}
            aria-label="Dismiss mini-dashboard"
            className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-muted hover:bg-surface hover:text-text"
          >
            <X className="size-3" /> Dismiss
          </button>
        </div>
      </header>

      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-faint" title={card.sourceQuery}>
        <span className="truncate">{cleanSubtitle}</span>
        {refinementText && (
          <span className="rounded border border-selection/35 bg-selection/8 px-1.5 py-0.2 text-[10px] text-selection" data-testid="mini-refinement-pill">
            context: "{refinementText}"
          </span>
        )}
      </div>

      {/* KPI Tiles (always visible across all 4 modes) */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {card.kpis.map((k) => (
          <div key={k.label} className="rounded-md border border-border-subtle bg-surface px-2 py-1" data-testid="mini-kpi">
            <div className="text-[10px] tracking-wider text-faint uppercase">{k.label}</div>
            <div className={`font-mono text-[13px] font-semibold ${TONE_TEXT[k.tone]}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Mode-specific specialized body */}
      {viewMode === "dashboard" && (
        <DashboardModeBody
          card={card}
          chip={chip}
          setChip={setChip}
          counts={counts}
          filtered={filtered}
          rowFilter={rowFilter}
        />
      )}

      {viewMode === "full-card" && (
        <FullCardModeBody
          card={card}
          latencyLabel={`Live Tenant Query · Matched in ${elapsedSec}s`}
          copy={copy}
          openRemediation={() => openRemediation({ tab: "powershell" })}
        />
      )}

      {viewMode === "comparison" && (
        <ComparisonModeBody
          card={card}
          rowFilter={rowFilter}
        />
      )}

      {viewMode === "blast-radius" && (
        <BlastRadiusModeBody
          card={card}
          refinementText={refinementText}
        />
      )}

      {/* Action footer */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2">
        <Button size="xs" variant="meta" icon={<Wrench />} onClick={() => openRemediation({ tab: "powershell" })} title={card.suggestedAction.scriptPreview}>
          {card.suggestedAction.label}
        </Button>
        <Button size="xs" variant="ghost" icon={<ClipboardCopy />} onClick={() => void copy(card.suggestedAction.scriptPreview, "Targeted command")}>
          Copy command
        </Button>
        <span className="ml-auto truncate font-mono text-[10px] text-faint" title={card.suggestedAction.scriptPreview}>
          {card.suggestedAction.scriptPreview.split("\n")[0]}
        </span>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. DASHBOARD MODE                                                          */
/* -------------------------------------------------------------------------- */

function DashboardModeBody({
  card,
  chip,
  setChip,
  counts,
  filtered,
  rowFilter,
}: {
  card: Card;
  chip: "all" | "bad" | "good";
  setChip: (c: "all" | "bad" | "good") => void;
  counts: { all: number; bad: number; good: number };
  filtered: Record<string, unknown>[];
  rowFilter: RowFilter | null;
}) {
  return (
    <div data-testid="mini-view-dashboard">
      <div className="mt-2 space-y-1">
        {card.breakdown.map((b) => (
          <div key={b.label} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-2 text-[11px]">
            <span className="truncate text-muted" title={b.label}>
              {b.label}
            </span>
            <span className="h-1.5 overflow-hidden rounded bg-border-subtle">
              <span className={`block h-full rounded ${TONE_BAR[b.tone]}`} style={{ width: `${Math.max(2, Math.min(100, b.pct))}%` }} />
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              {b.count} · {b.pct}%
            </span>
          </div>
        ))}
      </div>

      {card.rows.length > 0 && (
        <div className="mt-2">
          <FilterChips chip={chip} counts={counts} onChange={setChip} testId="mini-filter-chips" />
          <div className="max-h-64 overflow-auto rounded-md border border-border-subtle">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-surface text-[10px] tracking-wider text-faint uppercase">
                <tr>
                  {card.columns.map((c) => (
                    <th key={c.key} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const identity = { upn: typeof row.upn === "string" ? row.upn : null, deviceName: typeof row.deviceName === "string" ? row.deviceName : null };
                  return (
                    <tr key={i} className={`border-t border-border-subtle align-middle transition-opacity ${rowHighlightClass(rowFilter, identity)}`}>
                      {card.columns.map((c) => {
                        const v = row[c.key];
                        const text = v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
                        const cell = c.isBadge ? (
                          <Pill tone={cellTone(text)}>{text}</Pill>
                        ) : (
                          <span className={`${c.mono ? "font-mono" : ""} ${text.length > 48 ? "block max-w-[320px] truncate" : ""}`} title={text}>
                            {text}
                          </span>
                        );
                        const isIdentity = (c.key === "upn" && identity.upn) || (c.key === "deviceName" && identity.deviceName);
                        return (
                          <td key={c.key} className="px-2.5 py-1">
                            {isIdentity ? (
                              <IdentityCell kind={c.key === "upn" ? "upn" : "device"} value={String(v)}>
                                {cell}
                              </IdentityCell>
                            ) : (
                              cell
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. FULL CARD MODE (Deep Entity Posture & Attribute Inspector)              */
/* -------------------------------------------------------------------------- */

function FullCardModeBody({
  card,
  latencyLabel,
  copy,
  openRemediation,
}: {
  card: Card;
  latencyLabel: string;
  copy: (text: string, what: string) => Promise<void>;
  openRemediation: () => void;
}) {
  const primaryCol = card.columns[0];
  const badgeCol = card.columns.find((c) => c.isBadge);

  return (
    <div className="mt-2.5 space-y-2.5" data-testid="mini-view-full-card">
      {/* Live source query & query timing bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-selection/30 bg-selection/6 px-2.5 py-1.5 font-mono text-[10.5px]">
        <div className="min-w-0 flex-1 truncate text-selection" title={card.sourceQuery}>
          <span className="mr-1.5 rounded bg-selection/20 px-1 py-0.5 text-[9.5px] font-semibold uppercase">Live Source</span>
          {card.sourceQuery}
        </div>
        <span className="shrink-0 rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[10px] text-faint">{latencyLabel}</span>
      </div>

      {/* Deep entity posture inspector cards */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {card.rows.slice(0, 8).map((row, idx) => {
          const status = classify(row);
          const headingVal = primaryCol ? String(row[primaryCol.key] ?? `Object #${idx + 1}`) : `Object #${idx + 1}`;
          const badgeVal = badgeCol ? String(row[badgeCol.key] ?? status) : status === "bad" ? "Drifted / Risk" : status === "good" ? "Healthy" : "Observed";
          return (
            <div
              key={idx}
              className={`rounded-md border p-2.5 text-[11.5px] ${
                status === "bad"
                  ? "border-critical/40 bg-critical/5"
                  : status === "good"
                    ? "border-healthy/35 bg-healthy/5"
                    : "border-border-subtle bg-surface"
              }`}
              data-testid="full-card-entity"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border-subtle/80 pb-1">
                <span className="truncate font-mono text-[12px] font-semibold text-text" title={headingVal}>
                  {headingVal}
                </span>
                <Pill tone={cellTone(badgeVal)}>{badgeVal}</Pill>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                {card.columns.map((c) => {
                  if (c.key === primaryCol?.key) return null;
                  const raw = row[c.key];
                  const val = raw === null || raw === undefined ? "—" : typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
                  return (
                    <div key={c.key} className="contents">
                      <dt className="text-faint">{c.label}</dt>
                      <dd className={`truncate text-text ${c.mono ? "font-mono text-[10.5px]" : ""}`} title={val}>
                        {val}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          );
        })}
      </div>

      {/* Expanded Multi-Line PowerShell / Graph Remediation Script */}
      <div className="rounded-md border border-border-subtle bg-canvas/90 p-2.5">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10.5px]">
          <span className="font-semibold tracking-wider text-muted uppercase">Targeted Remediation Script · {card.suggestedAction.label}</span>
          <div className="flex items-center gap-1">
            <Button size="xs" variant="ghost" icon={<ClipboardCopy />} onClick={() => void copy(card.suggestedAction.scriptPreview, "PowerShell script")}>
              Copy Script
            </Button>
            <Button size="xs" variant="meta" icon={<Wrench />} onClick={openRemediation}>
              Open in Approval Drawer
            </Button>
          </div>
        </div>
        <pre className="max-h-36 overflow-auto rounded border border-border-subtle/60 bg-surface/80 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text">
          {card.suggestedAction.scriptPreview}
        </pre>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. QUICK COMPARISON MODE (Side-by-Side Peer & Baseline Diff Matrix)        */
/* -------------------------------------------------------------------------- */

function ComparisonModeBody({ card, rowFilter }: { card: Card; rowFilter: RowFilter | null }) {
  const compareRows = card.rows.slice(0, 4);
  const primaryCol = card.columns[0];
  const attrColumns = card.columns.slice(1);

  // Determine which attributes vary across the compared rows so we can highlight deltas (Δ)
  const differingKeys = useMemo(() => {
    const out = new Set<string>();
    for (const c of attrColumns) {
      const vals = new Set(compareRows.map((r) => String(r[c.key] ?? "")));
      if (vals.size > 1) out.add(c.key);
    }
    return out;
  }, [attrColumns, compareRows]);

  return (
    <div className="mt-2.5 space-y-2.5" data-testid="mini-view-comparison">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-selection/35 bg-selection/8 px-2.5 py-1 text-[11px]">
        <span className="font-medium text-selection">
          Side-by-Side Peer &amp; Baseline Comparison · Comparing {compareRows.length} of {card.rows.length} matched objects
        </span>
        <span className="font-mono text-[10.5px] text-muted">
          {differingKeys.size} diverging attribute{differingKeys.size === 1 ? "" : "s"} highlighted (Δ)
        </span>
      </div>

      {/* Side-by-side comparison cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {compareRows.map((row, idx) => {
          const status = classify(row);
          const title = primaryCol ? String(row[primaryCol.key] ?? `Item #${idx + 1}`) : `Item #${idx + 1}`;
          const isBaseline = status === "good" || /golden|baseline|compliant/i.test(JSON.stringify(row));
          return (
            <div
              key={idx}
              data-testid="comparison-column-card"
              className={`flex flex-col rounded-md border p-2.5 text-[11px] ${
                isBaseline
                  ? "border-healthy/50 bg-healthy/6"
                  : status === "bad"
                    ? "border-critical/45 bg-critical/6"
                    : "border-warning/40 bg-warning/6"
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-1.5 border-b border-border-subtle/80 pb-1.5">
                <span className="truncate font-mono text-[11.5px] font-semibold text-text" title={title}>
                  {title}
                </span>
                <Pill tone={isBaseline ? "healthy" : status === "bad" ? "critical" : "warning"}>
                  {isBaseline ? "Reference / Golden" : idx === 0 ? "Selected Target" : `Peer #${idx}`}
                </Pill>
              </div>
              <div className="space-y-1.5">
                {attrColumns.map((c) => {
                  const raw = row[c.key];
                  const val = raw === null || raw === undefined ? "—" : String(raw);
                  const hasDelta = differingKeys.has(c.key);
                  return (
                    <div key={c.key} className="rounded border border-border-subtle/60 bg-surface/75 px-2 py-1">
                      <div className="flex items-center justify-between text-[9.5px] tracking-wider text-faint uppercase">
                        <span>{c.label}</span>
                        {hasDelta && <span className="font-mono font-bold text-selection">Δ diff</span>}
                      </div>
                      <div
                        className={`mt-0.5 truncate ${c.mono ? "font-mono text-[10.5px]" : "text-[11px]"} ${
                          BAD.test(val) ? "font-medium text-critical" : GOOD.test(val) ? "font-medium text-healthy" : "text-text"
                        }`}
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

      {/* Compact matrix table when there are additional rows */}
      {card.rows.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border border-border-subtle">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface text-[10px] tracking-wider text-faint uppercase">
              <tr>
                {card.columns.map((c) => (
                  <th key={c.key} className="px-2.5 py-1 text-left font-medium whitespace-nowrap">
                    {c.label} {differingKeys.has(c.key) ? "Δ" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row, i) => {
                const identity = { upn: typeof row.upn === "string" ? row.upn : null, deviceName: typeof row.deviceName === "string" ? row.deviceName : null };
                return (
                  <tr key={i} className={`border-t border-border-subtle ${rowHighlightClass(rowFilter, identity)}`}>
                    {card.columns.map((c) => {
                      const v = row[c.key];
                      const text = v === null || v === undefined ? "—" : String(v);
                      return (
                        <td key={c.key} className={`px-2.5 py-1 ${c.mono ? "font-mono" : ""}`}>
                          {c.isBadge ? <Pill tone={cellTone(text)}>{text}</Pill> : text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. BLAST RADIUS & DEPENDENCY GRAPH MODE                                    */
/* -------------------------------------------------------------------------- */

function BlastRadiusModeBody({ card, refinementText }: { card: Card; refinementText?: string }) {
  const stages = useMemo(() => buildBlastRadiusStages(card, refinementText), [card, refinementText]);

  return (
    <div className="mt-2.5 space-y-2.5" data-testid="mini-view-blast-radius">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-critical/35 bg-critical/8 px-2.5 py-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-critical">
          <ShieldAlert className="size-3.5 shrink-0" />
          Blast Radius &amp; Ownership Dependency Graph
        </span>
        <span className="font-mono text-[10.5px] text-muted">
          {card.rows.length} live nodes mapped across 4 dependency hops
        </span>
      </div>

      {/* 4-Stage Directed Graph */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
        {stages.map((stage, idx) => (
          <div key={stage.title} className="contents">
            <div
              data-testid={`blast-stage-${idx + 1}`}
              className="flex flex-col rounded-md border border-border-subtle bg-surface p-2.5"
            >
              <div className="mb-1.5 flex items-center justify-between gap-1 border-b border-border-subtle pb-1">
                <span className="font-mono text-[10px] font-semibold tracking-wider text-selection uppercase">
                  {idx + 1}. {stage.title}
                </span>
                <span className="font-mono text-[10px] text-faint">{stage.edgeLabel}</span>
              </div>
              <div className="space-y-1.5">
                {stage.nodes.map((node, nIdx) => (
                  <div
                    key={`${node.label}-${nIdx}`}
                    className={`rounded border px-2 py-1.5 text-[11px] ${
                      node.tone === "critical"
                        ? "border-critical/45 bg-critical/10 text-text"
                        : node.tone === "warning"
                          ? "border-warning/45 bg-warning/10 text-text"
                          : node.tone === "healthy"
                            ? "border-healthy/45 bg-healthy/10 text-text"
                            : "border-border-subtle bg-canvas/70 text-text"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate font-mono text-[11px] font-semibold" title={node.label}>
                        {node.label}
                      </span>
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          node.tone === "critical"
                            ? "bg-critical"
                            : node.tone === "warning"
                              ? "bg-warning"
                              : node.tone === "healthy"
                                ? "bg-healthy"
                                : "bg-selection"
                        }`}
                      />
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted" title={node.detail}>
                      {node.detail}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {idx < stages.length - 1 && (
              <div className="hidden items-center justify-center text-selection/70 lg:flex" aria-hidden="true">
                <ArrowRight className="size-4" />
              </div>
            )}
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
        title: "Service Principals",
        edgeLabel: "grants",
        nodes: apps.slice(0, 4),
      },
      {
        title: "Privileged Scopes",
        edgeLabel: "impacts",
        nodes: scopes.length
          ? scopes.slice(0, 4)
          : [{ label: "Directory.ReadWrite.All", detail: "Unused high-privilege Graph role", tone: "critical" }],
      },
      {
        title: "Blast Radius",
        edgeLabel: "exposure",
        nodes: [
          { label: "Tenant Directory Takeover", detail: "Non-admin owner can rotate credentials on privileged SPNs", tone: "critical" },
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
      title: "Selected Anchor",
      edgeLabel: "matches",
      nodes: [
        { label: card.selectionText, detail: refinementText ? `+ "${refinementText}"` : "Highlighted in ticket", tone: "meta" },
        ... card.kpis.slice(0, 2).map((k) => ({ label: `${k.label}: ${k.value}`, detail: "Live telemetry aggregate", tone: TONE[k.tone] })),
      ],
    },
    {
      title: "Matched Objects",
      edgeLabel: "enforces",
      nodes: primaryNodes.length ? primaryNodes : [{ label: "0 objects", detail: card.subtitle, tone: "warning" }],
    },
    {
      title: "Posture & Controls",
      edgeLabel: "causes",
      nodes: detailNodes.length ? detailNodes : stateNodes,
    },
    {
      title: "Blast Radius",
      edgeLabel: "mitigation",
      nodes: [
        ...stateNodes.slice(0, 2),
        { label: card.suggestedAction.label, detail: card.suggestedAction.scriptPreview.split("\n")[0] ?? "", tone: "healthy" },
      ],
    },
  ];
}

export const MINI_TONE = TONE;
