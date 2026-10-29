import type { ActionApprovalDrawer } from "@contextpane/catalog";
import type { InverseRollbackBundle } from "./formal-verifier.ts";
import type { EntitySnapshot, SnapshotCaPolicy, SnapshotUser } from "./snapshot.ts";

/**
 * f⁻¹ from the pre-change snapshot (U-5).
 *
 * The inverse bundle is derived from what the tenant looked like before the approved bundle
 * ran, restricted to the entity sections that bundle touched (its PowerShell, Graph requests
 * and Terraform name licences, Conditional Access, the NSG, Intune or the workload identity).
 * No scenario id decides what is restored; the captured state does:
 *
 *   users      -> group memberships back as captured, then Invoke-MgLicenseUser for group
 *                 licensing; direct SKUs re-added / removed per user (H-19: per-user restore)
 *   CA policy  -> Update-MgIdentityConditionalAccessPolicy with the FULL captured
 *                 conditions.users object and the captured state (H-19: never excludeGroups alone)
 *   NSG        -> every captured rule put back, rules the fix added removed, tags restored
 *   Intune     -> captured profile assignments and setting values re-applied
 *   workload   -> FICs the fix created removed by their looked-up id, captured owners and
 *                 app-role assignments re-added (H-19: never by a name used as an id)
 *
 * Every mutation sits in $PSCmdlet.ShouldProcess; ids that the snapshot does not hold are
 * resolved by display name at run time, never hard-coded. The same bundle is what
 * `applySnapshotState` executes through the lab write path when the operator reverts.
 */

export interface SnapshotInverse extends InverseRollbackBundle {
  inverseSource: "pre-snapshot";
  sections: Array<"users" | "conditional-access" | "nsg" | "intune" | "workload-identity">;
  graphRequests: Array<{ method: string; url: string; body?: unknown }>;
}

const psq = (value: string) => `'${value.replace(/'/g, "''")}'`;
const psArray = (values: string[]) => (values.length ? `@(${values.map(psq).join(", ")})` : "@()");
const isGuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sp = (target: string, action: string, body: string[]) => [`if ($PSCmdlet.ShouldProcess(${psq(target)}, ${psq(action)})) {`, ...body.map((l) => `    ${l}`), "}"];

const RESOLVERS = [
  "function Get-GroupByName([string]$Name) {",
  `    $g = @(Get-MgGroup -Filter "displayName eq '$($Name -replace "'", "''")'" -ConsistencyLevel eventual -CountVariable n -Top 2)`,
  "    if ($g.Count -ne 1) { throw \"Group '$Name' resolved to $($g.Count) objects\" }",
  "    return $g[0]",
  "}",
  "function Get-CaPolicyByName([string]$Name) {",
  "    $p = Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.DisplayName -eq $Name } | Select-Object -First 1",
  "    if (-not $p) { throw \"Conditional Access policy '$Name' not found\" }",
  "    return $p",
  "}",
  "function Get-SkuIdByPartNumber([string]$PartNumber) {",
  "    $s = Get-MgSubscribedSku -All | Where-Object SkuPartNumber -eq $PartNumber | Select-Object -First 1",
  "    if (-not $s) { throw \"SKU '$PartNumber' not found in the tenant\" }",
  "    return $s.SkuId",
  "}",
];

function skuList(value: string): string[] {
  return value
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== "NONE");
}

/** Which snapshot sections the executed bundle touched; everything captured when nothing matches. */
export function touchedSections(pre: EntitySnapshot, executed: Pick<ActionApprovalDrawer, "powershellScript" | "graphPatch" | "terraformDiff" | "affectedEntities">): SnapshotInverse["sections"] {
  const text = `${executed.powershellScript}\n${executed.graphPatch}\n${executed.terraformDiff}`;
  const types = new Set(executed.affectedEntities.map((e) => e.type));
  const sections: SnapshotInverse["sections"] = [];
  if (pre.users.length && (/MgUser|License|GroupMember|licenseAssignment|reprocess|assignLicense/i.test(text) || types.has("upn") || types.has("sku"))) sections.push("users");
  if (pre.caPolicies.length && /ConditionalAccess|conditionalAccess/i.test(text)) sections.push("conditional-access");
  if (pre.nsg && /NetworkSecurity|networkSecurityGroups|securityRules|azurerm_network_security/i.test(text)) sections.push("nsg");
  if (pre.intune && (/DeviceManagement|deviceConfigurations|configurationPolicies|deviceHealthScripts|Intune/i.test(text) || types.has("device"))) sections.push("intune");
  if (pre.workloadIdentity && /MgApplication|ServicePrincipal|FederatedIdentity|appRoleAssignments|oauth2PermissionGrants/i.test(text)) sections.push("workload-identity");
  if (sections.length) return sections;
  // Nothing recognisable in the bundle: restore everything that was captured rather than guess.
  if (pre.users.length) sections.push("users");
  if (pre.caPolicies.length) sections.push("conditional-access");
  if (pre.nsg) sections.push("nsg");
  if (pre.intune) sections.push("intune");
  if (pre.workloadIdentity) sections.push("workload-identity");
  return sections;
}

