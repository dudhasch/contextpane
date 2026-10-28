import { Bot, Check, Clock3, Pin, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LayoutComponent } from "@contextpane/catalog";
import { selectActiveTimelineSlice, selectCanvasLayout, selectConvergence, useWorkbench, visibleComponents } from "@/store";
import { EntraSignInTimelineCard } from "./EntraSignInTimeline";
import { IaCDriftBannerCard } from "./IaCDriftBanner";
import { IntuneDriftCardView } from "./IntuneDriftCard";
import { ContextualMiniDashboardCard } from "./ContextualMiniDashboard";
import { LicenseDriftCardView } from "./LicenseDriftCard";
import { ProgressRail } from "./ProgressRail";
import { MODULE_FRAME } from "./Section";
import { RowFilterPill } from "./TableFilter";
import { SynthesizedDynamicCard } from "../cards/SynthesizedDynamicCard";
import { CommandLine, LensList } from "../freeroam";
import { WorkingMark } from "../ui/Pill";

/**
 * Right pane. Mounts only catalog components the orchestrator returned and Zod
 * validated — there is no generic text/markdown renderer by design. Cards start
 * compact; the left pane expands and focuses them.
 */
export function GenUICanvas() {
  const freeRoamOpen = useWorkbench((s) => s.freeRoamOpen);
  const layout = useWorkbench(selectCanvasLayout);
  const status = useWorkbench((s) => s.canvasStatus);
  const error = useWorkbench((s) => s.canvasError);
  const progress = useWorkbench((s) => s.progress);
  const filter = useWorkbench((s) => s.filter);
  const miniDashboards = useWorkbench((s) => s.miniDashboards);
  const exploreStatus = useWorkbench((s) => s.exploreStatus);
  const activeExploreText = useWorkbench((s) => s.activeExploreText);
  const triageStatus = useWorkbench((s) => s.triageStatus);
  const pendingTriageTitle = useWorkbench((s) => s.pendingTriageTitle);
  const refiningGoal = useWorkbench((s) => s.refiningGoal);
  const briefTitle = useWorkbench((s) => s.brief?.title);
  const components = visibleComponents(layout, filter);

  if (freeRoamOpen) {
    // Free-Roam command deck (board D3): the command line on top, lenses as the same bordered modules as an incident.
    return (
      <div className="flex h-full flex-col bg-ground" data-testid="free-roam-canvas">
        <CommandLine />
        <div className={`${LENS_LIST} [&>div:has(>section[data-mini-dashboard])]:contents`} data-lens-list="">
          {triageStatus === "loading" && <SubAgentSynthesisSkeleton mode="triage" title={pendingTriageTitle ?? "Custom Incident / Project Goal"} />}
          {exploreStatus === "loading" && <SelectionSynthesisSkeleton selectionText={activeExploreText ?? "Free-Roam Query"} />}
          <LensList />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ground">
      <LensHeader cards={components.length} customCards={miniDashboards.length} />
      <HistoricalSnapshotBanner />
      {/* Bounded modules (hairline frame on bg-surface) on the ground, 10px apart. */}
      <div className={LENS_LIST} data-lens-list="">
        {triageStatus === "loading" && (
          <SubAgentSynthesisSkeleton
            mode={triageStatus === "loading" ? "triage" : "refine"}
            title={triageStatus === "loading" ? (pendingTriageTitle ?? "Custom Incident / Project Goal") : (briefTitle ?? "Refining Scope & Plan")}
          />
        )}
        {exploreStatus === "loading" && <SelectionSynthesisSkeleton selectionText={activeExploreText ?? "selection"} />}
        {miniDashboards.map((m) => (
          <ContextualMiniDashboardCard key={m.id} entry={m} />
        ))}
        {!layout && status !== "error" && (
          <div className={`${MODULE_FRAME} px-4 py-3`}>
            <ProgressRail events={progress} title={status === "ready" ? "No layout for this scenario" : "Correlating scenario"} busy={status !== "ready"} />
          </div>
        )}
        {status === "error" && <div className={`${MODULE_FRAME} px-4 py-3 text-13 text-critical`}>Canvas error: {error}</div>}
        {layout && components.map((c) => <Component key={c.id} component={c} />)}
        {layout && components.length === 0 && status === "ready" && <div className={`${MODULE_FRAME} px-4 py-3 text-13 text-muted`}>No components match the current filter.</div>}
      </div>
    </div>
  );
}

/** The lens list: bounded modules on the ground with a 10px gap and a 12px inset. */
const LENS_LIST = "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3";

const SUB_AGENT_SYNTHESIS_STAGES = [
  { step: 1, name: "Scope check", role: "Target scope and clarifying options", source: "Ticket and tenant" },
  { step: 2, name: "Live telemetry", role: "Live Graph, ARM and cloud status correlation", source: "Graph and ARM" },
  { step: 3, name: "View layout", role: "Diagnostic card and block layout", source: "Live context" },
  { step: 4, name: "Remediation plan", role: "PowerShell 7, Graph JSON and Terraform diff", source: "Idempotent fix" },
  { step: 5, name: "Pre-flight safety", role: "AST, -WhatIf guard and 1-click undo verification", source: "Safety prover" },
] as const;

function SubAgentSynthesisSkeleton({ mode, title }: { mode: "triage" | "refine"; title: string }) {
  const [elapsedMs, setElapsedMs] = useState(100);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - started));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const activeStageIndex = Math.min(4, Math.floor(elapsedMs / 1200));

  return (
    <section
      className={`shrink-0 animate-fade-in ${MODULE_FRAME} px-4 py-3`}
      data-testid="subagent-synthesis-skeleton"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <WorkingMark className="w-3.5 text-center" />
          <Bot className="size-4 text-signal" />
          <span className="text-12 font-semibold text-text">
            {mode === "triage"
              ? "5-stage triage pipeline · analyzing the ticket and live tenant state"
              : "Updating the plan, diagnostic view and remediation scripts"}
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-pill border border-signal/45 bg-signal/15 px-2 py-0.5 font-mono text-11 font-semibold text-signal"
          data-testid="synthesis-elapsed-timer"
        >
          <Sparkles className="size-3 animate-pulse" />
          Live Triage · {elapsedSec}s elapsed
        </span>
      </div>

      <div className="mt-1 truncate text-11 text-muted">
        Target: <span className="font-medium text-text">{title}</span>
      </div>

      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-5">
        {SUB_AGENT_SYNTHESIS_STAGES.map((st, idx) => {
          const done = idx < activeStageIndex;
          const active = idx === activeStageIndex;
          return (
            <div
              key={st.step}
              className={`rounded-md border p-2 text-11 transition-all ${
                done
                  ? "border-healthy/40 bg-healthy/10 text-healthy-strong"
                  : active
                    ? "animate-pulse border-signal bg-signal/15 text-text shadow-[0_0_12px_color-mix(in_oklab,var(--signal)_20%,transparent)]"
                    : "border-hairline-2 bg-ground/60 text-faint"
              }`}
            >
              <div className="flex items-center justify-between gap-1 font-mono text-11">
                <span className="font-semibold">
                  {done ? "✓" : active ? "●" : st.step} {st.name}
                </span>
              </div>
              <div className="mt-0.5 truncate text-11 opacity-85">{st.role}</div>
              <div className="mt-1 font-mono text-11 text-signal/90">{st.source}</div>
            </div>
          );
        })}
      </div>

      {/* Shimmer skeleton preview of upcoming SynthesizedDynamicCard */}
      <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-md border border-hairline-2 bg-ground/60 p-2.5">
        <div className="space-y-1.5 rounded border border-hairline-2/70 bg-surface/70 p-2">
          <div className="h-2.5 w-2/3 animate-pulse rounded bg-raised" />
          <div className="h-2 w-full animate-pulse rounded bg-signal/25" />
          <div className="h-2 w-4/5 animate-pulse rounded bg-raised" />
        </div>
        <div className="space-y-1.5 rounded border border-hairline-2/70 bg-surface/70 p-2">
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-raised" />
          <div className="h-2 w-full animate-pulse rounded bg-dom-azure/25" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-raised" />
        </div>
        <div className="space-y-1.5 rounded border border-hairline-2/70 bg-surface/70 p-2">
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-raised" />
          <div className="h-2 w-full animate-pulse rounded bg-healthy/25" />
          <div className="h-2 w-3/5 animate-pulse rounded bg-raised" />
        </div>
      </div>
    </section>
  );
}

