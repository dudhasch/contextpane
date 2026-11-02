import { TYPED_ACTION_DESCRIPTIONS, type TypedAction, type TypedActionKind } from "@contextpane/catalog";
import { ABAC_LAB, azureIacService, deleteAbacRoleAssignmentsLive, putAbacRoleAssignmentLive } from "@contextpane/mcp-azure-iac";
import { getManifestTenant, msgraphService } from "@contextpane/mcp-msgraph";
import { config, isLiveCloudMode } from "../config.ts";
import { invalidateAbacLabState } from "../local/abac.ts";
import type { CorrelationContext } from "../mcp/context.ts";

/**
 * The typed executors behind the action catalog (packages/catalog/src/typed-actions.ts). Each action
 * has a validator that checks its parameters against the tenant context (only entities the context
 * knows are writable), a forward write through the same Graph / ARM service calls the lab scenarios
 * use, and an inverse. Approve runs these instead of a model-written script whenever the drawer
 * carries a typed action; like a script, they only write live under LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE.
 */

export interface TypedActionOutcome {
  /** True when every row of the write succeeded against the tenant. */
  ok: boolean;
  source: "live" | "simulated";
  latencyMs: number;
  summary: string;
  results: Array<{ id: string; ok: boolean; status: number; error?: string }>;
  log: string[];
  fallbackReason?: string;
}

interface TypedActionDefinition<K extends TypedActionKind> {
  /** Problems with the parameters for this context; empty when the action may run. */
  validate(params: Extract<TypedAction, { kind: K }>["params"], ctx: CorrelationContext | null): string[];
  execute(params: Extract<TypedAction, { kind: K }>["params"], meta: { ticketId: string; approvedBy: string }): Promise<TypedActionOutcome>;
  inverse(params: Extract<TypedAction, { kind: K }>["params"]): Promise<TypedActionOutcome>;
  describe(params: Extract<TypedAction, { kind: K }>["params"]): string;
}

function simulated(summary: string, fallbackReason: string, log: string[] = []): TypedActionOutcome {
  return { ok: false, source: "simulated", latencyMs: 0, summary, results: [], log, fallbackReason };
}

/** Users the context lists for the tenant (live inventory first, the lab manifest otherwise). */
function knownUpns(tenantId: string, ctx: CorrelationContext | null): Set<string> {
  const upns = new Set<string>();
  for (const u of ctx?.license?.data.users ?? []) upns.add(u.upn.toLowerCase());
  try {
    for (const u of getManifestTenant(tenantId).users) upns.add(u.upn.toLowerCase());
  } catch {
    /* tenant not in the manifest: only the live inventory counts */
  }
  return upns;
}

