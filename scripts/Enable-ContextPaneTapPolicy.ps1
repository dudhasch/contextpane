#Requires -Version 7.0
<#
.SYNOPSIS
    Enables the lab tenant's Temporary Access Pass policy and leaves a Microsoft Graph PowerShell
    sign-in the orchestrator can reuse for the [Issue TAP] hover action.

.DESCRIPTION
    [Issue TAP] calls POST /users/{id}/authentication/temporaryAccessPassMethods. The bearer token the
    orchestrator mints with Get-AzAccessToken belongs to the Azure PowerShell client
    (1950a258-227b-4e31-a9cf-717495945fc2), which never carries UserAuthenticationMethod.ReadWrite.All,
    so Graph answers 403 and the UI shows the labelled fallback pass.

    This script:
      1. Connect-MgGraph -TenantId <id> -Scopes Policy.ReadWrite.AuthenticationMethod,
         UserAuthenticationMethod.ReadWrite.All -ContextScope CurrentUser. The sign-in is yours and
         interactive; CurrentUser persists it to ~/.mg so the orchestrator can mint the same token
         silently later. An existing session that already has the scopes is reused.
      2. PATCHes authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass to
         state = enabled, isUsableOnce = true, defaultLifetimeInMinutes = 60 (idempotent).
      3. Mints a Graph token from the Microsoft.Graph session, falling back to Get-AzAccessToken when
         there is no Connect-MgGraph session, and reports its client and whether it carries
         UserAuthenticationMethod.ReadWrite.All. The token itself is never printed or stored.

    Issuing a TAP also needs the signed-in account to hold Authentication Administrator,
    Privileged Authentication Administrator or Global Administrator. Supports -WhatIf.
    Invoke-SeedContextPaneLab.ps1 runs this script after the Conditional Access step.

.EXAMPLE
    pwsh -NoProfile -File ./scripts/Enable-ContextPaneTapPolicy.ps1
.EXAMPLE
    pwsh -NoProfile -File ./scripts/Enable-ContextPaneTapPolicy.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TenantId = $(if ($env:CTX_LAB_TENANT_ID) { $env:CTX_LAB_TENANT_ID } else { '4cc41c20-8b01-40a3-93c6-b4f1e846f6ea' }),
    [ValidateRange(60, 480)]
    [int]$DefaultLifetimeInMinutes = 60
)

$ErrorActionPreference = 'Stop'
$RequiredScopes = @('Policy.ReadWrite.AuthenticationMethod', 'UserAuthenticationMethod.ReadWrite.All')
$TapPolicyUri = 'https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Keep([string]$Message) { Write-Host "    [=] $Message" -ForegroundColor DarkGray }

function Get-JwtClaims([string]$Jwt) {
    $payload = $Jwt.Split('.')[1].Replace('-', '+').Replace('_', '/')
    switch ($payload.Length % 4) { 2 { $payload += '==' } 3 { $payload += '=' } }
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
}

<#
    A Graph bearer token: from the active Microsoft.Graph session when there is one (its client can carry
    UserAuthenticationMethod.ReadWrite.All), otherwise from the Az sign-in. Returned as a SecureString.
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
# 1. Microsoft Graph sign-in with the TAP scopes, persisted for the orchestrator
# ---------------------------------------------------------------------------
Write-Step 'Microsoft Graph sign-in'
$mg = Get-MgContext
$missingScopes = @($RequiredScopes | Where-Object { -not $mg -or $mg.Scopes -notcontains $_ })
if (-not $mg -or $mg.TenantId -ne $TenantId -or $missingScopes.Count -gt 0 -or "$($mg.ContextScope)" -ne 'CurrentUser') {
    # Keep the scopes an existing session in this tenant already has (the seed script needs them too).
    $scopes = @($RequiredScopes) + @($(if ($mg -and $mg.TenantId -eq $TenantId) { $mg.Scopes } else { @() })) | Sort-Object -Unique
    Write-Host "    Connect-MgGraph -TenantId $TenantId -ContextScope CurrentUser -Scopes $($scopes -join ', ')"
    Connect-MgGraph -TenantId $TenantId -Scopes $scopes -ContextScope CurrentUser -NoWelcome
    $mg = Get-MgContext
}
if (-not $mg) { throw 'Connect-MgGraph did not produce a context.' }
if ($mg.TenantId -ne $TenantId) { throw "Graph context is tenant $($mg.TenantId); expected $TenantId." }
$stillMissing = @($RequiredScopes | Where-Object { $mg.Scopes -notcontains $_ })
if ($stillMissing.Count -gt 0) { throw "Graph context is missing scopes after sign-in: $($stillMissing -join ', '). Consent to them and re-run." }
Write-Ok "$($mg.Account) @ $($mg.TenantId) · $($mg.ContextScope) · $($RequiredScopes -join ', ')"

# ---------------------------------------------------------------------------
# 2. Temporary Access Pass authentication method policy
# ---------------------------------------------------------------------------
Write-Step 'Temporary Access Pass policy'
$current = Invoke-MgGraphRequest -Method GET -Uri $TapPolicyUri
if ($current.state -eq 'enabled' -and $current.isUsableOnce -eq $true -and $current.defaultLifetimeInMinutes -eq $DefaultLifetimeInMinutes) {
    Write-Keep "already enabled · one-time · $DefaultLifetimeInMinutes min"
} elseif ($PSCmdlet.ShouldProcess('TemporaryAccessPass authentication method policy', "enable (one-time, $DefaultLifetimeInMinutes min)")) {
    $body = @{
        '@odata.type'            = '#microsoft.graph.temporaryAccessPassAuthenticationMethodConfiguration'
        state                    = 'enabled'
        isUsableOnce             = $true
        defaultLifetimeInMinutes = $DefaultLifetimeInMinutes
    }
    Invoke-MgGraphRequest -Method PATCH -Uri $TapPolicyUri -Body ($body | ConvertTo-Json) -ContentType 'application/json'
    Write-Ok "enabled (was $($current.state)) · one-time · $DefaultLifetimeInMinutes min"
}

# ---------------------------------------------------------------------------
# 3. The token the orchestrator will use for [Issue TAP]
# ---------------------------------------------------------------------------
Write-Step 'Graph token for [Issue TAP]'
$minted = Get-ContextPaneGraphToken
$claims = Get-JwtClaims ([System.Net.NetworkCredential]::new('', $minted.Token).Password)
$scp = @("$($claims.scp)".Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
$canIssue = $scp -contains 'UserAuthenticationMethod.ReadWrite.All'
if ($canIssue) {
    Write-Ok "$($minted.Source) (client $($claims.appid)) carries UserAuthenticationMethod.ReadWrite.All"
} else {
    Write-Warning "$($minted.Source) (client $($claims.appid)) lacks UserAuthenticationMethod.ReadWrite.All; [Issue TAP] keeps returning the labelled fallback pass."
}

[pscustomobject]@{
    Tenant        = $mg.TenantId
    Account       = $mg.Account
    TapPolicy     = $(if ($WhatIfPreference) { "$($current.state) (WhatIf)" } else { 'enabled' })
    TokenSource   = $minted.Source
    CanIssueTap   = $canIssue
    PersistedFor  = $(if (Test-Path (Join-Path $HOME '.mg/mg.authrecord.json')) { 'orchestrator (~/.mg)' } else { 'this process only' })
} | Format-List
