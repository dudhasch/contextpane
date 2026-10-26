#Requires -Version 7.0
<#
.SYNOPSIS
    Smoke-tests the ContextPane orchestrator: every tier endpoint, latency, and catalog schema shape.

.DESCRIPTION
    Calls GET /api/health, GET /api/scenarios, GET /api/scenarios/:id/brief, GET /api/recipe/default/hydrate,
    POST /api/hover, POST /api/correlate, POST /api/voice-steer, POST /api/vision-extract (INC-4092 with a
    Meta key only), POST /api/remediate, POST /api/remediate/approve, POST /api/lab/reset-drift,
    GET /api/audit and GET /api/telemetry/stats for one scenario, then prints a formatted table with
    status, latency, router tier/provider and a schema verdict.

    With LIVE_CLOUD_MODE=true a -Mode break-glass approval writes the scenario's lab objects (license
    extension, Conditional Access, Intune, and INC-4092's NSG over ARM) and commits a reconcile
    commit on the fix branch; the reset-drift check right after it puts them back, so a run leaves
    the lab drifted. -Mode gitops writes nothing live and re-runs the pre-flight instead.

    Schema checks mirror packages/catalog: component types must be inside the allow-list, every
    component carries an id + props, the scenario's cards are all present, hover popovers carry
    headline/facts/quickActions/providerTelemetry, the remediation drawer carries
    powershellScript/terraformDiff/graphPatch/verificationStatus/approval and passes the -WhatIf proof.
    The orchestrator itself validates with Zod; `provenance.validated` is surfaced in the table.

    Exit code 0 when every check passes, 1 otherwise.

.EXAMPLE
    pwsh -NoProfile -File ./scripts/Test-ContextPaneSmoke.ps1
.EXAMPLE
    pwsh ./scripts/Test-ContextPaneSmoke.ps1 -ScenarioId ANOM-CA-204 -SkipRemediate
#>
[CmdletBinding()]
param(
    # 127.0.0.1 on purpose: Windows resolves "localhost" to ::1 first and burns ~2 s per request on the IPv6 fallback.
    [string]$BaseUrl = $(if ($env:CTX_ORCHESTRATOR_URL) { $env:CTX_ORCHESTRATOR_URL } else { 'http://127.0.0.1:4000' }),
    [ValidateSet('INC-4092', 'INC-4099', 'ANOM-LIC-101', 'ANOM-CA-204', 'ANOM-INT-309')]
    [string]$ScenarioId = 'INC-4092',
    # break-glass: live write + reconcile commit + convergence. gitops: no live write, pre-flight re-run, approval.state 'staged'.
    [ValidateSet('break-glass', 'gitops')]
    [string]$Mode = 'break-glass',
    [switch]$SkipRemediate,
    [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$AllowedComponents = @('LicenseDriftCard', 'EntraSignInTimeline', 'IntuneDriftCard', 'IaCDriftBanner', 'HoverDiagnosticPopover', 'ActionApprovalDrawer')
# Mirrors SCENARIO_REGISTRY in packages/catalog/src/scenarios.ts.
$ScenarioCards = @{
    'INC-4092'     = @('LicenseDriftCard', 'EntraSignInTimeline', 'IaCDriftBanner')
    'INC-4099'     = @('IntuneDriftCard', 'EntraSignInTimeline')
    'ANOM-LIC-101' = @('LicenseDriftCard')
    'ANOM-CA-204'  = @('EntraSignInTimeline')
    'ANOM-INT-309' = @('IntuneDriftCard')
}
$TenantId = $(if ($ScenarioId -eq 'INC-4099') { 'tenant-fabrikam-02' } else { 'tenant-contoso-01' })
$results = [System.Collections.Generic.List[object]]::new()

function Invoke-Check {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Path,
        [object]$Body,
        [scriptblock]$Schema,
        [int]$BudgetMs = 0
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $row = [ordered]@{ Endpoint = "$Method $Path"; Status = '-'; 'Latency(ms)' = 0; Tier = '-'; Provider = '-'; Model = '-'; Tokens = 0; Schema = '-'; Note = '' }
    try {
        $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; TimeoutSec = $TimeoutSec; ContentType = 'application/json' }
        if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress) }
        $response = Invoke-RestMethod @params
        $sw.Stop()
        $row.Status = 'OK'
        $row.'Latency(ms)' = $sw.ElapsedMilliseconds
        $t = $response.telemetry
        if ($t) {
            $row.Tier = $t.tier; $row.Provider = $t.provider; $row.Model = $t.modelId
            $row.Tokens = $t.tokensUsed.total
            $row.'Latency(ms)' = "$($sw.ElapsedMilliseconds) (srv $($t.latencyMs))"
        }
        $issues = @(& $Schema $response)
        if ($issues.Count -eq 0) { $row.Schema = 'PASS' } else { $row.Schema = 'FAIL'; $row.Note = ($issues -join '; ') }
        if ($BudgetMs -gt 0 -and $t -and $t.latencyMs -gt $BudgetMs) { $row.Note = "$($row.Note) over budget ${BudgetMs}ms".Trim() }
    } catch {
        $sw.Stop()
        $row.Status = 'ERROR'
        $row.'Latency(ms)' = $sw.ElapsedMilliseconds
        $row.Schema = 'FAIL'
        $row.Note = $_.Exception.Message
    }
    $results.Add([pscustomobject]$row)
    return $response
}