function userLines(u: SnapshotUser, requests: SnapshotInverse["graphRequests"], restores: string[]): string[] {
  const lines: string[] = [`$u = Get-MgUser -UserId ${psq(u.upn)} -Property Id`];
  for (const group of u.groups) {
    lines.push(`$g = Get-GroupByName ${psq(group)}`);
    lines.push(`if (-not (Get-MgGroupMember -GroupId $g.Id -All | Where-Object Id -eq $u.Id)) { New-MgGroupMemberByRef -GroupId $g.Id -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($u.Id)" } }`);
    requests.push({ method: "POST", url: `/groups/{${group}}/members/$ref`, body: { "@odata.id": `https://graph.microsoft.com/v1.0/users/${u.upn}` } });
  }
  const direct = /direct/i.test(u.assignmentPath);
  const current = skuList(u.currentSku);
  const expected = skuList(u.expectedSku);
  if (direct && current.length) {
    const add = current;
    const remove = expected.filter((s) => !current.includes(s));
    lines.push(`Set-MgUserLicense -UserId $u.Id -AddLicenses @(${add.map((s) => `@{ SkuId = (Get-SkuIdByPartNumber ${psq(s)}) }`).join(", ")}) -RemoveLicenses @(${remove.map((s) => `(Get-SkuIdByPartNumber ${psq(s)})`).join(", ")}) | Out-Null`);
    requests.push({ method: "POST", url: `/users/${u.upn}/assignLicense`, body: { addLicenses: add.map((s) => ({ skuPartNumber: s })), removeLicenses: remove } });
  } else {
    lines.push("Invoke-MgLicenseUser -UserId $u.Id | Out-Null");
    requests.push({ method: "POST", url: `/users/${u.upn}/reprocessLicenseAssignment` });
  }
  restores.push(`${u.upn}: ${u.assignmentState} · ${u.currentSku} (${u.assignmentPath})${u.groups.length ? ` · groups ${u.groups.join(", ")}` : ""}`);
  return sp(u.upn, `Restore pre-change licence state (${u.currentSku}, ${u.assignmentPath}) and group memberships`, lines);
}

function caLines(p: SnapshotCaPolicy, requests: SnapshotInverse["graphRequests"], restores: string[]): string[] {
  const policyRef = isGuid(p.id) ? `Get-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId ${psq(p.id)}` : `Get-CaPolicyByName ${psq(p.displayName)}`;
  const groupIds = (ids: string[], names: string[]) => (ids.length && ids.every(isGuid) ? psArray(ids) : names.length ? `@(${names.map((n) => `(Get-GroupByName ${psq(n)}).Id`).join(", ")})` : "@()");
  // The full users object: every include/exclude collection, so PATCH never drops a collection (H-19).
  const body = [
    `@{ state = ${psq(p.state)}; conditions = @{ users = @{`,
    `    includeGroups = ${groupIds(p.includeGroupIds, p.includeGroups)}; excludeGroups = ${groupIds(p.excludeGroupIds, p.excludeGroups)};`,
    `    includeUsers = ${psArray(p.includeUsers)}; excludeUsers = @($policy.Conditions.Users.ExcludeUsers); includeRoles = @($policy.Conditions.Users.IncludeRoles); excludeRoles = @($policy.Conditions.Users.ExcludeRoles) } } }`,
  ].join("\n    ");
  requests.push({
    method: "PATCH",
    url: `/identity/conditionalAccess/policies/${p.id}`,
    body: { state: p.state, conditions: { users: { includeGroups: p.includeGroupIds.length ? p.includeGroupIds : p.includeGroups, excludeGroups: p.excludeGroupIds.length ? p.excludeGroupIds : p.excludeGroups, includeUsers: p.includeUsers } } },
  });
  restores.push(`${p.displayName}: state ${p.state} · exclude ${p.excludeGroups.join(", ") || "(none)"} · include ${p.includeGroups.join(", ") || "(none)"}`);
  return [`$policy = ${policyRef}`, ...sp(p.displayName, `Restore pre-change Conditional Access state (${p.state}; conditions.users as captured)`, [`Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $policy.Id -BodyParameter ${body} | Out-Null`])];
}

