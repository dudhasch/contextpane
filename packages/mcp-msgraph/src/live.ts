import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cachedTokenClaims, getAccessToken, getGraphSdkAccessToken, invalidateAccessToken, invalidateGraphSdkAccessToken } from "./token.ts";

/**
 * Live Microsoft Graph reads over plain fetch() with a bearer token minted once
 * from the cached Az sign-in (see token.ts). The group, its members, subscribed
 * SKUs and Conditional Access policies come back in one Graph $batch; the members'
 * open extensions in a second. Every function throws on failure so the service
 * layer can fall back to the manifest.
 */

const GRAPH = "https://graph.microsoft.com";
const GRAPH_V1 = `${GRAPH}/v1.0`;
const EXTENSION_ID = "com.contextpane.licenseState";

export interface LiveGroupMembersResult {
  group: { objectId: string; displayName: string; description: string | null; mailNickname: string | null };
  users: Array<{
    objectId: string;
    upn: string;
    displayName: string;
    jobTitle: string | null;
    department: string | null;
    usageLocation: string | null;
    assignedSkuIds: string[];
    extension: Record<string, unknown> | null;
  }>;
}

export interface LiveSubscribedSku {
  skuId: string;
  skuPartNumber: string;
  consumedUnits: number;
  enabledUnits: number;
}

export interface LiveCaPolicy {
  id: string;
  displayName: string;
  state: string;
  createdDateTime: string | null;
  modifiedDateTime: string | null;
  includeGroups: string[];
  excludeGroups: string[];
  includeUsers: string[];
  includeApplications: string[];
  clientAppTypes: string[];
  grantOperator: string | null;
  builtInControls: string[];
}

export interface LiveSignIn {
  id: string;
  createdDateTime: string;
  userPrincipalName: string;
  userDisplayName: string;
  appId: string;
  appDisplayName: string;
  clientAppUsed: string | null;
  ipAddress: string | null;
  city: string | null;
  countryOrRegion: string | null;
  deviceDisplayName: string | null;
  operatingSystem: string | null;
  isCompliant: boolean | null;
  trustType: string | null;
  errorCode: number;
  failureReason: string | null;
  conditionalAccessStatus: string | null;
  appliedPolicies: Array<{ id: string; displayName: string; result: string; enforcedGrantControls: string[] }>;
}

export interface LiveGraphSnapshot extends LiveGroupMembersResult {
  skus: LiveSubscribedSku[];
  policies: LiveCaPolicy[];
}

export class GraphHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Graph HTTP ${status}: ${message}`);
    this.name = "GraphHttpError";
  }
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/** "az": the Get-AzAccessToken bearer every read uses; "graph-sdk": the Connect-MgGraph one (Conditional Access and Intune). */
type TokenSource = "az" | "graph-sdk";

async function graphFetch(path: string, init: RequestInit, timeoutMs: number, tokenSource: TokenSource = "az"): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = tokenSource === "graph-sdk" ? await getGraphSdkAccessToken(Math.max(timeoutMs, 30_000)) : await getAccessToken(GRAPH, Math.max(timeoutMs, 30_000));
    // "/beta/..." paths go to the beta endpoint (Intune Settings Catalog), everything else to v1.0.
    const response = await fetch(path.startsWith("/beta/") ? `${GRAPH}${path}` : `${GRAPH_V1}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 && attempt === 0) {
      if (tokenSource === "graph-sdk") invalidateGraphSdkAccessToken();
      else invalidateAccessToken(GRAPH);
      continue;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) throw new GraphHttpError(response.status, body.error?.message ?? response.statusText);
    return body;
  }
  throw new GraphHttpError(401, "token rejected twice");
}

interface BatchResponse {
  id: string;
  status: number;
  body?: { value?: unknown[]; error?: { message?: string } } & Record<string, unknown>;
}

interface BatchRequest {
  id: string;
  url: string;
  method?: "GET" | "PATCH" | "POST";
  body?: unknown;
}

/** One POST /$batch (Graph allows 20 requests per batch). Per-request failures come back as status codes. */
async function graphBatch(requests: BatchRequest[], timeoutMs: number): Promise<Map<string, BatchResponse>> {
  const body = (await graphFetch(
    "/$batch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: requests.map((r) => ({
          id: r.id,
          url: r.url,
          method: r.method ?? "GET",
          ...(r.body === undefined ? {} : { body: r.body, headers: { "content-type": "application/json" } }),
        })),
      }),
    },
    timeoutMs,
  )) as { responses?: BatchResponse[] };
  return new Map((body.responses ?? []).map((r) => [r.id, r]));
}