function Test-Layout($layout) {
    $issues = @()
    if (-not $layout) { return @('layout missing') }
    if (-not $layout.layoutId) { $issues += 'layout.layoutId missing' }
    if (-not $layout.provenance) { $issues += 'layout.provenance missing' }
    if (-not ($layout.components -is [array]) -or $layout.components.Count -lt 1) { $issues += 'layout.components empty' }
    foreach ($c in $layout.components) {
        if ($AllowedComponents -notcontains $c.type) { $issues += "component type '$($c.type)' outside catalog" }
        if (-not $c.id) { $issues += "component without id ($($c.type))" }
        if (-not $c.props) { $issues += "component without props ($($c.type))" }
    }
    $lic = $layout.components | Where-Object type -eq 'LicenseDriftCard' | Select-Object -First 1
    if ($lic -and @($lic.props.users).Count -lt 1) { $issues += 'LicenseDriftCard.users empty' }
    $iac = $layout.components | Where-Object type -eq 'IaCDriftBanner' | Select-Object -First 1
    if ($iac -and -not $iac.props.hclDiff) { $issues += 'IaCDriftBanner.hclDiff empty' }
    return $issues
}

Write-Host "`nContextPane smoke test -> $BaseUrl  (scenario $ScenarioId, $TenantId)" -ForegroundColor Cyan

$health = Invoke-Check -Name health -Method GET -Path '/api/health' -Schema {
    param($r)
    $i = @()
    if (-not $r.ok) { $i += 'ok != true' }
    if ($r.mcp.servers.Count -ne 3) { $i += "expected 3 MCP servers, got $($r.mcp.servers.Count)" }
    foreach ($s in $r.mcp.servers) { if (-not $s.ok) { $i += "MCP $($s.name) not ok" } }
    $i
}
if ($health) {
    $keyed = @($health.providers | Where-Object hasKey | ForEach-Object id)
    Write-Host "  live cloud: $($health.liveCloudMode)  providers with keys: $(if ($keyed) { $keyed -join ', ' } else { 'none (deterministic)' })  MCP: $($health.mcp.transport)" -ForegroundColor DarkGray
}

$null = Invoke-Check -Name scenarios -Method GET -Path '/api/scenarios' -Schema {
    param($r)
    $i = @()
    if (@($r.scenarios).Count -ne 5) { $i += "expected 5 scenarios, got $(@($r.scenarios).Count)" }
    if (@($r.scenarios | Where-Object kind -eq 'ticket').Count -ne 2) { $i += 'expected 2 tickets' }
    if (@($r.scenarios | Where-Object kind -eq 'anomaly').Count -ne 3) { $i += 'expected 3 anomalies' }
    $i
}

