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
  .enum(["upn", "group", "device", "policy", "errorCode", "sku", "resource", "setting", "ticket", "contract"])
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
  "inspect-policy",
  "stage-license-fix",
  "stage-intune-fix",
  "view-diff",
  "generate-fix",
  "open-sign-in-logs",
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
  /** Served from a persisted model answer; latencyMs is then the serve time. */
  cached: z.boolean().optional(),
  /** Wall time of the model call that produced a cached answer. */
  generatedLatencyMs: z.number().int().nonnegative().optional(),
});
export type ProviderTelemetry = z.infer<typeof ProviderTelemetrySchema>;

/**
 * Semantic provenance of an MCP-enriched entity and of the canvas card it spawns.
 * licensing=amber, identity=rose, intune=violet, azure=teal, selection=cyan (see CATEGORY_META).
 * selection is the provenance of an ad-hoc ContextualMiniDashboard spawned from highlighted text.
 */
export const ProvenanceCategorySchema = z.enum(["licensing", "identity", "intune", "azure", "selection"]);
export type ProvenanceCategory = z.infer<typeof ProvenanceCategorySchema>;

export const IsoTimestampSchema = z
  .string()
  .describe("ISO-8601 timestamp, UTC, e.g. 2026-10-26T08:02:41Z");

/**
 * Data-plane pointer: ptr://<scenario>/<plane>/<dataset>. The orchestrator keeps the raw
 * MCP rows behind it; prompts carry only the pointer and an aggregate descriptor, and the
 * rows are bound into the layout on the data plane before it reaches the client.
 */
export const DataPtrSchema = z
  .string()
  .regex(/^ptr:\/\/[a-z0-9-]+\/(entra|intune|iac|selection)\/[a-z0-9-]+$/, "expected ptr://<scenario>/<entra|intune|iac|selection>/<dataset>")
  .describe("Data-plane pointer, e.g. ptr://inc-4092/entra/users. Copy it verbatim from the dataset descriptor.");
export type DataPtr = z.infer<typeof DataPtrSchema>;

/** What the model emits in place of a row set: the pointer, never the rows. */
export const DataPtrRefSchema = z.object({ dataPtr: DataPtrSchema });
export type DataPtrRef = z.infer<typeof DataPtrRefSchema>;

/** Where a drifted resource or a golden-baseline rule is declared in the repository. */
export const SourceRefSchema = z.object({
  file: z.string().describe("Repo-relative path, e.g. demo-iac/main.tf"),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  ref: z.string().default("main").describe("Git ref the lines were read from"),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** CodeLens label: demo-iac/main.tf:L43-L84 (or :L7 for one line). */
export function formatSourceRef(ref: Pick<SourceRef, "file" | "startLine" | "endLine">): string {
  return `${ref.file}:L${ref.startLine}${ref.endLine !== ref.startLine ? `-L${ref.endLine}` : ""}`;
}

/**
 * How an approved fix lands. break-glass: write the live Graph/ARM resource now, then
 * commit the matching state to the canonical fix/* branch. gitops: change nothing live;
 * stage the patch, re-run the sandbox pre-flight and leave deployment to the pipeline.
 */
export const ExecutionModeSchema = z.enum(["break-glass", "gitops"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
