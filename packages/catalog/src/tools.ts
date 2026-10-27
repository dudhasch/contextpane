import { z } from "zod";
import { DATASETS, datasetsFor } from "./dataplane.ts";
import {
  EntraSignInTimelineSchema,
  HoverDiagnosticPopoverSchema,
  IaCDriftBannerSchema,
  IntuneDriftCardSchema,
  LicenseDriftCardSchema,
} from "./schemas/components.ts";
import type { CanvasComponentType } from "./schemas/layout.ts";
import { ContextualMiniDashboardModelArgsSchema } from "./schemas/mini-dashboard.ts";
import { DataPtrRefSchema, EntityTypeSchema } from "./schemas/primitives.ts";

/**
 * OpenAI-compatible function-calling tool definitions.
 *
 * Baseten's `meta-models/muse-spark-open-1026` supports `tools` + `tool_choice`
 * but NOT `response_format: { type: "json_schema" }`. Forcing a single function
 * tool is the portable way to get strict JSON out of every provider we route to
 * (Baseten, Fireworks, Meta Model API) with one payload shape.
 */

export interface OpenAIFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ForcedToolChoice {
  type: "function";
  function: { name: string };
}

export const HYDRATE_LAYOUT_TOOL_NAME = "hydrate_contextpane_layout";
export const HOVER_DIAGNOSTIC_TOOL_NAME = "emit_hover_diagnostic";
export const REMEDIATION_BUNDLE_TOOL_NAME = "emit_remediation_bundle";
export const STEER_LAYOUT_TOOL_NAME = "steer_contextpane_layout";

/**
 * Convert a Zod schema to the JSON Schema dialect function-calling endpoints
 * expect. Strips `$schema` (several OpenAI-compatible servers reject it) and
 * keeps the schema self-contained (no $defs needed for our shapes).
 */
export function zodToToolParameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    unrepresentable: "any",
    io: "input",
    reused: "inline",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function forcedToolChoice(name: string): ForcedToolChoice {
  return { type: "function", function: { name } };
}

/* ----------------------------- Tier 1B / Tier 2 ---------------------------- */

/** A card's props as the model writes them: every dataset prop is a { dataPtr } reference, sourceRef is the orchestrator's. */
function modelProps<T extends z.ZodObject>(type: CanvasComponentType, schema: T) {
  const pointers = Object.fromEntries(
    datasetsFor(type).map((k) => [DATASETS[k].prop, DataPtrRefSchema.optional().describe(`{ "dataPtr": "ptr://<scenario>/${k}" } from the ${k} descriptor`)]),
  );
  const owned = "sourceRef" in schema.shape ? schema.omit({ sourceRef: true } as never) : schema;
  return owned.extend(pointers);
}

const modelComponentId = z.string().min(1).describe("Stable id, kebab-case, e.g. license-drift-card-inc-4092");

/**
 * What Tier 1B / Tier 2 are asked to emit: the four canvas cards with their row sets
 * replaced by data-plane pointers. The orchestrator binds the rows and validates the
 * result against HydrateLayoutArgsSchema, so the model never serialises customer data.
 */
export const HydrateLayoutModelArgsSchema = z.object({
  tenantId: z.string().describe("Tenant the layout is for, e.g. tenant-contoso-01"),
  ticketId: z.string().describe("Scenario that triggered the correlation, e.g. INC-4092 or ANOM-LIC-101"),
  components: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("LicenseDriftCard"), id: modelComponentId, props: modelProps("LicenseDriftCard", LicenseDriftCardSchema) }),
        z.object({ type: z.literal("EntraSignInTimeline"), id: modelComponentId, props: modelProps("EntraSignInTimeline", EntraSignInTimelineSchema) }),
        z.object({ type: z.literal("IntuneDriftCard"), id: modelComponentId, props: modelProps("IntuneDriftCard", IntuneDriftCardSchema) }),
        z.object({ type: z.literal("IaCDriftBanner"), id: modelComponentId, props: modelProps("IaCDriftBanner", IaCDriftBannerSchema) }),
      ]),
    )
    .min(1)
    .max(4)
    .describe("Ordered canvas cards. Dataset props are { dataPtr } references copied from the descriptors, never rows."),
});

export function getHydrateLayoutToolDefinition(): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: HYDRATE_LAYOUT_TOOL_NAME,
      description:
        "Hydrate the ContextPane generative UI canvas. Emit an ordered list of catalog components " +
        "(LicenseDriftCard, EntraSignInTimeline, IntuneDriftCard, IaCDriftBanner) whose scalar props are " +
        "filled exclusively from the supplied context (ERP ticket or tenant anomaly plus one schema-and-aggregate " +
        "descriptor per dataset). Row sets are never written out: set each dataset prop to { \"dataPtr\": \"ptr://...\" } " +
        "copied from its descriptor. Never emit prose, markdown or components outside the catalog. Never invent " +
        "users, policies, rules or identifiers.",
      parameters: zodToToolParameters(HydrateLayoutModelArgsSchema),
    },
  };
}

export function getHydrateLayoutToolChoice(): ForcedToolChoice {
  return forcedToolChoice(HYDRATE_LAYOUT_TOOL_NAME);
}

/* --------------------------------- Tier 1A --------------------------------- */

/** The hover tool omits providerTelemetry; the orchestrator stamps it. */
export const HoverDiagnosticArgsSchema = HoverDiagnosticPopoverSchema.omit({
  providerTelemetry: true,
  latencyBudgetMs: true,
});
export type HoverDiagnosticArgs = z.infer<typeof HoverDiagnosticArgsSchema>;

