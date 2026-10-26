import { Cloud, GitBranch, GitCompareArrows, Wrench } from "lucide-react";
import { useState } from "react";
import type { IaCDriftBanner as Props, Provenance } from "@contextpane/catalog";
import { selectConvergence, useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Mono, Pill, type Tone } from "../ui/Pill";
import { CardShell } from "./CardShell";
import { DiffView } from "./DiffView";

const SEV_TONE: Record<string, Tone> = { critical: "critical", high: "critical", medium: "warning", low: "muted" };

export function IaCDriftBannerCard({ props, provenance, repaired }: { props: Props; provenance: Provenance; repaired?: boolean }) {
  const [showDiff, setShowDiff] = useState(false);
  const remediate = useWorkbench((s) => s.remediate);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const converged = Boolean(useWorkbench(selectConvergence));
  const drift = props.driftState === "drift-detected";
  return (
    <CardShell
      type="IaCDriftBanner"
      icon={<Cloud />}
      title={props.resourceName}
      state={props.state}
      statePill={<Pill tone={drift ? (props.state === "critical" ? "critical" : "warning") : "healthy"} icon={<GitCompareArrows />}>{drift ? "DRIFT DETECTED" : converged ? "REMEDIATED" : "IN SYNC"}</Pill>}
      provenance={provenance}
      repaired={repaired}
      right={
        <Pill tone="muted" icon={<GitBranch />} title={props.comparedAgainst === "live-azure" ? "compared against live Azure" : "compared against the seeded manifest"}>
          {props.terraformFile} @ {props.gitBranch} · {props.comparedAgainst}
        </Pill>
      }
    >
      <div className="mb-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
        <span>
          RG <span className="font-mono text-text">{props.resourceGroup}</span>
        </span>
        {props.location && (
          <span>
            Region <span className="font-mono text-text">{props.location}</span>
          </span>
        )}
        <span className="font-mono text-faint">{props.resourceType}</span>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded-md border border-border-subtle">
          <div className="border-b border-border-subtle bg-surface px-2.5 py-1 text-[10px] uppercase tracking-wider text-faint">Tag drift · Terraform vs Azure</div>
          {props.tagDrift.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] text-healthy">tags in sync</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-[10px] text-faint">
                <tr>
                  <th className="px-2.5 py-1 text-left font-medium">Key</th>
                  <th className="px-2.5 py-1 text-left font-medium">Expected in TF</th>
                  <th className="px-2.5 py-1 text-left font-medium">Actual in Azure</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {props.tagDrift.map((t) => (
                  <tr key={t.key} className="border-t border-border-subtle">
                    <td className="px-2.5 py-1">{t.key}</td>
                    <td className="px-2.5 py-1 text-healthy">{t.expectedInTf ?? <span className="text-faint">∅</span>}</td>
                    <td className="px-2.5 py-1 text-critical">{t.actualInAzure ?? <span className="text-faint">∅</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-md border border-border-subtle">
          <div className="border-b border-border-subtle bg-surface px-2.5 py-1 text-[10px] uppercase tracking-wider text-faint">Rogue security rules · not in Terraform</div>
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
                    {r.direction} {r.access} {r.protocol.toUpperCase()} {r.port} from <span className="text-critical">{r.source}</span> → {r.destination}
                  </div>
                  <div className="text-[10.5px] text-faint">{r.reason}</div>
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
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Button size="xs" variant="outline" icon={<GitCompareArrows />} onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? "Hide diff" : "View Diff"}
        </Button>
        <Button size="xs" variant="meta" icon={<Wrench />} onClick={() => void remediate()} disabled={!drift} loading={remediateStatus === "loading"}>
          Generate Fix & Stage PR
        </Button>
        <span className="ml-auto font-mono text-[10px] text-faint">{props.summary}</span>
      </div>
      {showDiff && (
        <div className="mt-2">
          <DiffView diff={props.hclDiff} />
        </div>
      )}
    </CardShell>
  );
}
