import {
  STEERING_TYPED_KEYS,
  SteeringGovernanceSchema,
  SteeringScopeSchema,
  SteeringStrategySchema,
  emptySteering,
  steeringDigest,
  type ActionApprovalDrawer,
  type ClarifyingQuestion,
  type SteeringDelta,
  type SteeringGovernance,
  type SteeringParams,
  type SteeringScope,
  type SteeringSource,
  type SteeringStrategy,
  type SteeringTypedKey,
} from "@contextpane/catalog";
import { createTwoFilesPatch } from "diff";

/**
 * Steering that moves code (U-1).
 *
 * Design: the clarifier's answers and the in-card interactions are folded into one
 * `SteeringParams` object with provenance, and that object (not a label string) is what
 * the coder is fed. The three mappings live here and nowhere else:
 *
 *   clarifier answer  --classify-->  typed key   (strategy / scope / governance / region / targetResource)
 *   row click         ------------>  targetResource (or the key the card names)
 *   card action       ------------>  setsParams, verbatim
 *
 * `applySteeringDelta` is the only writer: it bumps `version`, recomputes `digest` and keeps
 * `answers` (every clarifier answer by question id) in sync with the typed view, so the pills
 * and the coder can never disagree. A drawer records the `{version, digest}` it was built
 * for; `isDrawerStale` compares it with the entry. The S3 card and the S4 script stay
 * parallel at triage (both read the same params); after a steer only the coder re-runs and
 * the card's config-diff block is rewritten from the real script diff, so the ~15 s card
 * synthesis never lands on the critical path unless the caller asks for `coder+ui`
 * (HARD_CASES 3).
 */

/* ------------------------------- classification ------------------------------ */

export function classifyStrategy(label: string): SteeringStrategy {
  const l = label.toLowerCase();
  if (/\b(recover|restore|undo|undelete|un-delete|reinstate)\b/.test(l)) return "recover";
  if (/\b(purge|recreate|re-create|replace|delete and|wipe|clean state)\b/.test(l)) return "purge-recreate";
  if (/\b(gitops|terraform|declarative|bundle|iac|pull request)\b/.test(l)) return "gitops-bundle";
  if (/\b(in-place|in place|update existing|reconfigure|patch)\b/.test(l)) return "in-place";
  return "custom";
}

export function classifyScope(label: string): SteeringScope {
  const l = label.toLowerCase();
  if (/\b(staging|validation|non-prod|pre-prod|test first|dry run first)\b/.test(l)) return "staging-first";
  if (/\b(tenant|subscription|all matching|fleet|everything|wide)\b/.test(l)) return "tenant-wide";
  if (/\b(production|prod|scoped|phased|canary|affected|targeted)\b/.test(l)) return "production-scoped";
  return "custom";
}

export function classifyGovernance(label: string): SteeringGovernance {
  const l = label.toLowerCase();
  if (/\b(break-glass|break glass|emergency|exception|exemption)\b/.test(l)) return "break-glass";
  if (/\b(audit|what-if|whatif|report-only|report only|dry[- ]run|verification first)\b/.test(l)) return "audit-first";
  if (/\b(least[- ]privilege|guardrail|baseline|rbac|policy)\b/.test(l)) return "least-privilege";
  return "custom";
}

/** Which typed key a clarifier question steers, from its category first and its id/wording second. */
export function typedKeyForQuestion(q: Pick<ClarifyingQuestion, "id" | "category" | "question">): SteeringTypedKey | null {
  const cat = (q.category ?? "").toLowerCase();
  const text = `${q.id} ${q.question}`.toLowerCase();
  if (cat === "remediation" || /strateg|resolution|remediat/.test(text)) return "remediationStrategy";
  if (cat === "region" || /\bregion|location\b/.test(text)) return "region";
  if (cat === "security" || /governance|posture|security|guardrail/.test(text)) return "governance";
  if (cat === "scope" || /scope|target|environment/.test(text)) return "scope";
  return null;
}

