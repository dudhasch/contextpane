import { randomUUID } from "node:crypto";
import { getAccessToken, invalidateAccessToken } from "./token.ts";

/**
 * The Act II ABAC estate in the live lab (seeded by scripts/seed-abac-lab.ps1): a payroll storage
 * account, the Function App's identity and a deny policy that only lets Storage Blob Data
 * Contributor be granted together with an ABAC condition.
 *
 * Every read and write here targets the lab subscription by its id and refuses any other
 * subscription or tenant, whatever the cached Az context currently points at.
 */

const ARM = "https://management.azure.com";

export const ABAC_LAB = {
  tenantId: "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea",
  tenantDomain: "c4a8shili.onmicrosoft.com",
  subscriptionId: "20505597-043c-4742-a884-42dc3f621aef",
  subscriptionName: "MSDN - Timur - 1",
  /** The management group the lab subscription sits under. */
  managementGroup: "mg-msdn-prd",
  resourceGroup: "rg-contoso-payroll-prod",
  storageAccount: "stcontosolzprod01",
  containers: ["payroll-drop", "payroll-archive", "payroll-exports"],
  identityName: "func-contoso-payroll-ingest",
  policyName: "Require-ABAC-StorageBlobDataContributor",
  /** Storage Blob Data Contributor. */
  roleDefinitionGuid: "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  roleName: "Storage Blob Data Contributor",
  requesterUpn: "marcus.vance@c4a8shili.onmicrosoft.com",
  requesterName: "Marcus Vance",
} as const;

const RG_PATH = `/subscriptions/${ABAC_LAB.subscriptionId}/resourceGroups/${ABAC_LAB.resourceGroup}`;
export const ABAC_STORAGE_SCOPE = `${RG_PATH}/providers/Microsoft.Storage/storageAccounts/${ABAC_LAB.storageAccount}`;
export const ABAC_ROLE_DEFINITION_ID = `/subscriptions/${ABAC_LAB.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${ABAC_LAB.roleDefinitionGuid}`;

/** The blob actions the condition governs; any other action of the role passes through unconditioned. */
const CONDITIONED_ACTIONS = [
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write",
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action",
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/delete",
];

/** The bare ABAC expression, as the clarifier and the rail show it. */
export function abacExpression(container: string): string {
  return `@Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringEqualsIgnoreCase '${container}'`;
}

/**
 * The condition in the canonical `(!(ActionMatches…) OR expression)` form: what ARM stores and what the
 * portal's "View/edit condition" editor renders visually. It carries `abacExpression` verbatim.
 */
export function abacCondition(container: string): string {
  const actions = CONDITIONED_ACTIONS.map((a) => `!(ActionMatches{'${a}'})`).join(" AND ");
  return `((${actions}) OR (${abacExpression(container)}))`;
}

export class AbacGuardError extends Error {}

/** Throws unless the id is the lab subscription. Called before every ARM call this module makes. */
export function assertAbacLabSubscription(subscriptionId: string): void {
  if (subscriptionId.toLowerCase() !== ABAC_LAB.subscriptionId) {
    throw new AbacGuardError(`Refusing ARM call: subscription ${subscriptionId} is not the lab subscription ${ABAC_LAB.subscriptionId} (${ABAC_LAB.subscriptionName})`);
  }
}

