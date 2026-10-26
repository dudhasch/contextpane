import { z } from "zod";
import {
  ActionApprovalDrawerSchema,
  EntraSignInTimelineSchema,
  HoverDiagnosticPopoverSchema,
  IaCDriftBannerSchema,
  IntuneDriftCardSchema,
  LicenseDriftCardSchema,
} from "./components.ts";
import { DataPtrSchema, IsoTimestampSchema, ProviderIdSchema, RouterTierSchema } from "./primitives.ts";

/**
 * The allow-list. Anything not in here cannot be rendered — the canvas has no
 * generic "markdown" or "text" component on purpose.
 */
export const COMPONENT_TYPES = [
  "LicenseDriftCard",
  "EntraSignInTimeline",
  "IntuneDriftCard",
  "IaCDriftBanner",
  "HoverDiagnosticPopover",
  "ActionApprovalDrawer",
] as const;
export const ComponentTypeSchema = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

/** The four cards a layout can pin to the canvas (the popover and the drawer come from their own tiers). */
export const CANVAS_COMPONENT_TYPES = ["LicenseDriftCard", "EntraSignInTimeline", "IntuneDriftCard", "IaCDriftBanner"] as const;
export type CanvasComponentType = (typeof CANVAS_COMPONENT_TYPES)[number];

export function isCanvasComponentType(value: unknown): value is CanvasComponentType {
  return typeof value === "string" && (CANVAS_COMPONENT_TYPES as readonly string[]).includes(value);
}

const componentId = z.string().min(1).describe("Stable id for React keys and pinning, kebab-case.");
const triggeredBy = z
  .array(z.string())
  .max(8)
  .default([])
  .describe("Ids of the left-pane entities that spawned this card (UPNs, SKUs, policy names, resources)");
const dataPtrs = z
  .record(z.string(), DataPtrSchema)
  .default({})
  .describe("Prop name → ptr:// URI the data plane bound that prop's rows from");

export const LayoutComponentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LicenseDriftCard"), id: componentId, triggeredBy, dataPtrs, props: LicenseDriftCardSchema }),
  z.object({ type: z.literal("EntraSignInTimeline"), id: componentId, triggeredBy, dataPtrs, props: EntraSignInTimelineSchema }),
  z.object({ type: z.literal("IntuneDriftCard"), id: componentId, triggeredBy, dataPtrs, props: IntuneDriftCardSchema }),
  z.object({ type: z.literal("IaCDriftBanner"), id: componentId, triggeredBy, dataPtrs, props: IaCDriftBannerSchema }),
  z.object({ type: z.literal("HoverDiagnosticPopover"), id: componentId, triggeredBy, dataPtrs, props: HoverDiagnosticPopoverSchema }),
  z.object({ type: z.literal("ActionApprovalDrawer"), id: componentId, triggeredBy, dataPtrs, props: ActionApprovalDrawerSchema }),
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
  ticketId: z.string().describe("Scenario that triggered the correlation: an ERP ticket (INC-4092) or a tenant anomaly (ANOM-LIC-101)"),
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
