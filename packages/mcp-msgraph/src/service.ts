import { KNOWN_APP_IDS, lookupAadsts, toAadstsLabel } from "@contextpane/catalog";
import {
  fetchConditionalAccessPoliciesLive,
  fetchGraphContextLive,
  fetchGroupMembersLive,
  fetchSignInEventsLive,
  fetchSubscribedSkusLive,
} from "./live.ts";
import { getManifestTenant, type ManifestCaPolicy, type ManifestSignIn, type ManifestTenant, type ManifestUser } from "./manifest.ts";
import { isLiveCloudMode, isPwshAvailable } from "./pwsh.ts";

/* -------------------------------------------------------------------------- */
/* Result envelope                                                             */
/* -------------------------------------------------------------------------- */

export type GraphSource = "live-graph" | "seeded-manifest";

export interface GraphResult<T> {
  source: GraphSource;
  liveCloudMode: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  latencyMs: number;
  data: T;
}

/** Only the Contoso lab tenant exists in the real Graph tenant. */
const LIVE_CAPABLE_TENANTS = new Set(["tenant-contoso-01"]);
const DEMO_POLICY_PREFIX = "[ContextPane-Demo]";
const LIVE_TIMEOUT_MS = Number.parseInt(process.env.CTX_GRAPH_TIMEOUT_MS ?? "25000", 10);
/**
 * auditLogs/signIns filtered by UPN takes 40-60 s on a tenant with a large sign-in log,
 * and the lab users never sign in, so the seeded timeline is the expected outcome.
 * A short budget keeps a live context gather at ~10 s instead of waiting out LIVE_TIMEOUT_MS.
 */
const SIGNIN_TIMEOUT_MS = Number.parseInt(process.env.CTX_GRAPH_SIGNIN_TIMEOUT_MS ?? "6000", 10);

