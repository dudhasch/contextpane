#Requires -Version 7.0
<#
.SYNOPSIS
    Idempotently seeds the ContextPane demo lab (Contoso Finance tickets and tenant anomalies) into a real
    Entra tenant, Intune and Azure subscription.

.DESCRIPTION
    Creates or updates, in this order:
      1. Five Contoso Finance users (@<Domain>) with the open extension com.contextpane.licenseState
         carrying the simulated license state (3 drifted on SPE_E3, 2 compliant on SPE_E5).
      2. Security groups SG-Contoso-Finance-AVD (all 5) and SG-Contoso-Finance-Legacy (3 drifted).
      3. Conditional Access policy "[ContextPane-Demo] Block AVD - Contoso Finance Legacy":
         include SG-Contoso-Finance-Legacy, app Azure Virtual Desktop, grant = Block.
      3b. Tenant anomalies (-SkipAnomalies to skip):
          ANOM-LIC-101: three disabled offboarded users still holding SPE_E5 (+ Copilot) and two new hires in
          CountViolation, all in SG-Contoso-M365-E5, modelled in the same license extension.
          ANOM-CA-204: SG-BreakGlass-Accounts (bg-admin-01), SG-ContextPane-Demo-Admins and the policies
          "[ContextPane-Demo] CA-001-Require-PhishingResistant-MFA-Admins" (enabled, demo admin group only,
          break-glass exclusion missing) and "[ContextPane-Demo] CA-004-Block-Legacy-Auth" (report-only,
          Finance demo users only). Neither policy can reach a real admin.
      3c. Intune (-SkipIntune to skip; needs DeviceManagementConfiguration.ReadWrite.All and an Intune license):
          ANOM-INT-309: Settings Catalog Intune-Win11-ASR-Baseline (LSASS rule drifted to Audit) and
          EndpointSecurity-Firewall-Prod plus the duplicate legacy Win11-Firewall-MDM profile, all assigned to
          SG-All-Workstations. INC-4099: Fabrikam-EndpointSecurity-DiskEncryption plus the conflicting
          Fabrikam-Legacy-BitLocker-DeviceConfig, assigned to SG-Fabrikam-Win11-Devices.
      4. Resource group rg-contoso-avd-prod and the deliberately drifted NSG nsg-contoso-avd-hostpool-01
         (rogue Allow-Temp-RDP-Diagnostic-Drift on TCP 3389 from *, tag Environment = Prod-Hotfix-Manual).
      5. Rewrites ./demo-iac/main.tf (clean baseline) and ./demo-iac/demo-lab-manifest.json with the real object ids.

    Requires an existing delegated Connect-MgGraph context with
      User.ReadWrite.All, Group.ReadWrite.All, Policy.Read.All, Policy.ReadWrite.ConditionalAccess,
      Directory.ReadWrite.All, DeviceManagementConfiguration.ReadWrite.All
    (scripts/Connect-ContextPaneGraph.ps1 creates one and persists it for the orchestrator's Conditional
    Access and Intune writes) and a Connect-AzAccount context on the target subscription. Supports -WhatIf.
    Re-running it re-asserts every drift, like the workbench's Reset Drift.
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
    # Leave out the ANOM-LIC-101 / ANOM-CA-204 users, groups and Conditional Access policies.
    [switch]$SkipAnomalies,
    # Leave out the ANOM-INT-309 / INC-4099 Intune policies and profiles.
    [switch]$SkipIntune,
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

