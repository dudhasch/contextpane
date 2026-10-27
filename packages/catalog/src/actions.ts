import { z } from "zod";
import { ExecutionModeSchema } from "./schemas/primitives.ts";
import type { LicenseDriftCard, LicenseDriftUser } from "./schemas/components.ts";
import type { Layout, LayoutComponent } from "./schemas/layout.ts";

/**
 * Contracts for the operator actions around the canvas: the Tier 3 audit ledger,
 * vision ticket extraction and the zero-token convergence overlay pushed after an
 * approved remediation.
 */

/* -------------------------------------------------------------------------- */
/* Audit ledger                                                                */
/* -------------------------------------------------------------------------- */

export const AuditActionTypeSchema = z.enum([
  "remediation-verified",
  "hitl-approval",
  "hitl-rejection",
  "drift-reset",
  "autonomous-rollback",
  "fleet-campaign",
  "ticket-closed",
  "ticket-reopened",
]);
export type AuditActionType = z.infer<typeof AuditActionTypeSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  tenantId: z.string(),
  /** Scenario id: an ERP ticket (INC-4092) or a tenant anomaly (ANOM-CA-204). */
  ticketId: z.string(),
  actionType: AuditActionTypeSchema,
  /** Identity the action ran as (the GDAP / delegated admin), or the operator for a rejection. */
  delegatedIdentity: z.string(),
  /** True only when the pre-flight ran in the Modal cloud sandbox and did not fail. */
  modalSandboxVerified: z.boolean(),
  astPass: z.boolean().nullable(),
  tfValidatePass: z.boolean().nullable(),
  gitBranch: z.string().nullable(),
  prUrl: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  /** One line on what happened, e.g. "3 users → SPE_E5 (live Graph)". Never holds a secret. */
  detail: z.string().max(300).default(""),
  /** live-graph when the change reached the tenant, simulated otherwise. */
  execution: z
    .enum([
      "live-graph",
      "simulated",
      "none",
      "live-graph-and-arm-reverted",
      "in-memory-state-reverted",
    ])
    .default("none"),
  /** Break-glass (live write + reconcile commit) or Pure GitOps (PR only), for approvals. */
  executionMode: ExecutionModeSchema.nullable().default(null),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/* -------------------------------------------------------------------------- */
/* Vision ticket extraction                                                    */
/* -------------------------------------------------------------------------- */

export const VisionExtractionSchema = z.object({
  errorCode: z.string().max(40).describe("Error code exactly as shown, e.g. AADSTS53003"),
  appId: z.string().max(64).describe("Application (client) id GUID shown in the dialog"),
  correlationId: z.string().max(64).describe("Correlation id GUID shown in the dialog"),
  timestamp: z.string().max(40).describe("Timestamp shown in the dialog, ISO-8601"),
  deviceState: z.string().max(160).describe("Device name, join type and compliance as shown, e.g. CONTOSO-LT-0471 · Entra joined · Compliant"),
  recommendedComponent: z
    .enum(["EntraSignInTimeline", "LicenseDriftCard", "IntuneDriftCard", "IaCDriftBanner"])
    .describe("Canvas component that best explains this error"),
});
export type VisionExtraction = z.infer<typeof VisionExtractionSchema>;

/* -------------------------------------------------------------------------- */
/* Zero-token convergence                                                      */
/* -------------------------------------------------------------------------- */

/** Pushed as notifications/resources/updated once an approval lands (and cleared by a drift reset). */
export const ConvergenceSchema = z.object({
  scenarioId: z.string(),
  tenantId: z.string(),
  remediationId: z.string(),
  ticketId: z.string(),
  convergedAt: z.string(),
  latencyMs: z.number().int().nonnegative(),
  prUrl: z.string().nullable(),
  gitBranch: z.string().nullable(),
  execution: z.enum(["live-graph", "simulated"]),
  /** Users whose license assignment the fix activated. */
  remediatedUpns: z.array(z.string()),
  /** Disabled accounts whose licenses the fix reclaimed. */
  reclaimedUpns: z.array(z.string()).default([]),
});
export type Convergence = z.infer<typeof ConvergenceSchema>;

/** "SPE_E5, Microsoft_365_Copilot" → ["SPE_E5", "Microsoft_365_Copilot"]; NONE → []. */
export function skuList(value: string): string[] {
  return value
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== "NONE");
}