function SelectionSynthesisSkeleton({ selectionText }: { selectionText: string }) {
  const [elapsedMs, setElapsedMs] = useState(100);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - started));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  return (
    <div
      className={`shrink-0 space-y-2 ${MODULE_FRAME} px-4 py-3 text-12 text-signal`}
      data-testid="mini-dashboard-loading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <WorkingMark className="w-3.5 text-center" />
          <span>
            Analyzing live tenant context for &quot;{selectionText}&quot;...
          </span>
        </div>
        <span className="rounded-pill border border-signal/40 bg-signal/12 px-2 py-0.5 font-mono text-11">
          {elapsedSec}s elapsed · Live Query
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((k) => (
          <div key={k} className="rounded border border-hairline-2 bg-ground/70 p-2">
            <div className="h-2 w-1/2 animate-pulse rounded bg-raised" />
            <div className="mt-1.5 h-3.5 w-2/3 animate-pulse rounded bg-signal/25" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 24px strip under the lens header while a past timeline slice is selected. */
function HistoricalSnapshotBanner() {
  const timeline = useWorkbench((s) => s.timeline);
  const activeSlice = useWorkbench(selectActiveTimelineSlice);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const cardCount = useWorkbench((s) => s.layout?.components.length ?? 1);
  const select = useWorkbench((s) => s.selectTimelineSlice);
  if (!timeline || !activeSlice || activeSlice.relativeLabel === "NOW" || activeSlice.kind === "now") {
    return null;
  }
  const nowSlice = timeline.slices.find((s) => s.relativeLabel === "NOW" || s.kind === "now") ?? timeline.slices.at(-2) ?? timeline.slices.at(-1);
  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-b border-hairline px-4 text-11 text-warning" data-testid="historical-snapshot-banner">
      <Clock3 className="size-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium">Historical snapshot · {formatTimelineStepLabel(activeSlice)}</span>
      <span className="min-w-0 truncate text-muted">
        {formatTimelineStepDescription(activeSlice, scenarioId, cardCount)} (pre-incident tenant posture)
      </span>
      {nowSlice && (
        <button
          type="button"
          onClick={() => select(nowSlice.id)}
          data-testid="return-to-now-button"
          className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-signal hover:underline"
        >
          <Check className="size-3" />
          Return to now
        </button>
      )}
    </div>
  );
}

function formatTimelineStepLabel(s: { kind?: string; relativeLabel: string; timestamp: string; label: string }): string {
  const hhmm = s.timestamp.slice(11, 16);
  if (s.kind === "baseline" || s.relativeLabel === "T-18m") return `Before Issue (${hhmm})`;
  if (s.kind === "drift" || s.relativeLabel === "T-14m") return `Config Changed (${hhmm})`;
  if (s.kind === "first-failure" || s.relativeLabel === "T-06m") return `First Error (${hhmm})`;
  if (s.kind === "now" || s.relativeLabel === "NOW") return "Now (Active)";
  if (s.kind === "counterfactual" || s.relativeLabel === "T+Fix") return "After Fix (Preview)";
  return s.label;
}

function formatTimelineStepDescription(
  s: { kind?: string; relativeLabel: string; state: { summary: string } },
  scenarioId: string,
  cardCount = 3,
): string {
  const isAvd = scenarioId === "INC-4092";
  if (s.kind === "baseline" || s.relativeLabel === "T-18m") return "Healthy baseline · 0 issues";
  if (s.kind === "drift" || s.relativeLabel === "T-14m") return isAvd ? "Drift introduced · 3 users & port 3389" : "Drift introduced · Config changed";
  if (s.kind === "first-failure" || s.relativeLabel === "T-06m") return isAvd ? "First AVD sign-in error (53003)" : "First user or device error";
  if (s.kind === "now" || s.relativeLabel === "NOW") {
    return `Active incident · ${cardCount} ${cardCount === 1 ? "card" : "cards"} mounted`;
  }
  if (s.kind === "counterfactual" || s.relativeLabel === "T+Fix") return "Preview after fix · All healthy";
  return s.state.summary;
}

/**
 * Compact mono chip label for the lens header: the slice's relative offset (`T-18m`, `Now`, `T+Fix`),
 * which keeps the five chips under ~200px at a 550px lens; the descriptive label and time are in the tooltip.
 */
function shortTimelineLabel(s: { kind?: string; relativeLabel: string; label: string }): string {
  if (s.kind === "now" || s.relativeLabel === "NOW") return "Now";
  return s.relativeLabel || s.label;
}

/** Incident timeline compacted into the lens header: mono text-11 chips, the active one in signal with a 2px underline. */
function TimeTravelScrubber() {
  const timeline = useWorkbench((s) => s.timeline);
  const sliceId = useWorkbench((s) => s.timelineSliceId);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const cardCount = useWorkbench((s) => s.layout?.components.length ?? 1);
  const select = useWorkbench((s) => s.selectTimelineSlice);
  const load = useWorkbench((s) => s.loadDrawerExtras);
  const convergence = useWorkbench(selectConvergence);
  const rollbackNow = useWorkbench((s) => s.rollbackNow);
  if (!timeline) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-11 text-faint hover:text-text"
        data-testid="timeline-scrubber"
      >
        <Clock3 className="size-3" aria-hidden="true" />
        <span>Timeline…</span>
      </button>
    );
  }
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2" data-testid="timeline-scrubber" role="group" aria-label="Incident timeline">
      <div className="flex items-center gap-2.5">
        {timeline.slices.map((s) => {
          const isSelected = s.id === sliceId;
          const isNow = s.kind === "now" || s.relativeLabel === "NOW";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-pressed={isSelected}
              title={`${formatTimelineStepLabel(s)} · ${formatTimelineStepDescription(s, scenarioId, cardCount)}\n${s.state.summary}`}
              className={`relative inline-flex h-[34px] shrink-0 items-center font-mono text-11 whitespace-nowrap transition-colors ${
                isSelected || isNow ? "text-signal" : "text-muted hover:text-text"
              }`}
            >
              {shortTimelineLabel(s)}
              {isSelected && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
            </button>
          );
        })}
      </div>
      {convergence && (
        <button
          type="button"
          onClick={() => void rollbackNow()}
          className="inline-flex shrink-0 items-center gap-1 font-mono text-11 whitespace-nowrap text-healthy hover:underline"
          title="Undo change (restore previous state)"
          data-testid="rollback-button"
        >
          <Undo2 className="size-3 shrink-0" /> Undo
        </button>
      )}
    </div>
  );
}

