import { z } from "zod";

/**
 * Shared primitive schemas used across every catalog component.
 * Keep these small and descriptive: `.describe()` text flows straight into the
 * JSON Schema that the Meta models see inside the forced tool definition.
 */

export const DriftStatusSchema = z
  .enum(["compliant", "drifted", "unassigned"])
  .describe("License state of a single user relative to the ERP contract.");
export type DriftStatus = z.infer<typeof DriftStatusSchema>;

export const HealthStateSchema = z
  .enum(["healthy", "warning", "critical", "unknown"])
  .describe("Semantic health state. healthy=emerald, warning=amber, critical=rose.");
export type HealthState = z.infer<typeof HealthStateSchema>;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const SlaTierSchema = z.enum(["Platinum", "Gold", "Silver", "Bronze"]);
export type SlaTier = z.infer<typeof SlaTierSchema>;

export const TicketSeveritySchema = z.enum(["P1", "P2", "P3", "P4"]);
export type TicketSeverity = z.infer<typeof TicketSeveritySchema>;

export const EntityTypeSchema = z
  .enum(["upn", "group", "device", "policy", "errorCode", "sku", "resource", "ticket", "contract"])
  .describe("Kind of entity an inline pill or popover refers to.");
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const RouterTierSchema = z.enum([
  "Tier 0",
  "Tier 1A",
  "Tier 1B",
  "Tier 2",
  "Tier 3A",
  "Tier 3B",
  "Voice",
  "Vision",
]);
export type RouterTier = z.infer<typeof RouterTierSchema>;

/** modal-open-weights / runpod / local-glimmer-30b: self-hosted open-weight Muse Glimmer 30B (Tier 1A / 1B). */
export const ProviderIdSchema = z.enum(["local", "fireworks", "baseten", "meta", "modal-open-weights", "runpod", "local-glimmer-30b"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const QuickActionKindSchema = z.enum([
  "issue-tap",
  "exclude-group-report-only",
  "inspect-policy",
  "assign-license",
  "view-diff",
  "generate-fix",
  "open-sign-in-logs",
  "reset-mfa",
  "custom",
]);
export type QuickActionKind = z.infer<typeof QuickActionKindSchema>;

export const QuickActionSchema = z.object({
  id: z.string().min(1).describe("Stable id, kebab-case."),
  label: z.string().min(1).max(40).describe("Button label, max 40 chars, imperative voice."),
  kind: QuickActionKindSchema,
  description: z.string().max(200).optional(),
  targetEntityId: z.string().optional().describe("Entity the action acts on (UPN, policy id, resource id)."),
  destructive: z.boolean().default(false),
});
export type QuickAction = z.infer<typeof QuickActionSchema>;

export const FactSchema = z.object({
  label: z.string().max(40),
  value: z.string().max(200),
  mono: z.boolean().default(false).describe("Render value in JetBrains Mono (ids, codes, UPNs)."),
  tone: HealthStateSchema.optional(),
});
export type Fact = z.infer<typeof FactSchema>;

export const ProviderTelemetrySchema = z.object({
  tier: RouterTierSchema,
  provider: ProviderIdSchema,
  modelId: z.string().describe("Model id as the provider names it, or 'deterministic' for Tier 0 / local fallback."),
  latencyMs: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
});
export type ProviderTelemetry = z.infer<typeof ProviderTelemetrySchema>;

export const IsoTimestampSchema = z
  .string()
  .describe("ISO-8601 timestamp, UTC, e.g. 2026-10-26T08:02:41Z");
