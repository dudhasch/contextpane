import { MonitorCog, Wrench } from "lucide-react";
import { useCallback } from "react";
import type { IntuneDevice, IntuneDriftCard as Props } from "@contextpane/catalog";
import { fmtTimeUtc } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable, SmartTechPath } from "./CardShell";
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
        colWidths={["20%", "18%", "16%", "14%", "32%"]}
        cellPy="py-2"
        rowClassName={(i) => rowHighlightClass(rowFilter, { upn: filtered[i]?.upn ?? null, deviceName: filtered[i]?.deviceName ?? null })}
        rows={filtered.map((d) => [
          <IdentityCell kind="device" value={d.deviceName}>
            <span className="font-mono whitespace-nowrap">{d.deviceName}</span>
          </IdentityCell>,
          <IdentityCell kind="upn" value={d.upn}>
            <span className="font-mono text-[10.5px] whitespace-nowrap text-muted">{d.upn.split("@")[0]}</span>
          </IdentityCell>,
          <Pill tone={COMPLIANCE_TONE[d.complianceState]}>{d.complianceState}</Pill>,
          <span className="font-mono whitespace-nowrap text-faint">{fmtTimeUtc(d.lastCheckIn)}</span>,
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

function formatIntuneSubtitle(props: Props, openCount: number): string {
  const raw = props.headline.trim();
  if (props.state === "healthy" || openCount === 0) {
    return `All ${props.devices.length} Windows 11 devices are compliant and in sync with the golden Intune baseline.`;
  }
  if (props.issueKind === "policy-conflict") {
    return `${props.affectedDeviceCount} Windows 11 devices are NonCompliant (${props.errorCode ?? "0x87D1FDE8"}) due to a BitLocker encryption conflict between DiskEncryption and the legacy profile.`;
  }
  if (/^[0-9]+ Windows 11/i.test(raw) && raw.endsWith(".")) {
    return raw;
  }
  return `${props.affectedDeviceCount} Windows 11 workstations report a Firewall policy conflict, and the ASR LSASS credential-stealing rule drifted from Block to Audit.`;
}

/** Intune Policy & Compliance Drift card (violet). */
export function IntuneDriftCardView({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const open = props.settings.filter((s) => s.status !== "in-sync");
  const live = props.policies.some((p) => p.source === "live-graph");
  const subtitle = formatIntuneSubtitle(props, open.length);
  const profileSummary = `${props.policies.length} profiles evaluated (${props.policies.map((p) => p.name.replace(/^Fabrikam-/, "").replace(/-DeviceConfig$/, "")).join(", ")})`;

  return (
    <CardShell
      type="IntuneDriftCard"
      icon={<MonitorCog />}
      title={props.issueKind === "policy-conflict" ? "Intune Policy Conflict & Device Compliance" : "Intune Baseline Drift vs Golden Baseline"}
      state={props.state}
      triggeredBy={triggeredBy}
      source={live ? "· live Intune (lab)" : undefined}
      codeLens={props.sourceRef}
      footerMeta={<span title={`Golden source: ${props.goldenSource} · ${profileSummary}`}>· {profileSummary}</span>}
      tabs={[
        { id: "settings", label: "Setting-Level Drift Diff", badge: open.length },
        { id: "devices", label: "Affected Devices & Compliance", badge: props.affectedDeviceCount },
      ]}
      summary={<div className="text-[12.5px] leading-snug">{subtitle}</div>}
      primaryAction={
        open.length > 0 && (
          <Button
            size="xs"
            variant="meta"
            icon={<Wrench />}
            data-testid="stage-intune-fix"
            loading={remediateStatus === "loading"}
            onClick={() => openRemediation({ tab: "powershell" })}
          >
            Stage Intune Policy Fix
          </Button>
        )
      }
    >
      {(tab) =>
        tab === "devices" ? (
          <DevicesTable devices={props.devices} />
        ) : (
          <DataTable
            head={["Setting", "Golden (Git)", "Live (Graph)", "Status", "CSP / Registry"]}
            colWidths={["24%", "16%", "20%", "10%", "30%"]}
            cellPy="py-2.5"
            rows={props.settings.map((s) => {
              const csp = s as { cspUri?: string; registryPath?: string; tattooedOnUnassign?: boolean };
              return [
                <div className="min-w-0" title={`${s.settingName} (${s.settingId ?? s.policyName})`}>
                  <div className="font-medium leading-snug text-text">{s.settingName}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] whitespace-nowrap text-faint">{s.policyName}</div>
                </div>,
                <span className="font-mono text-[11px] font-medium text-healthy">{s.golden}</span>,
                <span className={`font-mono text-[11px] font-medium ${s.status === "in-sync" ? "text-healthy" : "text-critical"}`}>{s.live}</span>,
                <Pill tone={s.status === "in-sync" ? "healthy" : s.status === "conflict" ? "critical" : "warning"}>{s.status}</Pill>,
                <div className="min-w-0 space-y-1.5">
                  {csp.cspUri && <SmartTechPath path={csp.cspUri} />}
                  {csp.registryPath && (
                    <SmartTechPath
                      path={csp.registryPath}
                      badge={csp.tattooedOnUnassign ? <Pill tone="warning">tattooed</Pill> : undefined}
                    />
                  )}
                  {!csp.cspUri && !csp.registryPath && <span className="text-faint">—</span>}
                </div>,
              ];
            })}
          />
        )
      }
    </CardShell>
  );
}
