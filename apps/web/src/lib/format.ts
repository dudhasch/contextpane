import type { HealthState, RouterTier } from "@contextpane/catalog";

export function fmtTimeUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}Z`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtSignInTime(iso: string, latestIso?: string): string {
  if (!iso) return "";
  if (/^(Yesterday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{2}:\d{2})/i.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const ref = latestIso ? new Date(latestIso) : new Date();
  const validRef = Number.isNaN(ref.getTime()) ? new Date() : ref;

  const isSameDay =
    d.getUTCFullYear() === validRef.getUTCFullYear() &&
    d.getUTCMonth() === validRef.getUTCMonth() &&
    d.getUTCDate() === validRef.getUTCDate();
  if (isSameDay) {
    return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}Z`;
  }

  const yesterday = new Date(validRef.getTime() - 86_400_000);
  const isYesterday =
    d.getUTCFullYear() === yesterday.getUTCFullYear() &&
    d.getUTCMonth() === yesterday.getUTCMonth() &&
    d.getUTCDate() === yesterday.getUTCDate();
  if (isYesterday) {
    return `Yesterday ${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}Z`;
  }

  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function fmtDateTimeUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${fmtTimeUtc(iso)}`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

export function countdown(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "BREACHED";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export const TIER_COLOR: Record<RouterTier, string> = {
  "Tier 0": "primary",
  "Tier 1A": "healthy",
  "Tier 1B": "meta",
  "Tier 2": "meta",
  "Tier 3A": "warning",
  "Tier 3B": "warning",
  Voice: "meta",
  Vision: "meta",
};

/** How each tier routes on the Meta Model API + Modal stack (HUD tier pill and router savings panel). */
export const TIER_ROUTE: Record<RouterTier, { label: string; route: string }> = {
  "Tier 0": { label: "Tier 0 · Recipe / SSE", route: "0 tokens · Local" },
  "Tier 1A": { label: "Tier 1A · Hover", route: "muse-glimmer-30b open weights · Modal → muse-spark-1.3 · Meta" },
  // Open weights serve Tier 1B only with CTX_OPEN_WEIGHT_TIERS=…,catalog, which the demo config does not set.
  "Tier 1B": { label: "Tier 1B · Catalog", route: "muse-spark-1.3 · Meta API" },
  "Tier 2": { label: "Tier 2 · Correlate", route: "muse-spark-1.3 · Meta API" },
  "Tier 3A": { label: "Tier 3 · Remediate", route: "muse-wonder-1.0 · Meta · Modal Verified" },
  "Tier 3B": { label: "Tier 3 · Remediate", route: "muse-wonder-1.0 · Meta · Modal Verified" },
  Voice: { label: "Voice · Steer", route: "muse-voice-transcribe-1.0 → muse-spark-1.3 · Meta API" },
  Vision: { label: "Tier 2 · Vision", route: "muse-spark-1.3 · image input · Meta API" },
};

export function tierRouteLabel(tier: RouterTier): string {
  const { label, route } = TIER_ROUTE[tier];
  return `${label} (${route})`;
}

export const PROVIDER_LABEL: Record<string, string> = {
  local: "Deterministic (0 tokens)",
  fireworks: "Fireworks",
  baseten: "Baseten 2M TPM",
  meta: "Meta API",
  "modal-open-weights": "Modal open weights",
  runpod: "RunPod open weights",
  "local-glimmer-30b": "Local llama-server",
};

const OPEN_WEIGHT_PROVIDERS = new Set(["modal-open-weights", "runpod", "local-glimmer-30b"]);
const OPEN_WEIGHT_HOST: Record<string, string> = { "modal-open-weights": "Modal L40S", runpod: "RunPod", "local-glimmer-30b": "local llama-server" };
const MODEL_LABEL: Record<string, string> = { "muse-glimmer-30b": "Muse Glimmer 30B" };

export const isOpenWeightProvider = (provider: string): boolean => OPEN_WEIGHT_PROVIDERS.has(provider);

/**
 * Who actually produced an answer, for the hover popover and lens header:
 * "Muse Glimmer 30B · Modal L40S · 24.6 s · cached", "muse-spark-1.3 · Meta API · 2.4 s", "deterministic".
 */
export function provenanceBadge(t: { provider: string; modelId: string; latencyMs: number; cached?: boolean; generatedLatencyMs?: number }): {
  label: string;
  tone: "healthy" | "meta" | "muted";
  title: string;
} {
  const cached = t.cached ?? / \(cached\)$/.test(t.modelId);
  const model = t.modelId.replace(/ \(cached\)$/, "");
  const ms = cached ? t.generatedLatencyMs : t.latencyMs;
  const secs = ms !== undefined && ms > 0 ? (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`) : null;
  if (t.provider === "local" || model === "deterministic") {
    return { label: "deterministic · 0 tokens", tone: "muted", title: "No model: built from the MCP context by the deterministic engine" };
  }
  const open = isOpenWeightProvider(t.provider);
  const host = open ? (OPEN_WEIGHT_HOST[t.provider] ?? t.provider) : (PROVIDER_LABEL[t.provider] ?? t.provider);
  const label = [MODEL_LABEL[model] ?? model, host, secs, cached ? "cached" : null].filter(Boolean).join(" · ");
  const title = cached
    ? `Answer generated by ${model} on ${host}${secs ? ` in ${secs}` : ""}, served from the persisted cache (0 tokens now)`
    : `Answered live by ${model} on ${host}${secs ? ` in ${secs}` : ""}`;
  return { label, tone: open ? "healthy" : "meta", title };
}

