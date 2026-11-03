import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "diff";
import { evaluatePreflightRules, isHardPreflightFinding, type VerificationStatus } from "@contextpane/catalog";
import { config } from "../config.ts";
import { SURFACE_PS, executionSurfaceFindings, scanCommandsText, scanDefinedFunctionsText, scanExecutionSurfaceText, surfaceFromReport } from "./execution-surface.ts";

/**
 * Local pre-flight sandbox:
 *  - PowerShell AST parse via [System.Management.Automation.Language.Parser]::ParseFile
 *    plus the shared rule set (packages/catalog/src/preflight-rules.json, also enforced by the
 *    Modal sandbox): a command outside the allow-list, a privileged command outside the steered
 *    contract, a forbidden command or a destructive wildcard fails the bundle
 *  - no pwsh, a timeout or a runner crash fails the bundle too ("Verification Failed"): the rules
 *    still run on a text scan so the operator sees what they found, and Override (with a
 *    justification) is the only way past a pre-flight that did not run
 *  - Terraform: apply the unified diff to the live-state render, confirm it
 *    reproduces the baseline, then `terraform fmt -check` and `terraform validate`
 */

export interface PreflightInput {
  powershellScript: string;
  /** Empty when the fix has no IaC part; the Terraform checks are then not applicable (null). */
  terraformDiff: string;
  /** Cmdlets the script must contain (lower-case); defaults to set-mguserlicense. */
  requiredCommands?: string[];
  /**
   * The bundle's steered contract beyond `requiredCommands`: commands the scenario or strategy may use
   * (e.g. Remove-AzKeyVault for purge-recreate). Computed by the orchestrator, never by the coder.
   */
  allowedCommands?: string[];
  /** AST runner budget (default 20 s). */
  astTimeoutMs?: number;
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

const DEFAULT_REQUIRED_COMMANDS = ["set-mguserlicense"];

/** The finding a bundle carries when no PowerShell AST check ran; the verdict is then "Verification Failed". */
export const PREFLIGHT_NOT_RUN_FINDING = "PowerShell 7 not available: the AST check did not run. Install pwsh 7 or use Override with a justification.";

/**
 * Mutating cmdlets: each must run inside $PSCmdlet.ShouldProcess for -WhatIf to be a real dry run.
 * Graph and Az alike: ad-hoc tickets stage Key Vault / NSG / resource changes with Az cmdlets.
 */
const MUTATING = /\b(Set-Mg\w+|Update-Mg\w+|New-Mg\w+|Remove-Mg\w+|Add-Mg\w+|Invoke-MgLicenseUser|Sync-Mg\w+|Revoke-Mg\w+|Set-Az\w+|Update-Az\w+|New-Az\w+|Remove-Az\w+|Add-Az\w+|Undo-Az\w+|Restore-Az\w+|Invoke-MgGraphRequest|Invoke-AzRestMethod)\b/gi;

/** A raw REST call is a write unless it says `-Method GET` literally, wherever the parameter sits. */
const REST_CALL = /^invoke-(mggraphrequest|azrestmethod)$/i;
const LITERAL_GET = /-Method\s*:?\s*['"]?GET['"]?(?![\w-])/i;

/** The first mutating call on a line (raw REST calls count unless they are a literal GET). */
function mutatingCallOn(line: string): { name: string; index: number } | null {
  for (const m of line.matchAll(MUTATING)) {
    const name = m[1]!;
    if (REST_CALL.test(name) && LITERAL_GET.test(line.slice(m.index ?? 0))) continue;
    return { name, index: m.index ?? 0 };
  }
  return null;
}

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
    const call = mutatingCallOn(line);
    if (call && guards.length === 0 && !(guardAt >= 0 && guardAt < call.index)) unguarded.push(call.name);
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

/** The mutating cmdlets a script calls outside comments (here-string bodies count as text, not calls, only if they are not Graph/Az cmdlets). */
export function mutatingCommandsIn(script: string): string[] {
  const found = new Set<string>();
  let inBlockComment = false;
  for (const raw of script.split("\n")) {
    if (inBlockComment || /^\s*<#/.test(raw)) {
      inBlockComment = !raw.includes("#>");
      continue;
    }
    if (/^\s*#/.test(raw)) continue;
    for (const m of raw.matchAll(MUTATING)) {
      if (REST_CALL.test(m[1]!) && LITERAL_GET.test(raw.slice(m.index ?? 0))) continue;
      found.add(m[1]!);
    }
  }
  return [...found];
}

/**
 * The -WhatIf gate, applied after either sandbox (review item 2). A script that mutates
 * anything must declare SupportsShouldProcess and run every mutation inside
 * $PSCmdlet.ShouldProcess, or the bundle fails: there is no approvable "With Warnings" for an
 * unguarded write. A read-only script without the guard only warns.
 */
export function applyWhatIfGate(verification: VerificationStatus, script: string): VerificationStatus {
  const whatIf = checkWhatIfSafety(script);
  verification.whatIfSafe = whatIf.safe;
  if (whatIf.safe) return verification;
  const mutating = mutatingCommandsIn(script);
  verification.findings.push(`-WhatIf is not a full dry run: ${whatIf.unguarded.join(", ")} outside $PSCmdlet.ShouldProcess`);
  if (mutating.length > 0) {
    verification.verdict = "Verification Failed";
  } else if (verification.verdict === "Verified Safe") {
    verification.verdict = "Verified With Warnings";
  }
  return verification;
}

interface AstReport {
  parseErrors: string[];
  commands: string[];
  supportsShouldProcess: boolean;
  /** Functions the script defines itself; calling them is allowed (their bodies are checked as code). */
  functions?: string[];
  /** .NET calls, dynamic invocations, aliases and REST targets (preflight/execution-surface.ts). */
  surface?: unknown;
}

export interface AstCheckResult {
  /** true: parsed and passed; false: a hard finding; null: no AST verdict (the bundle then fails). */
  passed: boolean | null;
  findings: string[];
  commands: string[];
  /** Whether a PowerShell AST parse actually ran. When false, the findings come from the text scan only. */
  ran: boolean;
}

/**
 * The shared rules over a text scan, for when no AST report exists (pwsh missing, a timeout, an older
 * sandbox). The text scan is approximate; the bundle fails anyway, this only tells the operator why.
 */
export function textScanFindings(script: string, requiredCommands: string[], allowedCommands: string[] = []): string[] {
  const commands = scanCommandsText(script);
  return [
    ...evaluatePreflightRules(commands, script, requiredCommands, { allow: allowedCommands, definedFunctions: scanDefinedFunctionsText(script) }),
    ...executionSurfaceCheck(script),
  ];
}

/**
 * Execution-surface findings (item 12): .NET calls, runtime script blocks, dot-sourcing, aliases and
 * REST targets outside the allow-list. Uses the AST report when there is one, the text scan otherwise.
 */
export function executionSurfaceCheck(script: string, report?: Pick<AstReport, "commands" | "surface"> | null): string[] {
  const surface = report ? surfaceFromReport(report.surface, script) : scanExecutionSurfaceText(script);
  const commands = report ? report.commands : scanCommandsText(script);
  return executionSurfaceFindings(surface, commands);
}

export async function checkPowerShellAst(script: string, timeoutMs = 20_000, requiredCommands = DEFAULT_REQUIRED_COMMANDS, allowedCommands: string[] = []): Promise<AstCheckResult> {
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
  $functions = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name } | Select-Object -Unique)
${SURFACE_PS}
  [pscustomobject]@{
    parseErrors = @($errors | ForEach-Object { "$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Message)" })
    commands = @($commands)
    functions = @($functions)
    supportsShouldProcess = [bool]($attrs | Where-Object { $_ -match 'SupportsShouldProcess' })
    surface = $surface
  } | ConvertTo-Json -Depth 6 -Compress
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
    // No AST: the bundle fails (runLocalPreflight), and the text scan still reports what the rules see.
    if (result.timedOut) return notRun("PowerShell AST check timed out", script, requiredCommands, allowedCommands);
    if (result.code !== 0 && !result.stdout.trim()) {
      return notRun(`pwsh unavailable or failed: ${(result.stderr || "no output").trim().slice(0, 200)}`, script, requiredCommands, allowedCommands);
    }
    const start = result.stdout.indexOf("{");
    const report = JSON.parse(result.stdout.slice(start)) as AstReport;
    const findings: string[] = [];
    for (const e of report.parseErrors) findings.push(`AST parse error: ${e}`);
    findings.push(...evaluatePreflightRules(report.commands, script, requiredCommands, { allow: allowedCommands, definedFunctions: report.functions ?? [] }));
    if (!report.supportsShouldProcess) findings.push("Script does not declare SupportsShouldProcess (-WhatIf unsupported)");
    const openBraces = (script.match(/\{/g) ?? []).length;
    const closeBraces = (script.match(/\}/g) ?? []).length;
    if (openBraces !== closeBraces) {
      findings.push(`Unbalanced braces in PowerShell script ({=${openBraces}, }=${closeBraces})`);
    }
    if (/\bparam\s*\([^)]*=\s*""\s*\)/i.test(script)) {
      findings.push("Empty target parameter default detected in param() block");
    }
    // Allow-list, forbidden commands, missing steered commands, destructive wildcards and execution-surface rules all fail the bundle.
    const surfaceFindings = executionSurfaceCheck(script, report);
    findings.push(...surfaceFindings);
    const passed = report.parseErrors.length === 0 && openBraces === closeBraces && !findings.some(isHardPreflightFinding) && surfaceFindings.length === 0;
    return { passed, findings, commands: report.commands, ran: true };
  } catch (error) {
    return notRun(`AST check could not run: ${error instanceof Error ? error.message : String(error)}`, script, requiredCommands, allowedCommands);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function notRun(reason: string, script: string, requiredCommands: string[], allowedCommands: string[]): AstCheckResult {
  const scanned = textScanFindings(script, requiredCommands, allowedCommands);
  return { passed: scanned.some(isHardPreflightFinding) ? false : null, findings: [reason, ...scanned.map((f) => `${f} (text scan)`)], commands: scanCommandsText(script), ran: false };
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
  const [ast, tf] = await Promise.all([checkPowerShellAst(input.powershellScript, input.astTimeoutMs ?? 20_000, input.requiredCommands, input.allowedCommands ?? []), checkTerraform(input)]);
  // No AST verdict is a failed pre-flight, never an approvable warning: Override is the only way past it.
  const findings = [...(ast.ran ? [] : [PREFLIGHT_NOT_RUN_FINDING]), ...ast.findings, ...tf.findings];
  const hardFail = !ast.ran || ast.passed !== true || tf.fmtPassed === false || tf.validatePassed === false;
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
