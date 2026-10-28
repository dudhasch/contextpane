import { FloatingPortal, autoUpdate, flip, offset, shift, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import { Check, Cloud, ExternalLink, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ClarifyingQuestion, ResolutionStep, ScenarioBrief, SubAgentTaskRecord, UpstreamCloudStatusCorrelation } from "@contextpane/catalog";
import { onDemo } from "@/lib/demo";
import { fmtMs, SOURCE_LABEL } from "@/lib/format";
import { catStyle } from "@/lib/provenance";
import { selectConvergence, useWorkbench } from "@/store";
import { Ghost } from "../canvas/Section";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { cleanInlineSlugs, EnrichedText, humanizeClarifierSlug, NO_ENTITIES, NO_SELECTIONS, type SelectionItem } from "./EnrichedText";
import { ResolutionNoteBox } from "./ResolutionNote";

/**
 * Summary & resolution plan, borderless. The header carries the agent / cloud status as one mono
 * line (click → popover with the five sub-agent stages and the upstream cloud status). Clarifier
 * questions render as scope chips inside the plan step they steer (`question.stepId`); unmapped
 * ones sit in a row under the header.
 */
export function PlanSection({ brief }: { brief: ScenarioBrief }) {
  const resolved = Boolean(useWorkbench(selectConvergence));
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  const reopenTicket = useWorkbench((s) => s.reopenTicket);
  const triageStatus = useWorkbench((s) => s.triageStatus);
  const questions = brief.clarifyingQuestions ?? NO_QUESTIONS;
  const scope = useScopeDraft(brief.scenarioId, questions, brief.clarifiedAnswers ?? NO_ANSWERS);
  const stepIds = useMemo(() => new Set(brief.steps.map((s) => s.id)), [brief.steps]);
  const byStep = useMemo(() => {
    const m = new Map<string, ClarifyingQuestion[]>();
    for (const q of questions) if (q.stepId && stepIds.has(q.stepId)) m.set(q.stepId, [...(m.get(q.stepId) ?? []), q]);
    return m;
  }, [questions, stepIds]);
  const unmapped = questions.filter((q) => !(q.stepId && stepIds.has(q.stepId)));
  const hasTasks = Boolean((brief.subAgentTasks && brief.subAgentTasks.length > 0) || triageStatus === "loading");
  // WP6: a refine keeps the plan mounted; summary and step details ghost until the new routing lands.
  const briefPending = useWorkbench((s) => s.pendingRefine.brief);

  return (
    <section className="mt-1 border-t border-hairline pt-1.5" data-testid="summary-plan">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="section-label">Summary &amp; resolution plan</span>
        {resolved && (
          <span className="inline-flex items-center gap-2">
            <Pill variant="status" tone="healthy" mono={false}>
              Resolved
            </Pill>
            <button
              type="button"
              onClick={() => void reopenTicket()}
              className="inline-flex h-5 items-center gap-1 rounded-sm px-1 text-11 text-muted transition-colors hover:bg-raised hover:text-text"
              title="Clear the resolved state so the remediation can run again"
              data-testid="reopen-ticket"
            >
              <RotateCcw className="size-3" />
              Reopen ticket
            </button>
          </span>
        )}
        {(hasTasks || brief.cloudStatusCorrelation) && (
          <AgentStatusLine scenarioId={brief.scenarioId} tasks={brief.subAgentTasks ?? NO_TASKS} correlation={brief.cloudStatusCorrelation} />
        )}
      </div>
      {questions.length > 0 && <ScopeBar scope={scope} unmapped={unmapped} mappedCount={questions.length - unmapped.length} />}
      <p className="mt-0.5 text-13 text-text" data-testid="summary-text" aria-busy={briefPending || undefined}>
        <Ghost pending={briefPending}>
          <EnrichedText text={cleanInlineSlugs(brief.summary)} entities={NO_ENTITIES} selections={selections} />
        </Ghost>
      </p>
      <ol className="mt-0.5 divide-y divide-hairline-2" aria-busy={briefPending || undefined}>
        {brief.steps.map((step, i) => (
          <PlanStep key={step.id} step={step} index={i + 1} resolved={resolved} selections={selections} questions={byStep.get(step.id)} scope={scope} pending={briefPending} />
        ))}
      </ol>
      <FleetPill />
      {resolved && <ResolutionNoteBox />}
    </section>
  );
}

const NO_QUESTIONS: ClarifyingQuestion[] = [];
const NO_ANSWERS: Record<string, string> = {};
const NO_TASKS: SubAgentTaskRecord[] = [];

/* ───────────────────────────── agent / cloud status line ───────────────────────────── */

/**
 * A stage counts as run only when it completed from its real source: the model
 * stages (1, 3, 4) from an LLM call, stage 2 from the MCP probe, stage 5 from the
 * verifier. `fallback` / `fallback-on-error` / a missing source never count as run.
 */
function taskRanForReal(t: SubAgentTaskRecord): boolean {
  if (t.status !== "completed" || !t.source || t.source === "fallback-on-error") return false;
  return t.stepIndex === 2 || t.stepIndex === 5 ? true : t.source === "llm";
}

function cloudServiceLabel(serviceId: string, primaryRegion: string | null | undefined): string {
  if (serviceId === "azure-regional") {
    return !primaryRegion || primaryRegion === "Global" ? "Azure ARM / Global" : `Azure (${primaryRegion})`;
  }
  if (serviceId === "entra-id") return "Entra ID";
  if (serviceId === "intune") return "Intune";
  if (serviceId === "github-actions") return "GitHub";
  return serviceId;
}

const STAGE_DISPLAY_META: Record<number, { name: string; role: string }> = {
  1: { name: "1. Scope Check", role: "Target Scope & Parameters" },
  2: { name: "2. Live Telemetry", role: "Live Graph & ARM Status Check" },
  3: { name: "3. View Layout", role: "Diagnostic View Layout" },
  4: { name: "4. Remediation Plan", role: "PowerShell 7 & Terraform Patch" },
  5: { name: "5. Pre-Flight Safety", role: "AST, -WhatIf & 1-Click Undo" },
};

function compactMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const SERVICE_TONE: Record<string, Tone> = { operational: "healthy", advisory: "warning", degraded: "warning", outage: "critical", unknown: "muted" };

/**
 * `✦ 5/5 agents · cloud ok · 7.2 s`: the sub-agent pipeline and the upstream cloud status in one
 * mono line. Either word opens a popover with the five stages (click one for its input / output)
 * and the correlated cloud services, advisories and runbook links.
 */
function AgentStatusLine({ scenarioId, tasks, correlation }: { scenarioId: string; tasks: SubAgentTaskRecord[]; correlation?: UpstreamCloudStatusCorrelation | null | undefined }) {
  const triageStatus = useWorkbench((s) => s.triageStatus);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const isBusy = triageStatus === "loading" || refiningGoal;
  // No recorded pipeline means none ran: nothing is invented to fill the line (H-21).
  const completedCount = tasks.filter(taskRanForReal).length;
  const allReal = tasks.length > 0 && completedCount === tasks.length;
  const anyFailed = tasks.some((t) => t.source === "fallback-on-error");
  // Steps with a start offset ran on one clock (S1, then S2 ∥ S3 ∥ S4, then S5): report wall clock, not the sum.
  const totalLatencyMs = useMemo(
    () =>
      tasks.some((t) => t.startOffsetMs !== undefined)
        ? Math.max(...tasks.map((t) => (t.startOffsetMs ?? 0) + (t.latencyMs || 0)))
        : tasks.reduce((sum, t) => sum + (t.latencyMs || 0), 0),
    [tasks],
  );
  const hasAdvisory = Boolean(correlation && (correlation.advisories.length > 0 || correlation.services.some((s) => s.status !== "operational" && s.status !== "unknown")));
  const hasOutage = Boolean(correlation?.services.some((s) => s.status === "outage"));
  // Name only the services a probe reported as operational; the rest are "not probed", never "OK".
  const okServices = correlation?.services.filter((s) => s.status === "operational").map((s) => s.label.replace(/ \(.*\)$| \/ .*$/, "")) ?? [];
  const unprobed = correlation?.services.filter((s) => s.status === "unknown").length ?? 0;

  const [open, setOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  useEffect(() => {
    setOpen(false);
    setSelectedStep(null);
  }, [scenarioId]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useDismiss(context), useRole(context, { role: "dialog" })]);

  const activeTask = tasks.find((t) => t.stepIndex === selectedStep) ?? null;
  // Compact so label + line share one row at 400px: "✦ 5/5 · cloud ok · 7.2s"; the long form is in the tooltip and popover.
  const agentsWord = isBusy ? "running…" : tasks.length === 0 ? "" : `${completedCount}/${tasks.length}`;
  const agentsTone = isBusy ? "text-signal" : anyFailed ? "text-critical" : tasks.length > 0 && !allReal ? "text-warning" : "text-muted";
  const cloudWord = !correlation ? null : hasOutage ? "outage" : hasAdvisory ? "advisory" : okServices.length ? "ok" : "unprobed";
  const cloudTone = hasOutage ? "text-critical" : hasAdvisory ? "text-warning" : okServices.length ? "text-muted" : "text-faint";

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        className="ml-auto inline-flex min-w-0 items-center gap-1 font-mono text-11 whitespace-nowrap text-faint"
        data-testid="subagent-task-strip"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="subagent-strip-toggle"
          className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-signal"
          title={
            tasks.length === 0
              ? "Triage pipeline not run for this ticket — click for the cloud status"
              : !allReal
                ? `${completedCount} of ${tasks.length} triage sub-agents ran; ${tasks.length - completedCount} fell back or were not attempted — click to inspect`
                : `${completedCount} of ${tasks.length} triage sub-agents ran — click to inspect`
          }
        >
          <span className={`text-signal ${isBusy ? "animate-pulse-dot" : ""}`}>✦</span>
          <span className={agentsWord ? agentsTone : "sr-only"} data-testid="subagent-strip-summary">
            {agentsWord || "triage not run"}
          </span>
        </button>
        {correlation && cloudWord && (
          <>
            {agentsWord && <span aria-hidden>·</span>}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              data-testid="upstream-cloud-status-banner"
              className={`rounded-sm transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-signal ${cloudTone}`}
              title={
                hasAdvisory
                  ? `${correlation.advisories[0]?.region ?? correlation.primaryRegion ?? "Regional"} advisory · correlated at incident time (${correlation.correlatedAtLabel}) — click for details`
                  : `${okServices.length ? `${okServices.join(", ")} OK` : "not probed"}${unprobed ? ` · ${unprobed} not probed` : ""} · correlated at incident time (${correlation.correlatedAtLabel}) — click for details`
              }
            >
              <Cloud className="mr-0.5 inline size-3 align-[-2px]" aria-label="cloud" />
              {cloudWord}
            </button>
          </>
        )}
        {!isBusy && totalLatencyMs > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="text-muted" title={fmtMs(totalLatencyMs)}>{compactMs(totalLatencyMs)}</span>
          </>
        )}
      </span>
      {open && (
        <FloatingPortal root={typeof document !== "undefined" ? document.body : null}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9998] w-[360px] max-w-[calc(100vw-16px)] animate-fade-in rounded-lg border border-hairline bg-raised p-2.5 text-11 text-text shadow-popover"
          >
            <div className="section-label mb-1">
              <span className="text-signal">✦</span> Triage sub-agents
            </div>
            {tasks.length === 0 ? (
              <div className="text-faint">No sub-agent pipeline recorded for this ticket.</div>
            ) : (
              <ol className="divide-y divide-hairline-2">
                {tasks.map((t) => {
                  const isSelected = selectedStep === t.stepIndex;
                  const ran = taskRanForReal(t);
                  const stageMeta = STAGE_DISPLAY_META[t.stepIndex];
                  return (
                    <li key={t.stepIndex}>
                      <button
                        type="button"
                        onClick={() => setSelectedStep(isSelected ? null : t.stepIndex)}
                        data-testid={`subagent-pill-${t.stepIndex}`}
                        aria-pressed={isSelected}
                        title={`${stageMeta?.role ?? t.role} · ${t.latencyMs} ms — click to inspect`}
                        className={`flex h-6 w-full items-center gap-2 rounded-sm px-1 text-left transition-colors hover:bg-ground ${isSelected ? "bg-signal/12 text-signal-strong" : ""}`}
                      >
                        <span className={`w-3 shrink-0 font-mono ${isBusy ? "animate-pulse-dot text-signal" : ran ? "text-healthy" : t.source === "fallback-on-error" ? "text-critical" : "text-warning"}`}>
                          {isBusy ? "●" : ran ? "✓" : "⚠"}
                        </span>
                        <span className="shrink-0 font-medium">{stageMeta?.name ?? t.agentName}</span>
                        <span className="min-w-0 truncate text-faint">{stageMeta?.role ?? t.role}</span>
                        {!isBusy && <span className="ml-auto shrink-0 font-mono text-faint">{t.startOffsetMs !== undefined ? `+${t.startOffsetMs}·` : ""}{t.latencyMs} ms</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {activeTask && (
              <div className="mt-1 space-y-1 border-t border-dashed border-hairline pt-1.5" data-testid="subagent-task-detail">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-semibold text-text">
                    {STAGE_DISPLAY_META[activeTask.stepIndex]?.name ?? activeTask.agentName} · {STAGE_DISPLAY_META[activeTask.stepIndex]?.role ?? activeTask.role}
                  </span>
                  <span className="font-mono text-faint">
                    {activeTask.modelId} · {activeTask.latencyMs} ms · {SOURCE_LABEL[activeTask.source ?? "not-attempted"] ?? activeTask.source}
                  </span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                  <span className="font-mono text-faint">Input</span>
                  <span className="text-muted">{cleanInlineSlugs(activeTask.inputSummary)}</span>
                  <span className="font-mono text-faint">Output</span>
                  <span className="text-text">{cleanInlineSlugs(activeTask.outputSummary)}</span>
                </div>
              </div>
            )}
            {correlation && (
              <div className="mt-2 space-y-1.5 border-t border-hairline pt-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="section-label">Upstream cloud status</span>
                  <span className="font-mono text-faint">correlated {correlation.correlatedAtLabel}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {correlation.services.map((p) => (
                    <Pill key={p.serviceId} variant="status" tone={SERVICE_TONE[p.status] ?? "muted"} mono={false} title={`${p.label}: ${p.summary}`}>
                      {cloudServiceLabel(p.serviceId, correlation.primaryRegion)}
                      {p.status === "unknown" ? " · not probed" : p.status === "operational" ? "" : ` · ${p.status}`}
                    </Pill>
                  ))}
                </div>
                <p className="leading-snug text-text">{correlation.overallCorrelationSummary}</p>
                {correlation.advisories.map((adv) => (
                  <div key={adv.id} className="border-t border-hairline-2 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold text-warning">
                        [{adv.id}] {adv.title} ({adv.region})
                      </span>
                      <a href={adv.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-signal hover:underline">
                        Status feed <ExternalLink className="size-2.5" />
                      </a>
                    </div>
                    <p className="mt-0.5 text-muted">{adv.summary}</p>
                  </div>
                ))}
                {correlation.webSearchCitations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5">
                    <span className="text-faint">Docs &amp; runbooks:</span>
                    {correlation.webSearchCitations.map((doc) => (
                      <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer" title={doc.snippet} className="inline-flex items-center gap-0.5 text-signal hover:underline">
                        {doc.title}
                        <ExternalLink className="size-2.5 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/* ───────────────────────────── scope chips (clarifier) ───────────────────────────── */

interface ScopeDraft {
  questions: ClarifyingQuestion[];
  draft: Record<string, string>;
  setAnswer: (questionId: string, value: string) => void;
  dirty: boolean;
  editing: boolean;
  setEditing: (v: boolean | ((v: boolean) => boolean)) => void;
}

function answersFor(questions: ClarifyingQuestion[], clarifiedAnswers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const raw = clarifiedAnswers[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
    out[q.id] = humanizeClarifierSlug(raw, q);
  }
  return out;
}

/** One draft of answers shared by every scope chip row (in steps and under the header). */
function useScopeDraft(scenarioId: string, questions: ClarifyingQuestion[], clarifiedAnswers: Record<string, string>): ScopeDraft {
  const saved = useMemo(() => answersFor(questions, clarifiedAnswers), [questions, clarifiedAnswers]);
  const [draft, setDraft] = useState<Record<string, string>>(saved);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(saved), [scenarioId, saved]);
  useEffect(() => setEditing(false), [scenarioId]);
  // Hotkey c (demo beat): toggle the free-text scope inputs, as it toggled the old clarifier card.
  useEffect(() => onDemo((beat, claim) => beat.kind === "toggle-clarifier" && claim() && setEditing((v) => !v)), []);
  const dirty = questions.some((q) => (draft[q.id] ?? "") !== (saved[q.id] ?? ""));
  return {
    questions,
    draft,
    setAnswer: (questionId, value) => setDraft((prev) => ({ ...prev, [questionId]: value })),
    dirty,
    editing,
    setEditing,
  };
}

/** Under the plan header: the scope status, the submit, and the questions no plan step claims. */
function ScopeBar({ scope, unmapped, mappedCount }: { scope: ScopeDraft; unmapped: ClarifyingQuestion[]; mappedCount: number }) {
  const refineGoal = useWorkbench((s) => s.refineGoal);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const lastRefinedAt = useWorkbench((s) => s.lastRefinedAt);
  const scopedSummary = Object.values(scope.draft).filter(Boolean).join(" · ");
  return (
    <div className="mt-1" data-testid="project-goal-clarifier-card">
      <div className="flex h-6 items-center gap-2 text-11">
        <span className="shrink-0 text-muted">
          <span className="text-signal">✦</span> Scope
        </span>
        <span className="min-w-0 flex-1 truncate text-faint" title={scopedSummary}>
          {refiningGoal
            ? "Updating diagnostic view & remediation scripts…"
            : scope.dirty
              ? "Changed: update the plan to regenerate"
              : mappedCount > 0
                ? `${mappedCount} of ${scope.questions.length} answers sit in the steps below`
                : scopedSummary}
        </span>
        {lastRefinedAt && !refiningGoal && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-healthy" data-testid="clarifier-refreshed-badge">
            <Check className="size-3" />
            {lastRefinedAt}
          </span>
        )}
        <button
          type="button"
          onClick={() => scope.setEditing((v) => !v)}
          aria-pressed={scope.editing}
          data-testid="clarifier-edit-scope"
          title="Type custom scope answers (c)"
          className="shrink-0 rounded-sm px-1 text-muted transition-colors hover:bg-raised hover:text-text"
        >
          {scope.editing ? "Done" : "Custom…"}
        </button>
        {(scope.dirty || scope.editing || refiningGoal) && (
          <Button
            size="xs"
            variant="primary"
            loading={refiningGoal}
            onClick={async () => {
              await refineGoal(scope.draft);
              scope.setEditing(false);
            }}
            data-testid="refine-goal-submit"
          >
            Update plan
          </Button>
        )}
      </div>
      {unmapped.map((q) => (
        <ScopeQuestion key={q.id} q={q} scope={scope} />
      ))}
    </div>
  );
}

/** One clarifying question: its label and a row of small chips; the free-text answer while editing. */
function ScopeQuestion({ q, scope }: { q: ClarifyingQuestion; scope: ScopeDraft }) {
  // While a refine streams the chips keep their look but take no input (the cursor says why).
  const locked = useWorkbench((s) => s.refiningGoal);
  const rawVal = scope.draft[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
  const currentVal = humanizeClarifierSlug(rawVal, q);
  const isPresetOption = q.options.some(
    (opt) =>
      currentVal.toLowerCase() === humanizeClarifierSlug(opt.label, q).toLowerCase() ||
      rawVal.toLowerCase() === opt.value.toLowerCase() ||
      rawVal.toLowerCase() === opt.id.toLowerCase(),
  );
  return (
    <div className="mt-1 clear-right border-t border-dashed border-hairline pt-1" data-testid={`clarifier-question-${q.id}`}>
      {/* One row: the question as a short label (full text in its tooltip), then chips that shrink and
          truncate, the selected one last (full option label and description in the chip tooltip). */}
      <div className="flex min-w-0 items-center gap-1">
        <span className="mr-0.5 shrink-0 cursor-help text-11 text-muted" title={cleanInlineSlugs(q.question)}>
          <span className="text-signal">✦</span> {capitalize(humanizeClarifierSlug(q.category))}
        </span>
        {q.options.map((opt) => {
          const cleanLabel = humanizeClarifierSlug(opt.label, q);
          const active = currentVal.toLowerCase() === cleanLabel.toLowerCase() || rawVal.toLowerCase() === opt.value.toLowerCase();
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`clarifier-opt-${q.id}-${opt.id}`}
              aria-pressed={active}
              disabled={locked}
              onClick={() => scope.setAnswer(q.id, cleanLabel)}
              title={opt.description ? `${cleanLabel} — ${opt.description}` : cleanLabel}
              className={`inline-flex h-5 min-w-6 items-center overflow-hidden rounded-sm border px-1.5 text-11 transition-colors disabled:cursor-progress ${
                active ? "shrink-[0.2] border-signal/40 bg-signal/12 text-signal-strong" : "shrink border-hairline text-muted hover:border-signal/40 hover:text-text"
              }`}
            >
              <span className="min-w-0 truncate">{cleanLabel}</span>
            </button>
          );
        })}
        {!isPresetOption && !scope.editing && currentVal && (
          <span className="inline-flex h-5 min-w-6 shrink-[0.2] items-center overflow-hidden rounded-sm border border-signal/40 bg-signal/12 px-1.5 text-11 text-signal-strong" title={currentVal}>
            <span className="min-w-0 truncate">{currentVal}</span>
          </span>
        )}
      </div>
      {scope.editing && (
        <div className="mt-0.5 flex">
          <input
            type="text"
            value={isPresetOption ? "" : currentVal}
            onChange={(e) => scope.setAnswer(q.id, e.target.value)}
            disabled={locked}
            placeholder={q.customHint ?? "Or type a custom parameter…"}
            data-testid={`clarifier-input-${q.id}`}
            className="h-5 min-w-0 flex-1 rounded-sm border border-hairline bg-transparent px-1.5 text-11 text-text placeholder:text-faint focus:outline-1 focus:outline-signal"
          />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── steps ───────────────────────────── */

/** Multi-tenant callout under the plan; opens the Other Clients tab of the approval drawer. */
function FleetPill() {
  const fleet = useWorkbench((s) => s.fleet);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const prewarmRemediation = useWorkbench((s) => s.prewarmRemediation);
  if (!fleet || fleet.affectedCount === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openRemediation({ tab: "fleet" })}
      onPointerEnter={() => {
        window.setTimeout(() => void prewarmRemediation(), 60);
      }}
      className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-hairline-2 pt-1 text-left text-11 transition-colors hover:text-text"
      title={`Review ${fleet.affectedCount} other client tenants with this same misconfiguration`}
      data-testid="fleet-pill"
    >
      <Pill variant="status" tone="warning" mono={false}>
        {fleet.affectedCount} other tenants share this misconfiguration
      </Pill>
      <span className="ml-auto shrink-0 text-signal">Fix all {fleet.affectedCount} →</span>
    </button>
  );
}

const STEP_CATEGORY_FALLBACKS = ["identity", "licensing", "azure", "intune"] as const;

function PlanStep({
  step,
  index,
  resolved,
  selections,
  questions,
  scope,
  pending = false,
}: {
  step: ResolutionStep;
  index: number;
  resolved: boolean;
  selections: SelectionItem[];
  questions: ClarifyingQuestion[] | undefined;
  scope: ScopeDraft;
  /** WP6: the plan is being regenerated; the detail line ghosts in place until the new step lands. */
  pending?: boolean;
}) {
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const steps = useWorkbench((s) => s.brief?.steps ?? NO_STEPS);
  const checked = useWorkbench((s) => Boolean(s.stepsDone[`${scenarioId}:${step.id}`])) || resolved;
  const toggle = useWorkbench((s) => s.toggleStep);
  const runStep = useWorkbench((s) => s.runStep);
  const prewarmRemediation = useWorkbench((s) => s.prewarmRemediation);
  const setLinked = useWorkbench((s) => s.setLinked);
  const focusCard = useWorkbench((s) => s.focusCard);
  const allSameCategory = steps.length > 1 && steps.every((s) => s.category === steps[0]?.category);
  const effectiveCategory = allSameCategory ? STEP_CATEGORY_FALLBACKS[(index - 1) % STEP_CATEGORY_FALLBACKS.length]! : step.category;
  const stageDisabled = resolved && step.action.kind === "stage-fix";
  return (
    <li
      style={catStyle(effectiveCategory)}
      className="group flow-root py-0.5 text-13"
      onMouseEnter={() => {
        setLinked({ target: step.target, category: effectiveCategory });
        if (step.action.kind === "stage-fix") {
          window.setTimeout(() => void prewarmRemediation(), 60);
        }
      }}
      onMouseLeave={() => setLinked(null)}
    >
      <button
        type="button"
        onClick={() => toggle(step.id)}
        aria-pressed={checked}
        aria-label={`Mark step ${index} done`}
        title={checked ? "Done · click to clear" : "Mark done"}
        className="mr-1.5 inline-block w-3 text-left font-mono text-11 text-faint transition-colors hover:text-text"
      >
        {checked ? <Check className="inline size-3 align-[-1px] text-healthy" /> : index}
      </button>
      <div className="contents">
        <Button
          size="xs"
          variant="ghost"
          className="float-right -mr-1.5 ml-1 h-[18px]! px-1.5! opacity-80 group-hover:opacity-100"
          disabled={stageDisabled}
          title={stageDisabled ? "Already resolved: reopen the ticket to run it again" : undefined}
          onClick={() => runStep(step)}
        >
          {step.action.label}
        </Button>
        {/* Selectable text, not a <button>: dragging over a step highlights it for Generate Context UI instead of clicking. */}
        <span
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
          className="cursor-pointer select-text focus-visible:outline-2 focus-visible:outline-signal"
          title="Open the card for this step"
          data-testid="plan-step-text"
        >
          <span className="mr-1 font-semibold text-[color:var(--cat)]">{cleanInlineSlugs(step.title)}</span>
          <Ghost pending={pending} className={checked ? "text-muted line-through decoration-healthy/60" : "text-text"}>
            <EnrichedText text={cleanInlineSlugs(step.detail)} entities={NO_ENTITIES} selections={selections} />
          </Ghost>
        </span>
        {questions?.map((q) => <ScopeQuestion key={q.id} q={q} scope={scope} />)}
      </div>
    </li>
  );
}

const NO_STEPS: ResolutionStep[] = [];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