function nsgLines(pre: NonNullable<EntitySnapshot["nsg"]>, requests: SnapshotInverse["graphRequests"], restores: string[]): { lines: string[]; terraformDiff: string } {
  const lines: string[] = [`$nsg = Get-AzNetworkSecurityGroup -Name ${psq(pre.name)} -ResourceGroupName ${psq(pre.resourceGroup)}`];
  const body: string[] = [];
  for (const r of pre.rules) {
    const args = `-Name ${psq(r.name)} -Priority ${r.priority} -Direction ${psq(r.direction)} -Access ${psq(r.access)} -Protocol ${psq(r.protocol)} -SourcePortRange ${psq(r.sourcePortRange)} -DestinationPortRange ${psq(r.destinationPortRange)} -SourceAddressPrefix ${psq(r.sourceAddressPrefix)} -DestinationAddressPrefix ${psq(r.destinationAddressPrefix)}`;
    body.push(`if ($nsg.SecurityRules.Name -contains ${psq(r.name)}) { $nsg | Set-AzNetworkSecurityRuleConfig ${args} | Out-Null } else { $nsg | Add-AzNetworkSecurityRuleConfig ${args} | Out-Null }`);
    requests.push({ method: "PUT", url: `${pre.id ?? `/networkSecurityGroups/${pre.name}`}/securityRules/${r.name}`, body: r });
  }
  body.push(`foreach ($extra in @($nsg.SecurityRules | Where-Object { $_.Name -notin ${psArray(pre.rules.map((r) => r.name))} })) { $nsg | Remove-AzNetworkSecurityRuleConfig -Name $extra.Name | Out-Null }`);
  body.push(`$nsg.Tag = @{ ${Object.entries(pre.tags).map(([k, v]) => `${psq(k)} = ${psq(v)}`).join("; ")} }`);
  body.push("$nsg | Set-AzNetworkSecurityGroup | Out-Null");
  requests.push({ method: "PATCH", url: pre.id ?? `/networkSecurityGroups/${pre.name}`, body: { tags: pre.tags } });
  restores.push(`${pre.name}: ${pre.rules.length} rule${pre.rules.length === 1 ? "" : "s"} as captured (${pre.rules.map((r) => r.name).join(", ")}) · tags ${Object.keys(pre.tags).join(", ") || "(none)"}`);
  const terraformDiff = pre.rules.length
    ? [`--- a/demo-iac/main.tf (post-remediation)`, `+++ b/demo-iac/main.tf (rollback to the captured pre-state)`, `@@ -1,0 +1,${pre.rules.length} @@`, ...pre.rules.map((r) => `+  security_rule { name = "${r.name}" priority = ${r.priority} ${r.direction} ${r.access} ${r.protocol}/${r.destinationPortRange} from ${r.sourceAddressPrefix} } # restored by f^-1 from the snapshot`)].join("\n") + "\n"
    : "";
  lines.push(...sp(pre.name, `Restore the captured rule set and tags on ${pre.name}`, body));
  return { lines, terraformDiff };
}

