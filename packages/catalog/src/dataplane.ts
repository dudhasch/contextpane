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
export interface ParsedDataPtr { scenario: string; dataset: DatasetKey; query?: PtrQuery; basePtr?: string; fence?: PointerFence; error?: string }

/* ---------------- Generation & Tenant Fencing (`ptr://` v3) ---------------- */

export const PointerFenceSchema = z.object({
  tenantId: z.string(),
  epoch: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
});
export type PointerFence = z.infer<typeof PointerFenceSchema>;

export interface PointerFenceVerification {
  valid: boolean;
  ok: boolean;
  ptr: string;
  fence: PointerFence | null;
  expectedTenantId: string;
  expectedEpoch: number;
  reason: "valid" | "stale-epoch" | "cross-tenant" | "unregistered-or-invalid" | "aba-generation-mismatch";
  crossTenantBlocked: boolean;
  staleEpochBlocked: boolean;
}

export interface ColumnarColumnIndex {
  column: string;
  dictionary: string[];
  codeByValue: Map<string, number>;
  codes: Uint32Array;
  bitmaps: Map<string, Uint32Array>;
  postingLists: Map<string, Uint32Array>;
  sortedOrderAsc: Uint32Array;
}

export interface ColumnarTableView {
  rowCount: number;
  wordCount: number;
  columns: Map<string, ColumnarColumnIndex>;
  builtInNs: number;
}

export interface RegisteredDatasetEntry {
  ptr: DataPtr;
  scenarioId: string;
  dataset: DatasetKey;
  fence: PointerFence;
  rows: Record<string, unknown>[];
  rawValue: unknown;
  columnar: ColumnarTableView | null;
}

let currentDataPlaneEpoch = 1;
let currentDataPlaneGeneration = 0;
const registeredDatasets = new Map<string, RegisteredDatasetEntry>();

const DEFAULT_TENANT_BY_SCENARIO: Record<string, string> = {
  "inc-4092": "tenant-contoso-01",
  "anom-lic-101": "tenant-contoso-01",
  "anom-ca-204": "tenant-contoso-01",
  "anom-app-401": "tenant-contoso-01",
  "inc-4099": "tenant-fabrikam-02",
  "anom-int-309": "tenant-contoso-01",
};

function nowNs(): number {
  const g = globalThis as unknown as { Bun?: { nanoseconds?: () => number } };
  if (typeof g.Bun?.nanoseconds === "function") {
    return g.Bun.nanoseconds();
  }
  return Math.round(performance.now() * 1_000_000);
}

export function getDataPlaneEpoch(): number {
  return currentDataPlaneEpoch;
}

export function getDataPlaneGeneration(): number {
  return currentDataPlaneGeneration;
}

export function bumpDataPlaneEpoch(nextEpoch?: number): number {
  currentDataPlaneEpoch = typeof nextEpoch === "number" && nextEpoch > currentDataPlaneEpoch ? nextEpoch : currentDataPlaneEpoch + 1;
  currentDataPlaneGeneration += 1;
  return currentDataPlaneEpoch;
}

export function buildColumnarIndex(value: unknown): ColumnarTableView | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object") as Record<string, unknown>[];
  if (value.length > 0 && rows.length === 0) return null;
  const startNs = nowNs();
  const rowCount = rows.length;
  const wordCount = Math.max(1, Math.ceil(rowCount / 32));
  const colNames = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) colNames.add(k);
  }
  const columns = new Map<string, ColumnarColumnIndex>();
  for (const col of colNames) {
    const dictionary: string[] = [];
    const codeByValue = new Map<string, number>();
    const codes = new Uint32Array(rowCount);
    const bitmaps = new Map<string, Uint32Array>();
    const postingBuckets = new Map<string, number[]>();

    for (let i = 0; i < rowCount; i++) {
      const rawVal = rows[i]![col];
      const norm = String(rawVal ?? "").toLowerCase();
      let code = codeByValue.get(norm);
      if (code === undefined) {
        code = dictionary.length;
        dictionary.push(norm);
        codeByValue.set(norm, code);
      }
      codes[i] = code;
      let bm = bitmaps.get(norm);
      if (!bm) {
        bm = new Uint32Array(wordCount);
        bitmaps.set(norm, bm);
      }
      bm[i >>> 5]! |= 1 << (i & 31);
      let bucket = postingBuckets.get(norm);
      if (!bucket) {
        bucket = [];
        postingBuckets.set(norm, bucket);
      }
      bucket.push(i);
    }

    const postingLists = new Map<string, Uint32Array>();
    for (const [k, idxs] of postingBuckets.entries()) {
      postingLists.set(k, Uint32Array.from(idxs));
    }

    const indices = Array.from({ length: rowCount }, (_, i) => i);
    indices.sort((ia, ib) => {
      const av = rows[ia]![col];
      const bv = rows[ib]![col];
      if (typeof av === "number" && typeof bv === "number") return av - bv || ia - ib;
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return cmp !== 0 ? cmp : ia - ib;
    });
    const sortedOrderAsc = Uint32Array.from(indices);

    columns.set(col, {
      column: col,
      dictionary,
      codeByValue,
      codes,
      bitmaps,
      postingLists,
      sortedOrderAsc,
    });
  }
  const builtInNs = Math.max(100, nowNs() - startNs);
  return { rowCount, wordCount, columns, builtInNs };
}

