#Requires -Version 7.0
#Requires -Modules Az.Accounts, Az.Resources, Az.Storage, Az.ManagedServiceIdentity
<#
.SYNOPSIS
    Idempotently seeds the Act II ABAC scenario into the lab subscription "MSDN - Timur - 1", and resets it
    between takes.

.DESCRIPTION
    Hard-wired to the lab: tenant 4cc41c20-8b01-40a3-93c6-b4f1e846f6ea (c4a8shili.onmicrosoft.com),
    subscription 20505597-043c-4742-a884-42dc3f621aef. These are constants, not parameters. The script
    selects that subscription for this process only (Set-AzContext -Scope Process) and re-checks the
    active subscription and tenant before every write; any other subscription stops it. Your saved
    default Az context is left as it is.

    Creates or ensures, in this order:
      1. Resource group rg-contoso-payroll-prod (tag contextpane-demo = abac).
      2. Storage account stcontosolzprod01 (StorageV2, Standard_LRS, no public blob access, TLS 1.2)
         with the blob containers payroll-drop, payroll-archive and payroll-exports.
      3. User-assigned managed identity func-contoso-payroll-ingest (the payroll ingest Function App's
         identity).
      4. Policy definition Require-ABAC-StorageBlobDataContributor (Deny: Storage Blob Data Contributor
         may only be assigned with an ABAC condition), at subscription scope, or at a management group
         with -DefinitionManagementGroupId. Assigned at the resource group under the same name.
      5. Reset: removes every Storage Blob Data Contributor assignment of that identity on the storage
         account, so ContextPane's Approve & Execute starts from the ticket's state.
      6. Policy probe: tries one unconditioned assignment and expects RequestDisallowedByPolicy. If the
         policy is not effective yet (new assignments can take a few minutes), the probe assignment is
         removed again and you are told to re-run with -ResetOnly -ProbePolicy later.

    -ResetOnly runs step 5 only (with -ProbePolicy, also step 6): the pre-take helper.
    -Teardown removes the policy assignment, the policy definition and the resource group (asks first).

.EXAMPLE
    pwsh ./scripts/seed-abac-lab.ps1
.EXAMPLE
    pwsh ./scripts/seed-abac-lab.ps1 -ResetOnly
.EXAMPLE
    pwsh ./scripts/seed-abac-lab.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$Location = 'westeurope',
    # Publish the policy definition at this management group instead of the subscription (the assignment stays on the resource group).
    [string]$DefinitionManagementGroupId,
    # Only remove the identity's Storage Blob Data Contributor assignments on the storage account.
    [switch]$ResetOnly,
    # With -ResetOnly: also run the policy probe.
    [switch]$ProbePolicy,
    [switch]$SkipPolicyProbe,
    [switch]$Teardown
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---- the lab, as constants -------------------------------------------------------------------------
$LabTenantId       = '4cc41c20-8b01-40a3-93c6-b4f1e846f6ea'
$LabSubscriptionId = '20505597-043c-4742-a884-42dc3f621aef'
$ResourceGroup     = 'rg-contoso-payroll-prod'
$StorageAccount    = 'stcontosolzprod01'
$Containers        = @('payroll-drop', 'payroll-archive', 'payroll-exports')
$IdentityName      = 'func-contoso-payroll-ingest'
$PolicyName        = 'Require-ABAC-StorageBlobDataContributor'
$RoleDefinitionId  = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'   # Storage Blob Data Contributor
$Tags              = @{ 'contextpane-demo' = 'abac'; 'owner' = 'contextpane-hackathon' }

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    ok  $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }

function Assert-LabContext {
    $ctx = Get-AzContext
    if (-not $ctx -or -not $ctx.Subscription -or $ctx.Subscription.Id -ne $LabSubscriptionId -or $ctx.Tenant.Id -ne $LabTenantId) {
        $sub = if ($ctx -and $ctx.Subscription) { "$($ctx.Subscription.Name) ($($ctx.Subscription.Id))" } else { 'none' }
        throw "Refusing to continue: the active Az subscription is $sub, not the lab subscription $LabSubscriptionId in tenant $LabTenantId."
    }
}

