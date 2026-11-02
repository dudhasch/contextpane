/**
 * Why a sub-agent fell back to its deterministic template (review item 6). The cause is logged
 * and carried to the pipeline record, so the fallback badge in the UI says what failed instead of
 * only "Fallback (model error)".
 */
export const MODEL_CALLS_DISABLED = "model calls disabled (no META_API_KEY, CTX_FORCE_LOCAL=true or a test run)";

export function fallbackCause(stage: string, error: unknown): string {
  const raw = error instanceof Error ? (error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message) : String(error);
  const reason = raw.replace(/\s+/g, " ").trim().slice(0, 280) || "unknown error";
  console.warn(`  [${stage}] model path failed, deterministic fallback used: ${reason}`);
  return reason;
}

/** A reply that arrived but was not usable: logged like an error, without an exception. */
export function rejectedReply(stage: string, why: string): string {
  return fallbackCause(stage, new Error(`model reply rejected: ${why}`));
}
