import {
  SCENARIO_REGISTRY,
  isScenarioId,
  scenarioForTenant,
  type ScenarioId,
  type ScenarioKind,
  type TenantId,
} from "@contextpane/catalog";
import type { AvdEstate, IacResult, NsgDrift } from "@contextpane/mcp-azure-iac";
import type { ErpContract, ErpTenant, ErpTicket } from "@contextpane/mcp-erp";
import type { CaPolicySummary, CaPosture, GraphResult, IntuneDrift, LicenseInventory, SignInSummary, WorkloadIdentityFixture } from "@contextpane/mcp-msgraph";
import { CA_POSTURE, LICENSE_ANOMALY, WORKLOAD_IDENTITY, getManifestTenant } from "@contextpane/mcp-msgraph";
import type { DatasetDescriptor } from "@contextpane/catalog";
import { sources, type McpDataSources } from "./clients.ts";

/**
 * Everything the tiers need about one scenario (a ticket or a tenant anomaly),
 * gathered from the three MCP servers in parallel. Only the sources the
 * scenario's cards use are queried. Stale-while-revalidate: fresh for 30 s, then
 * served from memory for up to 10 min while one background refresh replaces it,
 * so hover → correlate → remediate never wait on Graph or ARM twice.
 */
export interface CorrelationContext {
  scenarioId: ScenarioId;
  kind: ScenarioKind;
  tenantId: TenantId;
  /** Scenario id under its historic name: ERP ticket (INC-4092) or anomaly (ANOM-LIC-101). */
  ticketId: string;
  erp: { tenant: ErpTenant; contract: ErpContract; ticket: ErpTicket | null };
  license: GraphResult<LicenseInventory> | null;
  policies: GraphResult<CaPolicySummary[]> | null;
  signIns: GraphResult<SignInSummary[]> | null;
  caPosture: GraphResult<CaPosture> | null;
  intune: GraphResult<IntuneDrift> | null;
  /** ANOM-APP-401 workload identity fixture; null for every other scenario. */
  workloadIdentity: WorkloadIdentityFixture | null;
  drift: IacResult<NsgDrift> | null;
  avd: IacResult<AvdEstate> | null;
  /** Entra security groups per UPN (lower-cased), for the user hover. */
  groupsByUpn: Map<string, string[]>;
  gatheredAt: string;
  gatherLatencyMs: number;
  transport: McpDataSources["transport"];
  /** live-graph / live-azure / seeded-manifest per source the scenario used. */
  sourcesUsed: Record<string, string>;
  fallbackReasons: string[];
}

const FRESH_MS = 30_000;
const STALE_MAX_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<CorrelationContext>; revalidating: boolean }>();

/** Accepts a scenario id, or a tenant id (its ticket scenario), for older callers. */
export function resolveScenarioId(value: string | undefined | null): ScenarioId {
  if (isScenarioId(value)) return value;
  return scenarioForTenant(value ?? "tenant-contoso-01");
}

/** Drops the cached context of one scenario, every scenario of a tenant, or everything. */
export function invalidateContext(key?: string) {
  if (!key) return cache.clear();
  if (isScenarioId(key)) return void cache.delete(key);
  for (const id of cache.keys()) if (isScenarioId(id) && SCENARIO_REGISTRY[id].tenantId === key) cache.delete(id);
}

export async function gatherContext(scenarioOrTenant: string, options: { fresh?: boolean } = {}): Promise<CorrelationContext> {
  const scenarioId = resolveScenarioId(scenarioOrTenant);
  const hit = cache.get(scenarioId);
  if (!options.fresh && hit) {
    const age = Date.now() - hit.at;
    if (age < FRESH_MS) return hit.value;
    if (age < STALE_MAX_MS) {
      if (!hit.revalidating) {
        hit.revalidating = true;
        const next = load(scenarioId);
        // Swap in only a successful refresh; a failed one keeps serving the stale context.
        next.then(() => cache.set(scenarioId, { at: Date.now(), value: next, revalidating: false })).catch(() => (hit.revalidating = false));
      }
      return hit.value;
    }
  }
  const value = load(scenarioId);
  cache.set(scenarioId, { at: Date.now(), value, revalidating: false });
  value.catch(() => cache.delete(scenarioId));
  return value;
}

