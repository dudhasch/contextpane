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
  SourceRefSchema,
  ExecutionModeSchema,
} from "./primitives.ts";

/* -------------------------------------------------------------------------- */
/* 1. LicenseDriftCard · License Pool & Assignment (amber)                     */
/* -------------------------------------------------------------------------- */

export const SkuPoolSchema = z.object({
  skuPartNumber: z.string().describe("e.g. SPE_E5"),
  skuName: z.string(),
  enabled: z.number().int().nonnegative().describe("Seats purchased (prepaidUnits.enabled)"),
  consumed: z.number().int().nonnegative().describe("Seats assigned (consumedUnits)"),
  available: z.number().int().describe("enabled - consumed"),
  note: z.string().max(120).optional().describe("e.g. '3 assigned to AVD users'"),
  source: z.enum(["live-graph", "fixture"]),
});
export type SkuPool = z.infer<typeof SkuPoolSchema>;

export const GroupLicenseErrorSchema = z.object({
  groupName: z.string(),
  skuPartNumber: z.string(),
  state: z.enum(["CountViolation", "MutuallyExclusiveViolation", "DependencyViolation"]),
  affectedUsers: z.number().int().nonnegative(),
  detail: z.string().max(240),
});
export type GroupLicenseError = z.infer<typeof GroupLicenseErrorSchema>;

export const AssignmentStateSchema = z.enum(["Active", "Error: CountViolation", "Drifted", "Orphaned", "Reclaimed"]);
export type AssignmentState = z.infer<typeof AssignmentStateSchema>;

export const LicenseDriftUserSchema = z.object({
  upn: z.string().describe("User principal name"),
  displayName: z.string(),
  jobTitle: z.string().default(""),
  accountEnabled: z.boolean().default(true),
  lastSignIn: z.string().optional().describe("ISO timestamp or a relative label like '>90 days ago'"),
  currentSku: z.string().describe("SKU part number(s) currently assigned, e.g. SPE_E3, or NONE"),
  expectedSku: z.string().describe("SKU part number the user should hold, e.g. SPE_E5, or NONE for offboarded accounts"),
  assignmentPath: z.enum(["Direct", "Group", "Direct + Group", "None"]).default("Group"),
  assignmentState: AssignmentStateSchema,
  driftStatus: DriftStatusSchema,
  objectId: z.string().optional(),
});
export type LicenseDriftUser = z.infer<typeof LicenseDriftUserSchema>;

export const LicenseDriftCardSchema = z.object({
  headline: z.string().max(200).describe("One-line technical summary shown on the compact card"),
  skuName: z.string().describe("Human name of the SKU the fix targets, e.g. Microsoft 365 E5"),
  skuPartNumber: z.string().describe("SKU the fix targets, e.g. SPE_E5"),
  groupName: z.string().describe("Licensing / entitlement group, e.g. SG-Contoso-Finance-AVD"),
  skuPools: z.array(SkuPoolSchema).max(6),
  groupErrors: z.array(GroupLicenseErrorSchema).max(6).default([]),
  users: z.array(LicenseDriftUserSchema).max(50),
  state: HealthStateSchema,
});
export type LicenseDriftCard = z.infer<typeof LicenseDriftCardSchema>;

/* -------------------------------------------------------------------------- */
/* 2. EntraSignInTimeline · Sign-In History & Conditional Access (rose)        */
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
  isHighlighted: z.boolean().default(false).describe("True for the event(s) that explain the scenario."),
});
export type SignInEvent = z.infer<typeof SignInEventSchema>;

export const PolicyDriftSchema = z.object({
  field: z.string().describe("Policy field, e.g. state or conditions.users.excludeGroups"),
  expected: z.string().describe("Golden baseline value"),
  actual: z.string().describe("Live tenant value"),
  severity: SeveritySchema,
  sourceRef: SourceRefSchema.optional().describe("Lines of the golden baseline that declare the expected value"),
});
export type PolicyDrift = z.infer<typeof PolicyDriftSchema>;

export const CaPolicyStateSchema = z.enum(["enabled", "disabled", "enabledForReportingButNotEnforced"]);

