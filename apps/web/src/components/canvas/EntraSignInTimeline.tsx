import { KeyRound, LogIn, ShieldBan, ShieldCheck, Sparkles } from "lucide-react";
import type { EntraSignInTimeline as Props, Provenance, QuickAction } from "@contextpane/catalog";
import { fmtTimeUtc } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { CardShell } from "./CardShell";

export function EntraSignInTimelineCard({ props, provenance, repaired }: { props: Props; provenance: Provenance; repaired?: boolean }) {
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
        <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-md border border-critical/30 bg-critical/8 px-2.5 py-2 text-[12px]">
          <ShieldBan className="size-4 shrink-0 text-critical" />
          <Pill tone="critical">{props.rootCause.errorCodeLabel}</Pill>
          <span className="text-muted">→</span>
          <span className="font-mono">{props.rootCause.targetApp}</span>
          {props.rootCause.policyName && (
            <>
              <span className="text-muted">blocked by</span>
              <span className="font-mono text-critical">{props.rootCause.policyName}</span>
            </>
          )}
          <span className="basis-full text-[11px] text-muted">{props.rootCause.explanation}</span>
        </div>
      )}

      <ol className="relative ml-2 border-l border-border-subtle pl-4">
        {props.events.map((e) => {
          const tone: Tone = e.status === "failure" ? "critical" : e.status === "interrupted" ? "warning" : "healthy";
          return (
            <li key={e.id} className={`relative mb-2 last:mb-0 ${e.isHighlighted ? "" : "opacity-85"}`}>
              <span className="absolute -left-[21px] top-1.5">
                <Dot tone={tone} pulse={e.isHighlighted} />
              </span>
              <div className={`rounded-md border px-2.5 py-1.5 text-[11.5px] ${e.isHighlighted ? "border-critical/40 bg-critical/8" : "border-border-subtle bg-surface"}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono text-faint">{fmtTimeUtc(e.timestamp)}</span>
                  <span className="font-medium">{e.displayName}</span>
                  <span className="text-muted">→</span>
                  <span className="font-mono">{e.appDisplayName}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {e.errorCodeLabel ? <Pill tone="critical">{e.errorCodeLabel}</Pill> : <Pill tone="healthy" icon={<ShieldCheck />}>success</Pill>}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10.5px] text-faint">
                  <span className="font-mono">{e.appId}</span>
                  <span>{e.clientApp}</span>
                  <span>{e.location}</span>
                  <span className="font-mono">{e.ipAddress}</span>
                  <span>
                    {e.deviceName} · {e.deviceCompliant === false ? <span className="text-warning">non-compliant</span> : "compliant"}
                  </span>
                  {e.blockingPolicyName && <span className="text-critical">CA: {e.blockingPolicyName}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {props.microActions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {props.microActions.map((a) => (
            <MicroAction key={a.id} action={a} />
          ))}
        </div>
      )}
    </CardShell>
  );
}

function MicroAction({ action }: { action: QuickAction }) {
  const toast = useWorkbench((s) => s.toast);
  const remediate = useWorkbench((s) => s.remediate);
  const hover = useWorkbench((s) => s.hover);
  const run = () => {
    switch (action.kind) {
      case "issue-tap":
        toast({ tone: "healthy", title: "Temporary Access Pass issued (simulated)", detail: `${action.targetEntityId} · 60 min · one-time use` });
        break;
      case "exclude-group-report-only":
        toast({ tone: "meta", title: "Staging CA change via Tier 3", detail: action.description });
        void remediate();
        break;
      case "inspect-policy":
        if (action.targetEntityId) void hover(action.targetEntityId, "policy");
        toast({ tone: "info", title: "Inspecting policy", detail: action.description ?? action.targetEntityId });
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
