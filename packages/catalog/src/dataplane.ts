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

/* --------------------------- ptr:// v2 relational --------------------------- */

export interface PtrWhereClause { field: string; operator: "eq"; value: string }
export interface PtrQuery { where: PtrWhereClause[]; select?: string[]; order?: { field: string; direction: "asc" | "desc" } }
export interface ParsedDataPtr { scenario: string; dataset: DatasetKey; query?: PtrQuery; basePtr?: string; error?: string }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parsePtrQuery(search: string): { query: PtrQuery; error?: string } {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const query: PtrQuery = { where: [] };
  if (!raw) return { query, error: "empty ptr query" };
  const params = new URLSearchParams(raw);
  for (const key of params.keys()) {
    if (!["where", "select", "order"].includes(key)) return { query, error: `unsupported ptr query parameter: ${key}` };
  }
  const whereRaw = params.get("where");
  if (whereRaw !== null) {
    if (!whereRaw.trim()) return { query, error: "empty where clause" };
    for (const term of whereRaw.split(",")) {
      const t = term.trim();
      const idx = t.indexOf(":");
      // Only field:value (eq) is supported; =, !=, >, <, >=, <=, ~= etc fail closed.
      if (idx <= 0 || /[=!<>~]/.test(t.slice(0, idx)) || !IDENT.test(t.slice(0, idx).trim())) return { query, error: `invalid where clause: ${t}` };
      const field = t.slice(0, idx).trim();
      const value = t.slice(idx + 1).trim();
      if (!value) return { query, error: `invalid where clause: ${t}` };
      query.where.push({ field, operator: "eq", value });
    }
  }
  const selectRaw = params.get("select");
  if (selectRaw !== null) {
    const fields = selectRaw.split(",").map((s) => s.trim());
    if (!fields.length || fields.some((f) => !IDENT.test(f))) return { query, error: `invalid select: ${selectRaw}` };
    query.select = [...new Set(fields)];
  }
  const orderRaw = params.get("order");
  if (orderRaw !== null) {
    const t = orderRaw.trim();
    const desc = t.startsWith("-");
    const field = (desc ? t.slice(1) : t).trim();
    if (!field || !IDENT.test(field) || t.includes(",")) return { query, error: `invalid order: ${orderRaw}` };
    query.order = { field, direction: desc ? "desc" : "asc" };
  }
  if (!query.where.length && !query.select && !query.order) return { query, error: "empty ptr query" };
  return { query };
}

export function parseDataPtr(value: unknown): ParsedDataPtr | null {
  if (typeof value !== "string") return null;
  const qIdx = value.indexOf("?");
  const base = qIdx >= 0 ? value.slice(0, qIdx) : value;
  if (!DataPtrSchema.safeParse(base).success) return null;
  const [, scenario, plane, name] = /^ptr:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(base)!;
  const dataset = `${plane}/${name}`;
  if (!(dataset in DATASETS)) return null;
  if (qIdx < 0) return { scenario: scenario!, dataset: dataset as DatasetKey };
  const { query, error } = parsePtrQuery(value.slice(qIdx));
  if (error) return null; // fail closed on invalid query syntax
  return { scenario: scenario!, dataset: dataset as DatasetKey, query };
}

/** Base ptr:// without any v2 query string. */
export function baseDataPtr(value: string): string {
  const i = value.indexOf("?");
  return i >= 0 ? value.slice(0, i) : value;
}

export interface PtrQueryResult { rows: Record<string, unknown>[]; error?: string }

export function applyPtrQuery(value: unknown, query?: PtrQuery | null): PtrQueryResult {
  if (!query || (!query.where.length && !query.select && !query.order)) {
    return { rows: Array.isArray(value) ? (value as Record<string, unknown>[]) : [] };
  }
  if (!Array.isArray(value)) return { rows: [], error: "ptr query requires a row dataset" };
  const rows = value.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object") as Record<string, unknown>[];
  // Non-object rows with a query cannot be validated/filtered safely.
  if (value.length && !rows.length) return { rows: [], error: "ptr query requires object rows" };
  const columns = new Set(rows.flatMap((r) => Object.keys(r)));
  if (rows.length) {
    for (const w of query.where) if (!columns.has(w.field)) return { rows: [], error: `unknown field in where: ${w.field}` };
    for (const f of query.select ?? []) if (!columns.has(f)) return { rows: [], error: `unknown field in select: ${f}` };
    if (query.order && !columns.has(query.order.field)) return { rows: [], error: `unknown field in order: ${query.order.field}` };
  }
  let out = rows.filter((r) => query.where.every((w) => String(r[w.field] ?? "").toLowerCase() === w.value.toLowerCase()));
  if (query.order) {
    const { field, direction } = query.order;
    const sign = direction === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const av = a[field]; const bv = b[field];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
      return cmp * sign;
    });
  }
  if (query.select) {
    const sel = query.select;
    out = out.map((r) => Object.fromEntries(sel.map((f) => [f, r[f]])));
  }
  return { rows: out };
}
/** Alias matching sibling resolver naming. */
export const queryRows = applyPtrQuery;
export const filterRows = applyPtrQuery;

