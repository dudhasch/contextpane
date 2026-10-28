import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "diff";
import type { VerificationStatus } from "@contextpane/catalog";
import { config } from "../config.ts";

/**
 * Local pre-flight sandbox:
 *  - PowerShell AST parse via [System.Management.Automation.Language.Parser]::ParseFile
 *    plus a cmdlet allow-list (Microsoft.Graph only, no Remove-x or Invoke-Expression)
 *  - Terraform: apply the unified diff to the live-state render, confirm it
 *    reproduces the baseline, then `terraform fmt -check` and `terraform validate`
 */

export interface PreflightInput {
  powershellScript: string;
  /** Empty when the fix has no IaC part; the Terraform checks are then not applicable (null). */
  terraformDiff: string;
  /** Cmdlets the script must contain (lower-case); defaults to set-mguserlicense. */
  requiredCommands?: string[];
  /** Rendered live state the diff must apply to */
  actualHcl: string;
  /** Rendered baseline the patched result must equal */
  expectedHcl: string;
}

interface Exec {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function exec(command: string, args: string[], options: { cwd?: string; timeoutMs: number; stdin?: string; env?: Record<string, string> }): Promise<Exec> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, env: { ...process.env, ...options.env } });
    } catch (error) {
      resolvePromise({ code: null, stdout: "", stderr: String(error), timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => (stdout += d));
    child.stderr?.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: stderr + err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
    if (options.stdin !== undefined) child.stdin?.write(options.stdin);
    child.stdin?.end();
  });
}

const ALLOWED_VERBS = new Set([
  "Get",
  "Set",
  "Update",
  "New",
  "Add",
  "Connect",
  "Select",
  "Where",
  "ForEach",
  "Write",
  "Out",
  "Test",
  "ConvertTo",
  "ConvertFrom",
  "Format",
  "Measure",
  "Sort",
  "Group",
  "Start",
  "Import",
  "Compare",
  "Join",
  "Split",
  "Undo",
  "Restore",
  "Enable",
  "Disable",
  "Sync",
  "Invoke",
  "Revoke",
]);
/** Narrow exceptions to the verb allow-list: each is a scoped, reversible Graph or Az operation. */
const ALLOWED_COMMANDS = new Set([
  "remove-mggroupmemberbyref",
  "new-mggroupmemberbyref",
  "invoke-mglicenseuser",
  "invoke-mggraphrequest",
  "sync-mgdevicemanagementmanageddevice",
  "new-mgbetadevicemanagementdevicehealthscript",
  "new-mgsitepermission",
  "remove-mgapplicationownerbyref",
  "remove-mgoauth2permissiongrant",
  "remove-mgserviceprincipalapproleassignment",
  "remove-mgapplicationpassword",
  "remove-mgapplicationfederatedidentitycredential",
  "remove-azkeyvault",
  "remove-aznetworksecurityruleconfig",
]);
const FORBIDDEN_COMMANDS = ["invoke-expression", "iex", "remove-mguser", "remove-mggroup", "remove-azresourcegroup", "remove-item", "start-process", "invoke-webrequest", "invoke-restmethod", "set-executionpolicy"];
const DESTRUCTIVE_WILDCARD_RE = /\bRemove-MgUser\s+-All\b|\bRemove-AzResource\b(?![^\n]*-(?:ResourceId|Name|ResourceName))\s+-Force\b|\bFormat-Volume\s+-Force\b/i;
const DEFAULT_REQUIRED_COMMANDS = ["set-mguserlicense"];

