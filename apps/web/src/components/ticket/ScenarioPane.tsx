import { AlertOctagon, Check, ChevronRight, CircleCheckBig, ClipboardList, Clock3, Eye, FileCode2, FileText, FolderInput, ImageIcon, Inbox, Layers, ListChecks, RotateCcw, ScanEye, Sparkles, UserRound, Wand2 } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { CATEGORY_META, type EnrichedEntity, type ResolutionStep, type ScenarioBrief } from "@contextpane/catalog";
import type { ErpAttachment } from "@/lib/api";
import { fmtDateTimeUtc } from "@/lib/format";
import { CATEGORY_ORDER, CAT_DOT, CAT_TEXT, catStyle } from "@/lib/provenance";
import { selectConvergence, useWorkbench } from "@/store";
import { OriginBadge } from "../hud/WorkQueue";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { EntityPill } from "./EntityPill";
import { ResolutionNoteBox } from "./ResolutionNote";
import { SelectionTrigger } from "./SelectionTrigger";

/**
 * Left pane. In three seconds: what the issue is (summary), what MCP enriched
 * (colour-coded entities linked to their cards) and the exact steps that resolve
 * it. Enriched objects, contract, infrastructure spec and timeline stay folded at the bottom.
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
      <div className="space-y-1.5">
        <EnrichedContext entities={brief.entities} />
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
  const closed = useWorkbench((s) => Boolean(s.resolutionNote?.closed && s.resolutionNote.scenarioId === brief.scenarioId));
  const ticket = brief.kind === "ticket";
  const origin = brief.originKind;
  const drop = origin === "erp-drop";
  const unscripted = Boolean(brief.extraction);
  const open = drop ? "NEW" : ticket ? "OPEN" : "ACTIVE DRIFT";
  return (
    <header>
      <div className="flex flex-wrap items-center gap-2">
        <OriginBadge origin={origin} />
        <span className="font-mono text-[13px] font-semibold" data-testid="scenario-display-id">{brief.displayId ?? `#${brief.scenarioId}`}</span>
        <Pill tone={resolved ? "healthy" : drop ? "meta" : ticket ? "critical" : "warning"} icon={resolved ? <Check /> : drop ? <Inbox /> : <AlertOctagon />} mono={false} className="font-semibold tracking-wide" flashKey={resolved ? "resolved" : "open"}>
          {closed ? "CLOSED IN PSA ✓" : resolved ? "RESOLVED & VERIFIED ✓" : open}
        </Pill>
        {unscripted && (
          <Pill tone="primary" icon={drop ? <FolderInput /> : <Sparkles />} title={brief.extraction?.rationale}>
            {drop ? "triaged from drop" : "unscripted"} · base {brief.extraction?.baseScenarioId}
          </Pill>
        )}
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
        {brief.priority && <span className="font-mono">priority {brief.priority}</span>}
      </div>
    </header>
  );
}

/** The 3-second view: root cause in 1-2 sentences, then the numbered, clickable resolution plan. */
function SummaryPlan({ brief }: { brief: ScenarioBrief }) {
  const resolved = Boolean(useWorkbench(selectConvergence));
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  const reopenTicket = useWorkbench((s) => s.reopenTicket);
  return (
    <section className={`rounded-[10px] border-2 p-3 ${resolved ? "border-healthy/50 bg-healthy/6" : "border-primary/45 bg-primary/6"}`} data-testid="summary-plan">
      <div className="mb-1.5 flex items-center gap-2">
        <ClipboardList className={`size-4 ${resolved ? "text-healthy" : "text-primary"}`} />
        <span className="text-[12px] font-semibold tracking-wide uppercase">Summary &amp; Resolution Plan</span>
        {resolved && (
          <>
            <span className="ml-auto inline-flex h-5 items-center gap-1 rounded border border-healthy/40 bg-healthy/12 px-1.5 text-[10.5px] text-healthy">
              <CircleCheckBig className="size-3" />
              Resolved
            </span>
            <button
              type="button"
              onClick={() => void reopenTicket()}
              className="inline-flex h-5 items-center gap-1 rounded border border-border px-1.5 text-[10.5px] text-muted hover:text-text"
              title="Clear the resolved state so the remediation can run again"
              data-testid="reopen-ticket"
            >
              <RotateCcw className="size-3" />
              Reopen Ticket
            </button>
          </>
        )}
      </div>
      <SelectionTrigger>
        <p className="text-[13px] leading-relaxed text-text" data-testid="summary-text">
          <EnrichedText text={brief.summary} entities={NO_ENTITIES} selections={selections} />
        </p>
      </SelectionTrigger>
      <div className="mt-2.5 mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <ListChecks className="size-3.5" />
        Steps to resolve
      </div>
      <SelectionTrigger>
        <ol className="space-y-1">
          {brief.steps.map((step, i) => (
            <PlanStep key={step.id} step={step} index={i + 1} resolved={resolved} selections={selections} />
          ))}
        </ol>
      </SelectionTrigger>
      <FleetPill />
      {resolved && <ResolutionNoteBox />}
    </section>
  );
}