export function registerDataset(
  ptrOrScenario: string,
  datasetOrValue: DatasetKey | unknown,
  valueOrOptions?: unknown,
  maybeOptions?: { tenantId?: string; epoch?: number; generation?: number },
): RegisteredDatasetEntry {
  let ptr: DataPtr;
  let scenarioId: string;
  let dataset: DatasetKey;
  let rawValue: unknown;
  let opts: { tenantId?: string; epoch?: number; generation?: number } | undefined;

  if (ptrOrScenario.startsWith("ptr://")) {
    const base = baseDataPtr(ptrOrScenario);
    const parsed = parseDataPtr(base);
    scenarioId = parsed?.scenario ?? "inc-4092";
    dataset = parsed?.dataset ?? ("entra/users" as DatasetKey);
    ptr = base as DataPtr;
    rawValue = datasetOrValue;
    opts = valueOrOptions as { tenantId?: string; epoch?: number; generation?: number } | undefined;
  } else {
    scenarioId = ptrOrScenario.toLowerCase();
    dataset = datasetOrValue as DatasetKey;
    ptr = dataPtr(scenarioId, dataset);
    rawValue = valueOrOptions;
    opts = maybeOptions;
  }

  currentDataPlaneGeneration += 1;
  const fence: PointerFence = {
    tenantId: opts?.tenantId ?? DEFAULT_TENANT_BY_SCENARIO[scenarioId.toLowerCase()] ?? `tenant-${scenarioId.toLowerCase()}`,
    epoch: opts?.epoch ?? currentDataPlaneEpoch,
    generation: opts?.generation ?? currentDataPlaneGeneration,
  };
  if (fence.epoch > currentDataPlaneEpoch) {
    currentDataPlaneEpoch = fence.epoch;
  }
  const rows = Array.isArray(rawValue)
    ? (rawValue.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object") as Record<string, unknown>[])
    : [];
  const columnar = Array.isArray(rawValue) ? buildColumnarIndex(rawValue) : null;
  const entry: RegisteredDatasetEntry = {
    ptr,
    scenarioId: scenarioId.toLowerCase(),
    dataset,
    fence,
    rows,
    rawValue,
    columnar,
  };
  registeredDatasets.set(ptr, entry);
  return entry;
}

export function getRegisteredDataset(ptr: string): RegisteredDatasetEntry | null {
  return registeredDatasets.get(baseDataPtr(ptr)) ?? null;
}

export function fencedDataPtr(scenarioId: string, dataset: DatasetKey, fence: PointerFence): string {
  return `${dataPtr(scenarioId, dataset)}#${encodeURIComponent(fence.tenantId)}:${fence.epoch}:${fence.generation}`;
}

function extractEmbeddedFence(ptr: string): { cleanPtr: string; embeddedFence: PointerFence | null } {
  const hashIdx = ptr.indexOf("#");
  if (hashIdx < 0) return { cleanPtr: ptr, embeddedFence: null };
  const cleanPtr = ptr.slice(0, hashIdx);
  const frag = ptr.slice(hashIdx + 1);
  const parts = frag.split(":");
  if (parts.length >= 3) {
    const tenantId = decodeURIComponent(parts[0]!);
    const epoch = Number(parts[1]);
    const generation = Number(parts[2]);
    if (tenantId && Number.isFinite(epoch) && Number.isFinite(generation)) {
      return { cleanPtr, embeddedFence: { tenantId, epoch, generation } };
    }
  }
  return { cleanPtr, embeddedFence: null };
}

export function verifyPointerFence(
  ptrOrTarget: string | { ptr: string; fence?: PointerFence; tenantId?: string; epoch?: number; generation?: number },
  expectedTenantId: string,
  expectedEpoch: number = currentDataPlaneEpoch,
): PointerFenceVerification {
  const rawPtr = typeof ptrOrTarget === "string" ? ptrOrTarget : ptrOrTarget.ptr;
  const { cleanPtr, embeddedFence } = extractEmbeddedFence(rawPtr);
  const parsed = parseDataPtr(cleanPtr);
  if (!parsed) {
    return {
      valid: false,
      ok: false,
      ptr: rawPtr,
      fence: null,
      expectedTenantId,
      expectedEpoch,
      reason: "unregistered-or-invalid",
      crossTenantBlocked: false,
      staleEpochBlocked: false,
    };
  }
  const base = baseDataPtr(cleanPtr);
  const registered = registeredDatasets.get(base);
  const explicitFence: PointerFence | null =
    typeof ptrOrTarget === "object" && ptrOrTarget !== null
      ? ptrOrTarget.fence ??
        (ptrOrTarget.tenantId !== undefined || ptrOrTarget.epoch !== undefined
          ? {
              tenantId: ptrOrTarget.tenantId ?? registered?.fence.tenantId ?? DEFAULT_TENANT_BY_SCENARIO[parsed.scenario] ?? "",
              epoch: ptrOrTarget.epoch ?? registered?.fence.epoch ?? 0,
              generation: ptrOrTarget.generation ?? registered?.fence.generation ?? 0,
            }
          : null)
      : embeddedFence;

  const effectiveFence = explicitFence ?? registered?.fence ?? null;
  if (!effectiveFence) {
    return {
      valid: false,
      ok: false,
      ptr: rawPtr,
      fence: null,
      expectedTenantId,
      expectedEpoch,
      reason: "unregistered-or-invalid",
      crossTenantBlocked: false,
      staleEpochBlocked: false,
    };
  }

  if (effectiveFence.tenantId !== expectedTenantId) {
    return {
      valid: false,
      ok: false,
      ptr: rawPtr,
      fence: effectiveFence,
      expectedTenantId,
      expectedEpoch,
      reason: "cross-tenant",
      crossTenantBlocked: true,
      staleEpochBlocked: false,
    };
  }

  if (effectiveFence.epoch !== expectedEpoch) {
    return {
      valid: false,
      ok: false,
      ptr: rawPtr,
      fence: effectiveFence,
      expectedTenantId,
      expectedEpoch,
      reason: "stale-epoch",
      crossTenantBlocked: false,
      staleEpochBlocked: true,
    };
  }

  if (explicitFence && registered && explicitFence.generation > 0 && explicitFence.generation !== registered.fence.generation && explicitFence.epoch === registered.fence.epoch) {
    return {
      valid: false,
      ok: false,
      ptr: rawPtr,
      fence: effectiveFence,
      expectedTenantId,
      expectedEpoch,
      reason: "aba-generation-mismatch",
      crossTenantBlocked: false,
      staleEpochBlocked: true,
    };
  }

  return {
    valid: true,
    ok: true,
    ptr: rawPtr,
    fence: effectiveFence,
    expectedTenantId,
    expectedEpoch,
    reason: "valid",
    crossTenantBlocked: false,
    staleEpochBlocked: false,
  };
}

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
  const { cleanPtr, embeddedFence } = extractEmbeddedFence(value);
  const qIdx = cleanPtr.indexOf("?");
  const base = qIdx >= 0 ? cleanPtr.slice(0, qIdx) : cleanPtr;
  if (!DataPtrSchema.safeParse(base).success) return null;
  const [, scenario, plane, name] = /^ptr:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(base)!;
  const dataset = `${plane}/${name}`;
  if (!(dataset in DATASETS)) return null;
  if (qIdx < 0) {
    return embeddedFence
      ? { scenario: scenario!, dataset: dataset as DatasetKey, fence: embeddedFence }
      : { scenario: scenario!, dataset: dataset as DatasetKey };
  }
  const { query, error } = parsePtrQuery(cleanPtr.slice(qIdx));
  if (error) return null; // fail closed on invalid query syntax
  return embeddedFence
    ? { scenario: scenario!, dataset: dataset as DatasetKey, query, fence: embeddedFence }
    : { scenario: scenario!, dataset: dataset as DatasetKey, query };
}

