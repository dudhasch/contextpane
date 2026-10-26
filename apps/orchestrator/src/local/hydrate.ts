import {
  LayoutComponentSchema,
  SCENARIO_REGISTRY,
  isCanvasComponentType,
  lookupAadsts,
  type CaPolicyInspector,
  type ComponentType,
  type EntraSignInTimeline,
  type HealthState,
  type IaCDriftBanner,
  type IntuneDriftCard,
  type Layout,
  type LayoutComponent,
  type LicenseDriftCard,
  type Provenance,
  type QuickAction,
  type SignInEvent,
} from "@contextpane/catalog";
import type { CaPolicySummary, SignInSummary } from "@contextpane/mcp-msgraph";
import type { CorrelationContext } from "../mcp/context.ts";
import { triggeredBy } from "./brief.ts";

/**
 * Deterministic AST hydration. This is both the Tier 0 engine (recipes) and the
 * repair path for every LLM tier: any component the model omits or emits
 * invalidly is rebuilt here from the same MCP context.
 */

export const DEFAULT_COMPONENT_ORDER: ComponentType[] = ["LicenseDriftCard", "EntraSignInTimeline", "IntuneDriftCard", "IaCDriftBanner"];

/** The cards a scenario renders, in canvas order. */
export function scenarioComponents(ctx: CorrelationContext): ComponentType[] {
  return SCENARIO_REGISTRY[ctx.scenarioId].components;
}

const worst = (...states: HealthState[]): HealthState => {
  const rank: Record<HealthState, number> = { healthy: 0, unknown: 1, warning: 2, critical: 3 };
  return states.reduce((a, b) => (rank[b] > rank[a] ? b : a), "healthy");
};

const short = (name: string) => name.replace("[ContextPane-Demo] ", "");

/* ----------------------------- License pool card ---------------------------- */

export function buildLicenseDriftCard(ctx: CorrelationContext): LicenseDriftCard | null {
  const inv = ctx.license?.data;
  if (!inv) return null;
  const drifted = inv.users.filter((u) => u.assignmentState === "Drifted");
  const orphaned = inv.users.filter((u) => u.assignmentState === "Orphaned");
  const failed = inv.users.filter((u) => u.assignmentState === "Error: CountViolation");
  const target = inv.skuPools.find((p) => p.skuPartNumber === inv.sku.skuPartNumber);
  let headline: string;
  if (failed.length || orphaned.length) {
    headline = `${inv.groupName}: ${failed.length ? `CountViolation for ${failed.length} members (${target?.consumed}/${target?.enabled} ${inv.sku.skuPartNumber})` : "no group errors"} · ${orphaned.length} seats held by disabled accounts`;
  } else if (drifted.length) {
    const legacy = [...new Set(drifted.map((u) => u.currentSku))].join("/");
    headline = `${drifted.length} users in ${inv.groupName} on ${legacy} instead of ${inv.sku.skuPartNumber} · ${target ? `${target.available} ${inv.sku.skuPartNumber} seats available` : "pool unknown"}`;
  } else {
    headline = `All ${inv.users.length} users in ${inv.groupName} hold their expected SKU · 0 group errors`;
  }
  return {
    headline: headline.slice(0, 200),
    skuName: inv.sku.skuName,
    skuPartNumber: inv.sku.skuPartNumber,
    groupName: inv.groupName,
    skuPools: inv.skuPools,
    groupErrors: inv.groupErrors,
    users: inv.users,
    state: failed.length || orphaned.length ? "critical" : drifted.length ? "warning" : "healthy",
  };
}

/* ------------------------ Sign-in & Conditional Access ---------------------- */

function signInEvent(e: SignInSummary, highlighted: boolean): SignInEvent {
  return {
    id: e.id,
    timestamp: e.timestamp,
    upn: e.upn,
    displayName: e.displayName,
    appDisplayName: e.appDisplayName,
    appId: e.appId,
    status: e.status,
    errorCode: e.errorCode,
    ...(e.errorCodeLabel ? { errorCodeLabel: e.errorCodeLabel } : {}),
    ...(e.failureReason ? { failureReason: e.failureReason } : {}),
    conditionalAccessStatus: e.conditionalAccessStatus,
    ...(e.blockingPolicyName ? { blockingPolicyName: e.blockingPolicyName } : {}),
    ...(e.blockingPolicyId ? { blockingPolicyId: e.blockingPolicyId } : {}),
    clientApp: e.clientApp,
    location: e.location,
    ipAddress: e.ipAddress,
    deviceName: e.deviceName,
    deviceCompliant: e.deviceCompliant,
    isHighlighted: highlighted,
  };
}

