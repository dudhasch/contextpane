#Requires -Version 7.0
<#
.SYNOPSIS
    Idempotently seeds the ContextPane demo lab (Contoso Finance) into a real Entra tenant and Azure subscription.

.DESCRIPTION
    Creates or updates, in this order:
      1. Five Contoso Finance users (@<Domain>) with the open extension com.contextpane.licenseState
         carrying the simulated license state (3 drifted on SPE_E3, 2 compliant on SPE_E5).
      2. Security groups SG-Contoso-Finance-AVD (all 5) and SG-Contoso-Finance-Legacy (3 drifted).
      3. Conditional Access policy "[ContextPane-Demo] Block AVD - Contoso Finance Legacy":
         include SG-Contoso-Finance-Legacy, app Azure Virtual Desktop, grant = Block.
      4. Resource group rg-contoso-avd-prod and the deliberately drifted NSG nsg-contoso-avd-hostpool-01
         (rogue Allow-Temp-RDP-Diagnostic-Drift on TCP 3389 from *, tag Environment = Prod-Hotfix-Manual).
      5. Rewrites ./demo-iac/main.tf (clean baseline) and ./demo-iac/demo-lab-manifest.json with the real object ids.

    Requires an existing delegated Connect-MgGraph context with
      User.ReadWrite.All, Group.ReadWrite.All, Policy.ReadWrite.ConditionalAccess, Directory.ReadWrite.All
    and a Connect-AzAccount context on the target subscription. Supports -WhatIf.
    Missing Az / Microsoft.Graph submodules are reported with the ModuleFast one-liner
    (scripts/Install-ContextPaneModules.ps1); pass -InstallMissingModules to have them installed on the spot.

    The script is scoped to the demo objects only: it never touches users, groups or policies it did not name.

.EXAMPLE
    pwsh ./scripts/Invoke-SeedContextPaneLab.ps1 -WhatIf
.EXAMPLE
    pwsh ./scripts/Invoke-SeedContextPaneLab.ps1 -PolicyState enabledForReportingButNotEnforced
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TenantId = $(if ($env:CTX_LAB_TENANT_ID) { $env:CTX_LAB_TENANT_ID } else { '4cc41c20-8b01-40a3-93c6-b4f1e846f6ea' }),
    [string]$SubscriptionId = $(if ($env:CTX_LAB_SUBSCRIPTION_ID) { $env:CTX_LAB_SUBSCRIPTION_ID } else { '20505597-043c-4742-a884-42dc3f621aef' }),
    [string]$Domain = $(if ($env:CTX_LAB_DOMAIN) { $env:CTX_LAB_DOMAIN } else { 'c4a8shili.onmicrosoft.com' }),
    [string]$Location = $(if ($env:CTX_LAB_LOCATION) { $env:CTX_LAB_LOCATION } else { 'westeurope' }),
    [ValidateSet('enabled', 'enabledForReportingButNotEnforced', 'disabled')]
    [string]$PolicyState = 'enabled',
    [switch]$SkipGraph,
    [switch]$SkipAzure,
    [string]$ManifestPath,
    [string]$TerraformPath,
    # Install any missing Az / Microsoft.Graph submodule via scripts/Install-ContextPaneModules.ps1 (ModuleFast) before running.
    [switch]$InstallMissingModules
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ManifestPath) { $ManifestPath = Join-Path $repoRoot 'demo-iac' 'demo-lab-manifest.json' }
if (-not $TerraformPath) { $TerraformPath = Join-Path $repoRoot 'demo-iac' 'main.tf' }

