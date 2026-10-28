import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/* -------------------------------------------------------------------------- */
/* Repo / manifest resolution (kept local so this server has no sibling deps)  */
/* -------------------------------------------------------------------------- */

const MANIFEST_REL = join("demo-iac", "demo-lab-manifest.json");

export function findRepoRoot(anchors: string[] = [process.cwd(), import.meta.dir]): string | null {
  for (const anchor of anchors) {
    let dir = resolve(anchor);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, MANIFEST_REL))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function resolveIacDir(): string {
  const override = process.env.CTX_DEMO_IAC_DIR;
  if (override && existsSync(override)) return resolve(override);
  const root = findRepoRoot();
  if (!root) throw new Error(`demo-iac directory not found. Set CTX_DEMO_IAC_DIR or run inside the ContextPane repository (cwd=${process.cwd()}).`);
  return join(root, "demo-iac");
}

export function resolveManifestPath(): string {
  const override = process.env.CTX_DEMO_MANIFEST;
  if (override && existsSync(override)) return resolve(override);
  return join(resolveIacDir(), "demo-lab-manifest.json");
}

export interface ManifestSecurityRule {
  name: string;
  priority: number;
  direction: "Inbound" | "Outbound";
  access: "Allow" | "Deny";
  protocol: string;
  sourcePortRange: string;
  destinationPortRange: string;
  sourceAddressPrefix: string;
  destinationAddressPrefix: string;
  description?: string;
}

export interface ManifestAzureTenant {
  displayName: string;
  tenantId: string;
  subscriptionId: string;
  /** Absent for tenants without an Azure estate in the demo (Fabrikam Legal is Intune-only). */
  azure?: {
    resourceGroup: string;
    location: string;
    terraformFile: string;
    gitBranch: string;
    nsg: { name: string; id: string; tags: Record<string, string>; securityRules: ManifestSecurityRule[] };
  };
}

interface ManifestShape {
  tenants: Record<string, ManifestAzureTenant>;
}

let cache: { path: string; mtimeMs: number; manifest: ManifestShape } | null = null;

export function loadManifest(): ManifestShape {
  const path = resolveManifestPath();
  const mtimeMs = statSync(path).mtimeMs;
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.manifest;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ManifestShape;
  cache = { path, mtimeMs, manifest };
  return manifest;
}

export function getManifestTenant(tenantId: string): ManifestAzureTenant {
  const tenant = loadManifest().tenants[tenantId];
  if (!tenant) throw new Error(`Tenant '${tenantId}' not present in demo-lab-manifest.json`);
  return tenant;
}

export type ManifestAzureEstate = NonNullable<ManifestAzureTenant["azure"]>;

/** The tenant's Azure estate; throws for tenants the demo models without one. */
export function getManifestAzure(tenantId: string): ManifestAzureTenant & { azure: ManifestAzureEstate } {
  const tenant = getManifestTenant(tenantId);
  if (!tenant.azure) throw new Error(`Tenant '${tenantId}' has no Azure estate in demo-lab-manifest.json`);
  return tenant as ManifestAzureTenant & { azure: ManifestAzureEstate };
}

/* -------------------------------------------------------------------------- */
/* PowerShell 7 runner                                                         */
/* -------------------------------------------------------------------------- */

export type McpDataMode = "real-tenant" | "simulated-lab";

let runtimeDataModeOverride: McpDataMode | null = null;

export function getMcpDataMode(): McpDataMode {
  if (runtimeDataModeOverride) return runtimeDataModeOverride;
  const envMode = (process.env.CTX_DATA_MODE ?? "").toLowerCase();
  if (envMode === "real-tenant" || envMode === "real") return "real-tenant";
  if (envMode === "simulated-lab" || envMode === "simulated") return "simulated-lab";
  return /^(true|1|yes)$/i.test(process.env.LIVE_CLOUD_MODE ?? "") ? "real-tenant" : "simulated-lab";
}

export function setMcpDataMode(mode: McpDataMode): McpDataMode {
  runtimeDataModeOverride = mode;
  process.env.CTX_DATA_MODE = mode;
  process.env.LIVE_CLOUD_MODE = mode === "real-tenant" ? "true" : "false";
  return runtimeDataModeOverride;
}

export function isStrictRealTenantMode(): boolean {
  return runtimeDataModeOverride === "real-tenant" || /^(real-tenant|real)$/i.test(process.env.CTX_DATA_MODE ?? "");
}

export function isLiveCloudMode(): boolean {
  if (runtimeDataModeOverride) return runtimeDataModeOverride === "real-tenant";
  return /^(true|1|yes)$/i.test(process.env.LIVE_CLOUD_MODE ?? "");
}

let pwshAvailable: boolean | null = null;

export async function isPwshAvailable(): Promise<boolean> {
  if (pwshAvailable !== null) return pwshAvailable;
  try {
    const out = await runPwshRaw("$PSVersionTable.PSVersion.Major", 15_000);
    pwshAvailable = Number.parseInt(out.trim(), 10) >= 7;
  } catch {
    pwshAvailable = false;
  }
  return pwshAvailable;
}

export function runPwshRaw(script: string, timeoutMs = 30_000): Promise<string> {
  if (/^(true|1|yes)$/i.test(process.env.CTX_SKIP_PWSH ?? "")) {
    return Promise.reject(new Error("pwsh skipped via CTX_SKIP_PWSH=true"));
  }
  // pwsh silently drops multi-line blocks fed through `-Command -`; a temp runner file is reliable.
  const dir = mkdtempSync(join(tmpdir(), "ctx-pwsh-"));
  const runner = join(dir, "runner.ps1");
  writeFileSync(runner, "$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n" + script + "\n", "utf8");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-NoLogo", "-File", runner], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      cleanup();
      reject(new Error(`pwsh timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(`failed to start pwsh: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`pwsh exited with code ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
}

export async function runPwshJson<T>(script: string, timeoutMs?: number): Promise<T> {
  const out = (await runPwshRaw(script, timeoutMs)).trim();
  const start = out.search(/[[{]/);
  if (start < 0) throw new Error(`pwsh produced no JSON output: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start)) as T;
}

export function psq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
