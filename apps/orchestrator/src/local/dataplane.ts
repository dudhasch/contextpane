import {
  DATASETS,
  PII_FIELDS,
  applyPtrQuery,
  baseDataPtr,
  createPiiVault,
  dataPtr,
  datasetsFor,
  isPiiField,
  parseDataPtr,
  parseSelectionPtr,
  pseudonymizeForLlm as catalogPseudonymizeForLlm,
  resolvePointer,
  sessionPiiVault,
  type CanvasComponentType,
  type DataPtr,
  type DatasetDescriptor,
  type DatasetKey,
  type PiiVault,
  type PiiVaultMetrics,
  type ScenarioId,
} from "@contextpane/catalog";

export { PII_FIELDS, createPiiVault, createPseudonymVault, getPiiVaultMetrics, isPiiField, PII_FIELD_NAMES, sessionPiiVault } from "@contextpane/catalog";
export type { PiiVault, PiiVaultMetrics } from "@contextpane/catalog";
import type { CorrelationContext } from "../mcp/context.ts";
import { buildComponent, scenarioComponents } from "./hydrate.ts";

/**
 * The orchestrator's data plane for the ptr:// bypass protocol. Every row set a
 * scenario's cards show is published once per gathered context under
 * ptr://<scenario>/<plane>/<dataset>; the models get the descriptors, and the
 * layout's pointers are bound back to these rows before the layout is streamed.
 */

export interface DataPlaneSnapshot {
  /** Workbench id the pointers are published under: ptr://<scenarioId>/... */
  scenarioId: string;
  gatheredAt: string;
  descriptors: DatasetDescriptor[];
  rows: Map<DataPtr, unknown>;
  /** Total JSON size of the rows: what a prompt carrying them would have spent. */
  bytes: number;
  piiVault: PiiVault;
  piiMetrics: PiiVaultMetrics;
  vaultMetrics: PiiVaultMetrics;
}

const byContext = new WeakMap<CorrelationContext, DataPlaneSnapshot>();
/** Keyed by workbench id (INC-4092, ANOM-CA-204, CUSTOM-<hash>). */
const latest = new Map<string, DataPlaneSnapshot>();

/** Publishes (once per gathered context) every dataset the scenario's cards are bound from. */
export function publishDataPlane(ctx: CorrelationContext): DataPlaneSnapshot {
  const hit = byContext.get(ctx);
  if (hit) return hit;
  const rows = new Map<DataPtr, unknown>();
  const descriptors: DatasetDescriptor[] = [];
  for (const type of scenarioComponents(ctx)) {
    const component = buildComponent(type, ctx);
    if (!component) continue;
    const props = component.props as Record<string, unknown>;
    for (const key of datasetsFor(type as CanvasComponentType)) {
      const ptr = dataPtr(ctx.ticketId, key);
      const value = props[DATASETS[key].prop];
      rows.set(ptr, value);
      descriptors.push(describeDataset(ptr, key, value));
    }
  }
  const piiVault = createPiiVault();
  for (const value of rows.values()) piiVault.pseudonymize(value);
  const piiMetrics = piiVault.metrics();
  const snapshot: DataPlaneSnapshot = {
    scenarioId: ctx.ticketId,
    gatheredAt: ctx.gatheredAt,
    descriptors,
    rows,
    bytes: descriptors.reduce((n, d) => n + d.bytes, 0),
    piiVault,
    piiMetrics,
    vaultMetrics: piiMetrics,
  };
  byContext.set(ctx, snapshot);
  latest.set(ctx.ticketId, snapshot);
  return snapshot;
}

/** The latest published snapshot of a scenario, if it has been gathered since start. */
export function dataPlaneSnapshot(scenarioId: string): DataPlaneSnapshot | null {
  return latest.get(scenarioId) ?? null;
}

/* ------------------------- selection slices (explore) ------------------------- */

export interface SelectionPublication {
  ptr: string;
  scenarioId: string;
  selectedText: string;
  rows: Record<string, unknown>[];
  descriptor: DatasetDescriptor & { selectedText: string; sourceQuery: string };
  publishedAt: string;
  piiVault: PiiVault;
}

const selections = new Map<string, SelectionPublication>();

/**
 * Holds the rows of one explored selection under ptr://<scenario>/selection/<hash>.
 * The model only ever sees the descriptor (shape, aggregates, the pseudonymised sample);
 * the client gets the rows bound from here.
 */