/** Multi-tenant callout inside the Resolution Plan; opens the Other Clients tab in the Action Approval Drawer. */
function FleetPill() {
  const fleet = useWorkbench((s) => s.fleet);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  if (!fleet || fleet.affectedCount === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openRemediation({ tab: "fleet" })}
      className="mt-2.5 inline-flex min-h-6 items-center gap-1.5 rounded-md border border-warning/45 bg-warning/10 px-2.5 py-1 text-left text-[11.5px] leading-tight whitespace-normal text-warning transition-colors hover:bg-warning/20"
      title={`Review ${fleet.affectedCount} other client tenants with this same misconfiguration`}
      data-testid="fleet-pill"
    >
      <span>🌐 {fleet.affectedCount} other client tenants have this same misconfiguration ·</span>
      <span className="font-semibold underline decoration-warning/60 underline-offset-2">[Review &amp; Fix All {fleet.affectedCount} →]</span>
    </button>
  );
}

const STEP_CATEGORY_FALLBACKS = ["identity", "licensing", "azure", "intune"] as const;

function PlanStep({ step, index, resolved, selections }: { step: ResolutionStep; index: number; resolved: boolean; selections: Array<{ id: string; text: string; index: number }> }) {
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const steps = useWorkbench((s) => s.brief?.steps ?? []);
  const checked = useWorkbench((s) => Boolean(s.stepsDone[`${scenarioId}:${step.id}`])) || resolved;
  const toggle = useWorkbench((s) => s.toggleStep);
  const runStep = useWorkbench((s) => s.runStep);
  const setLinked = useWorkbench((s) => s.setLinked);
  const focusCard = useWorkbench((s) => s.focusCard);
  const allSameCategory = steps.length > 1 && steps.every((s) => s.category === steps[0]?.category);
  const effectiveCategory = allSameCategory ? STEP_CATEGORY_FALLBACKS[(index - 1) % STEP_CATEGORY_FALLBACKS.length]! : step.category;
  return (
    <li
      style={catStyle(effectiveCategory)}
      className="group flex items-start gap-2 rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-[color-mix(in_oklab,var(--cat)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--cat)_8%,transparent)]"
      onMouseEnter={() => setLinked({ target: step.target, category: effectiveCategory })}
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
      {/* Selectable text, not a <button>: dragging over a step highlights it for Generate Context UI instead of clicking. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (window.getSelection()?.toString().trim()) return;
          focusCard(step.target, step.tab);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          focusCard(step.target, step.tab);
        }}
        className="min-w-0 flex-1 cursor-pointer text-left select-text"
        title="Open the card for this step"
        data-testid="plan-step-text"
      >
        <span className={`mr-1.5 text-[12px] font-semibold ${CAT_TEXT}`}>{step.title}:</span>
        <span className={`text-[12.5px] ${checked ? "text-muted line-through decoration-healthy/60" : "text-text"}`}>
          <EnrichedText text={step.detail} entities={NO_ENTITIES} selections={selections} />
        </span>
      </div>
      <Button
        size="xs"
        variant="outline"
        icon={<ChevronRight />}
        className="shrink-0 opacity-80 group-hover:opacity-100"
        disabled={resolved && step.action.kind === "stage-fix"}
        title={resolved && step.action.kind === "stage-fix" ? "Already resolved: reopen the ticket to run it again" : undefined}
        onClick={() => runStep(step)}
      >
        {step.action.label}
      </Button>
    </li>
  );
}

const NO_SELECTIONS: Array<{ id: string; text: string; index: number }> = [];
const NO_ENTITIES: EnrichedEntity[] = [];

/** The ticket description or the anomaly narrative, with every enriched entity as an inline pill. */
function ScenarioText({ brief }: { brief: ScenarioBrief }) {
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  return (
    <section className="card">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="section-label">{brief.originKind === "erp-drop" ? "ERP ticket (file drop)" : brief.kind === "ticket" ? "Customer ticket" : "Anomalous tenant state"}</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-pill border border-selection/45 bg-selection/12 px-2 py-0.5 text-[10.5px] font-medium text-selection" title="Highlight 3-120 characters of the text, then click the pill to spawn a live mini-dashboard">
          <Wand2 className="size-3 text-selection" /> ✨ Select any ticket text to generate Context UI
        </span>
      </div>
      <SelectionTrigger>
        <p className="text-[12.5px] leading-relaxed text-text" data-testid="scenario-body">
          <EnrichedText text={brief.body} entities={brief.entities} selections={selections} />
        </p>
      </SelectionTrigger>
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

/** Closed-by-default accordion of all MCP-enriched tenant objects, grouped by domain colour. */
function EnrichedContext({ entities }: { entities: EnrichedEntity[] }) {
  const [open, setOpen] = useState(false);
  const groups = CATEGORY_ORDER.map((c) => ({ category: c, items: entities.filter((e) => e.category === c) })).filter((g) => g.items.length);
  return (
    <section className="rounded-md border border-border-subtle bg-surface" data-testid="enriched-context">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[12px] hover:bg-elevated/60"
      >
        <span className="font-mono text-[11px] font-bold text-primary" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="shrink-0 text-muted [&>svg]:size-3.5">
          <Layers />
        </span>
        <span className="shrink-0 font-medium">Enriched Tenant Objects ({entities.length})</span>
        {!open && <span className="truncate text-[11px] text-muted">· {groups.map((g) => CATEGORY_META[g.category].label).join(", ")}</span>}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{open ? "Collapse ▾" : "Expand ▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border-subtle px-2.5 py-2">
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
      )}
    </section>
  );
}

function Accordion({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[12px] hover:bg-elevated/60">
        <span className="font-mono text-[11px] font-bold text-primary" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="shrink-0 text-muted [&>svg]:size-3.5">{icon}</span>
        <span className="shrink-0 font-medium">{title}</span>
        {hint && !open && <span className="truncate text-[11px] text-muted">· {hint}</span>}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{open ? "Collapse ▾" : "Expand ▸"}</span>
      </button>
      {open && <div className="border-t border-border-subtle px-2.5 py-2">{children}</div>}
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
            {attachment.url.startsWith("/api/tickets/inbox-attachment/") ? ` · read from input/tickets/${decodeURIComponent(attachment.url.split("/")[4] ?? "")}/` : ""}
          </div>
          <Button size="xs" variant="meta" icon={<ScanEye />} className="mt-1" loading={vision.status === "loading"} onClick={() => void extract(attachment)}>
            Scan Screenshot for Error Code &amp; Timestamp
          </Button>
        </div>
      </div>
      {vision.status === "error" && <div className="mt-1 text-[11px] text-critical">Screenshot scan failed: {vision.error}</div>}
      {result && !x && <div className="mt-1 text-[11px] text-critical">Screenshot scan failed: {result.error}</div>}
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
              <Pill tone="meta" icon={<Eye />} mono={false} title={`${result.match.upn} · ${result.match.timestamp}`}>
                ✓ Matched sign-in event ({result.match.eventId})
              </Pill>
            ) : (
              <Pill tone="warning" mono={false}>No matching sign-in found</Pill>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces enriched entity ids (and their longer labels) inside free text with inline pills, and
 * wraps every phrase the engineer explored in a cyan "Selection #n" provenance badge that links
 * to its mini-dashboard on the canvas.
 */
function EnrichedText({ text, entities, selections = [] }: { text: string; entities: EnrichedEntity[]; selections?: Array<{ id: string; text: string; index: number }> }) {
  const { parts, byNeedle, bySelection } = useMemo(() => {
    const byNeedle = new Map<string, EnrichedEntity>();
    for (const e of entities) {
      for (const needle of [e.id, e.label]) if (needle.length >= 6 && !byNeedle.has(needle)) byNeedle.set(needle, e);
    }
    const bySelection = new Map<string, { id: string; text: string; index: number }>();
    for (const s of selections) bySelection.set(s.text.toLowerCase(), s);
    // Selections first: an explored phrase is marked even when it overlaps an entity id.
    const selectionNeedles = [...bySelection.values()].map((s) => s.text).sort((a, b) => b.length - a.length);
    const entityNeedles = [...byNeedle.keys()].filter((n) => !bySelection.has(n.toLowerCase())).sort((a, b) => b.length - a.length);
    const all = [...selectionNeedles.map(escapeRe), ...entityNeedles.map(escapeRe)];
    if (!all.length) return { parts: [text], byNeedle, bySelection };
    const re = new RegExp(`(${all.join("|")})`, selectionNeedles.length ? "gi" : "g");
    return { parts: text.split(re), byNeedle, bySelection };
  }, [text, entities, selections]);
  return (
    <>
      {parts.map((part, i) => {
        if (part === undefined || part === "") return null;
        const selection = bySelection.get(part.toLowerCase());
        if (selection) return <SelectionBadge key={`sel-${part}-${i}`} selection={selection} text={part} />;
        const entity = byNeedle.get(part);
        return entity ? <EntityPill key={`${part}-${i}`} entity={{ ...entity, label: part }} inline /> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/** Cyan provenance badge on an explored phrase; hovering it pulses the mini-dashboard it spawned. */
function SelectionBadge({ selection, text }: { selection: { id: string; text: string; index: number }; text: string }) {
  const setLinked = useWorkbench((s) => s.setLinkedSelection);
  const mounted = useWorkbench((s) => s.miniDashboards.some((m) => m.id === selection.id));
  const explore = useWorkbench((s) => s.exploreSelection);
  return (
    <button
      type="button"
      data-selection={selection.id}
      onMouseEnter={() => setLinked(selection.id)}
      onMouseLeave={() => setLinked(null)}
      onClick={() => (mounted ? document.getElementById(`mini-${selection.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) : void explore(selection.text))}
      title={mounted ? `Selection #${selection.index} · click to scroll to its mini-dashboard` : `Selection #${selection.index} · dismissed; click to generate it again`}
      className={`inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 align-middle font-mono text-[11px] transition-colors hover:brightness-125 ${mounted ? "border-selection/60 bg-selection/14 text-selection" : "border-selection/30 bg-selection/6 text-selection/70"}`}
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
      <span className="shrink-0 font-sans text-[9.5px] opacity-80">#{selection.index}</span>
    </button>
  );
}
