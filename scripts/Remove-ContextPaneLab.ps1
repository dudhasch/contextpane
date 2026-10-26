#Requires -Version 7.0
<#
.SYNOPSIS
    Tears down the ContextPane demo lab created by Invoke-SeedContextPaneLab.ps1.

.DESCRIPTION
    Removes, in this order and only by exact name:
      1. Conditional Access policies "[ContextPane-Demo] Block AVD - Contoso Finance Legacy",
         "[ContextPane-Demo] CA-001-Require-PhishingResistant-MFA-Admins" and
         "[ContextPane-Demo] CA-004-Block-Legacy-Auth"
      2. Intune Settings Catalog policies and device configurations named "[ContextPane-Demo] ..."
         by the seed script (Intune-Win11-ASR-Baseline, EndpointSecurity-Firewall-Prod,
         Fabrikam-EndpointSecurity-DiskEncryption, Win11-Firewall-MDM, Fabrikam-Legacy-BitLocker-DeviceConfig)
      3. Security groups SG-Contoso-Finance-AVD, SG-Contoso-Finance-Legacy, SG-Contoso-M365-E5,
         SG-BreakGlass-Accounts, SG-ContextPane-Demo-Admins, SG-All-Workstations, SG-Fabrikam-Win11-Devices
      4. The demo users (lynne.robins.contoso@..., alex.wilber.contoso@..., miriam.graham.contoso@...,
         diego.siciliani.contoso@..., patti.fernandez.contoso@..., the ANOM-LIC-101 users and bg-admin-01@...)
      5. Azure resource group rg-contoso-avd-prod (and everything inside it)
      6. Resets liveSeeded=false in ./demo-iac/demo-lab-manifest.json

    Nothing else in the tenant or subscription is touched. Supports -WhatIf. Prompts once
    unless -Force is given.

.EXAMPLE
    pwsh ./scripts/Remove-ContextPaneLab.ps1 -WhatIf
.EXAMPLE
    pwsh ./scripts/Remove-ContextPaneLab.ps1 -Force
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$TenantId = $(if ($env:CTX_LAB_TENANT_ID) { $env:CTX_LAB_TENANT_ID } else { '4cc41c20-8b01-40a3-93c6-b4f1e846f6ea' }),
    [string]$SubscriptionId = $(if ($env:CTX_LAB_SUBSCRIPTION_ID) { $env:CTX_LAB_SUBSCRIPTION_ID } else { '20505597-043c-4742-a884-42dc3f621aef' }),
    [string]$Domain = $(if ($env:CTX_LAB_DOMAIN) { $env:CTX_LAB_DOMAIN } else { 'c4a8shili.onmicrosoft.com' }),
    [switch]$SkipGraph,
    [switch]$SkipAzure,
    [switch]$KeepUsers,
    [switch]$Force,
    [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ManifestPath) { $ManifestPath = Join-Path $repoRoot 'demo-iac' 'demo-lab-manifest.json' }

$PolicyNames = @(
    '[ContextPane-Demo] Block AVD - Contoso Finance Legacy'
    '[ContextPane-Demo] CA-001-Require-PhishingResistant-MFA-Admins'
    '[ContextPane-Demo] CA-004-Block-Legacy-Auth'
)
$IntuneSettingsCatalog = @('Intune-Win11-ASR-Baseline', 'EndpointSecurity-Firewall-Prod', 'Fabrikam-EndpointSecurity-DiskEncryption') | ForEach-Object { "[ContextPane-Demo] $_" }
$IntuneDeviceConfigs = @('Win11-Firewall-MDM', 'Fabrikam-Legacy-BitLocker-DeviceConfig') | ForEach-Object { "[ContextPane-Demo] $_" }
$GroupNames = @('SG-Contoso-Finance-AVD', 'SG-Contoso-Finance-Legacy', 'SG-Contoso-M365-E5', 'SG-BreakGlass-Accounts', 'SG-ContextPane-Demo-Admins', 'SG-All-Workstations', 'SG-Fabrikam-Win11-Devices')
$UserMails = @(
    'lynne.robins.contoso', 'alex.wilber.contoso', 'miriam.graham.contoso', 'diego.siciliani.contoso', 'patti.fernandez.contoso'
    'henrietta.mueller.contoso', 'pradeep.gupta.contoso', 'christie.cline.contoso', 'adele.vance.contoso', 'joni.sherman.contoso', 'bg-admin-01'
)
$ResourceGroupName = 'rg-contoso-avd-prod'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Keep([string]$Message) { Write-Host "    [-] $Message" -ForegroundColor DarkGray }

function Assert-Module([string[]]$Names) {
    $missing = $Names | Where-Object { -not (Get-Module -ListAvailable -Name $_) }
    if ($missing) { throw "Missing PowerShell modules: $($missing -join ', '). Install with: Install-Module $($missing -join ',') -Scope CurrentUser" }
    foreach ($n in $Names) { Import-Module $n -ErrorAction Stop }
}
if (-not $SkipGraph) { Assert-Module @('Microsoft.Graph.Authentication', 'Microsoft.Graph.Users', 'Microsoft.Graph.Groups', 'Microsoft.Graph.Identity.SignIns') }
if (-not $SkipAzure) { Assert-Module @('Az.Accounts', 'Az.Resources') }

