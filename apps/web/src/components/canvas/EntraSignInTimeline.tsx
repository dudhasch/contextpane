import { ChevronDown, ChevronUp, Eye, KeyRound, LogIn, ShieldBan, ShieldCheck, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { EntraSignInTimeline as Props, Provenance, QuickAction, SignInEvent } from "@contextpane/catalog";
import { fmtTimeUtc } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { CardShell } from "./CardShell";

/** Events shown before "show more": every highlighted one plus the nearest context, so the fourth canvas card stays above the fold. */
const COLLAPSED_EVENTS = 4;

function collapseEvents(events: SignInEvent[], pinned: string | null): SignInEvent[] {
  if (events.length <= COLLAPSED_EVENTS) return events;
  const keep = new Set(events.filter((e) => e.isHighlighted || e.id === pinned).map((e) => e.id));
  for (const e of events) {
    if (keep.size >= COLLAPSED_EVENTS) break;
    keep.add(e.id);
  }
  return events.filter((e) => keep.has(e.id));
}

export function EntraSignInTimelineCard({ props, provenance, repaired }: { props: Props; provenance: Provenance; repaired?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const vision = useWorkbench((s) => s.vision);
  const visionEventId = vision.status === "ready" ? (vision.result?.match?.eventId ?? null) : null;
  const events = useMemo(() => (showAll ? props.events : collapseEvents(props.events, visionEventId)), [props.events, showAll, visionEventId]);
  const hidden = props.events.length - events.length;
  return (
    <CardShell
      type="EntraSignInTimeline"
      icon={<LogIn />}
      title={`Sign-in timeline · ${props.focusUpn}`}
      state={props.state}
      provenance={provenance}
      repaired={repaired}
      right={
        <span className="font-mono text-[10px] text-faint">
          {fmtTimeUtc(props.windowStart)} → {fmtTimeUtc(props.windowEnd)} · {props.events.length} events
        </span>
      }
    >
      {props.rootCause && (
        <div className="mb-2 flex items-center gap-x-2 rounded-md border border-critical/30 bg-critical/8 px-2.5 py-1.5 text-[12px]" title={props.rootCause.explanation}>
          <ShieldBan className="size-4 shrink-0 text-critical" />
          <Pill tone="critical">{props.rootCause.errorCodeLabel}</Pill>
          <span className="text-muted">→</span>
          <span className="shrink-0 font-mono">{props.rootCause.targetApp}</span>
          {props.rootCause.policyName && (
            <>
              <span className="shrink-0 text-muted">blocked by</span>
              <span className="truncate font-mono text-critical">{props.rootCause.policyName}</span>
            </>
          )}
          <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted 2xl:inline">· {props.rootCause.explanation}</span>
        </div>
      )}

      <PolicyInspector />

      <ol className="relative ml-2 border-l border-border-subtle pl-4">
        {events.map((e) => {
          const tone: Tone = e.status === "failure" ? "critical" : e.status === "interrupted" ? "warning" : "healthy";
          const visionHit = e.id === visionEventId;
          return (
            <li
              key={e.id}
              data-event-id={e.id}
              className={`relative mb-1 last:mb-0 ${e.isHighlighted || visionHit ? "" : "opacity-85"} ${visionHit ? "rounded-md ring-2 ring-meta ring-offset-1 ring-offset-canvas" : ""}`}
            >
              <span className="absolute -left-[21px] top-1.5">
                <Dot tone={tone} pulse={e.isHighlighted} />
              </span>
              {/* one line per event; the full detail line only for the events that explain the ticket, the rest carry it in the tooltip */}
              <div
                className={`rounded-md border px-2.5 py-0.5 text-[11.5px] ${e.isHighlighted ? "border-critical/40 bg-critical/8" : "border-border-subtle bg-surface"}`}
                title={`${e.appId} · ${e.clientApp} · ${e.location} · ${e.ipAddress} · ${e.deviceName} (${e.deviceCompliant === false ? "non-compliant" : "compliant"})${e.blockingPolicyName ? ` · CA: ${e.blockingPolicyName}` : ""}`}
              >
                <div className="flex items-center gap-x-2">
                  <span className="shrink-0 font-mono text-faint">{fmtTimeUtc(e.timestamp)}</span>
                  <span className="shrink-0 font-medium">{e.displayName}</span>
                  <span className="text-muted">→</span>
                  <span className="truncate font-mono">{e.appDisplayName}</span>
                  {!e.isHighlighted && (
                    <span className="hidden truncate text-[10.5px] text-faint xl:inline">
                      {e.clientApp} · {e.location} · {e.deviceName}
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {visionHit && (
                      <Pill tone="meta" icon={<Eye />} title="Matched by Tier 2 · Vision (muse-spark-1.3) from the customer's screenshot">
                        vision match
                      </Pill>
                    )}
                    {e.errorCodeLabel ? <Pill tone="critical">{e.errorCodeLabel}</Pill> : <Pill tone="healthy" icon={<ShieldCheck />}>success</Pill>}
                  </span>
                </div>
                {e.isHighlighted && (
                  <div className="mt-0.5 flex gap-x-3 overflow-hidden text-[10.5px] whitespace-nowrap text-faint">
                    <span>{e.clientApp}</span>
                    <span>{e.location}</span>
                    <span className="font-mono">{e.ipAddress}</span>
                    <span>
                      {e.deviceName} · {e.deviceCompliant === false ? <span className="text-warning">non-compliant</span> : "compliant"}
                    </span>
                    {e.blockingPolicyName && <span className="truncate text-critical">CA: {e.blockingPolicyName}</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {(props.microActions.length > 0 || hidden > 0 || showAll) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(hidden > 0 || showAll) && (
            <Button size="xs" variant="ghost" icon={showAll ? <ChevronUp /> : <ChevronDown />} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `${hidden} more event${hidden === 1 ? "" : "s"}`}
            </Button>
          )}
          {props.microActions.map((a) => (
            <MicroAction key={a.id} action={a} />
          ))}
        </div>
      )}
    </CardShell>
  );
}

/** [Inspect CA Policy]: the blocking policy as the Graph MCP server reports it, expanded in place. */
function PolicyInspector() {
  const inspect = useWorkbench((s) => s.policyInspect);
  const close = useWorkbench((s) => s.closePolicyInspect);
  if (!inspect) return null;
  const p = inspect.detail?.policy;
  return (
    <div className="mb-2 animate-fade-in rounded-md border border-critical/40 bg-canvas" data-testid="policy-inspector">
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1 text-[11px]">
        <ShieldBan className="size-3.5 text-critical" />
        <span className="font-medium">{p?.displayName ?? inspect.policyId}</span>
        {p && <Pill tone={p.state === "enabled" ? "critical" : "warning"}>{p.state}</Pill>}
        {inspect.detail && <span className="font-mono text-[10px] text-faint">{inspect.detail.source} · blocks {inspect.detail.blockedUpns.length} users</span>}
        <button type="button" onClick={close} className="ml-auto text-faint hover:text-text" aria-label="Close policy">
          <X className="size-3.5" />
        </button>
      </div>
      {inspect.status === "loading" && <div className="m-2 h-16 animate-pulse rounded bg-surface" />}
      {inspect.status === "error" && <div className="px-2.5 py-1.5 text-[11px] text-critical">{inspect.error}</div>}
      {p && (
        <pre className="max-h-44 overflow-auto px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-muted">
          {JSON.stringify(
            {
              id: p.id,
              state: p.state,
              conditions: { users: { includeGroups: p.includeGroupNames, excludeGroups: p.excludeGroupNames }, applications: p.targetApps },
              grantControls: p.grant,
              blockedUpns: inspect.detail?.blockedUpns,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

function MicroAction({ action }: { action: QuickAction }) {
  const toast = useWorkbench((s) => s.toast);
  const remediate = useWorkbench((s) => s.remediate);
  const issueTap = useWorkbench((s) => s.issueTap);
  const inspectPolicy = useWorkbench((s) => s.inspectPolicy);
  const run = () => {
    switch (action.kind) {
      case "issue-tap":
        if (action.targetEntityId) void issueTap(action.targetEntityId);
        break;
      case "exclude-group-report-only":
        toast({ tone: "meta", title: "Staging CA change via Tier 3", detail: action.description });
        void remediate();
        break;
      case "inspect-policy":
        if (action.targetEntityId) void inspectPolicy(action.targetEntityId);
        break;
      default:
        toast({ tone: "info", title: action.label, detail: action.description });
    }
  };
  const icon = action.kind === "issue-tap" ? <KeyRound /> : action.kind === "exclude-group-report-only" ? <Sparkles /> : <ShieldBan />;
  return (
    <Button size="xs" variant={action.kind === "exclude-group-report-only" ? "meta" : "outline"} icon={icon} onClick={run} title={action.description}>
      {action.label}
    </Button>
  );
}
