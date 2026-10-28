import { ImageIcon, ScanEye, Wand2 } from "lucide-react";
import type { ScenarioBrief } from "@contextpane/catalog";
import type { ErpAttachment } from "@/lib/api";
import { catStyle } from "@/lib/provenance";
import { useClamp } from "@/hooks/useClamp";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { EnrichedText, NO_SELECTIONS } from "./EnrichedText";

/**
 * The customer's words, full width and borderless. Enriched entities are coloured underlines in
 * their domain hue (hover → diagnostic popover, click → reveal the card); signals and attachments
 * follow as plain rows.
 */
export function TicketBody({ brief }: { brief: ScenarioBrief }) {
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  const label = brief.originKind === "erp-drop" ? "ERP ticket (file drop)" : brief.kind === "ticket" ? "Customer ticket" : "Anomalous tenant state";
  // Fold (WP8): the customer's words clamp to 8 lines and expand in place.
  const clamp = useClamp<HTMLParagraphElement>(`${brief.scenarioId}:${brief.body}`);
  return (
    <section className="mt-1 border-t border-hairline pt-1.5" data-testid="customer-ticket-card" aria-label={label}>
      <p ref={clamp.ref} className={`text-13 text-text ${clamp.expanded ? "" : "line-clamp-8"}`} data-testid="scenario-body">
        <EnrichedText text={brief.body} entities={brief.entities} selections={selections} />
      </p>
      {/* One quiet row under the words: the in-place "more" toggle and the selection hint. */}
      <div className="mt-0.5 flex h-5 min-w-0 items-center gap-2 text-11 text-faint">
        {clamp.overflowing && (
          <button
            type="button"
            onClick={clamp.toggle}
            aria-expanded={clamp.expanded}
            className="shrink-0 text-12 text-signal hover:underline focus-visible:outline-2 focus-visible:outline-signal"
            data-testid="scenario-body-more"
          >
            {clamp.expanded ? "less" : "more"}
          </button>
        )}
        <span className="ml-auto inline-flex min-w-0 items-center gap-1 truncate" title="Highlight 3-120 characters anywhere on screen, then click the pill to open a live context lens">
          <Wand2 className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">Select any text to open a context lens</span>
        </span>
      </div>
      {brief.signals.length > 0 && (
        <ul className="mt-1">
          {/* One line per signal (machine provenance, not the customer's words); full value and source in the tooltip. */}
          {brief.signals.map((sig) => (
            <li
              key={sig.label}
              style={catStyle(sig.category)}
              className="flex h-5 min-w-0 items-center gap-1.5 text-12"
              title={`${sig.label}: ${sig.value} — ${sig.source}`}
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--cat)]" />
              <span className="shrink-0 font-medium text-[color:var(--cat)]">{sig.label}</span>
              <span className="min-w-0 truncate text-muted">{sig.value}</span>
            </li>
          ))}
        </ul>
      )}
      {brief.attachments.map((a) => (
        <TicketAttachment key={a.fileName} attachment={a} />
      ))}
    </section>
  );
}

/** Customer screenshot on the ticket; one click scans it for error code & timestamp and highlights the matching sign-in. */
function TicketAttachment({ attachment }: { attachment: ErpAttachment }) {
  const vision = useWorkbench((s) => s.vision);
  const extract = useWorkbench((s) => s.extractVision);
  const result = vision.status === "ready" ? vision.result : undefined;
  const x = result?.extraction;
  return (
    <div className="mt-1" data-testid="ticket-attachment">
      <div className="flex min-w-0 items-center gap-2">
        <a href={attachment.url} target="_blank" rel="noreferrer" className="shrink-0" title="Open full size">
          <img src={attachment.url} alt={`Customer screenshot ${attachment.fileName}`} className="h-6 w-10 rounded-sm border border-hairline object-cover" />
        </a>
        <span className="min-w-0 truncate font-mono text-11 text-text" title={`${attachment.fileName} · ${attachment.uploadedBy} · ${Math.round(attachment.sizeBytes / 1024)} KB`}>
          <ImageIcon className="mr-1 inline size-3 align-[-2px] text-muted" aria-hidden="true" />
          {attachment.fileName}
          <span className="text-faint"> · {Math.round(attachment.sizeBytes / 1024)} KB</span>
        </span>
        <Button size="xs" variant="ghost" icon={<ScanEye />} className="-mr-2 ml-auto shrink-0" title="Scan the screenshot for the error code and timestamp" loading={vision.status === "loading"} onClick={() => void extract(attachment)}>
          Scan for error &amp; time
        </Button>
      </div>
      {vision.status === "error" && <div className="mt-1 text-11 text-critical">Screenshot scan failed: {vision.error}</div>}
      {result && !x && <div className="mt-1 text-11 text-critical">Screenshot scan failed: {result.error}</div>}
      {result && x && (
        <div className="mt-1.5 animate-fade-in border-t border-dashed border-hairline pt-1.5 text-11" data-testid="vision-result">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-faint">
              <span className="text-signal">✦</span> Error
            </dt>
            <dd className="font-mono text-critical">{x.errorCode}</dd>
            <dt className="text-faint">Correlation</dt>
            <dd className="truncate font-mono">{x.correlationId}</dd>
            <dt className="text-faint">Device</dt>
            <dd className="truncate">{x.deviceState}</dd>
          </dl>
          <div className="mt-1">
            {result.match ? (
              <Pill variant="status" tone="healthy" mono={false} title={`${result.match.upn} · ${result.match.timestamp}`}>
                Matched sign-in event ({result.match.eventId})
              </Pill>
            ) : (
              <Pill variant="status" tone="warning" mono={false}>
                No matching sign-in found
              </Pill>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
