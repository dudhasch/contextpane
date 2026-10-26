import { z } from "zod";
import { ComponentTypeSchema } from "./layout.ts";
import { IsoTimestampSchema } from "./primitives.ts";

export const McpServerIdSchema = z.enum(["mcp-erp", "mcp-msgraph", "mcp-azure-iac"]);
export type McpServerId = z.infer<typeof McpServerIdSchema>;

export const McpBindingSchema = z.object({
  component: ComponentTypeSchema,
  server: McpServerIdSchema,
  tool: z.string().describe("MCP tool name on that server, e.g. get_sign_in_events"),
  args: z.record(z.string(), z.unknown()).default({}).describe("Static args; {{tenantId}} and {{ticketId}} are templated"),
});
export type McpBinding = z.infer<typeof McpBindingSchema>;

export const PinnedComponentSchema = z.object({
  type: ComponentTypeSchema,
  order: z.number().int().nonnegative(),
  collapsed: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({}),
});
export type PinnedComponent = z.infer<typeof PinnedComponentSchema>;

/**
 * A View Recipe is a persistent, zero-token layout description. Hydrating it is
 * pure data binding: run the MCP bindings, map results into component props,
 * validate, render. No model is involved.
 */
export const ViewRecipeSchema = z.object({
  recipeId: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(240).default(""),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  createdFromTenantId: z.string().nullable().default(null),
  pinnedComponents: z.array(PinnedComponentSchema).min(1).max(8),
  mcpBindings: z.array(McpBindingSchema),
  hotkey: z.string().max(1).optional(),
});
export type ViewRecipe = z.infer<typeof ViewRecipeSchema>;

export const DEFAULT_RECIPE_ID = "default";

export const DEFAULT_RECIPE: ViewRecipe = {
  recipeId: DEFAULT_RECIPE_ID,
  name: "MSP Escalation Triage",
  description: "License pool, sign-in & Conditional Access, Intune compliance and Azure IaC cards: every card a scenario has data for.",
  createdAt: "2026-10-26T12:00:00Z",
  updatedAt: "2026-10-26T12:00:00Z",
  createdFromTenantId: null,
  pinnedComponents: [
    { type: "LicenseDriftCard", order: 0, collapsed: true, options: {} },
    { type: "EntraSignInTimeline", order: 1, collapsed: true, options: {} },
    { type: "IntuneDriftCard", order: 2, collapsed: true, options: {} },
    { type: "IaCDriftBanner", order: 3, collapsed: true, options: {} },
  ],
  mcpBindings: [
    { component: "LicenseDriftCard", server: "mcp-msgraph", tool: "get_license_state", args: { tenantId: "{{tenantId}}" } },
    { component: "LicenseDriftCard", server: "mcp-msgraph", tool: "get_license_inventory", args: { tenantId: "{{tenantId}}" } },
    { component: "EntraSignInTimeline", server: "mcp-msgraph", tool: "get_sign_in_events", args: { tenantId: "{{tenantId}}" } },
    { component: "EntraSignInTimeline", server: "mcp-msgraph", tool: "get_conditional_access_policies", args: { tenantId: "{{tenantId}}" } },
    { component: "IntuneDriftCard", server: "mcp-msgraph", tool: "get_intune_drift", args: { scenarioId: "{{ticketId}}" } },
    { component: "IaCDriftBanner", server: "mcp-azure-iac", tool: "get_nsg_drift", args: { tenantId: "{{tenantId}}" } },
    { component: "IaCDriftBanner", server: "mcp-azure-iac", tool: "get_avd_estate", args: { tenantId: "{{tenantId}}" } },
  ],
};
