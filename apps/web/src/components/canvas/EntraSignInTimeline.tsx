import { ChevronDown, ChevronUp, Eye, LogIn, ShieldBan, Wrench } from "lucide-react";
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

/** User Sign-In History & Conditional Access section, or Workload Identity & OAuth Grants for ANOM-APP-401. */
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
      {props.rootCause.errorCodeLabel} on {props.rootCause.targetApp}
    </span>
  ) : drifted.length > 0 ? (
    <span>
      {drifted.length} drifted polic{drifted.length === 1 ? "y" : "ies"}
    </span>
  ) : undefined;
  const details = props.rootCause ? (
    <div className="space-y-1">
      <div>
        <span className="font-mono text-text">{props.rootCause.errorCodeLabel}</span> on {props.rootCause.targetApp}
        {props.rootCause.policyName ? (
          <>
            {" "}
            · policy <span className="font-mono text-text">{short(props.rootCause.policyName)}</span>
          </>
        ) : null}
      </div>
      {props.rootCause.explanation && <div>{props.rootCause.explanation}</div>}
    </div>
  ) : drifted.length > 0 ? (
    <ul className="space-y-0.5 font-mono">
      {drifted.map((p) => (
        <li key={p.id} className="truncate" title={p.displayName}>
          {short(p.displayName)}
        </li>
      ))}
    </ul>
  ) : undefined;
  const hasGenerateFix = props.microActions.some((a) => a.kind === "generate-fix");

  return (
    <CardShell
      type="EntraSignInTimeline"
      icon={<LogIn />}
      title={isWorkloadIdentity ? "Workload Identity, OAuth Grants & Sign-In History" : "Sign-In History & Conditional Access"}
      state={props.state}
      triggeredBy={triggeredBy}
      codeLens={props.sourceRef}
      footerMeta={footerMeta}
      details={details}
      tabs={[
        { id: "signins", label: isWorkloadIdentity ? "Service Principal Sign-Ins" : "Sign-In & Audit History", badge: props.events.length },
        { id: "policies", label: isWorkloadIdentity ? "Workload Identity & OAuth Grants" : "Conditional Access Policies", badge: props.policies.length },
      ]}
      summary={subtitle}
      primaryAction={
        drifted.length > 0 && (
          <>
            <Button
              size="xs"
              variant="outline"
              icon={<ShieldBan />}
              onClick={() => inspectPolicyAndFix(drifted[0]?.id ?? "blocking")}
              data-testid="inspect-policy-and-fix"
            >
              {isWorkloadIdentity ? "Inspect Grants & Fix" : "Inspect Policy & Fix"}
            </Button>
            {hasGenerateFix && (
              <Button
                size="xs"
                variant="ghost"
                icon={<Wrench />}
                aria-label={isWorkloadIdentity ? "Stage Workload Identity Fix" : "Stage CA Fix"}
                title={isWorkloadIdentity ? "Stage Workload Identity Fix (PowerShell)" : "Stage CA Fix (PowerShell)"}
                className="w-6 px-0!"
                onClick={() =>
                  openRemediation({
                    tab: "powershell",
                    focusBanner: isWorkloadIdentity
                      ? "Focused: Workload Identity & OAuth Grants Fix"
                      : "Focused: Conditional Access Policy Fix",
                  })
                }
              />
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
      <ol className="-mx-4 divide-y divide-hairline-2">
        {events.map((e) => {
          const tone: Tone = e.status === "failure" ? "critical" : e.status === "interrupted" ? "warning" : e.isHighlighted ? "warning" : "healthy";
          const visionHit = e.id === visionEventId;
          const blocked = shouldRenderCaBlockedBadge(e);
          return (
            <li
              key={e.id}
              data-event-id={e.id}
              className={`px-4 py-1 text-12 ${visionHit ? "bg-signal/10 shadow-[inset_2px_0_0_var(--signal)]" : ""} ${rowHighlightClass(rowFilter, { upn: e.upn, deviceName: e.deviceName || null })}`}
              title={`${e.appId} · ${e.clientApp} · ${e.location} · ${e.ipAddress} · ${e.deviceName}${e.blockingPolicyName ? ` · CA: ${e.blockingPolicyName}` : ""}${e.failureReason ? ` · ${e.failureReason}` : ""}`}
            >
              <div className="flex min-w-0 items-center gap-x-2">
                <Dot tone={tone} pulse={e.isHighlighted} />
                <span className="shrink-0 font-mono text-faint" title={e.timestamp}>
                  {fmtSignInTime(e.timestamp, latestTimestamp)}
                </span>
                <IdentityCell kind="upn" value={e.upn} className={`shrink-0 ${e.isHighlighted ? "text-text" : "text-muted"}`}>
                  {e.displayName}
                </IdentityCell>
                <span className="text-faint">→</span>
                <span className="min-w-0 truncate font-mono text-muted">{e.appDisplayName}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {visionHit && (
                    <span className="inline-flex items-center gap-1 font-mono text-11 text-signal">
                      <Eye className="size-3" /> vision match
                    </span>
                  )}
                  {!blocked ? (
                    <Pill variant="status" tone="healthy" mono={false}>
                      {e.errorCodeLabel && !/blocked|53003|failure|error|7000222/i.test(e.errorCodeLabel)
                        ? e.errorCodeLabel
                        : /virtual desktop|\bavd\b/i.test(e.appDisplayName)
                          ? "AVD sign-in OK"
                          : "Sign-in OK"}
                    </Pill>
                  ) : e.errorCodeLabel ? (
                    <Pill variant="status" tone={e.status === "interrupted" ? "warning" : "critical"}>
                      {e.errorCodeLabel}
                    </Pill>
                  ) : (
                    <Pill variant="status" tone={e.isHighlighted ? "warning" : "healthy"} mono={false}>
                      success
                    </Pill>
                  )}
                </span>
              </div>
              {e.status !== "success" && e.isHighlighted && e.blockingPolicyName && (
                <div className="truncate pl-4 text-11 text-critical">
                  CA: {short(e.blockingPolicyName)} · device {e.deviceCompliant === false ? "NonCompliant" : "compliant"}
                </div>
              )}
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
    <div className="-mx-4 divide-y divide-hairline-2" data-testid="policy-inspector">
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
            data-highlighted={isHighlighted || undefined}
            style={{ ["--flash-color" as string]: "var(--critical)" }}
            className={`px-4 py-2 transition-colors duration-300 ${isOffending ? "shadow-[inset_2px_0_0_var(--critical)]" : ""} ${isHighlighted ? "animate-pulse-ring bg-critical/8" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-2 text-12">
              <ShieldBan className={`size-3.5 shrink-0 ${isOffending ? "text-critical" : "text-muted"}`} />
              <span className="min-w-0 truncate font-medium text-text" title={p.displayName}>
                {p.displayName}
              </span>
              <Pill variant="status" tone={p.state === "enabled" ? (p.role === "blocking" ? "critical" : "healthy") : "warning"} mono={false}>
                {STATE_LABEL[p.state]}
              </Pill>
              <span className="ml-auto shrink-0 text-11 text-faint">{humanizeStatus(p.role)}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-5.5 text-12">
              <dt className="text-faint">Include</dt>
              <dd className="min-w-0 font-mono" title={p.includeGroups.join(", ")}>
                <TextWithRolePermissionHovers text={includeText} />
              </dd>
              <dt className="text-faint">Exclude</dt>
              <dd className={`min-w-0 font-mono ${p.excludeGroups.length ? "" : "text-critical"}`} title={p.excludeGroups.join(", ")}>
                <TextWithRolePermissionHovers text={excludeText} />
              </dd>
              <dt className="text-faint">Target apps</dt>
              <dd className="min-w-0">{p.targetApps.join(", ")}</dd>
              {p.clientAppTypes.length > 0 && (
                <>
                  <dt className="text-faint">Client apps</dt>
                  <dd className="min-w-0">{p.clientAppTypes.map(humanizeStatus).join(", ")}</dd>
                </>
              )}
              <dt className="text-faint">Grant</dt>
              <dd className="min-w-0 font-medium text-text">
                <TextWithRolePermissionHovers text={grantText} />
              </dd>
            </dl>
            {p.drift.length > 0 && (
              <div className="mt-1.5 pl-5.5">
                <DataTable
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
              </div>
            )}
            {(p.fixedState || p.fixedExcludeGroups) && (p.fixedState !== p.state || p.fixedExcludeGroups?.join() !== p.excludeGroups.join()) && (
              <div className="mt-1.5 pl-5.5 text-11 text-muted">
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