$briefResponse = Invoke-Check -Name brief -Method GET -Path "/api/scenarios/$ScenarioId/brief" -Schema {
    param($r)
    $b = $r.brief
    $i = @()
    if (-not $b) { return @('brief missing') }
    if (-not $b.summary) { $i += 'summary missing' }
    if (@($b.steps).Count -lt 1) { $i += 'no resolution steps' }
    if (@($b.entities).Count -lt 1) { $i += 'no enriched entities' }
    foreach ($e in $b.entities) {
        if ($e.category -notin @('licensing', 'identity', 'intune', 'azure')) { $i += "entity $($e.id) has category '$($e.category)'" }
        if ($ScenarioCards[$ScenarioId] -notcontains $e.target) { $i += "entity $($e.id) targets $($e.target), not a card of $ScenarioId" }
    }
    $i
}

$null = Invoke-Check -Name hydrate -Method GET -Path "/api/recipe/default/hydrate?scenarioId=$ScenarioId" -BudgetMs 150 -Schema {
    param($r)
    $i = Test-Layout $r.layout
    if ($r.telemetry.tier -ne 'Tier 0') { $i += "tier $($r.telemetry.tier) != Tier 0" }
    if ($r.telemetry.tokensUsed.total -ne 0) { $i += 'Tier 0 used tokens' }
    if (-not $r.recipe.recipeId) { $i += 'recipe missing' }
    $i
}

$entities = @($briefResponse.brief.entities | Where-Object hoverable)
$hoverEntity = $entities | Where-Object type -eq 'upn' | Select-Object -First 1
if (-not $hoverEntity) { $hoverEntity = $entities | Select-Object -First 1 }
$null = Invoke-Check -Name hover -Method POST -Path '/api/hover' -Body @{ scenarioId = $ScenarioId; entityId = $hoverEntity.id; entityType = $hoverEntity.type } -BudgetMs 350 -Schema {
    param($r)
    $p = $r.popover
    $i = @()
    if (-not $p) { return @('popover missing') }
    foreach ($k in 'entityId', 'entityType', 'status', 'headline', 'facts', 'quickActions', 'providerTelemetry') { if ($null -eq $p.$k) { $i += "popover.$k missing" } }
    if ($p.headline.Length -gt 120) { $i += 'headline > 120 chars' }
    if ($r.telemetry.tier -ne 'Tier 1A') { $i += "tier $($r.telemetry.tier) != Tier 1A" }
    $i
}
$errorCode = $entities | Where-Object type -eq 'errorCode' | Select-Object -First 1
if ($errorCode) {
    $null = Invoke-Check -Name hover-code -Method POST -Path '/api/hover' -Body @{ scenarioId = $ScenarioId; entityId = $errorCode.id; entityType = 'errorCode' } -BudgetMs 350 -Schema {
        param($r)
        $i = @()
        if ($r.popover.errorCodeTranslation.code -ne $errorCode.id) { $i += "errorCodeTranslation for $($errorCode.id) missing" }
        $i
    }
}

$null = Invoke-Check -Name correlate -Method POST -Path '/api/correlate' -Body @{ scenarioId = $ScenarioId } -Schema {
    param($r)
    $i = Test-Layout $r.layout
    if ($r.telemetry.tier -notin @('Tier 1B', 'Tier 2')) { $i += "tier $($r.telemetry.tier) not 1B/2" }
    $types = @($r.layout.components | ForEach-Object type)
    foreach ($t in $ScenarioCards[$ScenarioId]) { if ($types -notcontains $t) { $i += "missing $t" } }
    foreach ($c in $r.layout.components | Where-Object { $ScenarioCards[$ScenarioId] -contains $_.type }) {
        if (@($c.triggeredBy).Count -lt 1) { $i += "$($c.type) has no triggeredBy" }
        foreach ($ptr in $c.dataPtrs.PSObject.Properties.Value) { if ($ptr -notlike "ptr://$($ScenarioId.ToLower())/*") { $i += "$($c.type) pointer $ptr" } }
        if (@($c.dataPtrs.PSObject.Properties).Count -lt 1) { $i += "$($c.type) has no dataPtrs" }
        # Line provenance: the NSG block, the CA-204 golden policy, the Intune golden setting.
        if (($c.type -in 'IaCDriftBanner', 'IntuneDriftCard' -or $ScenarioId -eq 'ANOM-CA-204') -and $c.props.sourceRef.startLine -lt 1) { $i += "$($c.type) has no sourceRef" }
    }
    if ($r.context.dataPlane -and @($r.context.dataPlane.rejected).Count) { $i += "model pointers replaced: $($r.context.dataPlane.rejected -join '; ')" }
    if (-not $r.layout.provenance.validated -and $r.layout.provenance.repaired.Count -eq 0) { $i += 'provenance.validated false without repair' }
    $i
}

