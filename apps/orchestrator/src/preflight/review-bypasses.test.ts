import { describe, expect, test } from "bun:test";
import { PREFLIGHT_RULES, evaluatePreflightRules, isHardPreflightFinding, isPrivilegedCommand } from "@contextpane/catalog";
import { checkWhatIfSafety, executionSurfaceCheck, mutatingCommandsIn, runLocalPreflight, textScanFindings, PREFLIGHT_NOT_RUN_FINDING } from "./local.ts";
import { scanCommandsText, scanDefinedFunctionsText, scanExecutionSurfaceText } from "./execution-surface.ts";

/**
 * The bypasses the independent review found (C1, C2, H1), each as a test. The rule half runs on
 * command names, so it needs no pwsh; the AST half of the same rules runs in the pwsh-gated tests.
 */
const HEADER = "#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam()\n";
const guarded = (line: string) => `${HEADER}if ($PSCmdlet.ShouldProcess('x', 'y')) {\n  ${line}\n}\n`;
const hard = (commands: string[], script = "", required: string[] = [], allow: string[] = []) =>
  evaluatePreflightRules(commands, script, required, { allow }).filter(isHardPreflightFinding);

describe("C1: a real command allow-list, not a verb list", () => {
  test("privileged cmdlets on old allowed verbs fail", () => {
    for (const cmd of [
      "New-MgDirectoryRoleMemberByRef",
      "New-MgRoleManagementDirectoryRoleAssignment",
      "Update-MgUser",
      "New-AzRoleAssignment",
      "Invoke-AzVMRunCommand",
      "Import-Module",
      "Update-MgIdentityConditionalAccessPolicy",
      "New-MgApplicationPassword",
      "Remove-AzKeyVault",
    ]) {
      const f = hard([cmd]);
      expect({ cmd, failed: f.length > 0 }).toEqual({ cmd, failed: true });
    }
  });

  test("any other non-read-only verb fails unless it is listed", () => {
    expect(hard(["Set-Content"])).toEqual(["Command outside allow-list: Set-Content"]);
    expect(hard(["Start-Service", "Enable-AzureADUser", "Restore-AzKeyVault", "Add-AzADAppPermission"])).toHaveLength(4);
  });

  test("hyphen-less native commands fail; harmless pipeline aliases pass", () => {
    for (const cmd of ["pwsh", "az", "bash", "curl", "cmd"]) expect(hard([cmd])[0]).toStartWith(`Command outside allow-list: ${cmd}`);
    expect(hard(["%", "?", "foreach"])).toEqual([]);
  });

  test("read-only verbs, the listed writes and script-defined functions pass", () => {
    expect(hard(["Get-MgUser", "Select-Object", "Where-Object", "ForEach-Object", "ConvertTo-Json", "Write-Output", "Out-Null", "Set-MgUserLicense", "Remove-MgGroupMemberByRef"])).toEqual([]);
    expect(evaluatePreflightRules(["Sync-DeviceByName"], "", [], { definedFunctions: ["Sync-DeviceByName"] })).toEqual([]);
  });

  test("a privileged command passes only through the steered contract", () => {
    expect(hard(["New-AzRoleAssignment"], "", ["new-azroleassignment"])).toEqual([]);
    expect(hard(["Remove-AzKeyVault"], "", [], ["remove-azkeyvault"])).toEqual([]);
  });

  test("the rule file never allow-lists a privileged command", () => {
    expect(PREFLIGHT_RULES.allowedCommands.filter(isPrivilegedCommand)).toEqual([]);
    expect(PREFLIGHT_RULES.allowedCommands).not.toContain("remove-azkeyvault");
  });

  test("the review's verb-list bypasses are refused on the text scan too", () => {
    const scripts = [
      guarded("New-MgDirectoryRoleMemberByRef -DirectoryRoleId 62e90394 -OdataId 'https://graph.microsoft.com/v1.0/users/x'"),
      guarded("Update-MgUser -UserId x -PasswordProfile @{ Password = 'P@ss' }"),
      guarded("New-AzRoleAssignment -SignInName a@b.c -RoleDefinitionName Owner -Scope /subscriptions/x"),
      guarded("Invoke-AzVMRunCommand -ResourceGroupName rg -VMName vm -CommandId RunPowerShellScript -ScriptString 'whoami'"),
      `${HEADER}Set-Content x.psm1 'x'\nImport-Module ./x.psm1`,
      `${HEADER}pwsh -EncodedCommand ZQBjAGgAbwA=`,
      `${HEADER}az rest --method post --url https://graph.microsoft.com/v1.0/x`,
      `${HEADER}bash -c 'id'`,
    ];
    for (const s of scripts) expect({ s: s.split("\n").at(-2), failed: textScanFindings(s, []).some(isHardPreflightFinding) }).toEqual({ s: s.split("\n").at(-2), failed: true });
  });
});

