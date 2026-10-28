import { ImageIcon, ScanEye, Wand2 } from "lucide-react";
import type { ScenarioBrief } from "@contextpane/catalog";
import type { ErpAttachment } from "@/lib/api";
import { catStyle } from "@/lib/provenance";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { cleanInlineSlugs, EnrichedText, NO_SELECTIONS } from "./EnrichedText";

/**
 * The customer's words, full width and borderless. Enriched entities are coloured underlines in
 * their domain hue (hover → diagnostic popover, click → reveal the card); signals and attachments
 * follow as plain rows.
 */
export function TicketBody({ brief }: { brief: ScenarioBrief }) {
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  const label = brief.originKind === "erp-drop" ? "ERP ticket (file drop)" : brief.kind === "ticket" ? "Customer ticket" : "Anomalous tenant state";
  return (
    <section className="mt-1 border-t border-hairline pt-1.5" data-testid="customer-ticket-card" aria-label={label}>
      <p className="text-13 text-text" data-testid="scenario-body">
        <EnrichedText text={brief.body} entities={brief.entities} selections={selections} />
      </p>
      {brief.signals.length > 0 && (
        <ul className="mt-1">
          {/* One line per signal (machine provenance, not the customer's words); full value and source in the tooltip. */}
          {brief.signals.map((sig) => (
            <li
              key={sig.label}
              style={catStyle(sig.category)}
              className="flex h-5 min-w-0 items-center gap-1.5 text-12"
              title={`${cleanInlineSlugs(sig.label)}: ${cleanInlineSlugs(sig.value)} — ${sig.source}`}
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--cat)]" />
              <span className="shrink-0 font-medium text-[color:var(--cat)]">{cleanInlineSlugs(sig.label)}</span>
              <span className="min-w-0 truncate text-muted">{cleanInlineSlugs(sig.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {brief.attachments.map((a) => (
        <TicketAttachment key={a.fileName} attachment={a} />
      ))}
      <div className="mt-1 flex items-center gap-1 text-11 text-faint" title="Highlight 3-120 characters anywhere on screen, then click the pill to open a live Context Lens">
        <Wand2 className="size-3 shrink-0" aria-hidden="true" />
        Select any text on screen to generate Context UI
      </div>
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
        <Button size="xs" variant="ghost" icon={<ScanEye />} className="-mr-2 ml-auto shrink-0" title="Scan Screenshot for Error Code & Timestamp" loading={vision.status === "loading"} onClick={() => void extract(attachment)}>
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