async function withSource<T>(
  tenantId: string,
  live: () => Promise<T>,
  fallback: () => T,
): Promise<GraphResult<T>> {
  const started = performance.now();
  const liveMode = isLiveCloudMode();
  const done = (data: T, source: GraphSource, fallbackReason?: string): GraphResult<T> => ({
    source,
    liveCloudMode: liveMode,
    ...(fallbackReason ? { fallbackReason } : {}),
    fetchedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    data,
  });

  if (!liveMode) return done(fallback(), "seeded-manifest");
  if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return done(fallback(), "seeded-manifest", `${tenantId} is manifest-only`);
  if (!(await isPwshAvailable())) return done(fallback(), "seeded-manifest", "pwsh 7 not available");
  try {
    return done(await live(), "live-graph");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[mcp-msgraph] live query failed for ${tenantId}, falling back to manifest: ${reason}`);
    return done(fallback(), "seeded-manifest", reason);
  }
}

/* -------------------------------------------------------------------------- */
/* Shapes returned to the orchestrator                                         */
/* -------------------------------------------------------------------------- */

export interface LicenseUserState {
  objectId: string;
  upn: string;
  displayName: string;
  jobTitle: string;
  department: string;
  currentSku: string;
  expectedSku: string;
  driftStatus: "compliant" | "drifted" | "unassigned";
  extensionPresent: boolean;
}

export interface LicenseState {
  tenantId: string;
  entraTenantId: string;
  sku: { skuPartNumber: string; skuName: string; skuId: string; legacySkuPartNumber: string };
  group: { displayName: string; objectId: string };
  entraAssignedCount: number;
  users: LicenseUserState[];
  driftedUsers: LicenseUserState[];
}

export interface CaPolicySummary {
  id: string;
  displayName: string;
  state: string;
  includeGroupNames: string[];
  includeGroupIds: string[];
  excludeGroupNames: string[];
  excludeGroupIds: string[];
  targetApps: Array<{ appId: string; displayName: string }>;
  grant: { operator: string; builtInControls: string[] };
  blocks: boolean;
  modifiedDateTime: string | null;
}

export interface SignInSummary {
  id: string;
  timestamp: string;
  upn: string;
  displayName: string;
  appId: string;
  appDisplayName: string;
  status: "success" | "failure" | "interrupted";
  errorCode: number;
  errorCodeLabel?: string;
  failureReason?: string;
  conditionalAccessStatus: "success" | "failure" | "notApplied" | "unknown";
  blockingPolicyName?: string;
  blockingPolicyId?: string;
  clientApp: string;
  location: string;
  ipAddress: string;
  deviceName: string;
  deviceCompliant: boolean | null;
}

export interface UserDiagnostic {
  user: LicenseUserState | null;
  groups: string[];
  blockingPolicies: CaPolicySummary[];
  recentSignIns: SignInSummary[];
  lastFailure: SignInSummary | null;
  errorTranslation: ReturnType<typeof lookupAadsts>;
}

/* -------------------------------------------------------------------------- */
/* Mapping helpers                                                             */
/* -------------------------------------------------------------------------- */

function mapManifestUser(u: ManifestUser): LicenseUserState {
  return {
    objectId: u.objectId,
    upn: u.upn,
    displayName: u.displayName,
    jobTitle: u.jobTitle,
    department: u.department,
    currentSku: u.currentSku,
    expectedSku: u.expectedSku,
    driftStatus: u.driftStatus,
    extensionPresent: Boolean(u.extension),
  };
}

function primaryGroup(tenant: ManifestTenant) {
  const g = tenant.groups[0];
  if (!g) throw new Error(`Tenant ${tenant.displayName} has no groups in the manifest`);
  return g;
}

function mapManifestPolicy(p: ManifestCaPolicy): CaPolicySummary {
  return {
    id: p.id,
    displayName: p.displayName,
    state: p.state,
    includeGroupNames: p.conditions.users.includeGroupNames,
    includeGroupIds: p.conditions.users.includeGroups,
    excludeGroupNames: p.conditions.users.excludeGroupNames,
    excludeGroupIds: p.conditions.users.excludeGroups,
    targetApps: p.conditions.applications.includeApplications.map((appId, i) => ({
      appId,
      displayName: p.conditions.applications.includeApplicationNames[i] ?? KNOWN_APP_IDS[appId] ?? appId,
    })),
    grant: { operator: p.grantControls.operator, builtInControls: p.grantControls.builtInControls },
    blocks: p.grantControls.builtInControls.includes("block"),
    modifiedDateTime: p.modifiedDateTime,
  };
}

function mapManifestSignIn(e: ManifestSignIn): SignInSummary {
  const failure = e.status.errorCode !== 0;
  const blocking = e.appliedConditionalAccessPolicies.find((p) => p.result === "failure");
  return {
    id: e.id,
    timestamp: e.createdDateTime,
    upn: e.userPrincipalName,
    displayName: e.userDisplayName,
    appId: e.appId,
    appDisplayName: e.appDisplayName,
    status: failure ? "failure" : "success",
    errorCode: e.status.errorCode,
    ...(toAadstsLabel(e.status.errorCode) ? { errorCodeLabel: toAadstsLabel(e.status.errorCode) } : {}),
    ...(e.status.failureReason ? { failureReason: e.status.failureReason } : {}),
    conditionalAccessStatus: e.conditionalAccessStatus,
    ...(blocking ? { blockingPolicyName: blocking.displayName, blockingPolicyId: blocking.id } : {}),
    clientApp: e.clientAppUsed,
    location: e.location,
    ipAddress: e.ipAddress,
    deviceName: e.deviceDetail.displayName,
    deviceCompliant: e.deviceDetail.isCompliant,
  };
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

export const msgraphService = {
  getMode() {
    return { liveCloudMode: isLiveCloudMode(), liveCapableTenants: [...LIVE_CAPABLE_TENANTS] };
  },

  async getGraphContext(): Promise<GraphResult<{ tenantId: string | null; account: string | null; scopes: string[] }>> {
    return withSource<{ tenantId: string | null; account: string | null; scopes: string[] }>(
      "tenant-contoso-01",
      () => fetchGraphContextLive(LIVE_TIMEOUT_MS),
      () => ({ tenantId: null, account: null, scopes: [] }),
    );
  },

  async getLicenseState(tenantId: string): Promise<GraphResult<LicenseState>> {
    const tenant = getManifestTenant(tenantId);
    const group = primaryGroup(tenant);
    const fallback = (): LicenseState => {
      const users = tenant.users.map(mapManifestUser);
      return {
        tenantId,
        entraTenantId: tenant.tenantId,
        sku: {
          skuPartNumber: tenant.licenses.skuPartNumber,
          skuName: tenant.licenses.skuName,
          skuId: tenant.licenses.skuId,
          legacySkuPartNumber: tenant.licenses.legacySkuPartNumber,
        },
        group: { displayName: group.displayName, objectId: group.objectId },
        entraAssignedCount: tenant.licenses.entraAssignedCount,
        users,
        driftedUsers: users.filter((u) => u.driftStatus !== "compliant"),
      };
    };
    const live = async (): Promise<LicenseState> => {
      const [members, skus] = await Promise.all([
        fetchGroupMembersLive(group.displayName, LIVE_TIMEOUT_MS),
        fetchSubscribedSkusLive(LIVE_TIMEOUT_MS).catch(() => [] as Awaited<ReturnType<typeof fetchSubscribedSkusLive>>),
      ]);
      const skuById = new Map(skus.map((s) => [s.skuId.toLowerCase(), s]));
      const target = skus.find((s) => s.skuPartNumber === tenant.licenses.skuPartNumber);
      const users: LicenseUserState[] = members.users.map((u) => {
        const ext = (u.extension ?? {}) as Record<string, unknown>;
        const assignedParts = u.assignedSkuIds.map((id) => skuById.get(id.toLowerCase())?.skuPartNumber ?? id);
        const currentFromGraph = assignedParts.includes(tenant.licenses.skuPartNumber)
          ? tenant.licenses.skuPartNumber
          : assignedParts.includes(tenant.licenses.legacySkuPartNumber)
            ? tenant.licenses.legacySkuPartNumber
            : (assignedParts[0] ?? "NONE");
        const currentSku = typeof ext.currentSku === "string" ? ext.currentSku : currentFromGraph;
        const expectedSku = typeof ext.expectedSku === "string" ? ext.expectedSku : tenant.licenses.skuPartNumber;
        const driftStatus =
          typeof ext.driftStatus === "string" && ["compliant", "drifted", "unassigned"].includes(ext.driftStatus)
            ? (ext.driftStatus as LicenseUserState["driftStatus"])
            : currentSku === expectedSku
              ? "compliant"
              : currentSku === "NONE"
                ? "unassigned"
                : "drifted";
        return {
          objectId: u.objectId,
          upn: u.upn,
          displayName: u.displayName,
          jobTitle: u.jobTitle ?? "",
          department: u.department ?? "",
          currentSku,
          expectedSku,
          driftStatus,
          extensionPresent: u.extension !== null,
        };
      });
      return {
        tenantId,
        entraTenantId: tenant.tenantId,
        sku: {
          skuPartNumber: tenant.licenses.skuPartNumber,
          skuName: tenant.licenses.skuName,
          skuId: target?.skuId ?? tenant.licenses.skuId,
          legacySkuPartNumber: tenant.licenses.legacySkuPartNumber,
        },
        group: { displayName: members.group.displayName, objectId: members.group.objectId },
        // Real tenants rarely own the demo SKU; keep the contract-facing count from the manifest in that case.
        entraAssignedCount: target ? target.consumedUnits : tenant.licenses.entraAssignedCount,
        users,
        driftedUsers: users.filter((u) => u.driftStatus !== "compliant"),
      };
    };
    return withSource(tenantId, live, fallback);
  },

  async getGroupMembers(tenantId: string, groupDisplayName?: string) {
    const tenant = getManifestTenant(tenantId);
    const group = groupDisplayName ? tenant.groups.find((g) => g.displayName === groupDisplayName) : primaryGroup(tenant);
    if (!group) throw new Error(`Group '${groupDisplayName}' not found for ${tenantId}`);
    const fallback = () => ({
      group: { objectId: group.objectId, displayName: group.displayName, description: group.description },
      members: tenant.users.filter((u) => group.memberUpns.includes(u.upn)).map(mapManifestUser),
    });
    const live = async () => {
      const res = await fetchGroupMembersLive(group.displayName, LIVE_TIMEOUT_MS);
      return {
        group: { objectId: res.group.objectId, displayName: res.group.displayName, description: res.group.description ?? "" },
        members: res.users.map((u) => {
          const ext = (u.extension ?? {}) as Record<string, unknown>;
          return {
            objectId: u.objectId,
            upn: u.upn,
            displayName: u.displayName,
            jobTitle: u.jobTitle ?? "",
            department: u.department ?? "",
            currentSku: typeof ext.currentSku === "string" ? ext.currentSku : "UNKNOWN",
            expectedSku: typeof ext.expectedSku === "string" ? ext.expectedSku : tenant.licenses.skuPartNumber,
            driftStatus: (typeof ext.driftStatus === "string" ? ext.driftStatus : "compliant") as LicenseUserState["driftStatus"],
            extensionPresent: u.extension !== null,
          } satisfies LicenseUserState;
        }),
      };
    };
    return withSource(tenantId, live, fallback);
  },

  async getConditionalAccessPolicies(tenantId: string): Promise<GraphResult<CaPolicySummary[]>> {
    const tenant = getManifestTenant(tenantId);
    const groupNameById = new Map(tenant.groups.map((g) => [g.objectId, g.displayName]));
    const fallback = () => tenant.conditionalAccessPolicies.map(mapManifestPolicy);
    const live = async (): Promise<CaPolicySummary[]> => {
      const policies = await fetchConditionalAccessPoliciesLive(DEMO_POLICY_PREFIX, LIVE_TIMEOUT_MS);
      if (policies.length === 0) throw new Error("no [ContextPane-Demo] policies found in live tenant (seed the lab first)");
      return policies.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        state: p.state,
        includeGroupIds: p.includeGroups,
        includeGroupNames: p.includeGroups.map((id) => groupNameById.get(id) ?? id),
        excludeGroupIds: p.excludeGroups,
        excludeGroupNames: p.excludeGroups.map((id) => groupNameById.get(id) ?? id),
        targetApps: p.includeApplications.map((appId) => ({ appId, displayName: KNOWN_APP_IDS[appId] ?? appId })),
        grant: { operator: p.grantOperator ?? "OR", builtInControls: p.builtInControls },
        blocks: p.builtInControls.map((c) => c.toLowerCase()).includes("block"),
        modifiedDateTime: p.modifiedDateTime,
      }));
    };
    return withSource(tenantId, live, fallback);
  },

  async getSignInEvents(tenantId: string, options: { upn?: string; top?: number } = {}): Promise<GraphResult<SignInSummary[]>> {
    const tenant = getManifestTenant(tenantId);
    const top = options.top ?? 50;
    const fallback = () =>
      tenant.signInEvents
        .filter((e) => !options.upn || e.userPrincipalName.toLowerCase() === options.upn?.toLowerCase())
        .map(mapManifestSignIn)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, top);
    const live = async (): Promise<SignInSummary[]> => {
      const upns = options.upn ? [options.upn] : tenant.users.map((u) => u.upn);
      const events = await fetchSignInEventsLive(upns, top, SIGNIN_TIMEOUT_MS);
      // Lab users never actually sign in to AVD, so an empty live log falls back to the seeded timeline.
      if (events.length === 0) throw new Error("live sign-in log is empty for the lab users");
      return events
        .map((e): SignInSummary => {
          const blocking = e.appliedPolicies.find((p) => p.result.toLowerCase() === "failure");
          const label = toAadstsLabel(e.errorCode);
          return {
            id: e.id,
            timestamp: e.createdDateTime,
            upn: e.userPrincipalName,
            displayName: e.userDisplayName,
            appId: e.appId,
            appDisplayName: e.appDisplayName || KNOWN_APP_IDS[e.appId] || e.appId,
            status: e.errorCode === 0 ? "success" : e.errorCode === 50140 ? "interrupted" : "failure",
            errorCode: e.errorCode,
            ...(label ? { errorCodeLabel: label } : {}),
            ...(e.failureReason ? { failureReason: e.failureReason } : {}),
            conditionalAccessStatus: normaliseCaStatus(e.conditionalAccessStatus),
            ...(blocking ? { blockingPolicyName: blocking.displayName, blockingPolicyId: blocking.id } : {}),
            clientApp: e.clientAppUsed ?? "",
            location: [e.city, e.countryOrRegion].filter(Boolean).join(", "),
            ipAddress: e.ipAddress ?? "",
            deviceName: e.deviceDisplayName ?? "",
            deviceCompliant: e.isCompliant,
          };
        })
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    };
    return withSource(tenantId, live, fallback);
  },

  /** Everything the hover popover needs for a UPN. */
  async getUserDiagnostic(tenantId: string, upn: string): Promise<GraphResult<UserDiagnostic>> {
    const started = performance.now();
    const [license, policies, signIns] = await Promise.all([
      msgraphService.getLicenseState(tenantId),
      msgraphService.getConditionalAccessPolicies(tenantId),
      msgraphService.getSignInEvents(tenantId, { upn, top: 10 }),
    ]);
    const tenant = getManifestTenant(tenantId);
    const user = license.data.users.find((u) => u.upn.toLowerCase() === upn.toLowerCase()) ?? null;
    const groups = tenant.groups.filter((g) => g.memberUpns.map((m) => m.toLowerCase()).includes(upn.toLowerCase())).map((g) => g.displayName);
    const blockingPolicies = policies.data.filter((p) => p.includeGroupNames.some((g) => groups.includes(g)));
    const failures = signIns.data.filter((e) => e.status === "failure");
    const lastFailure = failures.at(-1) ?? null;
    const source: GraphSource = [license, policies, signIns].every((r) => r.source === "live-graph") ? "live-graph" : "seeded-manifest";
    const fallbackReason = [license, policies, signIns].map((r) => r.fallbackReason).filter(Boolean).join("; ");
    return {
      source,
      liveCloudMode: isLiveCloudMode(),
      ...(fallbackReason ? { fallbackReason } : {}),
      fetchedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      data: {
        user,
        groups,
        blockingPolicies,
        recentSignIns: signIns.data,
        lastFailure,
        errorTranslation: lastFailure ? lookupAadsts(lastFailure.errorCode) : null,
      },
    };
  },

  async getPolicyDiagnostic(tenantId: string, policyNameOrId: string) {
    const policies = await msgraphService.getConditionalAccessPolicies(tenantId);
    const needle = policyNameOrId.toLowerCase();
    const policy = policies.data.find((p) => p.id.toLowerCase() === needle || p.displayName.toLowerCase() === needle) ?? null;
    const signIns = await msgraphService.getSignInEvents(tenantId);
    const blockedSignIns = policy ? signIns.data.filter((e) => e.blockingPolicyId === policy.id) : [];
    return { ...policies, data: { policy, blockedSignIns, blockedUpns: [...new Set(blockedSignIns.map((e) => e.upn))] } };
  },

  async getGroupDiagnostic(tenantId: string, groupDisplayName: string) {
    const [members, policies, license] = await Promise.all([
      msgraphService.getGroupMembers(tenantId, groupDisplayName),
      msgraphService.getConditionalAccessPolicies(tenantId),
      msgraphService.getLicenseState(tenantId),
    ]);
    const policiesTargeting = policies.data.filter(
      (p) => p.includeGroupNames.includes(groupDisplayName) || p.excludeGroupNames.includes(groupDisplayName),
    );
    const drifted = members.data.members.filter((m) => m.driftStatus !== "compliant");
    return {
      ...members,
      data: {
        group: members.data.group,
        memberCount: members.data.members.length,
        driftedCount: drifted.length,
        driftedUpns: drifted.map((m) => m.upn),
        policiesTargeting,
        sku: license.data.sku,
      },
    };
  },
};

function normaliseCaStatus(value: string | null): SignInSummary["conditionalAccessStatus"] {
  const v = (value ?? "").toLowerCase();
  if (v === "success" || v === "failure") return v;
  if (v === "notapplied") return "notApplied";
  return "unknown";
}

export type MsGraphService = typeof msgraphService;