$AvdAppId = '9cdead84-a844-4324-93f2-b2e6bb768d07'
$ExtensionName = 'com.contextpane.licenseState'
$ResourceGroupName = 'rg-contoso-avd-prod'
$NsgName = 'nsg-contoso-avd-hostpool-01'
$PolicyName = '[ContextPane-Demo] Block AVD - Contoso Finance Legacy'
$ContractId = 'CNT-2026-884'
$Now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$DemoUsers = @(
    @{ Mail = 'lynne.robins.contoso';    DisplayName = 'Lynne Robins';    Given = 'Lynne';  Surname = 'Robins';    JobTitle = 'Senior Financial Analyst';     Current = 'SPE_E3'; Drift = 'drifted';   Legacy = $true }
    @{ Mail = 'alex.wilber.contoso';     DisplayName = 'Alex Wilber';     Given = 'Alex';   Surname = 'Wilber';    JobTitle = 'Finance Manager';              Current = 'SPE_E5'; Drift = 'compliant'; Legacy = $false }
    @{ Mail = 'miriam.graham.contoso';   DisplayName = 'Miriam Graham';   Given = 'Miriam'; Surname = 'Graham';    JobTitle = 'Financial Controller';         Current = 'SPE_E5'; Drift = 'compliant'; Legacy = $false }
    @{ Mail = 'diego.siciliani.contoso'; DisplayName = 'Diego Siciliani'; Given = 'Diego';  Surname = 'Siciliani'; JobTitle = 'Accounts Payable Specialist';  Current = 'SPE_E3'; Drift = 'drifted';   Legacy = $true }
    @{ Mail = 'patti.fernandez.contoso'; DisplayName = 'Patti Fernandez'; Given = 'Patti';  Surname = 'Fernandez'; JobTitle = 'Treasury Analyst';             Current = 'SPE_E3'; Drift = 'drifted';   Legacy = $true }
)

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Keep([string]$Message) { Write-Host "    [=] $Message" -ForegroundColor DarkGray }