/** An operator-typed answer that names one resource (kv-contoso-fin-02, nsg-…, a UPN) rather than picking a scope. */
function looksLikeResourceName(label: string): boolean {
  const t = label.trim();
  return t.length >= 3 && t.length <= 120 && !/\s/.test(t) && /[-._@/]/.test(t);
}

/* ---------------------------------- building --------------------------------- */

function param<T>(value: T, label: string | undefined, source: SteeringSource, setAt: string) {
  return { value, ...(label !== undefined ? { label } : {}), source, setAt };
}

/** Writes the typed view of one clarifier answer onto the params (mutates `next`). */
function applyClarifierAnswer(next: SteeringParams, q: Pick<ClarifyingQuestion, "id" | "category" | "question">, label: string, source: SteeringSource, setAt: string): void {
  next.answers[q.id] = param(label, label, source, setAt);
  const key = typedKeyForQuestion(q);
  if (!key) return;
  if (key === "remediationStrategy") next.remediationStrategy = param(classifyStrategy(label), label, source, setAt);
  else if (key === "governance") {
    const g = classifyGovernance(label);
    next.governance = param(g, label, source, setAt);
    if (g === "audit-first") next.dryRun = param(true, label, source, setAt);
    else if (g === "break-glass" && next.dryRun?.source !== "operator") next.dryRun = param(false, label, source, setAt);
  } else if (key === "region") next.region = param(label.trim().toLowerCase().replace(/\s+/g, ""), label, source, setAt);
  else if (key === "scope") {
    if (looksLikeResourceName(label)) {
      next.targetResource = param(label.trim(), label, source, setAt);
      next.scope = param("production-scoped", label, source, setAt);
    } else next.scope = param(classifyScope(label), label, source, setAt);
  }
}

/**
 * The steering the clarifier defaults (or the operator's picks) amount to, version 0 unless
 * `previous` is given, in which case the version continues from it.
 */
export function deriveSteeringFromAnswers(
  questions: ClarifyingQuestion[],
  answers: Record<string, string> | undefined,
  options: { source?: SteeringSource; previous?: SteeringParams; now?: string } = {},
): SteeringParams {
  const now = options.now ?? new Date().toISOString();
  const source = options.source ?? "clarifier";
  const next: SteeringParams = options.previous ? structuredClone(options.previous) : emptySteering(now);
  next.answers = { ...next.answers };
  for (const q of questions) {
    const label = answers?.[q.id] ?? q.selectedValue ?? q.options[0]?.value;
    if (!label) continue;
    const existing = options.previous?.answers[q.id];
    // A previous answer that did not change keeps its provenance and timestamp.
    if (existing && existing.value === label) continue;
    applyClarifierAnswer(next, q, label, source, now);
  }
  // Any answer whose question disappeared is dropped from the typed view's source of truth.
  for (const qid of Object.keys(next.answers)) if (answers && !(qid in answers) && !questions.some((q) => q.id === qid)) delete next.answers[qid];
  next.updatedAt = now;
  next.digest = steeringDigest(next);
  if (options.previous && next.digest !== options.previous.digest) next.version = options.previous.version + 1;
  else if (options.previous) next.version = options.previous.version;
  return next;
}

type TypedValue = SteeringStrategy | SteeringScope | SteeringGovernance | string | string[] | boolean;

function coerceTyped(key: SteeringTypedKey, raw: string | boolean | string[]): TypedValue | null {
  switch (key) {
    case "remediationStrategy":
      return typeof raw === "string" ? (SteeringStrategySchema.safeParse(raw).success ? (raw as SteeringStrategy) : classifyStrategy(raw)) : null;
    case "scope":
      return typeof raw === "string" ? (SteeringScopeSchema.safeParse(raw).success ? (raw as SteeringScope) : classifyScope(raw)) : null;
    case "governance":
      return typeof raw === "string" ? (SteeringGovernanceSchema.safeParse(raw).success ? (raw as SteeringGovernance) : classifyGovernance(raw)) : null;
    case "targetIds":
      return Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\s]+/).filter(Boolean) : null;
    case "targetResource":
    case "region":
      return typeof raw === "string" && raw.trim() ? raw.trim() : null;
    case "dryRun":
      return typeof raw === "boolean" ? raw : typeof raw === "string" ? /^(true|yes|1|on)$/i.test(raw) : null;
  }
}

