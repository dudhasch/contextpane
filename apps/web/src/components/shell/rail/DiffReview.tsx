import { ArrowLeft, GitCompareArrows, ShieldAlert, Wrench } from "lucide-react";
import { formatSourceRef, type RogueSecurityRule } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { DiffView } from "../../canvas/DiffView";
import { Button } from "../../ui/Button";
import { Pill } from "../../ui/Pill";
import { ScriptCode } from "./ScriptCode";

const PORT_NAMES: Record<string, string> = { "3389": "RDP", "22": "SSH", "445": "SMB", "1433": "MSSQL", "3306": "MySQL", "5985": "WinRM", "5986": "WinRM-HTTPS", "80": "HTTP", "443": "HTTPS", "*": "ANY" };
const OPEN_SOURCES = new Set(["*", "0.0.0.0/0", "internet", "any", "::/0"]);

/** Rogue rules that expose a port to the whole internet: the ones a judge must see in one line. */
export function exposedRules(rules: RogueSecurityRule[]): RogueSecurityRule[] {
  return rules.filter((r) => r.direction === "Inbound" && r.access === "Allow" && OPEN_SOURCES.has(r.source.trim().toLowerCase()));
}

export function exposureCallout(rule: RogueSecurityRule): string {
  const port = rule.port.trim();
  const name = PORT_NAMES[port] ? ` (${PORT_NAMES[port]})` : "";
  const sev = rule.severity.toUpperCase();
  return `${sev}: ${rule.direction} ${rule.protocol.toUpperCase()}/${port}${name} exposed to 0.0.0.0/0 ('${rule.source}') via rule ${rule.ruleName}`;
}

/** Rail `review` mode: what the diff modal showed, inline in the rail body. */
export function DiffReview() {
  const card = useWorkbench((s) => s.diffCard);
  if (card === "EntraSignInTimeline" || card === "IntuneDriftCard") return <BaselineReview card={card} />;
  return <IaCReview />;
}

/** One text-12 header line with the "Back to scripts" ghost button on the right. */
function ReviewHeader({ title, mono = false }: { title: string; mono?: boolean }) {
  const setDiffOpen = useWorkbench((s) => s.setDiffOpen);
  const hasDrawer = useWorkbench((s) => s.drawer !== null);
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 px-3">
      <GitCompareArrows className="size-3.5 shrink-0 text-signal" aria-hidden />
      <h2 className={`min-w-0 flex-1 truncate text-12 font-medium whitespace-nowrap text-text ${mono ? "font-mono" : ""}`} title={title}>
        {title}
      </h2>
      <Button size="xs" variant="ghost" icon={<ArrowLeft />} onClick={() => setDiffOpen(false)} data-testid="close-drawer-button">
        {hasDrawer ? "Back to scripts" : "Close review"}
      </Button>
    </div>
  );
}

function StageFixButton() {
  const setDiffOpen = useWorkbench((s) => s.setDiffOpen);
  const remediate = useWorkbench((s) => s.remediate);
  return (
    <Button
      size="xs"
      variant="outline"
      icon={<Wrench />}
      className="ml-auto"
      onClick={() => {
        setDiffOpen(false);
        void remediate();
      }}
    >
      Generate fix &amp; stage PR
    </Button>
  );
}