export const CaPolicyInspectorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  state: CaPolicyStateSchema,
  role: z.enum(["blocking", "drifted", "in-scope"]).describe("Why the policy is on the card"),
  includeGroups: z.array(z.string()).max(10),
  excludeGroups: z.array(z.string()).max(10),
  targetApps: z.array(z.string()).max(10),
  clientAppTypes: z.array(z.string()).max(6).default([]),
  grantControls: z.array(z.string()).max(6),
  drift: z.array(PolicyDriftSchema).max(6).default([]),
  /** What the policy looks like once the staged fix is applied; the canvas converges to it. */
  fixedState: CaPolicyStateSchema.optional(),
  fixedExcludeGroups: z.array(z.string()).max(10).optional(),
  modifiedDateTime: z.string().nullable().default(null),
  sourceRef: SourceRefSchema.optional().describe("Golden baseline file of the policy, when it has one"),
});
export type CaPolicyInspector = z.infer<typeof CaPolicyInspectorSchema>;

export const EntraSignInTimelineSchema = z.object({
  headline: z.string().max(200).describe("One-line summary of the blocking or drifted Conditional Access state"),
  focusUpn: z.string().describe("The affected user the scenario is about (empty for tenant-wide anomalies)"),
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
  policies: z.array(CaPolicyInspectorSchema).max(6).default([]),
  microActions: z.array(QuickActionSchema).max(6),
  state: HealthStateSchema,
  sourceRef: SourceRefSchema.nullable().default(null).describe("CodeLens: golden-baseline lines of the first drifted policy setting"),
  baselineDiff: z.string().default("").describe("Unified diff, live policy (-) vs golden baseline file (+); empty without baseline drift"),
});
export type EntraSignInTimeline = z.infer<typeof EntraSignInTimelineSchema>;

/* -------------------------------------------------------------------------- */
/* 3. IntuneDriftCard · Intune Policy & Compliance Drift (violet)              */
/* -------------------------------------------------------------------------- */

export const IntunePolicyRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["Settings Catalog", "Endpoint Security", "Device Configuration", "Security Baseline", "Compliance Policy"]),
  assignedTo: z.array(z.string()).max(6),
  role: z.enum(["golden", "drifted", "conflicting", "duplicate", "compliance"]),
  source: z.enum(["live-graph", "fixture"]),
});
export type IntunePolicyRef = z.infer<typeof IntunePolicyRefSchema>;

export const IntuneSettingDriftSchema = z.object({
  policyName: z.string(),
  settingName: z.string(),
  settingId: z.string().optional(),
  golden: z.string().describe("Value in the golden baseline (Git)"),
  live: z.string().describe("Value Graph reports for the tenant"),
  status: z.enum(["drifted", "conflict", "in-sync"]),
  severity: SeveritySchema,
  sourceRef: SourceRefSchema.optional().describe("Lines of the golden baseline that declare the setting"),
  cspUri: z.string().optional().describe("OMA-URI of the CSP backing the setting, e.g. ./Device/Vendor/MSFT/BitLocker/EncryptionMethodByDriveType"),
  registryPath: z.string().optional().describe("Registry path/value the CSP writes on device, e.g. HKLM\\SOFTWARE\\Policies\\Microsoft\\FVE"),
  tattooedOnUnassign: z
    .boolean()
    .optional()
    .describe("True when the value tattoos (persists under PolicyManager\\current\\device) after the assigning profile is unassigned"),
});
export type IntuneSettingDrift = z.infer<typeof IntuneSettingDriftSchema>;

export const IntuneDeviceSchema = z.object({
  deviceName: z.string(),
  upn: z.string(),
  os: z.string(),
  complianceState: z.enum(["Compliant", "NonCompliant", "InGracePeriod", "Conflict", "Error"]),
  lastCheckIn: z.string(),
  detail: z.string().max(200).default(""),
});
export type IntuneDevice = z.infer<typeof IntuneDeviceSchema>;

export const IntuneDriftCardSchema = z.object({
  headline: z.string().max(200),
  issueKind: z.enum(["policy-conflict", "baseline-drift"]),
  errorCode: z.string().optional().describe("Intune error, e.g. 0x87D1FDE8"),
  errorMeaning: z.string().max(240).optional(),
  goldenSource: z.string().describe("Where the golden configuration lives, e.g. golden-tenant/intune/... @ main"),
  policies: z.array(IntunePolicyRefSchema).max(8),
  settings: z.array(IntuneSettingDriftSchema).max(12),
  devices: z.array(IntuneDeviceSchema).max(40),
  affectedDeviceCount: z.number().int().nonnegative(),
  comparedAgainst: z.enum(["live-graph", "fixture"]),
  state: HealthStateSchema,
  sourceRef: SourceRefSchema.nullable().default(null).describe("CodeLens: golden-baseline lines of the first drifted or conflicting setting"),
  baselineDiff: z.string().default("").describe("Unified diff, live Intune configuration (-) vs golden baseline files (+)"),
});
export type IntuneDriftCard = z.infer<typeof IntuneDriftCardSchema>;

