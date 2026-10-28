import { describe, expect, test } from "bun:test";
import { IntuneSettingDriftSchema } from "@contextpane/catalog";
import { INTUNE_SCENARIOS } from "@contextpane/mcp-msgraph";
import {
  asrBlastRadius,
  buildDeviceHealthScripts,
  getCspMetadata,
  verifyDetectScript,
  verifyProactiveRemediation,
} from "./intune-remediation.ts";

describe("Intune CSP-IR + Detect/Remediate verifier", () => {
  test("CSP fields present per scenario", () => {
    const bl = getCspMetadata("INC-4099");
    const enc = bl.find((s) => s.settingName.includes("Encryption method for OS drives"));
    expect(enc?.cspUri).toBe("./Device/Vendor/MSFT/BitLocker/EncryptionMethodByDriveType");
    expect(enc?.registryPath).toContain("HKLM\\SOFTWARE\\Policies\\Microsoft\\FVE\\EncryptionMethodWithXtsOs");
    expect(enc?.registryPath).toContain("EncryptionMethodWithXtsFdv");
    const warn = bl.find((s) => s.settingName.includes("Allow warning"));
    expect(warn?.cspUri).toBe("./Device/Vendor/MSFT/BitLocker/AllowWarningForOtherDiskEncryption");
    expect(warn?.registryPath).toContain("AllowWarningForOtherDiskEncryption");

    const int309 = getCspMetadata("ANOM-INT-309");
    const asr = int309.find((s) => s.settingName.includes("ASR:"));
    expect(asr?.cspUri).toBe("./Vendor/MSFT/Policy/Config/Defender/AttackSurfaceReductionRules");
    expect(asr?.registryPath).toBe(
      "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Windows Defender Exploit Guard\\ASR\\Rules",
    );
    // Fixtures themselves carry the fields and still parse the additive schema.
    for (const key of ["INC-4099", "ANOM-INT-309"] as const) {
      for (const s of INTUNE_SCENARIOS[key].settings) {
        expect(IntuneSettingDriftSchema.parse(s)).toMatchObject({ settingName: s.settingName });
      }
    }
    expect(getCspMetadata("INC-4092")).toEqual([]);
    expect(() => getCspMetadata("NOPE-0000")).toThrow(/unknown scenarioId/);
  });

  test("tattoo flags", () => {
    const bl = getCspMetadata("INC-4099");
    expect(bl.filter((s) => s.cspUri?.includes("BitLocker")).every((s) => s.tattooedOnUnassign === true)).toBe(true);
    const int309 = getCspMetadata("ANOM-INT-309");
    expect(int309.find((s) => s.settingName.includes("ASR:"))?.tattooedOnUnassign).toBe(false);
    const fw = int309.filter((s) => s.settingName.includes("Firewall"));
    expect(fw).toHaveLength(2);
    expect(fw.every((s) => s.tattooedOnUnassign === true)).toBe(true);
    expect(fw.every((s) => (s.registryPath ?? "").includes("PolicyManager\\current\\device"))).toBe(true);
  });

  test("Detect passes verifier, Remediate shape, generic fallback", () => {
    for (const id of ["INC-4099", "ANOM-INT-309", "INC-4092"] as const) {
      const { detect, remediate } = buildDeviceHealthScripts(id);
      const v = verifyDetectScript(detect);
      expect(v).toMatchObject({ readOnly: true, mutatingVerbsFound: [], hasExit0: true, hasExit1: true, outputBounded: true, passed: true });
      expect(detect).toContain("Get-ItemProperty");
      expect(detect.length).toBeLessThan(2048);
      expect(remediate).toContain("Remove-ItemProperty");
      expect(remediate).toContain("$PSCmdlet.ShouldProcess");
      // Runs as SYSTEM on the endpoint: no Graph module, no token, so the local enrollment task syncs.
      expect(remediate).toContain("\\Microsoft\\Windows\\EnterpriseMgmt\\*");
      expect(remediate).not.toContain("Invoke-MgGraphRequest");
      expect(remediate).not.toContain("{id}");
    }
    const bitlocker = buildDeviceHealthScripts("INC-4099").remediate;
    expect(bitlocker).toContain("HKLM:\\SOFTWARE\\Policies\\Microsoft\\FVE");
    expect(bitlocker).toContain("EncryptionMethodWithXtsOs");
    expect(bitlocker).toContain("-eq 7) { continue }");
    expect(bitlocker).not.toContain("PolicyManager");
    expect(() => buildDeviceHealthScripts("NOPE-0000")).toThrow(/unknown scenarioId/);
  });

  test("mutating Detect variants fail", () => {
    const base = buildDeviceHealthScripts("INC-4099").detect;
    for (const bad of [
      `${base}\nSet-ItemProperty -Path "HKLM:\\SOFTWARE\\X" -Name Y -Value 1`,
      `${base}\nRemove-ItemProperty -Path "HKLM:\\SOFTWARE\\X" -Name Y`,
      `${base}\nNew-Item -Path "HKLM:\\SOFTWARE\\X"`,
      `${base}\nInvoke-RestMethod -Method Post -Uri "https://example.invalid/x"`,
      `${base}\nInvoke-RestMethod -Method Patch -Uri "https://example.invalid/x"`,
      `${base}\nInvoke-RestMethod -Method Delete -Uri "https://example.invalid/x"`,
    ]) {
      const v = verifyDetectScript(bad);
      expect(v.readOnly).toBe(false);
      expect(v.passed).toBe(false);
      expect(v.mutatingVerbsFound.length).toBeGreaterThan(0);
    }
    expect(verifyDetectScript(buildDeviceHealthScripts("INC-4099").remediate).passed).toBe(false);
    expect(verifyDetectScript('Write-Output "x"').passed).toBe(false);
  });

  test("proactive remediation proof Detect(Remediate(S_broken))==0", () => {
    for (const id of ["INC-4099", "ANOM-INT-309"] as const) {
      const p = verifyProactiveRemediation(id);
      expect(p.passed).toBe(true);
      expect(p.detectReadOnly).toBe(true);
      expect(p.detectBeforeRemediateExit).toBe(1);
      expect(p.detectAfterRemediateExit).toBe(0);
      expect(p.proof).toBe("Detect(Remediate(S_broken))==0");
      expect(verifyProactiveRemediation(id)).toEqual(p);
    }
  });

  test("ASR blast radius + exclusion", () => {
    const r = asrBlastRadius();
    expect(r.executions).toBe(14);
    expect(r.workstations).toBe(4);
    expect(r.binary).toBe("C:\\Program Files\\Datev\\LexwareUpdater.exe");
    expect(r.exclusionStaged).toBe(true);
    expect(r.exclusion.path).toBe(r.binary);
    expect(r.exclusion.publisher).toBe("DATEV eG");
    expect(r.exclusion.scope).toBe("per-rule");
    expect(r.exclusion.ruleId).toBe("9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2");
    expect(r.detail).toContain("14");
    expect(r.detail).toContain("4 workstations");
    expect(asrBlastRadius()).toEqual(r);
  });
});
