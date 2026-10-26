import { AlertOctagon, Check, ChevronRight, CircleCheckBig, ClipboardList, Clock3, Eye, FileCode2, FileText, ImageIcon, ListChecks, Radar, ScanEye, Ticket, UserRound } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { CATEGORY_META, type EnrichedEntity, type ResolutionStep, type ScenarioBrief } from "@contextpane/catalog";
import type { ErpAttachment } from "@/lib/api";
import { fmtDateTimeUtc, fmtMs, fmtTokens } from "@/lib/format";
import { CATEGORY_ORDER, CAT_DOT, CAT_TEXT, catStyle } from "@/lib/provenance";
import { selectConvergence, useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { EntityPill } from "./EntityPill";

/**
 * Left pane. In three seconds: what the issue is (summary), what MCP enriched
 * (colour-coded entities linked to their cards) and the exact steps that resolve
 * it. Contract, infrastructure spec and timeline stay folded at the bottom.
 */
export function ScenarioPane() {
  const brief = useWorkbench((s) => s.brief);
  const status = useWorkbench((s) => s.briefStatus);
  if (!brief) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {status === "error" ? "Orchestrator unreachable — start apps/orchestrator on :4000" : "Loading scenario…"}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4" data-testid="scenario-pane">
      <ScenarioHeader brief={brief} />
      <SummaryPlan brief={brief} />
      <ScenarioText brief={brief} />
      <EnrichedContext entities={brief.entities} />
      <div className="space-y-1.5">
        {brief.contract && (
          <Accordion icon={<FileText />} title={`Contract #${brief.contract.contractId}`} hint={brief.contract.title}>
            <ul className="space-y-0.5 text-[12px]">
              {brief.contract.lines.map((l) => (
                <li key={l.description} className="flex justify-between gap-2">
                  <span>{l.description}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    {l.quantity}× {l.skuPartNumber}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-2 space-y-0.5 text-[11px] text-faint">
              {brief.contract.terms.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
          </Accordion>
        )}
        {brief.infrastructureSpec && (
          <Accordion icon={<FileCode2 />} title="Infrastructure spec" hint={brief.infrastructureSpec.split("\n")[0]}>
            <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-text">{brief.infrastructureSpec}</pre>
          </Accordion>
        )}
        {brief.timeline.length > 0 && (
          <Accordion icon={<Clock3 />} title="Timeline" hint={`${brief.timeline.length} entries`}>
            <ol className="space-y-1 text-[11.5px]">
              {brief.timeline.map((t) => (
                <li key={t.at + t.actor} className="grid grid-cols-[auto_1fr] gap-x-2">
                  <span className="font-mono text-faint">{fmtDateTimeUtc(t.at)}</span>
                  <span>
                    <span className="text-muted">{t.actor}:</span> {t.note}
                  </span>
                </li>
              ))}
            </ol>
          </Accordion>
        )}
      </div>
    </div>
  );
}

function ScenarioHeader({ brief }: { brief: ScenarioBrief }) {
  const resolved = Boolean(useWorkbench(selectConvergence));
  const ticket = brief.kind === "ticket";
  return (
    <header>
      <div className="flex flex-wrap items-center gap-2">
        {ticket ? <Ticket className="size-4 text-primary" /> : <Radar className="size-4 text-primary" />}
        <span className="font-mono text-[13px] font-semibold">#{brief.scenarioId}</span>
        <Pill tone={resolved ? "healthy" : ticket ? "warning" : "critical"} icon={resolved ? <Check /> : <AlertOctagon />}>
          {resolved ? "Resolved" : brief.status}
        </Pill>
        <span className="truncate text-[11px] text-faint">{brief.origin}</span>
      </div>
      <h2 className="mt-1.5 text-[15px] leading-snug font-semibold">{brief.title}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>{brief.tenantName}</span>
        <span className="font-mono">{brief.verifiedDomain}</span>
        {brief.requester && (
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3" />
            {brief.requester.displayName} · {brief.requester.role}
          </span>
        )}
        <span>{ticket ? "opened" : "detected"} {fmtDateTimeUtc(brief.openedAt)}</span>
      </div>
    </header>
  );
}

/** The 3-second view: root cause in 1-2 sentences, then the numbered, clickable resolution plan. */
function SummaryPlan({ brief }: { brief: ScenarioBrief }) {
  const resolved = Boolean(useWorkbench(selectConvergence));
  return (
    <section className={`rounded-[10px] border-2 p-3 ${resolved ? "border-healthy/50 bg-healthy/6" : "border-primary/45 bg-primary/6"}`} data-testid="summary-plan">
      <div className="mb-1.5 flex items-center gap-2">
        <ClipboardList className={`size-4 ${resolved ? "text-healthy" : "text-primary"}`} />
        <span className="text-[12px] font-semibold tracking-wide uppercase">Summary &amp; Resolution Plan</span>
        {resolved && (
          <span className="ml-auto inline-flex h-5 items-center gap-1 rounded border border-healthy/40 bg-healthy/12 px-1.5 text-[10.5px] text-healthy">
            <CircleCheckBig className="size-3" />
            Resolved
          </span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-text">{brief.summary}</p>
      <div className="mt-2.5 mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <ListChecks className="size-3.5" />
        Steps to resolve
      </div>
      <ol className="space-y-1">
        {brief.steps.map((step, i) => (
          <PlanStep key={step.id} step={step} index={i + 1} resolved={resolved} />
        ))}
      </ol>
    </section>
  );
}

function PlanStep({ step, index, resolved }: { step: ResolutionStep; index: number; resolved: boolean }) {
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const checked = useWorkbench((s) => Boolean(s.stepsDone[`${scenarioId}:${step.id}`])) || resolved;
  const toggle = useWorkbench((s) => s.toggleStep);
  const runStep = useWorkbench((s) => s.runStep);
  const setLinked = useWorkbench((s) => s.setLinked);
  const focusCard = useWorkbench((s) => s.focusCard);
  return (
    <li
      style={catStyle(step.category)}
      className="group flex items-start gap-2 rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-[color-mix(in_oklab,var(--cat)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--cat)_8%,transparent)]"
      onMouseEnter={() => setLinked({ target: step.target, category: step.category })}
      onMouseLeave={() => setLinked(null)}
    >
      <button
        type="button"
        onClick={() => toggle(step.id)}
        aria-pressed={checked}
        aria-label={`Mark step ${index} done`}
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border text-[10px] ${checked ? "border-healthy bg-healthy text-canvas" : "border-[var(--cat)] text-[var(--cat)]"}`}
      >
        {checked ? <Check className="size-3" /> : index}
      </button>
      <button type="button" onClick={() => focusCard(step.target, step.tab)} className="min-w-0 flex-1 text-left" title="Open the card for this step">
        <span className={`mr-1.5 text-[12px] font-semibold ${CAT_TEXT}`}>{step.title}:</span>
        <span className={`text-[12.5px] ${checked ? "text-muted line-through decoration-healthy/60" : "text-text"}`}>{step.detail}</span>
      </button>
      <Button size="xs" variant="outline" icon={<ChevronRight />} className="shrink-0 opacity-80 group-hover:opacity-100" onClick={() => runStep(step)}>
        {step.action.label}
      </Button>
    </li>
  );
}

/** The ticket description or the anomaly narrative, with every enriched entity as an inline pill. */
function ScenarioText({ brief }: { brief: ScenarioBrief }) {
  return (
    <section className="card">
      <div className="section-label mb-1.5">{brief.kind === "ticket" ? "Customer ticket" : "Anomalous tenant state"}</div>
      <p className="text-[12.5px] leading-relaxed text-text">
        <EnrichedText text={brief.body} entities={brief.entities} />
      </p>
      {brief.signals.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {brief.signals.map((sig) => (
            <li key={sig.label} style={catStyle(sig.category)} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11.5px]">
              <span className={`inline-flex items-center gap-1.5 font-medium ${CAT_TEXT}`}>
                <span className={`size-1.5 rounded-full ${CAT_DOT}`} />
                {sig.label}
              </span>
              <span className="text-text">{sig.value}</span>
              <span />
              <span className="font-mono text-[10px] text-faint">{sig.source}</span>
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

/** "Detected & Enriched Context": every MCP-enriched entity, grouped by semantic provenance colour. */
function EnrichedContext({ entities }: { entities: EnrichedEntity[] }) {
  const groups = CATEGORY_ORDER.map((c) => ({ category: c, items: entities.filter((e) => e.category === c) })).filter((g) => g.items.length);
  return (
    <section className="card" data-testid="enriched-context">
      <div className="section-label mb-2">Detected &amp; Enriched Context</div>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.category} style={catStyle(g.category)}>
            <div className={`mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider uppercase ${CAT_TEXT}`}>
              <span className={`size-2 rounded-full ${CAT_DOT}`} />
              {CATEGORY_META[g.category].label}
            </div>
            <div className="flex flex-wrap gap-1">
              {g.items.map((e) => (
                <EntityPill key={`${e.category}-${e.id}`} entity={e} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Accordion({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[12px]">
        <ChevronRight className={`size-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="shrink-0 text-muted [&>svg]:size-3.5">{icon}</span>
        <span className="shrink-0 font-medium">{title}</span>
        {hint && !open && <span className="truncate text-[11px] text-faint">· {hint}</span>}
      </button>
      {open && <div className="border-t border-border-subtle px-2.5 py-2">{children}</div>}
    </section>
  );
}

/** Customer screenshot on the ticket; one click reads it with Muse Spark 1.3 (image input) and pins the matching sign-in. */
function TicketAttachment({ attachment }: { attachment: ErpAttachment }) {
  const vision = useWorkbench((s) => s.vision);
  const extract = useWorkbench((s) => s.extractVision);
  const result = vision.status === "ready" ? vision.result : undefined;
  const x = result?.extraction;
  return (
    <div className="mt-3" data-testid="ticket-attachment">
      <div className="flex gap-2.5 rounded-md border border-border-subtle bg-surface p-2">
        <a href={attachment.url} target="_blank" rel="noreferrer" className="shrink-0" title="Open full size">
          <img src={attachment.url} alt={`Customer screenshot ${attachment.fileName}`} className="h-[56px] w-[90px] rounded border border-border object-cover" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11.5px]">
            <ImageIcon className="size-3 shrink-0 text-muted" />
            <span className="truncate font-mono">{attachment.fileName}</span>
          </div>
          <div className="mt-0.5 text-[10.5px] text-faint">
            {attachment.uploadedBy} · {Math.round(attachment.sizeBytes / 1024)} KB
          </div>
          <Button size="xs" variant="meta" icon={<ScanEye />} className="mt-1" loading={vision.status === "loading"} onClick={() => void extract(attachment)}>
            Extract Telemetry via Muse Vision
          </Button>
        </div>
      </div>
      {vision.status === "error" && <div className="mt-1 text-[11px] text-critical">Vision failed: {vision.error}</div>}
      {result && !x && <div className="mt-1 text-[11px] text-critical">Vision failed: {result.error}</div>}
      {result && x && (
        <div className="mt-1.5 animate-fade-in rounded-md border border-meta/40 bg-meta/8 p-2 text-[11px]" data-testid="vision-result">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-faint">Error</dt>
            <dd className="font-mono text-critical">{x.errorCode}</dd>
            <dt className="text-faint">Correlation</dt>
            <dd className="truncate font-mono">{x.correlationId}</dd>
            <dt className="text-faint">Device</dt>
            <dd className="truncate">{x.deviceState}</dd>
          </dl>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {result.match ? (
              <Pill tone="meta" icon={<Eye />} title={`${result.match.upn} · ${result.match.timestamp}`}>
                matched {result.match.eventId} · Δ {result.match.deltaSeconds ?? "?"} s
              </Pill>
            ) : (
              <Pill tone="warning">no matching sign-in</Pill>
            )}
            <span className="ml-auto font-mono text-[10px] text-faint">
              {result.telemetry.modelId} · {fmtMs(result.telemetry.latencyMs)} · {fmtTokens(result.telemetry.tokensUsed.total)} tok
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Replaces enriched entity ids (and their longer labels) inside free text with inline pills. */
function EnrichedText({ text, entities }: { text: string; entities: EnrichedEntity[] }) {
  const { parts, byNeedle } = useMemo(() => {
    const byNeedle = new Map<string, EnrichedEntity>();
    for (const e of entities) {
      for (const needle of [e.id, e.label]) if (needle.length >= 6 && !byNeedle.has(needle)) byNeedle.set(needle, e);
    }
    const needles = [...byNeedle.keys()].sort((a, b) => b.length - a.length);
    if (!needles.length) return { parts: [text], byNeedle };
    const re = new RegExp(`(${needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return { parts: text.split(re), byNeedle };
  }, [text, entities]);
  return (
    <>
      {parts.map((part, i) => {
        const entity = byNeedle.get(part);
        return entity ? <EntityPill key={`${part}-${i}`} entity={{ ...entity, label: part }} inline /> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