/**
 * The only writer. Applies a pill toggle, a typed-key change or a row click, bumps the version
 * when the digest moved and keeps `answers` and the typed view consistent.
 */
export function applySteeringDelta(current: SteeringParams, delta: SteeringDelta, questions: ClarifyingQuestion[], now = new Date().toISOString()): SteeringParams {
  const source: SteeringSource = delta.source ?? (delta.rowClick ? "row-click" : delta.clarifier ? "clarifier" : "operator");
  const next: SteeringParams = structuredClone(current);
  next.answers = { ...next.answers };
  for (const [qid, label] of Object.entries(delta.clarifier ?? {})) {
    const q = questions.find((x) => x.id === qid) ?? { id: qid, category: "scope", question: qid };
    applyClarifierAnswer(next, q, label, source, now);
  }
  for (const [rawKey, raw] of Object.entries(delta.params ?? {})) {
    const key = (STEERING_TYPED_KEYS as readonly string[]).includes(rawKey) ? (rawKey as SteeringTypedKey) : null;
    if (!key) continue;
    const value = coerceTyped(key, raw);
    if (value === null) continue;
    (next as Record<string, unknown>)[key] = param(value, typeof raw === "string" ? raw : undefined, source, now);
  }
  if (delta.rowClick) {
    const key = (STEERING_TYPED_KEYS as readonly string[]).includes(delta.rowClick.key) ? (delta.rowClick.key as SteeringTypedKey) : "targetResource";
    const value = coerceTyped(key, delta.rowClick.value);
    if (value !== null) (next as Record<string, unknown>)[key] = param(value, delta.rowClick.label ?? delta.rowClick.value, "row-click", now);
  }
  next.digest = steeringDigest(next);
  if (next.digest !== current.digest) {
    next.version = current.version + 1;
    next.updatedAt = now;
  }
  return next;
}

/** The clarifier answers (question id -> label) the params hold, for `clarifiedAnswers` and the pills. */
export function clarifiedAnswersFromSteering(params: SteeringParams): Record<string, string> {
  return Object.fromEntries(Object.entries(params.answers).map(([qid, p]) => [qid, p.label ?? p.value]));
}

/** True when the drawer's script was built for an older steering than the entry carries. */
export function isDrawerStale(drawer: Pick<ActionApprovalDrawer, "steering"> | null | undefined, current: SteeringParams | null | undefined): boolean {
  if (!drawer || !current) return false;
  if (!drawer.steering) return current.version > 0;
  return drawer.steering.digest !== current.digest;
}

/** The compact object the coder prompt receives: values only, with the labels the operator saw. */
export function steeringForCoder(params: SteeringParams): Record<string, unknown> {
  const out: Record<string, unknown> = { version: params.version };
  for (const key of STEERING_TYPED_KEYS) {
    const p = params[key];
    if (p) out[key] = p.label && p.label !== String(p.value) ? { value: p.value, operatorLabel: p.label, source: p.source } : { value: p.value, source: p.source };
  }
  out.clarifierAnswers = clarifiedAnswersFromSteering(params);
  return out;
}

/** Unified diff between two script versions, headed with the steering versions they belong to. */
export function scriptDiff(previous: string, next: string, fromVersion: number, toVersion: number, fileName = "remediation.ps1"): string {
  if (previous === next) return "";
  return createTwoFilesPatch(fileName, fileName, previous, next, `steering v${fromVersion}`, `steering v${toVersion}`, { context: 2 });
}
