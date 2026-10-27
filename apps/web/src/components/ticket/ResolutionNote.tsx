import { CheckCheck, ChevronRight, ClipboardCopy, FileCheck2 } from "lucide-react";
import { useState } from "react";
import { fmtDateTimeUtc } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";

/**
 * `Customer & PSA Resolution Note (Ready to Close Ticket)`: rendered at the bottom of the
 * Resolution Plan once the remediation converged. Plain-English summary for the customer,
 * the technical audit trail, and the two closing actions.
 */
export function ResolutionNoteBox() {
  const note = useWorkbench((s) => s.resolutionNote);
  const status = useWorkbench((s) => s.resolutionNoteStatus);
  const load = useWorkbench((s) => s.loadResolutionNote);
  const close = useWorkbench((s) => s.closeTicket);
  const toast = useWorkbench((s) => s.toast);
  const [open, setOpen] = useState(true);
  if (status === "idle" && !note) {
    return (
      <button type="button" onClick={() => void load()} className="mt-2 inline-flex h-6 items-center gap-1 rounded border border-healthy/40 bg-healthy/10 px-2 text-[11px] text-healthy" data-testid="resolution-note-load">
        <FileCheck2 className="size-3" /> Draft Customer & PSA Resolution Note
      </button>
    );
  }
  if (!note) return <div className="mt-2 text-[11px] text-faint">{status === "loading" ? "Drafting the resolution note…" : "Resolution note unavailable"}</div>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note.markdown);
      toast({ tone: "healthy", title: "PSA resolution note copied", detail: `${note.markdown.length} characters of Markdown, ready for the PSA ticket` });
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const closed = Boolean(note.closed);
  return (
    <section className="mt-2.5 rounded-md border border-healthy/40 bg-healthy/6" data-testid="resolution-note">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[12px]">
        <ChevronRight className={`size-3.5 shrink-0 text-healthy transition-transform ${open ? "rotate-90" : ""}`} />
        <FileCheck2 className="size-3.5 shrink-0 text-healthy" />
        <span className="font-semibold">Customer &amp; PSA Resolution Note</span>
        <span className="truncate text-[11px] text-muted">{closed ? "· Closed in PSA" : "· Ready to Close Ticket"}</span>
        <Pill tone={closed ? "healthy" : "primary"} className="ml-auto">
          {note.status}
        </Pill>
      </button>
      {open && (
        <div className="border-t border-healthy/25 px-2.5 py-2">
          <div className="section-label mb-1">For the customer</div>
          <p className="text-[12px] leading-relaxed text-text">{note.customerSummary}</p>
          <div className="section-label mt-2 mb-1">Technical audit trail</div>
          <ul className="space-y-0.5 font-mono text-[10.5px] leading-snug text-muted">
            {note.technicalAuditTrail.map((line) => (
              <li key={line} className="flex gap-1.5">
                <CheckCheck className="mt-0.5 size-3 shrink-0 text-healthy" />
                <span className="break-words">{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button size="xs" variant="outline" icon={<ClipboardCopy />} onClick={() => void copy()} data-testid="copy-psa-note">
              Copy PSA Resolution Note
            </Button>
            <Button size="xs" variant="healthy" icon={<CheckCheck />} onClick={() => void close()} disabled={closed} data-testid="close-ticket">
              {closed ? "Ticket Closed in PSA" : "Mark Ticket Closed in PSA"}
            </Button>
            <span className="ml-auto font-mono text-[10px] text-faint">
              {closed && note.closed ? `closed ${fmtDateTimeUtc(note.closed.closedAt)} · ${note.closed.closedBy}` : `resolved ${fmtDateTimeUtc(note.resolvedAt)} · ${note.execution}`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