# ---- select the lab for this process only ----------------------------------------------------------
Write-Step "Selecting the lab subscription for this process"
if (-not (Get-AzContext)) { throw "No Az sign-in. Run: Connect-AzAccount -Tenant $LabTenantId" }
$labCtx = Get-AzContext -ListAvailable | Where-Object { $_.Subscription -and $_.Subscription.Id -eq $LabSubscriptionId -and $_.Tenant.Id -eq $LabTenantId } | Select-Object -First 1
if (-not $labCtx) { throw "The lab subscription $LabSubscriptionId is not in your Az contexts. Run: Connect-AzAccount -Tenant $LabTenantId -Subscription $LabSubscriptionId" }
# Process scope only, so it also runs under -WhatIf; otherwise a dry run would keep whatever context is the default.
$null = Set-AzContext -Context $labCtx -Scope Process -WhatIf:$false
Assert-LabContext
$ctx = Get-AzContext
Write-Ok "$($ctx.Subscription.Name) ($($ctx.Subscription.Id)) as $($ctx.Account.Id)"

$rgScope = "/subscriptions/$LabSubscriptionId/resourceGroups/$ResourceGroup"
$storageScope = "$rgScope/providers/Microsoft.Storage/storageAccounts/$StorageAccount"
$roleDefinitionFullId = "/subscriptions/$LabSubscriptionId/providers/Microsoft.Authorization/roleDefinitions/$RoleDefinitionId"

function Get-PayrollIdentity {
    Get-AzUserAssignedIdentity -ResourceGroupName $ResourceGroup -Name $IdentityName -ErrorAction SilentlyContinue
}

# Az.Resources 7+ (AutoRest policy cmdlets) throws PolicyDefinitionNotFound even with -ErrorAction SilentlyContinue.
function Find-PolicyDefinition {
    param([hashtable]$Scope)
    try { Get-AzPolicyDefinition -Name $PolicyName @Scope -ErrorAction Stop }
    catch { if ("$_" -match 'PolicyDefinitionNotFound|could not be found|is not found') { return } else { throw } }
}

function Find-PolicyAssignment {
    try { Get-AzPolicyAssignment -Name $PolicyName -Scope $rgScope -ErrorAction Stop }
    catch { if ("$_" -match 'PolicyAssignmentNotFound|could not be found|is not found') { return } else { throw } }
}

function Remove-PayrollAssignments {
    param($Identity)
    Assert-LabContext
    if (-not $Identity) { Write-Warn2 "identity $IdentityName not found; nothing to reset"; return 0 }
    $rows = @(Get-AzRoleAssignment -Scope $storageScope -ObjectId $Identity.PrincipalId -ErrorAction SilentlyContinue |
        Where-Object { $_.RoleDefinitionId -eq $RoleDefinitionId -and $_.Scope -eq $storageScope })
    foreach ($row in $rows) {
        if ($PSCmdlet.ShouldProcess("$StorageAccount → $IdentityName", "Remove Storage Blob Data Contributor assignment $($row.RoleAssignmentName)")) {
            Assert-LabContext
            Remove-AzRoleAssignment -InputObject $row | Out-Null
            Write-Ok "removed $($row.RoleAssignmentName)$(if ($row.Condition) { ' (conditioned)' } else { '' })"
        }
    }
    if (-not $rows.Count) { Write-Ok "no Storage Blob Data Contributor assignment for $IdentityName on $StorageAccount" }
    return $rows.Count
}

function Invoke-PolicyProbe {
    param($Identity)
    Write-Step "Policy probe: an unconditioned Storage Blob Data Contributor assignment must be denied"
    if (-not $Identity) { Write-Warn2 "identity missing; probe skipped"; return }
    $policyAssignment = Find-PolicyAssignment
    if (-not $policyAssignment) {
        Write-Warn2 "no policy assignment $PolicyName on $ResourceGroup, so there is nothing to deny yet; probe skipped."
        Write-Warn2 "run the full seed first: pwsh ./scripts/seed-abac-lab.ps1 -DefinitionManagementGroupId mg-msdn-prd"
        return
    }
    if (-not $PSCmdlet.ShouldProcess("$StorageAccount → $IdentityName", "Probe: unconditioned Storage Blob Data Contributor assignment (expected to be denied)")) { return }
    Assert-LabContext
    try {
        $probe = New-AzRoleAssignment -Scope $storageScope -ObjectId $Identity.PrincipalId -ObjectType ServicePrincipal -RoleDefinitionId $RoleDefinitionId -Description 'ContextPane policy probe (removed immediately)'
        Write-Warn2 "the assignment was NOT denied: policy $PolicyName is assigned but not enforced yet (a new assignment can take 5-30 min). Removing the probe assignment."
        Assert-LabContext
        Remove-AzRoleAssignment -InputObject $probe | Out-Null
        Write-Warn2 "re-run in a few minutes: pwsh ./scripts/seed-abac-lab.ps1 -ResetOnly -ProbePolicy"
    } catch {
        if ("$_" -match 'RequestDisallowedByPolicy|disallowed by policy') {
            Write-Ok "denied by $PolicyName (RequestDisallowedByPolicy) — the Activity Log now holds a real denied write"
        } else {
            Write-Warn2 "probe failed for another reason: $_"
        }
    }
}

