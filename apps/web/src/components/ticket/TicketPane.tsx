import { AlertOctagon, Clock3, FileCode2, FileText, GitCompareArrows, Sparkles, Ticket, UserRound, Wrench } from "lucide-react";
import { Fragment, useEffect, useMemo, type ReactNode } from "react";
import type { EntityType, IaCDriftBanner, LicenseDriftCard } from "@contextpane/catalog";
import type { ErpContractLine, ErpTicket } from "@/lib/api";
import { onDemo } from "@/lib/demo";
import { countdown, fmtDateTimeUtc, fmtUsd } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Mono, Pill, TONE_TEXT, type Tone } from "../ui/Pill";
import { EntityPill } from "./EntityPill";

const SEVERITY_TONE: Record<string, Tone> = { P1: "critical", P2: "warning", P3: "primary", P4: "muted" };

/** Left pane: the ERP ticket and contract, enriched with the three inline UX patterns. */
export function TicketPane() {
  const context = useWorkbench((s) => s.context);
  const status = useWorkbench((s) => s.contextStatus);
  if (!context) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {status === "error" ? "Orchestrator unreachable — start apps/orchestrator on :4000" : "Loading ERP ticket…"}
      </div>
    );
  }
  const { ticket, contract, tenant } = context;
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <section className="card">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Ticket className="size-4 text-primary" />
            <span className="font-mono text-[13px] font-semibold">#{ticket.ticketId}</span>
            <Pill tone={SEVERITY_TONE[ticket.severity] ?? "muted"} icon={<AlertOctagon />}>
              {ticket.severity} · {ticket.status}
            </Pill>
          </div>
          <SlaCountdown breachAt={ticket.slaBreachAt} />
        </div>
        <h2 className="text-[14px] font-semibold leading-snug">{ticket.title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>{tenant.displayName}</span>
          <span className="font-mono">{tenant.verifiedDomain}</span>
          <span>{ticket.category}</span>
          <span>opened {fmtDateTimeUtc(ticket.openedAt)}</span>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-text">
          <EnrichedText text={ticket.description} ticket={ticket} />
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div className="section-label mb-1">Requester</div>
            <div className="flex items-center gap-1.5">
              <UserRound className="size-3 text-muted" />
              <span>{ticket.requester.displayName}</span>
              <span className="text-faint">· {ticket.requester.role}</span>
            </div>
          </div>
          <div>
            <div className="section-label mb-1">Engineer</div>
            <div>{ticket.assignedEngineer}</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="section-label mb-1">Affected</div>
          <div className="flex flex-wrap gap-1">
            {ticket.affectedGroups.map((g) => (
              <EntityPill key={g} entityId={g} entityType="group" />
            ))}
            {ticket.affectedUpns.map((u) => (
              <EntityPill key={u} entityId={u} entityType="upn" />
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <span className="font-mono text-[13px] font-semibold">#{contract.contractId}</span>
          <Pill tone="primary">{contract.slaTier} SLA</Pill>
          <span className="ml-auto font-mono text-[11px] text-muted">{fmtUsd(contract.monthlyValueUsd)}/mo</span>
        </div>
        <div className="text-[12px] text-muted">{contract.title}</div>
        <ul className="mt-2 space-y-1">
          {contract.lines.map((line) => (
            <ContractLine key={line.lineId} line={line} />
          ))}
        </ul>
        <ul className="mt-3 space-y-0.5 text-[11px] text-faint">
          {contract.terms.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center gap-2">
          <FileCode2 className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">Infrastructure spec</span>
          <span className="ml-auto font-mono text-[11px] text-faint">from ticket</span>
        </div>
        <IaCCodeLens />
        <pre className="mt-1 overflow-x-auto rounded-md border border-border-subtle bg-surface p-2.5 font-mono text-[11.5px] leading-relaxed text-text">
          <EnrichedText text={ticket.infrastructureSpec} ticket={ticket} />
        </pre>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center gap-2">
          <Clock3 className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">Ticket timeline</span>
        </div>
        <ol className="space-y-1.5 text-[11.5px]">
          {ticket.timeline.map((t) => (
            <li key={t.at + t.actor} className="grid grid-cols-[auto_1fr] gap-x-2">
              <span className="font-mono text-faint">{fmtDateTimeUtc(t.at)}</span>
              <span>
                <span className="text-muted">{t.actor}:</span> {t.note}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function SlaCountdown({ breachAt }: { breachAt: string }) {
  const left = countdown(breachAt);
  const breached = left === "BREACHED";
  return (
    <Pill tone={breached ? "critical" : "warning"} icon={<Clock3 />} title={`SLA breach at ${fmtDateTimeUtc(breachAt)}`}>
      {breached ? "SLA BREACHED" : `breach in ${left}`}
    </Pill>
  );
}

/** Replaces known entity ids inside free text with hoverable pills. */
function EnrichedText({ text, ticket }: { text: string; ticket: ErpTicket }) {
  const entities = useMemo(() => [...ticket.entities].sort((a, b) => b.id.length - a.id.length), [ticket.entities]);
  const parts = useMemo(() => {
    if (!entities.length) return [text];
    const re = new RegExp(`(${entities.map((e) => e.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return text.split(re);
  }, [text, entities]);
  const byId = new Map(entities.map((e) => [e.id, e]));
  return (
    <>
      {parts.map((part, i) => {
        const entity = byId.get(part);
        return entity ? <EntityPill key={`${part}-${i}`} entityId={entity.id} entityType={entity.type as EntityType} label={entity.label} /> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/** UX Pattern 2 — Semantic Floating Toolbar on the entitlement line. */
function ContractLine({ line }: { line: ErpContractLine }) {
  const toolbarLineId = useWorkbench((s) => s.toolbarLineId);
  const setToolbarLine = useWorkbench((s) => s.setToolbarLine);
  const layout = useWorkbench((s) => s.layout);
  const context = useWorkbench((s) => s.context);
  const flash = useWorkbench((s) => s.flashComponent);
  const remediate = useWorkbench((s) => s.remediate);
  const open = toolbarLineId === line.lineId;

  useEffect(
    () =>
      onDemo((beat) => {
        if (beat.kind === "toolbar" && beat.lineId === line.lineId) setToolbarLine(line.lineId);
      }),
    [line.lineId, setToolbarLine],
  );

  const card = layout?.components.find((c): c is Extract<typeof c, { type: "LicenseDriftCard" }> => c.type === "LicenseDriftCard")?.props as LicenseDriftCard | undefined;
  const assigned = card?.entraAssignedCount ?? context?.license.data.entraAssignedCount ?? 0;
  const billed = card?.erpBilledCount ?? line.quantity;
  const missing = Math.max(0, billed - assigned);
  const burn = card?.burnRateDeltaUsdPerMonth ?? missing * line.unitPriceUsd;
  const skuShort = line.skuName.replace("Microsoft 365 ", "");

  if (!line.semanticAnchor) {
    return (
      <li className="flex items-baseline justify-between gap-2 rounded px-1.5 py-1 text-[12px]">
        <span>{line.description}</span>
        <span className="font-mono text-[11px] text-faint">
          {line.quantity}× {fmtUsd(line.unitPriceUsd)}
        </span>
      </li>
    );
  }
  return (
    <li className="relative">
      {open && (
        <div className="absolute -top-9 left-0 z-20 flex animate-fade-in items-center gap-1 rounded-md border border-border bg-elevated p-1 shadow-popover">
          <Pill tone={missing ? "warning" : "healthy"} icon={<Sparkles />}>
            {assigned}/{billed} Assigned • {missing} Missing {skuShort}
          </Pill>
          <Pill tone={burn > 0 ? "critical" : "muted"} title="Billed but not delivered">
            {burn > 0 ? `+${fmtUsd(burn)}/mo burn` : "no burn delta"}
          </Pill>
          <Button size="xs" variant="outline" onClick={() => flash("LicenseDriftCard")}>
            Show drifted users
          </Button>
          <Button size="xs" variant="meta" icon={<Wrench />} onClick={() => void remediate()}>
            Generate Fix
          </Button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setToolbarLine(open ? null : line.lineId)}
        // a drag-select over the line must also pop the toolbar (the click may not fire when the mouse-up lands elsewhere)
        onMouseUp={() => {
          const sel = window.getSelection();
          if (!open && sel && !sel.isCollapsed && sel.toString().trim().length > 0) setToolbarLine(line.lineId);
        }}
        className={`flex w-full cursor-pointer items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors ${open ? "bg-primary/12 ring-1 ring-primary/40" : "hover:bg-surface"}`}
        title="Click or select to open the semantic toolbar (2)"
      >
        <span className="border-b border-dashed border-amber-400/60 pb-px">{line.description}</span>
        <span className="font-mono text-[11px] text-faint">
          {line.quantity}× {fmtUsd(line.unitPriceUsd)}
        </span>
      </button>
    </li>
  );
}

/** UX Pattern 3 — Cloud/IaC CodeLens rendered above the infrastructure spec. */
function IaCCodeLens() {
  const layout = useWorkbench((s) => s.layout);
  const context = useWorkbench((s) => s.context);
  const setDiffOpen = useWorkbench((s) => s.setDiffOpen);
  const remediate = useWorkbench((s) => s.remediate);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const banner = layout?.components.find((c): c is Extract<typeof c, { type: "IaCDriftBanner" }> => c.type === "IaCDriftBanner")?.props as IaCDriftBanner | undefined;
  const summary = banner?.summary ?? (context?.drift.summary ? `State: ${context.drift.summary}` : "State: …");
  const drift = (banner?.driftState ?? context?.drift.driftState) === "drift-detected";
  const tone: Tone = banner ? (banner.state === "critical" ? "critical" : banner.state === "warning" ? "warning" : "healthy") : "muted";
  const lensLink = "font-mono text-[11px] text-primary hover:underline disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
      <GitCompareArrows className={`size-3 ${TONE_TEXT[tone]}`} />
      <span className={tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "healthy" ? "text-healthy" : "text-muted"}>{summary}</span>
      {banner && (
        <span className="text-faint">
          · {banner.terraformFile} @ <Mono>{banner.gitBranch}</Mono>
        </span>
      )}
      <span className="text-faint">|</span>
      <button type="button" className={lensLink} onClick={() => setDiffOpen(true)} disabled={!banner}>
        [View Diff]
      </button>
      <span className="text-faint">|</span>
      <button type="button" className={lensLink} onClick={() => void remediate()} disabled={!drift || remediateStatus === "loading"}>
        {remediateStatus === "loading" ? "[Generating…]" : "[Generate Fix & Stage PR]"}
      </button>
    </div>
  );
}

export function PaneHeader({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4">
      <span className="text-primary [&>svg]:size-3.5">{icon}</span>
      <span className="section-label">{title}</span>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}
