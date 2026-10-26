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
  const setDiffOpen = useWorkbench((s) => s.setDiffOpen);
  const drift = props.driftState === "drift-detected";
  const pool = props.hostPool;
  const critical = props.rogueSecurityRules.filter((r) => r.severity === "critical");
  const nonCompliant = props.azurePolicies.filter((p) => p.compliance === "NonCompliant");
  return (
    <CardShell
      type="IaCDriftBanner"
      icon={<Cloud />}
      title="AVD Host Pool, NSG & Azure Policy"
      state={props.state}
      triggeredBy={triggeredBy}
      source={props.comparedAgainst === "live-azure" ? "NSG: live Azure" : "NSG: manifest"}
      tabs={[
        { id: "hostpool", label: "Host Pool & Session Hosts", badge: pool?.sessionHosts.length },
        { id: "nsg", label: "NSG Rules & Terraform Drift", badge: props.rogueSecurityRules.length + props.tagDrift.length },
        { id: "policies", label: "Azure Policies & Compliance", badge: nonCompliant.length },
      ]}
      summary={
        <div className="space-y-1">
          {pool && (
            <div className="font-mono text-[12px]">
              {pool.name} · {pool.poolType} · {pool.loadBalancer} · {pool.sessionHosts.length}x {pool.vmSize} · {pool.location}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <Stat label="NSG:" tone={drift ? (critical.length ? "critical" : "warning") : "healthy"}>
              {drift
                ? `${critical.length ? `${critical.length} Critical NSG Drift (${critical.map((r) => `${r.protocol.toUpperCase()}/${r.port}`).join(", ")} Open)` : "drift"}${props.tagDrift.length ? ` + ${props.tagDrift.length} tag drift` : ""}`
                : "in sync with Terraform"}
            </Stat>
            <Stat label="Azure Policy:" tone={nonCompliant.length ? "warning" : "healthy"}>
              {nonCompliant.length ? `${nonCompliant.length} Non-Compliant` : "Compliant"}
            </Stat>
          </div>
        </div>
      }
      primaryAction={
        drift && (
          <Button size="xs" variant="meta" icon={<GitCompareArrows />} onClick={() => setDiffOpen(true)}>
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
              <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
                <dt className="text-faint">Pool type</dt>
                <dd className="font-mono">{pool.poolType}</dd>
                <dt className="text-faint">Load balancing</dt>
                <dd className="font-mono">{pool.loadBalancer}</dd>
                <dt className="text-faint">VM size</dt>
                <dd className="font-mono">{pool.vmSize}</dd>
                <dt className="text-faint">Max sessions</dt>
                <dd className="font-mono">{pool.maxSessionLimit ?? "—"}</dd>
                <dt className="text-faint">Identity</dt>
                <dd>{pool.joinType}</dd>
                <dt className="text-faint">FSLogix</dt>
                <dd>
                  <Pill tone={pool.fslogix.status === "Healthy" ? "healthy" : "warning"}>{pool.fslogix.status}</Pill> <span className="font-mono text-[10.5px] text-faint">{pool.fslogix.share}</span>
                </dd>
              </dl>
              <DataTable
                head={["Session host", "Status", "Sessions", "Agent"]}
                rows={pool.sessionHosts.map((h) => [
                  <span className="font-mono">{h.name}</span>,
                  <Pill tone={h.status === "Available" ? "healthy" : "warning"}>{h.status}</Pill>,
                  <span className="font-mono">{h.sessions}</span>,
                  <span className="font-mono text-faint">{h.agentVersion ?? "—"}</span>,
                ])}
              />
              <div className="text-[10.5px] text-faint">Host pool topology: {pool.source === "live-azure" ? "live Azure" : "fixture (the lab has no session hosts)"}</div>
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
            <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
              <span>
                NSG <span className="font-mono text-text">{props.resourceName}</span>
              </span>
              <span>
                RG <span className="font-mono text-text">{props.resourceGroup}</span>
              </span>
              <Pill tone="muted" icon={<GitBranch />}>
                {props.terraformFile} @ {props.gitBranch}
              </Pill>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-md border border-border-subtle">
                <div className="border-b border-border-subtle bg-surface px-2.5 py-1 text-[10px] tracking-wider text-faint uppercase">Rogue rules · live Azure, not in Terraform</div>
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
                <div className="border-b border-border-subtle bg-surface px-2.5 py-1 text-[10px] tracking-wider text-faint uppercase">Tag drift · Terraform vs Azure</div>
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
            {drift && (
              <Button size="xs" variant="meta" icon={<Wrench />} onClick={() => useWorkbench.getState().openRemediation({ tab: "terraform" })}>
                Generate Fix &amp; Stage PR
              </Button>
            )}
          </div>
        );
      }}
    </CardShell>
  );
}