# ---- teardown ----------------------------------------------------------------------------------------
if ($Teardown) {
    Write-Step "Teardown"
    if ($PSCmdlet.ShouldProcess($rgScope, "Remove policy assignment $PolicyName")) {
        Assert-LabContext
        Find-PolicyAssignment | Remove-AzPolicyAssignment | Out-Null
        Write-Ok "policy assignment removed"
    }
    $defParams = if ($DefinitionManagementGroupId) { @{ ManagementGroupId = $DefinitionManagementGroupId } } else { @{ SubscriptionId = $LabSubscriptionId } }
    if ($PSCmdlet.ShouldProcess($PolicyName, 'Remove policy definition')) {
        Assert-LabContext
        Find-PolicyDefinition -Scope $defParams | ForEach-Object { Remove-AzPolicyDefinition -Id $_.Id -Force | Out-Null }
        Write-Ok "policy definition removed"
    }
    if ($PSCmdlet.ShouldProcess($ResourceGroup, 'Remove resource group (storage account, containers, identity)')) {
        Assert-LabContext
        Remove-AzResourceGroup -Name $ResourceGroup -Force | Out-Null
        Write-Ok "resource group removed"
    }
    return
}

# ---- reset only (pre-take helper) ---------------------------------------------------------------------
if ($ResetOnly) {
    Write-Step "Reset: removing $IdentityName's Storage Blob Data Contributor assignments on $StorageAccount"
    $identity = Get-PayrollIdentity
    $null = Remove-PayrollAssignments -Identity $identity
    if ($ProbePolicy) { Invoke-PolicyProbe -Identity $identity }
    return
}

# ---- 1. resource group ---------------------------------------------------------------------------------
Write-Step "Resource group $ResourceGroup"
$rg = Get-AzResourceGroup -Name $ResourceGroup -ErrorAction SilentlyContinue
if (-not $rg -and $PSCmdlet.ShouldProcess($ResourceGroup, "Create resource group in $Location")) {
    Assert-LabContext
    $rg = New-AzResourceGroup -Name $ResourceGroup -Location $Location -Tag $Tags
}
Write-Ok $rgScope

