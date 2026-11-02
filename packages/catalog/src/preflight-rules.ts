import rules from "./preflight-rules.json";

/**
 * The pre-flight rule set both sandboxes enforce (review item 1): the local pwsh pre-flight
 * reads it from here, the Modal sandbox reads the same JSON file inside its image. Every rule
 * is a hard failure: a command outside the allow-list, a forbidden command or a destructive
 * wildcard fails the bundle, it never only warns.
 */
export interface PreflightRules {
  allowedVerbs: string[];
  allowedCommands: string[];
  forbiddenCommands: string[];
  destructivePatterns: string[];
}

export const PREFLIGHT_RULES: PreflightRules = {
  allowedVerbs: rules.allowedVerbs,
  allowedCommands: rules.allowedCommands,
  forbiddenCommands: rules.forbiddenCommands,
  destructivePatterns: rules.destructivePatterns,
};

/** Finding prefixes that fail the bundle in either sandbox. */
export const PREFLIGHT_HARD_FAIL_PREFIXES = ["Forbidden command", "Expected command missing", "Destructive wildcard", "Verb outside allow-list"] as const;

const ALLOWED_VERBS = new Set(PREFLIGHT_RULES.allowedVerbs.map((v) => v.toLowerCase()));
const ALLOWED_COMMANDS = new Set(PREFLIGHT_RULES.allowedCommands);
const DESTRUCTIVE = PREFLIGHT_RULES.destructivePatterns.map((p) => new RegExp(p, "i"));

/**
 * Findings for the commands an AST parse found and the script text, under the shared rules.
 * `required` is the steered contract (cmdlets the strategy needs), never the coder's own list.
 */
export function evaluatePreflightRules(commands: string[], script: string, required: string[]): string[] {
  const findings: string[] = [];
  const lower = commands.map((c) => c.toLowerCase());
  for (const forbidden of PREFLIGHT_RULES.forbiddenCommands) if (lower.includes(forbidden)) findings.push(`Forbidden command: ${forbidden}`);
  for (const cmd of required) if (!lower.includes(cmd.toLowerCase())) findings.push(`Expected command missing: ${cmd}`);
  for (const cmd of commands) {
    if (!cmd.includes("-")) continue;
    const verb = (cmd.split("-")[0] ?? cmd).toLowerCase();
    if (!ALLOWED_VERBS.has(verb) && !ALLOWED_COMMANDS.has(cmd.toLowerCase()) && !PREFLIGHT_RULES.forbiddenCommands.includes(cmd.toLowerCase())) findings.push(`Verb outside allow-list: ${cmd}`);
  }
  if (DESTRUCTIVE.some((re) => re.test(script))) findings.push("Destructive wildcard command detected (e.g. Remove-MgUser -All or unscoped Remove-AzResource -Force)");
  return findings;
}

export function isHardPreflightFinding(finding: string): boolean {
  return PREFLIGHT_HARD_FAIL_PREFIXES.some((p) => finding.startsWith(p));
}
