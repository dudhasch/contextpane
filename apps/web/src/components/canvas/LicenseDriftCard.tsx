import { BadgeAlert, BadgeCheck } from "lucide-react";
import type { LicenseDriftCard as Props, Provenance } from "@contextpane/catalog";
import { fmtUsd } from "@/lib/format";
import { Pill, type Tone } from "../ui/Pill";
import { CardShell } from "./CardShell";

const DRIFT_TONE: Record<string, Tone> = { compliant: "healthy", drifted: "warning", unassigned: "critical" };

/**
 * Compact label for long SKU part numbers so the CURRENT / EXPECTED columns
 * never collide: every segment but the last is cut to 4 characters
 * (INFORMATION_PROTECTION_COMPLIANCE → INFO_PROT_COMPLIANCE). The full part
 * number stays in the tooltip.
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

function SkuBadge({ sku, muted = false }: { sku: string; muted?: boolean }) {
  const short = shortSku(sku);
  return (
    <span
      title={sku}
      className={`inline-block max-w-full rounded border border-slate-700 bg-slate-800/90 px-2 py-0.5 font-mono text-xs whitespace-nowrap ${muted ? "text-muted" : "text-text"}`}
    >
      {short}
    </span>
  );
}

export function LicenseDriftCardView({ props, provenance, repaired }: { props: Props; provenance: Provenance; repaired?: boolean }) {
  const missing = props.driftedCount;
  return (
    <CardShell
      type="LicenseDriftCard"
      icon={missing ? <BadgeAlert /> : <BadgeCheck />}
      title={`${props.skuName} · ${props.skuPartNumber}`}
      state={props.state}
      statePill={
        <Pill tone={missing ? "warning" : "healthy"}>
          {props.entraAssignedCount}/{props.erpBilledCount} Assigned • {missing} Missing
        </Pill>
      }
      provenance={provenance}
      repaired={repaired}
      right={
        props.burnRateDeltaUsdPerMonth !== undefined && props.burnRateDeltaUsdPerMonth > 0 ? (
          <Pill tone="critical" title="Billed by the ERP but not delivered in Entra">
            +{fmtUsd(props.burnRateDeltaUsdPerMonth)}/mo burn
          </Pill>
        ) : null
      }
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>
          Group <span className="font-mono text-text">{props.groupName}</span>
        </span>
        <span>
          Contract <span className="font-mono text-text">{props.contractId}</span>
        </span>
        {props.monthlyUnitPriceUsd !== undefined && (
          <span>
            Unit <span className="font-mono text-text">{fmtUsd(props.monthlyUnitPriceUsd)}/mo</span>
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-md border border-border-subtle">
        <table className="w-full table-fixed text-[11.5px]">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[22%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-surface text-[10px] uppercase tracking-wider text-faint">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">User</th>
              <th className="px-3 py-1.5 text-left font-medium">Role</th>
              <th className="px-3 py-1.5 text-left font-medium">Current</th>
              <th className="px-3 py-1.5 text-left font-medium">Expected</th>
              <th className="px-3 py-1.5 text-right font-medium">Drift</th>
            </tr>
          </thead>
          <tbody>
            {props.users.map((u) => (
              <tr key={u.upn} className={`border-t border-border-subtle ${u.driftStatus !== "compliant" ? "bg-warning/5" : ""}`}>
                <td className="px-3 py-1.5 align-middle">
                  <div className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap" title={u.upn}>
                    <span className="shrink-0 leading-tight">{u.displayName}</span>
                    <span className="truncate font-mono text-[10px] text-faint">{u.upn}</span>
                  </div>
                </td>
                <td className="truncate px-3 py-1.5 align-middle text-muted" title={u.jobTitle}>
                  {u.jobTitle}
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <SkuBadge sku={u.currentSku} />
                </td>
                <td className="px-3 py-1.5 align-middle">
                  <SkuBadge sku={u.expectedSku} muted />
                </td>
                <td className="px-3 py-1.5 text-right align-middle">
                  <Pill tone={DRIFT_TONE[u.driftStatus] ?? "muted"} icon={u.driftStatus === "compliant" ? <BadgeCheck /> : <BadgeAlert />}>
                    {u.driftStatus}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardShell>
  );
}