export interface ResolvedPointer { found: boolean; value: unknown; rows: Record<string, unknown>[]; query?: PtrQuery; error?: string; scenario?: string; dataset?: DatasetKey }

/** Pure ptr:// v2 resolution over an in-memory value (orchestrator wraps this with its store). */
export function resolvePointer(ptr: string, value: unknown): ResolvedPointer {
  const parsed = parseDataPtr(ptr);
  if (!parsed) return { found: false, value: [], rows: [], error: `invalid ptr: ${ptr}` };
  if (!parsed.query) return { found: true, value, rows: Array.isArray(value) ? (value as Record<string, unknown>[]) : [], scenario: parsed.scenario, dataset: parsed.dataset };
  const { rows, error } = applyPtrQuery(value, parsed.query);
  if (error) return { found: false, value: [], rows: [], error, query: parsed.query, scenario: parsed.scenario, dataset: parsed.dataset };
  return { found: true, value: rows, rows, query: parsed.query, scenario: parsed.scenario, dataset: parsed.dataset };
}

/** The datasets a card is bound from, in registry order. */
export function datasetsFor(component: CanvasComponentType): DatasetKey[] {
  return DATASET_KEYS.filter((k) => DATASETS[k].component === component);
}

/* ------------------------- PII Pseudonym Vault ------------------------- */

export const PII_CLASSIFICATION = "EU-GDPR-Personal" as const;
/** @pii(classification:"EU-GDPR-Personal") registry: field -> token prefix + schema annotation. */
export const PII_FIELDS = {
  upn: { classification: PII_CLASSIFICATION, annotation: '@pii(classification:"EU-GDPR-Personal")', tokenPrefix: "upn" },
  displayName: { classification: PII_CLASSIFICATION, annotation: '@pii(classification:"EU-GDPR-Personal")', tokenPrefix: "displayName" },
  ipAddress: { classification: PII_CLASSIFICATION, annotation: '@pii(classification:"EU-GDPR-Personal")', tokenPrefix: "ip" },
  userId: { classification: PII_CLASSIFICATION, annotation: '@pii(classification:"EU-GDPR-Personal")', tokenPrefix: "userId" },
  deviceName: { classification: PII_CLASSIFICATION, annotation: '@pii(classification:"EU-GDPR-Personal")', tokenPrefix: "device" },
} as const;
export type PiiField = keyof typeof PII_FIELDS;
export const PII_FIELD_NAMES = Object.keys(PII_FIELDS) as PiiField[];
export const PII_SCHEMA_ANNOTATIONS: Record<PiiField, string> = Object.fromEntries(PII_FIELD_NAMES.map((f) => [f, PII_FIELDS[f].annotation])) as Record<PiiField, string>;
export function isPiiField(name: string): name is PiiField { return name in PII_FIELDS; }
/** Dataset -> PII fields it may carry (schema annotation view). */
export const DATASET_PII_FIELDS: Partial<Record<DatasetKey, PiiField[]>> = {
  "entra/users": ["upn", "displayName"],
  "entra/signins": ["upn", "displayName", "ipAddress", "deviceName"],
  "intune/devices": ["upn", "deviceName"],
};

export interface PiiVaultMetrics { piiFieldsVaulted: number; zeroRawPiiInLlmPrompt: true; sampleMappings: Record<string, string>; tokenMappings: Record<string, string> }

const GITHUB_RUNNER_IPS = new Set(["185.199.108.40", "185.199.109.40", "185.199.110.40", "185.199.111.40", "140.82.112.10"]);

