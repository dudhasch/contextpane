import type { IacResult, NsgDrift } from "@contextpane/mcp-azure-iac";
import type { ErpTenantContext } from "@contextpane/mcp-erp";
import type { CaPolicySummary, GraphResult, LicenseState, SignInSummary } from "@contextpane/mcp-msgraph";
import { sources, type McpDataSources } from "./clients.ts";

/**
 * Everything the tiers need about a tenant, gathered from the three MCP
 * servers in parallel. Stale-while-revalidate: fresh for 30 s, then served
 * from memory for up to 10 min while one background refresh replaces it, so
 * hover → correlate → remediate never wait on Graph or ARM twice.
 */
export interface CorrelationContext {
  tenantId: string;
  ticketId: string;
  erp: ErpTenantContext;
  license: GraphResult<LicenseState>;
  policies: GraphResult<CaPolicySummary[]>;
  signIns: GraphResult<SignInSummary[]>;
  drift: IacResult<NsgDrift>;
  gatheredAt: string;
  gatherLatencyMs: number;
  transport: McpDataSources["transport"];
  sourcesUsed: { msgraph: GraphResult<unknown>["source"]; azure: IacResult<unknown>["source"] };
}

const FRESH_MS = 30_000;
const STALE_MAX_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<CorrelationContext>; revalidating: boolean }>();

export function invalidateContext(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function gatherContext(tenantId: string, options: { fresh?: boolean } = {}): Promise<CorrelationContext> {
  const hit = cache.get(tenantId);
  if (!options.fresh && hit) {
    const age = Date.now() - hit.at;
    if (age < FRESH_MS) return hit.value;
    if (age < STALE_MAX_MS) {
      if (!hit.revalidating) {
        hit.revalidating = true;
        const next = load(tenantId);
        // Swap in only a successful refresh; a failed one keeps serving the stale context.
        next.then(() => cache.set(tenantId, { at: Date.now(), value: next, revalidating: false })).catch(() => (hit.revalidating = false));
      }
      return hit.value;
    }
  }
  const value = load(tenantId);
  cache.set(tenantId, { at: Date.now(), value, revalidating: false });
  value.catch(() => cache.delete(tenantId));
  return value;
}

function load(tenantId: string): Promise<CorrelationContext> {
  return (async () => {
    const started = performance.now();
    const [erp, license, policies, signIns, drift] = await Promise.all([
      sources.erp.getTenantContext(tenantId),
      sources.msgraph.getLicenseState(tenantId),
      sources.msgraph.getConditionalAccessPolicies(tenantId),
      sources.msgraph.getSignInEvents(tenantId, { top: 50 }),
      sources.azure.getNsgDrift(tenantId),
    ]);
    return {
      tenantId,
      ticketId: erp.ticket.ticketId,
      erp,
      license,
      policies,
      signIns,
      drift,
      gatheredAt: new Date().toISOString(),
      gatherLatencyMs: Math.round(performance.now() - started),
      transport: sources.transport,
      sourcesUsed: { msgraph: license.source, azure: drift.source },
    } satisfies CorrelationContext;
  })();
}

/**
 * Compact, model-facing view of the context. Strips rendered HCL bodies and
 * redundant envelopes so the prompt stays small enough for a 30B model.
 */
export function contextForModel(ctx: CorrelationContext) {
  const { ticket, contract, tenant } = ctx.erp;
  return {
    tenant: {
      tenantId: ctx.tenantId,
      displayName: tenant.displayName,
      entraTenantId: tenant.entraTenantId,
      verifiedDomain: tenant.verifiedDomain,
      slaTier: tenant.slaTier,
    },
    ticket: {
      ticketId: ticket.ticketId,
      title: ticket.title,
      severity: ticket.severity,
      status: ticket.status,
      slaBreachAt: ticket.slaBreachAt,
      description: ticket.description,
      affectedUpns: ticket.affectedUpns,
      affectedGroups: ticket.affectedGroups,
    },
    contract: {
      contractId: contract.contractId,
      slaTier: contract.slaTier,
      lines: contract.lines.map((l) => ({
        description: l.description,
        skuPartNumber: l.skuPartNumber,
        skuName: l.skuName,
        quantity: l.quantity,
        unitPriceUsd: l.unitPriceUsd,
        entitlementGroup: l.entitlementGroup,
      })),
    },
    entraLicenseState: {
      source: ctx.license.source,
      sku: ctx.license.data.sku,
      group: ctx.license.data.group,
      entraAssignedCount: ctx.license.data.entraAssignedCount,
      users: ctx.license.data.users.map((u) => ({
        upn: u.upn,
        displayName: u.displayName,
        jobTitle: u.jobTitle,
        currentSku: u.currentSku,
        expectedSku: u.expectedSku,
        driftStatus: u.driftStatus,
      })),
    },
    conditionalAccessPolicies: ctx.policies.data.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      state: p.state,
      includeGroupNames: p.includeGroupNames,
      excludeGroupNames: p.excludeGroupNames,
      targetApps: p.targetApps,
      grant: p.grant,
      blocks: p.blocks,
    })),
    signInEvents: ctx.signIns.data.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      upn: e.upn,
      displayName: e.displayName,
      appDisplayName: e.appDisplayName,
      appId: e.appId,
      status: e.status,
      errorCode: e.errorCode,
      errorCodeLabel: e.errorCodeLabel,
      failureReason: e.failureReason,
      conditionalAccessStatus: e.conditionalAccessStatus,
      blockingPolicyName: e.blockingPolicyName,
      blockingPolicyId: e.blockingPolicyId,
      clientApp: e.clientApp,
      location: e.location,
      ipAddress: e.ipAddress,
      deviceName: e.deviceName,
      deviceCompliant: e.deviceCompliant,
    })),
    azureNsgDrift: {
      source: ctx.drift.source,
      resourceName: ctx.drift.data.resourceName,
      resourceGroup: ctx.drift.data.resourceGroup,
      resourceId: ctx.drift.data.resourceId,
      location: ctx.drift.data.location,
      gitBranch: ctx.drift.data.gitBranch,
      terraformFile: ctx.drift.data.terraformFile,
      driftState: ctx.drift.data.driftState,
      tagDrift: ctx.drift.data.tagDrift,
      rogueSecurityRules: ctx.drift.data.rogueSecurityRules,
      missingSecurityRules: ctx.drift.data.missingSecurityRules,
      summary: ctx.drift.data.summary,
      hclDiff: ctx.drift.data.hclDiff,
    },
  };
}
