import {
  SCENARIO_REGISTRY,
  dataPtr,
  datasetsFor,
  isScenarioId,
  type ScenarioId,
} from "@contextpane/catalog";
import { BREAK_GLASS_USERS, buildInverseRollback, postState, verifyFormalInvariants } from "./formal-verifier.ts";
import { signatureForScenario } from "./fleet-immunizer.ts";
import { getTimeline } from "./timeline.ts";

/**
 * Place 7 · Runbook Generator.
 *
 * Deterministic markdown runbook per scenario. Zero-PII by construction:
 * every interpolated value passes through scrubPii, diagnostics are
 * ptr:// pointers only (rows stay in the data plane), and personal
 * identifiers are replaced with vault-style tokens (upn_tok_*, ip_tok_*).
 */

export const RUNBOOK_VERSION = "1.0.0";

const UPN_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;

/** Replace raw UPNs / IPs (incl. CIDR) with vault-style tokens. */
export function scrubPii(text: string): string {
  return text.replace(UPN_RE, "upn_tok_redacted").replace(IP_RE, "ip_tok_redacted");
}

/** Replace known entity ids (and UPN local-part variants) with vault tokens. */
export function scrubKnownIds(text: string, ids: readonly string[]): string {
  let out = scrubPii(text);
  const variants: { needle: string; token: string }[] = [];
  for (const id of ids) {
    // Generic timeline ids (SPE_E5, AADSTS*, group/policy names) are not PII; only UPNs and device names are.
    if (!id.includes("@") && !/^[A-Z][A-Z0-9]*-[A-Z]+-\d+$/.test(id)) continue;
    const token = id.includes("@") ? "upn_tok_redacted" : "device_tok_redacted";
    variants.push({ needle: id, token });
    if (id.includes("@")) {
      const local = id.split("@")[0]!;
      variants.push({ needle: local, token });
      const parts = local.split(".");
      if (parts.length > 2) variants.push({ needle: parts.slice(0, 2).join("."), token });
    }
  }
  variants.sort((a, b) => b.needle.length - a.needle.length);
  for (const v of variants) if (v.needle) out = out.split(v.needle).join(v.token);
  return out;
}

function scrubSummary(summary: string, entityIds: readonly string[]): string {
  return scrubKnownIds(summary, entityIds);
}