const none = Promise.resolve(null);

function load(scenarioId: ScenarioId): Promise<CorrelationContext> {
  return (async () => {
    const started = performance.now();
    const entry = SCENARIO_REGISTRY[scenarioId];
    const tenantId = entry.tenantId;
    const cards = new Set(entry.components);
    const ticketScenario = entry.kind === "ticket";
    const [erp, license, policies, signIns, caPosture, intune, drift, avd] = await Promise.all([
      sources.erp.getTenantContext(tenantId),
      // Ticket scenarios read licenses for the user hover even when they show no license card.
      cards.has("LicenseDriftCard") || ticketScenario ? sources.msgraph.getLicenseInventory(tenantId, scenarioId) : none,
      ticketScenario ? sources.msgraph.getConditionalAccessPolicies(tenantId) : none,
      ticketScenario ? sources.msgraph.getSignInEvents(tenantId, { top: 50 }) : none,
      scenarioId === "ANOM-CA-204" ? sources.msgraph.getCaPosture(tenantId) : none,
      scenarioId === "ANOM-INT-309" || scenarioId === "INC-4099" ? sources.msgraph.getIntuneDrift(scenarioId) : none,
      cards.has("IaCDriftBanner") ? sources.azure.getNsgDrift(tenantId) : none,
      cards.has("IaCDriftBanner") ? sources.azure.getAvdEstate(tenantId) : none,
    ]);
    const used: Record<string, { source: string; fallbackReason?: string } | null> = { license, policies, signIns, caPosture, intune, drift, avd };
    return {
      scenarioId,
      kind: entry.kind,
      tenantId,
      ticketId: scenarioId,
      erp: { tenant: erp.tenant, contract: erp.contract, ticket: ticketScenario ? erp.ticket : null },
      license,
      policies,
      signIns,
      caPosture,
      intune,
      workloadIdentity: scenarioId === "ANOM-APP-401" ? WORKLOAD_IDENTITY : null,
      drift,
      avd,
      groupsByUpn: groupsByUpn(scenarioId, tenantId),
      gatheredAt: new Date().toISOString(),
      gatherLatencyMs: Math.round(performance.now() - started),
      transport: sources.transport,
      sourcesUsed: {
        ...Object.fromEntries(Object.entries(used).filter(([, r]) => r).map(([k, r]) => [k, r!.source])),
        ...(scenarioId === "ANOM-APP-401" ? { workloadIdentity: "fixture" } : {}),
      },
      fallbackReasons: Object.values(used).flatMap((r) => (r?.fallbackReason ? [r.fallbackReason] : [])),
    } satisfies CorrelationContext;
  })();
}

function groupsByUpn(scenarioId: ScenarioId, tenantId: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (upn: string, group: string) => {
    const key = upn.toLowerCase();
    map.set(key, [...new Set([...(map.get(key) ?? []), group])]);
  };
  for (const g of getManifestTenant(tenantId).groups) for (const upn of g.memberUpns) add(upn, g.displayName);
  if (scenarioId === "ANOM-LIC-101") for (const u of LICENSE_ANOMALY.users) add(u.upn, LICENSE_ANOMALY.groupName);
  if (scenarioId === "ANOM-CA-204") {
    add(CA_POSTURE.breakGlassAccount, CA_POSTURE.breakGlassGroup);
    add(CA_POSTURE.breakGlassAccount, CA_POSTURE.adminGroup);
  }
  if (scenarioId === "ANOM-APP-401") {
    add(WORKLOAD_IDENTITY.owner.upn, `${WORKLOAD_IDENTITY.spn.displayName} owners`);
  }
  return map;
}

/**
 * Compact, model-facing view of the context. Strips rendered HCL bodies and
 * redundant envelopes so the prompt stays small enough for a 30B model.
 */
