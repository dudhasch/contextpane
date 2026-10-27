import { ChevronDown, ChevronUp, Eye, LogIn, ShieldBan, ShieldCheck, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import type { CaPolicyInspector, EntraSignInTimeline as Props, SignInEvent } from "@contextpane/catalog";
import { fmtSignInTime, fmtTimeUtc } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable } from "./CardShell";
import { FilterChips, IdentityCell, rowHighlightClass, useStatusFilter, type RowStatus } from "./TableFilter";

const classifyEvent = (e: SignInEvent): RowStatus => (e.status === "failure" || e.status === "interrupted" ? "bad" : "good");

/** Events shown before "show more": every highlighted one plus the nearest context. */
const COLLAPSED_EVENTS = 8;

function collapseEvents(events: SignInEvent[], pinned: string | null): SignInEvent[] {
  if (events.length <= COLLAPSED_EVENTS) return events;
  const keep = new Set(events.filter((e) => e.isHighlighted || e.id === pinned).map((e) => e.id));
  for (const e of [...events].reverse()) {
    if (keep.size >= COLLAPSED_EVENTS) break;
    keep.add(e.id);
  }
  return events.filter((e) => keep.has(e.id));
}

const STATE_LABEL: Record<CaPolicyInspector["state"], string> = { enabled: "On", disabled: "Off", enabledForReportingButNotEnforced: "Report-Only" };
const short = (name: string) => name.replace("[ContextPane-Demo] ", "");

/** User Sign-In History & Conditional Access card (rose). */
export function EntraSignInTimelineCard({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const focusCard = useWorkbench((s) => s.focusCard);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const drifted = props.policies.filter((p) => p.drift.length || p.role === "blocking");
  return (
    <CardShell
      type="EntraSignInTimeline"
      icon={<LogIn />}
      title="Sign-In History & Conditional Access"
      state={props.state}
      triggeredBy={triggeredBy}
      codeLens={props.sourceRef}
      tabs={[
        { id: "signins", label: "User Sign-In & Audit History", badge: props.events.length },
        { id: "policies", label: "Conditional Access Policy Inspector", badge: props.policies.length },
      ]}
      summary={
        <div className="space-y-1">
          <div className="text-[12.5px] leading-snug">{props.headline}</div>
          {props.rootCause ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11.5px]" title={props.rootCause.explanation}>
              <ShieldBan className="size-3.5 shrink-0 text-critical" />
              <Pill tone="critical">{props.rootCause.errorCodeLabel}</Pill>
              <span className="text-muted">on</span>
              <span className="shrink-0 font-mono">{props.rootCause.targetApp}</span>
              {props.rootCause.policyName && (
                <>
                  <span className="shrink-0 text-muted">· Blocked by</span>
                  <span className="truncate font-mono text-critical">'{short(props.rootCause.policyName)}'</span>
                </>
              )}
            </div>
          ) : (
            drifted.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {drifted.map((p) => (
                  <Pill key={p.id} tone={p.drift.some((d) => d.severity === "critical") ? "critical" : "warning"} icon={<ShieldBan />}>
                    {short(p.displayName).split("-").slice(0, 2).join("-")} · {p.drift.map((d) => d.field.split(".").at(-1)).join(", ") || STATE_LABEL[p.state]}
                  </Pill>
                ))}
              </div>
            )
          )}
        </div>
      }
      primaryAction={
        drifted.length > 0 && (
          <>
            <Button size="xs" variant="meta" icon={<ShieldBan />} onClick={() => focusCard("EntraSignInTimeline", "policies")}>
              Inspect Policy &amp; Fix
            </Button>
            {props.microActions.some((a) => a.kind === "generate-fix") && (
              <Button size="xs" variant="outline" icon={<Wrench />} onClick={() => openRemediation({ tab: "powershell" })}>
                {props.events.some((e) => e.errorCodeLabel === "AADSTS7000222" || e.upn.startsWith("spn-")) ||
                triggeredBy.includes("spn-contoso-erp-sync")
                  ? "Stage Workload Identity Fix"
                  : "Stage CA Fix"}
              </Button>
            )}
          </>
        )
      }
    >
      {(tab) => (tab === "policies" ? <PolicyInspector policies={props.policies} /> : <SignInList events={props.events} />)}
    </CardShell>
  );
}

