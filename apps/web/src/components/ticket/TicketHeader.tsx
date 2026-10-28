import type { ScenarioBrief } from "@contextpane/catalog";
import { fmtDateTimeUtc } from "@/lib/format";
import { selectConvergence, useWorkbench } from "@/store";
import { Pill, type Tone } from "../ui/Pill";

/**
 * Two lines, no box: `#INC-4099 ● Open  PSA ticket · Endpoint Management / Intune`, the title
 * (max two lines), then tenant · requester · opened. Domain, role and priority sit in the tooltip.
 */
export function TicketHeader({ brief }: { brief: ScenarioBrief }) {
  const resolved = Boolean(useWorkbench(selectConvergence));
  const closed = useWorkbench((s) => Boolean(s.resolutionNote?.closed && s.resolutionNote.scenarioId === brief.scenarioId));
  const ticket = brief.kind === "ticket";
  const drop = brief.originKind === "erp-drop";
  const open = drop ? "New" : ticket ? "Open" : "Active drift";
  const tone: Tone = closed ? "muted" : resolved ? "healthy" : drop ? "primary" : ticket ? "healthy" : "warning";
  const rationale = brief.extraction?.rationale ? brief.extraction.rationale : undefined;
  const meta = [brief.verifiedDomain, brief.requester ? `${brief.requester.displayName} · ${brief.requester.role}` : null, brief.priority ? `priority ${brief.priority}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <header className="shrink-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-12 font-semibold text-text" data-testid="scenario-display-id">
          {brief.displayId ?? `#${brief.scenarioId}`}
        </span>
        <Pill variant="status" tone={tone} mono={false} className="shrink-0 font-semibold" flashKey={resolved ? "resolved" : "open"}>
          {closed ? "Closed in PSA" : resolved ? "Resolved and verified" : open}
        </Pill>
        <span className="min-w-0 truncate text-11 text-faint" title={rationale ?? brief.origin}>
          {brief.origin}
        </span>
      </div>
      <h2 className="mt-0.5 line-clamp-2 text-15 font-semibold text-text" title={brief.title}>
        {brief.title}
      </h2>
      <div className="mt-0.5 truncate text-12 text-muted" title={meta}>
        {brief.tenantName}
        {brief.requester && <> · {brief.requester.displayName}</>}
        {" · "}
        {ticket ? "opened" : "detected"} {fmtDateTimeUtc(brief.openedAt)}
      </div>
    </header>
  );
}
