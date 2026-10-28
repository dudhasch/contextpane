import { describe, expect, test } from "bun:test";
import { VERDICT_SHORT, isReadOnlyBundle } from "./shared";

const bundle = (ticketId: string, powershellScript: string) => ({ ticketId, powershellScript });

describe("isReadOnlyBundle (WP10-B)", () => {
  test("a Free-Roam inventory query is read-only", () => {
    const script = [
      "<# Lists users; Set-MgUser is never called #>",
      "[CmdletBinding(SupportsShouldProcess)]",
      "param()",
      "Set-StrictMode -Version Latest",
      "Connect-MgGraph -Scopes 'User.Read.All'",
      "# Remove-MgUser would be destructive",
      "$rows = Get-MgUser -Top 25 | Select-Object DisplayName, UserPrincipalName",
      "$rows | ForEach-Object { New-Object psobject -Property @{ Name = $_.DisplayName } }",
      "Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/organization'",
    ].join("\n");
    expect(isReadOnlyBundle(bundle("FREE-1A2B3C4D", script))).toBe(true);
  });

  test("state-changing cmdlets or mutating Graph requests are not", () => {
    expect(isReadOnlyBundle(bundle("FREE-1A2B3C4D", "Update-MgUser -UserId x -AccountEnabled:$false"))).toBe(false);
    expect(isReadOnlyBundle(bundle("FREE-1A2B3C4D", "Restart-AzVM -Name vm1"))).toBe(false);
    expect(isReadOnlyBundle(bundle("FREE-1A2B3C4D", "Invoke-MgGraphRequest -Uri $u -Method PATCH -Body $b"))).toBe(false);
  });

  test("scenario fixes are never read-only", () => {
    expect(isReadOnlyBundle(bundle("INC-4092", "Get-MgUser -Top 1"))).toBe(false);
  });

  test("short verdict words fit the prover strip", () => {
    expect(Math.max(...Object.values(VERDICT_SHORT).map((w) => w.length))).toBeLessThanOrEqual(10);
  });
});