# ---- 2. storage account + containers --------------------------------------------------------------------
Write-Step "Storage account $StorageAccount"
$sa = Get-AzStorageAccount -ResourceGroupName $ResourceGroup -Name $StorageAccount -ErrorAction SilentlyContinue
if (-not $sa) {
    $availability = Get-AzStorageAccountNameAvailability -Name $StorageAccount
    if (-not $availability.NameAvailable) { throw "Storage account name '$StorageAccount' is not available: $($availability.Message)" }
    if ($PSCmdlet.ShouldProcess($StorageAccount, 'Create StorageV2 Standard_LRS account')) {
        Assert-LabContext
        $sa = New-AzStorageAccount -ResourceGroupName $ResourceGroup -Name $StorageAccount -Location $Location -SkuName Standard_LRS -Kind StorageV2 `
            -AllowBlobPublicAccess $false -MinimumTlsVersion TLS1_2 -EnableHttpsTrafficOnly $true -Tag $Tags
    }
}
Write-Ok $storageScope
foreach ($name in $Containers) {
    $existing = Get-AzRmStorageContainer -ResourceGroupName $ResourceGroup -StorageAccountName $StorageAccount -Name $name -ErrorAction SilentlyContinue
    if (-not $existing -and $PSCmdlet.ShouldProcess("$StorageAccount/$name", 'Create blob container')) {
        Assert-LabContext
        $null = New-AzRmStorageContainer -ResourceGroupName $ResourceGroup -StorageAccountName $StorageAccount -Name $name -PublicAccess None
    }
    Write-Ok "container $name"
}

# ---- 3. the Function App's identity ----------------------------------------------------------------------
Write-Step "Managed identity $IdentityName"
$identity = Get-PayrollIdentity
if (-not $identity -and $PSCmdlet.ShouldProcess($IdentityName, 'Create user-assigned managed identity')) {
    Assert-LabContext
    $identity = New-AzUserAssignedIdentity -ResourceGroupName $ResourceGroup -Name $IdentityName -Location $Location -Tag $Tags
    Write-Ok "created; waiting 20 s for the service principal to replicate"
    Start-Sleep -Seconds 20
}
if ($identity) { Write-Ok "principalId $($identity.PrincipalId)" }

# ---- 4. policy definition + assignment ---------------------------------------------------------------------
Write-Step "Policy $PolicyName"
$policyRule = @{
    if   = @{
        allOf = @(
            @{ field = 'type'; equals = 'Microsoft.Authorization/roleAssignments' },
            @{ field = 'Microsoft.Authorization/roleAssignments/roleDefinitionId'; like = "*/$RoleDefinitionId" },
            @{ anyOf = @(
                    @{ field = 'Microsoft.Authorization/roleAssignments/condition'; exists = 'false' },
                    @{ field = 'Microsoft.Authorization/roleAssignments/condition'; equals = '' }
                ) }
        )
    }
    then = @{ effect = "[parameters('effect')]" }
} | ConvertTo-Json -Depth 20
$policyParameters = @{
    effect = @{
        type          = 'String'
        allowedValues = @('Deny', 'Audit', 'Disabled')
        defaultValue  = 'Deny'
        metadata      = @{ displayName = 'Effect' }
    }
} | ConvertTo-Json -Depth 10
$defScope = if ($DefinitionManagementGroupId) { @{ ManagementGroupId = $DefinitionManagementGroupId } } else { @{ SubscriptionId = $LabSubscriptionId } }
$definition = Find-PolicyDefinition -Scope $defScope
$defCommon = @{
    Name        = $PolicyName
    DisplayName = 'Require ABAC condition for Storage Blob Data Contributor'
    Description = 'Denies Storage Blob Data Contributor role assignments that carry no ABAC condition (least-privilege data access). ContextPane demo.'
    Policy      = $policyRule
    Parameter   = $policyParameters
    Mode        = 'All'
    Metadata    = (@{ category = 'Storage'; 'contextpane-demo' = 'abac' } | ConvertTo-Json)
}
if ($PSCmdlet.ShouldProcess($PolicyName, $(if ($definition) { 'Update policy definition' } else { 'Create policy definition' }))) {
    Assert-LabContext
    $definition = if ($definition) { Set-AzPolicyDefinition @defCommon @defScope } else { New-AzPolicyDefinition @defCommon @defScope }
}
if ($definition) { Write-Ok "definition $($definition.Id)" }

$assignment = Find-PolicyAssignment
if (-not $assignment -and $definition -and $PSCmdlet.ShouldProcess($rgScope, "Assign $PolicyName (Deny)")) {
    Assert-LabContext
    $assignment = New-AzPolicyAssignment -Name $PolicyName -DisplayName 'Require ABAC condition for Storage Blob Data Contributor' `
        -Scope $rgScope -PolicyDefinition $definition -PolicyParameterObject @{ effect = 'Deny' } `
        -Description 'Storage Blob Data Contributor on payroll storage needs an ABAC container condition. ContextPane demo.'
    Write-Ok "assigned at $rgScope"
} elseif ($assignment) {
    Write-Ok "assignment $($assignment.Id)"
}

# ---- 5. reset ------------------------------------------------------------------------------------------------
Write-Step "Reset: no Storage Blob Data Contributor for $IdentityName on $StorageAccount"
$null = Remove-PayrollAssignments -Identity $identity

# ---- 6. probe --------------------------------------------------------------------------------------------------
if (-not $SkipPolicyProbe) { Invoke-PolicyProbe -Identity $identity }

Write-Step "Done"
[pscustomobject]@{
    Subscription     = "$($ctx.Subscription.Name) ($LabSubscriptionId)"
    ResourceGroup    = $ResourceGroup
    StorageAccount   = $StorageAccount
    Containers       = $Containers -join ', '
    Identity         = $IdentityName
    PrincipalId      = if ($identity) { $identity.PrincipalId } else { $null }
    PolicyDefinition = if ($definition) { $definition.Id } else { $null }
    PolicyAssignment = if ($assignment) { $assignment.Id } else { $null }
    PortalIam        = "https://portal.azure.com/#@c4a8shili.onmicrosoft.com/resource$storageScope/iamAccessControl"
} | Format-List