/** CodeLens → [View Diff]: Azure live state (−) vs the Terraform baseline (+) as a unified diff. */
function IaCReview() {
  const layout = useWorkbench((s) => s.layout);
  const banner = layout?.components.find((c) => c.type === "IaCDriftBanner");
  const props = banner?.type === "IaCDriftBanner" ? banner.props : null;
  const exposed = props ? exposedRules(props.rogueSecurityRules) : [];
  return (
    <div className="flex flex-col pb-3" data-review="iac">
      <ReviewHeader title={props ? `${props.resourceName}${props.resourceGroup ? ` · ${props.resourceGroup}` : ""}` : "IaC drift"} mono={Boolean(props)} />
      {props ? (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2">
            <Pill variant="status" tone={props.state === "critical" ? "critical" : "warning"} mono={false}>
              {props.driftState === "drift-detected" ? "Drift detected" : "In sync"}
            </Pill>
            <span className="min-w-0 truncate font-mono text-11 text-faint" title="Terraform resource block the live NSG drifted from">
              azure-live (−) vs {props.sourceRef ? formatSourceRef(props.sourceRef) : props.terraformFile} @ {props.gitBranch} (+)
            </span>
            <StageFixButton />
          </div>
          {exposed.length > 0 && (
            <ul className="space-y-1 px-3 pb-2">
              {exposed.map((r) => (
                <li key={r.ruleName} className="flex items-start gap-1.5 text-12">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-critical" aria-hidden />
                  <span className="min-w-0 font-mono break-words text-critical" title={`p${r.priority} · ${r.reason}`}>
                    {exposureCallout(r)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ScriptCode code={props.hclDiff} name={props.summary.replace(/^State: /, "")} render={(wrap) => <DiffView diff={props.hclDiff} maxHeight="" wrap={wrap} edges="b" />} />
        </>
      ) : (
        <p className="px-3 text-12 text-muted">No IaC component on the canvas yet.</p>
      )}
    </div>
  );
}

/**
 * CodeLens → golden baseline: the live Conditional Access / Intune configuration (−) against the
 * golden-tenant JSON in this repository (+), with the drifted lines named on top.
 */
function BaselineReview({ card }: { card: "EntraSignInTimeline" | "IntuneDriftCard" }) {
  const layout = useWorkbench((s) => s.layout);
  const component = layout?.components.find((c) => c.type === card);
  const props = component?.type === "EntraSignInTimeline" || component?.type === "IntuneDriftCard" ? component.props : null;
  const rows =
    component?.type === "EntraSignInTimeline"
      ? component.props.policies.flatMap((p) => p.drift.map((d) => ({ name: `${p.displayName.replace("[ContextPane-Demo] ", "")} · ${d.field}`, golden: d.expected, live: d.actual, ref: d.sourceRef })))
      : component?.type === "IntuneDriftCard"
        ? component.props.settings.filter((s) => s.status !== "in-sync").map((s) => ({ name: s.settingName, golden: s.golden, live: s.live, ref: s.sourceRef }))
        : [];
  const diff = props?.baselineDiff ?? "";
  return (
    <div className="flex flex-col pb-3" data-review="baseline">
      <ReviewHeader title={card === "IntuneDriftCard" ? "Intune vs golden baseline" : "Conditional Access vs golden baseline"} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2">
        <Pill variant="status" tone={diff ? "warning" : "healthy"} mono={false}>
          {diff ? `${rows.length} drifted` : "In sync"}
        </Pill>
        <span className="min-w-0 truncate font-mono text-11 text-faint">
          tenant-live (−) vs {props?.sourceRef ? `${formatSourceRef(props.sourceRef)} @ ${props.sourceRef.ref}` : "golden-tenant/"} (+)
        </span>
        {diff && <StageFixButton />}
      </div>
      {rows.length > 0 && (
        <ul className="px-3 pb-2 text-12">
          {rows.map((r) => (
            <li key={r.name} className="border-t border-hairline-2 py-1 first:border-t-0">
              <div className="truncate text-text" title={r.name}>
                {r.name}
              </div>
              <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-11">
                <span className="min-w-0 truncate text-critical" title={String(r.live)}>
                  {r.live}
                </span>
                <span className="shrink-0 text-faint">≠</span>
                <span className="min-w-0 truncate text-healthy" title={String(r.golden)}>
                  {r.golden}
                </span>
                {r.ref && (
                  <span className="ml-auto shrink-0 text-faint" title={r.ref.file}>
                    {formatSourceRef({ ...r.ref, file: r.ref.file.split("/").pop()! })}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {diff ? (
        <ScriptCode code={diff} name="baseline.diff" render={(wrap) => <DiffView diff={diff} maxHeight="" wrap={wrap} edges="b" />} />
      ) : (
        <p className="px-3 text-12 text-muted">The live configuration matches the golden baseline.</p>
      )}
    </div>
  );
}
