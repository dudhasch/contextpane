import { z } from "zod";
import type { Layout, LayoutComponent } from "./schemas/layout.ts";

/**
 * Contracts for the operator actions around the canvas: the Tier 3 audit ledger,
 * Temporary Access Pass issuance, vision ticket extraction and the zero-token
 * convergence overlay pushed after an approved remediation.
 */

/* -------------------------------------------------------------------------- */
/* Audit ledger                                                                */
/* -------------------------------------------------------------------------- */

export const AuditActionTypeSchema = z.enum([
  "remediation-verified",
  "hitl-approval",
  "hitl-rejection",
  "tap-issued",
  "drift-reset",
]);
export type AuditActionType = z.infer<typeof AuditActionTypeSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  tenantId: z.string(),
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
  execution: z.enum(["live-graph", "simulated", "none"]).default("none"),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/* -------------------------------------------------------------------------- */
/* Temporary Access Pass                                                       */
/* -------------------------------------------------------------------------- */

export const TapIssueResultSchema = z.object({
  upn: z.string(),
  /** live-graph: minted by POST /users/{id}/authentication/temporaryAccessPassMethods. */
  source: z.enum(["live-graph", "simulated-fallback"]),
  fallbackReason: z.string().optional(),
  temporaryAccessPass: z.string(),
  lifetimeInMinutes: z.number().int().positive(),
  isUsableOnce: z.boolean(),
  startDateTime: z.string(),
  methodId: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  auditId: z.string(),
});
export type TapIssueResult = z.infer<typeof TapIssueResultSchema>;

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
    .enum(["EntraSignInTimeline", "LicenseDriftCard", "IaCDriftBanner", "TenantSummaryHeader"])
    .describe("Canvas component that best explains this error"),
});
export type VisionExtraction = z.infer<typeof VisionExtractionSchema>;

/* -------------------------------------------------------------------------- */
/* Zero-token convergence                                                      */
/* -------------------------------------------------------------------------- */

/** Pushed as notifications/resources/updated once an approval lands (and cleared by a drift reset). */
export const ConvergenceSchema = z.object({
  tenantId: z.string(),
  remediationId: z.string(),
  ticketId: z.string(),
  convergedAt: z.string(),
  latencyMs: z.number().int().nonnegative(),
  prUrl: z.string().nullable(),
  gitBranch: z.string().nullable(),
  execution: z.enum(["live-graph", "simulated"]),
  remediatedUpns: z.array(z.string()),
});
export type Convergence = z.infer<typeof ConvergenceSchema>;

function convergeComponent(c: LayoutComponent, upns: Set<string>): LayoutComponent {
  switch (c.type) {
    case "TenantSummaryHeader":
      return {
        ...c,
        props: {
          ...c.props,
          healthSummary: { licenses: "healthy", identity: "healthy", infrastructure: "healthy" },
          activeEscalation: c.props.activeEscalation ? { ...c.props.activeEscalation, badge: `${c.props.activeEscalation.severity} · Remediated` } : null,
        },
      };
    case "LicenseDriftCard": {
      const users = c.props.users.map((u) =>
        u.driftStatus !== "compliant" && (upns.size === 0 || upns.has(u.upn.toLowerCase())) ? { ...u, currentSku: u.expectedSku, driftStatus: "compliant" as const } : u,
      );
      const stillDrifted = users.filter((u) => u.driftStatus !== "compliant").length;
      const assigned = Math.min(c.props.erpBilledCount, c.props.entraAssignedCount + (c.props.driftedCount - stillDrifted));
      const drifted = Math.max(0, c.props.erpBilledCount - assigned);
      return {
        ...c,
        props: {
          ...c.props,
          users,
          entraAssignedCount: assigned,
          driftedCount: drifted,
          burnRateDeltaUsdPerMonth: (c.props.monthlyUnitPriceUsd ?? 0) * drifted,
          state: drifted ? "warning" : "healthy",
        },
      };
    }
    case "EntraSignInTimeline":
      return { ...c, props: { ...c.props, rootCause: null, state: "healthy", events: c.props.events.map((e) => ({ ...e, isHighlighted: false })) } };
    case "IaCDriftBanner":
      return {
        ...c,
        props: {
          ...c.props,
          driftState: "in-sync",
          tagDrift: [],
          rogueSecurityRules: [],
          missingSecurityRules: [],
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
 * users become compliant, the escalation, sign-in root cause and NSG drift clear.
 * Pure, so the web app applies it on the notification and drops it on a reset.
 */
export function convergeLayout(layout: Layout, convergence: Pick<Convergence, "remediatedUpns">): Layout {
  const upns = new Set(convergence.remediatedUpns.map((u) => u.toLowerCase()));
  return { ...layout, components: layout.components.map((c) => convergeComponent(c, upns)) };
}
