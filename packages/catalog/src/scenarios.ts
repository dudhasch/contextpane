import { z } from "zod";
import { CANVAS_COMPONENT_TYPES, type CanvasComponentType } from "./schemas/layout.ts";
import { EntityTypeSchema, ProvenanceCategorySchema, type ProvenanceCategory } from "./schemas/primitives.ts";
import type { TenantId } from "./tenants.ts";

/**
 * A scenario is what the engineer works on: a reactive customer ticket from the
 * PSA, or a proactive anomaly detected straight from Entra ID, Intune and Azure.
 * Every endpoint that renders, remediates or resets is keyed by scenario id; the
 * tenant only decides which MCP data and which lab tenant it reads.
 */
export const SCENARIO_IDS = ["INC-4092", "INC-4099", "ANOM-LIC-101", "ANOM-CA-204", "ANOM-INT-309"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const ScenarioKindSchema = z.enum(["ticket", "anomaly"]);
export type ScenarioKind = z.infer<typeof ScenarioKindSchema>;

export interface ScenarioRegistryEntry {
  scenarioId: ScenarioId;
  kind: ScenarioKind;
  tenantId: TenantId;
  /** Short operational title for the selector. */
  title: string;
  /** What a Tier 3 fix reconciles; used in the canonical PR title. */
  remediationScope: string;
  /** Cards the scenario renders, in canvas order. */
  components: CanvasComponentType[];
}

export const SCENARIO_REGISTRY: Record<ScenarioId, ScenarioRegistryEntry> = {
  "INC-4092": {
    scenarioId: "INC-4092",
    kind: "ticket",
    tenantId: "tenant-contoso-01",
    title: "Contoso Finance · AVD, License & NSG Drift",
    remediationScope: "AVD NSG drift & E5 license state",
    components: ["LicenseDriftCard", "EntraSignInTimeline", "IaCDriftBanner"],
  },
  "INC-4099": {
    scenarioId: "INC-4099",
    kind: "ticket",
    tenantId: "tenant-fabrikam-02",
    title: "Fabrikam Legal · Intune BitLocker & Compliance Drift",
    remediationScope: "Intune BitLocker policy conflict & device compliance",
    components: ["IntuneDriftCard", "EntraSignInTimeline"],
  },
  "ANOM-LIC-101": {
    scenarioId: "ANOM-LIC-101",
    kind: "anomaly",
    tenantId: "tenant-contoso-01",
    title: "License CountViolation & Orphaned Seats",
    remediationScope: "SPE_E5 CountViolation & orphaned licenses",
    components: ["LicenseDriftCard"],
  },
  "ANOM-CA-204": {
    scenarioId: "ANOM-CA-204",
    kind: "anomaly",
    tenantId: "tenant-contoso-01",
    title: "Conditional Access Drift & Missing Break-Glass Exclusion",
    remediationScope: "Conditional Access drift & break-glass exclusion",
    components: ["EntraSignInTimeline"],
  },
  "ANOM-INT-309": {
    scenarioId: "ANOM-INT-309",
    kind: "anomaly",
    tenantId: "tenant-contoso-01",
    title: "Intune ASR Baseline & Firewall Policy Drift",
    remediationScope: "Intune ASR baseline drift & firewall conflict",
    components: ["IntuneDriftCard"],
  },
};

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && (SCENARIO_IDS as readonly string[]).includes(value);
}

/** The ticket scenario of a tenant, for callers that still speak tenant ids. */
export function scenarioForTenant(tenantId: string): ScenarioId {
  return SCENARIO_IDS.find((id) => SCENARIO_REGISTRY[id].kind === "ticket" && SCENARIO_REGISTRY[id].tenantId === tenantId) ?? "INC-4092";
}

export function scenariosOfKind(kind: ScenarioKind): ScenarioId[] {
  return SCENARIO_IDS.filter((id) => SCENARIO_REGISTRY[id].kind === kind);
}

/* -------------------------------------------------------------------------- */
/* Semantic provenance colours                                                 */
/* -------------------------------------------------------------------------- */