function intuneLines(pre: NonNullable<EntitySnapshot["intune"]>, requests: SnapshotInverse["graphRequests"], restores: string[]): string[] {
  const lines: string[] = [];
  for (const p of pre.policies) {
    if (p.kind !== "Device Configuration") continue;
    const groups = p.assignedTo.filter((g) => g && g !== "Tenant Assignment");
    lines.push(`$profile = Get-MgDeviceManagementDeviceConfiguration -All | Where-Object { $_.DisplayName -like ${psq(`*${p.name}`)} } | Select-Object -First 1`);
    lines.push(`if (-not $profile) { throw ${psq(`Device configuration '${p.name}' not found`)} }`);
    const assignments = groups.length ? `@(${groups.map((g) => `@{ target = @{ '@odata.type' = '#microsoft.graph.groupAssignmentTarget'; groupId = (Get-GroupByName ${psq(g)}).Id } }`).join(", ")})` : "@()";
    lines.push(...sp(p.name, groups.length ? `Restore the captured assignment of ${p.name} to ${groups.join(", ")}` : `Restore ${p.name} to its captured unassigned state`, [`Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.Id)/assign" -Body (@{ assignments = ${assignments} } | ConvertTo-Json -Depth 10) -ContentType 'application/json' | Out-Null`]));
    requests.push({ method: "POST", url: `/deviceManagement/deviceConfigurations/{${p.name}}/assign`, body: { assignments: groups.map((g) => ({ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: `{${g}}` } })) } });
    restores.push(`${p.name}: assigned to ${groups.join(", ") || "(nobody)"}`);
  }
  for (const s of pre.settings) {
    if (!s.settingId || !/attacksurfacereduction/i.test(s.settingId)) continue;
    const value = s.live.trim().toLowerCase();
    const mode = value === "block" ? "block" : value === "audit" ? "audit" : null;
    if (!mode) continue;
    lines.push(`$asr = (Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/deviceManagement/configurationPolicies?$select=id,name&$top=100').value | Where-Object { $_.name -like ${psq(`*${s.policyName}`)} } | Select-Object -First 1`);
    lines.push(`if (-not $asr) { throw ${psq(`Settings Catalog policy '${s.policyName}' not found`)} }`);
    lines.push(
      ...sp(s.policyName, `Restore ASR rule ${s.settingName} to its captured value (${s.live})`, [
        '$policy = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($asr.id)"',
        '$settings = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($asr.id)/settings").value',
        "$json = ConvertTo-Json @($settings | ForEach-Object { @{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationSetting'; settingInstance = $_.settingInstance } }) -Depth 30",
        `$patched = $json -replace ${psq(`(${s.settingId})_(block|audit|warn|off)"`)}, ${psq(`$1_${mode}"`)}`,
        "$body = @{ name = $policy.name; description = $policy.description; platforms = $policy.platforms; technologies = $policy.technologies; roleScopeTagIds = $policy.roleScopeTagIds; settings = ($patched | ConvertFrom-Json -Depth 30) }",
        "Invoke-MgGraphRequest -Method PUT -Uri \"https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($asr.id)\" -Body ($body | ConvertTo-Json -Depth 30) -ContentType 'application/json' | Out-Null",
      ]),
    );
    requests.push({ method: "PUT", url: `/beta/deviceManagement/configurationPolicies/{${s.policyName}}`, body: { setting: s.settingId, value: mode } });
    restores.push(`${s.policyName} · ${s.settingName}: ${s.live}`);
  }
  return lines;
}

function workloadIdentityLines(pre: NonNullable<EntitySnapshot["workloadIdentity"]>, requests: SnapshotInverse["graphRequests"], restores: string[]): string[] {
  const lines: string[] = [`$app = Get-MgApplication -ApplicationId ${psq(pre.appObjectId)}`, `$sp = Get-MgServicePrincipal -ServicePrincipalId ${psq(pre.servicePrincipalId)}`];
  // FICs the fix created: everything not captured, removed by the id Graph returns, never by a name (H-19).
  lines.push(
    ...sp(pre.displayName, "Remove federated identity credentials the fix created (by their looked-up id)", [
      `foreach ($fic in @(Get-MgApplicationFederatedIdentityCredential -ApplicationId $app.Id | Where-Object { $_.Name -notin ${psArray(pre.federatedCredentialNames)} })) { Remove-MgApplicationFederatedIdentityCredential -ApplicationId $app.Id -FederatedIdentityCredentialId $fic.Id }`,
    ]),
  );
  requests.push({ method: "DELETE", url: `/applications/${pre.appObjectId}/federatedIdentityCredentials/{id looked up by name not in [${pre.federatedCredentialNames.join(", ")}]}` });
  for (const owner of pre.owners) {
    lines.push(...sp(owner, "Restore the captured application owner", [`$o = Get-MgUser -UserId ${psq(owner)} -Property Id`, `if (-not (Get-MgApplicationOwner -ApplicationId $app.Id -All | Where-Object Id -eq $o.Id)) { New-MgApplicationOwnerByRef -ApplicationId $app.Id -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($o.Id)" } }`]));
    requests.push({ method: "POST", url: `/applications/${pre.appObjectId}/owners/$ref`, body: { "@odata.id": `https://graph.microsoft.com/v1.0/users/${owner}` } });
  }
  if (pre.appRoleAssignments.length) {
    lines.push("$graphSp = Get-MgServicePrincipal -Filter \"appId eq '00000003-0000-0000-c000-000000000000'\" -Top 1");
    lines.push("$have = @(Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -All | ForEach-Object AppRoleId)");
    for (const a of pre.appRoleAssignments) {
      lines.push(...sp(a.permission, "Restore the captured app-role assignment", [`if ($have -notcontains ${psq(a.appRoleId)}) { New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $graphSp.Id -AppRoleId ${psq(a.appRoleId)} | Out-Null }`]));
      requests.push({ method: "POST", url: `/servicePrincipals/${pre.servicePrincipalId}/appRoleAssignments`, body: { principalId: pre.servicePrincipalId, resourceId: "{graph sp}", appRoleId: a.appRoleId } });
    }
  }
  lines.push("# Not restored on purpose: an expired client secret cannot be re-created; a revoked delegated grant needs an admin to re-consent.");
  restores.push(`${pre.displayName}: owners ${pre.owners.join(", ") || "(none)"} · ${pre.appRoleAssignments.length} app-role assignment(s) · fix-created FICs removed`);
  return lines;
}