/** A ticket's Conditional Access policy as the inspector shows it, with what the staged fix turns it into. */
function inspectTicketPolicy(ctx: CorrelationContext, p: CaPolicySummary, blocked: number): CaPolicyInspector {
  const entitlement = ctx.license?.data.groupName;
  // INC-4092: the fix excludes the entitlement group from the legacy block and switches it to report-only.
  const neutralise = p.blocks && ctx.scenarioId === "INC-4092" && entitlement;
  const state = p.state === "enabled" || p.state === "disabled" ? p.state : "enabledForReportingButNotEnforced";
  return {
    id: p.id,
    displayName: p.displayName,
    state,
    role: blocked ? "blocking" : "in-scope",
    includeGroups: p.includeGroupNames.slice(0, 10),
    excludeGroups: p.excludeGroupNames.slice(0, 10),
    targetApps: p.targetApps.map((a) => a.displayName).slice(0, 10),
    clientAppTypes: [],
    grantControls: p.grant.builtInControls.map((c) => (c === "compliantDevice" ? "Require compliant device" : c === "block" ? "Block" : c)).slice(0, 6),
    drift: [],
    ...(neutralise ? { fixedState: "enabledForReportingButNotEnforced" as const, fixedExcludeGroups: [...new Set([...p.excludeGroupNames, entitlement])].slice(0, 10) } : {}),
    modifiedDateTime: p.modifiedDateTime,
  };
}

export function buildEntraSignInTimeline(ctx: CorrelationContext): EntraSignInTimeline | null {
  if (ctx.caPosture) return buildCaPostureTimeline(ctx);
  if (!ctx.signIns || !ctx.policies) return null;
  const focusUpn = ctx.erp.ticket?.requester.upn ?? "";
  const events = ctx.signIns.data;
  const failures = events.filter((e) => e.status === "failure");
  const focusFailure = failures.filter((e) => e.upn.toLowerCase() === focusUpn.toLowerCase()).at(-1) ?? failures.at(-1) ?? null;
  const translation = focusFailure ? lookupAadsts(focusFailure.errorCode) : null;
  const blockingPolicy = focusFailure?.blockingPolicyId ? ctx.policies.data.find((p) => p.id === focusFailure.blockingPolicyId || p.displayName === focusFailure.blockingPolicyName) : undefined;
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const blockedCount = (p: CaPolicySummary) => failures.filter((e) => e.blockingPolicyId === p.id || e.blockingPolicyName === p.displayName).length;

  const microActions: QuickAction[] = [];
  if (blockingPolicy) microActions.push({ id: "inspect-policy", label: "Inspect Policy", kind: "inspect-policy", targetEntityId: blockingPolicy.id, destructive: false });
  if (ctx.scenarioId === "INC-4092" && blockingPolicy) {
    microActions.push({ id: "generate-fix", label: "Stage CA Fix", kind: "generate-fix", description: `Exclude ${ctx.license?.data.groupName} and switch '${short(blockingPolicy.displayName)}' to report-only`, destructive: false });
  }

  const blocked = failures.filter((e) => blockingPolicy && (e.blockingPolicyId === blockingPolicy.id || e.blockingPolicyName === blockingPolicy.displayName)).length;
  const headline = focusFailure
    ? `${focusFailure.errorCodeLabel ?? focusFailure.errorCode} on ${focusFailure.appDisplayName}${blockingPolicy ? ` · Blocked by '${short(blockingPolicy.displayName)}'` : ""}${blocked > 1 ? ` · ${blocked} sign-ins` : ""}`
    : `No failing sign-ins in the window · ${ctx.policies.data.length} policies in scope`;
  return {
    headline: headline.slice(0, 200),
    focusUpn,
    windowStart: sorted[0]?.timestamp ?? ctx.gatheredAt,
    windowEnd: sorted.at(-1)?.timestamp ?? ctx.gatheredAt,
    events: sorted.map((e) => signInEvent(e, e.status === "failure" && (e.upn.toLowerCase() === focusUpn.toLowerCase() || e.id === focusFailure?.id))),
    rootCause: focusFailure
      ? {
          errorCodeLabel: focusFailure.errorCodeLabel ?? `AADSTS${focusFailure.errorCode}`,
          ...(focusFailure.blockingPolicyName ? { policyName: focusFailure.blockingPolicyName } : {}),
          targetApp: focusFailure.appDisplayName,
          explanation: translation
            ? `${translation.meaning} ${focusFailure.blockingPolicyName ? `Blocking policy: ${focusFailure.blockingPolicyName}.` : ""}`.trim().slice(0, 400)
            : (focusFailure.failureReason ?? "Sign-in failed").slice(0, 400),
        }
      : null,
    policies: ctx.policies.data.slice(0, 6).map((p) => inspectTicketPolicy(ctx, p, blockedCount(p))),
    microActions: microActions.slice(0, 6),
    state: focusFailure?.blockingPolicyName ? "critical" : failures.length ? "warning" : "healthy",
  };
}