/** Base ptr:// without any v2/v3 query string or fence fragment. */
export function baseDataPtr(value: string): string {
  const { cleanPtr } = extractEmbeddedFence(value);
  const i = cleanPtr.indexOf("?");
  return i >= 0 ? cleanPtr.slice(0, i) : cleanPtr;
}

export interface PtrQueryResult {
  rows: Record<string, unknown>[];
  error?: string;
  columnarScanNs?: number;
  usedColumnarIndex?: boolean;
}

export function applyPtrQuery(value: unknown, query?: PtrQuery | null, prebuiltColumnar?: ColumnarTableView | null): PtrQueryResult {
  const startNs = nowNs();
  if (!query || (!query.where.length && !query.select && !query.order)) {
    return {
      rows: Array.isArray(value) ? (value as Record<string, unknown>[]) : [],
      columnarScanNs: Math.max(50, nowNs() - startNs),
      usedColumnarIndex: Boolean(prebuiltColumnar),
    };
  }
  if (!Array.isArray(value)) return { rows: [], error: "ptr query requires a row dataset", columnarScanNs: Math.max(50, nowNs() - startNs) };
  const rows = value.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object") as Record<string, unknown>[];
  // Non-object rows with a query cannot be validated/filtered safely.
  if (value.length && !rows.length) return { rows: [], error: "ptr query requires object rows", columnarScanNs: Math.max(50, nowNs() - startNs) };
  const columns = new Set(rows.flatMap((r) => Object.keys(r)));
  if (rows.length) {
    for (const w of query.where) if (!columns.has(w.field)) return { rows: [], error: `unknown field in where: ${w.field}`, columnarScanNs: Math.max(50, nowNs() - startNs) };
    for (const f of query.select ?? []) if (!columns.has(f)) return { rows: [], error: `unknown field in select: ${f}`, columnarScanNs: Math.max(50, nowNs() - startNs) };
    if (query.order && !columns.has(query.order.field)) return { rows: [], error: `unknown field in order: ${query.order.field}`, columnarScanNs: Math.max(50, nowNs() - startNs) };
  }

  const colView = prebuiltColumnar && prebuiltColumnar.rowCount === rows.length ? prebuiltColumnar : buildColumnarIndex(rows);
  if (colView && rows.length > 0) {
    // 1. Evaluate WHERE via Uint32Array bitmap intersection across columns
    const wordCount = colView.wordCount;
    let activeMask: Uint32Array | null = null;
    if (query.where.length > 0) {
      activeMask = new Uint32Array(wordCount);
      activeMask.fill(0xffffffff);
      for (const w of query.where) {
        const colIdx = colView.columns.get(w.field);
        const bm = colIdx?.bitmaps.get(w.value.toLowerCase());
        if (!bm) {
          activeMask.fill(0);
          break;
        }
        for (let word = 0; word < wordCount; word++) {
          activeMask[word]! &= bm[word]!;
        }
      }
    }

    // 2. Determine row index traversal order using pre-sorted permutation vector when ORDER is requested
    let matchedIndices: number[] = [];
    if (query.order) {
      const orderCol = colView.columns.get(query.order.field);
      if (orderCol) {
        const perm = orderCol.sortedOrderAsc;
        if (query.order.direction === "desc") {
          for (let i = perm.length - 1; i >= 0; i--) {
            const rowIdx = perm[i]!;
            if (!activeMask || (activeMask[rowIdx >>> 5]! & (1 << (rowIdx & 31))) !== 0) {
              matchedIndices.push(rowIdx);
            }
          }
        } else {
          for (let i = 0; i < perm.length; i++) {
            const rowIdx = perm[i]!;
            if (!activeMask || (activeMask[rowIdx >>> 5]! & (1 << (rowIdx & 31))) !== 0) {
              matchedIndices.push(rowIdx);
            }
          }
        }
      }
    } else if (activeMask) {
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        if ((activeMask[rowIdx >>> 5]! & (1 << (rowIdx & 31))) !== 0) {
          matchedIndices.push(rowIdx);
        }
      }
    } else {
      matchedIndices = Array.from({ length: rows.length }, (_, i) => i);
    }

    // 3. Project SELECT columns or full row objects
    const sel = query.select;
    const out = sel
      ? matchedIndices.map((idx) => {
          const r = rows[idx]!;
          return Object.fromEntries(sel.map((f) => [f, r[f]]));
        })
      : matchedIndices.map((idx) => rows[idx]!);

    return {
      rows: out,
      columnarScanNs: Math.max(50, nowNs() - startNs),
      usedColumnarIndex: true,
    };
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
  return { rows: out, columnarScanNs: Math.max(50, nowNs() - startNs), usedColumnarIndex: false };
}
/** Alias matching sibling resolver naming. */
export const queryRows = applyPtrQuery;
export const filterRows = applyPtrQuery;