# Tenant-anomaly demo objects. Every display name carries the [ContextPane-Demo] prefix or a demo-only group
# name, so the seed never touches a real policy, group or user. Licenses are modelled in the open extension.
$DemoPrefix = '[ContextPane-Demo]'
$Ca001Name = "$DemoPrefix CA-001-Require-PhishingResistant-MFA-Admins"
$Ca004Name = "$DemoPrefix CA-004-Block-Legacy-Auth"
$AnomalyUsers = @(
    @{ Mail = 'henrietta.mueller.contoso'; DisplayName = 'Henrietta Mueller'; JobTitle = 'Former Finance Analyst';         Department = 'Finance'; Enabled = $false
       Extension = @{ currentSku = 'SPE_E5, Microsoft_365_Copilot'; expectedSku = 'NONE'; assignmentState = 'Orphaned'; assignmentPath = 'Direct + Group'; driftStatus = 'drifted' } }
    @{ Mail = 'pradeep.gupta.contoso';     DisplayName = 'Pradeep Gupta';     JobTitle = 'Former FP&A Lead';               Department = 'Finance'; Enabled = $false
       Extension = @{ currentSku = 'SPE_E5, Microsoft_365_Copilot'; expectedSku = 'NONE'; assignmentState = 'Orphaned'; assignmentPath = 'Direct + Group'; driftStatus = 'drifted' } }
    @{ Mail = 'christie.cline.contoso';    DisplayName = 'Christie Cline';    JobTitle = 'Former Procurement Specialist';  Department = 'Finance'; Enabled = $false
       Extension = @{ currentSku = 'SPE_E5'; expectedSku = 'NONE'; assignmentState = 'Orphaned'; assignmentPath = 'Group'; driftStatus = 'drifted' } }
    @{ Mail = 'adele.vance.contoso';       DisplayName = 'Adele Vance';       JobTitle = 'Financial Analyst (joined 2026-10-19)'; Department = 'Finance'; Enabled = $true
       Extension = @{ currentSku = 'NONE'; expectedSku = 'SPE_E5'; assignmentState = 'Error: CountViolation'; assignmentPath = 'Group'; driftStatus = 'unassigned' } }
    @{ Mail = 'joni.sherman.contoso';      DisplayName = 'Joni Sherman';      JobTitle = 'Treasury Analyst (joined 2026-10-20)';  Department = 'Finance'; Enabled = $true
       Extension = @{ currentSku = 'NONE'; expectedSku = 'SPE_E5'; assignmentState = 'Error: CountViolation'; assignmentPath = 'Group'; driftStatus = 'unassigned' } }
    @{ Mail = 'bg-admin-01';               DisplayName = 'Break Glass 01';    JobTitle = 'Emergency access (ContextPane demo)';   Department = 'IT';      Enabled = $true; Extension = $null }
)

