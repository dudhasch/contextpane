import { GitCompareArrows, ShieldAlert, Wrench, X } from "lucide-react";
import type { RogueSecurityRule } from "@contextpane/catalog";
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
  if (!open) return null;
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
            <Pill tone="muted">
              {props.terraformFile} @ {props.gitBranch} (+)
            </Pill>
            <Pill tone={props.state === "critical" ? "critical" : "warning"} icon={<GitCompareArrows />}>
              {props.driftState === "drift-detected" ? "DRIFT DETECTED" : "IN SYNC"}
            </Pill>
            <span className="hidden font-mono text-[10.5px] text-faint lg:inline">{props.summary.replace(/^State: /, "")}</span>
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
                <span className="ml-auto hidden shrink-0 font-mono text-[10.5px] text-faint xl:inline">
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
