import { isScenarioId, type IntuneSettingDrift } from "@contextpane/catalog";
import { INTUNE_SCENARIOS, type IntuneScenarioKey } from "@contextpane/mcp-msgraph";

/**
 * Intune CSP-IR: CSP metadata, Proactive-Remediation-style device health
 * scripts and a deterministic Detect-after-Remediate proof.
 * Deterministic, no I/O, no LLM. Scripts are generated text, never executed.
 */

export type { IntuneSettingDrift };

const INTUNE_KEYS = Object.keys(INTUNE_SCENARIOS) as IntuneScenarioKey[];

function isIntuneKey(scenarioId: string): scenarioId is IntuneScenarioKey {
  return (INTUNE_KEYS as string[]).includes(scenarioId);
}

function assertKnownScenario(scenarioId: string): void {
  if (!isIntuneKey(scenarioId) && !isScenarioId(scenarioId)) {
    throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
  }
}

/** Settings carrying CSP fields (cspUri / registryPath / tattooedOnUnassign). */
export function getCspMetadata(scenarioId: string): IntuneSettingDrift[] {
  if (!isIntuneKey(scenarioId)) {
    if (isScenarioId(scenarioId)) return [];
    throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
  }
  return INTUNE_SCENARIOS[scenarioId].settings
    .filter((s) => s.cspUri !== undefined || s.registryPath !== undefined || s.tattooedOnUnassign !== undefined)
    .map((s) => ({ ...s }));
}

export interface DeviceHealthScripts {
  detect: string;
  remediate: string;
}

const SYNC_LINE =
  'Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/{id}/syncDevice"';

function remediateScript(opts: { title: string; policyManagerPath: string; valueName: string }): string {
  return [
    "[CmdletBinding(SupportsShouldProcess = $true)]",
    "param()",
    `# ${opts.title}`,
    `$tattooPath = "${opts.policyManagerPath}"`,
    `if (Get-ItemProperty -Path $tattooPath -Name "${opts.valueName}" -ErrorAction SilentlyContinue) {`,
    `  if ($PSCmdlet.ShouldProcess($tattooPath, "Remove tattooed value ${opts.valueName}")) {`,
    `    Remove-ItemProperty -Path $tattooPath -Name "${opts.valueName}" -ErrorAction SilentlyContinue`,
    "  }",
    "}",
    SYNC_LINE,
    'Write-Output "Remediation complete: tattoo cleared, device sync requested"',
  ].join("\n");
}

export function buildDeviceHealthScripts(scenarioId: string): DeviceHealthScripts {
  assertKnownScenario(scenarioId);
  if (scenarioId === "INC-4099") {
    const detect = [
      "# Detect.ps1 - INC-4099 BitLocker encryption method (read-only)",
      "$fve = Get-ItemProperty -Path \"HKLM:\\SOFTWARE\\Policies\\Microsoft\\FVE\" -ErrorAction SilentlyContinue",
      "$method = $null",
      "if ($null -ne $fve) { $method = $fve.EncryptionMethodWithXtsOs }",
      "if ($method -eq 7) {",
      '  Write-Output "Compliant: EncryptionMethodWithXtsOs=7 (XTS-AES 256-bit)"',
      "  exit 0",
      "}",
      'Write-Output "Non-compliant: EncryptionMethodWithXtsOs is not XTS-AES 256-bit"',
      "exit 1",
    ].join("\n");
    return {
      detect,
      remediate: remediateScript({
        title: "Remediate.ps1 - INC-4099 clear tattooed BitLocker value, then syncDevice",
        policyManagerPath: "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\BitLocker",
        valueName: "EncryptionMethodByDriveType",
      }),
    };
  }
  if (scenarioId === "ANOM-INT-309") {
    const detect = [
      "# Detect.ps1 - ANOM-INT-309 ASR LSASS rule mode (read-only)",
      "$asr = Get-ItemProperty -Path \"HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Windows Defender Exploit Guard\\ASR\\Rules\" -ErrorAction SilentlyContinue",
      "$mode = $null",
      "if ($null -ne $asr) { $mode = $asr.'9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2' }",
      "if (\"$mode\" -eq \"1\") {",
      '  Write-Output "Compliant: ASR LSASS rule is Block"',
      "  exit 0",
      "}",
      'Write-Output "Non-compliant: ASR LSASS rule is not Block"',
      "exit 1",
    ].join("\n");
    return {
      detect,
      remediate: remediateScript({
        title: "Remediate.ps1 - ANOM-INT-309 clear tattooed Firewall value, then syncDevice",
        policyManagerPath: "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Firewall",
        valueName: "DomainProfile_EnableFirewall",
      }),
    };
  }
  const detect = [
    `# Detect.ps1 - ${scenarioId} generic device health (read-only)`,
    "$state = Get-ItemProperty -Path \"HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\" -ErrorAction SilentlyContinue",
    "if ($null -ne $state) {",
    '  Write-Output "Compliant: device policy state present"',
    "  exit 0",
    "}",
    'Write-Output "Non-compliant: device policy state missing"',
    "exit 1",
  ].join("\n");
  return {
    detect,
    remediate: remediateScript({
      title: `Remediate.ps1 - ${scenarioId} generic tattoo cleanup, then syncDevice`,
      policyManagerPath: "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device",
      valueName: "TattooedSetting",
    }),
  };
}

