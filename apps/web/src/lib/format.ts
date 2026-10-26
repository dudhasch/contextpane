import type { HealthState, RouterTier } from "@contextpane/catalog";

export function fmtTimeUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}Z`;
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
  "Tier 1A": { label: "Tier 1A · Hover", route: "muse-glimmer-30b · Modal → muse-spark-1.3 · Meta" },
  "Tier 1B": { label: "Tier 1B · Catalog", route: "muse-glimmer-30b · Modal → muse-spark-1.3 · Meta" },
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

export function healthTone(state: HealthState): "healthy" | "warning" | "critical" | "muted" {
  return state === "unknown" ? "muted" : state;
}
