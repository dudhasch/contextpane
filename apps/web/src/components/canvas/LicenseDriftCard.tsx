import { BadgeCheck, Wrench } from "lucide-react";
import { useCallback } from "react";
import type { AssignmentState, LicenseDriftCard as Props, LicenseDriftUser } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable, Stat } from "./CardShell";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const classifyUser = (u: LicenseDriftUser): RowStatus => (u.assignmentState === "Active" || u.assignmentState === "Reclaimed" ? "good" : "bad");

/** Assignments tab: status chips (0 ms, local) and clickable UPNs that highlight the identity on every card. */
function UsersTable({ users }: { users: LicenseDriftUser[] }) {
  const classify = useCallback(classifyUser, []);
  const { chip, setChip, counts, filtered } = useStatusFilter(users, classify);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  return (
    <div>
      <FilterChips chip={chip} counts={counts} onChange={setChip} testId="license-filter-chips" />
      <DataTable
        head={["User", "Account", "Assigned SKU", "Expected SKU", "Path", "Assignment State"]}
        rowClassName={(i) => rowHighlightClass(rowFilter, { upn: filtered[i]?.upn ?? null })}
        rows={filtered.map((u) => [
          <IdentityCell kind="upn" value={u.upn} className="min-w-0">
            <div title={u.upn}>
              <div className="leading-tight">{u.displayName}</div>
              <div className="truncate font-mono text-[10px] text-faint">{u.upn}</div>
            </div>
          </IdentityCell>,
          <span className={u.accountEnabled ? "text-text" : "text-warning"}>
            {u.accountEnabled ? "Enabled" : "Disabled"}
            {u.lastSignIn && !u.accountEnabled ? <span className="block font-mono text-[10px] text-faint">last {u.lastSignIn.slice(0, 10)}</span> : null}
          </span>,
          <SkuBadges skus={u.currentSku} />,
          <SkuBadges skus={u.expectedSku} muted />,
          <span className="font-mono text-[11px] whitespace-nowrap text-muted">
            {u.assignmentPath.replace(/\bgroupBasedLicensing\b/g, "Group-Based Licensing").replace(/\bdirectAssignment\b/g, "Direct Assignment")}
          </span>,
          <Pill tone={STATE_TONE[u.assignmentState]}>{u.assignmentState}</Pill>,
        ])}
      />
    </div>
  );
}

const STATE_TONE: Record<AssignmentState, Tone> = {
  Active: "healthy",
  Reclaimed: "healthy",
  Drifted: "warning",
  "Error: CountViolation": "critical",
  Orphaned: "critical",
};

/**
 * Compact label for long SKU part numbers so the columns never collide: every
 * segment but the last is cut to 4 characters (INFORMATION_PROTECTION_COMPLIANCE →
 * INFO_PROT_COMPLIANCE). The full part number stays in the tooltip.
 */
export function shortSku(sku: string, max = 16): string {
  if (sku.length <= max) return sku;
  const parts = sku.split("_");
  if (parts.length === 1) return `${sku.slice(0, max - 1)}…`;
  const last = parts[parts.length - 1]!;
  const head = parts.slice(0, -1).map((p) => p.slice(0, 4));
  const out = [...head, last].join("_");
  return out.length <= max + 6 ? out : `${out.slice(0, max + 5)}…`;
}

/** Expanded-tab only: Git ↔ Live Graph ↔ Pax8 contract seat paths. Nothing on the collapsed card. */
function CommercialSubTab() {
  const rec = useWorkbench((s) => s.commercial);
  const loadOps = useWorkbench((s) => s.loadOps);
  if (!rec) return <button type="button" onClick={() => void loadOps()} className="text-[11.5px] text-primary hover:underline">Load License &amp; Cost Impact…</button>;
  const e5Sku = rec.skus?.find((s) => s.sku === "SPE_E5");
  const hasIdlePoolSeats = Boolean(e5Sku && e5Sku.available >= 3 && e5Sku.consumed === 12);
  return (
    <div className="space-y-2.5 text-[11.5px]" data-testid="commercial-subtab">
      <div>
        <div className="text-[12px] font-semibold text-text">License &amp; Cost Impact</div>
        <div className="text-[11px] text-muted">
          {hasIdlePoolSeats
            ? "80% used · 3 unassigned seats ready for the 3 Finance users — $0.00/mo extra cost"
            : "Contract vs. Billed vs. Active Entra Seats — $0 extra cost"}
        </div>
      </div>
      {rec.skus && rec.skus.length > 0 && (
        <DataTable
          head={["License", "Customer Contract", "Billed by Vendor (Pax8)", "Assigned in Entra ID"]}
          rows={rec.skus.map((s) => {
            const pct = s.enabled > 0 ? Math.round((s.consumed / s.enabled) * 100) : 0;
            return [
              <div>
                <div className="font-medium text-text">{s.skuName}</div>
                <div className="font-mono text-[10px] text-faint">{s.sku}</div>
              </div>,
              <span className="font-mono">{s.prepaid} seats</span>,
              <span className="font-mono">{s.enabled} seats (${s.unitPriceMonthly}/mo)</span>,
              <span className="font-mono">
                {s.consumed} active ·{" "}
                <span className={s.available > 0 ? "text-healthy" : "text-warning"}>
                  {s.available} free ({pct}% used)
                </span>
                {s.available === 0 && s.orphaned > 0 ? (
                  <span className="text-warning"> · {s.orphaned} inactive &gt;90d reclaimable</span>
                ) : null}
              </span>,
            ];
          })}
        />
      )}
      <div className="space-y-1 rounded-md border border-emerald-500/25 bg-emerald-500/8 px-2.5 py-1.5">
        {hasIdlePoolSeats ? (
          <div>
            <span className="font-medium text-healthy">Recommended (Assign 3 Available Pool Seats):</span>{" "}
            <span className="text-muted">80% used · 3 unassigned seats ready for the 3 Finance users — $0.00/mo extra cost</span>
          </div>
        ) : (
          <div>
            <span className="font-medium text-healthy">Recommended ({rec.pathA.label}):</span>{" "}
            <span className="text-muted">$0/mo net · ${rec.pathA.wasteEliminatedMonthly}/mo waste eliminated</span>
          </div>
        )}
        <div><span className="text-muted">Alternative ({rec.pathB.label}): +${rec.pathB.netDeltaMonthly}/mo prorated ({rec.contractId})</span></div>
      </div>
    </div>
  );
}

