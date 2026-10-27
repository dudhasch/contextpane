import { FilePlus2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type SampleTicket } from "@/lib/api";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";

/**
 * `[+ Triage Unscripted Ticket]`: paste any MSP support ticket (subject + body), or pick one
 * of three samples, and watch it triaged live against the lab tenant. Lives in a modal, so the
 * default workbench stays untouched.
 */
export function TicketComposer() {
  const open = useWorkbench((s) => s.composerOpen);
  const setOpen = useWorkbench((s) => s.setComposerOpen);
  const triage = useWorkbench((s) => s.triageCustom);
  const status = useWorkbench((s) => s.triageStatus);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [customer, setCustomer] = useState("");
  const [samples, setSamples] = useState<SampleTicket[]>([]);
  useEffect(() => {
    if (!open || samples.length) return;
    api.ticketSamples().then((r) => setSamples(r.samples)).catch(() => undefined);
  }, [open, samples.length]);
  if (!open) return null;
  const ready = title.trim().length >= 3 && body.trim().length >= 10 && status !== "loading";
  const submit = async () => {
    if (!ready) return;
    await triage({ title: title.trim(), body: body.trim(), ...(customer.trim() ? { customerName: customer.trim() } : {}) });
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="w-[720px] max-w-[95vw] animate-fade-in card shadow-popover" onClick={(e) => e.stopPropagation()} data-testid="ticket-composer">
        <div className="flex items-center gap-2">
          <FilePlus2 className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">Triage Unscripted Ticket</span>
          <span className="text-[11px] text-faint">any ticket, triaged live against c4a8shili.onmicrosoft.com · rg-contoso-avd-prod</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Quick samples:</span>
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              data-sample={s.id}
              onClick={() => {
                setTitle(s.title);
                setBody(s.body);
                setCustomer(s.customerName);
              }}
              className="inline-flex h-6 max-w-[220px] items-center truncate rounded border border-border px-2 text-[11px] text-muted hover:border-primary/50 hover:text-text"
              title={s.body}
            >
              {s.title}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-[11px] text-muted">
          Subject
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Finance user cannot connect to AVD…" className="mt-1 h-8 w-full rounded-md border border-border bg-canvas px-2.5 text-[12.5px] text-text focus:outline-2 focus:outline-primary" data-testid="composer-title" />
        </label>
        <label className="mt-2 block text-[11px] text-muted">
          Ticket body
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Paste the customer's description. UPNs, names, error codes (AADSTS…, 0x87D…), SKUs, policy and resource names are matched against the live tenant." className="mt-1 w-full resize-y rounded-md border border-border bg-canvas px-2.5 py-2 text-[12.5px] leading-relaxed text-text focus:outline-2 focus:outline-primary" data-testid="composer-body" />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-muted">
            Customer
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Contoso Finance" className="h-7 min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 text-[12px] text-text focus:outline-2 focus:outline-primary" />
          </label>
          <Pill tone="muted">Tier 0 extraction · 0 tokens</Pill>
          <Button variant="primary" size="md" icon={<Sparkles />} loading={status === "loading"} disabled={!ready} onClick={() => void submit()} data-testid="composer-submit">
            Triage Live
          </Button>
        </div>
      </div>
    </div>
  );
}
