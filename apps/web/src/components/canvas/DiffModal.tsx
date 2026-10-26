import { GitCompareArrows, Wrench, X } from "lucide-react";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { DiffView } from "./DiffView";

/** CodeLens → [View Diff]: side-by-side Azure live state vs Terraform baseline as a unified diff. */
export function DiffModal() {
  const open = useWorkbench((s) => s.diffOpen);
  const setOpen = useWorkbench((s) => s.setDiffOpen);
  const layout = useWorkbench((s) => s.layout);
  const remediate = useWorkbench((s) => s.remediate);
  if (!open) return null;
  const banner = layout?.components.find((c) => c.type === "IaCDriftBanner");
  const props = banner?.type === "IaCDriftBanner" ? banner.props : null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="w-[860px] max-w-[95vw] animate-fade-in card shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <GitCompareArrows className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">{props ? props.resourceName : "IaC drift"}</span>
          {props && (
            <>
              <Pill tone="muted">azure-live (−)</Pill>
              <Pill tone="muted">
                {props.terraformFile} @ {props.gitBranch} (+)
              </Pill>
              <Pill tone={props.state === "critical" ? "critical" : "warning"}>{props.summary.replace(/^State: /, "")}</Pill>
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {props && (
              <Button size="sm" variant="meta" icon={<Wrench />} onClick={() => { setOpen(false); void remediate(); }}>
                Generate Fix &amp; Stage PR
              </Button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="text-faint hover:text-text" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {props ? <DiffView diff={props.hclDiff} maxHeight="max-h-[70vh]" /> : <div className="text-sm text-muted">No IaC component on the canvas yet.</div>}
      </div>
    </div>
  );
}
