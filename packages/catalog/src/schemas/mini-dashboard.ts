import { z } from "zod";

/**
 * ContextualMiniDashboard: the polymorphic card primitive behind "highlight any text →
 * Generate Context UI". An engineer selects a phrase in the ticket or anomaly text
 * ("uncompliant device", "port 3389", "expired client secret", a UPN), the orchestrator
 * assembles the matching slice of live tenant data, holds the rows on the data plane under
 * ptr://<scenario>/selection/<hash>, and muse-spark-1.3 (or the deterministic synthesiser)
 * composes the card from the pointer summary. The rows are bound back on the data plane,
 * so no customer row ever reaches the model.
 */

export const MetricToneSchema = z.enum(["default", "warning", "critical", "success"]);
export type MetricTone = z.infer<typeof MetricToneSchema>;

export const MiniDashboardKpiSchema = z.object({
  label: z.string().max(40),
  value: z.string().max(40).describe("Formatted value, e.g. '6 devices' or '2/15'"),
  tone: MetricToneSchema.default("default"),
});
export type MiniDashboardKpi = z.infer<typeof MiniDashboardKpiSchema>;

export const MiniDashboardBreakdownSchema = z.object({
  label: z.string().max(60),
  count: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100).describe("Share of the matched rows, 0-100"),
  tone: MetricToneSchema.default("default"),
});
export type MiniDashboardBreakdown = z.infer<typeof MiniDashboardBreakdownSchema>;

export const MiniDashboardColumnSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().max(40),
  mono: z.boolean().optional().describe("JetBrains Mono: identifiers, codes, UPNs"),
  isBadge: z.boolean().optional().describe("Render as a status pill"),
});
export type MiniDashboardColumn = z.infer<typeof MiniDashboardColumnSchema>;

export const MiniDashboardSuggestedActionSchema = z.object({
  label: z.string().min(1).max(48),
  scriptPreview: z.string().max(1200).describe("Targeted PowerShell / Graph command the engineer can copy"),
  targetStepIndex: z.number().int().nonnegative().optional().describe("Index of the Resolution Plan step this action belongs to"),
});
export type MiniDashboardSuggestedAction = z.infer<typeof MiniDashboardSuggestedActionSchema>;

/** ptr://<scenario>/selection/<hash> (rows of one explored selection on the data plane). */
export const SelectionDataPtrSchema = z
  .string()
  .regex(/^ptr:\/\/[a-z0-9-]+\/selection\/[a-z0-9]{4,16}$/, "expected ptr://<scenario>/selection/<hash>")
  .describe("Data-plane pointer of the matched rows, e.g. ptr://inc-4092/selection/k3f9a1x2");
export type SelectionDataPtr = z.infer<typeof SelectionDataPtrSchema>;

export const ContextualMiniDashboardSchema = z.object({
  id: z.string().min(1).describe("Stable id, e.g. selection-k3f9a1x2"),
  selectionText: z.string().min(1).max(120).describe("The exact phrase the engineer highlighted"),
  title: z.string().min(1).max(90),
  subtitle: z.string().max(160).describe("e.g. 'Live query across deviceManagement/managedDevices · 6 devices matched'"),
  sourceQuery: z.string().min(1).max(300).describe("The Graph REST / KQL / ARM query that produced the rows"),
  provenanceCategory: z.literal("selection"),
  kpis: z.array(MiniDashboardKpiSchema).min(2).max(4),
  breakdown: z.array(MiniDashboardBreakdownSchema).min(2).max(5),
  columns: z.array(MiniDashboardColumnSchema).min(1).max(8),
  rowsPtr: SelectionDataPtrSchema,
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(60),
  suggestedAction: MiniDashboardSuggestedActionSchema,
});
export type ContextualMiniDashboard = z.infer<typeof ContextualMiniDashboardSchema>;

/**
 * What the model is asked to compose: everything but the rows, which it references
 * through { dataPtr } (the data plane binds them) and never serialises.
 */
export const ContextualMiniDashboardModelArgsSchema = ContextualMiniDashboardSchema.omit({ rows: true, provenanceCategory: true, rowsPtr: true, id: true, selectionText: true }).extend({
  rows: z.object({ dataPtr: SelectionDataPtrSchema }).describe('{ "dataPtr": "<the selection pointer from the descriptor>" }'),
});
export type ContextualMiniDashboardModelArgs = z.infer<typeof ContextualMiniDashboardModelArgsSchema>;

export const SELECTION_PROVENANCE_COLOR = "#06b6d4";

/** Selection text length window the floating trigger accepts. */
export const SELECTION_MIN_CHARS = 3;
export const SELECTION_MAX_CHARS = 120;

/** FNV-1a over the scenario and the lower-cased selection: a stable, URL-safe short hash. */
export function selectionHash(scenarioId: string, selectedText: string): string {
  const input = `${scenarioId.toLowerCase()}|${selectedText.trim().toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(0, 8);
}

export function selectionDataPtr(scenarioId: string, hash: string): SelectionDataPtr {
  return `ptr://${scenarioId.toLowerCase()}/selection/${hash}`;
}

export function parseSelectionPtr(value: unknown): { scenario: string; hash: string } | null {
  if (typeof value !== "string") return null;
  const m = /^ptr:\/\/([a-z0-9-]+)\/selection\/([a-z0-9]{4,16})$/.exec(value);
  return m ? { scenario: m[1]!, hash: m[2]! } : null;
}