export function healthTone(state: HealthState): "healthy" | "warning" | "critical" | "muted" {
  return state === "unknown" ? "muted" : state;
}

/** Provenance of a pipeline stage, lens or card (`source` fields across the catalog). */
export const SOURCE_LABEL: Record<string, string> = {
  llm: "Model call",
  "mcp-probe": "MCP probe",
  "symbolic-verifier": "Symbolic verifier",
  "fallback-on-error": "Fallback (model error)",
  "not-attempted": "Not attempted",
  "deterministic-template": "Deterministic template",
  "deterministic-router": "Deterministic router",
  "live-graph": "Live Graph read",
  "live-arm": "Live ARM read",
  "seeded-manifest": "Lab",
  "real-tenant": "Real tenant",
  "simulated-lab": "Simulated lab",
  symbolic: "Symbolic model",
  simulated: "Simulated",
  cached: "Cached",
  seed: "Seeded",
  fixture: "Fixture",
};

/** Raw status slugs rendered in cards, banners and the audit log. */
export const STATUS_LABEL: Record<string, string> = {
  "in-sync": "In sync",
  conflict: "Conflict",
  drift: "Drift",
  drifted: "Drifted",
  compliant: "Compliant",
  noncompliant: "Non-compliant",
  "non-compliant": "Non-compliant",
  operational: "Operational",
  degraded: "Degraded",
  advisory: "Advisory",
  outage: "Outage",
  success: "Success",
  failure: "Failure",
  interrupted: "Interrupted",
  pending: "Pending",
  completed: "Completed",
  running: "Running",
  fallback: "Fallback",
  executed: "Executed",
  simulated: "Simulated",
  "rolled-back": "Rolled back",
  approved: "Approved",
  "report-only": "Report-only",
  enabledForReportingButNotEnforced: "Report-only",
  "break-glass": "Break-glass",
  gitops: "GitOps",
  rejected: "Rejected",
  exchangeActiveSync: "Exchange ActiveSync",
  browser: "Browser",
  mobileAppsAndDesktopClients: "Mobile & desktop apps",
};

/** `in-sync` → "In sync", unknown slugs → sentence case with separators turned into spaces. */
export function humanizeStatus(raw: string | null | undefined): string {
  if (!raw) return "";
  return STATUS_LABEL[raw] ?? humanizeSlug(raw);
}

export function humanizeSource(raw: string | null | undefined): string {
  if (!raw) return SOURCE_LABEL["not-attempted"]!;
  return SOURCE_LABEL[raw] ?? humanizeSlug(raw);
}

/** `fallback-on-error` / `camelCaseField` / `PascalCaseCard` → "Fallback on error" / "Camel case field". */
export function humanizeSlug(raw: string): string {
  const spaced = raw
    .replace(/Card$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!spaced) return raw;
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** SKU part numbers → product names; shared with the orchestrator so server-built labels match. */
export { humanizeSku } from "@contextpane/catalog";

/** Sub-agents of the custom-ticket pipeline, by the index in their `agent:<n>:…` stage id. */
const AGENT_LABEL: Record<string, string> = {
  "0": "Scope",
  "1": "Clarifier",
  "2": "Telemetry scout",
  "3": "UI architect",
  "4": "Coder",
  "5": "Safety verifier",
};

/** Fixed progress stage ids (SSE `progress` events) → short ticker labels. */
const STAGE_LABEL: Record<string, string> = {
  "plan:start": "Planning",
  "plan:done": "Plan ready",
  "plan:fallback": "Plan fallback",
  "code:start": "Writing code",
  "code:done": "Code ready",
  "code:fallback": "Code fallback",
  "bundle:ready": "Bundle ready",
  "preflight:start": "Pre-flight",
  "preflight:done": "Pre-flight done",
  "preflight:fallback": "Pre-flight fallback",
  "stage:start": "Staging",
  "stage:done": "Staged",
  "mcp:start": "MCP query",
  "mcp:done": "MCP data in",
  mcp_ready: "Cards painted",
  "llm:attempt": "Model call",
  "llm:step": "Model step",
  "llm:skip": "No model call",
  "dataplane:bind": "Data bound",
  dataplane: "Data plane",
  validate: "Validating",
  repair: "Repair",
  complete: "Complete",
  remediate: "Remediate",
  refine: "Refine",
  approve: "Approve",
  rollback: "Rollback",
  log: "Log",
};

/** `agent:3:routed` → "Plan routed", `plan:start` → "Planning"; unknown ids fall back to sentence case. */
export function stageLabel(stage: string): string {
  const fixed = STAGE_LABEL[stage];
  if (fixed) return fixed;
  const agent = /^agent:(\d+):(start|done|routed)$/.exec(stage);
  if (agent) {
    if (agent[2] === "routed") return "Plan routed";
    const name = AGENT_LABEL[agent[1]!] ?? `Agent ${agent[1]}`;
    return agent[2] === "done" ? `${name} done` : name;
  }
  const [head, tail] = stage.split(":", 2);
  if (tail === "start") return humanizeSlug(head!);
  if (tail === "done") return `${humanizeSlug(head!)} done`;
  return humanizeSlug(stage.replace(/:/g, " "));
}
