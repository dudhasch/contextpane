#Requires -Version 7.0
<#
.SYNOPSIS
    Leaves a delegated Microsoft Graph PowerShell sign-in the orchestrator can reuse for the
    Conditional Access and Intune writes behind Approve & Execute.

.DESCRIPTION
    The bearer token the orchestrator mints with Get-AzAccessToken belongs to the Azure PowerShell
    client (1950a258-227b-4e31-a9cf-717495945fc2). It can read the lab and write the license
    extension, but it never carries Policy.ReadWrite.ConditionalAccess or
    DeviceManagementConfiguration.ReadWrite.All, so the ANOM-CA-204, ANOM-INT-309 and INC-4099 fixes
    fall back to a labelled simulated write.

    This script:
      1. Connect-MgGraph -TenantId <id> -Scopes Policy.Read.All, Policy.ReadWrite.ConditionalAccess,
         Group.ReadWrite.All, User.ReadWrite.All, DeviceManagementConfiguration.ReadWrite.All
         -ContextScope CurrentUser -DeviceCode. The sign-in is yours and interactive; CurrentUser
         persists it to ~/.mg so the orchestrator can mint the same token silently later. An existing
         session that already has the scopes is reused.
      2. Mints a Graph token from the Microsoft.Graph session, falling back to Get-AzAccessToken when
         there is no Connect-MgGraph session, and reports its client and which of the write scopes it
         carries. The token itself is never printed or stored.

    The signed-in account also needs a role that may change Conditional Access (Conditional Access
    Administrator or Security Administrator) and Intune configuration (Intune Administrator).
    Invoke-SeedContextPaneLab.ps1 runs this script before it seeds the anomaly objects. Supports -WhatIf.

.EXAMPLE
    pwsh -NoProfile -File ./scripts/Connect-ContextPaneGraph.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TenantId = $(if ($env:CTX_LAB_TENANT_ID) { $env:CTX_LAB_TENANT_ID } else { '4cc41c20-8b01-40a3-93c6-b4f1e846f6ea' })
)

$ErrorActionPreference = 'Stop'
$RequiredScopes = @(
    'Policy.Read.All'
    'Policy.ReadWrite.ConditionalAccess'
    'Group.ReadWrite.All'
    'User.ReadWrite.All'
    'DeviceManagementConfiguration.ReadWrite.All'
)
$WriteScopes = @('Policy.ReadWrite.ConditionalAccess', 'DeviceManagementConfiguration.ReadWrite.All')

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    [OK] $Message" -ForegroundColor Green }

function Get-JwtClaims([string]$Jwt) {
    $payload = $Jwt.Split('.')[1].Replace('-', '+').Replace('_', '/')
    switch ($payload.Length % 4) { 2 { $payload += '==' } 3 { $payload += '=' } }
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
}

<#
    A Graph bearer token: from the active Microsoft.Graph session when there is one (its client can carry
    the Conditional Access and Intune write scopes), otherwise from the Az sign-in. Returned as a SecureString.
#>
function Get-ContextPaneGraphToken {
    if (Get-MgContext) {
        $response = Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/organization?$select=id' -OutputType HttpResponseMessage
        $bearer = $response.RequestMessage.Headers.Authorization.Parameter
        if ($bearer) {
            return [pscustomobject]@{ Source = 'Connect-MgGraph'; Token = (ConvertTo-SecureString $bearer -AsPlainText -Force) }
        }
    }
    if ((Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue) -and (Get-AzContext -ErrorAction SilentlyContinue)) {
        $az = Get-AzAccessToken -ResourceUrl 'https://graph.microsoft.com' -AsSecureString
        return [pscustomobject]@{ Source = 'Get-AzAccessToken'; Token = $az.Token }
    }
    throw 'No Connect-MgGraph session and no Connect-AzAccount context to mint a Graph token from.'
}

if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    throw "Microsoft.Graph.Authentication is not installed. Run: pwsh -NoProfile -File $(Join-Path $PSScriptRoot 'Install-ContextPaneModules.ps1')"
}
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

# ---------------------------------------------------------------------------
# 1. Delegated Microsoft Graph sign-in, persisted for the orchestrator
# ---------------------------------------------------------------------------
Write-Step 'Microsoft Graph sign-in'
$mg = Get-MgContext
$missingScopes = @($RequiredScopes | Where-Object { -not $mg -or $mg.Scopes -notcontains $_ })
if (-not $mg -or $mg.TenantId -ne $TenantId -or $missingScopes.Count -gt 0 -or "$($mg.ContextScope)" -ne 'CurrentUser') {
    # Keep the scopes an existing session in this tenant already has (the seed script needs them too).
    $scopes = @($RequiredScopes) + @($(if ($mg -and $mg.TenantId -eq $TenantId) { $mg.Scopes } else { @() })) | Sort-Object -Unique
    Write-Host "    Connect-MgGraph -TenantId $TenantId -ContextScope CurrentUser -Scopes $($scopes -join ', ')"
    if ($PSCmdlet.ShouldProcess($TenantId, 'Connect-MgGraph (device code, persisted to ~/.mg)')) {
        Connect-MgGraph -TenantId $TenantId -Scopes $scopes -ContextScope CurrentUser -NoWelcome -DeviceCode
    }
    $mg = Get-MgContext
}
if (-not $mg) { throw 'Connect-MgGraph did not produce a context.' }
if ($mg.TenantId -ne $TenantId) { throw "Graph context is tenant $($mg.TenantId); expected $TenantId." }
$stillMissing = @($RequiredScopes | Where-Object { $mg.Scopes -notcontains $_ })
if ($stillMissing.Count -gt 0) { Write-Warning "Graph context is missing scopes after sign-in: $($stillMissing -join ', '). Consent to them and re-run." }
else { Write-Ok "$($mg.Account) @ $($mg.TenantId) · $($mg.ContextScope)" }

# ---------------------------------------------------------------------------
# 2. The token the orchestrator will use for Conditional Access and Intune writes
# ---------------------------------------------------------------------------
Write-Step 'Graph token for Approve & Execute'
$minted = Get-ContextPaneGraphToken
$claims = Get-JwtClaims ([System.Net.NetworkCredential]::new('', $minted.Token).Password)
$scp = @("$($claims.scp)".Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
$missingWrite = @($WriteScopes | Where-Object { $scp -notcontains $_ })
if ($missingWrite.Count -eq 0) {
    Write-Ok "$($minted.Source) (client $($claims.appid)) carries $($WriteScopes -join ' and ')"
} else {
    Write-Warning "$($minted.Source) (client $($claims.appid)) lacks $($missingWrite -join ', '); those fixes stay simulated."
}

[pscustomobject]@{
    Tenant       = $mg.TenantId
    Account      = $mg.Account
    TokenSource  = $minted.Source
    WriteScopes  = $(if ($missingWrite.Count) { "missing: $($missingWrite -join ', ')" } else { 'all present' })
    PersistedFor = $(if (Test-Path (Join-Path $HOME '.mg/mg.authrecord.json')) { 'orchestrator (~/.mg)' } else { 'this process only' })
} | Format-List