function New-RandomPassword {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
    -join (1..24 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

# ---------------------------------------------------------------------------
# Module + context checks (only for the parts that actually run)
# ---------------------------------------------------------------------------
function Assert-Module([string[]]$Names) {
    $missing = @($Names | Where-Object { -not (Get-Module -ListAvailable -Name $_) })
    if ($missing.Count -gt 0) {
        $installer = Join-Path $PSScriptRoot 'Install-ContextPaneModules.ps1'
        if ($InstallMissingModules) {
            Write-Step "Installing missing modules via ModuleFast: $($missing -join ', ')"
            & pwsh -NoProfile -NonInteractive -File $installer -Modules $missing
            if ($LASTEXITCODE -ne 0) { throw "Install-ContextPaneModules.ps1 exited with $LASTEXITCODE; modules still missing: $($missing -join ', ')" }
        } else {
            throw "Missing PowerShell modules: $($missing -join ', '). Install them in seconds with ModuleFast: pwsh -NoProfile -File $installer   (or re-run this script with -InstallMissingModules)"
        }
    }
    foreach ($n in $Names) { Import-Module $n -ErrorAction Stop }
}
if (-not $SkipGraph) { Assert-Module @('Microsoft.Graph.Authentication', 'Microsoft.Graph.Users', 'Microsoft.Graph.Groups', 'Microsoft.Graph.Identity.SignIns') }
if (-not $SkipAzure) { Assert-Module @('Az.Accounts', 'Az.Resources', 'Az.Network') }

$seeded = [ordered]@{ users = @(); groups = @{}; policy = $null; nsg = $null }

if (-not $SkipGraph) {
    $mg = Get-MgContext
    if (-not $mg) { throw 'No Microsoft Graph context. Run: Connect-MgGraph -TenantId <id> -Scopes User.ReadWrite.All,Group.ReadWrite.All,Policy.ReadWrite.ConditionalAccess,Directory.ReadWrite.All' }
    if ($mg.TenantId -ne $TenantId) { throw "Graph context is tenant $($mg.TenantId); expected $TenantId. Re-run Connect-MgGraph -TenantId $TenantId." }
    $missing = @('User.ReadWrite.All', 'Group.ReadWrite.All', 'Policy.ReadWrite.ConditionalAccess') | Where-Object { $mg.Scopes -notcontains $_ }
    if ($missing) { Write-Warning "Graph context is missing scopes: $($missing -join ', '). Creation calls may fail." }
    Write-Ok "Graph: $($mg.Account) @ $($mg.TenantId)"
}
if (-not $SkipAzure) {
    $az = Get-AzContext
    if (-not $az) { throw 'No Azure context. Run: Connect-AzAccount -TenantId <id> -SubscriptionId <id>' }
    if ($az.Subscription.Id -ne $SubscriptionId) {
        Write-Host "    switching Az context to subscription $SubscriptionId"
        $null = Set-AzContext -SubscriptionId $SubscriptionId -TenantId $TenantId
        $az = Get-AzContext
    }
    Write-Ok "Azure: $($az.Account.Id) @ $($az.Subscription.Name) ($($az.Subscription.Id))"
}

# ---------------------------------------------------------------------------
# 1. Users + open extension
# ---------------------------------------------------------------------------
if (-not $SkipGraph) {
    Write-Step 'Users'
    foreach ($u in $DemoUsers) {
        $upn = "$($u.Mail)@$Domain"
        $existing = Get-MgUser -Filter "userPrincipalName eq '$upn'" -Property Id,UserPrincipalName,DisplayName,JobTitle,Department,UsageLocation -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $existing) {
            if ($PSCmdlet.ShouldProcess($upn, 'New-MgUser')) {
                $existing = New-MgUser -AccountEnabled:$true -DisplayName $u.DisplayName -GivenName $u.Given -Surname $u.Surname `
                    -UserPrincipalName $upn -MailNickname $u.Mail -JobTitle $u.JobTitle -Department 'Finance' -UsageLocation 'CH' `
                    -CompanyName 'Contoso Finance' -PasswordProfile @{ Password = (New-RandomPassword); ForceChangePasswordNextSignIn = $true } `
                    -PasswordPolicies 'DisablePasswordExpiration'
                Write-Ok "created $upn ($($existing.Id))"
            }
        } else {
            if ($existing.JobTitle -ne $u.JobTitle -or $existing.Department -ne 'Finance' -or $existing.UsageLocation -ne 'CH') {
                if ($PSCmdlet.ShouldProcess($upn, 'Update-MgUser (jobTitle/department/usageLocation)')) {
                    Update-MgUser -UserId $existing.Id -JobTitle $u.JobTitle -Department 'Finance' -UsageLocation 'CH'
                    Write-Ok "updated $upn"
                }
            } else { Write-Keep "$upn exists ($($existing.Id))" }
        }
        if ($existing) {
            $extBody = @{
                '@odata.type' = '#microsoft.graph.openTypeExtension'
                extensionName = $ExtensionName
                expectedSku   = 'SPE_E5'
                currentSku    = $u.Current
                driftStatus   = $u.Drift
                contractId    = $ContractId
                lastSyncedAt  = $Now
            }
            $ext = Get-MgUserExtension -UserId $existing.Id -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $ExtensionName } | Select-Object -First 1
            if ($ext) {
                if ($PSCmdlet.ShouldProcess($upn, "Update-MgUserExtension $ExtensionName")) {
                    Update-MgUserExtension -UserId $existing.Id -ExtensionId $ExtensionName -BodyParameter $extBody
                    Write-Ok "extension updated: $($u.Current) / $($u.Drift)"
                }
            } elseif ($PSCmdlet.ShouldProcess($upn, "New-MgUserExtension $ExtensionName")) {
                $null = New-MgUserExtension -UserId $existing.Id -BodyParameter $extBody
                Write-Ok "extension created: $($u.Current) / $($u.Drift)"
            }
            $seeded.users += [ordered]@{
                objectId = $existing.Id; upn = $upn; displayName = $u.DisplayName; jobTitle = $u.JobTitle; department = 'Finance'; usageLocation = 'CH'
                currentSku = $u.Current; expectedSku = 'SPE_E5'; driftStatus = $u.Drift
                extension = [ordered]@{ extensionName = $ExtensionName; expectedSku = 'SPE_E5'; currentSku = $u.Current; driftStatus = $u.Drift; contractId = $ContractId; lastSyncedAt = $Now }
                legacy = $u.Legacy
            }
        }
    }

    # -----------------------------------------------------------------------
    # 2. Groups
    # -----------------------------------------------------------------------
    Write-Step 'Groups'
    $groupSpecs = @(
        @{ Name = 'SG-Contoso-Finance-AVD';    Nick = 'sg-contoso-finance-avd';    Desc = 'ContextPane demo: Contoso Finance users entitled to AVD host pool vdpool-contoso-fin-01 (Microsoft 365 E5)'; Members = $seeded.users }
        @{ Name = 'SG-Contoso-Finance-Legacy'; Nick = 'sg-contoso-finance-legacy'; Desc = 'ContextPane demo: legacy Microsoft 365 E3 users that should have been migrated out after the E5 upgrade';  Members = ($seeded.users | Where-Object { $_.legacy }) }
    )
    foreach ($g in $groupSpecs) {
        $group = Get-MgGroup -Filter "displayName eq '$($g.Name)'" -Property Id,DisplayName,Description,MailNickname -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $group) {
            if ($PSCmdlet.ShouldProcess($g.Name, 'New-MgGroup')) {
                $group = New-MgGroup -DisplayName $g.Name -MailNickname $g.Nick -MailEnabled:$false -SecurityEnabled:$true -Description $g.Desc
                Write-Ok "created $($g.Name) ($($group.Id))"
            }
        } else { Write-Keep "$($g.Name) exists ($($group.Id))" }
        if ($group) {
            $current = @(Get-MgGroupMember -GroupId $group.Id -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
            foreach ($m in $g.Members) {
                if ($current -contains $m.objectId) { continue }
                if ($PSCmdlet.ShouldProcess("$($m.upn) -> $($g.Name)", 'New-MgGroupMember')) {
                    New-MgGroupMember -GroupId $group.Id -DirectoryObjectId $m.objectId
                    Write-Ok "added $($m.upn)"
                }
            }
            $seeded.groups[$g.Name] = [ordered]@{ displayName = $g.Name; mailNickname = $g.Nick; objectId = $group.Id; description = $g.Desc; memberUpns = @($g.Members | ForEach-Object { $_.upn }) }
        }
    }

    # -----------------------------------------------------------------------
    # 3. Conditional Access policy
    # -----------------------------------------------------------------------
    Write-Step 'Conditional Access'
    $legacyGroupId = $seeded.groups['SG-Contoso-Finance-Legacy'].objectId
    if ($legacyGroupId) {
        $policyBody = @{
            displayName   = $PolicyName
            state         = $PolicyState
            conditions    = @{
                users          = @{ includeGroups = @($legacyGroupId) }
                applications   = @{ includeApplications = @($AvdAppId) }
                clientAppTypes = @('all')
            }
            grantControls = @{ operator = 'OR'; builtInControls = @('block') }
        }
        $policy = Get-MgIdentityConditionalAccessPolicy -All -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $PolicyName } | Select-Object -First 1
        if (-not $policy) {
            if ($PSCmdlet.ShouldProcess($PolicyName, 'New-MgIdentityConditionalAccessPolicy')) {
                $policy = New-MgIdentityConditionalAccessPolicy -BodyParameter $policyBody
                Write-Ok "created policy ($($policy.Id)) state=$PolicyState"
            }
        } elseif ($PSCmdlet.ShouldProcess($PolicyName, 'Update-MgIdentityConditionalAccessPolicy')) {
            Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $policy.Id -BodyParameter $policyBody
            Write-Ok "updated policy ($($policy.Id)) state=$PolicyState"
        }
        if ($policy) {
            $seeded.policy = [ordered]@{
                id = $policy.Id; displayName = $PolicyName; state = $PolicyState
                createdDateTime = $(if ($policy.CreatedDateTime) { $policy.CreatedDateTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $Now })
                modifiedDateTime = $Now
                conditions = [ordered]@{
                    users = [ordered]@{ includeGroups = @($legacyGroupId); includeGroupNames = @('SG-Contoso-Finance-Legacy'); excludeGroups = @(); excludeGroupNames = @() }
                    applications = [ordered]@{ includeApplications = @($AvdAppId); includeApplicationNames = @('Azure Virtual Desktop') }
                    clientAppTypes = @('all')
                }
                grantControls = [ordered]@{ operator = 'OR'; builtInControls = @('block') }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# 4. Azure resource group + drifted NSG
# ---------------------------------------------------------------------------
$baselineTags = [ordered]@{ Environment = 'Production'; Owner = 'ContextPane'; CostCenter = 'FIN-4092'; Workload = 'AVD-HostPool'; ManagedBy = 'Terraform' }
$driftedTags  = [ordered]@{ Environment = 'Prod-Hotfix-Manual'; Owner = 'ContextPane'; CostCenter = 'FIN-4092'; Workload = 'AVD-HostPool'; ManagedBy = 'Terraform'; ChangeTicket = 'manual-hotfix-2026-10-24' }
$ruleSpecs = @(
    @{ Name = 'Allow-AVD-ServiceTraffic';         Priority = 100;  Direction = 'Outbound'; Access = 'Allow'; Protocol = 'Tcp'; Src = 'VirtualNetwork'; Dst = 'WindowsVirtualDesktop'; Port = '443';  Desc = $null }
    @{ Name = 'Allow-Temp-RDP-Diagnostic-Drift';  Priority = 150;  Direction = 'Inbound';  Access = 'Allow'; Protocol = 'Tcp'; Src = '*';              Dst = '*';                     Port = '3389'; Desc = 'TEMP: diagnostic RDP opened manually during E5 cutover - REMOVE' }
    @{ Name = 'Allow-Internal-RDP-Shortpath';     Priority = 200;  Direction = 'Inbound';  Access = 'Allow'; Protocol = 'Udp'; Src = '10.20.0.0/16';   Dst = 'VirtualNetwork';        Port = '3390'; Desc = $null }
    @{ Name = 'Deny-All-Inbound-Internet';        Priority = 4000; Direction = 'Inbound';  Access = 'Deny';  Protocol = '*';   Src = 'Internet';       Dst = '*';                     Port = '*';    Desc = $null }
)

if (-not $SkipAzure) {
    Write-Step 'Azure'
    $rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction SilentlyContinue
    if (-not $rg) {
        if ($PSCmdlet.ShouldProcess($ResourceGroupName, 'New-AzResourceGroup')) {
            $rg = New-AzResourceGroup -Name $ResourceGroupName -Location $Location -Tag ([hashtable]$baselineTags)
            Write-Ok "created $ResourceGroupName in $Location"
        }
    } else { Write-Keep "$ResourceGroupName exists" }

    $rules = foreach ($r in $ruleSpecs) {
        $p = @{ Name = $r.Name; Priority = $r.Priority; Direction = $r.Direction; Access = $r.Access; Protocol = $r.Protocol
                SourceAddressPrefix = $r.Src; SourcePortRange = '*'; DestinationAddressPrefix = $r.Dst; DestinationPortRange = $r.Port }
        if ($r.Desc) { $p.Description = $r.Desc }
        New-AzNetworkSecurityRuleConfig @p
    }
    $nsg = Get-AzNetworkSecurityGroup -ResourceGroupName $ResourceGroupName -Name $NsgName -ErrorAction SilentlyContinue
    if (-not $nsg) {
        if ($PSCmdlet.ShouldProcess($NsgName, 'New-AzNetworkSecurityGroup (drifted)')) {
            $nsg = New-AzNetworkSecurityGroup -ResourceGroupName $ResourceGroupName -Name $NsgName -Location $Location -SecurityRules $rules -Tag ([hashtable]$driftedTags) -Force
            Write-Ok "created $NsgName with rogue rule + drifted tags"
        }
    } else {
        $changed = $false
        foreach ($r in $rules) {
            if (-not ($nsg.SecurityRules | Where-Object Name -eq $r.Name)) {
                $null = Add-AzNetworkSecurityRuleConfig -NetworkSecurityGroup $nsg -Name $r.Name -Priority $r.Priority -Direction $r.Direction -Access $r.Access -Protocol $r.Protocol `
                    -SourceAddressPrefix $r.SourceAddressPrefix -SourcePortRange '*' -DestinationAddressPrefix $r.DestinationAddressPrefix -DestinationPortRange $r.DestinationPortRange -Description $r.Description
                $changed = $true
            }
        }
        $nsg.Tag = [hashtable]$driftedTags
        if ($PSCmdlet.ShouldProcess($NsgName, "Set-AzNetworkSecurityGroup (rules changed=$changed, tags re-drifted)")) {
            $nsg = Set-AzNetworkSecurityGroup -NetworkSecurityGroup $nsg
            Write-Ok "re-asserted drift on $NsgName"
        }
    }
    if ($nsg) {
        $seeded.nsg = [ordered]@{
            name = $NsgName; id = $nsg.Id; tags = $driftedTags
            securityRules = @($ruleSpecs | ForEach-Object {
                $o = [ordered]@{ name = $_.Name; priority = $_.Priority; direction = $_.Direction; access = $_.Access; protocol = $_.Protocol
                                 sourcePortRange = '*'; destinationPortRange = $_.Port; sourceAddressPrefix = $_.Src; destinationAddressPrefix = $_.Dst }
                if ($_.Desc) { $o.description = $_.Desc }
                $o
            })
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Terraform baseline + manifest
# ---------------------------------------------------------------------------
Write-Step 'demo-iac'
$tagWidth = ($baselineTags.Keys | Measure-Object -Maximum -Property Length).Maximum
$tagLines = ($baselineTags.GetEnumerator() | ForEach-Object { "    $($_.Key.PadRight($tagWidth)) = `"$($_.Value)`"" }) -join "`n"
$baselineRules = $ruleSpecs | Where-Object { $_.Name -ne 'Allow-Temp-RDP-Diagnostic-Drift' }
$ruleBlocks = ($baselineRules | ForEach-Object {
@"

  security_rule {
    name                       = "$($_.Name)"
    priority                   = $($_.Priority)
    direction                  = "$($_.Direction)"
    access                     = "$($_.Access)"
    protocol                   = "$($_.Protocol)"
    source_port_range          = "*"
    destination_port_range     = "$($_.Port)"
    source_address_prefix      = "$($_.Src)"
    destination_address_prefix = "$($_.Dst)"
  }
"@ }) -join ''

$tf = @"
# ---------------------------------------------------------------------------
# ContextPane demo baseline — Contoso Finance AVD (tenant-contoso-01)
#
# This file is the *expected* (clean) state. mcp-azure-iac compares it against
# the live NSG (LIVE_CLOUD_MODE=true) or the seeded drifted state in
# demo-lab-manifest.json (LIVE_CLOUD_MODE=false) and renders a unified HCL diff.
#
# Tier 3 remediation stages a patch against this file on a fix/* branch.
# Regenerated by scripts/Invoke-SeedContextPaneLab.ps1 on $Now
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}

locals {
  contoso_tags = {
$tagLines
  }
}

resource "azurerm_resource_group" "contoso_avd_prod" {
  name     = "$ResourceGroupName"
  location = "$Location"
  tags     = local.contoso_tags
}

resource "azurerm_network_security_group" "contoso_avd_hostpool" {
  name                = "$NsgName"
  location            = azurerm_resource_group.contoso_avd_prod.location
  resource_group_name = azurerm_resource_group.contoso_avd_prod.name
  tags                = local.contoso_tags
$ruleBlocks
}

output "contoso_nsg_id" {
  value = azurerm_network_security_group.contoso_avd_hostpool.id
}
"@

if ($PSCmdlet.ShouldProcess($TerraformPath, 'Write Terraform baseline')) {
    Set-Content -Path $TerraformPath -Value $tf -Encoding utf8NoBOM
    Write-Ok "wrote $TerraformPath"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json -AsHashtable -Depth 32
$tenant = $manifest.tenants['tenant-contoso-01']
$tenant.tenantId = $TenantId
$tenant.verifiedDomain = $Domain
$tenant.subscriptionId = $SubscriptionId
if ($seeded.users.Count -gt 0) {
    $tenant.users = @($seeded.users | ForEach-Object { $c = [ordered]@{} + $_; $c.Remove('legacy'); $c })
}
if ($seeded.groups.Count -gt 0) { $tenant.groups = @($seeded.groups.Values) }
if ($seeded.policy) {
    $tenant.conditionalAccessPolicies = @($seeded.policy)
    foreach ($e in $tenant.signInEvents) {
        foreach ($p in $e.appliedConditionalAccessPolicies) { if ($p.displayName -eq $PolicyName) { $p.id = $seeded.policy.id } }
    }
}
if ($seeded.users.Count -gt 0) {
    # keep the seeded sign-in narrative but point it at the real UPNs
    foreach ($e in $tenant.signInEvents) {
        $match = $seeded.users | Where-Object { $e.userPrincipalName -like "$($_.upn.Split('@')[0])@*" } | Select-Object -First 1
        if ($match) { $e.userPrincipalName = $match.upn }
    }
}
$tenant.azure.resourceGroup = $ResourceGroupName
$tenant.azure.location = $Location
if ($seeded.nsg) { $tenant.azure.nsg = $seeded.nsg }
$manifest.generatedAt = $Now
$manifest.generatedBy = 'scripts/Invoke-SeedContextPaneLab.ps1'
$manifest.liveSeeded = (-not $SkipGraph) -and (-not $SkipAzure) -and (-not $WhatIfPreference)

if ($PSCmdlet.ShouldProcess($ManifestPath, 'Write lab manifest')) {
    ($manifest | ConvertTo-Json -Depth 32) | Set-Content -Path $ManifestPath -Encoding utf8NoBOM
    Write-Ok "wrote $ManifestPath (liveSeeded=$($manifest.liveSeeded))"
}

Write-Host "`nLab seeded. Start the orchestrator with LIVE_CLOUD_MODE=true to query it live." -ForegroundColor Green
[pscustomobject]@{
    Users    = $seeded.users.Count
    Groups   = $seeded.groups.Count
    Policy   = $(if ($seeded.policy) { $seeded.policy.id } else { '(skipped)' })
    NsgId    = $(if ($seeded.nsg) { $seeded.nsg.id } else { '(skipped)' })
    Manifest = $ManifestPath
} | Format-List