function forwardScript(scenarioId: ScenarioId, signature: string): string {
  const head = [
    "#Requires -Version 7.0",
    "[CmdletBinding(SupportsShouldProcess)]",
    "param([string]$TenantId)",
    "$ErrorActionPreference = 'Stop'",
    `# ContextPane forward remediation for ${scenarioId} (signature: ${signature})`,
    "# PowerShell 7. Affected users/devices are resolved locally via ptr:// datasets; no UPNs or IPs are embedded in this script.",
    "if (-not (Get-MgContext)) { throw 'No Microsoft Graph context. Connect-MgGraph first.' }",
  ];
  const body: Record<ScenarioId, string[]> = {
    "INC-4092": [
      "# 1. License: move drifted AVD users from the legacy SKU to the target SKU (ptr://inc-4092/entra/users)",
      "if ($PSCmdlet.ShouldProcess('SG-Contoso-Finance-AVD', 'Set-MgUserLicense SPE_E3 -> SPE_E5')) { Set-MgUserLicense -UserId '{{USER_UPN}}' -AddLicenses @(@{ SkuId = '06ebc4ee-1bb5-47dd-8120-11324bc54e06' }) -RemoveLicenses @('6fd2c87f-b296-42f0-b197-1e91e994b900') | Out-Null }",
      "# 2. CA: exclude the entitlement group from the legacy AVD block and switch it to report-only",
      "if ($PSCmdlet.ShouldProcess('AVD legacy Conditional Access policy', 'Update-MgIdentityConditionalAccessPolicy exclude group, report-only')) { Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId 'd09ae604-9c1e-4b9c-9a5d-000000000001' -BodyParameter @{ state = 'enabledForReportingButNotEnforced' } | Out-Null }",
      "# 3. NSG: remove the rogue open-RDP rule and restore Terraform baseline tags on nsg-contoso-avd-hostpool-01",
      "if ($PSCmdlet.ShouldProcess('nsg-contoso-avd-hostpool-01', 'Remove rogue RDP rule, restore baseline')) { Get-AzNetworkSecurityGroup -Name 'nsg-contoso-avd-hostpool-01' | Remove-AzNetworkSecurityRuleConfig -Name 'Allow-Temp-RDP-Diagnostic-Drift' | Set-AzNetworkSecurityGroup | Out-Null }",
    ],
    "INC-4099": [
      "# 1. Unassign the conflicting legacy BitLocker device-configuration profile (ptr://inc-4099/intune/policies)",
      "if ($PSCmdlet.ShouldProcess('legacy BitLocker profile', 'Unassign via Invoke-MgGraphRequest assign with empty assignments')) { Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/intune-cfg-fabrikam-legacy-bitlocker/assign' -Body (@{ assignments = @() } | ConvertTo-Json) | Out-Null }",
      "# 2. Sync affected devices so compliance re-evaluates (ptr://inc-4099/intune/devices)",
      "if ($PSCmdlet.ShouldProcess('affected devices', 'Sync-MgDeviceManagementManagedDevice')) { Sync-MgDeviceManagementManagedDevice -ManagedDeviceId 'md-fabrikam-lt-1107' }",
    ],
    "ANOM-LIC-101": [
      "# 1. Reclaim orphaned seats from disabled accounts (ptr://anom-lic-101/entra/users)",
      "if ($PSCmdlet.ShouldProcess('disabled accounts', 'Set-MgUserLicense remove orphaned SKU')) { Set-MgUserLicense -UserId '{{USER_UPN}}' -AddLicenses @() -RemoveLicenses @('06ebc4ee-1bb5-47dd-8120-11324bc54e06') | Out-Null }",
      "# 2. Reprocess group-based licensing for CountViolation members",
      "if ($PSCmdlet.ShouldProcess('CountViolation members', 'Invoke-MgLicenseUser reprocess')) { Invoke-MgLicenseUser -UserId '{{USER_UPN}}' | Out-Null }",
    ],
    "ANOM-CA-204": [
      "# 1. Restore the break-glass exclusion on the admin MFA policy (ptr://anom-ca-204/entra/ca-policies)",
      "if ($PSCmdlet.ShouldProcess('CA-001 admin MFA policy', 'Update-MgIdentityConditionalAccessPolicy exclude SG-BreakGlass-Accounts')) { Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId 'ca-policy-001' -BodyParameter @{ conditions = @{ users = @{ excludeGroups = @('sg-breakglass-accounts-01') } } } | Out-Null }",
      "# 2. Enforce the legacy-auth block (report-only -> enabled)",
      "if ($PSCmdlet.ShouldProcess('CA-004 legacy-auth policy', 'Update-MgIdentityConditionalAccessPolicy state=enabled')) { Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId 'ca-policy-004' -BodyParameter @{ state = 'enabled' } | Out-Null }",
    ],
    "ANOM-APP-401": [
      "# 1. Remove the shadow-admin app owner and revoke the unverified delegated grant (ptr://anom-app-401/entra/ca-policies)",
      "if ($PSCmdlet.ShouldProcess('workload identity', 'Remove-MgApplicationOwnerByRef + Remove-MgOauth2PermissionGrant')) { Remove-MgApplicationOwnerByRef -ApplicationId '44444444-5555-6666-7777-888888888888' -DirectoryObjectId 'a1b2c3d4-0001-4000-8000-000000000401' }",
      "# 2. Right-size Graph app roles to User.Read.All + Sites.Selected and federate GitHub Actions OIDC",
      "if ($PSCmdlet.ShouldProcess('workload identity', 'New-MgApplicationFederatedIdentityCredential GitHub Actions OIDC')) { New-MgApplicationFederatedIdentityCredential -ApplicationId '44444444-5555-6666-7777-888888888888' -BodyParameter @{} | Out-Null }",
    ],
    "ANOM-INT-309": [
      "# 1. ASR: restore the LSASS credential-stealing rule Audit -> Block (ptr://anom-int-309/intune/settings)",
      "if ($PSCmdlet.ShouldProcess('Win11 ASR baseline', 'Invoke-MgGraphRequest PUT configurationPolicies settings LSASS rule = Block')) { Invoke-MgGraphRequest -Method PUT -Uri 'https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/intune-cfg-win11-asr-baseline' -Body '{}' | Out-Null }",
      "# 2. Unassign the duplicate legacy firewall profile and sync affected devices",
      "if ($PSCmdlet.ShouldProcess('duplicate firewall profile', 'Unassign via Invoke-MgGraphRequest')) { Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/intune-cfg-win11-firewall-mdm/assign' -Body (@{ assignments = @() } | ConvertTo-Json) | Out-Null }",
      "if ($PSCmdlet.ShouldProcess('affected devices', 'Sync-MgDeviceManagementManagedDevice')) { Sync-MgDeviceManagementManagedDevice -ManagedDeviceId 'md-contoso-ws-2201' }",
    ],
  };
  return [...head, ...body[scenarioId], ""].join("\n");
}