/** Mutating cmdlets: each must run inside $PSCmdlet.ShouldProcess for -WhatIf to be a real dry run. */
const MUTATING = /\b(Set-Mg\w+|Update-Mg\w+|New-Mg\w+|Remove-Mg\w+|Add-Mg\w+|Invoke-MgLicenseUser|Sync-Mg\w+|Invoke-MgGraphRequest\s+-Method\s+'?(POST|PATCH|PUT|DELETE))/i;

/**
 * Static -WhatIf proof: the script declares SupportsShouldProcess and every mutating Graph
 * call sits inside an `if ($PSCmdlet.ShouldProcess(...)) { ... }` block (brace-tracked).
 */
export function checkWhatIfSafety(script: string): { safe: boolean; unguarded: string[] } {
  if (!/SupportsShouldProcess/.test(script)) return { safe: false, unguarded: ["SupportsShouldProcess not declared"] };
  const unguarded: string[] = [];
  const guards: number[] = [];
  let depth = 0;
  let inBlockComment = false;
  for (const raw of script.split("\n")) {
    // Skip <# ... #> help blocks and whole-line comments; a '#' inside a string ('#microsoft.graph...') is code.
    if (inBlockComment || /^\s*<#/.test(raw)) {
      inBlockComment = !raw.includes("#>");
      continue;
    }
    if (/^\s*#/.test(raw)) continue;
    const line = raw;
    const guardAt = line.search(/\$PSCmdlet\.ShouldProcess\(/);
    const call = MUTATING.exec(line);
    if (call && guards.length === 0 && !(guardAt >= 0 && guardAt < (call.index ?? 0))) unguarded.push(call[1]!);
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        if (guardAt >= 0 && guards.at(-1) !== depth) guards.push(depth);
      } else if (ch === "}") {
        if (guards.at(-1) === depth) guards.pop();
        depth--;
      }
    }
  }
  return { safe: unguarded.length === 0, unguarded: [...new Set(unguarded)] };
}

interface AstReport {
  parseErrors: string[];
  commands: string[];
  supportsShouldProcess: boolean;
}

export async function checkPowerShellAst(script: string, timeoutMs = 20_000, requiredCommands = DEFAULT_REQUIRED_COMMANDS): Promise<{ passed: boolean | null; findings: string[]; commands: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "ctx-preflight-"));
  const file = join(dir, "remediation.ps1");
  writeFileSync(file, script, "utf8");
  const psPath = `'${file.replace(/'/g, "''")}'`;
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile(${psPath}, [ref]$tokens, [ref]$errors)
  $commands = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Select-Object -Unique)
  $attrs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AttributeAst] }, $true) | ForEach-Object { $_.Extent.Text })
  [pscustomobject]@{
    parseErrors = @($errors | ForEach-Object { "$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Message)" })
    commands = @($commands)
    supportsShouldProcess = [bool]($attrs | Where-Object { $_ -match 'SupportsShouldProcess' })
  } | ConvertTo-Json -Depth 4 -Compress
} catch {
  [pscustomobject]@{ parseErrors = @("AST runner failed: $($_.Exception.Message)"); commands = @(); supportsShouldProcess = $false } | ConvertTo-Json -Depth 4 -Compress
  exit 1
}
`;
  try {
    // pwsh swallows multi-line blocks when fed via `-Command -`; a runner file is reliable.
    const runner = join(dir, "ast-runner.ps1");
    writeFileSync(runner, ps, "utf8");
    const result = await exec("pwsh", ["-NoProfile", "-NonInteractive", "-NoLogo", "-File", runner], { timeoutMs });
    if (result.timedOut) return { passed: null, findings: ["PowerShell AST check timed out"], commands: [] };
    if (result.code !== 0 && !result.stdout.trim()) {
      return { passed: null, findings: [`pwsh unavailable or failed: ${(result.stderr || "no output").trim().slice(0, 200)}`], commands: [] };
    }
    const start = result.stdout.indexOf("{");
    const report = JSON.parse(result.stdout.slice(start)) as AstReport;
    const findings: string[] = [];
    for (const e of report.parseErrors) findings.push(`AST parse error: ${e}`);
    const lower = report.commands.map((c) => c.toLowerCase());
    for (const forbidden of FORBIDDEN_COMMANDS) if (lower.includes(forbidden)) findings.push(`Forbidden command: ${forbidden}`);
    for (const required of requiredCommands) if (!lower.includes(required.toLowerCase())) findings.push(`Expected command missing: ${required}`);
    for (const cmd of report.commands) {
      const verb = cmd.split("-")[0] ?? cmd;
      if (cmd.includes("-") && !ALLOWED_VERBS.has(verb) && !ALLOWED_COMMANDS.has(cmd.toLowerCase())) findings.push(`Verb outside allow-list: ${cmd}`);
    }
    if (!report.supportsShouldProcess) findings.push("Script does not declare SupportsShouldProcess (-WhatIf unsupported)");
    const openBraces = (script.match(/\{/g) ?? []).length;
    const closeBraces = (script.match(/\}/g) ?? []).length;
    if (openBraces !== closeBraces) {
      findings.push(`Unbalanced braces in PowerShell script ({=${openBraces}, }=${closeBraces})`);
    }
    if (DESTRUCTIVE_WILDCARD_RE.test(script)) {
      findings.push("Destructive wildcard command detected (e.g. Remove-MgUser -All or unscoped Remove-AzResource -Force)");
    }
    if (/\bparam\s*\([^)]*=\s*""\s*\)/i.test(script)) {
      findings.push("Empty target parameter default detected in param() block");
    }
    const passed =
      report.parseErrors.length === 0 &&
      openBraces === closeBraces &&
      !DESTRUCTIVE_WILDCARD_RE.test(script) &&
      !findings.some((f) => f.startsWith("Forbidden") || f.startsWith("Expected command missing") || f.startsWith("Destructive wildcard"));
    return { passed, findings, commands: report.commands };
  } catch (error) {
    return { passed: null, findings: [`AST check could not run: ${error instanceof Error ? error.message : String(error)}`], commands: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function checkTerraform(
  input: Pick<PreflightInput, "terraformDiff" | "actualHcl" | "expectedHcl">,
  timeoutMs = 25_000,
): Promise<{ fmtPassed: boolean | null; validatePassed: boolean | null; findings: string[] }> {
  const findings: string[] = [];
  if (!input.terraformDiff.trim()) return { fmtPassed: null, validatePassed: null, findings };
  let patched: string | false = false;
  try {
    patched = applyPatch(input.actualHcl, input.terraformDiff);
  } catch (error) {
    findings.push(`Diff could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (patched === false) {
    findings.push("Unified diff does not apply cleanly to the live NSG state");
    return { fmtPassed: false, validatePassed: null, findings };
  }
  if (patched.trim() !== input.expectedHcl.trim()) {
    findings.push("Patched state differs from the Terraform baseline (diff drifted from source of truth)");
  }

  // Persistent validation workspace: `terraform init` runs once per machine (provider download),
  // every later pre-flight only rewrites main.tf and runs fmt + validate (~1 s).
  const dir = join(config.stagingDir, "..", "tf-validate");
  mkdirSync(dir, { recursive: true });
  const cacheDir = join(config.stagingDir, "..", "tf-plugin-cache");
  mkdirSync(cacheDir, { recursive: true });
  const tfEnv = { TF_PLUGIN_CACHE_DIR: cacheDir, TF_IN_AUTOMATION: "1" };

  writeFileSync(
    join(dir, "versions.tf"),
    'terraform {\n  required_providers {\n    azurerm = {\n      source  = "hashicorp/azurerm"\n      version = "~> 4.0"\n    }\n  }\n}\n\nprovider "azurerm" {\n  features {}\n}\n',
    "utf8",
  );
  writeFileSync(join(dir, "main.tf"), patched, "utf8");

  const fmt = await exec("terraform", ["fmt", "-check", "-diff", "-no-color", "main.tf"], { cwd: dir, timeoutMs, env: tfEnv });
  if (fmt.code === null && !fmt.timedOut) {
    findings.push(`terraform not available: ${fmt.stderr.trim().slice(0, 120) || "binary not found"}`);
    return { fmtPassed: null, validatePassed: null, findings };
  }
  const fmtPassed = fmt.code === 0;
  if (!fmtPassed) findings.push(`terraform fmt reported formatting differences${fmt.stdout ? `: ${fmt.stdout.trim().split("\n")[0]}` : ""}`);

  if (!existsSync(join(dir, ".terraform"))) {
    // validate needs provider schemas; init may be offline — treat that as "skipped", not failed.
    const init = await exec("terraform", ["init", "-backend=false", "-input=false", "-no-color"], { cwd: dir, timeoutMs: Math.max(timeoutMs, 120_000), env: tfEnv });
    if (init.code !== 0) {
      rmSync(join(dir, ".terraform"), { recursive: true, force: true });
      findings.push(`terraform validate skipped (init failed, likely offline): ${init.stderr.trim().split("\n")[0]?.slice(0, 120) ?? ""}`);
      return { fmtPassed, validatePassed: null, findings };
    }
  }
  const validate = await exec("terraform", ["validate", "-no-color"], { cwd: dir, timeoutMs, env: tfEnv });
  const validatePassed = validate.code === 0;
  if (!validatePassed) findings.push(`terraform validate: ${(validate.stderr || validate.stdout).trim().split("\n").slice(0, 2).join(" ")}`);
  return { fmtPassed, validatePassed, findings };
}

export async function runLocalPreflight(input: PreflightInput): Promise<VerificationStatus> {
  const started = performance.now();
  const [ast, tf] = await Promise.all([checkPowerShellAst(input.powershellScript, 20_000, input.requiredCommands), checkTerraform(input)]);
  const findings = [...ast.findings, ...tf.findings];
  const hardFail = ast.passed === false || tf.fmtPassed === false || tf.validatePassed === false;
  // A fix without an IaC part has no Terraform checks to skip.
  const hasIac = input.terraformDiff.trim() !== "";
  const skipped = ast.passed === null || (hasIac && (tf.fmtPassed === null || tf.validatePassed === null));
  return {
    verdict: hardFail ? "Verification Failed" : skipped || findings.length ? "Verified With Warnings" : "Verified Safe",
    astCheckPassed: ast.passed,
    terraformFmtPassed: tf.fmtPassed,
    terraformValidatePassed: tf.validatePassed,
    sandboxProvider: "local-pwsh",
    whatIfSafe: null,
    validationLatencyMs: Math.round(performance.now() - started),
    findings,
  };
}