function SignInList({ events: all }: { events: SignInEvent[] }) {
  const [showAll, setShowAll] = useState(false);
  const vision = useWorkbench((s) => s.vision);
  const rowFilter = useWorkbench((s) => s.rowFilter);
  const { chip, setChip, counts, filtered } = useStatusFilter(all, classifyEvent);
  const visionEventId = vision.status === "ready" ? (vision.result?.match?.eventId ?? null) : null;
  const events = useMemo(() => (showAll || chip !== "all" ? filtered : collapseEvents(filtered, visionEventId)), [filtered, showAll, chip, visionEventId]);
  const hidden = filtered.length - events.length;
  const latestTimestamp = all[all.length - 1]?.timestamp;
  return (
    <div>
      <FilterChips chip={chip} counts={counts} onChange={setChip} testId="signin-filter-chips" />
      <ol className="relative ml-2 border-l border-border-subtle pl-4">
        {events.map((e) => {
          const tone: Tone = e.status === "failure" ? "critical" : e.status === "interrupted" ? "warning" : e.isHighlighted ? "warning" : "healthy";
          const visionHit = e.id === visionEventId;
          return (
            <li key={e.id} data-event-id={e.id} className={`relative mb-1 last:mb-0 ${visionHit ? "rounded-md ring-2 ring-meta ring-offset-1 ring-offset-canvas" : ""} ${rowHighlightClass(rowFilter, { upn: e.upn, deviceName: e.deviceName || null })}`}>
              <span className="absolute top-1.5 -left-[21px]">
                <Dot tone={tone} pulse={e.isHighlighted} />
              </span>
              <div
                className={`rounded-md border px-2.5 py-0.5 text-[11.5px] ${e.isHighlighted ? "border-critical/40 bg-critical/8" : "border-border-subtle bg-surface"}`}
                title={`${e.appId} · ${e.clientApp} · ${e.location} · ${e.ipAddress} · ${e.deviceName}${e.blockingPolicyName ? ` · CA: ${e.blockingPolicyName}` : ""}${e.failureReason ? ` · ${e.failureReason}` : ""}`}
              >
                <div className="flex items-center gap-x-2">
                  <span className="shrink-0 font-mono text-faint" title={e.timestamp}>{fmtSignInTime(e.timestamp, latestTimestamp)}</span>
                  <IdentityCell kind="upn" value={e.upn} className="shrink-0 font-medium">
                    {e.displayName}
                  </IdentityCell>
                  <span className="text-muted">→</span>
                  <span className="truncate font-mono">{e.appDisplayName}</span>
                  <span className="hidden truncate text-[10.5px] text-faint xl:inline">
                    {e.clientApp} · {e.location}
                    {e.deviceName ? ` · ${e.deviceName}` : ""}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {visionHit && (
                      <Pill tone="meta" icon={<Eye />}>
                        vision match
                      </Pill>
                    )}
                    {e.errorCodeLabel ? (
                      <Pill tone={e.status === "interrupted" ? "warning" : "critical"}>{e.errorCodeLabel}</Pill>
                    ) : (
                      <Pill tone={e.isHighlighted ? "warning" : "healthy"} icon={<ShieldCheck />}>
                        success
                      </Pill>
                    )}
                  </span>
                </div>
                {e.isHighlighted && e.blockingPolicyName && <div className="mt-0.5 truncate text-[10.5px] text-critical">CA: {short(e.blockingPolicyName)} · device {e.deviceCompliant === false ? "NonCompliant" : "compliant"}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {(hidden > 0 || showAll) && (
        <Button size="xs" variant="ghost" className="mt-1" icon={showAll ? <ChevronUp /> : <ChevronDown />} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `${hidden} more event${hidden === 1 ? "" : "s"}`}
        </Button>
      )}
    </div>
  );
}

/** Included / excluded groups, target apps, grant controls and the drift against the golden baseline, per policy. */
function PolicyInspector({ policies }: { policies: CaPolicyInspector[] }) {
  return (
    <div className="space-y-2" data-testid="policy-inspector">
      {policies.map((p) => (
        <div key={p.id} className={`rounded-md border p-2 ${p.drift.length || p.role === "blocking" ? "border-critical/40 bg-critical/5" : "border-border-subtle bg-surface"}`}>
          <div className="flex items-center gap-2 text-[12px]">
            <ShieldBan className={`size-3.5 shrink-0 ${p.drift.length || p.role === "blocking" ? "text-critical" : "text-muted"}`} />
            <span className="truncate font-medium" title={p.displayName}>
              {p.displayName}
            </span>
            <Pill tone={p.state === "enabled" ? (p.role === "blocking" ? "critical" : "healthy") : "warning"}>{STATE_LABEL[p.state]}</Pill>
            <span className="ml-auto font-mono text-[10px] text-faint">{p.role}</span>
          </div>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
            <dt className="text-faint">Include</dt>
            <dd className="font-mono">{p.includeGroups.join(", ") || "—"}</dd>
            <dt className="text-faint">Exclude</dt>
            <dd className={`font-mono ${p.excludeGroups.length ? "" : "text-critical"}`}>{p.excludeGroups.join(", ") || "(none)"}</dd>
            <dt className="text-faint">Target apps</dt>
            <dd>{p.targetApps.join(", ")}</dd>
            {p.clientAppTypes.length > 0 && (
              <>
                <dt className="text-faint">Client apps</dt>
                <dd className="font-mono">{p.clientAppTypes.join(", ")}</dd>
              </>
            )}
            <dt className="text-faint">Grant</dt>
            <dd>{p.grantControls.join(", ")}</dd>
          </dl>
          {p.drift.length > 0 && (
            <DataTable
              className="mt-1.5"
              head={["Drift", "Golden baseline", "Live tenant"]}
              rows={p.drift.map((d) => [
                <span className="font-mono">{d.field}</span>,
                <span className="font-mono text-healthy">{d.expected}</span>,
                <span className="font-mono text-critical">{d.actual}</span>,
              ])}
            />
          )}
          {(p.fixedState || p.fixedExcludeGroups) && (p.fixedState !== p.state || p.fixedExcludeGroups?.join() !== p.excludeGroups.join()) && (
            <div className="mt-1.5 text-[11px] text-muted">
              Staged fix → state <span className="font-mono text-healthy">{STATE_LABEL[p.fixedState ?? p.state]}</span>, exclude{" "}
              <span className="font-mono text-healthy">{(p.fixedExcludeGroups ?? p.excludeGroups).join(", ")}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