export function publishSelection(input: { ptr: string; scenarioId: string; selectedText: string; sourceQuery: string; rows: Record<string, unknown>[] }): SelectionPublication {
  const piiVault = createPiiVault();
  piiVault.pseudonymize(input.rows);
  const base = describeSelectionRows(input.ptr, input.rows);
  const publication: SelectionPublication = {
    ptr: input.ptr,
    scenarioId: input.scenarioId,
    selectedText: input.selectedText,
    rows: input.rows,
    descriptor: { ...base, selectedText: input.selectedText, sourceQuery: input.sourceQuery },
    publishedAt: new Date().toISOString(),
    piiVault,
  };
  selections.set(input.ptr, publication);
  if (selections.size > 64) selections.delete(selections.keys().next().value!);
  return publication;
}

export function resolveSelectionPtr(ptr: string): SelectionPublication | null {
  return selections.get(ptr) ?? null;
}

function describeSelectionRows(ptr: string, rows: Record<string, unknown>[]): DatasetDescriptor {
  const cols = columnsOf(rows);
  const piiFields = cols.filter((c) => isPiiField(c));
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  return {
    ptr: ptr as DataPtr,
    component: "ContextualMiniDashboard",
    prop: "rows",
    kind: rows.length ? "rows" : "empty",
    rowCount: rows.length,
    columns: cols,
    aggregates: enumCounts(rows),
    bytes,
    ...(piiFields.length ? { piiFields, piiAnnotations: Object.fromEntries(piiFields.map((f) => [f, PII_FIELDS[f as keyof typeof PII_FIELDS].annotation])) } : {}),
  };
}

export interface ResolvedDataPtr { found: boolean; value?: unknown; rows?: unknown; descriptor?: DatasetDescriptor; error?: string; query?: unknown; piiMetrics: PiiVaultMetrics; vaultMetrics: PiiVaultMetrics; pii: PiiVaultMetrics; pseudonymizedValue?: unknown; llmSafeValue?: unknown }

/** LLM-prompt-facing serialization: PII fields become deterministic vault tokens, never raw. */
export function pseudonymizeForLlm(value: unknown, vault?: PiiVault): unknown {
  return catalogPseudonymizeForLlm(value, vault ?? createPiiVaultForValue(value));
}
function createPiiVaultForValue(_value: unknown): PiiVault {
  // Prefer a live snapshot vault so tokens round-trip with resolveDataPtr output.
  const snap = [...latest.values()].at(-1);
  return snap?.piiVault ?? sessionPiiVault;
}
export function unvaultForLlm(value: unknown, vault?: PiiVault): unknown {
  const v = vault ?? [...latest.values()].at(-1)?.piiVault ?? sessionPiiVault;
  return v.depseudonymize(value);
}
export const depseudonymizeForLlm = unvaultForLlm;
export function vaultPii(value: unknown, vault?: PiiVault): unknown { return pseudonymizeForLlm(value, vault); }
export function unvaultPii(value: unknown, vault?: PiiVault): unknown { return unvaultForLlm(value, vault); }