function buildCaPostureTimeline(ctx: CorrelationContext): EntraSignInTimeline {
  const posture = ctx.caPosture!.data;
  const drifted = posture.policies.filter((p) => p.drift.length);
  const missingExclusion = drifted.find((p) => p.drift.some((d) => d.field.includes("excludeGroups")));
  const reportOnly = drifted.find((p) => p.drift.some((d) => d.field === "state"));
  const events = [...posture.legacySignIns].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const parts = [
    missingExclusion ? `Missing break-glass exclusion on ${short(missingExclusion.displayName).split("-Require")[0]}` : "",
    reportOnly ? `${short(reportOnly.displayName).split("-Block")[0]} Report-Only with ${events.length} legacy sign-ins (24 h)` : "",
  ].filter(Boolean);
  return {
    headline: (parts.join(" · ") || "Conditional Access matches the golden baseline").slice(0, 200),
    focusUpn: "",
    windowStart: events[0]?.timestamp ?? ctx.gatheredAt,
    windowEnd: events.at(-1)?.timestamp ?? ctx.gatheredAt,
    // The unfamiliar-ASN sign-ins are what makes the report-only drift urgent.
    events: events.map((e) => signInEvent(e, Boolean(reportOnly) && !e.location.endsWith(", CH"))),
    rootCause: null,
    policies: posture.policies,
    microActions: [
      ...(missingExclusion ? [{ id: "inspect-policy", label: "Inspect Policy", kind: "inspect-policy" as const, targetEntityId: missingExclusion.id, destructive: false }] : []),
      ...(drifted.length ? [{ id: "generate-fix", label: "Stage CA Fix", kind: "generate-fix" as const, description: "Restore the break-glass exclusion and enforce CA-004", destructive: false }] : []),
    ],
    state: missingExclusion ? "critical" : drifted.length ? "warning" : "healthy",
  };
}

/* ------------------------------- Intune card -------------------------------- */

export function buildIntuneDriftCard(ctx: CorrelationContext): IntuneDriftCard | null {
  const d = ctx.intune?.data;
  if (!d) return null;
  const drifted = d.settings.filter((s) => s.status === "drifted");
  const conflicts = d.settings.filter((s) => s.status === "conflict");
  let headline: string;
  if (d.resolved || (!drifted.length && !conflicts.length)) {
    headline = `In sync with the golden baseline · ${d.devices.length} devices compliant`;
  } else if (d.issueKind === "policy-conflict") {
    headline = `BitLocker ${d.errorCode ?? ""} · ${conflicts.length} conflicting settings with the legacy profile · ${d.affectedDeviceCount} devices NonCompliant`;
  } else {
    const asr = drifted.find((s) => s.settingName.startsWith("ASR"));
    headline = `${asr ? `ASR LSASS rule: ${asr.live} ≠ ${asr.golden}` : `${drifted.length} drifted settings`} · EnableFirewall conflict on ${d.affectedDeviceCount} devices`;
  }
  return {
    headline: headline.replace(/\s+/g, " ").slice(0, 200),
    issueKind: d.issueKind,
    ...(d.errorCode ? { errorCode: d.errorCode } : {}),
    ...(d.errorMeaning ? { errorMeaning: d.errorMeaning } : {}),
    goldenSource: d.goldenSource,
    policies: d.policies,
    settings: d.settings,
    devices: d.devices,
    affectedDeviceCount: d.affectedDeviceCount,
    comparedAgainst: ctx.intune!.source === "live-graph" ? "live-graph" : "fixture",
    state: d.resolved ? "healthy" : drifted.some((s) => s.severity === "critical") || d.affectedDeviceCount > 0 ? "critical" : "warning",
  };
}