/**
 * One 34px row over the lens: `Fabrikam Legal · fabrikamlegal.onmicrosoft.com · #INC-4099 · 2 cards`
 * on the left (plus recipe, identity and voice filters; the live-source count is the tenant tooltip), the incident timeline on the right.
 */
function LensHeader({ cards, customCards = 0 }: { cards: number; customCards?: number }) {
  const brief = useWorkbench((s) => s.brief);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  const status = useWorkbench((s) => s.canvasStatus);
  const filter = useWorkbench((s) => s.filter);
  const setFilter = useWorkbench((s) => s.setFilter);
  const activeRecipeId = useWorkbench((s) => s.activeRecipeId);
  const recipes = useWorkbench((s) => s.recipes);
  const resolved = Boolean(useWorkbench(selectConvergence));
  const recipe = recipes.find((r) => r.recipeId === activeRecipeId);
  const live = brief ? Object.values(brief.sources).filter((v) => v.startsWith("live")).length : 0;
  const total = brief ? Object.keys(brief.sources).length : 0;
  const totalCards = cards + customCards;
  const sep = <span aria-hidden className="shrink-0 text-faint">·</span>;
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-3 border-b border-hairline px-4 text-12">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap" data-testid="tenant-breadcrumb">
        <span
          className="shrink-0 font-medium text-text"
          title={brief ? [`${live}/${total} sources live`, ...Object.entries(brief.sources).map(([k, v]) => `${k}: ${v}`)].join("\n") : undefined}
        >
          {brief?.tenantName ?? "…"}
        </span>
        {brief?.verifiedDomain && (
          <>
            {sep}
            <span className="min-w-0 truncate font-mono text-muted" title={brief.verifiedDomain}>
              {brief.verifiedDomain}
            </span>
          </>
        )}
        {sep}
        <span className={`shrink-0 font-mono ${resolved ? "text-healthy" : "text-muted"}`}>{brief?.displayId ?? `#${scenarioId}`}</span>
        {sep}
        <span className="shrink-0 font-mono text-muted">
          {totalCards} {totalCards === 1 ? "card" : "cards"}
          {customCards > 0 ? <span className="text-signal"> ({cards} + {customCards} custom)</span> : ""}
          {status === "loading" ? <span className="text-faint"> · correlating…</span> : ""}
        </span>
        {recipe && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-11 text-signal" title={recipe.description}>
            <Pin className="size-3" />
            {recipe.name} · Pinned
          </span>
        )}
        <RowFilterPill />
        {filter && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-11 text-dom-intune">
            voice: {filter.join(", ")}
            <button type="button" onClick={() => setFilter(null)} aria-label="Clear voice filter" className="grid size-4 place-items-center rounded text-muted hover:bg-raised hover:text-text">
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      <TimeTravelScrubber />
    </div>
  );
}

function Component({ component }: { component: LayoutComponent }) {
  switch (component.type) {
    case "LicenseDriftCard":
      return <LicenseDriftCardView props={component.props} triggeredBy={component.triggeredBy} />;
    case "EntraSignInTimeline":
      return <EntraSignInTimelineCard props={component.props} triggeredBy={component.triggeredBy} />;
    case "IntuneDriftCard":
      return <IntuneDriftCardView props={component.props} triggeredBy={component.triggeredBy} />;
    case "IaCDriftBanner":
      return <IaCDriftBannerCard props={component.props} triggeredBy={component.triggeredBy} />;
    case "SynthesizedDynamicCard":
      return <SynthesizedDynamicCard props={component.props} triggeredBy={component.triggeredBy} />;
    default:
      return null;
  }
}
