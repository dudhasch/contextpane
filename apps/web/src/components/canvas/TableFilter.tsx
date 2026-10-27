import { Filter, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useWorkbench, type RowFilter } from "@/store";

/**
 * Interactive status filter chips and cross-card identity highlighting for the
 * expanded table views: `All (N) | Drifted / Error (M) | Compliant / Active (K)` filters rows
 * locally in 0 ms, and clicking a user or device row highlights that identity on every
 * open card (`Filtered by: lynne.robins [×]` in the canvas breadcrumb).
 */

export type RowStatus = "bad" | "good" | "other";
export type StatusChip = "all" | "bad" | "good";

const CHIP_LABEL: Record<StatusChip, string> = { all: "All", bad: "Drifted / Error", good: "Compliant / Active" };

export function useStatusFilter<T>(rows: T[], classify: (row: T) => RowStatus) {
  const [chip, setChip] = useState<StatusChip>("all");
  const counts = useMemo(() => {
    const c = { all: rows.length, bad: 0, good: 0 };
    for (const r of rows) {
      const s = classify(r);
      if (s === "bad") c.bad++;
      else if (s === "good") c.good++;
    }
    return c;
  }, [rows, classify]);
  const filtered = useMemo(() => (chip === "all" ? rows : rows.filter((r) => classify(r) === chip)), [rows, chip, classify]);
  return { chip, setChip, counts, filtered };
}

export function FilterChips({ chip, counts, onChange, testId }: { chip: StatusChip; counts: Record<StatusChip, number>; onChange: (c: StatusChip) => void; testId?: string }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="Filter rows" data-testid={testId ?? "filter-chips"}>
      <Filter className="size-3 text-faint" />
      {(["all", "bad", "good"] as StatusChip[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={chip === c}
          onClick={() => onChange(c)}
          data-chip={c}
          className={`inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10.5px] transition-colors ${chip === c ? (c === "bad" ? "border-critical/50 bg-critical/12 text-critical" : c === "good" ? "border-healthy/50 bg-healthy/12 text-healthy" : "border-primary/50 bg-primary/12 text-primary") : "border-border text-faint hover:text-text"}`}
        >
          {CHIP_LABEL[c]} <span className="opacity-80">({counts[c]})</span>
        </button>
      ))}
    </div>
  );
}

/** Short identity label: lynne.robins for a UPN, the device name as is. */
export function identityLabel(filter: RowFilter): string {
  return filter.kind === "upn" ? filter.value.split("@")[0]!.replace(/\.(contoso|legal)$/, "") : filter.value;
}

export function matchesRowFilter(filter: RowFilter | null, candidate: { upn?: string | null; deviceName?: string | null }): boolean {
  if (!filter) return false;
  const value = filter.value.toLowerCase();
  if (filter.kind === "upn") return Boolean(candidate.upn && candidate.upn.toLowerCase() === value);
  return Boolean(candidate.deviceName && candidate.deviceName.toLowerCase() === value);
}

/** Row class names for the cross-card highlight: the matching identity lights up, the rest dim. */
export function rowHighlightClass(filter: RowFilter | null, candidate: { upn?: string | null; deviceName?: string | null }): string {
  if (!filter) return "cursor-pointer hover:bg-surface/60";
  return matchesRowFilter(filter, candidate) ? "cursor-pointer bg-selection/12 ring-1 ring-inset ring-selection/50" : "cursor-pointer opacity-45 hover:opacity-80";
}

/** Clickable identity cell: sets (or clears) the cross-card filter. */
export function IdentityCell({ kind, value, children, className = "" }: { kind: RowFilter["kind"]; value: string; children: ReactNode; className?: string }) {
  const filter = useWorkbench((s) => s.rowFilter);
  const setRowFilter = useWorkbench((s) => s.setRowFilter);
  const active = Boolean(filter && filter.kind === kind && filter.value.toLowerCase() === value.toLowerCase());
  return (
    <button
      type="button"
      data-identity={value}
      onClick={(e) => {
        e.stopPropagation();
        setRowFilter(active ? null : { kind, value });
      }}
      title={active ? "Clear the cross-card filter" : `Highlight ${value} across every open card`}
      className={`min-w-0 max-w-full text-left ${active ? "text-selection" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/** `Filtered by: lynne.robins [×]` pill shown in the canvas breadcrumb while a cross-card filter is active. */
export function RowFilterPill() {
  const filter = useWorkbench((s) => s.rowFilter);
  const setRowFilter = useWorkbench((s) => s.setRowFilter);
  if (!filter) return null;
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-selection/45 bg-selection/12 pr-0.5 pl-1.5 font-mono text-[10.5px] text-selection" data-testid="row-filter-pill">
      Filtered by: {identityLabel(filter)}
      <button type="button" onClick={() => setRowFilter(null)} aria-label="Clear identity filter" className="grid size-4 place-items-center rounded hover:bg-selection/25">
        <X className="size-3" />
      </button>
    </span>
  );
}
