import { z } from "zod";
import {
  DriftStatusSchema,
  EntityTypeSchema,
  FactSchema,
  HealthStateSchema,
  IsoTimestampSchema,
  ProviderIdSchema,
  ProviderTelemetrySchema,
  QuickActionSchema,
  SeveritySchema,
  SlaTierSchema,
  TicketSeveritySchema,
} from "./primitives.ts";

/* -------------------------------------------------------------------------- */
/* 1. TenantSummaryHeader                                                      */
/* -------------------------------------------------------------------------- */

export const TenantSummaryHeaderSchema = z.object({
  tenantName: z.string().min(1).describe("Customer display name, e.g. Contoso Finance"),
  tenantId: z.string().describe("Entra tenant id (GUID)"),
  verifiedDomain: z.string().describe("Primary verified domain"),
  erpContractId: z.string().describe("ERP contract id, e.g. CNT-2026-884"),
  slaTier: SlaTierSchema,
  activeEscalation: z
    .object({
      ticketId: z.string(),
      severity: TicketSeveritySchema,
      title: z.string().max(160),
      badge: z.string().max(40).describe("Short badge text, e.g. 'P1 · Breach in 2h 14m'"),
      slaBreachAt: IsoTimestampSchema.optional(),
    })
    .nullable()
    .describe("Null when no escalation is open."),
  healthSummary: z.object({
    licenses: HealthStateSchema,
    identity: HealthStateSchema,
    infrastructure: HealthStateSchema,
  }),
  providerTelemetry: ProviderTelemetrySchema,
});
export type TenantSummaryHeader = z.infer<typeof TenantSummaryHeaderSchema>;

/* -------------------------------------------------------------------------- */
/* 2. LicenseDriftCard                                                         */
/* -------------------------------------------------------------------------- */

export const LicenseDriftUserSchema = z.object({
  upn: z.string().describe("User principal name"),
  displayName: z.string(),
  jobTitle: z.string().default(""),
  currentSku: z.string().describe("SKU part number currently assigned, e.g. SPE_E3, or NONE"),
  expectedSku: z.string().describe("SKU part number the contract entitles, e.g. SPE_E5"),
  driftStatus: DriftStatusSchema,
  objectId: z.string().optional(),
});
export type LicenseDriftUser = z.infer<typeof LicenseDriftUserSchema>;

export const LicenseDriftCardSchema = z.object({
  skuName: z.string().describe("Human SKU name, e.g. Microsoft 365 E5"),
  skuPartNumber: z.string().describe("SKU part number, e.g. SPE_E5"),
  groupName: z.string().describe("Entitlement group, e.g. SG-Contoso-Finance-AVD"),
  contractId: z.string(),
  erpBilledCount: z.number().int().nonnegative().describe("Seats billed by the ERP contract"),
  entraAssignedCount: z.number().int().nonnegative().describe("Seats actually assigned in Entra"),
  driftedCount: z.number().int().nonnegative().describe("erpBilledCount - entraAssignedCount, never negative"),
  monthlyUnitPriceUsd: z.number().nonnegative().optional(),
  burnRateDeltaUsdPerMonth: z
    .number()
    .optional()
    .describe("Money billed but not delivered per month (driftedCount * unit price)."),
  users: z.array(LicenseDriftUserSchema).max(50),
  state: HealthStateSchema,
});
export type LicenseDriftCard = z.infer<typeof LicenseDriftCardSchema>;

/* -------------------------------------------------------------------------- */
/* 3. EntraSignInTimeline                                                      */
/* -------------------------------------------------------------------------- */