function okBody(responses: Map<string, BatchResponse>, id: string): NonNullable<BatchResponse["body"]> {
  const r = responses.get(id);
  if (!r || r.status >= 400 || !r.body) throw new GraphHttpError(r?.status ?? 0, `${id}: ${r?.body?.error?.message ?? "missing from batch"}`);
  return r.body;
}

/* -------------------------------------------------------------------------- */
/* Snapshot: group + members + SKUs + CA policies                              */
/* -------------------------------------------------------------------------- */

interface GraphUser {
  id: string;
  userPrincipalName: string;
  displayName: string;
  jobTitle?: string | null;
  department?: string | null;
  usageLocation?: string | null;
  assignedLicenses?: Array<{ skuId: string }>;
}

interface GraphPolicy {
  id: string;
  displayName: string;
  state: string;
  createdDateTime?: string | null;
  modifiedDateTime?: string | null;
  conditions?: {
    users?: { includeGroups?: string[]; excludeGroups?: string[]; includeUsers?: string[] };
    applications?: { includeApplications?: string[] };
    clientAppTypes?: string[];
  };
  grantControls?: { operator?: string | null; builtInControls?: string[] } | null;
}

const SNAPSHOT_TTL_MS = 5_000;
const snapshots = new Map<string, { at: number; value: Promise<LiveGraphSnapshot> }>();

/**
 * Everything the license, group and policy reads need for one group, in two
 * round trips. Concurrent callers (license state, CA policies, group members)
 * share one in-flight snapshot.
 */
export function fetchGraphSnapshot(groupId: string, timeoutMs: number): Promise<LiveGraphSnapshot> {
  const hit = snapshots.get(groupId);
  if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.value;
  const value = (async (): Promise<LiveGraphSnapshot> => {
    const first = await graphBatch(
      [
        { id: "group", url: `/groups/${groupId}?$select=id,displayName,description,mailNickname` },
        {
          id: "members",
          url: `/groups/${groupId}/members/microsoft.graph.user?$select=id,userPrincipalName,displayName,jobTitle,department,usageLocation,assignedLicenses&$top=100`,
        },
        { id: "skus", url: "/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits" },
        { id: "policies", url: "/identity/conditionalAccess/policies" },
      ],
      timeoutMs,
    );
    const group = okBody(first, "group") as unknown as { id: string; displayName: string; description?: string | null; mailNickname?: string | null };
    const members = (okBody(first, "members").value ?? []) as GraphUser[];
    const skus = (okBody(first, "skus").value ?? []) as Array<{ skuId: string; skuPartNumber: string; consumedUnits: number; prepaidUnits?: { enabled?: number } }>;
    const policies = (okBody(first, "policies").value ?? []) as GraphPolicy[];

    const extensions = members.length
      ? await graphBatch(
          members.slice(0, 20).map((m, i) => ({ id: `ext${i}`, url: `/users/${m.id}/extensions/${EXTENSION_ID}` })),
          timeoutMs,
        )
      : new Map<string, BatchResponse>();

    return {
      group: { objectId: group.id, displayName: group.displayName, description: group.description ?? null, mailNickname: group.mailNickname ?? null },
      users: members.map((u, i) => {
        const ext = extensions.get(`ext${i}`);
        const extension = ext && ext.status < 300 && ext.body ? stripODataKeys(ext.body) : null;
        return {
          objectId: u.id,
          upn: u.userPrincipalName,
          displayName: u.displayName,
          jobTitle: u.jobTitle ?? null,
          department: u.department ?? null,
          usageLocation: u.usageLocation ?? null,
          assignedSkuIds: (u.assignedLicenses ?? []).map((l) => l.skuId),
          extension,
        };
      }),
      skus: skus.map((s) => ({ skuId: s.skuId, skuPartNumber: s.skuPartNumber, consumedUnits: s.consumedUnits ?? 0, enabledUnits: s.prepaidUnits?.enabled ?? 0 })),
      policies: policies.map(mapPolicy),
    };
  })();
  snapshots.set(groupId, { at: Date.now(), value });
  value.catch(() => snapshots.delete(groupId));
  return value;
}