export function buildInverseFromSnapshot(pre: EntitySnapshot, executed: Pick<ActionApprovalDrawer, "powershellScript" | "graphPatch" | "terraformDiff" | "affectedEntities">): SnapshotInverse {
  const sections = touchedSections(pre, executed);
  const requests: SnapshotInverse["graphRequests"] = [];
  const restores: string[] = [];
  const body: string[] = [];
  let terraformDiff = "";
  const modules = new Set<string>(["Microsoft.Graph.Users"]);
  if (sections.includes("users")) {
    modules.add("Microsoft.Graph.Users.Actions").add("Microsoft.Graph.Groups").add("Microsoft.Graph.Identity.DirectoryManagement");
    for (const u of pre.users) body.push(...userLines(u, requests, restores));
  }
  if (sections.includes("conditional-access")) {
    modules.add("Microsoft.Graph.Groups").add("Microsoft.Graph.Identity.SignIns");
    for (const p of pre.caPolicies) body.push(...caLines(p, requests, restores));
  }
  if (sections.includes("nsg") && pre.nsg) {
    modules.add("Az.Network");
    const nsg = nsgLines(pre.nsg, requests, restores);
    body.push(...nsg.lines);
    terraformDiff = nsg.terraformDiff;
  }
  if (sections.includes("intune") && pre.intune) {
    modules.add("Microsoft.Graph.Groups").add("Microsoft.Graph.DeviceManagement");
    body.push(...intuneLines(pre.intune, requests, restores));
  }
  if (sections.includes("workload-identity") && pre.workloadIdentity) {
    modules.add("Microsoft.Graph.Applications");
    body.push(...workloadIdentityLines(pre.workloadIdentity, requests, restores));
  }
  const powershellScript = [
    "#Requires -Version 7.0",
    `#Requires -Modules ${[...modules].join(", ")}`,
    "[CmdletBinding(SupportsShouldProcess)]",
    "param([string]$TenantId)",
    "$ErrorActionPreference = 'Stop'",
    `# ContextPane inverse rollback f^-1 for ${pre.scenarioId}: restores the state captured at ${pre.capturedAt} (${sections.join(", ")})`,
    "if (-not (Get-MgContext)) { throw 'No Microsoft Graph context. Connect-MgGraph first.' }",
    ...RESOLVERS,
    ...body,
    "",
  ].join("\n");
  return {
    scenarioId: pre.scenarioId,
    inverseSource: "pre-snapshot",
    sections,
    powershellScript,
    terraformDiff,
    hcl: terraformDiff,
    graphPatch: JSON.stringify({ scenarioId: pre.scenarioId, inverseOf: "the approved bundle", capturedAt: pre.capturedAt, requests }, null, 2),
    graphRequests: requests,
    restores,
    ...(body.length ? {} : { note: "the snapshot holds no entity the bundle touched; nothing to revert" }),
  };
}
