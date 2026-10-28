import { z } from "zod";

/**
 * Steering contract (U-1).
 *
 * One typed object carries everything the operator steered: the clarifier pills, a row
 * clicked inside a synthesized card, a card action that sets parameters, or a value typed
 * by hand. Every parameter records where it came from (`source`) and when, so the drawer,
 * the coder prompt and the audit trail read the same thing. `answers` keeps every clarifier
 * answer by question id; the typed keys are the normalised view of those answers plus the
 * in-card steering. `version` / `digest` let a staged script say which steering it was
 * built for, and the drawer flag itself stale when the params moved on.
 */

export const SteeringSourceSchema = z.enum(["clarifier", "row-click", "operator"]);
export type SteeringSource = z.infer<typeof SteeringSourceSchema>;

export const SteeringStrategySchema = z.enum(["recover", "purge-recreate", "gitops-bundle", "in-place", "custom"]);
export type SteeringStrategy = z.infer<typeof SteeringStrategySchema>;

export const SteeringScopeSchema = z.enum(["production-scoped", "staging-first", "tenant-wide", "custom"]);
export type SteeringScope = z.infer<typeof SteeringScopeSchema>;

export const SteeringGovernanceSchema = z.enum(["least-privilege", "audit-first", "break-glass", "custom"]);
export type SteeringGovernance = z.infer<typeof SteeringGovernanceSchema>;

function steeringParam<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    /** The operator-facing text the value was derived from (the pill label, the row cell). */
    label: z.string().max(240).optional(),
    source: SteeringSourceSchema,
    setAt: z.string(),
  });
}

export const SteeringParamsSchema = z.object({
  /** Bumped on every change; 0 for the clarifier defaults nobody touched. */
  version: z.number().int().nonnegative(),
  /** Stable hash of the parameter values; two steerings with equal digests build the same script. */
  digest: z.string(),
  updatedAt: z.string(),
  remediationStrategy: steeringParam(SteeringStrategySchema).optional(),
  scope: steeringParam(SteeringScopeSchema).optional(),
  governance: steeringParam(SteeringGovernanceSchema).optional(),
  /** Entity ids the fix is narrowed to (UPNs, device names, policy ids). */
  targetIds: steeringParam(z.array(z.string().max(200)).max(20)).optional(),
  /** One resource the fix targets (a vault name, an NSG, a policy), usually from a row click. */
  targetResource: steeringParam(z.string().max(200)).optional(),
  region: steeringParam(z.string().max(60)).optional(),
  dryRun: steeringParam(z.boolean()).optional(),
  /** Every clarifier answer by question id, typed or not; the pills read their state from here. */
  answers: z.record(z.string(), steeringParam(z.string().max(240))).default({}),
});
export type SteeringParams = z.infer<typeof SteeringParamsSchema>;
export type SteeringParam<T> = { value: T; label?: string; source: SteeringSource; setAt: string };

/** The typed keys a delta may set directly (row clicks, card actions, operator input). */
export const STEERING_TYPED_KEYS = ["remediationStrategy", "scope", "governance", "targetIds", "targetResource", "region", "dryRun"] as const;
export type SteeringTypedKey = (typeof STEERING_TYPED_KEYS)[number];

/**
 * What one steering interaction changes. `clarifier` is the pill toggle (question id -> chosen
 * label); `params` sets typed keys directly (a `setsParams` card action, a typed value);
 * `rowClick` is a data-table row the operator clicked, carrying the cell value for `targetResource`.
 */
export const SteeringDeltaSchema = z.object({
  clarifier: z.record(z.string(), z.string().max(240)).optional(),
  params: z.record(z.string(), z.union([z.string().max(240), z.boolean(), z.array(z.string().max(200)).max(20)])).optional(),
  rowClick: z.object({ key: z.string().max(80), value: z.string().max(200), label: z.string().max(240).optional() }).optional(),
  source: SteeringSourceSchema.optional(),
});
export type SteeringDelta = z.infer<typeof SteeringDeltaSchema>;

/** The steering a staged script was built for; compared with the entry's current digest. */
export const StagedSteeringSchema = z.object({ version: z.number().int().nonnegative(), digest: z.string() });
export type StagedSteering = z.infer<typeof StagedSteeringSchema>;

/** FNV-1a over the sorted parameter values; stable across processes and independent of timestamps and sources. */
export function steeringDigest(params: Pick<SteeringParams, (typeof STEERING_TYPED_KEYS)[number] | "answers">): string {
  const values: Record<string, unknown> = {};
  for (const key of STEERING_TYPED_KEYS) {
    const p = params[key];
    if (p) values[key] = p.value;
  }
  for (const [qid, p] of Object.entries(params.answers ?? {}).sort(([a], [b]) => a.localeCompare(b))) values[`answer:${qid}`] = p.value;
  const text = JSON.stringify(values, Object.keys(values).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `s${h.toString(16).padStart(8, "0")}`;
}

export function emptySteering(now = new Date().toISOString()): SteeringParams {
  const base = { version: 0, updatedAt: now, answers: {} as SteeringParams["answers"] };
  return { ...base, digest: steeringDigest(base) };
}

/** True when the script in the drawer predates the entry's steering. */
export function isSteeringStale(staged: StagedSteering | null | undefined, current: Pick<SteeringParams, "digest"> | null | undefined): boolean {
  if (!current) return false;
  if (!staged) return current.digest !== emptySteering().digest;
  return staged.digest !== current.digest;
}

/** One line for the drawer header and the audit trail: "recover · production-scoped · kv-contoso-fin-02". */
export function describeSteering(params: SteeringParams): string {
  const parts: string[] = [];
  if (params.remediationStrategy) parts.push(params.remediationStrategy.value);
  if (params.scope) parts.push(params.scope.value);
  if (params.governance) parts.push(params.governance.value);
  if (params.targetResource) parts.push(params.targetResource.value);
  if (params.targetIds?.value.length) parts.push(`${params.targetIds.value.length} target${params.targetIds.value.length === 1 ? "" : "s"}`);
  if (params.region) parts.push(params.region.value);
  if (params.dryRun) parts.push(params.dryRun.value ? "dry run" : "apply");
  return parts.length ? parts.join(" · ") : "defaults";
}