function convergeLicenseCard(props: LicenseDriftCard, activated: Set<string>, reclaimed: Set<string>): LicenseDriftCard {
  const delta = new Map<string, number>();
  const bump = (sku: string, by: number) => delta.set(sku, (delta.get(sku) ?? 0) + by);
  const fixesAll = activated.size === 0 && reclaimed.size === 0;
  const users = props.users.map((u): LicenseDriftUser => {
    const key = u.upn.toLowerCase();
    if (u.assignmentState === "Orphaned" && (fixesAll || reclaimed.has(key))) {
      for (const sku of skuList(u.currentSku)) bump(sku, -1);
      return { ...u, currentSku: "NONE", assignmentPath: "None", assignmentState: "Reclaimed", driftStatus: "compliant" };
    }
    if ((u.assignmentState === "Drifted" || u.assignmentState === "Error: CountViolation") && (fixesAll || activated.has(key))) {
      for (const sku of skuList(u.currentSku)) bump(sku, -1);
      for (const sku of skuList(u.expectedSku)) bump(sku, 1);
      return { ...u, currentSku: u.expectedSku, assignmentState: "Active", driftStatus: "compliant" };
    }
    return u;
  });
  const skuPools = props.skuPools.map((p) => {
    const consumed = Math.max(0, p.consumed + (delta.get(p.skuPartNumber) ?? 0));
    return { ...p, consumed, available: p.enabled - consumed };
  });
  const open = users.filter((u) => u.assignmentState !== "Active" && u.assignmentState !== "Reclaimed").length;
  return {
    ...props,
    users,
    skuPools,
    groupErrors: [],
    headline: open ? props.headline : `Resolved · ${users.filter((u) => u.assignmentState === "Active").length} active, ${users.filter((u) => u.assignmentState === "Reclaimed").length} reclaimed, 0 group errors`,
    state: open ? "warning" : "healthy",
  };
}

function convergeComponent(c: LayoutComponent, convergence: Pick<Convergence, "remediatedUpns" | "reclaimedUpns">): LayoutComponent {
  switch (c.type) {
    case "LicenseDriftCard":
      return {
        ...c,
        props: convergeLicenseCard(
          c.props,
          new Set(convergence.remediatedUpns.map((u) => u.toLowerCase())),
          new Set((convergence.reclaimedUpns ?? []).map((u) => u.toLowerCase())),
        ),
      };
    case "EntraSignInTimeline":
      return {
        ...c,
        props: {
          ...c.props,
          headline: "Resolved · Conditional Access matches the golden baseline",
          rootCause: null,
          state: "healthy",
          events: c.props.events.map((e) => ({ ...e, isHighlighted: false })),
          policies: c.props.policies.map((p) => ({
            ...p,
            state: p.fixedState ?? p.state,
            excludeGroups: p.fixedExcludeGroups ?? p.excludeGroups,
            drift: [],
          })),
        },
      };
    case "IntuneDriftCard":
      return {
        ...c,
        props: {
          ...c.props,
          headline: `Resolved · ${c.props.settings.length} setting${c.props.settings.length === 1 ? "" : "s"} back on the golden baseline, devices compliant`,
          settings: c.props.settings.map((s) => ({ ...s, live: s.golden, status: "in-sync" as const })),
          policies: c.props.policies.map((p) => (p.role === "duplicate" || p.role === "conflicting" ? { ...p, assignedTo: [] } : p)),
          devices: c.props.devices.map((d) => ({ ...d, complianceState: "Compliant" as const, detail: "Remediated" })),
          affectedDeviceCount: 0,
          state: "healthy",
        },
      };
    case "IaCDriftBanner":
      return {
        ...c,
        props: {
          ...c.props,
          driftState: "in-sync",
          tagDrift: [],
          rogueSecurityRules: [],
          missingSecurityRules: [],
          azurePolicies: c.props.azurePolicies.map((p) => ({ ...p, compliance: "Compliant" as const, nonCompliantResources: 0 })),
          state: "healthy",
          summary: "Remediated: Terraform baseline restored on the approved fix branch",
        },
      };
    default:
      return c;
  }
}

/**
 * Flips the mounted canvas to its remediated state without a model call: drifted
 * and CountViolation users become active, orphaned seats are reclaimed, Conditional
 * Access policies and Intune settings match the golden baseline, NSG drift clears.
 * Pure, so the web app applies it on the notification and drops it on a reset.
 */
export function convergeLayout(layout: Layout, convergence: Pick<Convergence, "remediatedUpns" | "reclaimedUpns">): Layout {
  return { ...layout, components: layout.components.map((c) => convergeComponent(c, convergence)) };
}
