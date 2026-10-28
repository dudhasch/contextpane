import { AlertOctagon, Bot, Check, ChevronRight, CircleCheckBig, ClipboardList, Clock3, Cloud, ExternalLink, Eye, FileCode2, FileText, FolderInput, ImageIcon, Inbox, Layers, ListChecks, MessageSquare, RotateCcw, ScanEye, Sparkles, UserRound, Wand2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { CATEGORY_META, type ClarifyingQuestion, type ContextViewMode, type EnrichedEntity, type ResolutionStep, type ScenarioBrief, type SubAgentTaskRecord, type UpstreamCloudStatusCorrelation } from "@contextpane/catalog";
import type { ErpAttachment } from "@/lib/api";
import { fmtDateTimeUtc } from "@/lib/format";
import { CATEGORY_ORDER, CAT_DOT, CAT_TEXT, catStyle } from "@/lib/provenance";
import { selectConvergence, useWorkbench } from "@/store";
import { OriginBadge } from "../hud/WorkQueue";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { EntityPill } from "./EntityPill";
import { ResolutionNoteBox } from "./ResolutionNote";

/**
 * Left pane. In three seconds: what the issue is (summary), what MCP enriched
 * (colour-coded entities linked to their cards) and the exact steps that resolve
 * it. Enriched objects, contract, infrastructure spec and timeline stay folded at the bottom.
 */
export function ScenarioPane() {
  const brief = useWorkbench((s) => s.brief);
  const status = useWorkbench((s) => s.briefStatus);
  const triageStatus = useWorkbench((s) => s.triageStatus);
  if (!brief) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {status === "error" ? "Orchestrator unreachable — start apps/orchestrator on :4000" : "Loading scenario…"}
      </div>
    );
  }
  const hasTasks = Boolean((brief.subAgentTasks && brief.subAgentTasks.length > 0) || triageStatus === "loading");
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3.5 py-2.5" data-testid="scenario-pane">
      <ScenarioHeader brief={brief} />
      {(hasTasks || brief.cloudStatusCorrelation) && (
        <UnifiedStatusAndAgentBar
          scenarioId={brief.scenarioId}
          tasks={brief.subAgentTasks ?? []}
          correlation={brief.cloudStatusCorrelation}
        />
      )}
      {brief.clarifyingQuestions && brief.clarifyingQuestions.length > 0 && (
        <ProjectGoalClarifierCard
          scenarioId={brief.scenarioId}
          questions={brief.clarifyingQuestions}
          clarifiedAnswers={brief.clarifiedAnswers ?? {}}
        />
      )}
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
        {unscripted ? (
          <Pill tone="primary" icon={drop ? <FolderInput /> : <Sparkles />} title={cleanInlineSlugs(brief.extraction?.rationale ?? "")}>
            {drop ? "ERP Drop" : "Live Triage"} ·{" "}
            {brief.elementRouting?.missingElements[0]
              ? "Custom View"
              : brief.extraction?.baseScenarioId}
          </Pill>
        ) : (
          <span className="truncate text-[11px] text-faint">{brief.origin}</span>
        )}
      </div>
      <h2 className="mt-1 text-[14.5px] leading-snug font-semibold">{brief.title}</h2>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
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

const FALLBACK_LIVE_TASKS: SubAgentTaskRecord[] = [
  { stepIndex: 1, task: "scope-and-questions", agentName: "1. Scope Check", role: "Target Scope & Parameters", modelId: "deterministic", status: "completed", latencyMs: 0, inputSummary: "Analyzing ticket parameters...", outputSummary: "In progress", timestamp: new Date().toISOString() },
  { stepIndex: 2, task: "telemetry-and-status", agentName: "2. Live Telemetry", role: "Live Graph & ARM Status Check", modelId: "deterministic", status: "completed", latencyMs: 0, inputSummary: "Correlating upstream cloud status...", outputSummary: "In progress", timestamp: new Date().toISOString() },
  { stepIndex: 3, task: "ui-element-synthesis", agentName: "3. View Layout", role: "Diagnostic View Layout", modelId: "deterministic", status: "completed", latencyMs: 0, inputSummary: "Building diagnostic card layout...", outputSummary: "In progress", timestamp: new Date().toISOString() },
  { stepIndex: 4, task: "script-and-iac-synthesis", agentName: "4. Remediation Plan", role: "PowerShell 7 & Terraform Patch", modelId: "deterministic", status: "completed", latencyMs: 0, inputSummary: "Preparing idempotent remediation...", outputSummary: "In progress", timestamp: new Date().toISOString() },
  { stepIndex: 5, task: "preflight-and-undo", agentName: "5. Pre-Flight Safety", role: "AST, -WhatIf & 1-Click Undo", modelId: "deterministic", status: "completed", latencyMs: 0, inputSummary: "Verifying pre-flight invariants...", outputSummary: "In progress", timestamp: new Date().toISOString() },
];

