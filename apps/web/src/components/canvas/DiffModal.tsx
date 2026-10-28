import { GitCompareArrows, ShieldAlert, Wrench, X } from "lucide-react";
import { formatSourceRef, type RogueSecurityRule } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Pill } from "../ui/Pill";
import { DiffView } from "./DiffView";

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

/** CodeLens → [View Diff]: side-by-side Azure live state vs Terraform baseline as a unified diff. */
export function DiffModal() {
  const open = useWorkbench((s) => s.diffOpen);
  const setOpen = useWorkbench((s) => s.setDiffOpen);
  const layout = useWorkbench((s) => s.layout);
  const remediate = useWorkbench((s) => s.remediate);
  const card = useWorkbench((s) => s.diffCard);
  if (!open) return null;
  if (card === "EntraSignInTimeline" || card === "IntuneDriftCard") return <BaselineDiffModal card={card} />;
  const banner = layout?.components.find((c) => c.type === "IaCDriftBanner");
  const props = banner?.type === "IaCDriftBanner" ? banner.props : null;
  const exposed = props ? exposedRules(props.rogueSecurityRules) : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="w-[900px] max-w-[95vw] animate-fade-in card shadow-popover" onClick={(e) => e.stopPropagation()}>
        {/* row 1: title + close. The resource name never wraps; the badges live on their own row below. */}
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-4 shrink-0 text-primary" />
          <h2 className="min-w-0 truncate font-mono text-base font-semibold whitespace-nowrap" title={props?.resourceName}>
            {props ? props.resourceName : "IaC drift"}
          </h2>
          {props?.resourceGroup && <span className="hidden shrink-0 font-mono text-[11px] text-faint md:inline">· {props.resourceGroup}</span>}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto shrink-0 text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {/* row 2: metadata badges + action */}
        {props && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill tone="muted">azure-live (−)</Pill>
            <Pill tone="muted" title="Terraform resource block the live NSG drifted from">
              {props.sourceRef ? formatSourceRef(props.sourceRef) : props.terraformFile} @ {props.gitBranch} (+)
            </Pill>
            <Pill tone={props.state === "critical" ? "critical" : "warning"} icon={<GitCompareArrows />}>
              {props.driftState === "drift-detected" ? "DRIFT DETECTED" : "IN SYNC"}
            </Pill>
            <span className="hidden font-mono text-[11px] text-faint lg:inline">{props.summary.replace(/^State: /, "")}</span>
            <Button size="sm" variant="meta" icon={<Wrench />} className="ml-auto" onClick={() => { setOpen(false); void remediate(); }}>
              Generate Fix &amp; Stage PR
            </Button>
          </div>
        )}
        {/* security callout: the rogue rule in one sentence */}
        {exposed.length > 0 && (
          <div className="mt-3 space-y-1 rounded-md border border-critical/50 bg-critical/10 px-3 py-2">
            {exposed.map((r) => (
              <div key={r.ruleName} className="flex items-start gap-2 text-[12px] leading-snug">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-critical" />
                <span className="font-mono text-critical">{exposureCallout(r)}</span>
                <span className="ml-auto hidden shrink-0 font-mono text-[11px] text-faint xl:inline">
                  p{r.priority} · {r.reason}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          {props ? (
            <CodeBlock code={props.hclDiff} render={(wrap) => <DiffView diff={props.hclDiff} maxHeight="max-h-[62vh]" wrap={wrap} className="pt-8" />} />
          ) : (
            <div className="text-sm text-muted">No IaC component on the canvas yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CodeLens → golden baseline: the live Conditional Access / Intune configuration (−) against
 * the golden-tenant JSON in this repository (+), with the drifted lines named on top.
 */
function BaselineDiffModal({ card }: { card: "EntraSignInTimeline" | "IntuneDriftCard" }) {
  const setOpen = useWorkbench((s) => s.setDiffOpen);
  const layout = useWorkbench((s) => s.layout);
  const remediate = useWorkbench((s) => s.remediate);
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="w-[900px] max-w-[95vw] animate-fade-in card shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-4 shrink-0 text-primary" />
          <h2 className="min-w-0 truncate text-base font-semibold whitespace-nowrap">{card === "IntuneDriftCard" ? "Intune vs golden baseline" : "Conditional Access vs golden baseline"}</h2>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto shrink-0 text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Pill tone="muted">tenant-live (−)</Pill>
          <Pill tone="muted">{props?.sourceRef ? `${formatSourceRef(props.sourceRef)} @ ${props.sourceRef.ref}` : "golden-tenant/"} (+)</Pill>
          <Pill tone={diff ? "warning" : "healthy"} icon={<GitCompareArrows />}>
            {diff ? `${rows.length} DRIFTED` : "IN SYNC"}
          </Pill>
          {diff && (
            <Button size="sm" variant="meta" icon={<Wrench />} className="ml-auto" onClick={() => { setOpen(false); void remediate(); }}>
              Generate Fix &amp; Stage PR
            </Button>
          )}
        </div>
        {rows.length > 0 && (
          <ul className="mt-3 space-y-0.5 rounded-md border border-border-subtle px-3 py-2 text-[11.5px]">
            {rows.map((r) => (
              <li key={r.name} className="flex items-baseline gap-2">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="shrink-0 font-mono text-critical">{r.live}</span>
                <span className="shrink-0 text-faint">≠</span>
                <span className="shrink-0 font-mono text-healthy">{r.golden}</span>
                {r.ref && <span className="ml-auto shrink-0 font-mono text-[11px] text-faint" title={r.ref.file}>{formatSourceRef({ ...r.ref, file: r.ref.file.split("/").pop()! })}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          {diff ? (
            <CodeBlock code={diff} render={(wrap) => <DiffView diff={diff} maxHeight="max-h-[56vh]" wrap={wrap} className="pt-8" />} />
          ) : (
            <div className="text-sm text-muted">The live configuration matches the golden baseline.</div>
          )}
        </div>
      </div>
    </div>
  );
}