/* -------------------------------------------------------------------------- */
/* 4. IaCDriftBanner · AVD Host Pool, NSG & Azure Policy (teal)                */
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

export const HostPoolSchema = z.object({
  name: z.string(),
  poolType: z.enum(["Pooled", "Personal"]),
  loadBalancer: z.string().describe("BreadthFirst | DepthFirst"),
  maxSessionLimit: z.number().int().positive().optional(),
  vmSize: z.string(),
  location: z.string(),
  joinType: z.string().describe("e.g. Microsoft Entra joined"),
  fslogix: z.object({ status: z.enum(["Healthy", "Degraded", "Unknown"]), share: z.string() }),
  sessionHosts: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(["Available", "Unavailable", "Draining", "NeedsAssistance"]),
        sessions: z.number().int().nonnegative(),
        agentVersion: z.string().optional(),
      }),
    )
    .max(10),
  source: z.enum(["live-azure", "fixture"]),
});
export type HostPool = z.infer<typeof HostPoolSchema>;

export const AzurePolicyStateSchema = z.object({
  name: z.string(),
  effect: z.string().describe("Audit | Deny | Modify | AuditIfNotExists"),
  compliance: z.enum(["Compliant", "NonCompliant"]),
  nonCompliantResources: z.number().int().nonnegative(),
  scope: z.string(),
  detail: z.string().max(200).default(""),
});
export type AzurePolicyState = z.infer<typeof AzurePolicyStateSchema>;

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
  hostPool: HostPoolSchema.nullable().default(null),
  azurePolicies: z.array(AzurePolicyStateSchema).max(8).default([]),
  state: HealthStateSchema,
  comparedAgainst: z.enum(["live-azure", "seeded-manifest"]),
  sourceRef: SourceRefSchema.nullable().default(null).describe("CodeLens: lines of the drifted resource block in the Terraform baseline"),
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
  whatIfSafe: z
    .boolean()
    .nullable()
    .default(null)
    .describe("True when the script declares SupportsShouldProcess and every mutating cmdlet runs inside $PSCmdlet.ShouldProcess, so -WhatIf is a real dry run"),
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
  terraformDiff: z.string().default("").describe("Unified diff against the Terraform baseline; empty when the fix has no IaC part"),
  graphPatch: z.string().default("").describe("Graph request bodies (JSON) the fix sends, for review or a manual Invoke-MgGraphRequest"),
  affectedEntities: z.array(AffectedEntitySchema).max(20),
  verificationStatus: VerificationStatusSchema,
  staging: StagingInfoSchema.nullable(),
  approval: z.object({
    state: z
      .enum(["pending", "approved", "rejected", "executed", "simulated", "staged", "rolled-back"])
      .describe("staged: approved as Pure GitOps, nothing written live; rolled-back: f⁻¹ inverse rollback executed"),
    mode: ExecutionModeSchema.nullable().default(null).describe("How the approval landed; null until approved"),
    requiredIdentity: z.string().describe("Delegated identity that will execute, e.g. cloudadmin@..."),
    approvedBy: z.string().nullable().default(null),
    approvedAt: IsoTimestampSchema.nullable().default(null),
  }),
  providerTelemetry: ProviderTelemetrySchema,
});
export type ActionApprovalDrawer = z.infer<typeof ActionApprovalDrawerSchema>;

/* -------------------------------------------------------------------------- */
/* 7. SynthesizedDynamicCard · Self-Expanding N+k Composable Element (teal)    */
/* -------------------------------------------------------------------------- */

export const SynthesizedPrimitiveKindSchema = z.enum([
  "quota-gauges",
  "policy-chain",
  "data-table",
  "config-diff",
  "event-stream",
]);
export type SynthesizedPrimitiveKind = z.infer<typeof SynthesizedPrimitiveKindSchema>;

export const SynthesizedDomainSchema = z.enum([
  "azure",
  "identity",
  "intune",
  "licensing",
  "network",
  "cloud-status",
]);
export type SynthesizedDomain = z.infer<typeof SynthesizedDomainSchema>;

export const QuotaGaugeItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  region: z.string().optional(),
  used: z.number().nonnegative(),
  limit: z.number().positive(),
  unit: z.string().default("vCPUs"),
  status: HealthStateSchema,
  errorCode: z.string().optional(),
  detail: z.string().optional(),
});
export type QuotaGaugeItem = z.infer<typeof QuotaGaugeItemSchema>;