export const SignInEventSchema = z.object({
  id: z.string(),
  timestamp: IsoTimestampSchema,
  upn: z.string(),
  displayName: z.string(),
  appDisplayName: z.string(),
  appId: z.string(),
  status: z.enum(["success", "failure", "interrupted"]),
  errorCode: z.number().int().nonnegative().describe("0 on success, otherwise the AADSTS numeric code"),
  errorCodeLabel: z.string().optional().describe("e.g. AADSTS53003"),
  failureReason: z.string().optional(),
  conditionalAccessStatus: z.enum(["success", "failure", "notApplied", "unknown"]),
  blockingPolicyName: z.string().optional().describe("Display name of the CA policy that blocked the sign-in"),
  blockingPolicyId: z.string().optional(),
  clientApp: z.string().default(""),
  location: z.string().default(""),
  ipAddress: z.string().default(""),
  deviceName: z.string().default(""),
  deviceCompliant: z.boolean().nullable().default(null),
  isHighlighted: z.boolean().default(false).describe("True for the event(s) that explain the ticket."),
});
export type SignInEvent = z.infer<typeof SignInEventSchema>;

export const EntraSignInTimelineSchema = z.object({
  focusUpn: z.string().describe("The affected user the ticket is about"),
  windowStart: IsoTimestampSchema,
  windowEnd: IsoTimestampSchema,
  events: z.array(SignInEventSchema).max(100),
  rootCause: z
    .object({
      errorCodeLabel: z.string(),
      policyName: z.string().optional(),
      targetApp: z.string(),
      explanation: z.string().max(400),
    })
    .nullable(),
  microActions: z.array(QuickActionSchema).max(6),
  state: HealthStateSchema,
});
export type EntraSignInTimeline = z.infer<typeof EntraSignInTimelineSchema>;

/* -------------------------------------------------------------------------- */
/* 4. IaCDriftBanner                                                           */
/* -------------------------------------------------------------------------- */

export const TagDriftSchema = z.object({
  key: z.string(),
  expectedInTf: z.string().nullable().describe("Null when the tag is absent from Terraform"),
  actualInAzure: z.string().nullable().describe("Null when the tag is absent in Azure"),
});
export type TagDrift = z.infer<typeof TagDriftSchema>;

export const RogueSecurityRuleSchema = z.object({
  ruleName: z.string(),
  priority: z.number().int(),
  direction: z.enum(["Inbound", "Outbound"]),
  access: z.enum(["Allow", "Deny"]),
  protocol: z.string(),
  port: z.string().describe("Destination port or range, e.g. 3389"),
  source: z.string().describe("Source address prefix, e.g. * or 10.20.0.0/16"),
  destination: z.string(),
  severity: SeveritySchema,
  reason: z.string().max(200),
});
export type RogueSecurityRule = z.infer<typeof RogueSecurityRuleSchema>;

export const IaCDriftBannerSchema = z.object({
  resourceName: z.string(),
  resourceGroup: z.string(),
  resourceType: z.string().default("Microsoft.Network/networkSecurityGroups"),
  resourceId: z.string().optional(),
  location: z.string().optional(),
  gitBranch: z.string().default("main"),
  terraformFile: z.string().describe("Relative path of the baseline, e.g. demo-iac/main.tf"),
  driftState: z.enum(["in-sync", "drift-detected"]),
  tagDrift: z.array(TagDriftSchema),
  rogueSecurityRules: z.array(RogueSecurityRuleSchema),
  missingSecurityRules: z.array(z.string()).default([]).describe("Rules in Terraform but absent in Azure"),
  hclDiff: z.string().describe("Unified diff, Azure live state (-) vs Terraform baseline (+)"),
  summary: z.string().max(240).describe("One-line CodeLens summary"),
  state: HealthStateSchema,
  comparedAgainst: z.enum(["live-azure", "seeded-manifest"]),
});
export type IaCDriftBanner = z.infer<typeof IaCDriftBannerSchema>;

/* -------------------------------------------------------------------------- */
/* 5. HoverDiagnosticPopover                                                   */
/* -------------------------------------------------------------------------- */

export const ErrorCodeTranslationSchema = z.object({
  code: z.string().describe("e.g. AADSTS53003"),
  meaning: z.string().max(240),
  likelyCause: z.string().max(300),
  docsUrl: z.string().optional(),
});
export type ErrorCodeTranslation = z.infer<typeof ErrorCodeTranslationSchema>;

