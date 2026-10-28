import { MonitorCog, Wrench } from "lucide-react";
import { useCallback } from "react";
import type { IntuneDevice, IntuneDriftCard as Props } from "@contextpane/catalog";
import { fmtTimeUtc, humanizeSlug, humanizeStatus } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { TONE_TEXT, type Tone } from "../ui/Pill";
import { CardShell, DataTable, SmartTechPath } from "./CardShell";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const classifyDevice = (d: IntuneDevice): RowStatus => (d.complianceState === "Compliant" ? "good" : "bad");

/** Devices tab: status toggles and clickable device / user cells that highlight the identity across the lens. */
function DevicesTable({ devices }: { devices: IntuneDevice[] }) {
  const classify = useCallback(classifyDevice, []);
  const { chip, setChip, counts, filtered } = useStatusFilter(devices, classify);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  return (
    <div>
      <FilterChips chip={chip} counts={counts} onChange={setChip} testId="intune-filter-chips" />
      <DataTable
        bleed
        head={["Device", "User", "Compliance", "Check-in", "Detail"]}
        colWidths={["25%", "19%", "17%", "14%", "25%"]}
        rowClassName={(i) => rowHighlightClass(rowFilter, { upn: filtered[i]?.upn ?? null, deviceName: filtered[i]?.deviceName ?? null })}
        rows={filtered.map((d) => [
          <IdentityCell kind="device" value={d.deviceName}>
            <span className="block truncate font-mono whitespace-nowrap" title={d.deviceName}>{d.deviceName}</span>
          </IdentityCell>,
          <IdentityCell kind="upn" value={d.upn}>
            <span className="block truncate font-mono whitespace-nowrap text-muted" title={d.upn}>{d.upn.split("@")[0]}</span>
          </IdentityCell>,
          <span className={`font-mono whitespace-nowrap ${TONE_TEXT[COMPLIANCE_TONE[d.complianceState]]}`}>{d.complianceState}</span>,
          <span className="font-mono whitespace-nowrap text-faint">{fmtTimeUtc(d.lastCheckIn)}</span>,
          <span className="line-clamp-2 text-muted" title={d.detail}>{d.detail}</span>,
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

const LIVE_TONE: Record<string, string> = { "in-sync": "text-healthy", conflict: "text-critical", drifted: "text-warning" };

/** `Block / Allow (conflict)` → ["Block", "Allow"]: the conflict pair on two lines, the colour already says "conflict". */
function liveValueLines(live: string): string[] {
  const core = live.replace(/\s*\((conflict|drifted)\)\s*$/i, "");
  return core.includes(" / ") ? core.split(" / ") : [core];
}

/** Intune Policy & Compliance Drift section. */
export function IntuneDriftCardView({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const open = props.settings.filter((s) => s.status !== "in-sync");
  const live = props.policies.some((p) => p.source === "live-graph");
  const subtitle = formatIntuneSubtitle(props, open.length);
  const profileNames = props.policies.map((p) => p.name.replace(/^Fabrikam-/, "").replace(/-DeviceConfig$/, ""));

  return (
    <CardShell
      type="IntuneDriftCard"
      icon={<MonitorCog />}
      title={props.issueKind === "policy-conflict" ? "Intune Policy Conflict & Device Compliance" : "Intune Baseline Drift vs Golden Baseline"}
      titleAccent="Intune"
      state={props.state}
      triggeredBy={triggeredBy}
      source={live ? "live Intune (lab)" : undefined}
      codeLens={props.sourceRef}
      footerMeta={<span title={profileNames.join(", ")}>{props.policies.length} profiles</span>}
      details={
        <div className="space-y-1">
          <div>
            Golden source: <span className="font-mono text-text">{props.goldenSource}</span>
          </div>
          <div>{props.policies.length} profiles evaluated:</div>
          <ul className="space-y-0.5 font-mono">
            {props.policies.map((p) => (
              <li key={p.id} className="truncate" title={p.name}>
                {p.name} <span className="text-faint">· {humanizeSlug(p.kind)}</span>
              </li>
            ))}
          </ul>
        </div>
      }
      tabs={[
        { id: "settings", label: "Setting drift", badge: open.length },
        { id: "devices", label: "Affected devices & compliance", badge: props.affectedDeviceCount },
      ]}
      summary={subtitle}
      primaryAction={
        open.length > 0 && (
          <Button
            size="xs"
            variant="outline"
            icon={<Wrench />}
            data-testid="stage-intune-fix"
            loading={remediateStatus === "loading"}
            onClick={() => openRemediation({ tab: "powershell" })}
          >
            Stage Intune Fix
          </Button>
        )
      }
    >
      {(tab) =>
        tab === "devices" ? (
          <DevicesTable devices={props.devices} />
        ) : (
          <DataTable
            bleed
            head={["Setting", "Golden (Git)", "Live (Graph)", "CSP / Registry"]}
            colWidths={["29%", "22%", "23%", "26%"]}
            cellPy="py-1"
            rows={props.settings.map((s) => {
              const csp = s as { cspUri?: string; registryPath?: string; tattooedOnUnassign?: boolean };
              const path = csp.cspUri ?? csp.registryPath;
              const tone = LIVE_TONE[s.status] ?? "text-critical";
              return [
                <div className="line-clamp-2 text-text" title={[s.settingName, s.policyName, s.settingId].filter(Boolean).join("\n")}>
                  {s.settingName}
                </div>,
                <span className="line-clamp-2 font-mono text-healthy" title={s.golden}>{s.golden}</span>,
                <div className={`font-mono ${tone}`} title={`${humanizeStatus(s.status)}: ${s.live}`}>
                  {liveValueLines(s.live).map((line, i, all) => (
                    <div key={i} className={all.length > 1 ? "truncate" : "line-clamp-2"}>
                      {line}
                    </div>
                  ))}
                </div>,
                path ? (
                  <SmartTechPath
                    path={path}
                    title={[csp.cspUri, csp.registryPath].filter(Boolean).join("\n")}
                    badge={csp.tattooedOnUnassign ? <span className="font-mono text-11 text-warning" title="Value stays tattooed in the registry when the profile is unassigned">tattooed</span> : undefined}
                  />
                ) : (
                  <span className="text-faint">—</span>
                ),
              ];
            })}
          />
        )
      }
    </CardShell>
  );
}