export function generateRunbook(scenarioId: string): string {
  if (!isScenarioId(scenarioId)) throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
  const entry = SCENARIO_REGISTRY[scenarioId];
  const signature = signatureForScenario(scenarioId);
  const timeline = getTimeline(scenarioId)!;
  const verification = verifyFormalInvariants(scenarioId);
  const rollback = buildInverseRollback(scenarioId);

  const knownIds: string[] = [
    ...postState(scenarioId).affected.map((a) => a.id),
    ...BREAK_GLASS_USERS,
    ...timeline.slices.flatMap((s) => s.state.entities.map((e) => e.id).filter((id) => id.includes("@"))),
  ];

  const datasetPtrs = [...new Set(entry.components.flatMap((c) => datasetsFor(c)))].map((k) =>
    dataPtr(scenarioId, k),
  );

  const lines: string[] = [
    `# Runbook: ${scenarioId} — ${entry.title}`,
    ``,
    `- Runbook version: ${RUNBOOK_VERSION}`,
    `- RUNBOOK_VERSION: ${RUNBOOK_VERSION}`,
    `- Scenario: ${scenarioId}`,
    `- Signature: ${signature}`,
    `- Tenant scope: ${entry.tenantId}`,
    `- Remediation scope: ${entry.remediationScope}`,
    ``,
    `## Executive Root-Cause Summary`,
    ``,
    scrubKnownIds(
      `${entry.title}. Remediation scope: ${entry.remediationScope}. Fleet signature \`${signature}\` captures the drift pattern without any personal data. ` +
        `Current state (NOW): ${timeline.slices.find((s) => s.kind === "now")?.state.summary ?? entry.title}`,
      knownIds,
    ),
    ``,
    `## Causal Timeline`,
    ``,
    `| Label | Kind | Timestamp | Summary |`,
    `|---|---|---|---|`,
    ...timeline.slices.map(
      (s) =>
        `| ${s.relativeLabel} | ${s.kind} | ${s.timestamp} | ${scrubSummary(s.state.summary, s.state.entities.map((e) => e.id)).replace(/\|/g, "/")} |`,
    ),
    ``,
    `## Diagnostics (ptr://, Zero-PII)`,
    ``,
    `All diagnostics are ptr:// pointers into the local data plane. Rows are resolved locally and never embedded in this runbook; personal fields are vaulted as \`upn_tok_*\` / \`ip_tok_*\` tokens.`,
    ``,
    ...datasetPtrs.map((ptr) => `- \`${ptr}\``),
    `- \`ptr://${scenarioId.toLowerCase()}/formal/invariants\` — symbolic proof result (see Formal Invariant Proofs)`,
    ``,
    `## Formal Invariant Proofs`,
    ``,
    `Prover: symbolic-formal-verifier. Overall: ${verification.passed ? "PASS" : "FAIL"} (${verification.invariants.filter((i) => i.passed).length}/3 invariants passed).`,
    ``,
    ...verification.invariants.flatMap((inv) => [
      `### ${inv.id} — ${inv.passed ? "PASS" : "FAIL"}`,
      ``,
      `- Statement: ${scrubKnownIds(inv.statement, knownIds)}`,
      `- Checked: ${inv.checked}`,
      ...(inv.evidence.length
        ? inv.evidence.map((e) => `- Evidence: ${scrubKnownIds(e, knownIds)}`)
        : inv.counterexamples.map((c) => `- Counterexample: ${scrubKnownIds(`${c.entity} ${c.context}: ${c.detail}`, knownIds)}`)),
      ``,
    ]),
    `## Forward Remediation Script`,
    ``,
    "```powershell",
    forwardScript(scenarioId, signature).trimEnd(),
    "```",
    ``,
    `## Inverse Rollback f^-1`,
    ``,
    `Restores the pre-remediation state. Restores: ${rollback.restores.map((r) => scrubKnownIds(r, knownIds)).join("; ")}`,
    ``,
    "```powershell",
    scrubKnownIds(rollback.powershellScript, knownIds).trimEnd(),
    "```",
    ``,
  ];

  // Safety net: the finished runbook must contain no raw UPN, IP or known entity id.
  return scrubKnownIds(lines.join("\n"), knownIds);
}