$null = Invoke-Check -Name dataplane -Method GET -Path "/api/dataplane/$ScenarioId" -Schema {
    param($r)
    $i = @()
    if (@($r.datasets).Count -lt 1) { $i += 'no datasets published' }
    foreach ($d in $r.datasets) { if ($d.aggregates.PSObject.Properties.Name -contains 'upn') { $i += "$($d.ptr) aggregates upn" } }
    $i
}

$null = Invoke-Check -Name voice -Method POST -Path '/api/voice-steer' -Body @{ tenantId = $TenantId; text = 'only show license drift and the sign-in timeline' } -Schema {
    param($r)
    $i = @()
    if ($r.intent.intent -ne 'filter') { $i += "intent $($r.intent.intent) != filter" }
    if (@($r.intent.componentTypes).Count -ne 2) { $i += 'expected 2 component types' }
    if ($r.telemetry.tier -ne 'Voice') { $i += 'tier != Voice' }
    $i
}

$metaKey = [bool]($health.providers | Where-Object { $_.id -eq 'meta' -and $_.hasKey })
$attachment = Join-Path $PSScriptRoot '..' 'apps' 'web' 'public' 'attachments' 'contoso-avd-error-screenshot.png'
if ($metaKey -and $ScenarioId -eq 'INC-4092' -and (Test-Path $attachment)) {
    $png = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($attachment))
    $null = Invoke-Check -Name vision -Method POST -Path '/api/vision-extract' -Body @{ tenantId = $TenantId; ticketId = 'INC-4092'; fileName = 'contoso-avd-error-screenshot.png'; imageDataUri = "data:image/png;base64,$png" } -Schema {
        param($r)
        $i = @()
        if ($r.extraction.errorCode -ne 'AADSTS53003') { $i += "errorCode $($r.extraction.errorCode)" }
        if ($r.extraction.correlationId -ne '7f8a9d12-4410-4b9e-9c1a-00155d8a4201') { $i += 'correlationId mismatch' }
        if (-not $r.match.eventId) { $i += 'no sign-in matched' }
        if ($r.telemetry.tier -ne 'Vision') { $i += 'tier != Vision' }
        $i
    }
}

