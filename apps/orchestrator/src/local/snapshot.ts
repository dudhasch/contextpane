import type { ScenarioId } from "@contextpane/catalog";
import type { IntuneScenarioKey } from "@contextpane/mcp-msgraph";
import { azureIacService, type NsgRule } from "@contextpane/mcp-azure-iac";
import type { CorrelationContext } from "../mcp/context.ts";

/**
 * Pre-change entity snapshot (U-5).
 *
 * At approve time, before any write, the affected entities are read through the same MCP
 * services the forward path reads from (`gatherContext` for licences, Conditional Access,
 * Intune and the workload identity; `getNsgState` for the NSG rule set) and kept per
 * scenario in the convergence store. The snapshot is the ground truth two things are
 * derived from:
 *
 *   - the inverse bundle f⁻¹ (`inverse-rollback.ts`): what to write to put every captured
 *     entity back, instead of a static per-scenario script;
 *   - the read-back probe: after an approved script ran, and after a rollback, the same
 *     entities are read again and compared with the snapshot, so "executed" and "restored"
 *     are claims about the tenant, not about an exit code.
 *
 * Only state is captured, never credentials: SKU part numbers and assignment paths, group
 * names, policy conditions, NSG rules and tags, Intune assignments and setting values.
 */

export interface SnapshotUser {
  upn: string;
  objectId?: string;
  displayName?: string;
  currentSku: string;
  expectedSku: string;
  assignmentState: string;
  assignmentPath: string;
  driftStatus: string;
  /** Security groups the user was in (names). */
  groups: string[];
}

export interface SnapshotCaPolicy {
  id: string;
  displayName: string;
  state: string;
  includeGroups: string[];
  includeGroupIds: string[];
  excludeGroups: string[];
  excludeGroupIds: string[];
  includeUsers: string[];
  targetApps: string[];
  clientAppTypes: string[];
  grantControls: string[];
}

export interface SnapshotNsg {
  id?: string;
  name: string;
  resourceGroup: string;
  location: string;
  tags: Record<string, string>;
  rules: NsgRule[];
}

export interface SnapshotIntune {
  key: IntuneScenarioKey;
  policies: Array<{ id: string; name: string; kind: string; assignedTo: string[]; role: string }>;
  settings: Array<{ policyName: string; settingName: string; settingId?: string; live: string; golden: string; status: string }>;
  devices: Array<{ deviceName: string; complianceState: string }>;
}

export interface SnapshotWorkloadIdentity {
  displayName: string;
  appObjectId: string;
  servicePrincipalId: string;
  owners: string[];
  appRoleAssignments: Array<{ id: string; appRoleId: string; permission: string }>;
  /** Federated identity credentials that existed before the fix (the fix's own FIC is not among them). */
  federatedCredentialNames: string[];
}

export interface EntitySnapshot {
  capturedAt: string;
  scenarioId: string;
  labScenarioId: ScenarioId | null;
  tenantId: string;
  users: SnapshotUser[];
  caPolicies: SnapshotCaPolicy[];
  nsg: SnapshotNsg | null;
  intune: SnapshotIntune | null;
  workloadIdentity: SnapshotWorkloadIdentity | null;
  /** Where each section was read from (live-graph / live-azure / seeded-manifest). */
  sources: Record<string, string>;
}

/** The entity sections an inverse writes; matches the sections `inverse-rollback.ts` derives. */
export type SnapshotInverseSections = Array<"users" | "conditional-access" | "nsg" | "intune" | "workload-identity">;

export interface SnapshotDifference {
  path: string;
  before: unknown;
  after: unknown;
}

const INTUNE_KEY_FOR: Partial<Record<ScenarioId, IntuneScenarioKey>> = { "INC-4099": "INC-4099", "ANOM-INT-309": "ANOM-INT-309" };

/**
 * Reads the entities a fix for this context touches. `upns` narrows the user section to the
 * users the bundle names; an empty list keeps every drifted user the context knows.
 */
