import { Cloud, GitBranch, GitCompareArrows, Wrench } from "lucide-react";
import type { IaCDriftBanner as Props } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Mono, Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable, Stat } from "./CardShell";
import { DiffView } from "./DiffView";

const SEV_TONE: Record<string, Tone> = { critical: "critical", high: "critical", medium: "warning", low: "muted" };

/** AVD Host Pool, NSG & Azure Policy card (teal). */
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
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CardShell
      type="IaCDriftBanner"
      icon={<Cloud />}
      title="AVD Host Pool, NSG & Azure Policy"
      state={props.state}
      triggeredBy={triggeredBy}
      source={props.comparedAgainst === "live-azure" ? "NSG: live Azure" : "NSG: manifest"}
      codeLens={props.sourceRef}
      footerMeta={<span>· {footerSummary}</span>}
      tabs={[
        { id: "hostpool", label: "Host Pool & Session Hosts", badge: pool?.sessionHosts.length },
        { id: "nsg", label: "NSG Rules & Terraform Drift", badge: props.rogueSecurityRules.length + props.tagDrift.length },
        { id: "policies", label: "Azure Policies & Compliance", badge: nonCompliant.length },
      ]}
      summary={<div className="text-[12.5px] leading-snug">{subtitle}</div>}
      primaryAction={
        drift && (
          <Button
            size="xs"
            variant="meta"
            icon={<GitCompareArrows />}
            onClick={() => {
              focusCard("IaCDriftBanner", "nsg");
              openRemediation({ tab: "terraform", focusBanner: "Focused: NSG & Terraform Drift Remediation" });
            }}
          >
            Open Terraform Diff &amp; Fix
          </Button>
        )
      }
    >
      {(tab) => {
        if (tab === "hostpool") {
          if (!pool) return <div className="text-[11.5px] text-muted">No host pool in scope.</div>;
          return (
            <div className="space-y-2">
              <DataTable
                head={["Session host", "Status", "Sessions", "VM Size / Pool", "FSLogix & Agent"]}
                rows={pool.sessionHosts.map((h) => [
                  <span className="font-mono">{h.name}</span>,
                  <Pill tone={h.status === "Available" ? "healthy" : "warning"}>{h.status}</Pill>,
                  <span className="font-mono">{h.sessions}</span>,
                  <span className="font-mono text-[11px] text-muted">{pool.vmSize} · {pool.poolType}</span>,
                  <span className="font-mono text-[10.5px] text-faint">FSLogix {pool.fslogix.status} · v{h.agentVersion ?? "—"}</span>,
                ])}
              />
            </div>
          );
        }
        if (tab === "policies") {
          return (
            <DataTable
              head={["Policy definition", "Effect", "Compliance", "Detail"]}
              rows={props.azurePolicies.map((p) => [
                <span>{p.name}</span>,
                <span className="font-mono text-faint">{p.effect}</span>,
                <Pill tone={p.compliance === "Compliant" ? "healthy" : "critical"}>{p.compliance === "Compliant" ? "Compliant" : `Non-Compliant (${p.nonCompliantResources})`}</Pill>,
                <span className="text-[11px] text-muted">{p.detail}</span>,
              ])}
            />
          );
        }
        return (
          <div className="space-y-2">
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-md border border-border-subtle">
                <div className="border-b border-border-subtle bg-surface px-2.5 py-1 text-[10px] tracking-wider text-faint uppercase">Rogue rules · live Azure ({props.resourceName})</div>
                {props.rogueSecurityRules.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-healthy">no rogue rules</div>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {props.rogueSecurityRules.map((r) => (
                      <li key={r.ruleName} className="px-2.5 py-1.5 text-[11px]">
                        <div className="flex items-center gap-2">
                          <Pill tone={SEV_TONE[r.severity] ?? "muted"}>{r.severity}</Pill>
                          <span className="font-mono">{r.ruleName}</span>
                          <span className="ml-auto font-mono text-faint">p{r.priority}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-muted">
                          {r.direction} {r.access} {r.protocol.toUpperCase()}/{r.port} from <span className="text-critical">{r.source}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {props.missingSecurityRules.length > 0 && (
                  <div className="border-t border-border-subtle px-2.5 py-1.5 text-[11px] text-warning">
                    missing in Azure: {props.missingSecurityRules.map((m) => <Mono key={m}>{m}</Mono>)}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border-subtle">
                <div className="border-b border-border-subtle bg-surface px-2.5 py-1 text-[10px] tracking-wider text-faint uppercase">Tag drift · {props.terraformFile} @ {props.gitBranch}</div>
                {props.tagDrift.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-healthy">tags in sync</div>
                ) : (
                  <table className="w-full text-[11px]">
                    <tbody className="font-mono">
                      {props.tagDrift.map((t) => (
                        <tr key={t.key} className="border-t border-border-subtle first:border-t-0">
                          <td className="px-2.5 py-1">{t.key}</td>
                          <td className="px-2.5 py-1 text-healthy">{t.expectedInTf ?? <span className="text-faint">∅</span>}</td>
                          <td className="px-2.5 py-1 text-critical">{t.actualInAzure ?? <span className="text-faint">∅</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            {drift && <DiffView diff={props.hclDiff} />}
          </div>
        );
      }}
    </CardShell>
  );
}