if (-not $Force -and -not $WhatIfPreference) {
    if (-not $PSCmdlet.ShouldContinue("Remove the ContextPane demo lab from tenant $TenantId and subscription $SubscriptionId?", 'Confirm teardown')) { return }
}

if (-not $SkipGraph) {
    $mg = Get-MgContext
    if (-not $mg) { throw 'No Microsoft Graph context. Run Connect-MgGraph first.' }
    if ($mg.TenantId -ne $TenantId) { throw "Graph context is tenant $($mg.TenantId); expected $TenantId." }

    Write-Step 'Conditional Access'
    $policy = Get-MgIdentityConditionalAccessPolicy -All -ErrorAction SilentlyContinue | Where-Object { $PolicyNames -contains $_.DisplayName }
    foreach ($p in $policy) {
        if ($PSCmdlet.ShouldProcess($p.DisplayName, 'Remove-MgIdentityConditionalAccessPolicy')) {
            Remove-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $p.Id
            Write-Ok "removed $($p.DisplayName) ($($p.Id))"
        }
    }
    if (-not $policy) { Write-Keep 'policies not present' }

    Write-Step 'Intune'
    try {
        $beta = 'https://graph.microsoft.com/beta/deviceManagement'
        $v1 = 'https://graph.microsoft.com/v1.0/deviceManagement'
        $catalog = @((Invoke-MgGraphRequest -Method GET -Uri "$beta/configurationPolicies?`$select=id,name&`$top=100").value) | Where-Object { $IntuneSettingsCatalog -contains $_.name }
        foreach ($c in $catalog) {
            if ($PSCmdlet.ShouldProcess($c.name, 'DELETE configurationPolicies')) {
                Invoke-MgGraphRequest -Method DELETE -Uri "$beta/configurationPolicies/$($c.id)"
                Write-Ok "removed $($c.name)"
            }
        }
        $configs = @((Invoke-MgGraphRequest -Method GET -Uri "$v1/deviceConfigurations?`$select=id,displayName").value) | Where-Object { $IntuneDeviceConfigs -contains $_.displayName }
        foreach ($c in $configs) {
            if ($PSCmdlet.ShouldProcess($c.displayName, 'DELETE deviceConfigurations')) {
                Invoke-MgGraphRequest -Method DELETE -Uri "$v1/deviceConfigurations/$($c.id)"
                Write-Ok "removed $($c.displayName)"
            }
        }
        if (-not $catalog -and -not $configs) { Write-Keep 'Intune objects not present' }
    } catch {
        Write-Warning "Intune teardown skipped: $($_.Exception.Message) (needs DeviceManagementConfiguration.ReadWrite.All)"
    }

    Write-Step 'Groups'
    foreach ($name in $GroupNames) {
        $groups = Get-MgGroup -Filter "displayName eq '$name'" -ErrorAction SilentlyContinue
        foreach ($g in $groups) {
            if ($PSCmdlet.ShouldProcess($name, 'Remove-MgGroup')) {
                Remove-MgGroup -GroupId $g.Id
                Write-Ok "removed $name ($($g.Id))"
            }
        }
        if (-not $groups) { Write-Keep "$name not present" }
    }

    if (-not $KeepUsers) {
        Write-Step 'Users'
        foreach ($mail in $UserMails) {
            $upn = "$mail@$Domain"
            $u = Get-MgUser -Filter "userPrincipalName eq '$upn'" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($u) {
                if ($PSCmdlet.ShouldProcess($upn, 'Remove-MgUser')) {
                    Remove-MgUser -UserId $u.Id
                    Write-Ok "removed $upn"
                }
            } else { Write-Keep "$upn not present" }
        }
    }
}

if (-not $SkipAzure) {
    $az = Get-AzContext
    if (-not $az) { throw 'No Azure context. Run Connect-AzAccount first.' }
    if ($az.Subscription.Id -ne $SubscriptionId) { $null = Set-AzContext -SubscriptionId $SubscriptionId -TenantId $TenantId }

    Write-Step 'Azure'
    $rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction SilentlyContinue
    if ($rg) {
        if ($PSCmdlet.ShouldProcess($ResourceGroupName, 'Remove-AzResourceGroup')) {
            $null = Remove-AzResourceGroup -Name $ResourceGroupName -Force
            Write-Ok "removed $ResourceGroupName"
        }
    } else { Write-Keep "$ResourceGroupName not present" }
}

Write-Step 'demo-iac'
if (Test-Path $ManifestPath) {
    $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json -AsHashtable -Depth 32
    $manifest.liveSeeded = $false
    $manifest.generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $manifest.generatedBy = 'scripts/Remove-ContextPaneLab.ps1'
    if ($PSCmdlet.ShouldProcess($ManifestPath, 'Set liveSeeded=false')) {
        ($manifest | ConvertTo-Json -Depth 32) | Set-Content -Path $ManifestPath -Encoding utf8NoBOM
        Write-Ok 'manifest reset to offline fallback'
    }
}

Write-Host "`nLab removed. The offline manifest keeps the demo working with LIVE_CLOUD_MODE=false." -ForegroundColor Green
