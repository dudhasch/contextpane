import type { Convergence, ScenarioListItem, WorkItemOrigin } from "@contextpane/catalog";
import type { Tone } from "@/components/ui/Pill";

/**
 * The unified work queue: PSA tickets, live Graph anomalies, ERP file drops and pasted tickets
 * are one stream. The origin only decides the badge; the status pill is the same vocabulary the
 * left-pane header uses.
 */

export const ORIGIN_META: Record<WorkItemOrigin, { label: string; short: string; tone: Tone }> = {
  psa: { label: "PSA Ticket", short: "Ticket", tone: "primary" },
  anomaly: { label: "Live Graph Anomaly", short: "Anomaly", tone: "warning" },
  "erp-drop": { label: "ERP File Drop", short: "ERP Drop", tone: "meta" },
  unscripted: { label: "Ad-Hoc Triage", short: "Unscripted", tone: "healthy" },
};

export const ORIGIN_ORDER: WorkItemOrigin[] = ["psa", "anomaly", "erp-drop", "unscripted"];

export type WorkItemStatus = "NEW" | "OPEN" | "ACTIVE DRIFT" | "RESOLVED ✓" | "CLOSED ✓";

export function statusOf(item: Pick<ScenarioListItem, "origin" | "resolved">, closed = false): { label: WorkItemStatus; tone: Tone } {
  if (closed) return { label: "CLOSED ✓", tone: "healthy" };
  if (item.resolved) return { label: "RESOLVED ✓", tone: "healthy" };
  if (item.origin === "erp-drop") return { label: "NEW", tone: "meta" };
  if (item.origin === "anomaly") return { label: "ACTIVE DRIFT", tone: "warning" };
  return { label: "OPEN", tone: "critical" };
}

/** Newest first; resolved items sink to the bottom. Position = numeric hotkey (1-9). */
/**
 * Unresolved before resolved, newest first. With `pinSeeded` the seeded demo tickets lead (PSA tickets,
 * then anomalies), so the 1-9 hotkeys reach them however many custom tickets arrived since.
 */
export function orderWorkItems(items: ScenarioListItem[], convergence: Partial<Record<string, Convergence>> = {}, options: { pinSeeded?: boolean } = {}): ScenarioListItem[] {
  const resolved = (i: ScenarioListItem) => i.resolved || Boolean(convergence[i.scenarioId]);
  const pin = (i: ScenarioListItem) => (!options.pinSeeded || i.custom ? 2 : i.origin === "psa" ? 0 : 1);
  return [...items].sort((a, b) => {
    const ra = resolved(a) ? 1 : 0;
    const rb = resolved(b) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    const pa = pin(a);
    const pb = pin(b);
    if (pa !== pb) return pa - pb;
    return b.createdAt.localeCompare(a.createdAt) || a.scenarioId.localeCompare(b.scenarioId);
  });
}

export type QueueFilter = "all" | WorkItemOrigin | "resolved";

export function matchesFilter(item: ScenarioListItem, filter: QueueFilter, convergence: Partial<Record<string, Convergence>> = {}): boolean {
  const done = item.resolved || Boolean(convergence[item.scenarioId]);
  if (filter === "all") return true;
  if (filter === "resolved") return done;
  return item.origin === filter;
}

/** Search over id, display id, title, tenant, requester, error codes and intents (an ERP drop's extraction). */
export function matchesQuery(item: ScenarioListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    item.scenarioId,
    item.displayId,
    item.title,
    item.tenantName,
    ORIGIN_META[item.origin].label,
    item.custom?.ticket.customerName ?? "",
    item.custom?.ticket.requester?.displayName ?? "",
    item.custom?.ticket.requester?.upn ?? "",
    ...(item.custom?.extraction.entities.map((e) => e.id) ?? []),
    ...(item.custom?.extraction.intents ?? []),
    item.custom?.erpDrop?.folder ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((part) => hay.includes(part));
}

/** "3 min ago", "2 h ago", "yesterday", "Oct 26". */
export function relativeAge(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
