import {
  KNOWN_APP_IDS,
  lookupAadsts,
  toAadstsLabel,
  type CaPolicyInspector,
  type GroupLicenseError,
  type IntuneDevice,
  type IntunePolicyRef,
  type IntuneSettingDrift,
  type LicenseDriftUser,
  type SkuPool,
} from "@contextpane/catalog";
import {
  CA_POSTURE,
  INTUNE_SCENARIOS,
  LICENSE_ANOMALY,
  caAuditEvents,
  legacySignIns,
  type CaGoldenPolicy,
  type DirectoryAuditEvent,
  type IntuneScenarioFixture,
  type IntuneScenarioKey,
  type LicenseAnomalyUser,
} from "./fixtures.ts";
import {
  GraphHttpError,
  assignDeviceConfigurationLive,
  fetchCaPostureLive,
  fetchConditionalAccessPoliciesLive,
  fetchGraphContextLive,
  fetchGroupMembersLive,
  fetchIntuneStateLive,
  fetchLabUsersLive,
  fetchSignInEventsLive,
  fetchSubscribedSkusLive,
  patchCaPolicyLive,
  patchLicenseExtensionsLive,
  setAsrRuleLive,
  type ExtensionPatchResult,
  type LiveIntuneState,
} from "./live.ts";
import { getManifestTenant, type ManifestCaPolicy, type ManifestSignIn, type ManifestTenant, type ManifestUser } from "./manifest.ts";
import { isLiveCloudMode } from "./pwsh.ts";

/* -------------------------------------------------------------------------- */
/* Result envelope                                                             */
/* -------------------------------------------------------------------------- */

/** live-synthesized: seeded sign-in timeline re-keyed to the live Conditional Access policy (see getSignInEvents). */
export type GraphSource = "live-graph" | "live-synthesized" | "seeded-manifest";

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
 * and the lab users never sign in, so it never runs on a request path: it is probed in
 * the background with this budget and only replaces the timeline if it finds events.
 */
const SIGNIN_TIMEOUT_MS = Number.parseInt(process.env.CTX_GRAPH_SIGNIN_TIMEOUT_MS ?? "60000", 10);
const SIGNIN_PROBE_TTL_MS = 10 * 60_000;

function envelope<T>(started: number) {
  return (data: T, source: GraphSource, fallbackReason?: string): GraphResult<T> => ({
    source,
    liveCloudMode: isLiveCloudMode(),
    ...(fallbackReason ? { fallbackReason } : {}),
    fetchedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    data,
  });
}