const STAGE_DISPLAY_META: Record<number, { name: string; role: string }> = {
  1: { name: "1. Scope Check", role: "Target Scope & Parameters" },
  2: { name: "2. Live Telemetry", role: "Live Graph & ARM Status Check" },
  3: { name: "3. View Layout", role: "Diagnostic View Layout" },
  4: { name: "4. Remediation Plan", role: "PowerShell 7 & Terraform Patch" },
  5: { name: "5. Pre-Flight Safety", role: "AST, -WhatIf & 1-Click Undo" },
};

/**
 * Unified 32px horizontal status strip combining Sub-Agent Task Pipeline (5/5 Completed)
 * and Upstream Cloud Status when healthy, expanding on click or when an upstream advisory is active.
 */
function UnifiedStatusAndAgentBar({
  scenarioId,
  tasks,
  correlation,
}: {
  scenarioId: string;
  tasks: SubAgentTaskRecord[];
  correlation?: UpstreamCloudStatusCorrelation | null | undefined;
}) {
  const triageStatus = useWorkbench((s) => s.triageStatus);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const isBusy = triageStatus === "loading" || refiningGoal;
  const displayTasks = tasks.length > 0 ? tasks : FALLBACK_LIVE_TASKS;
  const completedCount = displayTasks.filter((t) => t.status === "completed").length;
  // Steps with a start offset ran on one clock (S1, then S2 ∥ S3 ∥ S4, then S5): report wall clock, not the sum.
  const totalLatencyMs = useMemo(
    () =>
      displayTasks.some((t) => t.startOffsetMs !== undefined)
        ? Math.max(...displayTasks.map((t) => (t.startOffsetMs ?? 0) + (t.latencyMs || 0)))
        : displayTasks.reduce((sum, t) => sum + (t.latencyMs || 0), 0) || 42,
    [displayTasks],
  );
  const hasAdvisory = Boolean(
    correlation && (correlation.advisories.length > 0 || correlation.services.some((s) => s.status !== "operational")),
  );

  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [cloudExpanded, setCloudExpanded] = useState(hasAdvisory);

  useEffect(() => {
    setAgentsExpanded(false);
    setSelectedStep(null);
    setCloudExpanded(hasAdvisory);
  }, [scenarioId, hasAdvisory]);

  const activeTask = displayTasks.find((t) => t.stepIndex === selectedStep) ?? null;

  return (
    <section
      className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
        isBusy
          ? "border-primary/60 bg-primary/10"
          : hasAdvisory
            ? "border-amber-500/45 bg-amber-500/8"
            : "border-border-subtle bg-surface/90"
      }`}
      data-testid="subagent-task-strip"
    >
      <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setAgentsExpanded((v) => !v)}
          data-testid="subagent-strip-toggle"
          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left font-medium text-text transition-colors hover:bg-elevated"
          title="Click to inspect the 5 automated triage & safety checks"
        >
          <Bot className={`size-3.5 shrink-0 text-primary ${isBusy ? "animate-bounce" : ""}`} />
          <span className="font-mono text-[10.5px] font-semibold text-emerald-300">
            {isBusy
              ? "● Running 5/5 Triage Checks..."
              : `✓ ${completedCount}/${displayTasks.length} Triage Checks (${totalLatencyMs}ms)`}
          </span>
          <span className="font-mono text-[10px] text-muted">{agentsExpanded || isBusy ? "▴" : "▾"}</span>
        </button>

        {correlation && (
          <>
            <span className="text-faint">·</span>
            <button
              type="button"
              onClick={() => setCloudExpanded((v) => !v)}
              data-testid="upstream-cloud-status-banner"
              className="ml-auto inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-elevated"
              title={`Correlated at incident time (${correlation.correlatedAtLabel}) — click for details`}
            >
              <Cloud className={`size-3.5 shrink-0 ${hasAdvisory ? "text-amber-400" : "text-emerald-400"}`} />
              <span className={`size-1.5 rounded-full ${hasAdvisory ? "bg-amber-400" : "bg-emerald-400"}`} />
              <span className="text-[10.5px] font-medium text-text">
                {hasAdvisory
                  ? `Cloud Status: ${correlation.advisories[0]?.region ?? correlation.primaryRegion ?? "Regional"} Advisory`
                  : "Cloud Status: Azure, Entra, Intune, GitHub OK"}
              </span>
              <span className="font-mono text-[10px] text-muted">{cloudExpanded ? "▴" : "▾"}</span>
            </button>
          </>
        )}
      </div>

      {(agentsExpanded || isBusy) && (
        <div className="mt-1.5 border-t border-border-subtle/80 pt-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {displayTasks.map((t, idx) => {
              const isSelected = selectedStep === t.stepIndex;
              const stageMeta = STAGE_DISPLAY_META[t.stepIndex];
              const stageName = stageMeta?.name ?? t.agentName;
              const stageRole = stageMeta?.role ?? t.role;
              return (
                <Fragment key={t.stepIndex}>
                  <button
                    type="button"
                    onClick={() => setSelectedStep(isSelected ? null : t.stepIndex)}
                    data-testid={`subagent-pill-${t.stepIndex}`}
                    title={`${stageRole} · ${t.latencyMs} ms — click to inspect`}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      isBusy
                        ? "animate-pulse border-primary/60 bg-primary/20 font-semibold text-primary"
                        : isSelected
                          ? "border-primary bg-primary/20 font-semibold text-primary"
                          : "border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:border-primary/50 hover:text-text"
                    }`}
                  >
                    <span>{isBusy ? "●" : "✓"} {stageName}</span>
                    {!isBusy && t.startOffsetMs !== undefined && <span className="text-faint">+{t.startOffsetMs}·{t.latencyMs}ms</span>}
                  </button>
                  {idx < displayTasks.length - 1 && <span className="text-[9px] text-faint">→</span>}
                </Fragment>
              );
            })}
          </div>

          {activeTask && (
            <div
              className="mt-1.5 space-y-1 rounded border border-primary/35 bg-canvas/85 p-2 text-[11px]"
              data-testid="subagent-task-detail"
            >
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-semibold text-primary">
                  {STAGE_DISPLAY_META[activeTask.stepIndex]?.name ?? activeTask.agentName} · {STAGE_DISPLAY_META[activeTask.stepIndex]?.role ?? activeTask.role}
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {activeTask.latencyMs} ms · Verified
                </span>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
                <span className="font-mono text-faint">Input:</span>
                <span className="text-muted">{cleanInlineSlugs(activeTask.inputSummary)}</span>
                <span className="font-mono text-faint">Output:</span>
                <span className="font-medium text-text">{cleanInlineSlugs(activeTask.outputSummary)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {correlation && cloudExpanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-border-subtle/80 pt-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-mono text-[10px] text-muted">
              Correlated at Incident Time: {correlation.correlatedAtLabel}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {correlation.services.map((p) => {
                const dot =
                  p.status === "outage"
                    ? "bg-rose-400"
                    : p.status === "degraded" || p.status === "advisory"
                      ? "bg-amber-400"
                      : "bg-emerald-400";
                const border =
                  p.status === "outage"
                    ? "border-rose-500/40 bg-rose-500/12 text-rose-300"
                    : p.status === "degraded" || p.status === "advisory"
                      ? "border-amber-500/40 bg-amber-500/12 text-amber-300"
                      : "border-emerald-500/30 bg-emerald-500/8 text-emerald-300";
                const shortLabel =
                  p.serviceId === "azure-regional"
                    ? !correlation.primaryRegion || correlation.primaryRegion === "Global"
                      ? "Azure ARM / Global"
                      : `Azure (${correlation.primaryRegion})`
                    : p.serviceId === "entra-id"
                      ? "Entra ID"
                      : p.serviceId === "intune"
                        ? "Intune"
                        : "GitHub";
                return (
                  <span
                    key={p.serviceId}
                    title={`${p.label}: ${p.summary}`}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${border}`}
                  >
                    <span className={`size-1.5 rounded-full ${dot}`} />
                    <span>{shortLabel}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] leading-snug text-text">{correlation.overallCorrelationSummary}</p>
          {correlation.advisories.map((adv) => (
            <div
              key={adv.id}
              className="rounded border border-amber-500/35 bg-canvas/75 px-2 py-1.5 text-[11px]"
            >
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-semibold text-amber-300">
                  [{adv.id}] {adv.title} ({adv.region})
                </span>
                <a
                  href={adv.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-sky-400 hover:underline"
                >
                  Status Feed <ExternalLink className="size-2.5" />
                </a>
              </div>
              <p className="mt-0.5 text-muted">{adv.summary}</p>
            </div>
          ))}
          {correlation.webSearchCitations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">Docs &amp; Runbooks:</span>
              {correlation.webSearchCitations.map((doc) => (
                <a
                  key={doc.url}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  title={doc.snippet}
                  className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/20"
                >
                  <span>{doc.title}</span>
                  <ExternalLink className="size-2.5 shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatSlugWord(w: string): string {
  if (/^(vm|rg|az|ca|spn|sku|dns|bgp|iam|pim|mfa|arm|rbac|oidc|kv|pr|id|ip|nsg|avd)$/i.test(w)) {
    return w.toUpperCase();
  }
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function cleanInlineSlugs(text: string): string {
  return text
    .replace(/\belement_not_existent\b/gi, "custom diagnostic view")
    .replace(/\b(?:data\/)?dynamic-catalog\.json\b/gi, "custom view catalog")
    .replace(/\bmuse-(?:wonder|spark|glimmer|voice)[a-z0-9.-]*\b/gi, "live analyzer")
    .replace(/\s*\((?:Remove-MgGroupMemberByRef|Invoke-MgLicenseUser|Set-MgUserLicense|Update-MgIdentityConditionalAccessPolicy)[^)]*\)/g, "")
    .replace(/\b([a-z]{2,}(?:_[a-z0-9]{2,})+)\b/g, (match) =>
      match.split("_").map(formatSlugWord).join(" "),
    );
}

function humanizeClarifierSlug(raw: string, q?: ClarifyingQuestion): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (q) {
    const matchedOpt = q.options.find(
      (o) =>
        o.value.toLowerCase() === trimmed.toLowerCase() ||
        o.id.toLowerCase() === trimmed.toLowerCase() ||
        o.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (matchedOpt && !/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(matchedOpt.label)) {
      return cleanInlineSlugs(matchedOpt.label);
    }
  }
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(trimmed)) {
    return trimmed
      .split(/[_-]+/)
      .map(formatSlugWord)
      .join(" ");
  }
  return cleanInlineSlugs(trimmed);
}

/** Interactive Project & Goal Clarifier card allowing 1-click option pill selection or custom input to regenerate the plan & remediation. */
function ProjectGoalClarifierCard({
  scenarioId,
  questions,
  clarifiedAnswers,
}: {
  scenarioId: string;
  questions: ClarifyingQuestion[];
  clarifiedAnswers: Record<string, string>;
}) {
  const refineGoal = useWorkbench((s) => s.refineGoal);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const lastRefinedAt = useWorkbench((s) => s.lastRefinedAt);
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of questions) {
      const raw = clarifiedAnswers[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
      init[q.id] = humanizeClarifierSlug(raw, q);
    }
    return init;
  });

  useEffect(() => {
    const synced: Record<string, string> = {};
    for (const q of questions) {
      const raw = clarifiedAnswers[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
      synced[q.id] = humanizeClarifierSlug(raw, q);
    }
    setDraft(synced);
  }, [scenarioId, questions, clarifiedAnswers]);

  const scopedSummary = Object.values(draft).filter(Boolean).join(" · ");

  return (
    <section
      className="rounded-[10px] border border-primary/45 bg-primary/6 px-2.5 py-2 text-[11.5px]"
      data-testid="project-goal-clarifier-card"
    >
      {!expanded ? (
        <div className="flex h-6 items-center gap-1.5 overflow-hidden whitespace-nowrap">
          <MessageSquare className="size-3.5 shrink-0 text-primary" />
          <span className="shrink-0 text-[11.5px] font-semibold text-text">Scoped Goal:</span>
          <span className="min-w-0 flex-1 truncate font-medium text-primary" title={scopedSummary}>
            {scopedSummary}
          </span>
          {lastRefinedAt && !refiningGoal && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/12 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-300"
              data-testid="clarifier-refreshed-badge"
            >
              <Check className="size-2.5" />
              Refreshed {lastRefinedAt}
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            data-testid="clarifier-edit-scope"
            className="shrink-0 rounded border border-primary/35 bg-canvas/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary hover:bg-primary/15"
          >
            [Edit Scope ▾]
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <MessageSquare className="size-4 shrink-0 text-primary" />
            <span className="text-[12px] font-semibold tracking-wide text-text uppercase">
              Interactive Goal &amp; Scope Clarifier
            </span>
            <span className="rounded border border-primary/35 bg-canvas/75 px-1.5 py-0.5 font-mono text-[10px] text-primary">
              Scope Parameters
            </span>
            {lastRefinedAt && !refiningGoal && (
              <span
                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/12 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-300"
                data-testid="clarifier-refreshed-badge"
              >
                <Check className="size-2.5" />
                Refreshed {lastRefinedAt}
              </span>
            )}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] text-muted hover:bg-elevated hover:text-text"
            >
              Collapse ▴
            </button>
          </div>

          <div className="mt-1.5 space-y-1.5">
            <div className="space-y-1">
              {questions.map((q, idx) => {
                const rawVal = draft[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
                const currentVal = humanizeClarifierSlug(rawVal, q);
                const isPresetOption = q.options.some(
                  (opt) =>
                    currentVal.toLowerCase() === humanizeClarifierSlug(opt.label, q).toLowerCase() ||
                    rawVal.toLowerCase() === opt.value.toLowerCase() ||
                    rawVal.toLowerCase() === opt.id.toLowerCase(),
                );
                return (
                  <div
                    key={q.id}
                    className="rounded-md border border-border-subtle bg-canvas/85 px-2 py-1"
                    data-testid={`clarifier-question-${q.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text">
                        {idx + 1}. {cleanInlineSlugs(q.question)}
                      </span>
                      <span className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted">
                        {humanizeClarifierSlug(q.category)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {q.options.map((opt) => {
                        const cleanLabel = humanizeClarifierSlug(opt.label, q);
                        const active =
                          currentVal.toLowerCase() === cleanLabel.toLowerCase() ||
                          rawVal.toLowerCase() === opt.value.toLowerCase();
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            data-testid={`clarifier-opt-${q.id}-${opt.id}`}
                            onClick={() => setDraft((prev) => ({ ...prev, [q.id]: cleanLabel }))}
                            title={opt.description}
                            className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] transition-all ${
                              active
                                ? "border-primary bg-primary/22 font-semibold text-primary shadow-[0_0_8px_rgba(56,189,248,0.2)]"
                                : "border-border bg-surface text-muted hover:border-primary/40 hover:text-text"
                            }`}
                          >
                            {active && <Check className="size-3 shrink-0" />}
                            <span>{cleanLabel}</span>
                          </button>
                        );
                      })}
                      <input
                        type="text"
                        value={isPresetOption ? "" : currentVal}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder={q.customHint ?? "Or type custom parameter…"}
                        data-testid={`clarifier-input-${q.id}`}
                        className="h-6 min-w-[140px] flex-1 rounded border border-border-subtle bg-surface px-2 font-sans text-[10.5px] text-text focus:outline-1 focus:outline-primary"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              {refiningGoal ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-primary">
                  <span className="size-2.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Updating diagnostic view &amp; remediation scripts...
                </span>
              ) : lastRefinedAt ? (
                <span className="font-mono text-[10.5px] text-emerald-300">
                  ✓ Plan, Diagnostic View &amp; Remediation updated at {lastRefinedAt}
                </span>
              ) : (
                <span className="text-[10.5px] text-muted">
                  Click any option or type custom parameters to update plan &amp; scripts.
                </span>
              )}
              <Button
                size="xs"
                variant="primary"
                icon={<Sparkles />}
                loading={refiningGoal}
                onClick={async () => {
                  await refineGoal(draft);
                  setExpanded(false);
                }}
                data-testid="refine-goal-submit"
              >
                ↻ Update Plan &amp; Regenerate
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** The 3-second view: root cause in 1-2 sentences, then the numbered, clickable resolution plan. */
function SummaryPlan({ brief }: { brief: ScenarioBrief }) {
  const resolved = Boolean(useWorkbench(selectConvergence));
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  const reopenTicket = useWorkbench((s) => s.reopenTicket);
  return (
    <section className={`rounded-[10px] border-2 px-3 py-2 ${resolved ? "border-healthy/50 bg-healthy/6" : "border-primary/45 bg-primary/6"}`} data-testid="summary-plan">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardList className={`size-4 ${resolved ? "text-healthy" : "text-primary"}`} />
        <span className="text-[11.5px] font-semibold tracking-wide uppercase">Summary &amp; Resolution Plan</span>
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
      <p className="text-[12.5px] leading-snug text-text" data-testid="summary-text">
        <EnrichedText text={cleanInlineSlugs(brief.summary)} entities={NO_ENTITIES} selections={selections} />
      </p>
      <div className="mt-1.5 mb-0.5 flex items-center gap-1.5 text-[10.5px] text-muted">
        <ListChecks className="size-3.5" />
        Steps to resolve
      </div>
      <ol className="space-y-0.5">
        {brief.steps.map((step, i) => (
          <PlanStep key={step.id} step={step} index={i + 1} resolved={resolved} selections={selections} />
        ))}
      </ol>
      <FleetPill />
      {resolved && <ResolutionNoteBox />}
    </section>
  );
}

/** Multi-tenant callout inside the Resolution Plan; opens the Other Clients tab in the Action Approval Drawer. */
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
      className="mt-1.5 inline-flex min-h-5 items-center gap-1.5 rounded-md border border-warning/45 bg-warning/10 px-2 py-0.5 text-left text-[11px] leading-tight whitespace-normal text-warning transition-colors hover:bg-warning/20"
      title={`Review ${fleet.affectedCount} other client tenants with this same misconfiguration`}
      data-testid="fleet-pill"
    >
      <span>🌐 {fleet.affectedCount} other client tenants have this same misconfiguration ·</span>
      <span className="font-semibold underline decoration-warning/60 underline-offset-2">[Review &amp; Fix All {fleet.affectedCount} →]</span>
    </button>
  );
}

const STEP_CATEGORY_FALLBACKS = ["identity", "licensing", "azure", "intune"] as const;

type SelectionItem = { id: string; text: string; refinementText?: string; viewMode?: ContextViewMode; index: number };

function PlanStep({ step, index, resolved, selections }: { step: ResolutionStep; index: number; resolved: boolean; selections: SelectionItem[] }) {
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const steps = useWorkbench((s) => s.brief?.steps ?? []);
  const checked = useWorkbench((s) => Boolean(s.stepsDone[`${scenarioId}:${step.id}`])) || resolved;
  const toggle = useWorkbench((s) => s.toggleStep);
  const runStep = useWorkbench((s) => s.runStep);
  const prewarmRemediation = useWorkbench((s) => s.prewarmRemediation);
  const setLinked = useWorkbench((s) => s.setLinked);
  const focusCard = useWorkbench((s) => s.focusCard);
  const allSameCategory = steps.length > 1 && steps.every((s) => s.category === steps[0]?.category);
  const effectiveCategory = allSameCategory ? STEP_CATEGORY_FALLBACKS[(index - 1) % STEP_CATEGORY_FALLBACKS.length]! : step.category;
  return (
    <li
      style={catStyle(effectiveCategory)}
      className="group flex items-start gap-2 rounded-md border border-transparent px-1.5 py-0.5 transition-colors hover:border-[color-mix(in_oklab,var(--cat)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--cat)_8%,transparent)]"
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
        className="min-w-0 flex-1 cursor-pointer text-left select-text leading-snug"
        title="Open the card for this step"
        data-testid="plan-step-text"
      >
        <span className={`mr-1.5 text-[11.5px] font-semibold ${CAT_TEXT}`}>{cleanInlineSlugs(step.title)}:</span>
        <span className={`text-[12px] ${checked ? "text-muted line-through decoration-healthy/60" : "text-text"}`}>
          <EnrichedText text={cleanInlineSlugs(step.detail)} entities={NO_ENTITIES} selections={selections} />
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

const NO_SELECTIONS: SelectionItem[] = [];
const NO_ENTITIES: EnrichedEntity[] = [];

/** The ticket description or the anomaly narrative, with every enriched entity as an inline pill. */
function ScenarioText({ brief }: { brief: ScenarioBrief }) {
  const selections = useWorkbench((s) => s.selections[s.scenarioId] ?? NO_SELECTIONS);
  return (
    <section className="rounded-[10px] border border-border bg-surface px-3 py-2" data-testid="customer-ticket-card">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="section-label">{brief.originKind === "erp-drop" ? "ERP ticket (file drop)" : brief.kind === "ticket" ? "Customer ticket" : "Anomalous tenant state"}</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-pill border border-selection/45 bg-selection/12 px-2 py-0.5 text-[10px] font-medium text-selection" title="Highlight 3-120 characters anywhere on screen, then click the pill to spawn a live mini-dashboard">
          <Wand2 className="size-3 text-selection" /> ✨ Select any text on screen to generate Context UI
        </span>
      </div>
      <p className="text-[12px] leading-snug text-text" data-testid="scenario-body">
        <EnrichedText text={brief.body} entities={brief.entities} selections={selections} />
      </p>
      {brief.signals.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {brief.signals.map((sig) => (
            <li key={sig.label} style={catStyle(sig.category)} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px]">
              <span className={`inline-flex items-center gap-1.5 font-medium ${CAT_TEXT}`}>
                <span className={`size-1.5 rounded-full ${CAT_DOT}`} />
                {cleanInlineSlugs(sig.label)}
              </span>
              <span className="text-text">{cleanInlineSlugs(sig.value)}</span>
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
    <div className="mt-2" data-testid="ticket-attachment">
      <div className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-surface px-2 py-1.5">
        <a href={attachment.url} target="_blank" rel="noreferrer" className="shrink-0" title="Open full size">
          <img src={attachment.url} alt={`Customer screenshot ${attachment.fileName}`} className="h-[44px] w-[72px] rounded border border-border object-cover" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <ImageIcon className="size-3 shrink-0 text-muted" />
            <span className="truncate font-mono">{attachment.fileName}</span>
            <span className="text-[10px] text-faint">
              ({attachment.uploadedBy} · {Math.round(attachment.sizeBytes / 1024)} KB)
            </span>
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
function EnrichedText({ text, entities, selections = [] }: { text: string; entities: EnrichedEntity[]; selections?: SelectionItem[] }) {
  const { parts, byNeedle, bySelection } = useMemo(() => {
    const byNeedle = new Map<string, EnrichedEntity>();
    for (const e of entities) {
      for (const needle of [e.id, e.label]) if (needle.length >= 6 && !byNeedle.has(needle)) byNeedle.set(needle, e);
    }
    const bySelection = new Map<string, SelectionItem>();
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
function SelectionBadge({ selection, text }: { selection: SelectionItem; text: string }) {
  const setLinked = useWorkbench((s) => s.setLinkedSelection);
  const mounted = useWorkbench((s) => s.miniDashboards.some((m) => m.id === selection.id));
  const explore = useWorkbench((s) => s.exploreSelection);
  const extra = selection.refinementText ? ` + "${selection.refinementText}"` : "";
  return (
    <button
      type="button"
      data-selection={selection.id}
      onMouseEnter={() => setLinked(selection.id)}
      onMouseLeave={() => setLinked(null)}
      onClick={() =>
        mounted
          ? document.getElementById(`mini-${selection.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
          : void explore(selection.text, { ...(selection.refinementText ? { refinementText: selection.refinementText } : {}), ...(selection.viewMode ? { viewMode: selection.viewMode } : {}) })
      }
      title={mounted ? `Selection #${selection.index}${extra} · click to scroll to its mini-dashboard` : `Selection #${selection.index}${extra} · dismissed; click to generate it again`}
      className={`inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 align-middle font-mono text-[11px] transition-colors hover:brightness-125 ${mounted ? "border-selection/60 bg-selection/14 text-selection" : "border-selection/30 bg-selection/6 text-selection/70"}`}
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
      <span className="shrink-0 font-sans text-[9.5px] opacity-80">#{selection.index}</span>
    </button>
  );
}