if (-not $SkipRemediate) {
    $rem = Invoke-Check -Name remediate -Method POST -Path '/api/remediate' -Body @{ scenarioId = $ScenarioId } -Schema {
        param($r)
        $d = $r.drawer
        $i = @()
        if (-not $d) { return @('drawer missing') }
        foreach ($k in 'remediationId', 'ticketId', 'powershellScript', 'terraformDiff', 'graphPatch', 'verificationStatus', 'approval', 'affectedEntities', 'synthesizedBy') { if ($null -eq $d.$k) { $i += "drawer.$k missing" } }
        if ($ScenarioId -in @('INC-4092', 'ANOM-LIC-101') -and $d.powershellScript -notmatch 'Set-MgUserLicense') { $i += 'script lacks Set-MgUserLicense' }
        if ($d.powershellScript -notmatch 'ShouldProcess') { $i += 'script has no ShouldProcess guard' }
        if ($d.verificationStatus.whatIfSafe -eq $false) { $i += 'a mutating cmdlet sits outside ShouldProcess' }
        if ($ScenarioId -eq 'INC-4092') {
            if ($d.terraformDiff -notmatch '^@@' -and $d.terraformDiff -notmatch '\n@@') { $i += 'terraformDiff is not unified' }
        } elseif ($d.terraformDiff) { $i += 'terraformDiff should be empty (no IaC in this scenario)' }
        if ($ScenarioId -ne 'INC-4092' -and -not $d.graphPatch) { $i += 'graphPatch empty' }
        if ($d.verificationStatus.verdict -eq 'Verification Failed') { $i += "verdict: $($d.verificationStatus.verdict) ($($d.verificationStatus.findings -join '; '))" }
        if ($d.approval.state -ne 'pending') { $i += "approval.state $($d.approval.state) != pending" }
        if ($r.telemetry.tier -notlike 'Tier 3*') { $i += "tier $($r.telemetry.tier) not Tier 3" }
        $i
    }
    if ($rem) {
        $v = $rem.drawer.verificationStatus
        Write-Host "  pre-flight: $($v.verdict)  ast=$($v.astCheckPassed) whatIf=$($v.whatIfSafe) fmt=$($v.terraformFmtPassed) validate=$($v.terraformValidatePassed) sandbox=$($v.sandboxProvider) $($v.validationLatencyMs)ms  branch=$($rem.drawer.staging.branchName)" -ForegroundColor DarkGray
        $null = Invoke-Check -Name "approve:$Mode" -Method POST -Path '/api/remediate/approve' -Body @{ remediationId = $rem.drawer.remediationId; mode = $Mode } -Schema {
            param($r)
            $i = @()
            if ($r.drawer.approval.mode -ne $Mode) { $i += "approval.mode $($r.drawer.approval.mode)" }
            if ($Mode -eq 'gitops') {
                if ($r.drawer.approval.state -ne 'staged') { $i += "approval.state $($r.drawer.approval.state) != staged" }
                if ($r.convergence) { $i += 'GitOps must not converge the canvas' }
                if (-not ($r.drawer.executionLog -match '^Pre-flight re-run')) { $i += 'no pre-flight re-run' }
            } else {
                if ($r.drawer.approval.state -notin @('approved', 'simulated', 'executed')) { $i += "approval.state $($r.drawer.approval.state)" }
                if (-not ($r.drawer.staging.filesChanged -match 'reconciled-state\.json$')) { $i += 'no reconcile commit' }
                if (-not $r.convergence) { $i += 'no convergence pushed' }
                elseif ($r.convergence.scenarioId -ne $ScenarioId) { $i += "convergence for $($r.convergence.scenarioId)" }
                elseif ($ScenarioId -eq 'INC-4092' -and @($r.convergence.remediatedUpns).Count -lt 1) { $i += 'convergence lists no users' }
            }
            $i
        }
        $null = Invoke-Check -Name reset -Method POST -Path '/api/lab/reset-drift' -Body @{ scenarioId = $ScenarioId } -Schema {
            param($r)
            $i = @()
            if (-not $r.ok) { $i += "reset failed: $(($r.results.failed | ForEach-Object { $_.id }) -join ', ')" }
            $i
        }
        $null = Invoke-Check -Name audit -Method GET -Path '/api/audit?limit=5' -Schema {
            param($r)
            $i = @()
            $types = @($r.entries.actionType)
            foreach ($t in 'remediation-verified', 'hitl-approval', 'drift-reset') { if ($t -notin $types) { $i += "audit lacks $t" } }
            $i
        }
    }
}

$null = Invoke-Check -Name stats -Method GET -Path '/api/telemetry/stats' -Schema {
    param($r)
    $i = @()
    if ($r.totalRequests -lt 5) { $i += "only $($r.totalRequests) requests recorded" }
    if ($r.zeroTokenRequests -lt 1) { $i += 'no zero-token requests recorded' }
    $i
}

Write-Host ''
$results | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host

$failed = @($results | Where-Object { $_.Status -ne 'OK' -or $_.Schema -ne 'PASS' })
if ($failed.Count -eq 0) {
    Write-Host "All $($results.Count) checks passed." -ForegroundColor Green
    exit 0
}
Write-Host "$($failed.Count) of $($results.Count) checks failed." -ForegroundColor Red
exit 1
