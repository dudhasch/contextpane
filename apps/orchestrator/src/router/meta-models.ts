import { models, providers } from "../config.ts";

/**
 * The hackathon brief names Meta model ids the Meta Model API does not serve
 * (verified 2026-10-26 against GET /v1/models): muse-glimmer-30b is open-weight
 * only, muse-code is not exposed, and the voice model is muse-voice-transcribe-1.0.
 * At startup every configured Meta id is checked against the served list and an
 * unserved id is swapped for its stand-in, so a stale .env.local pin costs nothing.
 */
const STAND_INS: Record<string, string> = {
  "muse-glimmer-30b": "muse-spark-1.3",
  "muse-code": "muse-wonder-1.0",
};

const META_MODEL_KEYS = ["metaSpark", "metaSparkContributor", "metaCatalog", "metaWonder", "metaCode", "metaHover", "metaVoice"] as const;

export interface MetaModelResolution {
  served: string[];
  substituted: Array<{ key: string; configured: string; using: string }>;
  missing: string[];
}

let resolution: Promise<unknown> = Promise.resolve();

/** Settles once the startup model check has run (or failed), so no request uses an unresolved id. */
export function metaModelsResolved(): Promise<unknown> {
  return resolution;
}

export function resolveMetaModels(timeoutMs = 8000): Promise<MetaModelResolution | null> {
  const pending = resolveMetaModelsNow(timeoutMs);
  resolution = pending.catch(() => null);
  return pending;
}

async function resolveMetaModelsNow(timeoutMs: number): Promise<MetaModelResolution | null> {
  if (!providers.meta.hasKey) return null;
  const response = await fetch(`${providers.meta.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${providers.meta.apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`GET /models HTTP ${response.status}`);
  const served = new Set(((await response.json()) as { data?: Array<{ id: string }> }).data?.map((m) => m.id) ?? []);
  const result: MetaModelResolution = { served: [...served], substituted: [], missing: [] };
  for (const key of META_MODEL_KEYS) {
    const configured = models[key];
    if (served.has(configured)) continue;
    const using = [STAND_INS[configured], ...[...served].filter((id) => id.startsWith(`${configured}-`)).sort()].find((id) => id && served.has(id));
    if (using) {
      models[key] = using;
      result.substituted.push({ key, configured, using });
    } else {
      result.missing.push(configured);
    }
  }
  return result;
}
