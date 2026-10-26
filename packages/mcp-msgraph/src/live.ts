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

/** "az": the Get-AzAccessToken bearer every read uses; "graph-sdk": the Connect-MgGraph one (TAP writes). */
type TokenSource = "az" | "graph-sdk";

async function graphFetch(path: string, init: RequestInit, timeoutMs: number, tokenSource: TokenSource = "az"): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = tokenSource === "graph-sdk" ? await getGraphSdkAccessToken(Math.max(timeoutMs, 30_000)) : await getAccessToken(GRAPH, Math.max(timeoutMs, 30_000));
    const response = await fetch(`${GRAPH_V1}${path}`, {
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
      policies: policies.map((p) => ({
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
      })),
    };
  })();
  snapshots.set(groupId, { at: Date.now(), value });
  value.catch(() => snapshots.delete(groupId));
  return value;
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
/* Writes: lab license state + Temporary Access Pass                           */
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
export async function patchLicenseExtensionsLive(upns: string[], fields: Record<string, string>, timeoutMs: number): Promise<ExtensionPatchResult[]> {
  const body = JSON.stringify({ "@odata.type": "#microsoft.graph.openTypeExtension", extensionName: EXTENSION_ID, ...fields });
  const results = await Promise.all(
    upns.map(async (upn): Promise<ExtensionPatchResult> => {
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

export interface LiveTemporaryAccessPass {
  id: string;
  temporaryAccessPass: string;
  lifetimeInMinutes: number;
  isUsableOnce: boolean;
  startDateTime: string;
}

// After a failed Connect-MgGraph mint, TAP requests go straight to the Az token for a while instead of paying a pwsh spawn each.
let graphSdkRetryAt = 0;

/**
 * POST /users/{id}/authentication/temporaryAccessPassMethods; throws GraphHttpError when the TAP policy or token scope says no.
 * Prefers the Connect-MgGraph token (it can carry UserAuthenticationMethod.ReadWrite.All) and falls back to the Az token.
 */
export async function createTemporaryAccessPassLive(upn: string, lifetimeInMinutes: number, isUsableOnce: boolean, timeoutMs: number): Promise<LiveTemporaryAccessPass> {
  let tokenSource: TokenSource = "az";
  if (Date.now() >= graphSdkRetryAt) {
    try {
      await getGraphSdkAccessToken(Math.max(timeoutMs, 30_000));
      tokenSource = "graph-sdk";
    } catch {
      graphSdkRetryAt = Date.now() + 5 * 60_000;
    }
  }
  let body: Partial<LiveTemporaryAccessPass>;
  try {
    body = (await graphFetch(
      `/users/${encodeURIComponent(upn)}/authentication/temporaryAccessPassMethods`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lifetimeInMinutes, isUsableOnce }) },
      timeoutMs,
      tokenSource,
    )) as Partial<LiveTemporaryAccessPass>;
  } catch (error) {
    if (error instanceof GraphHttpError && error.status === 403) {
      const hint =
        tokenSource === "az"
          ? "the Az token never carries UserAuthenticationMethod.ReadWrite.All; run scripts/Enable-ContextPaneTapPolicy.ps1"
          : "the Connect-MgGraph token lacks UserAuthenticationMethod.ReadWrite.All or an Authentication Administrator role; re-run scripts/Enable-ContextPaneTapPolicy.ps1";
      throw new GraphHttpError(403, `${error.message.replace(/^Graph HTTP 403: /, "")} (${hint})`);
    }
    throw error;
  }
  if (!body.temporaryAccessPass) throw new GraphHttpError(502, "temporaryAccessPassMethods answered without a pass");
  return {
    id: body.id ?? "",
    temporaryAccessPass: body.temporaryAccessPass,
    lifetimeInMinutes: body.lifetimeInMinutes ?? lifetimeInMinutes,
    isUsableOnce: body.isUsableOnce ?? isUsableOnce,
    startDateTime: body.startDateTime ?? new Date().toISOString(),
  };
}