const abacGrant: TypedActionDefinition<"abac-conditioned-role-grant"> = {
  validate(params) {
    return (ABAC_LAB.containers as readonly string[]).includes(params.container) ? [] : [`container '${params.container}' is not a container of ${ABAC_LAB.storageAccount}`];
  },
  async execute(params, meta) {
    const res = await putAbacRoleAssignmentLive({ container: params.container, description: `ContextPane ${meta.ticketId} · ${ABAC_LAB.roleName} limited to ${params.container} · approved by ${meta.approvedBy}` }).catch((error: unknown) => ({
      ok: false as const,
      status: 0,
      latencyMs: 0,
      assignmentId: null,
      principalId: null,
      condition: "",
      error: error instanceof Error ? error.message : String(error),
      readBack: null,
    }));
    invalidateAbacLabState();
    if (!res.ok) {
      return { ok: false, source: "simulated", latencyMs: res.latencyMs, summary: `ARM write refused`, results: [], log: [`ARM PUT refused: ${res.error ?? `HTTP ${res.status}`}. Nothing was granted; the ticket stays open.`], fallbackReason: res.error ?? `HTTP ${res.status}` };
    }
    const readBackOk = Boolean(res.readBack?.condition?.includes(`'${params.container}'`) && res.readBack.conditionVersion === "2.0");
    return {
      ok: true,
      source: "live",
      latencyMs: res.latencyMs,
      summary: `${ABAC_LAB.roleName} granted to ${ABAC_LAB.identityName} on ${ABAC_LAB.storageAccount}, condition: container = ${params.container}`,
      results: [{ id: res.assignmentId ?? "roleAssignment", ok: true, status: res.status }],
      log: [
        `ARM PUT ${res.assignmentId} → HTTP ${res.status} in ${res.latencyMs} ms · ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`,
        `Read-back: ${ABAC_LAB.roleName} for ${ABAC_LAB.identityName}, conditionVersion ${res.readBack?.conditionVersion ?? "?"}, container = ${params.container} ${readBackOk ? "✓" : "(condition not confirmed)"}`,
      ],
    };
  },
  async inverse() {
    const res = await deleteAbacRoleAssignmentsLive();
    invalidateAbacLabState();
    return {
      ok: res.failed.length === 0,
      source: "live",
      latencyMs: res.latencyMs,
      summary: res.removed.length ? `Removed ${res.removed.length} ${ABAC_LAB.roleName} assignment${res.removed.length === 1 ? "" : "s"}` : "No assignment to remove",
      results: [...res.removed.map((id) => ({ id, ok: true, status: 200 })), ...res.failed.map((id) => ({ id, ok: false, status: 0 }))],
      log: [res.removed.length ? `Removed ${res.removed.length} assignment${res.removed.length === 1 ? "" : "s"} in ${res.latencyMs} ms · ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}` : "No assignment to remove", ...(res.failed.length ? [`${res.failed.length} delete(s) failed`] : [])],
    };
  },
  describe(params) {
    return `${ABAC_LAB.roleName} for ${ABAC_LAB.identityName} on ${ABAC_LAB.storageAccount}, limited to container ${params.container}`;
  },
};

const licenseRemediate: TypedActionDefinition<"license-extension-remediate"> = {
  validate(params, ctx) {
    const issues: string[] = [];
    if (ctx && ctx.tenantId !== params.tenantId) issues.push(`tenant ${params.tenantId} is not the ticket's tenant (${ctx.tenantId})`);
    const known = knownUpns(params.tenantId, ctx);
    for (const upn of params.upns) if (!known.has(upn.toLowerCase())) issues.push(`${upn} is not a user of ${params.tenantId} in the gathered context`);
    return issues;
  },
  async execute(params) {
    const w = await msgraphService.setLicenseExtensionState(params.tenantId, params.upns, "remediated");
    const ok = w.results.filter((r) => r.ok).length;
    return {
      ok: w.source === "live-graph" && ok === w.results.length,
      source: w.source === "live-graph" ? "live" : "simulated",
      latencyMs: w.latencyMs,
      summary: `${ok}/${w.results.length} users → SPE_E5 / Compliant`,
      results: w.results.map((r) => ({ id: r.upn, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })),
      log: [`Graph licence extension → remediated for ${params.upns.length} user${params.upns.length === 1 ? "" : "s"} (${w.source})`],
      ...(w.fallbackReason ? { fallbackReason: w.fallbackReason } : {}),
    };
  },
  async inverse(params) {
    const w = await msgraphService.setLicenseExtensionState(params.tenantId, params.upns, "drifted");
    const ok = w.results.filter((r) => r.ok).length;
    return {
      ok: w.source === "live-graph" && ok === w.results.length,
      source: w.source === "live-graph" ? "live" : "simulated",
      latencyMs: w.latencyMs,
      summary: `${ok}/${w.results.length} users → drifted licence state`,
      results: w.results.map((r) => ({ id: r.upn, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })),
      log: [`Graph licence extension → drifted for ${params.upns.length} user${params.upns.length === 1 ? "" : "s"} (${w.source})`],
      ...(w.fallbackReason ? { fallbackReason: w.fallbackReason } : {}),
    };
  },
  describe(params) {
    return `Licence state → SPE_E5 / Compliant for ${params.upns.join(", ")}`;
  },
};