export function isMachineOrNonPersonalPii(field: string, raw: string, row?: Record<string, unknown>): boolean {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("spn-") || lower.startsWith("app-") || lower.startsWith("svc-")) return true;
  if (field === "ipAddress" && (GITHUB_RUNNER_IPS.has(trimmed) || trimmed.startsWith("185.199.108."))) return true;
  if (row) {
    const rowUpn = typeof row.upn === "string" ? row.upn.toLowerCase() : "";
    const rowClient = typeof row.clientApp === "string" ? row.clientApp.toLowerCase() : "";
    if (rowUpn.startsWith("spn-") && (field === "upn" || field === "displayName" || field === "ipAddress")) return true;
    if (rowClient.includes("github actions") && field === "ipAddress") return true;
  }
  return false;
}

export class PiiVault {
  private tokenByReal = new Map<string, string>();
  private realByToken = new Map<string, string>();
  private counters = new Map<string, number>();
  vault(value: string, field: PiiField | string): string {
    if (!value || isMachineOrNonPersonalPii(String(field), value)) return value;
    const key = `${field}:${value}`;
    const hit = this.tokenByReal.get(key);
    if (hit) return hit;
    const prefix = isPiiField(field) ? PII_FIELDS[field].tokenPrefix : String(field);
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    const token = `${prefix}_tok_${String(n).padStart(2, "0")}`;
    this.tokenByReal.set(key, token);
    this.realByToken.set(token, value);
    return token;
  }
  tokenize = this.vault.bind(this);
  unvault(token: string): string | null { return this.realByToken.get(token) ?? null; }
  devault = this.unvault.bind(this);
  lookup = this.unvault.bind(this);
  pseudonymize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.pseudonymize(v));
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(rec).map(([k, v]) => [
          k,
          isPiiField(k) && typeof v === "string" && !isMachineOrNonPersonalPii(k, v, rec) ? this.vault(v, k) : this.pseudonymize(v),
        ]),
      );
    }
    return value;
  }
  pseudonymizeForLlm(value: unknown): unknown { return this.pseudonymize(value); }
  depseudonymize(value: unknown): unknown {
    if (typeof value === "string") return this.realByToken.get(value) ?? value.replace(/\b(?:upn|displayName|ip|userId|device)_tok_\d+\b/g, (t) => this.realByToken.get(t) ?? t);
    if (Array.isArray(value)) return value.map((v) => this.depseudonymize(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.depseudonymize(v)]));
    return value;
  }
  unvaultValue(value: unknown): unknown { return this.depseudonymize(value); }
  metrics(): PiiVaultMetrics {
    const tokenMappings = Object.fromEntries(this.realByToken);
    return { piiFieldsVaulted: this.realByToken.size, zeroRawPiiInLlmPrompt: true, sampleMappings: { ...tokenMappings }, tokenMappings };
  }
  getMetrics(): PiiVaultMetrics { return this.metrics(); }
}
export const PseudonymVault = PiiVault;
export function createPiiVault(): PiiVault { return new PiiVault(); }
export const createPseudonymVault = createPiiVault;
/** Per-session default vault (deterministic within the process/session). */
export const sessionPiiVault = new PiiVault();
export const defaultPiiVault = sessionPiiVault;

export function vaultPii(value: unknown, vault: PiiVault = sessionPiiVault): unknown { return vault.pseudonymize(value); }
export function unvaultPii(value: unknown, vault: PiiVault = sessionPiiVault): unknown { return vault.depseudonymize(value); }
export const unvaultValue = unvaultPii;
export function pseudonymizeForLlm(value: unknown, vault: PiiVault = sessionPiiVault): unknown { return vault.pseudonymize(value); }
export const pseudonymiseForLlm = pseudonymizeForLlm;
export function depseudonymizeForLlm(value: unknown, vault: PiiVault = sessionPiiVault): unknown { return vault.depseudonymize(value); }
export function getPiiVaultMetrics(vault: PiiVault = sessionPiiVault): PiiVaultMetrics { return vault.metrics(); }

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
  piiFields: z.array(z.string()).optional().describe('@pii(classification:"EU-GDPR-Personal") fields in this dataset'),
  piiAnnotations: z.record(z.string(), z.string()).optional(),
});
export type DatasetDescriptor = z.infer<typeof DatasetDescriptorSchema>;