function SkuBadges({ skus, muted = false }: { skus: string; muted?: boolean }) {
  const list = skus.split(",").map((s) => s.trim());
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((sku) => (
        <span key={sku} title={sku} className={`inline-block rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${muted || sku === "NONE" ? "text-muted" : "text-text"}`}>
          {shortSku(sku)}
        </span>
      ))}
    </span>
  );
}

/** License Pool & Assignment card (amber). */
export function LicenseDriftCardView({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const open = props.users.filter((u) => u.assignmentState !== "Active" && u.assignmentState !== "Reclaimed");
  const errors = props.groupErrors.reduce((n, e) => n + e.affectedUsers, 0);
  const live = props.skuPools.some((p) => p.source === "live-graph");
  return (
    <CardShell
      type="LicenseDriftCard"
      icon={<BadgeCheck />}
      title={`License Pool & Assignment · ${props.groupName}`}
      state={props.state}
      triggeredBy={triggeredBy}
      source={live ? "live subscribedSkus" : "Source: Entra ID License Pool"}
      tabs={[
        { id: "users", label: "Assignments", badge: props.users.length },
        { id: "pool", label: "SKU Pools", badge: props.skuPools.length },
        { id: "commercial", label: "Billing & Seat Check ($0 Extra Cost)" },
      ]}
      summary={<div className="text-[12.5px] leading-snug">{props.headline}</div>}
      primaryAction={
        open.length > 0 && (
          <Button
            size="xs"
            variant="meta"
            icon={<Wrench />}
            loading={remediateStatus === "loading"}
            onClick={() => openRemediation({ tab: "powershell", focusBanner: "Focused: License Pool & Group Remediation" })}
          >
            Stage License Remediation
          </Button>
        )
      }
    >
      {(tab) => (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">
            {props.skuPools.map((p) => (
              <Stat key={p.skuPartNumber} label={`${p.skuPartNumber} Pool:`} tone={p.available <= 0 ? "critical" : undefined}>
                {p.skuPartNumber === props.skuPartNumber || !p.note ? `${p.consumed}/${p.enabled} assigned · ${p.available} available` : p.note}
              </Stat>
            ))}
            <Stat label="Group Errors:" tone={errors ? "critical" : "healthy"}>
              {props.groupErrors.length ? props.groupErrors.map((e) => `${e.state} (${e.affectedUsers})`).join(", ") : "0"}
            </Stat>
          </div>
          {tab === "commercial" ? (
            <CommercialSubTab />
          ) : tab === "pool" ? (
            <div className="space-y-2">
              <DataTable
                head={["SKU", "Enabled", "Consumed", "Available", "Source"]}
                rows={props.skuPools.map((p) => [
                  <span title={p.skuName} className="font-mono">
                    {p.skuPartNumber}
                  </span>,
                  <span className="font-mono">{p.enabled}</span>,
                  <span className="font-mono">{p.consumed}</span>,
                  <span className={`font-mono ${p.available <= 0 ? "text-critical" : "text-healthy"}`}>{p.available}</span>,
                  <span className="text-faint">{p.source === "live-graph" ? "live Graph" : "Entra ID License Pool"}</span>,
                ])}
              />
              {props.groupErrors.map((e) => (
                <div key={e.groupName + e.skuPartNumber} className="rounded-md border border-critical/30 bg-critical/8 px-2.5 py-1.5 text-[11.5px]">
                  <span className="font-mono text-critical">{e.groupName} · State: Error · {e.state}</span>
                  <div className="text-muted">{e.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <UsersTable users={props.users} />
          )}
        </div>
      )}
    </CardShell>
  );
}
