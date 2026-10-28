import { Cloud, GitCompareArrows } from "lucide-react";
import type { IaCDriftBanner as Props } from "@contextpane/catalog";
import { humanizeStatus } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Mono, Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable } from "./CardShell";
import { DiffView } from "./DiffView";

const SEV_TONE: Record<string, Tone> = { critical: "critical", high: "critical", medium: "warning", low: "muted" };

/** AVD Host Pool, NSG & Azure Policy section. */
export function IaCDriftBannerCard({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const focusCard = useWorkbench((s) => s.focusCard);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const drift = props.driftState === "drift-detected";
  const pool = props.hostPool;
  const critical = props.rogueSecurityRules.filter((r) => r.severity === "critical");
  const nonCompliant = props.azurePolicies.filter((p) => p.compliance === "NonCompliant");

  const subtitle =
    !drift || props.state === "healthy"
      ? `NSG ${props.resourceName} and ${pool?.name ?? "host pool"} are in sync with the Terraform baseline (${props.gitBranch}) with 0 rogue rules.`
      : critical.length > 0
        ? `Rogue rule ${critical[0]!.ruleName} exposes ${critical[0]!.protocol.toUpperCase()}/${critical[0]!.port} from ${critical[0]!.source} on ${props.resourceName}, plus ${props.tagDrift.length} drifted Terraform tags.`
        : props.summary.replace(/^State:\s*/i, "");

  const footerSummary = [
    pool ? `${pool.name} (${pool.sessionHosts.length}× ${pool.vmSize}, ${pool.location})` : null,
    drift ? `${critical.length} critical NSG rule(s), ${props.tagDrift.length} tag drift(s)` : "NSG in sync",
    nonCompliant.length ? `${nonCompliant.length} non-compliant Azure Policy` : "Azure Policy Compliant",
  ].filter(Boolean) as string[];

  return (
    <CardShell
      type="IaCDriftBanner"
      icon={<Cloud />}
      title={pool ? "AVD Host Pool, NSG & Azure Policy" : "Azure Network Security, IaC Drift & Policy"}
      state={props.state}
      triggeredBy={triggeredBy}
      source={props.comparedAgainst === "live-azure" ? "NSG: live Azure" : "NSG: manifest"}
      codeLens={props.sourceRef}
      footerMeta={<span>{drift ? `${critical.length} critical rule${critical.length === 1 ? "" : "s"} · ${props.tagDrift.length} tag drift` : "NSG in sync"}</span>}
      details={
        <ul className="space-y-0.5">
          {footerSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li className="font-mono">
            {props.terraformFile} @ {props.gitBranch}
          </li>
        </ul>
      }
      tabs={[
        { id: "hostpool", label: "Host Pool & Session Hosts", badge: pool?.sessionHosts.length },
        { id: "nsg", label: "NSG Rules & Terraform Drift", badge: props.rogueSecurityRules.length + props.tagDrift.length },
        { id: "policies", label: "Azure Policies", badge: nonCompliant.length },
      ]}
      summary={subtitle}
      primaryAction={
        drift && (
          <Button
            size="xs"
            variant="outline"
            icon={<GitCompareArrows />}
            onClick={() => {
              focusCard("IaCDriftBanner", "nsg");
              openRemediation({ tab: "terraform", focusBanner: "Focused: NSG & Terraform Drift Remediation" });
            }}
          >
            Terraform Diff &amp; Fix
          </Button>
        )
      }
    >
      {(tab) => {
        if (tab === "hostpool") {
          if (!pool) return <div className="text-12 text-muted">No host pool in scope.</div>;
          return (
            <DataTable
              bleed
              head={["Session host", "Status", "Sessions", "VM size / pool", "FSLogix & agent"]}
              rows={pool.sessionHosts.map((h) => [
                <span className="font-mono">{h.name}</span>,
                <Pill variant="status" tone={h.status === "Available" ? "healthy" : "warning"} mono={false}>
                  {h.status}
                </Pill>,
                <span className="font-mono">{h.sessions}</span>,
                <span className="font-mono text-muted">
                  {pool.vmSize} · {pool.poolType}
                </span>,
                <span className="font-mono text-faint">
                  FSLogix {humanizeStatus(pool.fslogix.status)} · v{h.agentVersion ?? "—"}
                </span>,
              ])}
            />
          );
        }
        if (tab === "policies") {
          return (
            <DataTable
              bleed
              head={["Policy definition", "Effect", "Compliance", "Detail"]}
              colWidths={["32%", "14%", "22%", "32%"]}
              rows={props.azurePolicies.map((p) => [
                <span className="text-text">{p.name}</span>,
                <span className="font-mono text-faint">{p.effect}</span>,
                <Pill variant="status" tone={p.compliance === "Compliant" ? "healthy" : "critical"} mono={false}>
                  {p.compliance === "Compliant" ? "Compliant" : `Non-compliant (${p.nonCompliantResources})`}
                </Pill>,
                <span className="text-muted">{p.detail}</span>,
              ])}
            />
          );
        }
        return (
          <div className="space-y-3">
            <div>
              <div className="section-label truncate">Rogue rules · live Azure ({props.resourceName})</div>
              {props.rogueSecurityRules.length === 0 ? (
                <div className="py-1 text-12 text-healthy">No rogue rules</div>
              ) : (
                <ul className="-mx-4 mt-1 divide-y divide-hairline-2">
                  {props.rogueSecurityRules.map((r) => (
                    <li key={r.ruleName} className="px-4 py-1.5 text-12">
                      <div className="flex items-center gap-2">
                        <Pill variant="status" tone={SEV_TONE[r.severity] ?? "muted"} mono={false}>
                          {humanizeStatus(r.severity)}
                        </Pill>
                        <span className="min-w-0 truncate font-mono text-text">{r.ruleName}</span>
                        <span className="ml-auto shrink-0 font-mono text-11 text-faint">p{r.priority}</span>
                      </div>
                      <div className="font-mono text-11 text-muted">
                        {r.direction} {r.access} {r.protocol.toUpperCase()}/{r.port} from <span className="text-critical">{r.source}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {props.missingSecurityRules.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-12 text-warning">
                  Missing in Azure: {props.missingSecurityRules.map((m) => <Mono key={m}>{m}</Mono>)}
                </div>
              )}
            </div>
            <div>
              <div className="section-label truncate">
                Tag drift · {props.terraformFile} @ {props.gitBranch}
              </div>
              {props.tagDrift.length === 0 ? (
                <div className="py-1 text-12 text-healthy">Tags in sync</div>
              ) : (
                <DataTable
                  bleed
                  className="mt-1"
                  head={["Tag", "Terraform", "Azure"]}
                  rows={props.tagDrift.map((t) => [
                    <span className="font-mono">{t.key}</span>,
                    <span className="font-mono text-healthy">{t.expectedInTf ?? <span className="text-faint">∅</span>}</span>,
                    <span className="font-mono text-critical">{t.actualInAzure ?? <span className="text-faint">∅</span>}</span>,
                  ])}
                />
              )}
            </div>
            {drift && <DiffView diff={props.hclDiff} />}
          </div>
        );
      }}
    </CardShell>
  );
}
