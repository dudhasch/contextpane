import { ChevronDown, ChevronUp, Eye, LogIn, ShieldBan, ShieldCheck, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import type { CaPolicyInspector, EntraSignInTimeline as Props, SignInEvent } from "@contextpane/catalog";
import { fmtSignInTime, fmtTimeUtc, humanizeSlug, humanizeStatus } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { TextWithRolePermissionHovers } from "../ui/RolePermissionHoverPopover";
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

export function shouldRenderCaBlockedBadge(row: { status: string; errorCode?: number; errorCodeLabel?: string }): boolean {
  if (row.status === "success") return false;
  return Boolean(row.errorCode || row.errorCodeLabel);
}

function formatEntraSubtitle(props: Props, isWorkloadIdentity: boolean): string {
  const failures = props.events.filter((e) => e.status === "failure" || e.status === "interrupted");
  if (props.state === "healthy" || (failures.length === 0 && !props.policies.some((p) => p.drift.length > 0))) {
    return props.headline.endsWith(".") ? props.headline : `${props.headline}.`;
  }
  if (isWorkloadIdentity) {
    return "Nightly sign-ins for spn-contoso-erp-sync fail with AADSTS7000222 due to an expired client secret, while a non-admin user holds shadow-admin ownership and overprivileged Graph scopes.";
  }
  const has53000 =
    props.rootCause?.errorCodeLabel?.includes("53000") ||
    failures.some((e) => e.errorCode === 53000 || e.errorCodeLabel?.includes("53000"));
  if (has53000) {
    const policy = short(props.rootCause?.policyName ?? "Require compliant device - Fabrikam Legal");
    return `AADSTS53000 blocked ${failures.length || 6} sign-ins to Exchange Online & Teams because '${policy}' requires a compliant device.`;
  }
  const has53003 =
    props.rootCause?.errorCodeLabel?.includes("53003") ||
    failures.some((e) => e.errorCode === 53003 || e.errorCodeLabel?.includes("53003"));
  if (has53003) {
    const policy = short(props.rootCause?.policyName ?? "Block AVD - Contoso Finance Legacy");
    return `AADSTS53003 blocked ${failures.length || 3} sign-ins to Azure Virtual Desktop under policy '${policy}'.`;
  }
  if (props.policies.some((p) => p.drift.length > 0)) {
    return `CA-001 is missing the SG-BreakGlass-Accounts exclusion (lockout risk), and CA-004 was left in Report-Only with ${props.events.length} legacy sign-ins in the last 24 hours.`;
  }
  return props.headline.replace(/\bExchange Online Teams\b/gi, "Exchange Online & Teams");
}

/** User Sign-In History & Conditional Access card (rose), or Workload Identity & OAuth Grants for ANOM-APP-401. */
export function EntraSignInTimelineCard({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const inspectPolicyAndFix = useWorkbench((s) => s.inspectPolicyAndFix);
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const drifted = props.policies.filter((p) => p.drift.length || p.role === "blocking");
  const isWorkloadIdentity =
    props.events.some((e) => e.errorCodeLabel === "AADSTS7000222" || e.upn.toLowerCase().startsWith("spn-")) ||
    props.policies.some((p) => p.displayName === "spn-contoso-erp-sync" || p.id.startsWith("spn-") || p.id.startsWith("app-")) ||
    triggeredBy.includes("spn-contoso-erp-sync");
  const subtitle = formatEntraSubtitle(props, isWorkloadIdentity);
  const footerMeta = props.rootCause ? (
    <span title={props.rootCause.explanation}>
      · {props.rootCause.errorCodeLabel} on {props.rootCause.targetApp}
      {props.rootCause.policyName ? ` · Policy: '${short(props.rootCause.policyName)}'` : ""}
    </span>
  ) : drifted.length > 0 ? (
    <span>
      · {drifted.length} drifted polic{drifted.length === 1 ? "y" : "ies"} ({drifted.map((p) => short(p.displayName).split("-").slice(0, 2).join("-")).join(", ")})
    </span>
  ) : undefined;

  return (
    <CardShell
      type="EntraSignInTimeline"
      icon={<LogIn />}
      title={isWorkloadIdentity ? "Workload Identity, OAuth Grants & Sign-In History" : "Sign-In History & Conditional Access"}
      state={props.state}
      triggeredBy={triggeredBy}
      codeLens={props.sourceRef}
      footerMeta={footerMeta}
      tabs={[
        { id: "signins", label: isWorkloadIdentity ? "Service Principal Sign-In History" : "User Sign-In & Audit History", badge: props.events.length },
        { id: "policies", label: isWorkloadIdentity ? "Workload Identity & OAuth Grants" : "Conditional Access Policy Inspector", badge: props.policies.length },
      ]}
      summary={<div className="text-[12.5px] leading-snug">{subtitle}</div>}
      primaryAction={
        drifted.length > 0 && (
          <>
            <Button
              size="xs"
              variant="meta"
              icon={<ShieldBan />}
              onClick={() => inspectPolicyAndFix(drifted[0]?.id ?? "blocking")}
              data-testid="inspect-policy-and-fix"
            >
              {isWorkloadIdentity ? "Inspect App Grants & Fix" : "Inspect Policy & Fix"}
            </Button>
            {props.microActions.some((a) => a.kind === "generate-fix") && (
              <Button
                size="xs"
                variant="outline"
                icon={<Wrench />}
                onClick={() =>
                  openRemediation({
                    tab: "powershell",
                    focusBanner: isWorkloadIdentity
                      ? "Focused: Workload Identity & OAuth Grants Fix"
                      : "Focused: Conditional Access Policy Fix",
                  })
                }
              >
                {isWorkloadIdentity ? "Stage Workload Identity Fix" : "Stage CA Fix"}
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
                  <span className="hidden truncate text-[11px] text-faint xl:inline">
                    {e.clientApp} · {e.location}
                    {e.deviceName ? ` · ${e.deviceName}` : ""}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {visionHit && (
                      <Pill tone="meta" icon={<Eye />}>
                        vision match
                      </Pill>
                    )}
                    {!shouldRenderCaBlockedBadge(e) ? (
                      <Pill tone="healthy" icon={<ShieldCheck />} mono={false}>
                        {e.errorCodeLabel && !/blocked|53003|failure|error|7000222/i.test(e.errorCodeLabel)
                          ? e.errorCodeLabel
                          : /virtual desktop|\bavd\b/i.test(e.appDisplayName)
                            ? "AVD Sign-In OK · Compliant"
                            : "Sign-In OK · Compliant"}
                      </Pill>
                    ) : e.errorCodeLabel ? (
                      <Pill tone={e.status === "interrupted" ? "warning" : "critical"}>{e.errorCodeLabel}</Pill>
                    ) : (
                      <Pill tone={e.isHighlighted ? "warning" : "healthy"} icon={<ShieldCheck />}>
                        success
                      </Pill>
                    )}
                  </span>
                </div>
                {e.status !== "success" && e.isHighlighted && e.blockingPolicyName && <div className="mt-0.5 truncate text-[11px] text-critical">CA: {short(e.blockingPolicyName)} · device {e.deviceCompliant === false ? "NonCompliant" : "compliant"}</div>}
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

const FRIENDLY_GUID_NAMES: Record<string, string> = {
  "171d8a93-1a2a-404d-918e-aa341ca81c63": "Global & Security Admins (Role)",
  "957845fd-42ee-4500-b407-ad04487da3c7": "SG-BreakGlass-Accounts",
  "6f8a9b0c-1d2e-4f3a-9b8c-7d6e5f4a3b2c": "SG-Contoso-Finance-Legacy",
  "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d": "SG-Contoso-Finance-AVD",
};

function formatPrincipalList(items: string[]): string {
  if (!items.length) return "";
  return items.map((item) => FRIENDLY_GUID_NAMES[item.toLowerCase()] ?? item).join(", ");
}

/** Included / excluded groups, target apps, grant controls and the drift against the golden baseline, per policy. */
function PolicyInspector({ policies }: { policies: CaPolicyInspector[] }) {
  const highlightedPolicyId = useWorkbench((s) => s.highlightedPolicyId);
  return (
    <div className="space-y-2" data-testid="policy-inspector">
      {policies.map((p) => {
        const grantText =
          p.grantControls.length > 0
            ? p.grantControls.join(", ")
            : p.displayName.includes("PhishingResistant") || p.displayName.includes("CA-001")
              ? "Require Phishing-Resistant MFA (FIDO2 / Windows Hello)"
              : "Block / Policy-specific control";
        const includeText = formatPrincipalList(p.includeGroups) || "—";
        const excludeText = formatPrincipalList(p.excludeGroups) || "(none)";
        const isOffending = Boolean(p.drift.length || p.role === "blocking");
        const isHighlighted =
          highlightedPolicyId !== null &&
          (highlightedPolicyId === p.id ||
            highlightedPolicyId === p.displayName ||
            (highlightedPolicyId === "blocking" && isOffending));
        return (
          <div
            key={p.id}
            data-policy-id={p.id}
            className={`rounded-md border p-2 transition-all duration-300 ${
              isOffending ? "border-critical/40 bg-critical/5" : "border-border-subtle bg-surface"
            } ${isHighlighted ? "animate-pulse ring-2 ring-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.35)]" : ""}`}
          >
            <div className="flex items-center gap-2 text-[12px]">
              <ShieldBan className={`size-3.5 shrink-0 ${isOffending ? "text-critical" : "text-muted"}`} />
              <span className="truncate font-medium" title={p.displayName}>
                {p.displayName}
              </span>
              <Pill tone={p.state === "enabled" ? (p.role === "blocking" ? "critical" : "healthy") : "warning"}>{STATE_LABEL[p.state]}</Pill>
              <span className="ml-auto text-[10px] text-faint">{humanizeStatus(p.role)}</span>
            </div>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
              <dt className="text-faint">Include</dt>
              <dd className="font-mono" title={p.includeGroups.join(", ")}>
                <TextWithRolePermissionHovers text={includeText} />
              </dd>
              <dt className="text-faint">Exclude</dt>
              <dd className={`font-mono ${p.excludeGroups.length ? "" : "text-critical"}`} title={p.excludeGroups.join(", ")}>
                <TextWithRolePermissionHovers text={excludeText} />
              </dd>
              <dt className="text-faint">Target apps</dt>
              <dd>{p.targetApps.join(", ")}</dd>
              {p.clientAppTypes.length > 0 && (
                <>
                  <dt className="text-faint">Client apps</dt>
                  <dd>{p.clientAppTypes.map(humanizeStatus).join(", ")}</dd>
                </>
              )}
              <dt className="text-faint">Grant</dt>
              <dd className="font-medium text-text">
                <TextWithRolePermissionHovers text={grantText} />
              </dd>
            </dl>
            {p.drift.length > 0 && (
              <DataTable
                className="mt-1.5"
                head={["Drift", "Golden baseline", "Live tenant"]}
                rows={p.drift.map((d) => [
                  <span title={d.field}>{humanizeSlug(d.field)}</span>,
                  <span className="font-mono text-healthy">
                    <TextWithRolePermissionHovers text={d.expected} />
                  </span>,
                  <span className="font-mono text-critical">
                    <TextWithRolePermissionHovers text={d.actual} />
                  </span>,
                ])}
              />
            )}
            {(p.fixedState || p.fixedExcludeGroups) && (p.fixedState !== p.state || p.fixedExcludeGroups?.join() !== p.excludeGroups.join()) && (
              <div className="mt-1.5 text-[11px] text-muted">
                Staged fix → state <span className="font-mono text-healthy">{STATE_LABEL[p.fixedState ?? p.state]}</span>, exclude{" "}
                <span className="font-mono text-healthy">{formatPrincipalList(p.fixedExcludeGroups ?? p.excludeGroups)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
