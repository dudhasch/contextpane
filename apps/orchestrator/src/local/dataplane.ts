import {
  DATASETS,
  dataPtr,
  datasetsFor,
  parseDataPtr,
  type CanvasComponentType,
  type DataPtr,
  type DatasetDescriptor,
  type DatasetKey,
  type ScenarioId,
} from "@contextpane/catalog";
import type { CorrelationContext } from "../mcp/context.ts";
import { buildComponent, scenarioComponents } from "./hydrate.ts";

/**
 * The orchestrator's data plane for the ptr:// bypass protocol. Every row set a
 * scenario's cards show is published once per gathered context under
 * ptr://<scenario>/<plane>/<dataset>; the models get the descriptors, and the
 * layout's pointers are bound back to these rows before the layout is streamed.
 */

export interface DataPlaneSnapshot {
  scenarioId: ScenarioId;
  gatheredAt: string;
  descriptors: DatasetDescriptor[];
  rows: Map<DataPtr, unknown>;
  /** Total JSON size of the rows: what a prompt carrying them would have spent. */
  bytes: number;
}

const byContext = new WeakMap<CorrelationContext, DataPlaneSnapshot>();
const latest = new Map<ScenarioId, DataPlaneSnapshot>();

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
      const ptr = dataPtr(ctx.scenarioId, key);
      const value = props[DATASETS[key].prop];
      rows.set(ptr, value);
      descriptors.push(describeDataset(ptr, key, value));
    }
  }
  const snapshot: DataPlaneSnapshot = {
    scenarioId: ctx.scenarioId,
    gatheredAt: ctx.gatheredAt,
    descriptors,
    rows,
    bytes: descriptors.reduce((n, d) => n + d.bytes, 0),
  };
  byContext.set(ctx, snapshot);
  latest.set(ctx.scenarioId, snapshot);
  return snapshot;
}

/** The latest published snapshot of a scenario, if it has been gathered since start. */
export function dataPlaneSnapshot(scenarioId: ScenarioId): DataPlaneSnapshot | null {
  return latest.get(scenarioId) ?? null;
}

/** Rows behind a pointer, from the latest snapshot of its scenario. */
export function resolveDataPtr(ptr: string): { found: boolean; value?: unknown; descriptor?: DatasetDescriptor } {
  const parsed = parseDataPtr(ptr);
  if (!parsed) return { found: false };
  const snapshot = [...latest.values()].find((s) => s.scenarioId.toLowerCase() === parsed.scenario);
  if (!snapshot?.rows.has(ptr as DataPtr)) return { found: false };
  return { found: true, value: snapshot.rows.get(ptr as DataPtr), descriptor: snapshot.descriptors.find((d) => d.ptr === ptr)! };
}

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
    return { ...base, kind: rows.length ? "rows" : "empty", rowCount: rows.length, columns: columnsOf(rows), aggregates: enumCounts(rows) };
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
