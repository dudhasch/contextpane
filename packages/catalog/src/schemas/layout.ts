import { z } from "zod";
import {
  ActionApprovalDrawerSchema,
  EntraSignInTimelineSchema,
  HoverDiagnosticPopoverSchema,
  IaCDriftBannerSchema,
  LicenseDriftCardSchema,
  TenantSummaryHeaderSchema,
} from "./components.ts";
import { IsoTimestampSchema, ProviderIdSchema, RouterTierSchema } from "./primitives.ts";

/**
 * The allow-list. Anything not in here cannot be rendered — the canvas has no
 * generic "markdown" or "text" component on purpose.
 */
export const COMPONENT_TYPES = [
  "TenantSummaryHeader",
  "LicenseDriftCard",
  "EntraSignInTimeline",
  "IaCDriftBanner",
  "HoverDiagnosticPopover",
  "ActionApprovalDrawer",
] as const;
export const ComponentTypeSchema = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

const componentId = z.string().min(1).describe("Stable id for React keys and pinning, kebab-case.");

export const LayoutComponentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TenantSummaryHeader"), id: componentId, props: TenantSummaryHeaderSchema }),
  z.object({ type: z.literal("LicenseDriftCard"), id: componentId, props: LicenseDriftCardSchema }),
  z.object({ type: z.literal("EntraSignInTimeline"), id: componentId, props: EntraSignInTimelineSchema }),
  z.object({ type: z.literal("IaCDriftBanner"), id: componentId, props: IaCDriftBannerSchema }),
  z.object({ type: z.literal("HoverDiagnosticPopover"), id: componentId, props: HoverDiagnosticPopoverSchema }),
  z.object({ type: z.literal("ActionApprovalDrawer"), id: componentId, props: ActionApprovalDrawerSchema }),
]);
export type LayoutComponent = z.infer<typeof LayoutComponentSchema>;

export const FallbackStepSchema = z.object({
  provider: ProviderIdSchema,
  modelId: z.string(),
  outcome: z.enum(["ok", "timeout", "error", "skipped", "invalid-schema", "no-key"]),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type FallbackStep = z.infer<typeof FallbackStepSchema>;

export const ProvenanceSchema = z.object({
  tier: RouterTierSchema,
  provider: ProviderIdSchema,
  modelId: z.string(),
  latencyMs: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  fallbackChain: z.array(FallbackStepSchema).default([]),
  validated: z.boolean().default(true).describe("True when the payload passed Zod validation unchanged"),
  repaired: z.array(z.string()).default([]).describe("Component ids the deterministic hydrator had to replace"),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * What the LLM is asked to produce. Provenance and timestamps are stamped by
 * the orchestrator, so they are deliberately *not* part of the tool arguments.
 */
export const HydrateLayoutArgsSchema = z.object({
  tenantId: z.string().describe("Tenant the layout is for, e.g. tenant-contoso-01"),
  ticketId: z.string().describe("ERP ticket that triggered the correlation, e.g. INC-4092"),
  components: z
    .array(LayoutComponentSchema)
    .min(1)
    .max(8)
    .describe(
      "Ordered list of catalog components. Use exactly the data supplied in the MCP context; never invent users, policies or resources.",
    ),
});
export type HydrateLayoutArgs = z.infer<typeof HydrateLayoutArgsSchema>;

export const LayoutSchema = HydrateLayoutArgsSchema.extend({
  layoutId: z.string(),
  generatedAt: IsoTimestampSchema,
  recipeId: z.string().nullable().default(null),
  provenance: ProvenanceSchema,
});
export type Layout = z.infer<typeof LayoutSchema>;

/**
 * Router telemetry event — one per request, broadcast over the WebSocket.
 */
export const RouterTelemetrySchema = z.object({
  requestId: z.string(),
  endpoint: z.string(),
  tier: RouterTierSchema,
  provider: ProviderIdSchema,
  modelId: z.string(),
  latencyMs: z.number().int().nonnegative(),
  tokensUsed: z.object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  fallbackChain: z.array(FallbackStepSchema),
  timestamp: IsoTimestampSchema,
  tenantId: z.string().optional(),
  estimatedSavings: z
    .object({
      tokens: z.number().int().nonnegative(),
      ms: z.number().int().nonnegative(),
      versus: z.string().describe("What the saving is measured against, e.g. 'full Tier 2 correlate'"),
    })
    .optional(),
  liveCloudMode: z.boolean().default(false),
});
export type RouterTelemetry = z.infer<typeof RouterTelemetrySchema>;
