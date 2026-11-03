import { describe, expect, test } from "bun:test";
import { VERDICT_SHORT, blastRadiusPill, blastSummarySentence, isReadOnlyBundle, licenceAdditions, preflightGate, verifiedLines, type Drawer } from "./shared";

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

const verification = (verdict: Drawer["verificationStatus"]["verdict"], extra: Partial<Drawer["verificationStatus"]> = {}) =>
  ({ verdict, astCheckPassed: true, terraformFmtPassed: null, terraformValidatePassed: null, sandboxProvider: "local-pwsh", whatIfSafe: true, validationLatencyMs: 1, findings: [], ...extra }) as Drawer["verificationStatus"];
const drawerWith = (v: Drawer["verificationStatus"], extra: Partial<Drawer> = {}) =>
  ({ ticketId: "INC-4092", title: "t", summary: "s", powershellScript: "Get-MgUser", affectedEntities: [], verificationStatus: v, approval: { state: "pending" }, ...extra }) as unknown as Drawer;
const formalOf = (passed: boolean | null, collateralChanges = 0, invariants: Array<{ passed: boolean; statement: string }> = []) =>
  ({ formal: { passed, invariants }, blastRadius: { collateralChanges, rows: [{ cohort: "target", entities: ["a", "b", "c"] }] }, rollback: { powershellScript: "undo" } }) as never;

describe("approve gate shared by the button and the x hotkey (review M10)", () => {
  test("a failed verdict or a failed invariant blocks; an override lifts only the invariant block", () => {
    expect(preflightGate(drawerWith(verification("Verified Safe")), formalOf(true), "ready").blocked).toBe(false);
    expect(preflightGate(drawerWith(verification("Verification Failed")), null, "ready").blocked).toBe(true);
    expect(preflightGate(drawerWith(verification("Verified Safe")), formalOf(false, 0, [{ passed: false, statement: "x" }]), "ready").blocked).toBe(true);
    expect(preflightGate(drawerWith(verification("Overridden")), formalOf(false, 0, [{ passed: false, statement: "x" }]), "ready").blocked).toBe(false);
  });
  test("an AST check that did not run is named as such, not as a failure", () => {
    expect(preflightGate(drawerWith(verification("Verified With Warnings", { astCheckPassed: null })), null, "ready").reasons).toContain("PowerShell AST check did not run.");
  });
});

describe("operator-facing text comes from state (review M12)", () => {
  test("the blast-radius pill is modelled, muted without a model, critical with collateral", () => {
    expect(blastRadiusPill(formalOf(true))).toMatchObject({ tone: "healthy", label: "3 targets · 0 collateral (modelled)" });
    expect(blastRadiusPill(formalOf(true, 2))?.tone).toBe("critical");
    expect(blastRadiusPill(formalOf(null))).toMatchObject({ tone: "muted", label: "blast radius not modelled" });
    expect(blastSummarySentence("CUSTOM-ABC123")).toBeNull();
  });
  test("a simulated approval never claims a live change, zero impact or no licence charges", () => {
    const lines = verifiedLines({ drawer: drawerWith(verification("Verified Safe")), execution: "simulated", canary: null, formal: null }).join("\n");
    expect(lines).toContain("has not been applied to your tenant");
    expect(lines).not.toMatch(/zero impact|No extra license|applied to your tenant and read back/);
  });
  test("a failed or unknown verdict asserts nothing about the pre-flight", () => {
    expect(verifiedLines({ drawer: drawerWith(verification("Verification Failed")), execution: null, canary: null, formal: null })).toEqual([]);
    expect(verifiedLines({ drawer: drawerWith(verification("Pending")), execution: null, canary: null, formal: null })).toEqual([]);
  });
  test("a live run with a converged symbolic canary says the checks ran on the modelled state", () => {
    const canary = { scenarioId: "INC-4092", mode: "break-glass", probeSource: "symbolic", finalState: "CONVERGED", canaryCohort: "c", stages: [], probes: { identity: { passed: true }, network: {} } } as never;
    const lines = verifiedLines({ drawer: drawerWith(verification("Verified Safe", { sandboxProvider: "modal-cloud-sandbox" })), execution: "live-graph", canary, formal: formalOf(true) });
    expect(lines).toEqual([
      "• The change was applied to your tenant and read back afterwards.",
      "• Pre-flight safety checks passed in our isolated sandbox.",
      "• Post-change health checks passed on the modelled lab state.",
      "• Our safety model of this change shows no other users or emergency admin accounts affected.",
    ]);
  });
  test("licences the fix assigns are disclosed", () => {
    const d = drawerWith(verification("Verified Safe"), { affectedEntities: [{ type: "user", id: "a@b.c", change: "assign SPE_E5, remove SPE_E3" }] as never });
    expect(licenceAdditions(d)).toEqual(["SPE_E5"]);
    // INC-4092 writes "SPE_E3 → SPE_E5" per user: E5 is assigned.
    expect(licenceAdditions(drawerWith(verification("Verified Safe"), { affectedEntities: [{ type: "upn", id: "a@b.c", change: "SPE_E3 → SPE_E5" }] as never }))).toEqual(["SPE_E5"]);
    expect(licenceAdditions(drawerWith(verification("Verified Safe"), { affectedEntities: [{ type: "user", id: "a@b.c", change: "reclaim SPE_E5 from a disabled account" }] as never }))).toEqual([]);
    expect(verifiedLines({ drawer: d, execution: "live-graph", canary: null, formal: null }).at(-1)).toMatch(/^• Licences assigned by this fix: SPE_E5/);
  });
});
