import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Minimal PowerShell 7 runner. The script is written to stdin (`-Command -`)
 * so no quoting is needed, and it must end by emitting a single JSON document.
 */

export interface PwshRunOptions {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export class PwshError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "PwshError";
  }
}

let pwshAvailable: boolean | null = null;

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

export async function isPwshAvailable(): Promise<boolean> {
  if (pwshAvailable !== null) return pwshAvailable;
  try {
    const out = await runPwshRaw("$PSVersionTable.PSVersion.Major", { timeoutMs: 15_000 });
    pwshAvailable = Number.parseInt(out.trim(), 10) >= 7;
  } catch {
    pwshAvailable = false;
  }
  return pwshAvailable;
}

export function runPwshRaw(script: string, options: PwshRunOptions = {}): Promise<string> {
  if (/^(true|1|yes)$/i.test(process.env.CTX_SKIP_PWSH ?? "")) {
    return Promise.reject(new PwshError("pwsh skipped via CTX_SKIP_PWSH=true", 1, ""));
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  // pwsh silently drops multi-line blocks fed through `-Command -`; a temp runner file is reliable.
  const dir = mkdtempSync(join(tmpdir(), "ctx-pwsh-"));
  const runner = join(dir, "runner.ps1");
  writeFileSync(runner, "$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n" + script + "\n", "utf8");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-NoLogo", "-File", runner], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new PwshError(`pwsh timed out after ${timeoutMs}ms`, null, stderr));
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
      reject(new PwshError(`failed to start pwsh: ${err.message}`, null, stderr));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code === 0) resolvePromise(stdout);
      else reject(new PwshError(`pwsh exited with code ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`, code, stderr));
    });
  });
}

/** Run a script whose final statement pipes to ConvertTo-Json, and parse the result. */
export async function runPwshJson<T>(script: string, options: PwshRunOptions = {}): Promise<T> {
  const out = await runPwshRaw(script, options);
  const trimmed = out.trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) throw new PwshError(`pwsh produced no JSON output: ${trimmed.slice(0, 200)}`, 0, "");
  return JSON.parse(trimmed.slice(start)) as T;
}

/** Escape a string literal for use inside PowerShell single quotes. */
export function psq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