describe("C2: no AST verdict fails the bundle", () => {
  test("a pre-flight whose AST check cannot run is Verification Failed, with the rules still reported", async () => {
    // A 1 ms budget times the runner out whether or not pwsh is installed.
    const v = await runLocalPreflight({ powershellScript: guarded("invoke-expression 'x'; remove-mguser -All"), terraformDiff: "", actualHcl: "", expectedHcl: "", requiredCommands: [], astTimeoutMs: 1 });
    expect(v.verdict).toBe("Verification Failed");
    expect(v.astCheckPassed).not.toBe(true);
    expect(v.findings[0]).toBe(PREFLIGHT_NOT_RUN_FINDING);
    // The text scan is case-insensitive now: lower-case forbidden commands are seen.
    expect(v.findings.some((f) => f.startsWith("Forbidden command: invoke-expression"))).toBe(true);
    expect(v.findings.some((f) => f.startsWith("Forbidden command: remove-mguser"))).toBe(true);
  });

  test("a clean script without an AST verdict still fails", async () => {
    const v = await runLocalPreflight({ powershellScript: guarded("Get-MgUser -Top 1"), terraformDiff: "", actualHcl: "", expectedHcl: "", requiredCommands: [], astTimeoutMs: 1 });
    expect(v.verdict).toBe("Verification Failed");
    expect(v.findings).toContain(PREFLIGHT_NOT_RUN_FINDING);
  });

  test("the text scan sees commands in any case, at command position only", () => {
    const commands = scanCommandsText("get-mguser -top 1 | where-object { $_.x }\n$x = REMOVE-MGUSER -UserId y\nWrite-Output 'group-based report-only'\naz account show");
    expect(commands).toEqual(expect.arrayContaining(["get-mguser", "where-object", "REMOVE-MGUSER", "Write-Output", "az"]));
    expect(commands).not.toContain("group-based");
    expect(scanDefinedFunctionsText("function Get-GroupByName { param($n) Get-MgGroup }\nfunction script:Sync-X {}")).toEqual(["Get-GroupByName", "Sync-X"]);
  });
});

describe("H1: execution-surface holes", () => {
  test("$ExecutionContext / InvokeScript / NewScriptBlock / Add-Member ScriptMethod are refused", () => {
    for (const line of [
      "$ExecutionContext.InvokeCommand.InvokeScript('Remove-MgUser -UserId x')",
      "$sb = $ExecutionContext.InvokeCommand.NewScriptBlock('Remove-MgUser -UserId x'); Get-MgUser | ForEach-Object -Process $sb",
      "$o = [pscustomobject]@{}; $o | Add-Member -MemberType ScriptMethod -Name Go -Value { Remove-MgUser -UserId x }; $o.Go()",
    ]) {
      const f = executionSurfaceCheck(`${HEADER}${line}\n`);
      expect({ line, failed: f.length > 0 }).toEqual({ line, failed: true });
    }
  });

  test("a raw REST call is a write unless -Method GET is literal, wherever -Method sits", () => {
    const patch = "Invoke-MgGraphRequest -Uri '/v1.0/users/x' -Method PATCH -Body @{ passwordProfile = @{ password = 'x' } }";
    expect(mutatingCommandsIn(patch)).toEqual(["Invoke-MgGraphRequest"]);
    expect(checkWhatIfSafety(`${HEADER}${patch}`).safe).toBe(false);
    expect(mutatingCommandsIn("Invoke-MgGraphRequest -Uri '/v1.0/users' -Method GET")).toEqual([]);
    expect(mutatingCommandsIn("Invoke-MgGraphRequest -Uri '/v1.0/users'")).toEqual(["Invoke-MgGraphRequest"]);
    // And the REST allow-list refuses PATCH /users wherever -Method sits.
    expect(executionSurfaceCheck(`${HEADER}${patch}`).some((f) => f.includes("PATCH on /users"))).toBe(true);
  });

  test("splatted REST parameters fail instead of reading as GET", () => {
    const s = scanExecutionSurfaceText("$p = @{ Method = 'PATCH'; Uri = '/v1.0/users/x' }\nInvoke-MgGraphRequest @p");
    expect(s.restCalls[0]?.splatted).toBe(true);
    expect(executionSurfaceCheck(`${HEADER}$p = @{ Method = 'PATCH'; Uri = '/v1.0/users/x' }\nInvoke-MgGraphRequest @p`).some((f) => f.includes("splatted"))).toBe(true);
  });

  test("ARM writes to VM run commands and extensions are refused", () => {
    const f = executionSurfaceCheck(`${HEADER}Invoke-AzRestMethod -Method POST -Path '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm/runCommand?api-version=2023-03-01'`);
    expect(f.some((x) => x.includes("runs code on a VM"))).toBe(true);
  });
});

