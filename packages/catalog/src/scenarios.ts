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
export const SCENARIO_IDS = ["INC-4092", "INC-4099", "ANOM-LIC-101", "ANOM-CA-204", "ANOM-INT-309", "ANOM-APP-401"] as const;
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
  "ANOM-APP-401": {
    scenarioId: "ANOM-APP-401",
    kind: "anomaly",
    tenantId: "tenant-contoso-01",
    title: "Entra Workload Identity: Shadow-Admin App Owner, Overprivileged Graph Scopes & Expired Secret (AADSTS7000222)",
    remediationScope: "workload identity shadow-admin owner, overprivileged Graph scopes & expired secret",
    components: ["EntraSignInTimeline"],
  },
};

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && (SCENARIO_IDS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Unscripted (ad-hoc) tickets: CUSTOM-<shortHash>                             */
/* -------------------------------------------------------------------------- */

/**
 * A free-form ticket the engineer pasted into the composer. It is triaged live against
 * the tenant and keeps its own id for pointers (ptr://custom-<hash>/...), its brief, its
 * convergence and its audit rows, while `baseScenarioId` names the built-in scenario whose
 * data gathering, remediation template and formal invariants it inherits.
 */
export type CustomScenarioId = `CUSTOM-${string}` | `ERP-${string}`;
export type WorkbenchScenarioId = ScenarioId | CustomScenarioId;

/** CUSTOM-<hash> for a pasted ticket, ERP-<id> for a folder dropped into input/tickets/#<id>/. */
export const CUSTOM_SCENARIO_ID_RE = /^(CUSTOM-[A-Z0-9]{4,12}|ERP-[A-Z0-9]{3,16})$/;

/* -------------------------------------------------------------------------- */
/* Work items: one operational stream, differentiated by origin                */
/* -------------------------------------------------------------------------- */

/**
 * Where a work item came from. A reactive PSA ticket, a proactive anomaly detected from the
 * live tenant, a ticket folder dropped into the ERP inbox on disk, or text pasted into the
 * composer. They are one queue in the workbench; the origin only decides the badge.
 */
export const WorkItemOriginSchema = z.enum(["psa", "anomaly", "erp-drop", "unscripted"]);
export type WorkItemOrigin = z.infer<typeof WorkItemOriginSchema>;

export const WORK_ITEM_ORIGIN_META: Record<WorkItemOrigin, { label: string; short: string }> = {
  psa: { label: "PSA Ticket", short: "Ticket" },
  anomaly: { label: "Live Graph Anomaly", short: "Anomaly" },
  "erp-drop": { label: "ERP File Drop", short: "ERP Drop" },
  unscripted: { label: "Ad-Hoc Triage", short: "Unscripted" },
};

export const TicketAttachmentSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  url: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  sizeBytes: z.number(),
});
export type TicketAttachment = z.infer<typeof TicketAttachmentSchema>;