/** Rows behind a pointer (plain or ptr:// v2 relational query), from the latest snapshot of its scenario. */
export function resolveDataPtr(ptr: string): ResolvedDataPtr {
  const emptyMetrics = createPiiVault().metrics();
  const selection = parseSelectionPtr(ptr) ? resolveSelectionPtr(ptr) : null;
  if (selection) {
    const llmSafeValue = selection.piiVault.pseudonymize(selection.rows);
    const m = selection.piiVault.metrics();
    return { found: true, value: selection.rows, rows: selection.rows, descriptor: selection.descriptor, piiMetrics: m, vaultMetrics: m, pii: m, pseudonymizedValue: llmSafeValue, llmSafeValue };
  }
  const parsed = parseDataPtr(ptr);
  if (!parsed) return { found: false, value: [], rows: [], error: `invalid ptr: ${ptr}`, piiMetrics: emptyMetrics, vaultMetrics: emptyMetrics, pii: emptyMetrics };
  const snapshot = [...latest.values()].find((s) => s.scenarioId.toLowerCase() === parsed.scenario);
  const base = (parsed.basePtr ?? baseDataPtr(ptr)) as DataPtr;
  if (!snapshot?.rows.has(base)) return { found: false, value: [], rows: [], error: `'${ptr}' is not published`, piiMetrics: emptyMetrics, vaultMetrics: emptyMetrics, pii: emptyMetrics };
  const descriptor = snapshot.descriptors.find((d) => d.ptr === base)!;
  const metrics = snapshot.piiVault ? snapshot.piiVault.metrics() : snapshot.piiMetrics;
  const raw = snapshot.rows.get(base);
  if (!parsed.query) {
    const llmSafeValue = snapshot.piiVault.pseudonymize(raw);
    const m2 = snapshot.piiVault.metrics();
    return { found: true, value: raw, rows: raw, descriptor, piiMetrics: m2, vaultMetrics: m2, pii: m2, pseudonymizedValue: llmSafeValue, llmSafeValue };
  }
  const resolved = resolvePointer(ptr, raw);
  if (!resolved.found) return { found: false, value: [], rows: [], descriptor, error: resolved.error ?? "invalid ptr query", query: parsed.query, piiMetrics: metrics, vaultMetrics: metrics, pii: metrics };
  const llmSafeValue = snapshot.piiVault.pseudonymize(resolved.value);
  const m2 = snapshot.piiVault.metrics();
  return { found: true, value: resolved.value, rows: resolved.value, descriptor, query: parsed.query, piiMetrics: m2, vaultMetrics: m2, pii: m2, pseudonymizedValue: llmSafeValue, llmSafeValue };
}
export const resolvePointerFn = resolveDataPtr;
export { resolvePointer };

/* -------------------------------- descriptors ------------------------------- */

const ENUM_MAX = 6;
const ENUM_VALUE_MAX = 80;
/** Per-person or per-event columns: never aggregated into a prompt, whatever their cardinality. */
const PERSONAL_COLUMNS = new Set(["upn", "displayName", "objectId", "id", "jobTitle", "ipAddress", "deviceName", "appId", "timestamp", "lastSignIn", "lastCheckIn", "location"]);

/**
 * Shape and aggregates of one dataset, never its rows: row count, columns, and value
 * counts for the low-cardinality columns (states, error codes, policy names), which is
 * what a headline needs. Unique columns such as UPNs or device names are left out.
 */
export function describeDataset(ptr: DataPtr, key: DatasetKey, value: unknown): DatasetDescriptor {
  const { component, prop } = DATASETS[key];
  const bytes = value === undefined || value === null ? 0 : Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
  const base = { ptr, component, prop, bytes };
  if (typeof value === "string") {
    const lines = value ? value.split("\n") : [];
    return {
      ...base,
      kind: value ? "text" : "empty",
      rowCount: lines.length,
      columns: [],
      aggregates: value
        ? {
            files: lines.filter((l) => l.startsWith("+++ ")).length,
            hunks: lines.filter((l) => l.startsWith("@@")).length,
            added: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
            removed: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
          }
        : {},
    };
  }
  if (Array.isArray(value)) {
    const rows = value.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object");
    const cols = columnsOf(rows);
    const piiFields = cols.filter((c) => isPiiField(c));
    return { ...base, kind: rows.length ? "rows" : "empty", rowCount: rows.length, columns: cols, aggregates: enumCounts(rows), ...(piiFields.length ? { piiFields, piiAnnotations: Object.fromEntries(piiFields.map((f) => [f, PII_FIELDS[f as keyof typeof PII_FIELDS].annotation])) } : {}) };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const nested = Object.values(obj).find(Array.isArray) as unknown[] | undefined;
    const scalars = Object.fromEntries(
      Object.entries(obj).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) && String(v).length <= ENUM_VALUE_MAX),
    ) as Record<string, string | number | boolean>;
    return { ...base, kind: "object", rowCount: nested?.length ?? 1, columns: Object.keys(obj), aggregates: scalars };
  }
  return { ...base, kind: "empty", rowCount: 0, columns: [], aggregates: {} };
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

function enumCounts(rows: Record<string, unknown>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const column of columnsOf(rows)) {
    if (PERSONAL_COLUMNS.has(column)) continue;
    const values = rows.map((r) => r[column]).filter((v) => typeof v === "string" || typeof v === "boolean");
    if (!values.length) continue;
    const counts = new Map<string, number>();
    for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const repeats = counts.size < values.length || values.length <= 2;
    if (counts.size > ENUM_MAX || !repeats || [...counts.keys()].some((v) => v.length > ENUM_VALUE_MAX)) continue;
    out[column] = [...counts].map(([v, n]) => `${v}:${n}`).join(", ");
  }
  return out;
}