/* ----------------------- Host pool, NSG & Azure Policy ---------------------- */

export function buildIaCDriftBanner(ctx: CorrelationContext): IaCDriftBanner | null {
  if (!ctx.drift) return null;
  const d = ctx.drift.data;
  return {
    resourceName: d.resourceName,
    resourceGroup: d.resourceGroup,
    resourceType: d.resourceType,
    resourceId: d.resourceId,
    location: d.location,
    gitBranch: d.gitBranch,
    terraformFile: d.terraformFile,
    driftState: d.driftState,
    tagDrift: d.tagDrift,
    rogueSecurityRules: d.rogueSecurityRules,
    missingSecurityRules: d.missingSecurityRules,
    hclDiff: d.hclDiff,
    summary: `State: ${d.summary}`,
    hostPool: ctx.avd?.data.hostPool ?? null,
    azurePolicies: ctx.avd?.data.azurePolicies ?? [],
    state: d.severity === "critical" ? "critical" : d.driftState === "drift-detected" ? "warning" : "healthy",
    comparedAgainst: ctx.drift.source === "live-azure" ? "live-azure" : "seeded-manifest",
  };
}

/* --------------------------------- layout --------------------------------- */

export function buildComponent(type: ComponentType, ctx: CorrelationContext): LayoutComponent | null {
  if (!isCanvasComponentType(type)) return null;
  const id = `${type.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase())}-${ctx.scenarioId.toLowerCase()}`;
  const trigger = triggeredBy(ctx, type);
  switch (type) {
    case "LicenseDriftCard": {
      const props = buildLicenseDriftCard(ctx);
      return props ? { type, id, triggeredBy: trigger, props } : null;
    }
    case "EntraSignInTimeline": {
      const props = buildEntraSignInTimeline(ctx);
      return props ? { type, id, triggeredBy: trigger, props } : null;
    }
    case "IntuneDriftCard": {
      const props = buildIntuneDriftCard(ctx);
      return props ? { type, id, triggeredBy: trigger, props } : null;
    }
    case "IaCDriftBanner": {
      const props = buildIaCDriftBanner(ctx);
      return props ? { type, id, triggeredBy: trigger, props } : null;
    }
  }
}

export function buildLayout(ctx: CorrelationContext, provenance: Provenance, options: { components?: ComponentType[]; recipeId?: string | null; layoutId?: string } = {}): Layout {
  const types = options.components ?? scenarioComponents(ctx);
  const components = types
    .map((t) => buildComponent(t, ctx))
    .filter((c): c is LayoutComponent => c !== null)
    .map((c) => LayoutComponentSchema.parse(c));
  return {
    layoutId: options.layoutId ?? `layout-${ctx.scenarioId.toLowerCase()}-${Date.now().toString(36)}`,
    tenantId: ctx.tenantId,
    ticketId: ctx.scenarioId,
    components,
    generatedAt: new Date().toISOString(),
    recipeId: options.recipeId ?? null,
    provenance,
  };
}

export function overallHealth(layout: Layout): HealthState {
  return worst(
    ...layout.components.map((c) => {
      switch (c.type) {
        case "LicenseDriftCard":
        case "EntraSignInTimeline":
        case "IntuneDriftCard":
        case "IaCDriftBanner":
          return c.props.state;
        case "HoverDiagnosticPopover":
          return c.props.status;
        default:
          return "unknown" as HealthState;
      }
    }),
  );
}