/** `#2026323` → `ERP-2026323`; already-normalised ids pass through. */
export function erpScenarioId(folderOrId: string): CustomScenarioId {
  const core = folderOrId.trim().replace(/^#/, "").replace(/^ERP-/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  return `ERP-${core}`;
}

/** What the engineer sees: `#2026323` for an ERP drop, `#INC-4092` / `#CUSTOM-7F3A2B` otherwise. */
export function displayScenarioId(scenarioId: string): string {
  return scenarioId.startsWith("ERP-") ? `#${scenarioId.slice(4)}` : `#${scenarioId}`;
}

export const ExtractedEntityTypeSchema = z.enum(["upn", "name", "errorCode", "sku", "keyword", "group", "resource", "device", "policy", "permission"]);
export type ExtractedEntityType = z.infer<typeof ExtractedEntityTypeSchema>;

export const TicketIntentSchema = z.enum([
  "avd",
  "nsg",
  "license",
  "conditional-access",
  "break-glass",
  "legacy-auth",
  "bitlocker",
  "intune-compliance",
  "asr",
  "firewall",
  "workload-identity",
  "oauth",
  "secret",
  "copilot",
]);
export type TicketIntent = z.infer<typeof TicketIntentSchema>;

export const ExtractedEntitySchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ExtractedEntityTypeSchema,
  category: ProvenanceCategorySchema,
  /** The live MCP object the mention resolved to (UPN of a matched user, policy name, ...); null when unresolved. */
  resolvedTo: z.string().nullable().default(null),
  source: z.string().max(80).describe("MCP server / Graph endpoint the entity was matched against"),
  confidence: z.number().min(0).max(1).default(1),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const TicketExtractionSchema = z.object({
  tenantId: z.string(),
  baseScenarioId: z.enum(SCENARIO_IDS),
  intents: z.array(TicketIntentSchema),
  entities: z.array(ExtractedEntitySchema),
  components: z.array(z.enum(CANVAS_COMPONENT_TYPES)).min(1),
  /** Why this base scenario won: the intents and entities that voted for it. */
  rationale: z.string().max(300),
});
export type TicketExtraction = z.infer<typeof TicketExtractionSchema>;

export interface CustomTicketInput {
  title: string;
  body: string;
  customerName?: string;
  requester?: { displayName: string; upn: string; role: string };
  priority?: string;
}

/** The folder of an ERP drop (`#2026323`) and the image files discovered next to its ticketbody.json. */
export interface ErpDropSource {
  folder: string;
  ingestedAt: string;
  attachments: TicketAttachment[];
}

export interface CustomScenarioEntry extends Omit<ScenarioRegistryEntry, "scenarioId"> {
  scenarioId: CustomScenarioId;
  kind: "ticket";
  /** Pasted into the composer, or dropped into input/tickets/ as a folder. */
  origin: "unscripted" | "erp-drop";
  baseScenarioId: ScenarioId;
  shortHash: string;
  createdAt: string;
  ticket: CustomTicketInput;
  extraction: TicketExtraction;
  erpDrop?: ErpDropSource;
}

export type AnyScenarioEntry = ScenarioRegistryEntry | CustomScenarioEntry;

const customRegistry = new Map<string, CustomScenarioEntry>();
export const MAX_CUSTOM_SCENARIOS = 64;

export function isCustomScenarioId(value: unknown): value is CustomScenarioId {
  return typeof value === "string" && CUSTOM_SCENARIO_ID_RE.test(value);
}

/** A built-in scenario id, or a custom one that has been registered in this process. */
export function isAnyScenarioId(value: unknown): value is WorkbenchScenarioId {
  return isScenarioId(value) || (isCustomScenarioId(value) && customRegistry.has(value));
}

export function isCustomScenarioEntry(entry: AnyScenarioEntry | undefined): entry is CustomScenarioEntry {
  return Boolean(entry && "baseScenarioId" in entry);
}

/** Registers (or replaces) a custom scenario; the oldest entries beyond MAX_CUSTOM_SCENARIOS are dropped. */
export function registerCustomScenario(entry: CustomScenarioEntry): CustomScenarioEntry {
  customRegistry.delete(entry.scenarioId);
  customRegistry.set(entry.scenarioId, entry);
  while (customRegistry.size > MAX_CUSTOM_SCENARIOS) {
    const oldest = customRegistry.keys().next().value;
    if (oldest === undefined) break;
    customRegistry.delete(oldest);
  }
  return entry;
}

export function unregisterCustomScenario(scenarioId: string): boolean {
  return customRegistry.delete(scenarioId);
}

export function clearCustomScenarios(originFilter?: "unscripted" | "erp-drop"): string[] {
  const removed: string[] = [];
  if (!originFilter) {
    for (const id of customRegistry.keys()) removed.push(id);
    customRegistry.clear();
    return removed;
  }
  for (const [id, entry] of customRegistry.entries()) {
    if (entry.origin === originFilter) {
      customRegistry.delete(id);
      removed.push(id);
    }
  }
  return removed;
}

export function getCustomScenario(scenarioId: string): CustomScenarioEntry | undefined {
  return customRegistry.get(scenarioId);
}

/** Newest first. */
export function listCustomScenarios(): CustomScenarioEntry[] {
  return [...customRegistry.values()].reverse();
}

export function getScenarioEntry(scenarioId: string): AnyScenarioEntry | undefined {
  return isScenarioId(scenarioId) ? SCENARIO_REGISTRY[scenarioId] : customRegistry.get(scenarioId);
}

/** The origin badge of any work item: built-in ticket / anomaly, ERP drop or pasted ticket. */
export function workItemOrigin(entry: AnyScenarioEntry): WorkItemOrigin {
  if (isCustomScenarioEntry(entry)) return entry.origin;
  return entry.kind === "ticket" ? "psa" : "anomaly";
}

/** The built-in scenario whose data, remediation template and invariants a workbench id resolves to. */
export function baseScenarioOf(scenarioId: string, fallback: ScenarioId = "INC-4092"): ScenarioId {
  if (isScenarioId(scenarioId)) return scenarioId;
  return customRegistry.get(scenarioId)?.baseScenarioId ?? fallback;
}

export function customScenarioId(shortHash: string): CustomScenarioId {
  return `CUSTOM-${shortHash.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)}`;
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
  selection: { label: "Spawned from selection", short: "Selection", color: "#06b6d4" },
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
  detail: z.string().max(320),
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
  scenarioId: z.string().describe("INC-4092, ANOM-LIC-101, ... or CUSTOM-<hash> for an unscripted ticket"),
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
  summary: z.string().max(700).describe("1-2 sentence technical root cause"),
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
  attachments: z.array(TicketAttachmentSchema).default([]),
  /** Where each MCP source answered from: live tenant reads or fixtures. */
  sources: z.record(z.string(), z.string()),
  /** Unscripted tickets: what the entity & intent extractor found and the base pattern it inherited. */
  extraction: TicketExtractionSchema.nullable().default(null),
  /** The origin badge: psa | anomaly | erp-drop | unscripted. */
  originKind: WorkItemOriginSchema.default("psa"),
  /** `#2026323` for an ERP drop; `#<scenarioId>` otherwise. */
  displayId: z.string().optional(),
  /** The PSA / ERP priority (P1...), when the ticket carries one. */
  priority: z.string().nullable().default(null),
});
export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;

/** One row of the unified work queue. */
export interface ScenarioListItem {
  scenarioId: WorkbenchScenarioId;
  kind: ScenarioKind;
  origin: WorkItemOrigin;
  /** `#2026323` for an ERP drop; `#<scenarioId>` otherwise. */
  displayId: string;
  tenantId: string;
  tenantName: string;
  title: string;
  resolved: boolean;
  /** When the item entered the queue: ticket openedAt, anomaly detectedAt, drop ingestedAt or paste time. */
  createdAt: string;
  /** Set for CUSTOM-<hash> / ERP-<id> tickets, with the built-in scenario they inherit. */
  custom?: {
    origin: "unscripted" | "erp-drop";
    baseScenarioId: ScenarioId;
    shortHash: string;
    createdAt: string;
    ticket: CustomTicketInput;
    extraction: TicketExtraction;
    components: CanvasComponentType[];
    erpDrop?: ErpDropSource;
  };
}