function mapPolicy(p: GraphPolicy): LiveCaPolicy {
  return {
    id: p.id,
    displayName: p.displayName,
    state: p.state,
    createdDateTime: p.createdDateTime ?? null,
    modifiedDateTime: p.modifiedDateTime ?? null,
    includeGroups: p.conditions?.users?.includeGroups ?? [],
    excludeGroups: p.conditions?.users?.excludeGroups ?? [],
    includeUsers: p.conditions?.users?.includeUsers ?? [],
    includeApplications: p.conditions?.applications?.includeApplications ?? [],
    clientAppTypes: p.conditions?.clientAppTypes ?? [],
    grantOperator: p.grantControls?.operator ?? null,
    builtInControls: p.grantControls?.builtInControls ?? [],
  };
}

function stripODataKeys(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith("@odata") && k !== "id" && k !== "extensionName"));
}

export async function fetchGroupMembersLive(groupId: string, timeoutMs: number): Promise<LiveGroupMembersResult> {
  const { group, users } = await fetchGraphSnapshot(groupId, timeoutMs);
  return { group, users };
}

export async function fetchSubscribedSkusLive(groupId: string, timeoutMs: number): Promise<LiveSubscribedSku[]> {
  return (await fetchGraphSnapshot(groupId, timeoutMs)).skus;
}

export async function fetchConditionalAccessPoliciesLive(groupId: string, prefix: string, timeoutMs: number): Promise<LiveCaPolicy[]> {
  // StartsWith, not a wildcard match: '[' in '[ContextPane-Demo]' is a character set to -like and friends
  return (await fetchGraphSnapshot(groupId, timeoutMs)).policies.filter((p) => p.displayName?.startsWith(prefix));
}

/* -------------------------------------------------------------------------- */
/* Sign-in log (slow: 40-60 s filtered by UPN on a busy tenant)                */
/* -------------------------------------------------------------------------- */

interface GraphSignIn {
  id: string;
  createdDateTime: string;
  userPrincipalName: string;
  userDisplayName: string;
  appId: string;
  appDisplayName: string;
  clientAppUsed?: string | null;
  ipAddress?: string | null;
  location?: { city?: string | null; countryOrRegion?: string | null } | null;
  deviceDetail?: { displayName?: string | null; operatingSystem?: string | null; isCompliant?: boolean | null; trustType?: string | null } | null;
  status?: { errorCode?: number; failureReason?: string | null } | null;
  conditionalAccessStatus?: string | null;
  appliedConditionalAccessPolicies?: Array<{ id: string; displayName: string; result: string; enforcedGrantControls?: string[] }>;
}

export async function fetchSignInEventsLive(upns: string[], top: number, timeoutMs: number): Promise<LiveSignIn[]> {
  const filter = upns.map((u) => `userPrincipalName eq '${u.replace(/'/g, "''")}'`).join(" or ");
  const body = (await graphFetch(`/auditLogs/signIns?$filter=${encodeURIComponent(filter)}&$top=${Math.max(1, Math.min(top, 100))}`, { method: "GET" }, timeoutMs)) as {
    value?: GraphSignIn[];
  };
  return (body.value ?? []).map((e) => ({
    id: e.id,
    createdDateTime: e.createdDateTime,
    userPrincipalName: e.userPrincipalName,
    userDisplayName: e.userDisplayName,
    appId: e.appId,
    appDisplayName: e.appDisplayName,
    clientAppUsed: e.clientAppUsed ?? null,
    ipAddress: e.ipAddress ?? null,
    city: e.location?.city ?? null,
    countryOrRegion: e.location?.countryOrRegion ?? null,
    deviceDisplayName: e.deviceDetail?.displayName ?? null,
    operatingSystem: e.deviceDetail?.operatingSystem ?? null,
    isCompliant: e.deviceDetail?.isCompliant ?? null,
    trustType: e.deviceDetail?.trustType ?? null,
    errorCode: e.status?.errorCode ?? 0,
    failureReason: e.status?.failureReason ?? null,
    conditionalAccessStatus: e.conditionalAccessStatus ?? null,
    appliedPolicies: (e.appliedConditionalAccessPolicies ?? []).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      result: p.result,
      enforcedGrantControls: p.enforcedGrantControls ?? [],
    })),
  }));
}