const nsgRestore: TypedActionDefinition<"nsg-baseline-restore"> = {
  validate(params, ctx) {
    const issues: string[] = [];
    if (ctx && ctx.tenantId !== params.tenantId) issues.push(`tenant ${params.tenantId} is not the ticket's tenant (${ctx.tenantId})`);
    if (ctx && !ctx.drift) issues.push(`no NSG drift was gathered for ${params.tenantId}`);
    return issues;
  },
  async execute(params) {
    const w = await azureIacService.setNsgState(params.tenantId, "remediated");
    const okRows = w.results.filter((r) => r.ok).length;
    return {
      ok: w.source === "live-azure" && okRows === w.results.length,
      source: w.source === "live-azure" ? "live" : "simulated",
      latencyMs: w.latencyMs,
      summary: `NSG → Terraform baseline (${w.results.map((r) => r.id).join(", ") || "already at target"})`,
      results: w.results.map((r) => ({ id: `nsg ${r.id}`, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })),
      log: [`ARM NSG reconcile → baseline (${w.source})`],
      ...(w.fallbackReason ? { fallbackReason: w.fallbackReason } : {}),
    };
  },
  async inverse(params) {
    const w = await azureIacService.setNsgState(params.tenantId, "drifted");
    const okRows = w.results.filter((r) => r.ok).length;
    return {
      ok: w.source === "live-azure" && okRows === w.results.length,
      source: w.source === "live-azure" ? "live" : "simulated",
      latencyMs: w.latencyMs,
      summary: `NSG → seeded drift (${w.results.map((r) => r.id).join(", ") || "already at target"})`,
      results: w.results.map((r) => ({ id: `nsg ${r.id}`, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })),
      log: [`ARM NSG reconcile → seeded drift (${w.source})`],
      ...(w.fallbackReason ? { fallbackReason: w.fallbackReason } : {}),
    };
  },
  describe(params) {
    return `NSG of ${params.tenantId} → Terraform baseline`;
  },
};

const REGISTRY: { [K in TypedActionKind]: TypedActionDefinition<K> } = {
  "abac-conditioned-role-grant": abacGrant,
  "license-extension-remediate": licenseRemediate,
  "nsg-baseline-restore": nsgRestore,
};

function definition<K extends TypedActionKind>(kind: K): TypedActionDefinition<K> {
  return REGISTRY[kind];
}

export function validateTypedAction(action: TypedAction, ctx: CorrelationContext | null): string[] {
  return definition(action.kind).validate(action.params as never, ctx);
}

export function describeTypedAction(action: TypedAction): { summary: string; forward: string; inverse: string } {
  return { summary: definition(action.kind).describe(action.params as never), ...TYPED_ACTION_DESCRIPTIONS[action.kind] };
}

/** Why a typed action will not write live right now, or null when it will. */
export function typedActionGate(): string | null {
  if (!isLiveCloudMode()) return "Simulated-Lab mode";
  if (!config.allowExecute) return "CTX_ALLOW_EXECUTE=false";
  return null;
}

/** The forward write. Outside LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE nothing is called and the action stays staged. */
export async function executeTypedAction(action: TypedAction, meta: { ticketId: string; approvedBy: string }, ctx: CorrelationContext | null = null): Promise<TypedActionOutcome> {
  const issues = validateTypedAction(action, ctx);
  if (issues.length) return simulated(`${action.kind} rejected`, issues.join("; "), [`Typed action ${action.kind} rejected: ${issues.join("; ")}`]);
  const gate = typedActionGate();
  if (gate) return simulated(`${describeTypedAction(action).summary} · staged, not executed`, gate, [`No write (${gate}): typed action ${action.kind} is staged.`]);
  return definition(action.kind).execute(action.params as never, meta);
}

/** The inverse write, under the same gate as the forward one. */
export async function invertTypedAction(action: TypedAction): Promise<TypedActionOutcome> {
  const gate = typedActionGate();
  if (gate) return simulated(`inverse of ${action.kind} · staged, not executed`, gate, [`Revert staged, not executed (${gate})`]);
  return definition(action.kind).inverse(action.params as never);
}