export function contextForModel(ctx: CorrelationContext) {
  const { ticket, contract, tenant } = ctx.erp;
  return {
    scenario: { scenarioId: ctx.scenarioId, kind: ctx.kind, title: SCENARIO_REGISTRY[ctx.scenarioId].title, cards: SCENARIO_REGISTRY[ctx.scenarioId].components },
    tenant: { tenantId: ctx.tenantId, displayName: tenant.displayName, entraTenantId: tenant.entraTenantId, verifiedDomain: tenant.verifiedDomain },
    ...(ticket
      ? {
          ticket: {
            ticketId: ticket.ticketId,
            title: ticket.title,
            status: ticket.status,
            description: ticket.description,
            affectedUpns: ticket.affectedUpns,
            affectedGroups: ticket.affectedGroups,
          },
          contract: { contractId: contract.contractId, lines: contract.lines.map((l) => ({ description: l.description, skuPartNumber: l.skuPartNumber, quantity: l.quantity, entitlementGroup: l.entitlementGroup })) },
        }
      : {}),
    ...(ctx.license
      ? {
          licensing: {
            source: ctx.license.source,
            sku: ctx.license.data.sku,
            group: ctx.license.data.groupName,
            skuPools: ctx.license.data.skuPools,
            groupErrors: ctx.license.data.groupErrors,
            users: ctx.license.data.users.map((u) => ({ upn: u.upn, displayName: u.displayName, accountEnabled: u.accountEnabled, currentSku: u.currentSku, expectedSku: u.expectedSku, assignmentPath: u.assignmentPath, assignmentState: u.assignmentState })),
          },
        }
      : {}),
    ...(ctx.policies
      ? {
          conditionalAccessPolicies: ctx.policies.data.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            state: p.state,
            includeGroupNames: p.includeGroupNames,
            excludeGroupNames: p.excludeGroupNames,
            targetApps: p.targetApps.map((a) => a.displayName),
            grant: p.grant,
          })),
        }
      : {}),
    ...(ctx.signIns
      ? {
          signInEvents: ctx.signIns.data.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            upn: e.upn,
            appDisplayName: e.appDisplayName,
            status: e.status,
            errorCodeLabel: e.errorCodeLabel,
            blockingPolicyName: e.blockingPolicyName,
            deviceName: e.deviceName,
            deviceCompliant: e.deviceCompliant,
          })),
        }
      : {}),
    ...(ctx.caPosture
      ? {
          conditionalAccessPosture: {
            source: ctx.caPosture.source,
            policies: ctx.caPosture.data.policies.map((p) => ({ displayName: p.displayName, state: p.state, includeGroups: p.includeGroups, excludeGroups: p.excludeGroups, drift: p.drift })),
            breakGlassGroup: ctx.caPosture.data.breakGlassGroup,
            legacySignIns24h: ctx.caPosture.data.legacySignIns.length,
            auditEvents: ctx.caPosture.data.auditEvents,
          },
        }
      : {}),
    ...(ctx.intune
      ? {
          intuneDrift: {
            source: ctx.intune.source,
            errorCode: ctx.intune.data.errorCode,
            policies: ctx.intune.data.policies.map((p) => ({ name: p.name, kind: p.kind, assignedTo: p.assignedTo, role: p.role })),
            settings: ctx.intune.data.settings,
            affectedDeviceCount: ctx.intune.data.affectedDeviceCount,
          },
        }
      : {}),
    ...(ctx.workloadIdentity
      ? {
          workloadIdentity: {
            source: "fixture",
            spn: ctx.workloadIdentity.spn,
            owner: ctx.workloadIdentity.owner,
            passwordCredential: ctx.workloadIdentity.passwordCredential,
            errorCodeLabel: ctx.workloadIdentity.errorCodeLabel,
            appPermissions: ctx.workloadIdentity.appPermissions,
            oauth2PermissionGrant: ctx.workloadIdentity.oauth2PermissionGrant,
            activity: ctx.workloadIdentity.activity,
            requiredPermissions: ctx.workloadIdentity.requiredPermissions,
            federatedCredential: ctx.workloadIdentity.federatedCredential,
          },
        }
      : {}),
    ...(ctx.drift
      ? {
          azureNsgDrift: {
            source: ctx.drift.source,
            resourceName: ctx.drift.data.resourceName,
            resourceGroup: ctx.drift.data.resourceGroup,
            terraformFile: ctx.drift.data.terraformFile,
            driftState: ctx.drift.data.driftState,
            tagDrift: ctx.drift.data.tagDrift,
            rogueSecurityRules: ctx.drift.data.rogueSecurityRules,
            summary: ctx.drift.data.summary,
          },
          azurePolicies: ctx.avd?.data.azurePolicies.map((p) => ({ name: p.name, compliance: p.compliance })),
        }
      : {}),
  };
}