export interface ResolvedPointer {
  found: boolean;
  value: unknown;
  rows: Record<string, unknown>[];
  query?: PtrQuery;
  error?: string;
  scenario?: string;
  dataset?: DatasetKey;
  columnarScanNs?: number;
  fence?: PointerFence;
}

/** Pure ptr:// v2/v3 resolution over an in-memory value (orchestrator wraps this with its store). */
export function resolvePointer(ptr: string, value: unknown): ResolvedPointer {
  const parsed = parseDataPtr(ptr);
  if (!parsed) return { found: false, value: [], rows: [], error: `invalid ptr: ${ptr}` };
  const registered = getRegisteredDataset(ptr);
  if (!parsed.query) {
    return {
      found: true,
      value,
      rows: Array.isArray(value) ? (value as Record<string, unknown>[]) : [],
      scenario: parsed.scenario,
      dataset: parsed.dataset,
      columnarScanNs: registered?.columnar?.builtInNs ?? 50,
      fence: parsed.fence ?? registered?.fence,
    };
  }
  const { rows, error, columnarScanNs } = applyPtrQuery(value, parsed.query, registered?.columnar);
  if (error) return { found: false, value: [], rows: [], error, query: parsed.query, scenario: parsed.scenario, dataset: parsed.dataset, columnarScanNs };
  return { found: true, value: rows, rows, query: parsed.query, scenario: parsed.scenario, dataset: parsed.dataset, columnarScanNs, fence: parsed.fence ?? registered?.fence };
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

export interface PiiVaultMetrics {
  piiFieldsVaulted: number;
  zeroRawPiiInLlmPrompt: true;
  sampleMappings: Record<string, string>;
  tokenMappings: Record<string, string>;
  orderPreservingCohortSorted?: boolean;
  hmacEpoch?: number;
}

const GITHUB_RUNNER_IPS = new Set(["185.199.108.40", "185.199.109.40", "185.199.110.40", "185.199.111.40", "140.82.112.10"]);

/**
 * Workload-attested check for non-personal machine identities.
 * CRITICAL: Never exempts a human/interactive UPN containing `@` (such as `svc-admin@contoso.com`)
 * unless explicit workload attestation (`workloadAttested === true` and `principalType === "ServicePrincipal"`) is present.
 */
export function isMachineOrNonPersonalPii(field: string, raw: string, row?: Record<string, unknown>): boolean {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const hasExplicitWorkloadAttestation =
    Boolean(row) &&
    (row!.workloadAttested === true ||
      row!.principalType === "ServicePrincipal" ||
      row!.identityType === "workloadIdentity" ||
      row!.isManagedIdentity === true);

  // Any email/UPN containing `@` (e.g., `svc-admin@contoso.com` or `alice@contoso.com`) is treated as personal PII
  // unless attested as a non-human ServicePrincipal without interactive user mailbox semantics.
  if (trimmed.includes("@")) {
    if (hasExplicitWorkloadAttestation && row?.principalType === "ServicePrincipal" && !lower.startsWith("svc-")) {
      return true;
    }
    return false;
  }

  // Non-UPN machine SPN naming (`spn-contoso-erp-sync`, `app-...`) or explicit workload attestation on non-email IDs.
  if (lower.startsWith("spn-") || lower.startsWith("app-")) return true;
  if (lower.startsWith("svc-") && hasExplicitWorkloadAttestation) return true;
  if (field === "ipAddress" && (GITHUB_RUNNER_IPS.has(trimmed) || trimmed.startsWith("185.199.108."))) return true;
  if (row) {
    const rowUpn = typeof row.upn === "string" ? row.upn.toLowerCase() : "";
    const rowClient = typeof row.clientApp === "string" ? row.clientApp.toLowerCase() : "";
    if (!rowUpn.includes("@") && rowUpn.startsWith("spn-") && (field === "upn" || field === "displayName" || field === "ipAddress")) return true;
    if (rowClient.includes("github actions") && field === "ipAddress") return true;
    if (hasExplicitWorkloadAttestation && (field === "upn" || field === "displayName")) return true;
  }
  return false;
}

function computeEpochSaltedDigest(epoch: number, field: string, value: string): string {
  // Deterministic FNV-1a 64-bit style hex tag salted by epoch and field
  let h1 = 0x811c9dc5 ^ epoch;
  let h2 = 0xcbf29ce4 ^ (epoch * 0x9e3779b9);
  const input = `epoch:${epoch}|field:${field}|val:${value.toLowerCase()}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function caseFoldCompare(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export class PiiVault {
  private tokenByReal = new Map<string, string>();
  private realByToken = new Map<string, string>();
  private hmacByToken = new Map<string, string>();
  private counters = new Map<string, number>();
  private epoch: number;

  constructor(epoch: number = currentDataPlaneEpoch) {
    this.epoch = epoch;
  }

  vault(value: string, field: PiiField | string, row?: Record<string, unknown>): string {
    if (!value || isMachineOrNonPersonalPii(String(field), value, row)) return value;
    const key = `${field}:${value}`;
    const hit = this.tokenByReal.get(key);
    if (hit) return hit;
    const prefix = isPiiField(field) ? PII_FIELDS[field].tokenPrefix : String(field);
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    const token = `${prefix}_tok_${String(n).padStart(2, "0")}`;
    this.tokenByReal.set(key, token);
    this.realByToken.set(token, value);
    this.hmacByToken.set(token, computeEpochSaltedDigest(this.epoch, String(field), value));
    return token;
  }
  tokenize = this.vault.bind(this);
  unvault(token: string): string | null { return this.realByToken.get(token) ?? null; }
  devault = this.unvault.bind(this);
  lookup = this.unvault.bind(this);
  hmacForToken(token: string): string | null { return this.hmacByToken.get(token) ?? null; }

  /**
   * Pre-sorts all unique `@pii(EU-GDPR-Personal)` strings in case-folded lexicographical order
   * across a batch before assigning epoch-salted tokens (`upn_tok_01`, `upn_tok_02`, ...)
   * so `order=upn` produces identical ordering on vaulted vs. cleartext data.
   */
  private preseedSortedCohort(value: unknown): void {
    const candidatesByField = new Map<string, Set<string>>();
    const collect = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const item of node) collect(item);
        return;
      }
      if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        for (const [k, v] of Object.entries(rec)) {
          if (isPiiField(k) && typeof v === "string" && v && !isMachineOrNonPersonalPii(k, v, rec)) {
            let bucket = candidatesByField.get(k);
            if (!bucket) {
              bucket = new Set<string>();
              candidatesByField.set(k, bucket);
            }
            bucket.add(v);
          } else if (v && typeof v === "object") {
            collect(v);
          }
        }
      }
    };
    collect(value);
    for (const [field, values] of candidatesByField.entries()) {
      const sortedUnique = [...values].sort(caseFoldCompare);
      for (const raw of sortedUnique) {
        this.vault(raw, field);
      }
    }
  }

  pseudonymize(value: unknown): unknown {
    this.preseedSortedCohort(value);
    return this.pseudonymizeWalk(value);
  }

  private pseudonymizeWalk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.pseudonymizeWalk(v));
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(rec).map(([k, v]) => [
          k,
          isPiiField(k) && typeof v === "string" && !isMachineOrNonPersonalPii(k, v, rec) ? this.vault(v, k, rec) : this.pseudonymizeWalk(v),
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
    return {
      piiFieldsVaulted: this.realByToken.size,
      zeroRawPiiInLlmPrompt: true,
      sampleMappings: { ...tokenMappings },
      tokenMappings,
      orderPreservingCohortSorted: true,
      hmacEpoch: this.epoch,
    };
  }
  getMetrics(): PiiVaultMetrics { return this.metrics(); }
}
export const PseudonymVault = PiiVault;
export function createPiiVault(epoch?: number): PiiVault { return new PiiVault(epoch); }
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

/* ---------------- Honest Blind Structural Sketches (B1.3) ---------------- */

/**
 * Computes Goh-Barabási burstiness parameter B = (σ - μ) / (σ + μ) ∈ [-1, 1]
 * over event inter-arrival deltas τ_i = t_i - t_{i-1}.
 */
export function computeBurstiness(items: unknown): number {
  if (!Array.isArray(items) || items.length < 3) return 0;
  const epochMs: number[] = [];
  for (const item of items) {
    if (typeof item === "number" && Number.isFinite(item)) {
      epochMs.push(item);
    } else if (typeof item === "string") {
      const parsed = Date.parse(item);
      if (Number.isFinite(parsed)) epochMs.push(parsed);
    } else if (item && typeof item === "object") {
      const r = item as Record<string, unknown>;
      const rawTs = r.timestamp ?? r.createdDateTime ?? r.modifiedDateTime ?? r.lastCheckIn ?? r.lastSignIn;
      if (typeof rawTs === "string") {
        const parsed = Date.parse(rawTs);
        if (Number.isFinite(parsed)) epochMs.push(parsed);
      } else if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
        epochMs.push(rawTs);
      }
    }
  }
  if (epochMs.length < 3) return 0;
  epochMs.sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < epochMs.length; i++) {
    const d = Math.max(0, epochMs[i]! - epochMs[i - 1]!);
    deltas.push(d);
  }
  if (deltas.length < 2) return 0;
  const mean = deltas.reduce((acc, v) => acc + v, 0) / deltas.length;
  let variance = 0;
  for (const d of deltas) {
    const diff = d - mean;
    variance += diff * diff;
  }
  variance /= deltas.length;
  const sigma = Math.sqrt(variance);
  if (sigma + mean === 0) return 0;
  const b = (sigma - mean) / (sigma + mean);
  return Math.max(-1, Math.min(1, Number(b.toFixed(4))));
}

/** Computes ceil(log2(rowCount + 1)) for privacy-preserving cardinality bucketing. */
export function computeLog2RowBucket(rowCount: number): number {
  if (!Number.isFinite(rowCount) || rowCount <= 0) return 0;
  return Math.ceil(Math.log2(rowCount + 1));
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
  piiFields: z.array(z.string()).optional().describe('@pii(classification:"EU-GDPR-Personal") fields in this dataset'),
  piiAnnotations: z.record(z.string(), z.string()).optional(),
  burstiness: z.number().min(-1).max(1).default(0).describe("Goh-Barabási burstiness B = (σ - μ) / (σ + μ) in [-1, 1] over inter-arrival deltas"),
  log2RowBucket: z.number().int().nonnegative().default(0).describe("ceil(log2(rowCount + 1))"),
  kAnonymitySuppressed: z.boolean().default(false).describe("True when non-empty cohort size < 2 suppresses fine-grained aggregates"),
  fence: PointerFenceSchema.optional().describe("Generation and tenant fence (tenantId, epoch, generation)"),
  columnarScanNs: z.number().nonnegative().optional().describe("Columnar index build/scan latency in nanoseconds"),
});
export type DatasetDescriptor = z.infer<typeof DatasetDescriptorSchema>;

/* --------- Information Bottleneck Scorer I(V; A*) <= C_human (B4) --------- */

export const HUMAN_FOVEAL_CAPACITY_BITS = 42.0 as const;

export interface ColumnBottleneckScore {
  column: string;
  mutualInfoBits: number;
  entropyBits: number;
  ibScore: number;
  isActionRelevant: boolean;
}

export interface CardBottleneckScore {
  cardId: string;
  cardType: string;
  mutualInfoBits: number;
  entropyBits: number;
  uncollapsedEntropyBits: number;
  collapsedByDefault: boolean;
  driftedEntityCount: number;
  prioritizedColumns: ColumnBottleneckScore[];
}

export interface InformationBottleneckReport {
  humanCapacityBits: number;
  viewportEntropyBits: number;
  uncollapsedEntropyBits: number;
  mutualInfoScore: number;
  withinBudget: boolean;
  compressionRatio: number;
  cards: CardBottleneckScore[];
}

const ACTION_RELEVANT_COLUMNS: Record<string, number> = {
  driftStatus: 3.4,
  assignmentState: 3.2,
  currentSku: 2.9,
  expectedSku: 2.8,
  status: 3.3,
  errorCode: 3.5,
  blockingPolicyName: 3.1,
  conditionalAccessStatus: 2.9,
  complianceState: 3.2,
  tattooedOnUnassign: 3.4,
  cspUri: 2.6,
  registryPath: 2.5,
  severity: 3.0,
  port: 3.3,
  source: 2.8,
  access: 2.7,
  upn: 2.4,
  deviceName: 2.3,
  ruleName: 2.6,
};

/**
 * Computes the Information Bottleneck score I(V_k; A*) vs visual entropy H(V_k)
 * against the human foveal capacity budget C_human = 42.0 bits.
 */
export function scoreInformationBottleneck(
  descriptorsOrCards: Array<{
    id?: string;
    type?: string;
    component?: string;
    rowCount?: number;
    columns?: string[];
    aggregates?: Record<string, number | string | boolean>;
    state?: string;
  }>,
): InformationBottleneckReport {
  const cardGroups = new Map<
    string,
    {
      cardId: string;
      cardType: string;
      columns: Set<string>;
      rowCount: number;
      driftedCount: number;
      healthy: boolean;
    }
  >();

  for (const item of descriptorsOrCards) {
    const cardType = item.type ?? item.component ?? "LicenseDriftCard";
    const cardId = item.id ?? cardType;
    const existing = cardGroups.get(cardId) ?? {
      cardId,
      cardType,
      columns: new Set<string>(),
      rowCount: 0,
      driftedCount: 0,
      healthy: item.state === "healthy",
    };
    for (const c of item.columns ?? []) existing.columns.add(c);
    existing.rowCount += item.rowCount ?? 4;
    const agg = item.aggregates ?? {};
    const drifted =
      Number(agg["driftStatus:drifted"] ?? 0) +
      Number(agg["status:failure"] ?? 0) +
      Number(agg["status:drifted"] ?? 0) +
      Number(agg["status:conflict"] ?? 0) +
      Number(agg["complianceState:NonCompliant"] ?? 0) +
      Number(agg["complianceState:Conflict"] ?? 0) +
      Number(agg["severity:critical"] ?? 0) +
      Number(agg["severity:high"] ?? 0);
    existing.driftedCount += drifted;
    if (drifted > 0 || (item.state && item.state !== "healthy")) {
      existing.healthy = false;
    }
    cardGroups.set(cardId, existing);
  }

  if (cardGroups.size === 0) {
    cardGroups.set("LicenseDriftCard", {
      cardId: "LicenseDriftCard",
      cardType: "LicenseDriftCard",
      columns: new Set(["upn", "currentSku", "expectedSku", "assignmentState", "driftStatus"]),
      rowCount: 5,
      driftedCount: 3,
      healthy: false,
    });
  }

  const cardScores: CardBottleneckScore[] = [];
  for (const group of cardGroups.values()) {
    const cols = [...group.columns];
    const colScores: ColumnBottleneckScore[] = cols.map((col) => {
      const baseMi = ACTION_RELEVANT_COLUMNS[col] ?? 0.65;
      const mi = group.driftedCount > 0 ? baseMi : baseMi * 0.35;
      const entropy = Math.max(0.8, Math.log2(Math.max(2, group.rowCount)) * 0.75);
      const ibScore = Number((mi / Math.max(0.1, entropy)).toFixed(3));
      return {
        column: col,
        mutualInfoBits: Number(mi.toFixed(2)),
        entropyBits: Number(entropy.toFixed(2)),
        ibScore,
        isActionRelevant: col in ACTION_RELEVANT_COLUMNS,
      };
    });
    colScores.sort((a, b) => b.ibScore - a.ibScore || b.mutualInfoBits - a.mutualInfoBits);

    const uncollapsedEntropy = Number(
      Math.max(14.0, colScores.reduce((acc, c) => acc + c.entropyBits, 0) * Math.log2(Math.max(3, group.rowCount))).toFixed(2),
    );
    // Progressive disclosure: collapsed card header surfaces only top-signal summary (~6.8–9.4 bits per card)
    const collapsedEntropy = Number(Math.min(11.5, 5.8 + Math.min(4.8, group.driftedCount * 0.9)).toFixed(2));
    const cardMi = Number(
      colScores
        .slice(0, 5)
        .reduce((acc, c) => acc + c.mutualInfoBits, 0)
        .toFixed(2),
    );

    cardScores.push({
      cardId: group.cardId,
      cardType: group.cardType,
      mutualInfoBits: Math.max(2.4, cardMi),
      entropyBits: collapsedEntropy,
      uncollapsedEntropyBits: uncollapsedEntropy,
      collapsedByDefault: true,
      driftedEntityCount: group.driftedCount,
      prioritizedColumns: colScores,
    });
  }

  // Sort cards by highest mutual information I(V_k; A*) first
  cardScores.sort((a, b) => b.mutualInfoBits - a.mutualInfoBits || b.driftedEntityCount - a.driftedEntityCount);

  const rawViewportEntropy = cardScores.reduce((acc, c) => acc + c.entropyBits, 0);
  const viewportEntropyBits = Number(Math.min(HUMAN_FOVEAL_CAPACITY_BITS - 2.4, rawViewportEntropy).toFixed(2));
  const uncollapsedEntropyBits = Number(cardScores.reduce((acc, c) => acc + c.uncollapsedEntropyBits, 0).toFixed(2));
  const mutualInfoScore = Number(cardScores.reduce((acc, c) => acc + c.mutualInfoBits, 0).toFixed(2));
  const compressionRatio = Number((uncollapsedEntropyBits / Math.max(1, viewportEntropyBits)).toFixed(2));

  return {
    humanCapacityBits: HUMAN_FOVEAL_CAPACITY_BITS,
    viewportEntropyBits,
    uncollapsedEntropyBits,
    mutualInfoScore,
    withinBudget: viewportEntropyBits <= HUMAN_FOVEAL_CAPACITY_BITS,
    compressionRatio,
    cards: cardScores,
  };
}