async function arm<T>(method: "GET" | "PUT" | "DELETE", path: string, apiVersion: string, timeoutMs: number, body?: unknown): Promise<{ status: number; body: T }> {
  const sub = /^\/subscriptions\/([^/]+)/i.exec(path)?.[1];
  if (!sub) throw new AbacGuardError(`Refusing ARM call outside a subscription: ${path}`);
  assertAbacLabSubscription(sub);
  const sep = path.includes("?") ? "&" : "?";
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(`${ARM}/`, Math.max(timeoutMs, 30_000));
    const response = await fetch(`${ARM}${path}${sep}api-version=${apiVersion}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 && attempt === 0) {
      invalidateAccessToken(`${ARM}/`);
      continue;
    }
    const parsed = (await response.json().catch(() => ({}))) as T;
    return { status: response.status, body: parsed };
  }
  throw new Error("ARM token rejected twice");
}

function armError(status: number, body: unknown): string {
  const err = (body as { error?: { code?: string; message?: string } }).error;
  return `HTTP ${status}${err?.code ? ` ${err.code}` : ""}${err?.message ? `: ${err.message}` : ""}`;
}

/** The token's tenant must be the lab tenant: a token from another directory never reaches a write. */
async function assertLabTenant(timeoutMs: number): Promise<void> {
  const res = await arm<{ tenantId?: string }>("GET", `/subscriptions/${ABAC_LAB.subscriptionId}`, "2022-12-01", timeoutMs);
  if (res.status !== 200) throw new AbacGuardError(`Lab subscription not reachable with the current Az sign-in (${armError(res.status, res.body)}). Run Connect-AzAccount -Tenant ${ABAC_LAB.tenantDomain}.`);
  if (res.body.tenantId && res.body.tenantId !== ABAC_LAB.tenantId) throw new AbacGuardError(`Lab subscription answered from tenant ${res.body.tenantId}, expected ${ABAC_LAB.tenantId}`);
}

export interface AbacRoleAssignmentRow {
  id: string;
  name: string;
  principalId: string;
  roleDefinitionId: string;
  scope: string;
  condition: string | null;
  conditionVersion: string | null;
  createdOn: string | null;
}

export interface AbacActivityEvent {
  id: string;
  timestamp: string;
  operation: string;
  status: "Failed" | "Succeeded";
  code: string;
  caller: string;
  resource: string;
  detail: string;
  /** live: read from the Activity Log API; ticket: correlated from the ticket's own error payload. */
  source: "live" | "ticket";
}

export interface AbacLabState {
  source: "live" | "fixture";
  readAt: string;
  latencyMs: number;
  fallbackReason?: string;
  subscription: { id: string; name: string; tenantId: string };
  storage: { name: string; id: string; location: string; kind: string; sku: string; exists: boolean };
  containers: Array<{ name: string; exists: boolean }>;
  identity: { name: string; id: string; principalId: string | null; kind: "user-assigned" | "function-app" | "missing" };
  policy: {
    assignmentName: string;
    assignmentId: string;
    scope: string;
    definitionId: string;
    definitionScope: string;
    effect: string;
    enforcement: string;
    exists: boolean;
  };
  assignments: AbacRoleAssignmentRow[];
  activity: AbacActivityEvent[];
}

interface ArmRoleAssignment {
  id: string;
  name: string;
  properties: { principalId: string; roleDefinitionId: string; scope: string; condition?: string | null; conditionVersion?: string | null; createdOn?: string };
}

function toRow(a: ArmRoleAssignment): AbacRoleAssignmentRow {
  return {
    id: a.id,
    name: a.name,
    principalId: a.properties.principalId,
    roleDefinitionId: a.properties.roleDefinitionId,
    scope: a.properties.scope,
    condition: a.properties.condition ?? null,
    conditionVersion: a.properties.conditionVersion ?? null,
    createdOn: a.properties.createdOn ?? null,
  };
}

/** The ticket's own error payload as an Activity Log row: what the requester's deployment hit. */
export function ticketActivityEvent(input: { timestamp: string; caller?: string; correlationId?: string }): AbacActivityEvent {
  return {
    id: input.correlationId ?? "abac-ticket-event",
    timestamp: input.timestamp,
    operation: "Microsoft.Authorization/roleAssignments/write",
    status: "Failed",
    code: "RequestDisallowedByPolicy",
    caller: input.caller ?? ABAC_LAB.requesterUpn,
    resource: `${ABAC_LAB.storageAccount} · ${ABAC_LAB.roleName} → ${ABAC_LAB.identityName}`,
    detail: `Resource '${ABAC_LAB.storageAccount}' was disallowed by policy '${ABAC_LAB.policyName}': ${ABAC_LAB.roleName} may only be assigned with an ABAC condition.`,
    source: "ticket",
  };
}

/** Deterministic lab state for Simulated-Lab mode and for a failed live read. */
export function fixtureAbacLabState(fallbackReason?: string): AbacLabState {
  const readAt = new Date().toISOString();
  return {
    source: "fixture",
    readAt,
    latencyMs: 0,
    ...(fallbackReason ? { fallbackReason } : {}),
    subscription: { id: ABAC_LAB.subscriptionId, name: ABAC_LAB.subscriptionName, tenantId: ABAC_LAB.tenantId },
    storage: { name: ABAC_LAB.storageAccount, id: ABAC_STORAGE_SCOPE, location: "westeurope", kind: "StorageV2", sku: "Standard_LRS", exists: true },
    containers: ABAC_LAB.containers.map((name) => ({ name, exists: true })),
    identity: { name: ABAC_LAB.identityName, id: `${RG_PATH}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${ABAC_LAB.identityName}`, principalId: null, kind: "user-assigned" },
    policy: {
      assignmentName: ABAC_LAB.policyName,
      assignmentId: `${RG_PATH}/providers/Microsoft.Authorization/policyAssignments/${ABAC_LAB.policyName}`,
      scope: RG_PATH,
      definitionId: `/subscriptions/${ABAC_LAB.subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/${ABAC_LAB.policyName}`,
      definitionScope: `/subscriptions/${ABAC_LAB.subscriptionId}`,
      effect: "Deny",
      enforcement: "Default",
      exists: true,
    },
    assignments: [],
    activity: [],
  };
}

async function resolvePrincipal(timeoutMs: number): Promise<AbacLabState["identity"]> {
  const uami = await arm<{ id?: string; properties?: { principalId?: string } }>(
    "GET",
    `${RG_PATH}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${ABAC_LAB.identityName}`,
    "2023-01-31",
    timeoutMs,
  );
  if (uami.status === 200 && uami.body.properties?.principalId) {
    return { name: ABAC_LAB.identityName, id: uami.body.id ?? "", principalId: uami.body.properties.principalId, kind: "user-assigned" };
  }
  const site = await arm<{ id?: string; identity?: { principalId?: string } }>("GET", `${RG_PATH}/providers/Microsoft.Web/sites/${ABAC_LAB.identityName}`, "2023-12-01", timeoutMs);
  if (site.status === 200 && site.body.identity?.principalId) {
    return { name: ABAC_LAB.identityName, id: site.body.id ?? "", principalId: site.body.identity.principalId, kind: "function-app" };
  }
  return { name: ABAC_LAB.identityName, id: "", principalId: null, kind: "missing" };
}

async function listRoleAssignments(principalId: string | null, timeoutMs: number): Promise<AbacRoleAssignmentRow[]> {
  const filter = principalId ? `?$filter=${encodeURIComponent(`principalId eq '${principalId}'`)}` : `?$filter=${encodeURIComponent("atScope()")}`;
  const res = await arm<{ value?: ArmRoleAssignment[] }>("GET", `${ABAC_STORAGE_SCOPE}/providers/Microsoft.Authorization/roleAssignments${filter}`, "2022-04-01", timeoutMs);
  if (res.status !== 200) throw new Error(`role assignments: ${armError(res.status, res.body)}`);
  return (res.body.value ?? [])
    .map(toRow)
    .filter((r) => r.roleDefinitionId.toLowerCase().endsWith(ABAC_LAB.roleDefinitionGuid) && r.scope.toLowerCase() === ABAC_STORAGE_SCOPE.toLowerCase());
}

/** Failed role-assignment writes in the payroll resource group from the last 24 h (the API lags ingestion by minutes). */
async function readActivityLog(timeoutMs: number): Promise<AbacActivityEvent[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const filter = encodeURIComponent(`eventTimestamp ge '${since}' and resourceGroupName eq '${ABAC_LAB.resourceGroup}'`);
  const res = await arm<{
    value?: Array<{
      eventDataId: string;
      eventTimestamp: string;
      caller?: string;
      operationName?: { value?: string };
      status?: { value?: string };
      resourceId?: string;
      properties?: { statusCode?: string; statusMessage?: string };
    }>;
  }>("GET", `/subscriptions/${ABAC_LAB.subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values?$filter=${filter}`, "2015-04-01", timeoutMs);
  if (res.status !== 200) return [];
  return (res.body.value ?? [])
    .filter((e) => /roleAssignments\/write/i.test(e.operationName?.value ?? "") && /Failed/i.test(e.status?.value ?? "") && /RequestDisallowedByPolicy/.test(e.properties?.statusMessage ?? ""))
    .slice(0, 5)
    .map((e) => ({
      id: e.eventDataId,
      timestamp: e.eventTimestamp,
      operation: e.operationName?.value ?? "Microsoft.Authorization/roleAssignments/write",
      status: "Failed" as const,
      code: "RequestDisallowedByPolicy",
      caller: e.caller ?? "unknown",
      resource: (e.resourceId ?? "").split("/").slice(-3).join("/"),
      detail: (() => {
        try {
          const msg = JSON.parse(e.properties?.statusMessage ?? "{}") as { error?: { message?: string } };
          return (msg.error?.message ?? "").slice(0, 240);
        } catch {
          return "";
        }
      })(),
      source: "live" as const,
    }));
}

/**
 * Reads the ABAC estate live: storage account, containers, the Function App identity, the deny policy
 * and the identity's current Storage Blob Data Contributor assignments on the account. The Activity
 * Log read gets a short budget of its own and never blocks the rest.
 */
export async function readAbacLabLive(timeoutMs = 8000): Promise<AbacLabState> {
  const started = performance.now();
  await assertLabTenant(timeoutMs);
  const [sub, storage, containers, identity, policy, activity] = await Promise.all([
    arm<{ displayName?: string; tenantId?: string }>("GET", `/subscriptions/${ABAC_LAB.subscriptionId}`, "2022-12-01", timeoutMs),
    arm<{ id?: string; location?: string; kind?: string; sku?: { name?: string } }>("GET", ABAC_STORAGE_SCOPE, "2023-05-01", timeoutMs),
    arm<{ value?: Array<{ name: string }> }>("GET", `${ABAC_STORAGE_SCOPE}/blobServices/default/containers`, "2023-05-01", timeoutMs),
    resolvePrincipal(timeoutMs),
    arm<{ id?: string; properties?: { policyDefinitionId?: string; scope?: string; enforcementMode?: string } }>(
      "GET",
      `${RG_PATH}/providers/Microsoft.Authorization/policyAssignments/${ABAC_LAB.policyName}`,
      "2022-06-01",
      timeoutMs,
    ),
    readActivityLog(Math.min(timeoutMs, 2500)).catch(() => [] as AbacActivityEvent[]),
  ]);
  const assignments = identity.principalId ? await listRoleAssignments(identity.principalId, timeoutMs) : [];
  const definitionId = policy.body.properties?.policyDefinitionId ?? "";
  const containerNames = new Set((containers.body.value ?? []).map((c) => c.name));
  return {
    source: "live",
    readAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    subscription: { id: ABAC_LAB.subscriptionId, name: sub.body.displayName ?? ABAC_LAB.subscriptionName, tenantId: sub.body.tenantId ?? ABAC_LAB.tenantId },
    storage: {
      name: ABAC_LAB.storageAccount,
      id: storage.body.id ?? ABAC_STORAGE_SCOPE,
      location: storage.body.location ?? "",
      kind: storage.body.kind ?? "",
      sku: storage.body.sku?.name ?? "",
      exists: storage.status === 200,
    },
    containers: [...new Set([...ABAC_LAB.containers, ...containerNames])].map((name) => ({ name, exists: containerNames.has(name) })),
    identity,
    policy: {
      assignmentName: ABAC_LAB.policyName,
      assignmentId: policy.body.id ?? "",
      scope: policy.body.properties?.scope ?? RG_PATH,
      definitionId,
      definitionScope: definitionId.split("/providers/Microsoft.Authorization/policyDefinitions/")[0] ?? "",
      effect: "Deny",
      enforcement: policy.body.properties?.enforcementMode ?? "",
      exists: policy.status === 200,
    },
    assignments,
    activity,
  };
}

export interface AbacWriteResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  assignmentId: string | null;
  principalId: string | null;
  condition: string;
  error?: string;
  readBack: AbacRoleAssignmentRow | null;
}

/**
 * Grants the Function App identity Storage Blob Data Contributor on the payroll account with the
 * container condition: one ARM PUT, then a GET of the assignment it created.
 */
export async function putAbacRoleAssignmentLive(input: { container: string; description: string; timeoutMs?: number }): Promise<AbacWriteResult> {
  const started = performance.now();
  const timeoutMs = input.timeoutMs ?? 20_000;
  const condition = abacCondition(input.container);
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/.test(input.container)) {
    return { ok: false, status: 0, latencyMs: 0, assignmentId: null, principalId: null, condition, error: `invalid container name '${input.container}'`, readBack: null };
  }
  await assertLabTenant(timeoutMs);
  const identity = await resolvePrincipal(timeoutMs);
  if (!identity.principalId) {
    return { ok: false, status: 404, latencyMs: Math.round(performance.now() - started), assignmentId: null, principalId: null, condition, error: `identity ${ABAC_LAB.identityName} not found in ${ABAC_LAB.resourceGroup}: run scripts/seed-abac-lab.ps1`, readBack: null };
  }
  const path = `${ABAC_STORAGE_SCOPE}/providers/Microsoft.Authorization/roleAssignments/${randomUUID()}`;
  const res = await arm<ArmRoleAssignment>("PUT", path, "2022-04-01", timeoutMs, {
    properties: {
      roleDefinitionId: ABAC_ROLE_DEFINITION_ID,
      principalId: identity.principalId,
      principalType: "ServicePrincipal",
      condition,
      conditionVersion: "2.0",
      description: input.description.slice(0, 250),
    },
  });
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, latencyMs: Math.round(performance.now() - started), assignmentId: null, principalId: identity.principalId, condition, error: armError(res.status, res.body), readBack: null };
  }
  const readBack = await arm<ArmRoleAssignment>("GET", path, "2022-04-01", timeoutMs).then((r) => (r.status === 200 ? toRow(r.body) : null)).catch(() => null);
  return { ok: true, status: res.status, latencyMs: Math.round(performance.now() - started), assignmentId: res.body.id ?? path, principalId: identity.principalId, condition, readBack };
}

/**
 * The inverse: removes the identity's Storage Blob Data Contributor assignments on the payroll account
 * (every one, conditioned or not), so the next take starts from the ticket's state.
 */
export async function deleteAbacRoleAssignmentsLive(timeoutMs = 20_000): Promise<{ removed: string[]; failed: string[]; latencyMs: number }> {
  const started = performance.now();
  await assertLabTenant(timeoutMs);
  const identity = await resolvePrincipal(timeoutMs);
  if (!identity.principalId) return { removed: [], failed: [], latencyMs: Math.round(performance.now() - started) };
  const rows = await listRoleAssignments(identity.principalId, timeoutMs);
  const removed: string[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    const res = await arm<unknown>("DELETE", row.id, "2022-04-01", timeoutMs);
    (res.status === 200 || res.status === 204 || res.status === 404 ? removed : failed).push(row.id);
  }
  return { removed, failed, latencyMs: Math.round(performance.now() - started) };
}
