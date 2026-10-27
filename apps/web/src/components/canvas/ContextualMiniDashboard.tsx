import { ClipboardCopy, Sparkles, Wand2, Wrench, X } from "lucide-react";
import { useCallback } from "react";
import type { ContextualMiniDashboard as Card, MetricTone } from "@contextpane/catalog";
import { fmtMs } from "@/lib/format";
import { useWorkbench, type MiniDashboardEntry } from "@/store";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const TONE: Record<MetricTone, Tone> = { default: "muted", warning: "warning", critical: "critical", success: "healthy" };
const TONE_TEXT: Record<MetricTone, string> = { default: "text-text", warning: "text-warning", critical: "text-critical", success: "text-healthy" };
const TONE_BAR: Record<MetricTone, string> = { default: "bg-primary/70", warning: "bg-warning", critical: "bg-critical", success: "bg-healthy" };

const BAD = /noncompliant|conflict|error|drifted|orphaned|failure|expired|rogue|critical|high|report|unverified|disabled|missing|countviolation/i;
const GOOD = /^(compliant|active|reclaimed|success|in-sync|available|enabled|low|verified|healthy|allow)$/i;

function classify(row: Record<string, unknown>): RowStatus {
  const values = Object.values(row).map((v) => String(v ?? ""));
  if (values.some((v) => BAD.test(v))) return "bad";
  if (values.some((v) => GOOD.test(v))) return "good";
  return "other";
}

/**
 * A ContextualMiniDashboard spawned from highlighted text: cyan provenance, KPI tiles, a
 * proportional breakdown, the dynamic table (filter chips + cross-card identity highlight)
 * and the targeted action. Mounted above the macro cards; dismissed with one click.
 */
export function ContextualMiniDashboardCard({ entry }: { entry: MiniDashboardEntry }) {
  const card: Card = entry.card;
  const dismiss = useWorkbench((s) => s.dismissMiniDashboard);
  const linked = useWorkbench((s) => s.linkedSelection);
  const toast = useWorkbench((s) => s.toast);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  const classifier = useCallback((r: Record<string, unknown>) => classify(r), []);
  const { chip, setChip, counts, filtered } = useStatusFilter(card.rows, classifier);
  const pulsing = linked === entry.id;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "healthy", title: `${what} copied`, detail: text.slice(0, 120) });
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <section
      id={`mini-${entry.id}`}
      data-mini-dashboard={entry.id}
      data-selection-index={entry.index}
      style={{ ["--cat" as string]: "var(--color-selection)", ["--flash-color" as string]: "var(--color-selection)" }}
      className={`card scroll-mt-2 animate-fade-in border-l-4 border-l-selection transition-[box-shadow] duration-150 ${pulsing ? "ring-2 ring-selection animate-pulse-ring" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-selection" />
        <h3 className="min-w-[200px] flex-1 text-[13px] font-semibold leading-snug" title={card.title}>
          {card.title}
        </h3>
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-selection/45 bg-selection/12 px-1.5 font-mono text-[10.5px] text-selection" title={`Selection #${entry.index} · ${entry.modelId} · ${entry.tokenCount} tokens`} data-testid="selection-badge">
          <Wand2 className="size-3" />
          Spawned from selection: "{card.selectionText.length > 28 ? `${card.selectionText.slice(0, 27)}…` : card.selectionText}" · {fmtMs(entry.latencyMs)}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="xs" variant="outline" icon={<ClipboardCopy />} onClick={() => void copy(card.sourceQuery, "Graph/PowerShell query")} title={card.sourceQuery}>
            Copy Graph/PowerShell Query
          </Button>
          <button type="button" onClick={() => dismiss(entry.id)} aria-label="Dismiss mini-dashboard" className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-muted hover:bg-surface hover:text-text">
            <X className="size-3" /> Dismiss
          </button>
        </div>
      </header>
      <div className="mt-1 truncate font-mono text-[10.5px] text-faint" title={card.sourceQuery}>
        {card.subtitle}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {card.kpis.map((k) => (
          <div key={k.label} className="rounded-md border border-border-subtle bg-surface px-2 py-1" data-testid="mini-kpi">
            <div className="text-[10px] tracking-wider text-faint uppercase">{k.label}</div>
            <div className={`font-mono text-[13px] font-semibold ${TONE_TEXT[k.tone]}`}>{k.value}</div>
          </div>
        ))}
      </div>

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
                        const cell = c.isBadge ? <Pill tone={BAD.test(text) ? "critical" : GOOD.test(text) ? "healthy" : "muted"}>{text}</Pill> : <span className={`${c.mono ? "font-mono" : ""} ${text.length > 48 ? "block max-w-[320px] truncate" : ""}`} title={text}>{text}</span>;
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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
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

export const MINI_TONE = TONE;
