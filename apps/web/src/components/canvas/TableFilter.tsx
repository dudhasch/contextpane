import { Filter, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useWorkbench, type RowFilter } from "@/store";

/**
 * Interactive status filter chips and cross-card identity highlighting for the
 * expanded table views: `All (N) | Drifted / Error (M) | Compliant / Active (K)` filters rows
 * locally in 0 ms, and clicking a user or device row highlights that identity on every
 * open card (`filtered: lynne.robins ×` in the lens header).
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

/** Status filter as header count toggles: text-12, the active one in `text-text` with a 2px signal underline, counts in faint mono. */
export function FilterChips({ chip, counts, onChange, testId }: { chip: StatusChip; counts: Record<StatusChip, number>; onChange: (c: StatusChip) => void; testId?: string }) {
  return (
    <div className="mb-1 flex min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Filter rows" data-testid={testId ?? "filter-chips"}>
      <Filter className="size-3 shrink-0 text-faint" aria-hidden />
      {(["all", "bad", "good"] as StatusChip[]).map((c) => {
        const active = chip === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c)}
            data-chip={c}
            className={`relative inline-flex h-6 shrink-0 items-center gap-1 text-12 whitespace-nowrap transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
          >
            {CHIP_LABEL[c]}
            <span className="font-mono text-11 text-faint">{counts[c]}</span>
            {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
          </button>
        );
      })}
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
  if (!filter) return "cursor-pointer hover:bg-raised/60";
  return matchesRowFilter(filter, candidate) ? "cursor-pointer bg-signal/10 shadow-[inset_2px_0_0_var(--signal)]" : "cursor-pointer opacity-45 hover:opacity-80";
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
      className={`min-w-0 max-w-full text-left ${active ? "text-signal" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/** `filtered: lynne.robins ×` marker shown in the canvas breadcrumb while a cross-card filter is active. */
export function RowFilterPill() {
  const filter = useWorkbench((s) => s.rowFilter);
  const setRowFilter = useWorkbench((s) => s.setRowFilter);
  if (!filter) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-11 text-signal" data-testid="row-filter-pill">
      filtered: {identityLabel(filter)}
      <button type="button" onClick={() => setRowFilter(null)} aria-label="Clear identity filter" className="grid size-4 place-items-center rounded text-muted hover:bg-raised hover:text-text">
        <X className="size-3" />
      </button>
    </span>
  );
}
