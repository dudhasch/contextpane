import { z } from "zod";

/**
 * Typed action catalog: the writes an approval may execute without running model-written
 * PowerShell. A model (or the clarifier answers) picks one action and its parameters through a
 * forced tool; the orchestrator validates the parameters against the tenant context, executes the
 * action through a typed Graph / ARM call and owns its inverse. The staged script stays a
 * reviewable artifact next to it.
 */

/** Azure storage container names: 3-63 lower-case letters, digits and hyphens. */
const CONTAINER_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;
/** A UPN as Graph stores it (guest UPNs carry #EXT#). */
const UPN_RE = /^[A-Za-z0-9._%+'#-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const TYPED_ACTION_KINDS = ["abac-conditioned-role-grant", "license-extension-remediate", "nsg-baseline-restore"] as const;
export type TypedActionKind = (typeof TYPED_ACTION_KINDS)[number];

export const AbacConditionedRoleGrantSchema = z.object({
  kind: z.literal("abac-conditioned-role-grant"),
  params: z.object({
    /** The one container the Storage Blob Data Contributor grant is limited to. */
    container: z.string().regex(CONTAINER_NAME_RE, "invalid container name"),
  }),
});

export const LicenseExtensionRemediateSchema = z.object({
  kind: z.literal("license-extension-remediate"),
  params: z.object({
    tenantId: z.string().min(1).max(80),
    /** The lab users whose licence state is set to the remediated (SPE_E5 / Compliant) state. */
    upns: z.array(z.string().regex(UPN_RE, "invalid UPN")).min(1).max(25),
  }),
});

export const NsgBaselineRestoreSchema = z.object({
  kind: z.literal("nsg-baseline-restore"),
  params: z.object({
    /** The tenant whose lab NSG is reconciled to its Terraform baseline. */
    tenantId: z.string().min(1).max(80),
  }),
});

export const TypedActionSchema = z.discriminatedUnion("kind", [AbacConditionedRoleGrantSchema, LicenseExtensionRemediateSchema, NsgBaselineRestoreSchema]);
export type TypedAction = z.infer<typeof TypedActionSchema>;

/** What the forward write does and what its inverse undoes, as the approval drawer shows it. */
export const TYPED_ACTION_DESCRIPTIONS: Record<TypedActionKind, { forward: string; inverse: string }> = {
  "abac-conditioned-role-grant": {
    forward: "ARM PUT: Storage Blob Data Contributor for the lab Function App identity on the payroll storage account, limited to one container by an ABAC condition (conditionVersion 2.0)",
    inverse: "ARM DELETE of the identity's Storage Blob Data Contributor assignments on the payroll storage account",
  },
  "license-extension-remediate": {
    forward: "Graph $batch PATCH of the lab licence extension (com.contextpane.licenseState) to SPE_E5 / Compliant for the named users",
    inverse: "Graph $batch PATCH of the same users back to the lab's drifted licence state",
  },
  "nsg-baseline-restore": {
    forward: "ARM: reconcile the tenant's lab NSG to its Terraform baseline (rogue rules deleted, missing rules re-created, tags restored)",
    inverse: "ARM: reconcile the NSG back to the seeded drift from demo-lab-manifest.json",
  },
};

/** The forced tool a model answers to pick an action: `kind: "none"` when no catalog action fits the ticket. */
export const TypedActionSelectionSchema = z.object({
  kind: z.enum([...TYPED_ACTION_KINDS, "none"]),
  /** The action's parameters; validated against the action's own schema after the call. */
  params: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().max(300).default(""),
});
export type TypedActionSelection = z.infer<typeof TypedActionSelectionSchema>;

/** Parses a selection into a typed action, or null for `none` and anything that fails the action's schema. */
export function typedActionFromSelection(selection: TypedActionSelection): { action: TypedAction | null; issues: string[] } {
  if (selection.kind === "none") return { action: null, issues: [] };
  const parsed = TypedActionSchema.safeParse({ kind: selection.kind, params: selection.params });
  if (!parsed.success) return { action: null, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`) };
  return { action: parsed.data, issues: [] };
}
