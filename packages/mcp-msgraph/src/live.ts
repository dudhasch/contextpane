import { psq, runPwshJson } from "./pwsh.ts";

/**
 * Live Microsoft Graph queries executed through PowerShell 7 + Microsoft.Graph.
 * Requires an existing `Connect-MgGraph` context in the orchestrator's environment
 * (delegated, device code or app-only). Every function throws on failure so the
 * service layer can fall back to the manifest.
 */

export interface LiveGroupMembersResult {
  group: { objectId: string; displayName: string; description: string | null; mailNickname: string | null };
  users: Array<{
    objectId: string;
    upn: string;
    displayName: string;
    jobTitle: string | null;
    department: string | null;
    usageLocation: string | null;
    assignedSkuIds: string[];
    extension: Record<string, unknown> | null;
  }>;
}

export interface LiveSubscribedSku {
  skuId: string;
  skuPartNumber: string;
  consumedUnits: number;
  enabledUnits: number;
}

export interface LiveCaPolicy {
  id: string;
  displayName: string;
  state: string;
  createdDateTime: string | null;
  modifiedDateTime: string | null;
  includeGroups: string[];
  excludeGroups: string[];
  includeUsers: string[];
  includeApplications: string[];
  clientAppTypes: string[];
  grantOperator: string | null;
  builtInControls: string[];
}

export interface LiveSignIn {
  id: string;
  createdDateTime: string;
  userPrincipalName: string;
  userDisplayName: string;
  appId: string;
  appDisplayName: string;
  clientAppUsed: string | null;
  ipAddress: string | null;
  city: string | null;
  countryOrRegion: string | null;
  deviceDisplayName: string | null;
  operatingSystem: string | null;
  isCompliant: boolean | null;
  trustType: string | null;
  errorCode: number;
  failureReason: string | null;
  conditionalAccessStatus: string | null;
  appliedPolicies: Array<{ id: string; displayName: string; result: string; enforcedGrantControls: string[] }>;
}

/**
 * Graph contexts are per-process (Connect-MgGraph does not persist a token cache
 * across pwsh invocations), while the Az token cache does. When no Graph context
 * exists, mint a Graph access token from the cached Az sign-in and hand it to
 * Connect-MgGraph -AccessToken, so a single `Connect-AzAccount` on the machine is
 * enough for both MCP servers. Falls through to the original error when neither exists.
 */
const REQUIRE_CONTEXT = `
if (-not (Get-Command Get-MgContext -ErrorAction SilentlyContinue)) { throw 'Microsoft.Graph.Authentication module is not installed.' }
$ctx = Get-MgContext
if (-not $ctx -and (Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue)) {
  try {
    $azTok = Get-AzAccessToken -ResourceUrl 'https://graph.microsoft.com' -AsSecureString -ErrorAction Stop
    Connect-MgGraph -AccessToken $azTok.Token -NoWelcome -ErrorAction Stop
    $ctx = Get-MgContext
  } catch { $ctx = $null }
}
if (-not $ctx) { throw 'No Microsoft Graph context. Run Connect-MgGraph or Connect-AzAccount first.' }
`;

export async function fetchGroupMembersLive(groupDisplayName: string, timeoutMs: number): Promise<LiveGroupMembersResult> {
  const script = `
${REQUIRE_CONTEXT}
$g = Get-MgGroup -Filter ("displayName eq " + ${psq(`'${groupDisplayName.replace(/'/g, "''")}'`)}) -Property Id,DisplayName,Description,MailNickname -Top 1
if (-not $g) { throw ("Group not found: " + ${psq(groupDisplayName)}) }
$members = @(Get-MgGroupMember -GroupId $g.Id -All)
$users = foreach ($m in $members) {
  $u = $null
  try { $u = Get-MgUser -UserId $m.Id -Property Id,UserPrincipalName,DisplayName,JobTitle,Department,UsageLocation,AssignedLicenses -ErrorAction Stop } catch { continue }
  $extProps = $null
  try {
    $ext = Get-MgUserExtension -UserId $u.Id -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 'com.contextpane.licenseState' } | Select-Object -First 1
    if ($ext) { $extProps = $ext.AdditionalProperties }
  } catch {}
  [pscustomobject]@{
    objectId       = $u.Id
    upn            = $u.UserPrincipalName
    displayName    = $u.DisplayName
    jobTitle       = $u.JobTitle
    department     = $u.Department
    usageLocation  = $u.UsageLocation
    assignedSkuIds = @($u.AssignedLicenses | ForEach-Object { $_.SkuId })
    extension      = $extProps
  }
}
[pscustomobject]@{
  group = [pscustomobject]@{ objectId = $g.Id; displayName = $g.DisplayName; description = $g.Description; mailNickname = $g.MailNickname }
  users = @($users)
} | ConvertTo-Json -Depth 8 -Compress
`;
  return runPwshJson<LiveGroupMembersResult>(script, { timeoutMs });
}

export async function fetchSubscribedSkusLive(timeoutMs: number): Promise<LiveSubscribedSku[]> {
  const script = `