async function withSource<T>(
  tenantId: string,
  live: () => Promise<T>,
  fallback: () => T,
): Promise<GraphResult<T>> {
  const done = envelope<T>(performance.now());
  if (!isLiveCloudMode()) return done(fallback(), "seeded-manifest");
  if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return done(fallback(), "seeded-manifest", `${tenantId} is manifest-only`);
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

/** Lab license state written to the open extension: what a remediation sets and a demo reset restores. */
export const LAB_LICENSE_STATES = {
  remediated: { currentSku: "SPE_E5", driftStatus: "compliant", entraAssignedSku: "SPE_E5", avdEntitlementStatus: "Compliant" },
  drifted: { currentSku: "SPE_E3", driftStatus: "drifted", entraAssignedSku: "SPE_E3", avdEntitlementStatus: "Drift_Missing_E5_SKU" },
} as const;
export type LabLicenseState = keyof typeof LAB_LICENSE_STATES;

export interface LicenseWriteResult {
  source: "live-graph" | "simulated";
  fallbackReason?: string;
  latencyMs: number;
  results: ExtensionPatchResult[];
}

/* -------------------------------------------------------------------------- */
/* Licensing, Conditional Access and Intune scenarios                          */
/* -------------------------------------------------------------------------- */

export interface LicenseInventory {
  sku: { skuPartNumber: string; skuName: string };
  groupName: string;
  skuPools: SkuPool[];
  groupErrors: GroupLicenseError[];
  users: LicenseDriftUser[];
}

export interface CaPosture {
  policies: CaPolicyInspector[];
  breakGlassGroup: string;
  breakGlassAccount: string;
  goldenSource: string;
  legacySignIns: SignInSummary[];
  auditEvents: DirectoryAuditEvent[];
}

export interface IntuneDrift {
  issueKind: IntuneScenarioFixture["issueKind"];
  errorCode?: string;
  errorMeaning?: string;
  goldenSource: string;
  policies: IntunePolicyRef[];
  settings: IntuneSettingDrift[];
  devices: IntuneDevice[];
  affectedDeviceCount: number;
  /** True when the live tenant already matches the golden baseline (the fix was applied). */
  resolved: boolean;
}

/** Outcome of a Conditional Access or Intune write: one row per policy. */
export interface LabWriteResult {
  source: "live-graph" | "simulated";
  fallbackReason?: string;
  latencyMs: number;
  results: Array<{ id: string; ok: boolean; status: number; error?: string }>;
}

function simulatedWrite(ids: string[], fallbackReason: string, started: number): LabWriteResult {
  return { source: "simulated", fallbackReason, latencyMs: Math.round(performance.now() - started), results: ids.map((id) => ({ id, ok: true, status: 0 })) };
}

async function writeExtensions(tenantId: string, upns: string[], fields: (upn: string) => Record<string, string>): Promise<LicenseWriteResult> {
  const started = performance.now();
  const simulated = (fallbackReason: string): LicenseWriteResult => ({
    source: "simulated",
    fallbackReason,
    latencyMs: Math.round(performance.now() - started),
    results: upns.map((upn) => ({ upn, ok: true, status: 0 })),
  });
  if (!isLiveCloudMode()) return simulated("LIVE_CLOUD_MODE=false");
  if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return simulated(`${tenantId} is manifest-only`);
  try {
    const stamp = new Date().toISOString();
    const results = await patchLicenseExtensionsLive(upns, (upn) => ({ ...fields(upn), lastSyncedAt: stamp }), LIVE_TIMEOUT_MS);
    if (results.length && results.every((r) => r.status === 404)) return simulated("lab users not found in the live tenant (seed the lab first)");
    return { source: "live-graph", latencyMs: Math.round(performance.now() - started), results };
  } catch (error) {
    return simulated(error instanceof Error ? error.message : String(error));
  }
}

function licenseAnomalyFields(u: LicenseAnomalyUser, state: LabLicenseState): Record<string, string> {
  const sku = LICENSE_ANOMALY.sku.skuPartNumber;
  if (u.role === "orphaned") {
    return state === "remediated"
      ? { currentSku: "NONE", expectedSku: "NONE", assignmentState: "Reclaimed", assignmentPath: "None", driftStatus: "compliant" }
      : { currentSku: u.heldSkus.join(", "), expectedSku: "NONE", assignmentState: "Orphaned", assignmentPath: u.assignmentPath, driftStatus: "drifted" };
  }
  return state === "remediated"
    ? { currentSku: sku, expectedSku: sku, assignmentState: "Active", assignmentPath: "Group", driftStatus: "compliant" }
    : { currentSku: "NONE", expectedSku: sku, assignmentState: "Error: CountViolation", assignmentPath: "Group", driftStatus: "unassigned" };
}

const ASSIGNMENT_STATES = new Set<string>(["Active", "Error: CountViolation", "Drifted", "Orphaned", "Reclaimed"]);
const ASSIGNMENT_PATHS = new Set<string>(["Direct", "Group", "Direct + Group", "None"]);
const DRIFT_STATUSES = new Set<string>(["compliant", "drifted", "unassigned"]);

async function licenseAnomalyInventory(): Promise<GraphResult<LicenseInventory>> {
  const done = envelope<LicenseInventory>(performance.now());
  const build = (live: Map<string, Awaited<ReturnType<typeof fetchLabUsersLive>>[number]>): LicenseInventory => {
    const users: LicenseDriftUser[] = LICENSE_ANOMALY.users.map((u) => {
      const fixture = licenseAnomalyFields(u, "drifted");
      const found = live.get(u.upn.toLowerCase());
      const ext = (found?.extension ?? {}) as Record<string, unknown>;
      const pick = (key: string, allowed?: Set<string>) => (typeof ext[key] === "string" && (!allowed || allowed.has(ext[key] as string)) ? (ext[key] as string) : fixture[key]!);
      return {
        upn: u.upn,
        displayName: found?.displayName ?? u.displayName,
        jobTitle: found?.jobTitle ?? u.jobTitle,
        accountEnabled: found ? found.accountEnabled : u.accountEnabled,
        lastSignIn: u.lastSignIn,
        currentSku: pick("currentSku"),
        expectedSku: pick("expectedSku"),
        assignmentPath: pick("assignmentPath", ASSIGNMENT_PATHS) as LicenseDriftUser["assignmentPath"],
        assignmentState: pick("assignmentState", ASSIGNMENT_STATES) as LicenseDriftUser["assignmentState"],
        driftStatus: pick("driftStatus", DRIFT_STATUSES) as LicenseDriftUser["driftStatus"],
        ...(found ? { objectId: found.objectId } : {}),
      };
    });
    const holding = (sku: string) => users.filter((u) => u.currentSku.split(",").map((s) => s.trim()).includes(sku)).length;
    const skuPools: SkuPool[] = LICENSE_ANOMALY.pools.map((p) => {
      const consumed = p.othersConsumed + holding(p.skuPartNumber);
      const orphaned = users.filter((u) => !u.accountEnabled && u.currentSku.includes(p.skuPartNumber)).length;
      return {
        skuPartNumber: p.skuPartNumber,
        skuName: p.skuName,
        enabled: p.enabled,
        consumed,
        available: p.enabled - consumed,
        ...(orphaned ? { note: `${orphaned} held by disabled accounts` } : {}),
        source: "fixture",
      };
    });
    const failed = users.filter((u) => u.assignmentState === "Error: CountViolation");
    const pool = skuPools[0]!;
    return {
      sku: LICENSE_ANOMALY.sku,
      groupName: LICENSE_ANOMALY.groupName,
      skuPools,
      groupErrors: failed.length
        ? [
            {
              groupName: LICENSE_ANOMALY.groupName,
              skuPartNumber: pool.skuPartNumber,
              state: "CountViolation",
              affectedUsers: failed.length,
              detail: `${pool.consumed}/${pool.enabled} ${pool.skuPartNumber} seats consumed, ${Math.max(0, pool.available)} available: group-based licensing could not assign ${pool.skuPartNumber} to ${failed.length} members`,
            },
          ]
        : [],
      users,
    };
  };
  if (!isLiveCloudMode()) return done(build(new Map()), "seeded-manifest");
  try {
    const live = await fetchLabUsersLive(
      LICENSE_ANOMALY.users.map((u) => u.upn),
      LIVE_TIMEOUT_MS,
    );
    const seeded = live.filter((u) => u.extension);
    if (seeded.length === 0) return done(build(new Map()), "seeded-manifest", "ANOM-LIC-101 users not found in the live tenant (seed the lab first)");
    return done(build(new Map(live.map((u) => [u.upn.toLowerCase(), u]))), "live-graph", seeded.length < LICENSE_ANOMALY.users.length ? `${LICENSE_ANOMALY.users.length - seeded.length} of ${LICENSE_ANOMALY.users.length} users not seeded` : undefined);
  } catch (error) {
    return done(build(new Map()), "seeded-manifest", error instanceof Error ? error.message : String(error));
  }
}

function normaliseCaState(state: string): CaPolicyInspector["state"] {
  return state === "enabled" || state === "disabled" ? state : "enabledForReportingButNotEnforced";
}

function inspectCaPolicy(
  g: CaGoldenPolicy,
  live: { id: string; state: CaPolicyInspector["state"]; includeGroups: string[]; excludeGroups: string[]; modifiedDateTime: string | null },
): CaPolicyInspector {
  const drift: CaPolicyInspector["drift"] = [];
  if (live.state !== g.golden.state) {
    drift.push({ field: "state", expected: g.golden.state, actual: live.state, severity: g.key === "CA-004" ? "high" : "critical" });
  }
  const missing = g.golden.excludeGroups.filter((x) => !live.excludeGroups.includes(x));
  if (missing.length) {
    drift.push({ field: "conditions.users.excludeGroups", expected: g.golden.excludeGroups.join(", "), actual: live.excludeGroups.join(", ") || "(none)", severity: "critical" });
  }
  return {
    id: live.id,
    displayName: g.displayName,
    state: live.state,
    role: drift.length ? "drifted" : "in-scope",
    includeGroups: live.includeGroups,
    excludeGroups: live.excludeGroups,
    targetApps: g.targetApps,
    clientAppTypes: g.clientAppTypes,
    grantControls: g.grantControls,
    drift,
    fixedState: g.golden.state,
    fixedExcludeGroups: [...new Set([...live.excludeGroups, ...g.golden.excludeGroups])],
    modifiedDateTime: live.modifiedDateTime,
  };
}

function caPosture(policies: CaPolicyInspector[]): CaPosture {
  const now = Date.now();
  return {
    policies,
    breakGlassGroup: CA_POSTURE.breakGlassGroup,
    breakGlassAccount: CA_POSTURE.breakGlassAccount,
    goldenSource: CA_POSTURE.goldenSource,
    auditEvents: caAuditEvents(now),
    legacySignIns: legacySignIns().map((e, i) => ({
      id: `sgn-legacy-${(i + 1).toString().padStart(4, "0")}`,
      timestamp: new Date(now - e.hoursAgo * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: e.upn,
      displayName: e.displayName,
      appId: "00000002-0000-0ff1-ce00-000000000000",
      appDisplayName: "Office 365 Exchange Online",
      status: "success",
      errorCode: 0,
      conditionalAccessStatus: "notApplied",
      // Report-only: the would-be block shows up in the policy result, not in the sign-in status.
      blockingPolicyName: undefined,
      clientApp: e.clientApp,
      location: e.location,
      ipAddress: e.ipAddress,
      deviceName: "",
      deviceCompliant: null,
    })),
  };
}

const capitalise = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

function intuneDrift(fixture: IntuneScenarioFixture, live: LiveIntuneState | null): IntuneDrift {
  const probe = fixture.live;
  const asrFixed = live && probe.asrPolicy ? live.asrRuleValue === "block" : false;
  const conflictFixed = live ? live.conflictingProfileAssigned === false : false;
  const resolved = Boolean(live) && (!probe.asrPolicy || asrFixed) && conflictFixed;
  const settings = fixture.settings.map((s): IntuneSettingDrift => {
    if (!live) return s;
    if (s.settingId === "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2") {
      const value = live.asrRuleValue ? capitalise(live.asrRuleValue) : s.live;
      return { ...s, live: value, status: value === s.golden ? "in-sync" : "drifted" };
    }
    if (s.status === "conflict") return conflictFixed ? { ...s, live: s.golden, status: "in-sync" } : s;
    return resolved ? { ...s, live: s.golden, status: "in-sync" } : s;
  });
  const policies = fixture.policies.map((p): IntunePolicyRef => {
    const isLive = Boolean(live) && ((p.name === probe.asrPolicy && live!.asrPolicyId) || (p.name === probe.conflictingProfile && live!.conflictingProfileId));
    const unassigned = p.name === probe.conflictingProfile && conflictFixed;
    return { ...p, assignedTo: unassigned ? [] : p.assignedTo, source: isLive ? "live-graph" : "fixture" };
  });
  const devices = resolved ? fixture.devices.map((d) => ({ ...d, complianceState: "Compliant" as const, detail: "Re-evaluated after the policy fix" })) : fixture.devices;
  return {
    issueKind: fixture.issueKind,
    ...(fixture.errorCode ? { errorCode: fixture.errorCode } : {}),
    ...(fixture.errorMeaning ? { errorMeaning: fixture.errorMeaning } : {}),
    goldenSource: fixture.goldenSource,
    policies,
    settings,
    devices,
    affectedDeviceCount: devices.filter((d) => d.complianceState !== "Compliant").length,
    resolved,
  };
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
        fetchGroupMembersLive(group.objectId, LIVE_TIMEOUT_MS),
        fetchSubscribedSkusLive(group.objectId, LIVE_TIMEOUT_MS).catch(() => [] as Awaited<ReturnType<typeof fetchSubscribedSkusLive>>),
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
      const res = await fetchGroupMembersLive(group.objectId, LIVE_TIMEOUT_MS);
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
      const policies = await fetchConditionalAccessPoliciesLive(primaryGroup(tenant).objectId, DEMO_POLICY_PREFIX, LIVE_TIMEOUT_MS);
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

  /**
   * Live mode never waits on auditLogs/signIns. Real events found by the background
   * probe win; until then the seeded timeline is re-keyed to the live Conditional
   * Access policy (real id and name), reported as source "live-synthesized".
   */
  async getSignInEvents(tenantId: string, options: { upn?: string; top?: number } = {}): Promise<GraphResult<SignInSummary[]>> {
    const done = envelope<SignInSummary[]>(performance.now());
    const tenant = getManifestTenant(tenantId);
    const top = options.top ?? 50;
    const select = (events: SignInSummary[]) =>
      events
        .filter((e) => !options.upn || e.upn.toLowerCase() === options.upn.toLowerCase())
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, top);
    const seeded = () => select(tenant.signInEvents.map(mapManifestSignIn));

    if (!isLiveCloudMode()) return done(seeded(), "seeded-manifest");
    if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return done(seeded(), "seeded-manifest", `${tenantId} is manifest-only`);

    const probed = probeSignIns(tenantId, tenant.users.map((u) => u.upn));
    if (probed?.length) return done(select(probed), "live-graph");

    const policies = await msgraphService.getConditionalAccessPolicies(tenantId);
    if (policies.source !== "live-graph") return done(seeded(), "seeded-manifest", policies.fallbackReason);
    const liveByManifestId = new Map(
      tenant.conditionalAccessPolicies.map((mp) => [mp.id, policies.data.find((lp) => lp.displayName === mp.displayName) ?? policies.data[0]]),
    );
    const events = seeded().map((e) => {
      const live = e.blockingPolicyId ? liveByManifestId.get(e.blockingPolicyId) : undefined;
      return live ? { ...e, blockingPolicyId: live.id, blockingPolicyName: live.displayName } : e;
    });
    return done(events, "live-synthesized");
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
    const source: GraphSource = [license, policies, signIns].every((r) => r.source !== "seeded-manifest") ? "live-graph" : "seeded-manifest";
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

  /**
   * Writes the lab license state (open extension com.contextpane.licenseState) for the
   * given users in one Graph $batch. Manifest-only tenants and offline mode are simulated.
   */
  async setLicenseExtensionState(tenantId: string, upns: string[], state: LabLicenseState): Promise<LicenseWriteResult> {
    const started = performance.now();
    const simulated = (fallbackReason: string): LicenseWriteResult => ({
      source: "simulated",
      fallbackReason,
      latencyMs: Math.round(performance.now() - started),
      results: upns.map((upn) => ({ upn, ok: true, status: 0 })),
    });
    if (!isLiveCloudMode()) return simulated("LIVE_CLOUD_MODE=false");
    if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return simulated(`${tenantId} is manifest-only`);
    try {
      const results = await patchLicenseExtensionsLive(upns, { ...LAB_LICENSE_STATES[state], lastSyncedAt: new Date().toISOString() }, LIVE_TIMEOUT_MS);
      return { source: "live-graph", latencyMs: Math.round(performance.now() - started), results };
    } catch (error) {
      return simulated(error instanceof Error ? error.message : String(error));
    }
  },

  /**
   * SKU pools, group-licensing errors and per-user assignment state for a License Pool &
   * Assignment card. Tickets read the entitlement group (open extension) and the live
   * subscribedSkus; ANOM-LIC-101 reads its seeded users and keeps the 15/15 pool a fixture.
   */
  async getLicenseInventory(tenantId: string, scenarioId?: string): Promise<GraphResult<LicenseInventory>> {
    if (scenarioId === "ANOM-LIC-101") return licenseAnomalyInventory();
    const started = performance.now();
    const license = await msgraphService.getLicenseState(tenantId);
    const tenant = getManifestTenant(tenantId);
    const lic = license.data;
    const users: LicenseDriftUser[] = lic.users.map((u) => ({
      upn: u.upn,
      displayName: u.displayName,
      jobTitle: u.jobTitle,
      accountEnabled: true,
      currentSku: u.currentSku,
      expectedSku: u.expectedSku,
      assignmentPath: "Group",
      assignmentState: u.driftStatus === "compliant" ? "Active" : "Drifted",
      driftStatus: u.driftStatus,
      objectId: u.objectId,
    }));
    const onLegacy = users.filter((u) => u.currentSku === lic.sku.legacySkuPartNumber).length;
    const fixturePools: SkuPool[] = [
      {
        skuPartNumber: lic.sku.skuPartNumber,
        skuName: lic.sku.skuName,
        enabled: tenant.licenses.erpBilledCount,
        consumed: lic.entraAssignedCount,
        available: tenant.licenses.erpBilledCount - lic.entraAssignedCount,
        note: `entitlement of ${lic.group.displayName}`,
        source: "fixture",
      },
      {
        skuPartNumber: lic.sku.legacySkuPartNumber,
        skuName: lic.sku.legacySkuPartNumber === "SPE_E3" ? "Microsoft 365 E3" : lic.sku.legacySkuPartNumber,
        enabled: onLegacy + 2,
        consumed: onLegacy,
        available: 2,
        note: onLegacy ? `${onLegacy} assigned to ${lic.group.displayName.replace(/^SG-/, "")} users` : "none assigned to the group",
        source: "fixture",
      },
    ];
    let skuPools = fixturePools;
    let fallbackReason = license.fallbackReason;
    if (license.source === "live-graph") {
      try {
        const live = await fetchSubscribedSkusLive(primaryGroup(tenant).objectId, LIVE_TIMEOUT_MS);
        skuPools = fixturePools.map((p) => {
          const s = live.find((x) => x.skuPartNumber === p.skuPartNumber);
          return s ? { ...p, enabled: s.enabledUnits, consumed: s.consumedUnits, available: s.enabledUnits - s.consumedUnits, source: "live-graph" as const } : p;
        });
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      source: license.source,
      liveCloudMode: isLiveCloudMode(),
      ...(fallbackReason ? { fallbackReason } : {}),
      fetchedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      data: { sku: { skuPartNumber: lic.sku.skuPartNumber, skuName: lic.sku.skuName }, groupName: lic.group.displayName, skuPools, groupErrors: [], users },
    };
  },

  /** ANOM-CA-204: the demo CA policies against their golden baseline, the break-glass group and the legacy sign-ins CA-004 only reported. */
  async getCaPosture(tenantId: string): Promise<GraphResult<CaPosture>> {
    const groupNames = [CA_POSTURE.breakGlassGroup, CA_POSTURE.adminGroup, CA_POSTURE.legacyAuthScopeGroup];
    const live = async (): Promise<CaPosture> => {
      const posture = await fetchCaPostureLive(groupNames, LIVE_TIMEOUT_MS);
      const nameById = new Map([...posture.groupIds].map(([name, id]) => [id, name]));
      const policies = CA_POSTURE.policies.map((g) => {
        const p = posture.policies.find((x) => x.displayName === g.displayName);
        if (!p) throw new Error(`'${g.displayName}' not found in the live tenant (seed the lab first)`);
        return inspectCaPolicy(g, {
          id: p.id,
          state: normaliseCaState(p.state),
          includeGroups: p.includeGroups.map((id) => nameById.get(id) ?? id),
          excludeGroups: p.excludeGroups.map((id) => nameById.get(id) ?? id),
          modifiedDateTime: p.modifiedDateTime,
        });
      });
      return caPosture(policies);
    };
    const fallback = () =>
      caPosture(
        CA_POSTURE.policies.map((g, i) =>
          inspectCaPolicy(g, { id: `ca-demo-00${i === 0 ? 1 : 4}`, state: g.drifted.state, includeGroups: g.includeGroups, excludeGroups: g.drifted.excludeGroups, modifiedDateTime: caAuditEvents()[i]?.at ?? null }),
        ),
      );
    return withSource(tenantId, live, fallback);
  },

  /** ANOM-INT-309 / INC-4099: Intune policy drift against the golden baseline. The demo Intune objects live in the lab tenant for both. */
  async getIntuneDrift(key: IntuneScenarioKey): Promise<GraphResult<IntuneDrift>> {
    const done = envelope<IntuneDrift>(performance.now());
    const fixture = INTUNE_SCENARIOS[key];
    if (!isLiveCloudMode()) return done(intuneDrift(fixture, null), "seeded-manifest");
    try {
      return done(intuneDrift(fixture, await fetchIntuneStateLive(fixture.live, LIVE_TIMEOUT_MS)), "live-graph");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return done(intuneDrift(fixture, null), "seeded-manifest", reason);
    }
  },

  /** Writes the ANOM-LIC-101 users' extension: seats reclaimed + new hires active, or back to the CountViolation state. */
  async setLicenseAnomalyState(state: LabLicenseState): Promise<LicenseWriteResult> {
    const users = LICENSE_ANOMALY.users;
    return writeExtensions(
      "tenant-contoso-01",
      users.map((u) => u.upn),
      (upn) => licenseAnomalyFields(users.find((u) => u.upn === upn)!, state),
    );
  },

  /** ANOM-CA-204 fix (remediated) or the demo drift (drifted) on CA-001 / CA-004, via the delegated Connect-MgGraph token. */
  async setCaPostureState(state: LabLicenseState): Promise<LabWriteResult> {
    const started = performance.now();
    const ids = CA_POSTURE.policies.map((p) => p.key);
    if (!isLiveCloudMode()) return simulatedWrite(ids, "LIVE_CLOUD_MODE=false", started);
    try {
      const posture = await fetchCaPostureLive([CA_POSTURE.breakGlassGroup], LIVE_TIMEOUT_MS);
      const results: LabWriteResult["results"] = [];
      for (const g of CA_POSTURE.policies) {
        const p = posture.policies.find((x) => x.displayName === g.displayName);
        if (!p) throw new Error(`'${g.displayName}' not found in the live tenant (seed the lab first)`);
        const target = state === "remediated" ? g.golden : g.drifted;
        const excludeGroups = target.excludeGroups.map((name) => {
          const id = posture.groupIds.get(name);
          if (!id) throw new Error(`group ${name} not found in the live tenant (seed the lab first)`);
          return id;
        });
        try {
          await patchCaPolicyLive(
            p.id,
            {
              state: target.state,
              conditions: {
                users: { includeGroups: p.includeGroups, includeUsers: p.includeUsers, excludeGroups },
                applications: { includeApplications: p.includeApplications },
                clientAppTypes: p.clientAppTypes,
              },
            },
            LIVE_TIMEOUT_MS,
          );
          results.push({ id: g.key, ok: true, status: 204 });
        } catch (error) {
          results.push({ id: g.key, ok: false, status: error instanceof GraphHttpError ? error.status : 0, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { source: "live-graph", latencyMs: Math.round(performance.now() - started), results };
    } catch (error) {
      return simulatedWrite(ids, error instanceof Error ? error.message : String(error), started);
    }
  },

  /** ANOM-INT-309 / INC-4099 fix (ASR rule → Block, conflicting profile unassigned) or the demo drift, via the delegated token. */
  async setIntuneState(key: IntuneScenarioKey, state: LabLicenseState): Promise<LabWriteResult> {
    const started = performance.now();
    const probe = INTUNE_SCENARIOS[key].live;
    const ids = [...(probe.asrPolicy ? [probe.asrPolicy] : []), probe.conflictingProfile];
    if (!isLiveCloudMode()) return simulatedWrite(ids, "LIVE_CLOUD_MODE=false", started);
    try {
      const live = await fetchIntuneStateLive(probe, LIVE_TIMEOUT_MS);
      const results: LabWriteResult["results"] = [];
      const attempt = async (id: string, fn: () => Promise<void>) => {
        try {
          await fn();
          results.push({ id, ok: true, status: 204 });
        } catch (error) {
          results.push({ id, ok: false, status: error instanceof GraphHttpError ? error.status : 0, error: error instanceof Error ? error.message : String(error) });
        }
      };
      if (probe.asrPolicy && probe.asrRuleSetting) {
        const policyId = live.asrPolicyId;
        const rule = probe.asrRuleSetting;
        if (policyId) await attempt(probe.asrPolicy, () => setAsrRuleLive(policyId, rule, state === "remediated" ? "block" : "audit", LIVE_TIMEOUT_MS));
        else results.push({ id: probe.asrPolicy, ok: false, status: 404, error: "policy not found (seed the lab first)" });
      }
      const profileId = live.conflictingProfileId;
      if (profileId) {
        const groupId = state === "remediated" ? null : live.assignmentGroupId;
        if (state === "drifted" && !groupId) results.push({ id: probe.conflictingProfile, ok: false, status: 404, error: `group ${probe.assignmentGroup} not found` });
        else await attempt(probe.conflictingProfile, () => assignDeviceConfigurationLive(profileId, groupId, LIVE_TIMEOUT_MS));
      } else {
        results.push({ id: probe.conflictingProfile, ok: false, status: 404, error: "profile not found (seed the lab first)" });
      }
      return { source: "live-graph", latencyMs: Math.round(performance.now() - started), results };
    } catch (error) {
      return simulatedWrite(ids, error instanceof Error ? error.message : String(error), started);
    }
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

/* -------------------------------------------------------------------------- */
/* Background sign-in probe                                                    */
/* -------------------------------------------------------------------------- */

const signInProbes = new Map<string, { at: number; events: SignInSummary[] | null; running: boolean }>();

/** Cached real sign-ins (null when none were found); starts a background refresh when stale. */
function probeSignIns(tenantId: string, upns: string[]): SignInSummary[] | null {
  const entry = signInProbes.get(tenantId);
  if (!entry || (!entry.running && Date.now() - entry.at > SIGNIN_PROBE_TTL_MS)) {
    signInProbes.set(tenantId, { at: entry?.at ?? 0, events: entry?.events ?? null, running: true });
    fetchSignInEventsLive(upns, 50, SIGNIN_TIMEOUT_MS)
      .then((events) => events.map(mapLiveSignIn))
      .catch(() => null)
      .then((events) => signInProbes.set(tenantId, { at: Date.now(), events: events?.length ? events : null, running: false }));
  }
  return entry?.events ?? null;
}

function mapLiveSignIn(e: Awaited<ReturnType<typeof fetchSignInEventsLive>>[number]): SignInSummary {
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
}

function normaliseCaStatus(value: string | null): SignInSummary["conditionalAccessStatus"] {
  const v = (value ?? "").toLowerCase();
  if (v === "success" || v === "failure") return v;
  if (v === "notapplied") return "notApplied";
  return "unknown";
}

export type MsGraphService = typeof msgraphService;