export async function fetchGraphContextLive(timeoutMs: number): Promise<{ tenantId: string; account: string | null; scopes: string[] }> {
  await getAccessToken(GRAPH, timeoutMs);
  const claims = cachedTokenClaims(GRAPH) ?? {};
  return {
    tenantId: String(claims.tid ?? ""),
    account: typeof claims.upn === "string" ? claims.upn : typeof claims.unique_name === "string" ? claims.unique_name : null,
    scopes: typeof claims.scp === "string" ? claims.scp.split(" ") : [],
  };
}

/* -------------------------------------------------------------------------- */
/* Writes: lab license state                                                   */
/* -------------------------------------------------------------------------- */

/** Drop cached snapshots so the next read sees a write made a moment ago. */
export function invalidateGraphSnapshots() {
  snapshots.clear();
}

export interface ExtensionPatchResult {
  upn: string;
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * PATCHes the com.contextpane.licenseState open extension of every user, in parallel
 * (Graph runs a $batch of PATCHes one after another, ~1.1 s for three; parallel is ~0.4 s).
 * Open-extension PATCH merges: listed properties change, the rest stay.
 */
export async function patchLicenseExtensionsLive(upns: string[], fields: Record<string, string> | ((upn: string) => Record<string, string>), timeoutMs: number): Promise<ExtensionPatchResult[]> {
  const results = await Promise.all(
    upns.map(async (upn): Promise<ExtensionPatchResult> => {
      const body = JSON.stringify({ "@odata.type": "#microsoft.graph.openTypeExtension", extensionName: EXTENSION_ID, ...(typeof fields === "function" ? fields(upn) : fields) });
      try {
        await graphFetch(`/users/${encodeURIComponent(upn)}/extensions/${EXTENSION_ID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body }, timeoutMs);
        return { upn, ok: true, status: 204 };
      } catch (error) {
        return { upn, ok: false, status: error instanceof GraphHttpError ? error.status : 0, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  invalidateGraphSnapshots();
  return results;
}

/* -------------------------------------------------------------------------- */
/* Delegated Connect-MgGraph token for Conditional Access and Intune           */
/* -------------------------------------------------------------------------- */

// After a failed Connect-MgGraph mint, requests go straight to the Az token for a while instead of paying a pwsh spawn each.
let graphSdkRetryAt = 0;
let graphSdkError = "";

/**
 * Conditional Access writes need Policy.ReadWrite.ConditionalAccess and Intune needs
 * DeviceManagementConfiguration.ReadWrite.All; the Az token's client never carries
 * either, the persisted Connect-MgGraph sign-in can. Falls back to "az" (and its 403).
 */
async function delegatedTokenSource(timeoutMs: number): Promise<TokenSource> {
  // No persisted sign-in: skip the pwsh spawn (and the cooldown), so a fresh sign-in counts at once.
  if (!existsSync(join(homedir(), ".mg", "mg.authrecord.json"))) {
    graphSdkError = "no persisted Connect-MgGraph sign-in in ~/.mg";
    return "az";
  }
  if (Date.now() < graphSdkRetryAt) return "az";
  try {
    await getGraphSdkAccessToken(Math.max(timeoutMs, 30_000));
    return "graph-sdk";
  } catch (error) {
    graphSdkRetryAt = Date.now() + 5 * 60_000;
    graphSdkError = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200);
    console.warn(`[mcp-msgraph] delegated Connect-MgGraph token unavailable, using the Az token for 5 min: ${graphSdkError}`);
    return "az";
  }
}

const SIGN_IN_HINT = "run scripts/Connect-ContextPaneGraph.ps1 once to persist a delegated sign-in with Policy.ReadWrite.ConditionalAccess and DeviceManagementConfiguration.ReadWrite.All";

async function delegatedFetch(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const source = await delegatedTokenSource(timeoutMs);
  try {
    return await graphFetch(path, init, timeoutMs, source);
  } catch (error) {
    if (error instanceof GraphHttpError && (error.status === 403 || error.status === 401)) {
      const hint = source === "az" ? `the Az token lacks the scope${graphSdkError ? ` (delegated sign-in: ${graphSdkError})` : ""}; ${SIGN_IN_HINT}` : `the Connect-MgGraph token lacks the scope or role; ${SIGN_IN_HINT}`;
      throw new GraphHttpError(error.status, `${error.message.replace(/^Graph HTTP \d+: /, "")} (${hint})`);
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Users with their lab license extension (ANOM-LIC-101)                       */
/* -------------------------------------------------------------------------- */

export interface LiveLabUser {
  upn: string;
  objectId: string;
  displayName: string;
  jobTitle: string | null;
  accountEnabled: boolean;
  extension: Record<string, unknown> | null;
}

/** Users plus their open extension in one $batch; users that do not exist are left out. */
export async function fetchLabUsersLive(upns: string[], timeoutMs: number): Promise<LiveLabUser[]> {
  const requests = upns.slice(0, 10).flatMap((upn, i) => [
    { id: `u${i}`, url: `/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName,displayName,jobTitle,accountEnabled` },
    { id: `x${i}`, url: `/users/${encodeURIComponent(upn)}/extensions/${EXTENSION_ID}` },
  ]);
  const responses = await graphBatch(requests, timeoutMs);
  const users: LiveLabUser[] = [];
  upns.slice(0, 10).forEach((upn, i) => {
    const u = responses.get(`u${i}`);
    if (!u || u.status >= 300 || !u.body) return;
    const x = responses.get(`x${i}`);
    const body = u.body as unknown as { id: string; displayName: string; jobTitle?: string | null; accountEnabled?: boolean };
    users.push({
      upn,
      objectId: body.id,
      displayName: body.displayName,
      jobTitle: body.jobTitle ?? null,
      accountEnabled: body.accountEnabled !== false,
      extension: x && x.status < 300 && x.body ? stripODataKeys(x.body) : null,
    });
  });
  return users;
}

/* -------------------------------------------------------------------------- */
/* Conditional Access posture (ANOM-CA-204)                                    */
/* -------------------------------------------------------------------------- */

export interface LiveCaPosture {
  policies: LiveCaPolicy[];
  /** displayName → object id for the groups the posture refers to (missing groups are absent). */
  groupIds: Map<string, string>;
}

/** All Conditional Access policies plus the object ids of the named groups, in one $batch. */
export async function fetchCaPostureLive(groupNames: string[], timeoutMs: number): Promise<LiveCaPosture> {
  const responses = await graphBatch(
    [
      { id: "policies", url: "/identity/conditionalAccess/policies" },
      ...groupNames.map((name, i) => ({ id: `g${i}`, url: `/groups?$filter=${encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`)}&$select=id,displayName` })),
    ],
    timeoutMs,
  );
  const policies = ((okBody(responses, "policies").value ?? []) as GraphPolicy[]).map(mapPolicy);
  const groupIds = new Map<string, string>();
  groupNames.forEach((name, i) => {
    const r = responses.get(`g${i}`);
    const first = (r && r.status < 300 ? (r.body?.value ?? []) : [])[0] as { id?: string } | undefined;
    if (first?.id) groupIds.set(name, first.id);
  });
  return { policies, groupIds };
}

/** PATCH one Conditional Access policy (state and/or conditions.users.excludeGroups). */
export async function patchCaPolicyLive(policyId: string, body: Record<string, unknown>, timeoutMs: number): Promise<void> {
  await delegatedFetch(`/identity/conditionalAccess/policies/${encodeURIComponent(policyId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
}

/* -------------------------------------------------------------------------- */
/* Intune (ANOM-INT-309, INC-4099)                                             */
/* -------------------------------------------------------------------------- */

export interface LiveIntuneState {
  /** "block" | "audit" | … for the probed ASR rule; null when the policy or rule is absent. */
  asrRuleValue: string | null;
  asrPolicyId: string | null;
  /** Legacy Device Configuration profile, and whether it is still assigned. */
  conflictingProfileId: string | null;
  conflictingProfileAssigned: boolean | null;
  /** Object id of the assignment group, needed to re-assign on a reset. */
  assignmentGroupId: string | null;
}

const BETA = "/beta";

/** Reads the seeded demo Intune objects by display name; throws when none exist so the caller falls back to the fixture. */
export async function fetchIntuneStateLive(
  probe: { asrPolicy?: string; asrRuleSetting?: string; conflictingProfile: string; assignmentGroup: string },
  timeoutMs: number,
): Promise<LiveIntuneState> {
  const [policies, configs, groups] = await Promise.all([
    probe.asrPolicy
      ? (delegatedFetch(`${BETA}/deviceManagement/configurationPolicies?$select=id,name&$top=100`, { method: "GET" }, timeoutMs) as Promise<{ value?: Array<{ id: string; name: string }> }>)
      : Promise.resolve({ value: [] as Array<{ id: string; name: string }> }),
    delegatedFetch(`/deviceManagement/deviceConfigurations?$select=id,displayName`, { method: "GET" }, timeoutMs) as Promise<{ value?: Array<{ id: string; displayName: string }> }>,
    graphFetch(`/groups?$filter=${encodeURIComponent(`displayName eq '${probe.assignmentGroup.replace(/'/g, "''")}'`)}&$select=id`, { method: "GET" }, timeoutMs) as Promise<{ value?: Array<{ id: string }> }>,
  ]);
  const asrPolicy = (policies.value ?? []).find((p) => p.name.endsWith(probe.asrPolicy ?? "\u0000"));
  const profile = (configs.value ?? []).find((c) => c.displayName.endsWith(probe.conflictingProfile));
  if (!asrPolicy && !profile) throw new Error("no [ContextPane-Demo] Intune objects found in the lab tenant (seed the lab first)");

  let asrRuleValue: string | null = null;
  if (asrPolicy && probe.asrRuleSetting) {
    const settings = JSON.stringify(await delegatedFetch(`${BETA}/deviceManagement/configurationPolicies/${asrPolicy.id}/settings`, { method: "GET" }, timeoutMs));
    asrRuleValue = new RegExp(`${probe.asrRuleSetting}_(block|audit|warn|off)"`, "i").exec(settings)?.[1]?.toLowerCase() ?? null;
  }
  let conflictingProfileAssigned: boolean | null = null;
  if (profile) {
    const assignments = (await delegatedFetch(`/deviceManagement/deviceConfigurations/${profile.id}/assignments`, { method: "GET" }, timeoutMs)) as { value?: unknown[] };
    conflictingProfileAssigned = (assignments.value ?? []).length > 0;
  }
  return {
    asrRuleValue,
    asrPolicyId: asrPolicy?.id ?? null,
    conflictingProfileId: profile?.id ?? null,
    conflictingProfileAssigned,
    assignmentGroupId: groups.value?.[0]?.id ?? null,
  };
}

/**
 * Flips one ASR rule in a Settings Catalog policy. Settings Catalog has no per-setting
 * PATCH: the policy is read with its settings and PUT back with the rule's choice value
 * swapped (…_audit ⟷ …_block).
 */
export async function setAsrRuleLive(policyId: string, ruleSetting: string, value: "block" | "audit", timeoutMs: number): Promise<void> {
  const [policy, settings] = (await Promise.all([
    delegatedFetch(`${BETA}/deviceManagement/configurationPolicies/${policyId}`, { method: "GET" }, timeoutMs),
    delegatedFetch(`${BETA}/deviceManagement/configurationPolicies/${policyId}/settings`, { method: "GET" }, timeoutMs),
  ])) as [Record<string, unknown>, { value?: Array<Record<string, unknown>> }];
  const swapped = JSON.parse(
    JSON.stringify((settings.value ?? []).map((s) => ({ "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting", settingInstance: s.settingInstance }))).replace(
      new RegExp(`(${ruleSetting})_(block|audit|warn|off)"`, "gi"),
      `$1_${value}"`,
    ),
  );
  await delegatedFetch(
    `${BETA}/deviceManagement/configurationPolicies/${policyId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: policy.name,
        description: policy.description ?? "",
        platforms: policy.platforms,
        technologies: policy.technologies,
        roleScopeTagIds: policy.roleScopeTagIds ?? ["0"],
        ...(policy.templateReference ? { templateReference: policy.templateReference } : {}),
        settings: swapped,
      }),
    },
    timeoutMs,
  );
}

/** Replaces the assignments of a Device Configuration profile (null group = unassign). */
export async function assignDeviceConfigurationLive(profileId: string, groupId: string | null, timeoutMs: number): Promise<void> {
  await delegatedFetch(
    `/deviceManagement/deviceConfigurations/${profileId}/assign`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignments: groupId ? [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId } }] : [] }),
    },
    timeoutMs,
  );
}