${REQUIRE_CONTEXT}
$skus = @(Get-MgSubscribedSku -All | ForEach-Object {
  [pscustomobject]@{ skuId = $_.SkuId; skuPartNumber = $_.SkuPartNumber; consumedUnits = [int]$_.ConsumedUnits; enabledUnits = [int]$_.PrepaidUnits.Enabled }
})
ConvertTo-Json -InputObject $skus -Depth 4 -Compress
`;
  const result = await runPwshJson<LiveSubscribedSku[] | LiveSubscribedSku>(script, { timeoutMs });
  return Array.isArray(result) ? result : [result];
}

export async function fetchConditionalAccessPoliciesLive(prefix: string, timeoutMs: number): Promise<LiveCaPolicy[]> {
  const script = `
${REQUIRE_CONTEXT}
$all = @(Get-MgIdentityConditionalAccessPolicy -All)
# StartsWith, not -like: the '[' in '[ContextPane-Demo]' is a wildcard character set to -like
$sel = @($all | Where-Object { $_.DisplayName -and $_.DisplayName.StartsWith(${psq(prefix)}) } | ForEach-Object {
  [pscustomobject]@{
    id                  = $_.Id
    displayName         = $_.DisplayName
    state               = [string]$_.State
    createdDateTime     = if ($_.CreatedDateTime) { $_.CreatedDateTime.ToString('o') } else { $null }
    modifiedDateTime    = if ($_.ModifiedDateTime) { $_.ModifiedDateTime.ToString('o') } else { $null }
    includeGroups       = @($_.Conditions.Users.IncludeGroups)
    excludeGroups       = @($_.Conditions.Users.ExcludeGroups)
    includeUsers        = @($_.Conditions.Users.IncludeUsers)
    includeApplications = @($_.Conditions.Applications.IncludeApplications)
    clientAppTypes      = @($_.Conditions.ClientAppTypes)
    grantOperator       = $_.GrantControls.Operator
    builtInControls     = @($_.GrantControls.BuiltInControls)
  }
})
ConvertTo-Json -InputObject $sel -Depth 6 -Compress
`;
  const result = await runPwshJson<LiveCaPolicy[] | LiveCaPolicy>(script, { timeoutMs });
  return Array.isArray(result) ? result : [result];
}

export async function fetchSignInEventsLive(upns: string[], top: number, timeoutMs: number): Promise<LiveSignIn[]> {
  const filter = upns.map((u) => `userPrincipalName eq '${u.replace(/'/g, "''")}'`).join(" or ");
  const script = `
${REQUIRE_CONTEXT}
$events = @(Get-MgAuditLogSignIn -Filter ${psq(filter)} -Top ${Math.max(1, Math.min(top, 100))} -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    id                      = $_.Id
    createdDateTime         = $_.CreatedDateTime.ToString('o')
    userPrincipalName       = $_.UserPrincipalName
    userDisplayName         = $_.UserDisplayName
    appId                   = $_.AppId
    appDisplayName          = $_.AppDisplayName
    clientAppUsed           = $_.ClientAppUsed
    ipAddress               = $_.IPAddress
    city                    = $_.Location.City
    countryOrRegion         = $_.Location.CountryOrRegion
    deviceDisplayName       = $_.DeviceDetail.DisplayName
    operatingSystem         = $_.DeviceDetail.OperatingSystem
    isCompliant             = $_.DeviceDetail.IsCompliant
    trustType               = $_.DeviceDetail.TrustType
    errorCode               = [int]$_.Status.ErrorCode
    failureReason           = $_.Status.FailureReason
    conditionalAccessStatus = [string]$_.ConditionalAccessStatus
    appliedPolicies         = @($_.AppliedConditionalAccessPolicies | ForEach-Object {
      [pscustomobject]@{ id = $_.Id; displayName = $_.DisplayName; result = [string]$_.Result; enforcedGrantControls = @($_.EnforcedGrantControls) }
    })
  }
})
ConvertTo-Json -InputObject $events -Depth 6 -Compress
`;
  const result = await runPwshJson<LiveSignIn[] | LiveSignIn>(script, { timeoutMs });
  return Array.isArray(result) ? result : [result];
}

export async function fetchGraphContextLive(timeoutMs: number): Promise<{ tenantId: string; account: string | null; scopes: string[] }> {
  const script = `
${REQUIRE_CONTEXT}
[pscustomobject]@{ tenantId = $ctx.TenantId; account = $ctx.Account; scopes = @($ctx.Scopes) } | ConvertTo-Json -Depth 3 -Compress
`;
  return runPwshJson(script, { timeoutMs });
}