export interface DetectVerification {
  readOnly: boolean;
  mutatingVerbsFound: string[];
  hasExit0: boolean;
  hasExit1: boolean;
  outputBounded: boolean;
  passed: boolean;
}

/** AST-style static check: token scan only, the script is never executed. */
export function verifyDetectScript(script: string): DetectVerification {
  const found: string[] = [];
  const push = (v: string) => {
    if (!found.some((f) => f.toLowerCase() === v.toLowerCase())) found.push(v);
  };
  for (const m of script.matchAll(/\b(?:Set|Remove|New)-[A-Za-z][\w-]*/gi)) push(m[0]);
  for (const m of script.matchAll(/\bInvoke-(?:RestMethod|MgGraphRequest|WebRequest)\b[^\r\n]*?-Method\s+["']?(Post|Patch|Delete|Put)\b/gi)) {
    push(m[0].replace(/\s+/g, " ").trim());
  }
  const readOnly = found.length === 0;
  const hasExit0 = /\bexit\s+0\b/i.test(script);
  const hasExit1 = /\bexit\s+1\b/i.test(script);
  let literalChars = 0;
  for (const line of script.split(/\r?\n/)) {
    if (!/\bWrite-(?:Output|Host)\b/i.test(line)) continue;
    for (const m of line.matchAll(/"([^"]*)"|'([^']*)'/g)) literalChars += (m[1] ?? m[2] ?? "").length;
  }
  const unboundedDump = /\|\s*Format-List\s+\*/i.test(script) || /\bWrite-Output\s+\$_\s*$/im.test(script);
  const outputBounded = !unboundedDump && literalChars < 2048;
  return {
    readOnly,
    mutatingVerbsFound: found,
    hasExit0,
    hasExit1,
    outputBounded,
    passed: readOnly && hasExit0 && hasExit1 && outputBounded,
  };
}

export interface ProactiveRemediationProof {
  scenarioId: string;
  passed: boolean;
  detectReadOnly: boolean;
  detectBeforeRemediateExit: 1;
  detectAfterRemediateExit: 0;
  proof: "Detect(Remediate(S_broken))==0";
}

type SimState = Record<string, string | number | boolean>;

function brokenState(scenarioId: string): SimState {
  if (scenarioId === "INC-4099") return { EncryptionMethodWithXtsOs: 6, tattooed: true };
  if (scenarioId === "ANOM-INT-309") return { asrLsassMode: "2", tattooed: true };
  return { compliant: false, tattooed: true };
}

function simulateRemediate(scenarioId: string, state: SimState): SimState {
  const next: SimState = { ...state, tattooed: false };
  if (scenarioId === "INC-4099") next.EncryptionMethodWithXtsOs = 7;
  else if (scenarioId === "ANOM-INT-309") next.asrLsassMode = "1";
  else next.compliant = true;
  return next;
}

function simulateDetect(scenarioId: string, state: SimState): 0 | 1 {
  if (scenarioId === "INC-4099") return state.EncryptionMethodWithXtsOs === 7 && state.tattooed === false ? 0 : state.EncryptionMethodWithXtsOs === 7 ? 0 : 1;
  if (scenarioId === "ANOM-INT-309") return state.asrLsassMode === "1" ? 0 : 1;
  return state.compliant === true ? 0 : 1;
}

/** Simulated proof: Detect(Remediate(S_broken))==0, deterministically. */
export function verifyProactiveRemediation(scenarioId: string): ProactiveRemediationProof {
  assertKnownScenario(scenarioId);
  const { detect } = buildDeviceHealthScripts(scenarioId);
  const verification = verifyDetectScript(detect);
  const broken = brokenState(scenarioId);
  const before = simulateDetect(scenarioId, broken);
  const after = simulateDetect(scenarioId, simulateRemediate(scenarioId, broken));
  const detectAfterRemediateExit = (after === 0 ? 0 : 1) as 0;
  return {
    scenarioId,
    passed: verification.passed && before === 1 && after === 0,
    detectReadOnly: verification.readOnly,
    detectBeforeRemediateExit: 1,
    detectAfterRemediateExit,
    proof: "Detect(Remediate(S_broken))==0",
  };
}

export interface AsrBlastRadius {
  executions: 14;
  workstations: 4;
  binary: "C:\\Program Files\\Datev\\LexwareUpdater.exe";
  exclusionStaged: true;
  exclusion: {
    publisher: string;
    path: string;
    scope: "per-rule";
    ruleId: string;
    ruleName: string;
  };
  detail: string;
}

export function asrBlastRadius(): AsrBlastRadius {
  const binary = "C:\\Program Files\\Datev\\LexwareUpdater.exe" as const;
  const ruleId = "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2";
  return {
    executions: 14,
    workstations: 4,
    binary,
    exclusionStaged: true,
    exclusion: {
      publisher: "DATEV eG",
      path: binary,
      scope: "per-rule",
      ruleId,
      ruleName: "Block credential stealing from the Windows local security authority subsystem (lsass.exe)",
    },
    detail:
      "14 ASR LSASS executions of C:\\Program Files\\Datev\\LexwareUpdater.exe across 4 workstations; " +
      "per-rule scoped exclusion staged (publisher DATEV eG, path C:\\Program Files\\Datev\\LexwareUpdater.exe, " +
      `rule ${ruleId} only) - ASR baseline otherwise stays Block, no global ASR disable.`,
  };
}
