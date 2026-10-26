import {
  LayoutComponentSchema,
  lookupAadsts,
  type ComponentType,
  type EntraSignInTimeline,
  type HealthState,
  type IaCDriftBanner,
  type Layout,
  type LayoutComponent,
  type LicenseDriftCard,
  type Provenance,
  type ProviderTelemetry,
  type QuickAction,
  type TenantSummaryHeader,
} from "@contextpane/catalog";
import type { CorrelationContext } from "../mcp/context.ts";

/**
 * Deterministic AST hydration. This is both the Tier 0 engine (recipes) and the
 * repair path for every LLM tier: any component the model omits or emits
 * invalidly is rebuilt here from the same MCP context.
 */

export const DEFAULT_COMPONENT_ORDER: ComponentType[] = ["TenantSummaryHeader", "LicenseDriftCard", "EntraSignInTimeline", "IaCDriftBanner"];

const worst = (...states: HealthState[]): HealthState => {
  const rank: Record<HealthState, number> = { healthy: 0, unknown: 1, warning: 2, critical: 3 };
  return states.reduce((a, b) => (rank[b] > rank[a] ? b : a), "healthy");
};

function slaBadge(breachAtIso: string, severity: string, now = Date.now()): string {
  const ms = new Date(breachAtIso).getTime() - now;
  if (!Number.isFinite(ms)) return severity;
  if (ms <= 0) return `${severity} · SLA BREACHED`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${severity} · Breach in ${h}h ${m.toString().padStart(2, "0")}m`;
}

/* ----------------------------- component builders -------------------------- */

export function buildTenantSummaryHeader(ctx: CorrelationContext, telemetry: ProviderTelemetry): TenantSummaryHeader {
  const { tenant, ticket, contract } = ctx.erp;
  const licenses: HealthState = ctx.license.data.driftedUsers.length > 0 ? "warning" : "healthy";
  const identity: HealthState = ctx.signIns.data.some((e) => e.status === "failure" && e.blockingPolicyName) ? "critical" : ctx.signIns.data.some((e) => e.status === "failure") ? "warning" : "healthy";
  const infrastructure: HealthState =
    ctx.drift.data.severity === "critical" ? "critical" : ctx.drift.data.driftState === "drift-detected" ? "warning" : "healthy";
  return {
    tenantName: tenant.displayName,
    tenantId: tenant.entraTenantId,
    verifiedDomain: tenant.verifiedDomain,
    erpContractId: contract.contractId,
    slaTier: contract.slaTier,
    activeEscalation:
      ticket.status === "Resolved"
        ? null
        : {
            ticketId: ticket.ticketId,
            severity: ticket.severity,
            title: ticket.title,
            badge: slaBadge(ticket.slaBreachAt, ticket.severity),
            slaBreachAt: ticket.slaBreachAt,
          },
    healthSummary: { licenses, identity, infrastructure },
    providerTelemetry: telemetry,
  };
}

export function buildLicenseDriftCard(ctx: CorrelationContext): LicenseDriftCard {
  const lic = ctx.license.data;
  const line = ctx.erp.contract.lines.find((l) => l.skuPartNumber === lic.sku.skuPartNumber) ?? ctx.erp.contract.lines[0];
  const erpBilledCount = line?.quantity ?? 0;
  const driftedCount = Math.max(0, erpBilledCount - lic.entraAssignedCount);
  const unit = line?.unitPriceUsd;
  return {
    skuName: lic.sku.skuName,
    skuPartNumber: lic.sku.skuPartNumber,
    groupName: lic.group.displayName,
    contractId: ctx.erp.contract.contractId,
    erpBilledCount,
    entraAssignedCount: lic.entraAssignedCount,
    driftedCount,
    ...(unit !== undefined ? { monthlyUnitPriceUsd: unit, burnRateDeltaUsdPerMonth: Math.round(driftedCount * unit * 100) / 100 } : {}),
    users: lic.users.map((u) => ({
      upn: u.upn,
      displayName: u.displayName,
      jobTitle: u.jobTitle,
      currentSku: u.currentSku,
      expectedSku: u.expectedSku,
      driftStatus: u.driftStatus,
      objectId: u.objectId,
    })),
    state: driftedCount > 0 || lic.driftedUsers.length > 0 ? "warning" : "healthy",
  };
}

export function buildEntraSignInTimeline(ctx: CorrelationContext): EntraSignInTimeline {
  const focusUpn = ctx.erp.ticket.requester.upn;
  const events = ctx.signIns.data;
  const failures = events.filter((e) => e.status === "failure");
  const focusFailure = failures.find((e) => e.upn.toLowerCase() === focusUpn.toLowerCase()) ?? failures[0] ?? null;
  const translation = focusFailure ? lookupAadsts(focusFailure.errorCode) : null;
  const blockingPolicy = focusFailure?.blockingPolicyName
    ? ctx.policies.data.find((p) => p.displayName === focusFailure.blockingPolicyName)
    : undefined;
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const microActions: QuickAction[] = [];
  if (focusFailure) {
    microActions.push({
      id: "issue-tap",
      label: "Issue TAP",
      kind: "issue-tap",
      description: `Temporary Access Pass for ${focusFailure.upn}`,
      targetEntityId: focusFailure.upn,
      destructive: false,
    });
  }
  if (blockingPolicy) {
    microActions.push({
      id: "exclude-group-report-only",
      label: "Exclude Group in Report-Only",
      kind: "exclude-group-report-only",
      description: `Exclude ${ctx.license.data.group.displayName} and switch '${blockingPolicy.displayName}' to report-only`,
      targetEntityId: blockingPolicy.id,
      destructive: false,
    });
    microActions.push({
      id: "inspect-policy",
      label: "Inspect CA Policy",
      kind: "inspect-policy",
      targetEntityId: blockingPolicy.id,
      destructive: false,
    });
  }

  return {
    focusUpn,
    windowStart: sorted[0]?.timestamp ?? ctx.gatheredAt,
    windowEnd: sorted.at(-1)?.timestamp ?? ctx.gatheredAt,
    events: sorted.map((e) => ({
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
      isHighlighted: e.status === "failure" && e.upn.toLowerCase() === focusUpn.toLowerCase(),
    })),
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
    microActions: microActions.slice(0, 6),
    state: focusFailure?.blockingPolicyName ? "critical" : failures.length ? "warning" : "healthy",
  };
}

export function buildIaCDriftBanner(ctx: CorrelationContext): IaCDriftBanner {
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
    state: d.severity === "critical" ? "critical" : d.driftState === "drift-detected" ? "warning" : "healthy",
    comparedAgainst: ctx.drift.source === "live-azure" ? "live-azure" : "seeded-manifest",
  };
}

/* --------------------------------- layout --------------------------------- */

export function buildComponent(type: ComponentType, ctx: CorrelationContext, telemetry: ProviderTelemetry): LayoutComponent | null {
  const id = `${type.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase())}-${ctx.tenantId}`;
  switch (type) {
    case "TenantSummaryHeader":
      return { type, id, props: buildTenantSummaryHeader(ctx, telemetry) };
    case "LicenseDriftCard":
      return { type, id, props: buildLicenseDriftCard(ctx) };
    case "EntraSignInTimeline":
      return { type, id, props: buildEntraSignInTimeline(ctx) };
    case "IaCDriftBanner":
      return { type, id, props: buildIaCDriftBanner(ctx) };
    default:
      // HoverDiagnosticPopover and ActionApprovalDrawer are produced by their own tiers, never pinned.
      return null;
  }
}

export function buildLayout(
  ctx: CorrelationContext,
  provenance: Provenance,
  options: { components?: ComponentType[]; recipeId?: string | null; layoutId?: string } = {},
): Layout {
  const telemetry: ProviderTelemetry = {
    tier: provenance.tier,
    provider: provenance.provider,
    modelId: provenance.modelId,
    latencyMs: provenance.latencyMs,
    tokensUsed: provenance.tokensUsed,
  };
  const types = options.components ?? DEFAULT_COMPONENT_ORDER;
  const components = types
    .map((t) => buildComponent(t, ctx, telemetry))
    .filter((c): c is LayoutComponent => c !== null)
    .map((c) => LayoutComponentSchema.parse(c));
  return {
    layoutId: options.layoutId ?? `layout-${ctx.tenantId}-${Date.now().toString(36)}`,
    tenantId: ctx.tenantId,
    ticketId: ctx.ticketId,
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
        case "TenantSummaryHeader":
          return worst(c.props.healthSummary.licenses, c.props.healthSummary.identity, c.props.healthSummary.infrastructure);
        case "LicenseDriftCard":
        case "EntraSignInTimeline":
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
