import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREFLIGHT_RULES, evaluatePreflightRules, isHardPreflightFinding, type VerificationStatus } from "@contextpane/catalog";
import { applyWhatIfGate, checkPowerShellAst, mutatingCommandsIn } from "./local.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");

function status(verdict: VerificationStatus["verdict"] = "Verified Safe"): VerificationStatus {
  return { verdict, astCheckPassed: true, terraformFmtPassed: null, terraformValidatePassed: null, sandboxProvider: "local-pwsh", validationLatencyMs: 1, whatIfSafe: null, findings: [] };
}

const GUARDED = [
  "#Requires -Version 7.0",
  "[CmdletBinding(SupportsShouldProcess = $true)]",
  "param([string]$VaultName = 'kv-contoso-fin-02')",
  "if ($PSCmdlet.ShouldProcess($VaultName, 'Grant get,list')) {",
  "  Set-AzKeyVaultAccessPolicy -VaultName $VaultName -UserPrincipalName 'a@contoso.test' -PermissionsToSecrets get,list",
  "}",
].join("\n");

describe("shared pre-flight rules (review item 1)", () => {
  test("a command outside the allow-list, a forbidden command and a destructive wildcard are all hard failures", () => {
    const findings = evaluatePreflightRules(["Get-AzKeyVault", "Stop-AzVM", "Invoke-Expression"], "Remove-AzResource -Force", []);
    expect(findings).toContain("Verb outside allow-list: Stop-AzVM");
    expect(findings).toContain("Forbidden command: invoke-expression");
    expect(findings.some((f) => f.startsWith("Destructive wildcard"))).toBe(true);
    expect(findings.every(isHardPreflightFinding)).toBe(true);
    // A forbidden command is reported once, as forbidden, not again as outside the allow-list.
    expect(findings.filter((f) => /Invoke-Expression/i.test(f))).toHaveLength(1);
  });

  test("allow-listed verbs and the narrow command exceptions pass, case-insensitively", () => {
    expect(evaluatePreflightRules(["get-azkeyvault", "Remove-MgGroupMemberByRef", "Undo-AzKeyVaultRemoval"], "", ["undo-azkeyvaultremoval"])).toEqual([]);
  });

  test("a missing steered command is a hard failure", () => {
    const findings = evaluatePreflightRules(["Get-AzKeyVault"], "", ["undo-azkeyvaultremoval"]);
    expect(findings).toEqual(["Expected command missing: undo-azkeyvaultremoval"]);
    expect(isHardPreflightFinding(findings[0]!)).toBe(true);
  });

  test("the Modal sandbox reads the same rule file instead of its own lists", () => {
    const sandbox = readFileSync(join(REPO, "modal-sandbox", "contextpane_sandbox.py"), "utf8");
    expect(sandbox).toContain("preflight-rules.json");
    expect(sandbox).toContain('"Verb outside allow-list"');
    expect(sandbox).not.toMatch(/FORBIDDEN = \{"invoke-expression"/);
    const json = JSON.parse(readFileSync(join(REPO, "packages", "catalog", "src", "preflight-rules.json"), "utf8")) as typeof PREFLIGHT_RULES;
    expect(json.forbiddenCommands).toEqual(PREFLIGHT_RULES.forbiddenCommands);
    // Every pattern compiles; Python compiles the same strings with re.IGNORECASE.
    for (const p of json.destructivePatterns) expect(() => new RegExp(p, "i")).not.toThrow();
  });

  test("the local AST check fails a script that calls a command outside the allow-list", async () => {
    const script = `${GUARDED}\nStop-AzVM -Name vm-01 -ResourceGroupName rg-01 -Force\n`;
    const ast = await checkPowerShellAst(script, 30_000, []);
    // Without pwsh on the machine the check is skipped (null), never passed.
    if (ast.passed === null) return;
    expect(ast.passed).toBe(false);
    expect(ast.findings).toContain("Verb outside allow-list: Stop-AzVM");
  }, 40_000);
});

describe("-WhatIf gate (review item 2)", () => {
  test("an unguarded mutation fails the bundle", () => {
    const script = ["[CmdletBinding(SupportsShouldProcess = $true)]", "param()", "Set-AzKeyVaultAccessPolicy -VaultName kv -PermissionsToSecrets get"].join("\n");
    const v = applyWhatIfGate(status("Verified Safe"), script);
    expect(v.verdict).toBe("Verification Failed");
    expect(v.whatIfSafe).toBe(false);
    expect(v.findings.some((f) => f.startsWith("-WhatIf is not a full dry run"))).toBe(true);
  });

  test("a mutating script without SupportsShouldProcess fails, even after a passing sandbox", () => {
    const v = applyWhatIfGate(status("Verified With Warnings"), "Remove-MgGroupMemberByRef -GroupId g -DirectoryObjectId u");
    expect(v.verdict).toBe("Verification Failed");
  });

  test("a read-only script without the guard only warns", () => {
    const v = applyWhatIfGate(status("Verified Safe"), "Get-AzKeyVault -VaultName kv | Select-Object VaultName");
    expect(v.verdict).toBe("Verified With Warnings");
    expect(v.whatIfSafe).toBe(false);
  });

  test("a guarded script keeps its verdict", () => {
    const v = applyWhatIfGate(status("Verified Safe"), GUARDED);
    expect(v.verdict).toBe("Verified Safe");
    expect(v.whatIfSafe).toBe(true);
    expect(v.findings).toEqual([]);
  });

  test("mutating cmdlets in comments are not counted", () => {
    expect(mutatingCommandsIn("# Set-MgUserLicense -UserId x\n<#\nRemove-MgGroupMemberByRef\n#>\nGet-MgUser")).toEqual([]);
    expect(mutatingCommandsIn("Set-MgUserLicense -UserId x; New-AzRoleAssignment -ObjectId y")).toEqual(["Set-MgUserLicense", "New-AzRoleAssignment"]);
  });
});