export const QuotaGaugeBlockSchema = z.object({
  kind: z.literal("quota-gauges"),
  title: z.string(),
  gauges: z.array(QuotaGaugeItemSchema).min(1).max(8),
});
export type QuotaGaugeBlock = z.infer<typeof QuotaGaugeBlockSchema>;

export const PolicyChainHopSchema = z.object({
  step: z.string(),
  node: z.string(),
  effect: z.enum(["Allow", "Audit", "Deny", "Pass"]),
  code: z.string().optional(),
  detail: z.string(),
  policyId: z.string().optional(),
});
export type PolicyChainHop = z.infer<typeof PolicyChainHopSchema>;

export const PolicyChainBlockSchema = z.object({
  kind: z.literal("policy-chain"),
  title: z.string(),
  hops: z.array(PolicyChainHopSchema).min(1).max(8),
});
export type PolicyChainBlock = z.infer<typeof PolicyChainBlockSchema>;

export const DataTableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  mono: z.boolean().default(false),
});
export type DataTableColumn = z.infer<typeof DataTableColumnSchema>;

export const DataTableBlockSchema = z.object({
  kind: z.literal("data-table"),
  title: z.string(),
  columns: z.array(DataTableColumnSchema).min(1).max(8),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))).max(30),
});
export type DataTableBlock = z.infer<typeof DataTableBlockSchema>;

export const ConfigDiffBlockSchema = z.object({
  kind: z.literal("config-diff"),
  title: z.string(),
  filePath: z.string(),
  language: z.enum(["bicep", "terraform", "arm-json", "powershell", "json"]).default("terraform"),
  diff: z.string(),
});
export type ConfigDiffBlock = z.infer<typeof ConfigDiffBlockSchema>;

export const EventStreamItemSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  operation: z.string(),
  status: z.enum(["Failed", "Succeeded", "Warning"]),
  code: z.string(),
  caller: z.string(),
  detail: z.string(),
});
export type EventStreamItem = z.infer<typeof EventStreamItemSchema>;

export const EventStreamBlockSchema = z.object({
  kind: z.literal("event-stream"),
  title: z.string(),
  events: z.array(EventStreamItemSchema).min(1).max(20),
});
export type EventStreamBlock = z.infer<typeof EventStreamBlockSchema>;

export const SynthesizedBlockSchema = z.discriminatedUnion("kind", [
  QuotaGaugeBlockSchema,
  PolicyChainBlockSchema,
  DataTableBlockSchema,
  ConfigDiffBlockSchema,
  EventStreamBlockSchema,
]);
export type SynthesizedBlock = z.infer<typeof SynthesizedBlockSchema>;

export const SynthesizedCardActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  command: z.string().optional(),
  kind: z.enum(["stage-fix", "view-diff", "inspect"]).default("stage-fix"),
});
export type SynthesizedCardAction = z.infer<typeof SynthesizedCardActionSchema>;

export const SynthesizedDynamicCardSchema = z.object({
  elementId: z.string().describe("PascalCase element identifier, e.g. AzureVmDeploymentQuotaAndPolicyCard"),
  title: z.string().describe("Human-readable card title, e.g. Azure VM Regional Quota & Policy Blocker (westeurope)"),
  headline: z.string().max(240).describe("One-line summary shown in the card header"),
  domain: SynthesizedDomainSchema,
  reason: z.string().max(320).describe("Why muse-spark-1.3 flagged element_not_existent and muse-wonder-1.0 synthesized this element"),
  state: HealthStateSchema,
  requiredPrimitives: z.array(SynthesizedPrimitiveKindSchema).min(1),
  blocks: z.array(SynthesizedBlockSchema).min(1).max(6),
  recommendedActions: z.array(SynthesizedCardActionSchema).max(4).default([]),
  synthesisMeta: z.object({
    gatekeeperModel: z.string().default("muse-spark-1.3"),
    synthesizerModel: z.string().default("muse-wonder-1.0"),
    latencyMs: z.number().int().nonnegative().default(0),
    reusedFromCatalog: z.boolean().default(false),
    reuseCount: z.number().int().positive().default(1),
    tsxStubPath: z.string(),
    synthesizedAt: z.string(),
  }),
  sourceRef: SourceRefSchema.nullable().default(null),
});
export type SynthesizedDynamicCard = z.infer<typeof SynthesizedDynamicCardSchema>;