describe("forbidden patterns: what an allowed command may not carry", () => {
  test("a password reset or a policy disable fails even on an allowed command", () => {
    expect(hard(["Update-MgUser"], "Update-MgUser -UserId x -PasswordProfile @{ Password = 'x' }", [], ["update-mguser"])[0]).toStartWith("Forbidden command: password");
    expect(hard(["Update-MgIdentityConditionalAccessPolicy"], "Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId p -State disabled", ["update-mgidentityconditionalaccesspolicy"])[0]).toStartWith("Forbidden command");
    expect(hard(["Update-MgUser"], "Update-MgUser -UserId x -UsageLocation 'CH'", [], ["update-mguser"])).toEqual([]);
  });
});

describe("the Modal sandbox evaluates the same rules, finding for finding", () => {
  const python = Bun.which("python3");
  test.skipIf(!python)("evaluate_rules and the token check in contextpane_sandbox.py match the TypeScript side", () => {
    const cases: Array<{ commands: string[]; script: string; required: string[]; allow: string[]; defined: string[] }> = [
      { commands: ["Get-MgUser", "Stop-AzVM", "Invoke-Expression", "pwsh", "%"], script: "Remove-AzResource -Force", required: [], allow: [], defined: [] },
      { commands: ["New-MgDirectoryRoleMemberByRef", "New-AzRoleAssignment", "Remove-AzKeyVault", "Set-AzContext"], script: "", required: ["new-azroleassignment"], allow: ["remove-azkeyvault"], defined: [] },
      { commands: ["Sync-DeviceByName", "Update-MgUser"], script: "Update-MgUser -PasswordProfile @{}", required: ["set-mguserlicense"], allow: [], defined: ["Sync-DeviceByName"] },
    ];
    const harness = String.raw`
import json, sys, types
from unittest import mock
sys.modules["modal"] = mock.MagicMock()
fastapi = types.ModuleType("fastapi"); fastapi.HTTPException = Exception; fastapi.Request = object
sys.modules["fastapi"] = fastapi
sys.path.insert(0, sys.argv[1])
import contextpane_sandbox as sb
out = []
for c in json.loads(sys.argv[2]):
    out.append(sorted(sb.evaluate_rules(c["commands"], c["script"], set(c["required"]), set(c["allow"]), set(c["defined"]))))
auth = [sb.authorized("Bearer t", {"CTX_MODAL_SANDBOX_TOKEN": "t"}), sb.authorized("Bearer x", {"CTX_MODAL_SANDBOX_TOKEN": "t"}), sb.authorized("", {}), sb.authorized("", {"CTX_MODAL_SANDBOX_ALLOW_UNAUTHENTICATED": "true"})]
print(json.dumps({"findings": out, "auth": auth}))
`;
    const dir = new URL("../../../../modal-sandbox", import.meta.url).pathname;
    const res = Bun.spawnSync([python!, "-I", "-c", harness, dir, JSON.stringify(cases)]);
    expect(res.stderr.toString()).toBe("");
    const py = JSON.parse(res.stdout.toString()) as { findings: string[][]; auth: boolean[] };
    const ts = cases.map((c) => evaluatePreflightRules(c.commands, c.script, c.required, { allow: c.allow, definedFunctions: c.defined }).sort());
    expect(py.findings).toEqual(ts);
    // Required by default, constant-time compare; only an explicit flag opens an unset token.
    expect(py.auth).toEqual([true, false, false, true]);
  });
});
