import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProviderId } from "@contextpane/catalog";

/* -------------------------------------------------------------------------- */
/* Repo root + dotenv                                                          */
/* -------------------------------------------------------------------------- */

export function findRepoRoot(): string {
  for (const anchor of [process.cwd(), import.meta.dir]) {
    let dir = resolve(anchor);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "demo-iac", "demo-lab-manifest.json")) && existsSync(join(dir, "package.json"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

/**
 * Load <root>/.env then <root>/.env.local. .env.local overrides .env, but neither overrides a
 * variable the process already had (so a test's LIVE_CLOUD_MODE=false or CTX_FORCE_LOCAL=true wins).
 */
function loadDotEnv(): string[] {
  const loaded: string[] = [];
  const fromDotEnv = new Set<string>();
  for (const file of [".env", ".env.local"]) {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) continue;
    loaded.push(file);
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined || fromDotEnv.has(key)) {
        process.env[key] = value;
        fromDotEnv.add(key);
      }
    }
  }
  return loaded;
}

export const DOTENV_FILES_LOADED = loadDotEnv();

const env = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};
const envBool = (key: string, fallback = false): boolean => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return /^(true|1|yes|on)$/i.test(v);
};
const envInt = (key: string, fallback: number): number => {
  const n = Number.parseInt(env(key), 10);
  return Number.isFinite(n) ? n : fallback;
};
const EFFORTS = ["minimal", "low", "medium", "high"] as const;
const envEffort = (key: string, fallback: (typeof EFFORTS)[number]): (typeof EFFORTS)[number] => {
  const v = env(key).toLowerCase();
  return (EFFORTS as readonly string[]).includes(v) ? (v as (typeof EFFORTS)[number]) : fallback;
};
const envFloat = (key: string, fallback: number): number => {
  const n = Number.parseFloat(env(key));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/* -------------------------------------------------------------------------- */
/* Provider + model configuration                                              */
/* -------------------------------------------------------------------------- */

export interface ProviderConfig {
  id: Exclude<ProviderId, "local">;
  label: string;
  baseUrl: string;
  apiKey: string;
  /** Ready to call: an API key for hosted APIs, a base URL for self-hosted open-weight vLLM. */
  hasKey: boolean;
}

/** MODEL_API_KEY is accepted as an alias for the Meta Model API key. */
const metaApiKey = env("META_API_KEY", env("MODEL_API_KEY"));

/**
 * Self-hosted open-weight Muse Glimmer 30B (OpenAI-compatible llama-server or vLLM):
 * CTX_OPEN_WEIGHT_BASE_URL wins, else the Modal deployment, else the RunPod pod.
 * The telemetry provider names where it runs: a loopback llama-server is
 * local-glimmer-30b, a RunPod pod runpod, anything else modal-open-weights.
 */
const openWeightBaseUrl = env("CTX_OPEN_WEIGHT_BASE_URL", env("MODAL_INFERENCE_BASE_URL", env("RUNPOD_VLLM_BASE_URL")));
const openWeightHost = (() => {
  try {
    return new URL(openWeightBaseUrl).hostname;
  } catch {
    return "";
  }
})();
const openWeight: Pick<ProviderConfig, "id" | "label"> =
  /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/i.test(openWeightHost)
    ? { id: "local-glimmer-30b", label: "Local llama-server" }
    : /runpod/i.test(openWeightBaseUrl) || (openWeightBaseUrl !== "" && openWeightBaseUrl === env("RUNPOD_VLLM_BASE_URL"))
      ? { id: "runpod", label: "RunPod open weights" }
      : { id: "modal-open-weights", label: "Modal open weights" };

export const providers: Record<"openWeight" | "fireworks" | "baseten" | "meta", ProviderConfig> = {
  openWeight: {
    ...openWeight,
    baseUrl: openWeightBaseUrl,
    apiKey: env("CTX_OPEN_WEIGHT_API_KEY"),
    hasKey: openWeightBaseUrl !== "",
  },
  fireworks: {
    id: "fireworks",
    label: "Fireworks",
    baseUrl: env("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1"),
    apiKey: env("FIREWORKS_API_KEY"),
    hasKey: env("FIREWORKS_API_KEY") !== "",
  },
  baseten: {
    id: "baseten",
    label: "Baseten 2M TPM",
    baseUrl: env("BASETEN_BASE_URL", "https://inference.baseten.co/v1"),
    apiKey: env("BASETEN_API_KEY"),
    hasKey: env("BASETEN_API_KEY") !== "",
  },
  meta: {
    id: "meta",
    label: "Meta API",
    baseUrl: env("META_API_BASE_URL", "https://api.meta.ai/v1"),
    apiKey: metaApiKey,
    hasKey: metaApiKey !== "",
  },
};

/** Resolve a chain step's provider id to its config (the open-weight endpoint reports as modal or runpod). */
export function providerFor(id: ProviderId): ProviderConfig {
  const found = Object.values(providers).find((p) => p.id === id);
  if (!found) throw new Error(`no provider config for ${id}`);
  return found;
}

export const models = {
  openWeightGlimmer: env("CTX_MODEL_OPEN_WEIGHT_GLIMMER", "muse-glimmer-30b"),
  openWeightCatalog: env("CTX_MODEL_OPEN_WEIGHT_CATALOG", env("CTX_MODEL_OPEN_WEIGHT_GLIMMER", "muse-glimmer-30b")),
  fireworksGlimmer: env("CTX_MODEL_FIREWORKS_GLIMMER", "accounts/fireworks/models/muse-glimmer-30b"),
  basetenSpark: env("CTX_MODEL_BASETEN_SPARK", "meta-models/muse-spark-open-1026"),
  basetenGlimmer: env("CTX_MODEL_BASETEN_GLIMMER", "muse-glimmer-30b"),
  metaSpark: env("CTX_MODEL_META_SPARK", "muse-spark-1.3"),
  metaSparkContributor: env("CTX_MODEL_META_SPARK_CONTRIBUTOR", "muse-spark-1.3-contributor"),
  /** Tier 1B on the Meta API. muse-spark-1.3 at minimal effort hydrates the layout in ~8 s; -contributor needs ~22 s. */
  metaCatalog: env("CTX_MODEL_META_CATALOG", "muse-spark-1.3"),
  metaWonder: env("CTX_MODEL_META_WONDER", "muse-wonder-1.0"),
  metaCode: env("CTX_MODEL_META_CODE", "muse-code"),
  /** Tier 1A on the Meta API (muse-glimmer-30b is open-weight only, not served there). */
  metaHover: env("CTX_MODEL_META_HOVER", "muse-spark-1.3"),
  metaVoice: env("CTX_MODEL_META_VOICE", "muse-voice-transcribe-1.0"),
  /** Ticket attachments (screenshots) read with image input on the Meta Model API. */
  metaVision: env("CTX_MODEL_META_VISION", "muse-spark-1.3"),
};

export const config = {
  port: envInt("CTX_ORCHESTRATOR_PORT", 4000),
  webOrigin: `http://localhost:${envInt("CTX_WEB_PORT", 5173)}`,
  liveCloudMode: envBool("LIVE_CLOUD_MODE", false),
  forceLocal: envBool("CTX_FORCE_LOCAL", false),
  allowExecute: envBool("CTX_ALLOW_EXECUTE", false),
  mcpTransport: (env("CTX_MCP_TRANSPORT", "in-process") === "stdio" ? "stdio" : "in-process") as "in-process" | "stdio",
  timeouts: {
    hoverMs: envInt("CTX_HOVER_TIMEOUT_MS", 2500),
    /** The Meta Model API's reasoning models answer a hover in ~1.5-2.5 s even at reasoning_effort=minimal. */
    metaHoverMs: envInt("CTX_META_HOVER_TIMEOUT_MS", 5000),
    /** Muse Glimmer always reasons (budget-capped server-side), so it gets longer than the hosted hover APIs. */
    openWeightHoverMs: envInt("CTX_OPEN_WEIGHT_HOVER_TIMEOUT_MS", 8000),
    /** Background pre-warm of the hover cache: a cold GPU container plus a full reasoning pass. */
    openWeightWarmMs: envInt("CTX_OPEN_WEIGHT_WARM_TIMEOUT_MS", 90000),
    correlateMs: envInt("CTX_CORRELATE_TIMEOUT_MS", 20000),
    /** Highlight → Generate Context UI: muse-spark-1.3 at minimal effort composes a mini-dashboard in ~2-5 s. */
    exploreMs: envInt("CTX_EXPLORE_TIMEOUT_MS", 8000),
    remediateMs: envInt("CTX_REMEDIATE_TIMEOUT_MS", 45000),
    voiceMs: envInt("CTX_VOICE_TIMEOUT_MS", 15000),
    visionMs: envInt("CTX_VISION_TIMEOUT_MS", 30000),
  },
  /** reasoning_effort per tier on the Meta Model API (minimal | low | medium | high). */
  reasoning: {
    hover: envEffort("CTX_META_REASONING_HOVER", "minimal"),
    catalog: envEffort("CTX_META_REASONING_CATALOG", "minimal"),
    correlate: envEffort("CTX_META_REASONING_CORRELATE", "low"),
    remediate: envEffort("CTX_META_REASONING_REMEDIATE", "low"),
  },
  /**
   * Router tiers the open-weight endpoint serves (hover, catalog, voice). Hover only by default, so a
   * correlate or voice command never wakes the scale-to-zero GPU; hovers are cached on disk.
   */
  /**
   * Muse Glimmer reasons before it calls the tool and llama-server b11889 does not enforce
   * --reasoning-budget (a host-pool hover reasoned ~1,100 tokens), so it gets more room than 1500.
   */
  openWeightHoverMaxTokens: envInt("CTX_OPEN_WEIGHT_HOVER_MAX_TOKENS", 3000),
  openWeightTiers: new Set(env("CTX_OPEN_WEIGHT_TIERS", "hover").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)),
  modal: {
    /** On whenever a sandbox URL is set; CTX_MODAL_SANDBOX_ENABLED=false is an explicit opt-out. */
    enabled: envBool("CTX_MODAL_SANDBOX_ENABLED", env("CTX_MODAL_SANDBOX_URL") !== "") && env("CTX_MODAL_SANDBOX_URL") !== "",
    url: env("CTX_MODAL_SANDBOX_URL"),
    token: env("CTX_MODAL_SANDBOX_TOKEN"),
  },
  stagingDir: resolve(REPO_ROOT, env("CTX_STAGING_DIR", ".contextpane/staging")),
  dataDir: join(REPO_ROOT, "data"),
  /** The ERP file-drop inbox: <root>/input/tickets/#<id>/ticketbody.json + image attachments. */
  inboxDir: resolve(REPO_ROOT, env("CTX_INBOX_DIR", "input/tickets")),
  /** Directory scan cadence of the inbox watcher (fs.watch events only shorten the wait). */
  inboxScanMs: envInt("CTX_INBOX_SCAN_MS", 1000),
  github: {
    /** Push the staged fix/* branch and run `gh pr create` when a remediation is approved (needs remote origin + gh auth). */
    prOnApprove: envBool("CTX_GH_PR_ON_APPROVE", false),
    prBase: env("CTX_GH_PR_BASE", "main"),
  },
  pricing: {
    /** Blended assumption used only for the "API credit saved" metric in the router savings panel. */
    usdPer1MTokens: envFloat("CTX_PRICE_USD_PER_1M_TOKENS", 1.0),
  },
  lab: {
    tenantId: env("CTX_LAB_TENANT_ID", "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea"),
    subscriptionId: env("CTX_LAB_SUBSCRIPTION_ID", "20505597-043c-4742-a884-42dc3f621aef"),
    domain: env("CTX_LAB_DOMAIN", "c4a8shili.onmicrosoft.com"),
    delegatedIdentity: env("CTX_LAB_DELEGATED_IDENTITY", "cloudadmin@c4a8shili.onmicrosoft.com"),
  },
};

export function anyProviderKey(): boolean {
  return Object.values(providers).some((p) => p.hasKey);
}

export function describeConfig() {
  return {
    repoRoot: REPO_ROOT,
    dotenvLoaded: DOTENV_FILES_LOADED,
    liveCloudMode: config.liveCloudMode,
    forceLocal: config.forceLocal,
    mcpTransport: config.mcpTransport,
    providers: Object.values(providers).map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, hasKey: p.hasKey })),
    models,
    modalSandbox: { enabled: config.modal.enabled, configured: config.modal.url !== "" },
    timeouts: config.timeouts,
    github: config.github,
    pricing: config.pricing,
  };
}