export const HoverDiagnosticPopoverSchema = z.object({
  entityId: z.string(),
  entityType: EntityTypeSchema,
  status: HealthStateSchema,
  headline: z.string().max(120).describe("One-line diagnosis in plain engineer English"),
  errorCodeTranslation: ErrorCodeTranslationSchema.nullable(),
  facts: z.array(FactSchema).max(8),
  quickActions: z.array(QuickActionSchema).max(4),
  latencyBudgetMs: z.number().int().default(350),
  providerTelemetry: ProviderTelemetrySchema,
});
export type HoverDiagnosticPopover = z.infer<typeof HoverDiagnosticPopoverSchema>;

/* -------------------------------------------------------------------------- */
/* 6. ActionApprovalDrawer                                                     */
/* -------------------------------------------------------------------------- */

export const VerificationStatusSchema = z.object({
  verdict: z.enum(["Verified Safe", "Verified With Warnings", "Verification Failed", "Pending"]),
  astCheckPassed: z.boolean().nullable().describe("PowerShell AST parse result; null if not run"),
  terraformFmtPassed: z.boolean().nullable(),
  terraformValidatePassed: z.boolean().nullable(),
  sandboxProvider: z.enum(["local-pwsh", "modal-cloud-sandbox", "none"]),
  validationLatencyMs: z.number().int().nonnegative(),
  findings: z.array(z.string().max(300)).default([]),
  sandboxLatencyMs: z.number().int().nonnegative().optional().describe("Time spent inside the sandbox; validationLatencyMs is the round trip"),
  checkLatencyMs: z
    .object({ powershellAst: z.number().optional(), terraformFmt: z.number().optional(), terraformValidate: z.number().optional() })
    .optional()
    .describe("Per-check time inside the sandbox"),
});
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const AffectedEntitySchema = z.object({
  type: EntityTypeSchema,
  id: z.string(),
  change: z.string().max(200),
});

export const StagingInfoSchema = z.object({
  branchName: z.string(),
  commitSha: z.string().nullable(),
  filesChanged: z.array(z.string()),
  worktreePath: z.string().optional(),
  prTitle: z.string(),
  pushed: z.boolean().default(false).describe("True once the branch was pushed to remote origin"),
  prUrl: z.string().url().nullable().default(null).describe("GitHub pull request opened via gh pr create on approval, if any"),
});
export type StagingInfo = z.infer<typeof StagingInfoSchema>;

export const ActionApprovalDrawerSchema = z.object({
  remediationId: z.string(),
  ticketId: z.string(),
  tenantId: z.string(),
  title: z.string().max(120),
  summary: z.string().max(600).describe("What the bundle changes and why, 2-3 sentences"),
  synthesizedBy: z.object({
    planner: z.string().describe("Model that produced the plan, e.g. muse-wonder-1.0"),
    coder: z.string().describe("Model that produced the code, e.g. muse-code"),
    provider: ProviderIdSchema,
  }),
  powershellScript: z.string().describe("Complete PowerShell 7 script using Microsoft.Graph cmdlets"),
  terraformDiff: z.string().describe("Unified diff against the Terraform baseline"),
  affectedEntities: z.array(AffectedEntitySchema).max(20),
  verificationStatus: VerificationStatusSchema,
  staging: StagingInfoSchema.nullable(),
  approval: z.object({
    state: z.enum(["pending", "approved", "rejected", "executed", "simulated"]),
    requiredIdentity: z.string().describe("Delegated identity that will execute, e.g. cloudadmin@..."),
    approvedBy: z.string().nullable().default(null),
    approvedAt: IsoTimestampSchema.nullable().default(null),
  }),
  providerTelemetry: ProviderTelemetrySchema,
});
export type ActionApprovalDrawer = z.infer<typeof ActionApprovalDrawerSchema>;
