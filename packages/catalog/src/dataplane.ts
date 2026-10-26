import { z } from "zod";
import type { CanvasComponentType } from "./schemas/layout.ts";
import { DataPtrSchema, type DataPtr } from "./schemas/primitives.ts";

/**
 * The ptr:// data-plane bypass protocol. Every row set a card shows (license
 * assignments, sign-ins, Intune devices, the IaC diff, ...) is a dataset the
 * orchestrator holds under a deterministic pointer:
 *
 *   ptr://<scenario>/<plane>/<dataset>      e.g. ptr://inc-4092/entra/users
 *
 * The model sees only a schema-and-aggregate descriptor per dataset and answers with
 * `{ "dataPtr": "<uri>" }` for the prop; the data plane binds the rows before the
 * layout is streamed, so no customer row is ever serialised by the model.
 */

export const DATASETS = {
  "entra/users": { component: "LicenseDriftCard", prop: "users" },
  "entra/sku-pools": { component: "LicenseDriftCard", prop: "skuPools" },
  "entra/group-errors": { component: "LicenseDriftCard", prop: "groupErrors" },
  "entra/signins": { component: "EntraSignInTimeline", prop: "events" },
  "entra/ca-policies": { component: "EntraSignInTimeline", prop: "policies" },
  "entra/ca-baseline-diff": { component: "EntraSignInTimeline", prop: "baselineDiff" },
  "intune/devices": { component: "IntuneDriftCard", prop: "devices" },
  "intune/settings": { component: "IntuneDriftCard", prop: "settings" },
  "intune/policies": { component: "IntuneDriftCard", prop: "policies" },
  "intune/baseline-diff": { component: "IntuneDriftCard", prop: "baselineDiff" },
  "iac/drift-diff": { component: "IaCDriftBanner", prop: "hclDiff" },
  "iac/rogue-rules": { component: "IaCDriftBanner", prop: "rogueSecurityRules" },
  "iac/tag-drift": { component: "IaCDriftBanner", prop: "tagDrift" },
  "iac/host-pool": { component: "IaCDriftBanner", prop: "hostPool" },
  "iac/azure-policies": { component: "IaCDriftBanner", prop: "azurePolicies" },
} as const satisfies Record<string, { component: CanvasComponentType; prop: string }>;

export type DatasetKey = keyof typeof DATASETS;
export const DATASET_KEYS = Object.keys(DATASETS) as DatasetKey[];

/** Props the orchestrator owns outright: never taken from a model, always from the hydrator. */
export const ORCHESTRATOR_PROPS = ["sourceRef"] as const;

export function dataPtr(scenarioId: string, dataset: DatasetKey): DataPtr {
  return `ptr://${scenarioId.toLowerCase()}/${dataset}`;
}

export function parseDataPtr(value: unknown): { scenario: string; dataset: DatasetKey } | null {
  if (!DataPtrSchema.safeParse(value).success) return null;
  const [, scenario, plane, name] = /^ptr:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(value as string)!;
  const dataset = `${plane}/${name}`;
  return dataset in DATASETS ? { scenario: scenario!, dataset: dataset as DatasetKey } : null;
}

/** The datasets a card is bound from, in registry order. */
export function datasetsFor(component: CanvasComponentType): DatasetKey[] {
  return DATASET_KEYS.filter((k) => DATASETS[k].component === component);
}

/** A model-facing summary of one dataset: shape and aggregates, never the rows. */
export const DatasetDescriptorSchema = z.object({
  ptr: DataPtrSchema,
  component: z.string(),
  prop: z.string(),
  kind: z.enum(["rows", "text", "object", "empty"]),
  rowCount: z.number().int().nonnegative().describe("Rows, diff lines or nested items behind the pointer"),
  columns: z.array(z.string()).default([]),
  aggregates: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  bytes: z.number().int().nonnegative().describe("Size of the rows as JSON; what the prompt did not carry"),
});
export type DatasetDescriptor = z.infer<typeof DatasetDescriptorSchema>;