/**
 * What Tier 1B / Tier 2 see under the ptr:// data-plane bypass: the scenario, the ticket
 * text, one scalar fact sheet per source, and a schema-and-aggregate descriptor per
 * dataset. No multi-row array reaches the prompt; the model answers with { dataPtr } and
 * the data plane binds the rows (see local/dataplane.ts). Tier 3 keeps contextForModel,
 * since its PowerShell has to name the users and policies it changes.
 */
export function contextForCorrelation(ctx: CorrelationContext, datasets: DatasetDescriptor[]) {
  const { ticket, contract, tenant } = ctx.erp;
  return {
    scenario: { scenarioId: ctx.scenarioId, kind: ctx.kind, title: SCENARIO_REGISTRY[ctx.scenarioId].title, cards: SCENARIO_REGISTRY[ctx.scenarioId].components },
    tenant: { tenantId: ctx.tenantId, displayName: tenant.displayName, verifiedDomain: tenant.verifiedDomain },
    ...(ticket
      ? {
          ticket: { ticketId: ticket.ticketId, title: ticket.title, status: ticket.status, description: ticket.description, requesterUpn: ticket.requester.upn },
          contract: {
            contractId: contract.contractId,
            entitlements: contract.lines.map((l) => `${l.quantity} × ${l.skuPartNumber}${l.entitlementGroup ? ` via ${l.entitlementGroup}` : ""}`).join("; "),
          },
        }
      : {}),
    facts: {
      ...(ctx.license ? { licensing: { source: ctx.license.source, sku: ctx.license.data.sku.skuPartNumber, skuName: ctx.license.data.sku.skuName, group: ctx.license.data.groupName } } : {}),
      ...(ctx.caPosture
        ? { conditionalAccess: { source: ctx.caPosture.source, breakGlassGroup: ctx.caPosture.data.breakGlassGroup, goldenSource: ctx.caPosture.data.goldenSource, legacySignIns24h: ctx.caPosture.data.legacySignIns.length } }
        : {}),
      ...(ctx.intune
        ? { intune: { source: ctx.intune.source, issueKind: ctx.intune.data.issueKind, errorCode: ctx.intune.data.errorCode ?? null, goldenSource: ctx.intune.data.goldenSource, affectedDeviceCount: ctx.intune.data.affectedDeviceCount, resolved: ctx.intune.data.resolved } }
        : {}),
      ...(ctx.workloadIdentity
        ? {
            workloadIdentity: {
              source: "fixture",
              spn: ctx.workloadIdentity.spn.displayName,
              appId: ctx.workloadIdentity.spn.appId,
              owner: ctx.workloadIdentity.owner.upn,
              errorCodeLabel: ctx.workloadIdentity.errorCodeLabel,
              secretExpired: ctx.workloadIdentity.passwordCredential.expired,
              goldenSource: ctx.workloadIdentity.goldenSource,
            },
          }
        : {}),
      ...(ctx.drift
        ? {
            azure: {
              source: ctx.drift.source,
              resourceName: ctx.drift.data.resourceName,
              resourceGroup: ctx.drift.data.resourceGroup,
              terraformFile: ctx.drift.data.terraformFile,
              gitBranch: ctx.drift.data.gitBranch,
              driftState: ctx.drift.data.driftState,
              summary: ctx.drift.data.summary,
            },
          }
        : {}),
    },
    datasets,
  };
}
