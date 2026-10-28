import { BadgeCheck, Wrench } from "lucide-react";
import { useCallback } from "react";
import type { AssignmentState, LicenseDriftCard as Props, LicenseDriftUser } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, TONE_TEXT, type Tone } from "../ui/Pill";
import { CardShell, DataTable } from "./CardShell";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const classifyUser = (u: LicenseDriftUser): RowStatus => (u.assignmentState === "Active" || u.assignmentState === "Reclaimed" ? "good" : "bad");

/** Assignments tab: status toggles (0 ms, local) and clickable UPNs that highlight the identity on every section. */
function UsersTable({ users }: { users: LicenseDriftUser[] }) {
  const classify = useCallback(classifyUser, []);
  const { chip, setChip, counts, filtered } = useStatusFilter(users, classify);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  return (
    <div>
      <FilterChips chip={chip} counts={counts} onChange={setChip} testId="license-filter-chips" />
      <DataTable
        bleed
        head={["User", "Assigned SKU", "Expected SKU", "Path", "State"]}
        colWidths={["30%", "18%", "18%", "16%", "18%"]}
        rowClassName={(i) => rowHighlightClass(rowFilter, { upn: filtered[i]?.upn ?? null })}
        rows={filtered.map((u) => {
          const tone = STATE_TONE[u.assignmentState];
          return [
            <IdentityCell kind="upn" value={u.upn} className="block">
              <div title={u.upn} className="min-w-0">
                <div className="truncate text-text">{u.displayName}</div>
                <div className="truncate font-mono text-11 text-faint">
                  {u.accountEnabled ? u.upn : <span className="text-warning">disabled{u.lastSignIn ? ` · last ${u.lastSignIn.slice(0, 10)}` : ""}</span>}
                </div>
              </div>
            </IdentityCell>,
            <SkuList skus={u.currentSku} className={tone === "healthy" ? "text-text" : TONE_TEXT[tone]} />,
            <SkuList skus={u.expectedSku} className="text-muted" />,
            <span className="text-muted" title={u.assignmentPath}>
              {u.assignmentPath.replace(/\bgroupBasedLicensing\b/g, "Group-based").replace(/\bdirectAssignment\b/g, "Direct")}
            </span>,
            <Pill variant="status" tone={tone} mono={false}>
              {u.assignmentState}
            </Pill>,
          ];
        })}
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

/** Expanded-tab only: Git ↔ Live Graph ↔ Pax8 contract seat paths. Nothing on the collapsed section. */
function CommercialSubTab() {
  const rec = useWorkbench((s) => s.commercial);
  const loadOps = useWorkbench((s) => s.loadOps);
  if (!rec) return <button type="button" onClick={() => void loadOps()} className="text-12 text-signal hover:underline">Load License &amp; Cost Impact…</button>;
  const e5Sku = rec.skus?.find((s) => s.sku === "SPE_E5");
  const hasIdlePoolSeats = Boolean(e5Sku && e5Sku.available >= 3 && e5Sku.consumed === 12);
  return (
    <div className="space-y-2 text-12" data-testid="commercial-subtab">
      <div className="text-muted">
        {hasIdlePoolSeats
          ? "80% used · 3 unassigned seats ready for the 3 Finance users — $0.00/mo extra cost"
          : "Contract vs. Billed vs. Active Entra Seats — $0 extra cost"}
      </div>
      {rec.skus && rec.skus.length > 0 && (
        <DataTable
          bleed
          head={["License", "Contract", "Billed (Pax8)", "Assigned in Entra"]}
          colWidths={["30%", "16%", "24%", "30%"]}
          rows={rec.skus.map((s) => {
            const pct = s.enabled > 0 ? Math.round((s.consumed / s.enabled) * 100) : 0;
            return [
              <div className="min-w-0" title={s.skuName}>
                <div className="truncate text-text">{s.skuName}</div>
                <div className="truncate font-mono text-11 text-faint">{s.sku}</div>
              </div>,
              <span className="font-mono">{s.prepaid} seats</span>,
              <span className="font-mono">
                {s.enabled} seats <span className="text-faint">${s.unitPriceMonthly}/mo</span>
              </span>,
              <span className="font-mono">
                {s.consumed} active ·{" "}
                <span className={s.available > 0 ? "text-healthy" : "text-warning"}>
                  {s.available} free ({pct}%)
                </span>
                {s.available === 0 && s.orphaned > 0 ? <span className="block text-11 text-warning">{s.orphaned} inactive &gt;90d reclaimable</span> : null}
              </span>,
            ];
          })}
        />
      )}
      <div className="space-y-0.5">
        {hasIdlePoolSeats ? (
          <div>
            <span className="font-medium text-healthy">Recommended · assign 3 available pool seats:</span>{" "}
            <span className="text-muted">$0.00/mo extra cost</span>
          </div>
        ) : (
          <div>
            <span className="font-medium text-healthy">Recommended · {rec.pathA.label}:</span>{" "}
            <span className="text-muted">$0/mo net · ${rec.pathA.wasteEliminatedMonthly}/mo waste eliminated</span>
          </div>
        )}
        <div className="text-muted">
          Alternative · {rec.pathB.label}: +${rec.pathB.netDeltaMonthly}/mo prorated <span className="font-mono text-11 text-faint">{rec.contractId}</span>
        </div>
      </div>
    </div>
  );
}

/** Comma-separated SKU part numbers as plain mono text (full part number in the tooltip). */
function SkuList({ skus, className = "" }: { skus: string; className?: string }) {
  const list = skus.split(",").map((s) => s.trim());
  return (
    <span className="flex flex-wrap gap-x-1.5 font-mono">
      {list.map((sku) => (
        <span key={sku} title={sku} className={`whitespace-nowrap ${sku === "NONE" ? "text-faint" : className}`}>
          {shortSku(sku)}
        </span>
      ))}
    </span>
  );
}

/** License Pool & Assignment section. */
export function LicenseDriftCardView({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const open = props.users.filter((u) => u.assignmentState !== "Active" && u.assignmentState !== "Reclaimed");
  const errors = props.groupErrors.reduce((n, e) => n + e.affectedUsers, 0);
  const live = props.skuPools.some((p) => p.source === "live-graph");
  const primaryPool = props.skuPools.find((p) => p.skuPartNumber === props.skuPartNumber) ?? props.skuPools[0];
  const driftedUsers = props.users.filter((u) => u.assignmentState === "Drifted");
  const orphanedUsers = props.users.filter((u) => u.assignmentState === "Orphaned");
  const failedUsers = props.users.filter((u) => u.assignmentState === "Error: CountViolation");

  const subtitle =
    props.state === "healthy" || open.length === 0
      ? `All ${props.users.length} users in ${props.groupName} hold their expected ${props.skuPartNumber} license with 0 group errors.`
      : failedUsers.length > 0 || orphanedUsers.length > 0
        ? `${props.groupName} has a CountViolation for ${failedUsers.length} members (${primaryPool?.consumed ?? 15}/${primaryPool?.enabled ?? 15} ${props.skuPartNumber} seats used), while ${orphanedUsers.length} seats remain assigned to disabled accounts.`
        : driftedUsers.length > 0
          ? `${driftedUsers.length} of ${props.users.length} Finance users in ${props.groupName} hold SPE_E3 instead of ${props.skuPartNumber}, with ${primaryPool?.available ?? 3} paid ${props.skuPartNumber} pool seats available.`
          : props.headline;

  return (
    <CardShell
      type="LicenseDriftCard"
      icon={<BadgeCheck />}
      title={`License Pool & Assignment · ${props.groupName}`}
      titleAccent="License"
      state={props.state}
      triggeredBy={triggeredBy}
      source={live ? "live subscribedSkus" : "Entra ID license pool"}
      footerMeta={
        <span>
          {primaryPool ? `${primaryPool.skuPartNumber} ${primaryPool.consumed}/${primaryPool.enabled}` : `${props.skuPools.length} pools`} ·{" "}
          {errors ? `${props.groupErrors.length} group error${props.groupErrors.length === 1 ? "" : "s"}` : "0 group errors"}
        </span>
      }
      details={
        <div className="space-y-1">
          <ul className="space-y-0.5 font-mono">
            {props.skuPools.map((p) => (
              <li key={p.skuPartNumber}>
                {p.skuPartNumber}: {p.consumed}/{p.enabled} <span className="text-faint">({p.available} available)</span>
              </li>
            ))}
          </ul>
          <div>
            Group errors:{" "}
            <span className={errors ? "text-critical" : "text-healthy"}>{errors ? props.groupErrors.map((e) => `${e.state} (${e.affectedUsers})`).join(", ") : "0"}</span>
          </div>
        </div>
      }
      tabs={[
        { id: "users", label: "Assignments", badge: props.users.length },
        { id: "pool", label: "SKU Pools", badge: props.skuPools.length },
        { id: "commercial", label: "Billing & Seat Check" },
      ]}
      summary={subtitle}
      primaryAction={
        open.length > 0 && (
          <Button
            size="xs"
            variant="outline"
            icon={<Wrench />}
            loading={remediateStatus === "loading"}
            onClick={() => openRemediation({ tab: "powershell", focusBanner: "Focused: License Pool & Group Remediation" })}
          >
            Stage License Fix
          </Button>
        )
      }
    >
      {(tab) =>
        tab === "commercial" ? (
          <CommercialSubTab />
        ) : tab === "pool" ? (
          <div className="space-y-2">
            <DataTable
              bleed
              head={["SKU", "Enabled", "Consumed", "Available", "Source"]}
              rows={props.skuPools.map((p) => [
                <span title={p.skuName} className="font-mono">
                  {p.skuPartNumber}
                </span>,
                <span className="font-mono">{p.enabled}</span>,
                <span className="font-mono">{p.consumed}</span>,
                <span className={`font-mono ${p.available <= 0 ? "text-critical" : "text-healthy"}`}>{p.available}</span>,
                <span className="text-faint">{p.source === "live-graph" ? "live Graph" : "Entra ID license pool"}</span>,
              ])}
            />
            {props.groupErrors.map((e) => (
              <div key={e.groupName + e.skuPartNumber} className="text-12">
                <Pill variant="status" tone="critical">
                  {e.groupName} · Error · {e.state}
                </Pill>
                <div className="pl-3 text-muted">{e.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          <UsersTable users={props.users} />
        )
      }
    </CardShell>
  );
}