export function getHoverDiagnosticToolDefinition(): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: HOVER_DIAGNOSTIC_TOOL_NAME,
      description:
        "Produce a compact inline diagnostic for the hovered entity (UPN, group, device, Conditional Access policy, " +
        "AADSTS error code, SKU or Azure resource). One headline, a verified error-code translation when applicable, " +
        "up to 8 facts and up to 4 quick actions. Use only the supplied context and the AADSTS catalog.",
      parameters: zodToToolParameters(HoverDiagnosticArgsSchema),
    },
  };
}

export function getHoverDiagnosticToolChoice(): ForcedToolChoice {
  return forcedToolChoice(HOVER_DIAGNOSTIC_TOOL_NAME);
}

/* ------------------------------ Tier 3A / 3B ------------------------------- */

export const RemediationBundleArgsSchema = z.object({
  title: z.string().max(120),
  summary: z.string().max(600),
  powershellScript: z
    .string()
    .describe(
      "Complete PowerShell 7 script. Must use Set-MgUserLicense for license changes and " +
        "Update-MgIdentityConditionalAccessPolicy for Conditional Access changes. Must support -WhatIf.",
    ),
  terraformDiff: z
    .string()
    .default("")
    .describe("Unified diff (---/+++ headers, @@ hunks) that removes rogue rules and restores drifted tags in the Terraform baseline; empty when the fix has no IaC part."),
  graphPatch: z.string().default("").describe("The Microsoft Graph request bodies the fix sends (JSON), for review and manual runs."),
  affectedEntities: z
    .array(
      z.object({
        type: EntityTypeSchema,
        id: z.string(),
        change: z.string().max(200),
      }),
    )
    .max(20),
  riskNotes: z.array(z.string().max(300)).max(6).default([]),
});
export type RemediationBundleArgs = z.infer<typeof RemediationBundleArgsSchema>;

export function getRemediationBundleToolDefinition(): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: REMEDIATION_BUNDLE_TOOL_NAME,
      description:
        "Emit a Human-in-the-Loop remediation bundle: an exact PowerShell 7 Microsoft.Graph script plus, where the scenario " +
        "has IaC drift, a unified Terraform diff, that together resolve the correlated license, Conditional Access, Intune and NSG drift. " +
        "The bundle will be AST-parsed and terraform-validated before a human approves it. Do not execute anything.",
      parameters: zodToToolParameters(RemediationBundleArgsSchema),
    },
  };
}

export function getRemediationBundleToolChoice(): ForcedToolChoice {
  return forcedToolChoice(REMEDIATION_BUNDLE_TOOL_NAME);
}

/* ---------------------------------- Voice ---------------------------------- */

export const SteerLayoutArgsSchema = z.object({
  intent: z.enum(["filter", "pin", "unpin", "switch-tenant", "switch-scenario", "focus", "reset", "generate-fix", "unknown"]),
  componentTypes: z
    .array(z.enum(["LicenseDriftCard", "EntraSignInTimeline", "IntuneDriftCard", "IaCDriftBanner"]))
    .default([])
    .describe("Components the command refers to, if any"),
  tenantId: z.string().optional().describe("Target tenant id when intent is switch-tenant"),
  scenarioId: z.string().optional().describe("Target scenario (INC-4092, INC-4099, ANOM-LIC-101, ANOM-CA-204, ANOM-INT-309) when intent is switch-scenario"),
  recipeName: z.string().optional().describe("Recipe name when intent is pin"),
  transcript: z.string().describe("What the user said, normalised"),
  confidence: z.number().min(0).max(1),
});
export type SteerLayoutArgs = z.infer<typeof SteerLayoutArgsSchema>;

export function getSteerLayoutToolDefinition(): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: STEER_LAYOUT_TOOL_NAME,
      description:
        "Interpret a spoken or typed operator command for the ContextPane canvas and map it to a layout intent: " +
        "filter to specific components, pin the current view as a recipe, switch tenant or scenario, focus a component, reset, or generate a fix.",
      parameters: zodToToolParameters(SteerLayoutArgsSchema),
    },
  };
}

export function getSteerLayoutToolChoice(): ForcedToolChoice {
  return forcedToolChoice(STEER_LAYOUT_TOOL_NAME);
}

/* ------------------------------ Convenience -------------------------------- */

export interface ForcedToolRequest {
  tools: OpenAIFunctionTool[];
  tool_choice: ForcedToolChoice;
}

/** Build the `tools` + `tool_choice` pair for a chat completion request. */
export function buildForcedToolRequest(tool: OpenAIFunctionTool): ForcedToolRequest {
  return { tools: [tool], tool_choice: forcedToolChoice(tool.function.name) };
}

/* ------------------------ Contextual mini-dashboard ------------------------ */

export const COMPOSE_MINI_DASHBOARD_TOOL_NAME = "compose_contextual_mini_dashboard";

/**
 * What muse-spark-1.3 is asked to emit for a highlighted phrase: title, subtitle, KPIs,
 * breakdown, columns and the suggested action, with the rows referenced through the
 * selection pointer. The orchestrator binds the rows and validates the result against
 * ContextualMiniDashboardSchema.
 */
export function getComposeMiniDashboardToolDefinition(): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: COMPOSE_MINI_DASHBOARD_TOOL_NAME,
      description:
        "Compose one ContextualMiniDashboard card for the phrase an engineer highlighted in a ticket. " +
        "Use only the supplied selection descriptor (row count, columns, aggregates, source query, candidate KPIs). " +
        'Set rows to { "dataPtr": "<the descriptor pointer>" } and never write rows yourself. ' +
        "2-4 KPIs, 2-5 breakdown bars whose pct values describe the matched rows, 1-8 columns that exist in the descriptor, " +
        "and one suggested action with a concrete PowerShell or Graph command. No prose outside the tool call.",
      parameters: zodToToolParameters(ContextualMiniDashboardModelArgsSchema),
    },
  };
}
