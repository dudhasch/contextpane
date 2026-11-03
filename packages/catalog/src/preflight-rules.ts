import rules from "./preflight-rules.json";

/**
 * The pre-flight rule set both sandboxes enforce: the local pwsh pre-flight reads it from here,
 * the Modal sandbox reads the same JSON file inside its image. Every rule is a hard failure.
 *
 * A command passes only when one of these holds:
 *  - its verb is read-only (`readOnlyVerbs`: Get, Select, Where, ForEach, …);
 *  - it is in `allowedCommands` (scoped, non-privileged writes and output cmdlets);
 *  - the bundle's steered contract allows it (`allow`: the scenario's or strategy's commands,
 *    computed by the orchestrator from the steering, never the coder's own list);
 *  - the script itself defines it as a function (its body is checked like any other code).
 * Commands without a hyphen (native binaries such as pwsh, az, bash, curl) fail unless they are
 * harmless pipeline aliases. `privilegedPatterns` (role grants, credentials, app permissions,
 * code execution on VMs or devices, CA policy writes, Import-Module) are never in `allowedCommands`
 * and pass only through a steered contract.
 */
export interface PreflightRules {
  readOnlyVerbs: string[];
  allowedCommands: string[];
  privilegedPatterns: string[];
  /** What the repository's own inverse rollbacks use; never allowed in a forward bundle. */
  inverseCommands: string[];
  harmlessAliases: string[];
  forbiddenCommands: string[];
  /** Script patterns that fail whatever command carries them: a password reset or disabling a policy. */
  forbiddenPatterns: string[];
  destructivePatterns: string[];
  /** Commands that run code, open sessions or rebind the Az context; enforced by the execution-surface rules. */
  deniedExecutionCommands: string[];
}

export const PREFLIGHT_RULES: PreflightRules = {
  readOnlyVerbs: rules.readOnlyVerbs,
  allowedCommands: rules.allowedCommands,
  privilegedPatterns: rules.privilegedPatterns,
  inverseCommands: rules.inverseCommands,
  harmlessAliases: rules.harmlessAliases,
  forbiddenCommands: rules.forbiddenCommands,
  forbiddenPatterns: rules.forbiddenPatterns,
  destructivePatterns: rules.destructivePatterns,
  deniedExecutionCommands: rules.deniedExecutionCommands,
};

/** Finding prefixes that fail the bundle in either sandbox. */
/** "Execution surface:" findings come from apps/orchestrator/src/preflight/execution-surface.ts, applied to either sandbox's AST report. */
export const PREFLIGHT_HARD_FAIL_PREFIXES = [
  "Forbidden command",
  "Expected command missing",
  "Destructive wildcard",
  "Command outside allow-list",
  "Privileged command",
  "PowerShell 7 not available",
  "Execution surface:",
] as const;

const READ_ONLY_VERBS = new Set(PREFLIGHT_RULES.readOnlyVerbs.map((v) => v.toLowerCase()));
const ALLOWED_COMMANDS = new Set(PREFLIGHT_RULES.allowedCommands);
const HARMLESS_ALIASES = new Set(PREFLIGHT_RULES.harmlessAliases);
const FORBIDDEN = new Set(PREFLIGHT_RULES.forbiddenCommands);
const DESTRUCTIVE = PREFLIGHT_RULES.destructivePatterns.map((p) => new RegExp(p, "i"));
const FORBIDDEN_PATTERNS = PREFLIGHT_RULES.forbiddenPatterns.map((p) => new RegExp(p, "i"));
const PRIVILEGED = PREFLIGHT_RULES.privilegedPatterns.map((p) => new RegExp(p, "i"));
/** Reported by the execution-surface rules instead (one finding per command, not two). */
const DENIED_EXECUTION = new Set(PREFLIGHT_RULES.deniedExecutionCommands);

export function isPrivilegedCommand(command: string): boolean {
  return PRIVILEGED.some((re) => re.test(command));
}

export interface PreflightRuleOptions {
  /** Extra commands this bundle may use: its steered contract (required commands included automatically). */
  allow?: string[];
  /** Functions the script defines itself (`function Get-GroupByName { … }`); calling them is allowed. */
  definedFunctions?: string[];
}

/**
 * Findings for the commands an AST parse (or the text fallback) found and the script text, under the
 * shared rules. `required` is the steered contract (cmdlets the strategy needs), never the coder's own list.
 */
export function evaluatePreflightRules(commands: string[], script: string, required: string[], options: PreflightRuleOptions = {}): string[] {
  const findings: string[] = [];
  const lower = [...new Set(commands.map((c) => c.toLowerCase()))];
  const allow = new Set([...required, ...(options.allow ?? [])].map((c) => c.toLowerCase()));
  const defined = new Set((options.definedFunctions ?? []).map((c) => c.toLowerCase()));
  for (const forbidden of PREFLIGHT_RULES.forbiddenCommands) if (lower.includes(forbidden)) findings.push(`Forbidden command: ${forbidden}`);
  for (const cmd of required) if (!lower.includes(cmd.toLowerCase())) findings.push(`Expected command missing: ${cmd}`);
  for (const cmd of [...new Set(commands)]) {
    const c = cmd.toLowerCase();
    if (FORBIDDEN.has(c) || DENIED_EXECUTION.has(c) || allow.has(c) || defined.has(c)) continue;
    if (!c.includes("-")) {
      if (!HARMLESS_ALIASES.has(c)) findings.push(`Command outside allow-list: ${cmd} (native command or alias; use an allow-listed cmdlet)`);
      continue;
    }
    if (ALLOWED_COMMANDS.has(c)) continue;
    if (isPrivilegedCommand(c)) {
      findings.push(`Privileged command outside the steered contract: ${cmd}`);
      continue;
    }
    if (READ_ONLY_VERBS.has(c.split("-")[0]!)) continue;
    findings.push(`Command outside allow-list: ${cmd}`);
  }
  for (const re of FORBIDDEN_PATTERNS) if (re.test(script)) findings.push(`Forbidden command: password or policy-disable pattern /${re.source}/`);
  if (DESTRUCTIVE.some((re) => re.test(script))) findings.push("Destructive wildcard command detected (e.g. Remove-MgUser -All or unscoped Remove-AzResource -Force)");
  return findings;
}

export function isHardPreflightFinding(finding: string): boolean {
  return PREFLIGHT_HARD_FAIL_PREFIXES.some((p) => finding.startsWith(p));
}