export async function captureEntitySnapshot(ctx: CorrelationContext, upns: string[] = []): Promise<EntitySnapshot> {
  const wanted = new Set(upns.map((u) => u.toLowerCase()));
  const sourcesUsed: Record<string, string> = {};
  const users: SnapshotUser[] = (ctx.license?.data.users ?? [])
    .filter((u) => (wanted.size ? wanted.has(u.upn.toLowerCase()) : u.driftStatus !== "compliant" || u.assignmentState !== "Active"))
    .map((u) => ({
      upn: u.upn,
      ...(u.objectId ? { objectId: u.objectId } : {}),
      ...(u.displayName ? { displayName: u.displayName } : {}),
      currentSku: u.currentSku,
      expectedSku: u.expectedSku,
      assignmentState: u.assignmentState,
      assignmentPath: u.assignmentPath,
      driftStatus: u.driftStatus,
      groups: [...(ctx.groupsByUpn.get(u.upn.toLowerCase()) ?? [])],
    }));
  if (ctx.license) sourcesUsed.users = ctx.license.source;

  const caPolicies: SnapshotCaPolicy[] = [];
  for (const p of ctx.policies?.data ?? []) {
    caPolicies.push({
      id: p.id,
      displayName: p.displayName,
      state: p.state,
      includeGroups: p.includeGroupNames,
      includeGroupIds: p.includeGroupIds,
      excludeGroups: p.excludeGroupNames,
      excludeGroupIds: p.excludeGroupIds,
      includeUsers: [],
      targetApps: p.targetApps.map((a) => a.displayName),
      clientAppTypes: [],
      grantControls: p.grant.builtInControls,
    });
  }
  if (ctx.policies) sourcesUsed.caPolicies = ctx.policies.source;
  for (const p of ctx.caPosture?.data.policies ?? []) {
    if (caPolicies.some((x) => x.id === p.id || x.displayName === p.displayName)) continue;
    caPolicies.push({
      id: p.id,
      displayName: p.displayName,
      state: p.state,
      includeGroups: p.includeGroups,
      includeGroupIds: [],
      excludeGroups: p.excludeGroups,
      excludeGroupIds: [],
      includeUsers: [],
      targetApps: p.targetApps,
      clientAppTypes: p.clientAppTypes ?? [],
      grantControls: p.grantControls,
    });
  }
  if (ctx.caPosture) sourcesUsed.caPosture = ctx.caPosture.source;

  let nsg: SnapshotNsg | null = null;
  if (ctx.drift) {
    try {
      // The same service the forward NSG write (setNsgState) reads through; lab.ts imports it the same way.
      const state = await azureIacService.getNsgState(ctx.tenantId);
      nsg = { ...(state.data.id ? { id: state.data.id } : {}), name: state.data.name, resourceGroup: state.data.resourceGroup, location: state.data.location, tags: { ...state.data.tags }, rules: state.data.rules.map((r) => ({ ...r })) };
      sourcesUsed.nsg = state.source;
    } catch (error) {
      sourcesUsed.nsg = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  let intune: SnapshotIntune | null = null;
  if (ctx.intune) {
    const key = (ctx.scenarioId && INTUNE_KEY_FOR[ctx.scenarioId]) ?? (ctx.tenantId === "tenant-fabrikam-02" ? "INC-4099" : "ANOM-INT-309");
    intune = {
      key,
      policies: ctx.intune.data.policies.map((p) => ({ id: p.id, name: p.name, kind: p.kind, assignedTo: [...p.assignedTo], role: p.role })),
      settings: ctx.intune.data.settings.map((s) => ({ policyName: s.policyName, settingName: s.settingName, ...(s.settingId ? { settingId: s.settingId } : {}), live: s.live, golden: s.golden, status: s.status })),
      devices: ctx.intune.data.devices.map((d) => ({ deviceName: d.deviceName, complianceState: d.complianceState })),
    };
    sourcesUsed.intune = ctx.intune.source;
  }

  let workloadIdentity: SnapshotWorkloadIdentity | null = null;
  if (ctx.workloadIdentity) {
    const w = ctx.workloadIdentity;
    workloadIdentity = {
      displayName: w.spn.displayName,
      appObjectId: w.spn.objectId,
      servicePrincipalId: w.spn.servicePrincipalId,
      owners: [w.owner.upn],
      appRoleAssignments: w.appRoleAssignments.map((a) => ({ id: a.id, appRoleId: a.appRoleId, permission: a.permission })),
      federatedCredentialNames: [],
    };
    sourcesUsed.workloadIdentity = ctx.sourcesUsed.workloadIdentity ?? "fixture";
  }

  return {
    capturedAt: new Date().toISOString(),
    scenarioId: ctx.ticketId,
    labScenarioId: ctx.scenarioId,
    tenantId: ctx.tenantId,
    users,
    caPolicies,
    nsg,
    intune,
    workloadIdentity,
    sources: sourcesUsed,
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));
}

/**
 * Deep comparison of the state sections (timestamps, sources and resource ids are not state).
 * The result names what differs, per entity, for the canary read and the execution log.
 */
export function compareSnapshots(pre: EntitySnapshot, post: EntitySnapshot): { equal: boolean; differences: SnapshotDifference[] } {
  const differences: SnapshotDifference[] = [];
  const byKey = <T>(list: T[], key: (t: T) => string) => new Map(list.map((t) => [key(t), t]));

  const preUsers = byKey(pre.users, (u) => u.upn.toLowerCase());
  const postUsers = byKey(post.users, (u) => u.upn.toLowerCase());
  for (const [upn, before] of preUsers) {
    const after = postUsers.get(upn);
    if (!after) {
      differences.push({ path: `users.${upn}`, before, after: null });
      continue;
    }
    for (const field of ["currentSku", "assignmentState", "assignmentPath", "driftStatus"] as const) {
      if (before[field] !== after[field]) differences.push({ path: `users.${upn}.${field}`, before: before[field], after: after[field] });
    }
    if (stable([...before.groups].sort()) !== stable([...after.groups].sort())) differences.push({ path: `users.${upn}.groups`, before: before.groups, after: after.groups });
  }

  const prePolicies = byKey(pre.caPolicies, (p) => p.displayName);
  const postPolicies = byKey(post.caPolicies, (p) => p.displayName);
  for (const [name, before] of prePolicies) {
    const after = postPolicies.get(name);
    if (!after) {
      differences.push({ path: `caPolicies.${name}`, before, after: null });
      continue;
    }
    if (before.state !== after.state) differences.push({ path: `caPolicies.${name}.state`, before: before.state, after: after.state });
    for (const field of ["includeGroups", "excludeGroups"] as const) {
      if (stable([...before[field]].sort()) !== stable([...after[field]].sort())) differences.push({ path: `caPolicies.${name}.${field}`, before: before[field], after: after[field] });
    }
  }

  if (pre.nsg || post.nsg) {
    const preRules = byKey(pre.nsg?.rules ?? [], (r) => r.name);
    const postRules = byKey(post.nsg?.rules ?? [], (r) => r.name);
    for (const [name, before] of preRules) {
      const after = postRules.get(name);
      if (!after || stable(before) !== stable(after)) differences.push({ path: `nsg.rules.${name}`, before, after: after ?? null });
    }
    for (const [name, after] of postRules) if (!preRules.has(name)) differences.push({ path: `nsg.rules.${name}`, before: null, after });
    if (stable(pre.nsg?.tags ?? {}) !== stable(post.nsg?.tags ?? {})) differences.push({ path: "nsg.tags", before: pre.nsg?.tags ?? {}, after: post.nsg?.tags ?? {} });
  }

  if (pre.intune || post.intune) {
    const prePol = byKey(pre.intune?.policies ?? [], (p) => p.name);
    const postPol = byKey(post.intune?.policies ?? [], (p) => p.name);
    for (const [name, before] of prePol) {
      const after = postPol.get(name);
      if (!after || stable([...before.assignedTo].sort()) !== stable([...after.assignedTo].sort())) differences.push({ path: `intune.policies.${name}.assignedTo`, before: before.assignedTo, after: after?.assignedTo ?? null });
    }
    const preSet = byKey(pre.intune?.settings ?? [], (s) => `${s.policyName}|${s.settingName}`);
    const postSet = byKey(post.intune?.settings ?? [], (s) => `${s.policyName}|${s.settingName}`);
    for (const [k, before] of preSet) {
      const after = postSet.get(k);
      if (!after || before.live !== after.live) differences.push({ path: `intune.settings.${k}.live`, before: before.live, after: after?.live ?? null });
    }
  }

  if (pre.workloadIdentity || post.workloadIdentity) {
    const b = pre.workloadIdentity;
    const a = post.workloadIdentity;
    if (stable([...(b?.owners ?? [])].sort()) !== stable([...(a?.owners ?? [])].sort())) differences.push({ path: "workloadIdentity.owners", before: b?.owners ?? [], after: a?.owners ?? [] });
    if (stable((b?.appRoleAssignments ?? []).map((x) => x.appRoleId).sort()) !== stable((a?.appRoleAssignments ?? []).map((x) => x.appRoleId).sort())) {
      differences.push({ path: "workloadIdentity.appRoleAssignments", before: b?.appRoleAssignments.map((x) => x.permission) ?? [], after: a?.appRoleAssignments.map((x) => x.permission) ?? [] });
    }
  }

  return { equal: differences.length === 0, differences };
}
