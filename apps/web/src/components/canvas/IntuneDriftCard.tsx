import { MonitorCog, Wrench } from "lucide-react";
import { useCallback } from "react";
import type { IntuneDevice, IntuneDriftCard as Props } from "@contextpane/catalog";
import { fmtTimeUtc } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable, Stat } from "./CardShell";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const classifyDevice = (d: IntuneDevice): RowStatus => (d.complianceState === "Compliant" ? "good" : "bad");

/** Devices tab: status chips and clickable device / user cells that highlight the identity across the canvas. */
function DevicesTable({ devices }: { devices: IntuneDevice[] }) {
  const classify = useCallback(classifyDevice, []);
  const { chip, setChip, counts, filtered } = useStatusFilter(devices, classify);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  return (
    <div>
      <FilterChips chip={chip} counts={counts} onChange={setChip} testId="intune-filter-chips" />
      <DataTable
        head={["Device", "User", "Compliance", "Last check-in", "Detail"]}
        rowClassName={(i) => rowHighlightClass(rowFilter, { upn: filtered[i]?.upn ?? null, deviceName: filtered[i]?.deviceName ?? null })}
        rows={filtered.map((d) => [
          <IdentityCell kind="device" value={d.deviceName}>
            <span className="font-mono">{d.deviceName}</span>
          </IdentityCell>,
          <IdentityCell kind="upn" value={d.upn}>
            <span className="font-mono text-[10.5px] text-muted">{d.upn.split("@")[0]}</span>
          </IdentityCell>,
          <Pill tone={COMPLIANCE_TONE[d.complianceState]}>{d.complianceState}</Pill>,
          <span className="font-mono text-faint">{fmtTimeUtc(d.lastCheckIn)}</span>,
          <span className="text-[11px] text-muted">{d.detail}</span>,
        ])}
      />
    </div>
  );
}

const COMPLIANCE_TONE: Record<IntuneDevice["complianceState"], Tone> = {
  Compliant: "healthy",
  InGracePeriod: "warning",
  NonCompliant: "critical",
  Conflict: "critical",
  Error: "critical",
};

/** Intune Policy & Compliance Drift card (violet). */
export function IntuneDriftCardView({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const open = props.settings.filter((s) => s.status !== "in-sync");
  const live = props.policies.some((p) => p.source === "live-graph");
  return (
    <CardShell
      type="IntuneDriftCard"
      icon={<MonitorCog />}
      title={props.issueKind === "policy-conflict" ? "Intune Policy Conflict & Device Compliance" : "Intune Baseline Drift vs Golden Baseline"}
      state={props.state}
      triggeredBy={triggeredBy}
      source={live ? "live Intune (lab)" : "devices: fixture"}
      codeLens={props.sourceRef}
      tabs={[
        { id: "settings", label: "Setting-Level Drift Diff", badge: open.length },
        { id: "devices", label: "Affected Devices & Compliance", badge: props.affectedDeviceCount },
      ]}
      summary={<div className="text-[12.5px] leading-snug">{props.headline}</div>}
      primaryAction={
        open.length > 0 && (
          <Button size="xs" variant="meta" icon={<Wrench />} loading={remediateStatus === "loading"} onClick={() => openRemediation({ tab: "powershell" })}>
            Stage Intune Policy Fix
          </Button>
        )
      }
    >
      {(tab) => (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">
            {props.errorCode && (
              <Stat label="Error:" tone={props.affectedDeviceCount ? "critical" : "healthy"}>
                {props.errorCode}
              </Stat>
            )}
            <Stat label="Affected devices:" tone={props.affectedDeviceCount ? "critical" : "healthy"}>
              {props.affectedDeviceCount}/{props.devices.length}
            </Stat>
            <Stat label="Settings off-baseline:" tone={open.length ? "warning" : "healthy"}>
              {open.length}
            </Stat>
          </div>
          {tab === "devices" ? (
            <DevicesTable devices={props.devices} />
          ) : (
            <div className="space-y-2">
              {props.errorMeaning && <div className="rounded-md border border-meta/40 bg-meta/8 px-2.5 py-1.5 text-[11.5px] text-text">{props.errorMeaning}</div>}
              <DataTable
                head={["Setting", "Golden (Git)", "Live (Graph)", "Status", "CSP / Registry"]}
                rows={props.settings.map((s) => {
                  const csp = s as { cspUri?: string; registryPath?: string; tattooedOnUnassign?: boolean };
                  return [
                    <div title={s.settingId}>
                      <div className="leading-tight">{s.settingName}</div>
                      <div className="font-mono text-[10px] text-faint">{s.policyName}</div>
                    </div>,
                    <span className="font-mono text-healthy">{s.golden}</span>,
                    <span className={`font-mono ${s.status === "in-sync" ? "text-healthy" : "text-critical"}`}>{s.live}</span>,
                    <Pill tone={s.status === "in-sync" ? "healthy" : s.status === "conflict" ? "critical" : "warning"}>{s.status}</Pill>,
                    <div className="max-w-[340px] space-y-1 break-all whitespace-normal">
                      {csp.cspUri && <div className="font-mono text-[10px] leading-snug break-all whitespace-normal text-faint" title={csp.cspUri}>{csp.cspUri}</div>}
                      {csp.registryPath && <div className="font-mono text-[10px] leading-snug break-all whitespace-normal text-faint" title={csp.registryPath}>{csp.registryPath}</div>}
                      {csp.tattooedOnUnassign && <Pill tone="warning">tattooed on unassign</Pill>}
                      {!csp.cspUri && !csp.registryPath && !csp.tattooedOnUnassign && <span className="text-faint">—</span>}
                    </div>,
                  ];
                })}
              />
              <div className="flex flex-wrap gap-1.5">
                {props.policies.map((p) => (
                  <Pill
                    key={p.id}
                    tone={p.role === "duplicate" || p.role === "conflicting" ? (p.assignedTo.length ? "critical" : "healthy") : p.role === "drifted" ? "warning" : "muted"}
                    title={`${p.kind} · ${p.source === "live-graph" ? "live" : "fixture"}`}
                  >
                    {p.name} · {p.role} · {p.assignedTo.join(", ") || "unassigned"}
                  </Pill>
                ))}
              </div>
              <div className="font-mono text-[10px] text-faint">golden source: {props.goldenSource}</div>
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}