$AsrSetting = 'device_vendor_msft_policy_config_defender_attacksurfacereductionrules'
$AsrLsassRule = 'blockcredentialstealingfromwindowslocalsecurityauthoritysubsystem'
function New-ChoiceSetting([string]$Id, [string]$Value) {
    @{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationSetting'
       settingInstance = @{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance'; settingDefinitionId = $Id; choiceSettingValue = @{ value = "${Id}_$Value"; children = @() } } }
}
$SettingsCatalogSpecs = @(
    @{ Name = 'Intune-Win11-ASR-Baseline'; Group = 'SG-All-Workstations'; AsrRule = $AsrLsassRule
       Description = 'ContextPane demo (ANOM-INT-309): golden baseline is Block; seeded drifted to Audit'
       Settings = @(@{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationSetting'
                       settingInstance = @{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance'; settingDefinitionId = $AsrSetting
                                            groupSettingCollectionValue = @(@{ children = @(@{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance'
                                                                                                settingDefinitionId = "${AsrSetting}_$AsrLsassRule"
                                                                                                choiceSettingValue = @{ value = "${AsrSetting}_${AsrLsassRule}_audit"; children = @() } }) }) } }) }
    @{ Name = 'EndpointSecurity-Firewall-Prod'; Group = 'SG-All-Workstations'
       Description = 'ContextPane demo (ANOM-INT-309): golden firewall policy, EnableFirewall = True'
       Settings = @((New-ChoiceSetting 'vendor_msft_firewall_mdmstore_domainprofile_enablefirewall' 'true'), (New-ChoiceSetting 'vendor_msft_firewall_mdmstore_privateprofile_enablefirewall' 'true')) }
    @{ Name = 'Fabrikam-EndpointSecurity-DiskEncryption'; Group = 'SG-Fabrikam-Win11-Devices'
       Description = 'ContextPane demo (INC-4099): golden disk encryption baseline, silent BitLocker'
       Settings = @((New-ChoiceSetting 'device_vendor_msft_bitlocker_requiredeviceencryption' '1'), (New-ChoiceSetting 'device_vendor_msft_bitlocker_allowwarningforotherdiskencryption' '0')) }
)
$LegacyProfileSpecs = @(
    @{ Name = 'Win11-Firewall-MDM'; Group = 'SG-All-Workstations'
       Description = 'ContextPane demo (ANOM-INT-309): duplicate legacy firewall profile with a conflicting EnableFirewall value'
       Settings = @{ firewallProfileDomain = @{ firewallEnabled = 'blocked' }; firewallProfilePrivate = @{ firewallEnabled = 'blocked' } } }
    @{ Name = 'Fabrikam-Legacy-BitLocker-DeviceConfig'; Group = 'SG-Fabrikam-Win11-Devices'
       Description = 'ContextPane demo (INC-4099): 2024 BitLocker profile that conflicts with the disk encryption baseline'
       Settings = @{ bitLockerEncryptDevice = $true; bitLockerDisableWarningForOtherDiskEncryption = $false; bitLockerSystemDrivePolicy = @{ encryptionMethod = 'xtsAes128' } } }
)

function Get-ContextPaneGroup([string]$Name, [string]$Nick, [string]$Desc, [string[]]$MemberIds) {
    $group = Get-MgGroup -Filter "displayName eq '$Name'" -Property Id,DisplayName -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $group) {
        if (-not $PSCmdlet.ShouldProcess($Name, 'New-MgGroup')) { return $null }
        $group = New-MgGroup -DisplayName $Name -MailNickname $Nick -MailEnabled:$false -SecurityEnabled:$true -Description $Desc
        Write-Ok "created $Name ($($group.Id))"
    }
    $current = @(Get-MgGroupMember -GroupId $group.Id -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    foreach ($id in $MemberIds) {
        if ($current -notcontains $id -and $PSCmdlet.ShouldProcess("$id -> $Name", 'New-MgGroupMember')) { New-MgGroupMember -GroupId $group.Id -DirectoryObjectId $id }
    }
    return $group
}

<# Flips one ASR rule in a Settings Catalog policy (no per-setting PATCH exists: GET + PUT). #>
function Set-ContextPaneAsrRule([string]$PolicyId, [string]$Rule, [string]$Value) {
    $uri = "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$PolicyId"
    $policy = Invoke-MgGraphRequest -Method GET -Uri $uri
    $settings = (Invoke-MgGraphRequest -Method GET -Uri "$uri/settings").value
    $json = ConvertTo-Json @($settings | ForEach-Object { @{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationSetting'; settingInstance = $_.settingInstance } }) -Depth 30
    $patched = $json -replace "($Rule)_(block|audit|warn|off)`"", "`$1_$Value`""
    $body = @{ name = $policy.name; description = $policy.description; platforms = $policy.platforms; technologies = $policy.technologies; roleScopeTagIds = $policy.roleScopeTagIds; settings = ($patched | ConvertFrom-Json -Depth 30) }
    Invoke-MgGraphRequest -Method PUT -Uri $uri -Body ($body | ConvertTo-Json -Depth 30) -ContentType 'application/json'
}

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

$seeded = [ordered]@{ users = @(); groups = [ordered]@{}; policy = $null; nsg = $null }

if (-not $SkipGraph) {
    if (-not (Get-MgContext) -and (Test-Path (Join-Path $HOME '.mg/mg.authrecord.json'))) {
        # Silently reuse the sign-in scripts/Connect-ContextPaneGraph.ps1 persisted to ~/.mg (no prompt).
        Connect-MgGraph -TenantId $TenantId -ContextScope CurrentUser -NoWelcome -ErrorAction SilentlyContinue -DeviceCode
    }
    $mg = Get-MgContext
    if (-not $mg) { throw 'No Microsoft Graph context. Run: pwsh -NoProfile -File ./scripts/Connect-ContextPaneGraph.ps1' }
    if ($mg.TenantId -ne $TenantId) { throw "Graph context is tenant $($mg.TenantId); expected $TenantId. Re-run Connect-MgGraph -TenantId $TenantId." }
    $missing = @('User.ReadWrite.All', 'Group.ReadWrite.All', 'Policy.ReadWrite.ConditionalAccess') + $(if ($SkipIntune) { @() } else { @('DeviceManagementConfiguration.ReadWrite.All') }) | Where-Object { $mg.Scopes -notcontains $_ }
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

    # -----------------------------------------------------------------------
    # 3b. Tenant anomalies: ANOM-LIC-101 (orphaned seats, CountViolation) and
    #     ANOM-CA-204 (missing break-glass exclusion, report-only drift)
    # -----------------------------------------------------------------------
    if (-not $SkipAnomalies) {
        Write-Step 'Tenant anomalies (ANOM-LIC-101, ANOM-CA-204)'
        $anomalyIds = @{}
        foreach ($u in $AnomalyUsers) {
            $upn = "$($u.Mail)@$Domain"
            $existing = Get-MgUser -Filter "userPrincipalName eq '$upn'" -Property Id,AccountEnabled -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $existing) {
                if ($PSCmdlet.ShouldProcess($upn, 'New-MgUser')) {
                    $existing = New-MgUser -AccountEnabled:$u.Enabled -DisplayName $u.DisplayName -UserPrincipalName $upn -MailNickname $u.Mail `
                        -JobTitle $u.JobTitle -Department $u.Department -UsageLocation 'CH' -CompanyName 'Contoso Finance' `
                        -PasswordProfile @{ Password = (New-RandomPassword); ForceChangePasswordNextSignIn = $true } -PasswordPolicies 'DisablePasswordExpiration'
                    Write-Ok "created $upn (accountEnabled=$($u.Enabled))"
                }
            } elseif ($existing.AccountEnabled -ne $u.Enabled -and $PSCmdlet.ShouldProcess($upn, "Update-MgUser -AccountEnabled:$($u.Enabled)")) {
                Update-MgUser -UserId $existing.Id -AccountEnabled:$u.Enabled
                Write-Ok "$upn accountEnabled=$($u.Enabled)"
            } else { Write-Keep "$upn exists ($($existing.Id))" }
            if (-not $existing) { continue }
            $anomalyIds[$u.Mail] = $existing.Id
            if (-not $u.Extension) { continue }
            # The drifted license state lives in the open extension, like the INC-4092 users: no real seat is consumed.
            $extBody = @{ '@odata.type' = '#microsoft.graph.openTypeExtension'; extensionName = $ExtensionName; contractId = $ContractId; lastSyncedAt = $Now } + $u.Extension
            $ext = Get-MgUserExtension -UserId $existing.Id -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $ExtensionName } | Select-Object -First 1
            if ($ext) {
                if ($PSCmdlet.ShouldProcess($upn, "Update-MgUserExtension $ExtensionName (drifted)")) { Update-MgUserExtension -UserId $existing.Id -ExtensionId $ExtensionName -BodyParameter $extBody }
            } elseif ($PSCmdlet.ShouldProcess($upn, "New-MgUserExtension $ExtensionName")) {
                $null = New-MgUserExtension -UserId $existing.Id -BodyParameter $extBody
            }
        }

        $licensingMembers = @($AnomalyUsers | Where-Object { $_.Extension } | ForEach-Object { $anomalyIds[$_.Mail] } | Where-Object { $_ })
        $breakGlassId = $anomalyIds['bg-admin-01']
        $licensingGroup = Get-ContextPaneGroup -Name 'SG-Contoso-M365-E5' -Nick 'sg-contoso-m365-e5' -Desc 'ContextPane demo: group-based licensing for Microsoft 365 E5 (ANOM-LIC-101)' -MemberIds $licensingMembers
        $breakGlass = Get-ContextPaneGroup -Name 'SG-BreakGlass-Accounts' -Nick 'sg-breakglass-accounts' -Desc 'ContextPane demo: emergency access accounts, excluded from every Conditional Access policy' -MemberIds @($breakGlassId | Where-Object { $_ })
        $demoAdmins = Get-ContextPaneGroup -Name 'SG-ContextPane-Demo-Admins' -Nick 'sg-contextpane-demo-admins' -Desc 'ContextPane demo: admin accounts in scope of CA-001 (demo accounts only, never real admins)' -MemberIds @($breakGlassId | Where-Object { $_ })
        $financeId = $seeded.groups['SG-Contoso-Finance-AVD'].objectId

        # CA-001 is enabled but scoped to the demo admin group only; the drift is the missing break-glass exclusion.
        # CA-004 targets the Finance demo users only and is left in report-only; the fix enforces it.
        if ($breakGlass -and $demoAdmins -and $financeId) {
            $caSpecs = @(
                @{
                    displayName   = $Ca001Name
                    state         = 'enabled'
                    conditions    = @{ users = @{ includeGroups = @($demoAdmins.Id); excludeGroups = @() }; applications = @{ includeApplications = @('All') }; clientAppTypes = @('all') }
                    grantControls = @{ operator = 'OR'; authenticationStrength = @{ id = '00000000-0000-0000-0000-000000000004' } }
                }
                @{
                    displayName   = $Ca004Name
                    state         = 'enabledForReportingButNotEnforced'
                    conditions    = @{ users = @{ includeGroups = @($financeId); excludeGroups = @($breakGlass.Id) }; applications = @{ includeApplications = @('All') }; clientAppTypes = @('exchangeActiveSync', 'other') }
                    grantControls = @{ operator = 'OR'; builtInControls = @('block') }
                }
            )
            $allPolicies = @(Get-MgIdentityConditionalAccessPolicy -All -ErrorAction SilentlyContinue)
            foreach ($spec in $caSpecs) {
                $existingPolicy = $allPolicies | Where-Object { $_.DisplayName -eq $spec.displayName } | Select-Object -First 1
                if (-not $existingPolicy) {
                    if ($PSCmdlet.ShouldProcess($spec.displayName, "New-MgIdentityConditionalAccessPolicy (state=$($spec.state))")) {
                        $created = New-MgIdentityConditionalAccessPolicy -BodyParameter $spec
                        Write-Ok "created $($spec.displayName) ($($created.Id))"
                    }
                } elseif ($PSCmdlet.ShouldProcess($spec.displayName, 'Update-MgIdentityConditionalAccessPolicy (re-assert drift)')) {
                    Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $existingPolicy.Id -BodyParameter $spec
                    Write-Ok "re-asserted drift on $($spec.displayName)"
                }
            }
        } else {
            Write-Warning 'Skipped CA-001 / CA-004: a demo group could not be created.'
        }
        if ($licensingGroup) { Write-Keep "SG-Contoso-M365-E5 ($($licensingGroup.Id)): CountViolation is modelled in the license extension" }
    }

    # -----------------------------------------------------------------------
    # 3c. Intune: ANOM-INT-309 (ASR + firewall drift) and INC-4099 (BitLocker conflict)
    #     Needs DeviceManagementConfiguration.ReadWrite.All and an Intune license; skipped with a
    #     warning otherwise. Devices stay fixtures (the lab has no enrolled devices).
    # -----------------------------------------------------------------------
    if (-not $SkipIntune) {
        Write-Step 'Intune (ANOM-INT-309, INC-4099)'
        try {
            $workstations = Get-ContextPaneGroup -Name 'SG-All-Workstations' -Nick 'sg-all-workstations' -Desc 'ContextPane demo: Intune assignment target for every managed workstation (ANOM-INT-309)' -MemberIds @()
            $fabrikamDevices = Get-ContextPaneGroup -Name 'SG-Fabrikam-Win11-Devices' -Nick 'sg-fabrikam-win11-devices' -Desc 'ContextPane demo: Fabrikam Legal Windows 11 devices (INC-4099)' -MemberIds @()
            $beta = 'https://graph.microsoft.com/beta/deviceManagement'
            $v1 = 'https://graph.microsoft.com/v1.0/deviceManagement'
            $existingPolicies = @((Invoke-MgGraphRequest -Method GET -Uri "$beta/configurationPolicies?`$select=id,name&`$top=100").value)
            $existingConfigs = @((Invoke-MgGraphRequest -Method GET -Uri "$v1/deviceConfigurations?`$select=id,displayName").value)

            foreach ($spec in $SettingsCatalogSpecs) {
                $name = "$DemoPrefix $($spec.Name)"
                $groupId = $(if ($spec.Group -eq 'SG-All-Workstations') { $workstations.Id } else { $fabrikamDevices.Id })
                $policy = $existingPolicies | Where-Object { $_.name -eq $name } | Select-Object -First 1
                if (-not $policy) {
                    if ($PSCmdlet.ShouldProcess($name, 'POST configurationPolicies (Settings Catalog)')) {
                        $body = @{ name = $name; description = $spec.Description; platforms = 'windows10'; technologies = 'mdm,microsoftSense'; roleScopeTagIds = @('0'); settings = $spec.Settings }
                        $policy = Invoke-MgGraphRequest -Method POST -Uri "$beta/configurationPolicies" -Body ($body | ConvertTo-Json -Depth 30) -ContentType 'application/json'
                        Write-Ok "created $name ($($policy.id))"
                    }
                } elseif ($spec.AsrRule -and $PSCmdlet.ShouldProcess($name, 'Re-assert the ASR drift (Block -> Audit)')) {
                    Set-ContextPaneAsrRule -PolicyId $policy.id -Rule $spec.AsrRule -Value 'audit'
                    Write-Ok "re-asserted drift on $name (ASR rule = Audit)"
                } else { Write-Keep "$name exists ($($policy.id))" }
                if ($policy -and $groupId -and $PSCmdlet.ShouldProcess($name, "assign to $($spec.Group)")) {
                    $assign = @{ assignments = @(@{ target = @{ '@odata.type' = '#microsoft.graph.groupAssignmentTarget'; groupId = $groupId } }) }
                    $null = Invoke-MgGraphRequest -Method POST -Uri "$beta/configurationPolicies/$($policy.id)/assign" -Body ($assign | ConvertTo-Json -Depth 10) -ContentType 'application/json'
                }
            }

            foreach ($spec in $LegacyProfileSpecs) {
                $name = "$DemoPrefix $($spec.Name)"
                $groupId = $(if ($spec.Group -eq 'SG-All-Workstations') { $workstations.Id } else { $fabrikamDevices.Id })
                $legacyProfile = $existingConfigs | Where-Object { $_.displayName -eq $name } | Select-Object -First 1
                if (-not $legacyProfile) {
                    if ($PSCmdlet.ShouldProcess($name, 'POST deviceConfigurations (legacy profile)')) {
                        $body = @{ '@odata.type' = '#microsoft.graph.windows10EndpointProtectionConfiguration'; displayName = $name; description = $spec.Description } + $spec.Settings
                        $legacyProfile = Invoke-MgGraphRequest -Method POST -Uri "$v1/deviceConfigurations" -Body ($body | ConvertTo-Json -Depth 10) -ContentType 'application/json'
                        Write-Ok "created $name ($($legacyProfile.id))"
                    }
                } else { Write-Keep "$name exists ($($legacyProfile.id))" }
                # The conflict is the assignment: (re-)assign the legacy profile to the same group as the golden policy.
                if ($legacyProfile -and $groupId -and $PSCmdlet.ShouldProcess($name, "assign to $($spec.Group) (drifted)")) {
                    $assign = @{ assignments = @(@{ target = @{ '@odata.type' = '#microsoft.graph.groupAssignmentTarget'; groupId = $groupId } }) }
                    $null = Invoke-MgGraphRequest -Method POST -Uri "$v1/deviceConfigurations/$($legacyProfile.id)/assign" -Body ($assign | ConvertTo-Json -Depth 10) -ContentType 'application/json'
                    Write-Ok "$name assigned to $($spec.Group)"
                }
            }
        } catch {
            Write-Warning "Intune seeding skipped: $($_.Exception.Message). ANOM-INT-309 and INC-4099 keep their fixtures; needs DeviceManagementConfiguration.ReadWrite.All and an Intune license."
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
"@ }) -join "`n"

# Repo files are LF with a single trailing newline; Set-Content/ConvertTo-Json on Windows would emit CRLF
# and make every seed run show up as a whole-file diff.
function Write-LfFile([string]$Path, [string]$Content) {
    $text = ($Content -replace "`r`n", "`n").TrimEnd("`n") + "`n"
    [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
}

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
    Write-LfFile -Path $TerraformPath -Content $tf
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
    Write-LfFile -Path $ManifestPath -Content ($manifest | ConvertTo-Json -Depth 32)
    Write-Ok "wrote $ManifestPath (liveSeeded=$($manifest.liveSeeded))"
}

Write-Host "`nLab seeded. Start the orchestrator with LIVE_CLOUD_MODE=true to query it live." -ForegroundColor Green
[pscustomobject]@{
    Users    = $seeded.users.Count
    Groups   = $seeded.groups.Count
    Policy   = $(if ($seeded.policy) { $seeded.policy.id } else { '(skipped)' })
    Anomalies = $(if ($SkipGraph -or $SkipAnomalies) { '(skipped)' } else { 'ANOM-LIC-101, ANOM-CA-204' })
    Intune   = $(if ($SkipGraph -or $SkipIntune) { '(skipped)' } else { 'ANOM-INT-309, INC-4099 (see warnings above)' })
    NsgId    = $(if ($seeded.nsg) { $seeded.nsg.id } else { '(skipped)' })
    Manifest = $ManifestPath
} | Format-List