export const CATEGORY_META: Record<ProvenanceCategory, { label: string; short: string; color: string }> = {
  licensing: { label: "Licensing & SKUs", short: "Licensing", color: "#f59e0b" },
  identity: { label: "Identity, Sign-Ins & Conditional Access", short: "Identity & CA", color: "#f43f5e" },
  intune: { label: "Intune & Device Compliance", short: "Intune", color: "#a855f7" },
  azure: { label: "Azure, Host Pool & Network IaC", short: "Azure IaC", color: "#14b8a6" },
};

export const COMPONENT_CATEGORY: Record<CanvasComponentType, ProvenanceCategory> = {
  LicenseDriftCard: "licensing",
  EntraSignInTimeline: "identity",
  IntuneDriftCard: "intune",
  IaCDriftBanner: "azure",
};

/* -------------------------------------------------------------------------- */
/* Left pane: summary, resolution plan and enriched entities                   */
/* -------------------------------------------------------------------------- */

const CanvasComponentTypeSchema = z.enum(CANVAS_COMPONENT_TYPES);

export const EnrichedEntitySchema = z.object({
  id: z.string(),
  label: z.string(),
  type: EntityTypeSchema,
  category: ProvenanceCategorySchema,
  /** The card this entity spawned; hovering the pill lights it, clicking expands it. */
  target: CanvasComponentTypeSchema,
  /** Tab of the target card that shows this entity best. */
  tab: z.string().optional(),
  note: z.string().max(80).optional(),
  hoverable: z.boolean().default(true),
});
export type EnrichedEntity = z.infer<typeof EnrichedEntitySchema>;

export const ResolutionStepSchema = z.object({
  id: z.string(),
  category: ProvenanceCategorySchema,
  title: z.string().max(40).describe("Short label, e.g. License Upgrade"),
  detail: z.string().max(220),
  target: CanvasComponentTypeSchema,
  tab: z.string().optional(),
  action: z.object({
    label: z.string().max(32),
    kind: z.enum(["inspect", "stage-fix", "view-diff"]),
  }),
});
export type ResolutionStep = z.infer<typeof ResolutionStepSchema>;

export const ScenarioSignalSchema = z.object({
  label: z.string().max(60),
  value: z.string().max(240),
  category: ProvenanceCategorySchema,
  source: z.string().max(80).describe("Graph / ARM endpoint the signal came from"),
});
export type ScenarioSignal = z.infer<typeof ScenarioSignalSchema>;

export const ScenarioBriefSchema = z.object({
  scenarioId: z.enum(SCENARIO_IDS),
  kind: ScenarioKindSchema,
  tenantId: z.string(),
  tenantName: z.string(),
  verifiedDomain: z.string(),
  title: z.string(),
  status: z.string().describe("Open / In Progress for tickets, Detected for anomalies"),
  openedAt: z.string(),
  /** Where the scenario came from: the PSA ticket or the Graph / ARM queries that detected it. */
  origin: z.string(),
  /** Ticket description, or the anomaly narrative. Entity ids inside it render as hover pills. */
  body: z.string(),
  signals: z.array(ScenarioSignalSchema).max(10).default([]),
  summary: z.string().max(400).describe("1-2 sentence technical root cause"),
  steps: z.array(ResolutionStepSchema).max(6),
  entities: z.array(EnrichedEntitySchema).max(24),
  requester: z.object({ displayName: z.string(), upn: z.string(), role: z.string() }).nullable(),
  contract: z
    .object({
      contractId: z.string(),
      title: z.string(),
      lines: z.array(z.object({ description: z.string(), skuPartNumber: z.string(), quantity: z.number() })),
      terms: z.array(z.string()),
    })
    .nullable(),
  infrastructureSpec: z.string().nullable(),
  timeline: z.array(z.object({ at: z.string(), actor: z.string(), note: z.string() })).default([]),
  attachments: z
    .array(z.object({ fileName: z.string(), mimeType: z.string(), url: z.string(), uploadedBy: z.string(), uploadedAt: z.string(), sizeBytes: z.number() }))
    .default([]),
  /** Where each MCP source answered from: live tenant reads or fixtures. */
  sources: z.record(z.string(), z.string()),
});
export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;

export interface ScenarioListItem {
  scenarioId: ScenarioId;
  kind: ScenarioKind;
  tenantId: string;
  tenantName: string;
  title: string;
  resolved: boolean;
}
