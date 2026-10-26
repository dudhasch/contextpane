import { BadgeAlert, BadgeCheck } from "lucide-react";
import type { LicenseDriftCard as Props, Provenance } from "@contextpane/catalog";
import { fmtUsd } from "@/lib/format";
import { Pill, type Tone } from "../ui/Pill";
import { CardShell } from "./CardShell";

const DRIFT_TONE: Record<string, Tone> = { compliant: "healthy", drifted: "warning", unassigned: "critical" };

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
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
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
        <table className="w-full text-[11.5px]">
          <thead className="bg-surface text-[10px] uppercase tracking-wider text-faint">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-medium">User</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Role</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Current</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Expected</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Drift</th>
            </tr>
          </thead>
          <tbody>
            {props.users.map((u) => (
              <tr key={u.upn} className={`h-7 border-t border-border-subtle ${u.driftStatus !== "compliant" ? "bg-warning/5" : ""}`}>
                <td className="px-2.5 py-1">
                  <div className="leading-tight">{u.displayName}</div>
                  <div className="font-mono text-[10px] text-faint">{u.upn}</div>
                </td>
                <td className="px-2.5 py-1 text-muted">{u.jobTitle}</td>
                <td className="px-2.5 py-1 font-mono">{u.currentSku}</td>
                <td className="px-2.5 py-1 font-mono text-muted">{u.expectedSku}</td>
                <td className="px-2.5 py-1 text-right">
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
