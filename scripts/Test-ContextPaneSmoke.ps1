#Requires -Version 7.0
<#
.SYNOPSIS
    Smoke-tests the ContextPane orchestrator: every tier endpoint, latency, and catalog schema shape.

.DESCRIPTION
    Calls GET /api/health, GET /api/recipe/default/hydrate, POST /api/hover, POST /api/correlate,
    POST /api/voice-steer, POST /api/remediate and GET /api/telemetry/stats, then prints a formatted
    table with status, latency, router tier/provider and a schema verdict.

    Schema checks mirror packages/catalog: component types must be inside the allow-list, every
    component carries an id + props, hover popovers carry headline/facts/quickActions/providerTelemetry,
    the remediation drawer carries powershellScript/terraformDiff/verificationStatus/approval.
    The orchestrator itself validates with Zod; `provenance.validated` is surfaced in the table.

    Exit code 0 when every check passes, 1 otherwise.

.EXAMPLE
    pwsh -NoProfile -File ./scripts/Test-ContextPaneSmoke.ps1
.EXAMPLE
    pwsh ./scripts/Test-ContextPaneSmoke.ps1 -TenantId tenant-fabrikam-02 -SkipRemediate
#>
[CmdletBinding()]
param(
    # 127.0.0.1 on purpose: Windows resolves "localhost" to ::1 first and burns ~2 s per request on the IPv6 fallback.
    [string]$BaseUrl = $(if ($env:CTX_ORCHESTRATOR_URL) { $env:CTX_ORCHESTRATOR_URL } else { 'http://127.0.0.1:4000' }),
    [ValidateSet('tenant-contoso-01', 'tenant-fabrikam-02')]
    [string]$TenantId = 'tenant-contoso-01',
    [switch]$SkipRemediate,
    [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$AllowedComponents = @('TenantSummaryHeader', 'LicenseDriftCard', 'EntraSignInTimeline', 'IaCDriftBanner', 'HoverDiagnosticPopover', 'ActionApprovalDrawer')
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
    if ($lic -and ($lic.props.driftedCount -ne [Math]::Max(0, $lic.props.erpBilledCount - $lic.props.entraAssignedCount))) { $issues += 'LicenseDriftCard.driftedCount inconsistent' }
    $iac = $layout.components | Where-Object type -eq 'IaCDriftBanner' | Select-Object -First 1
    if ($iac -and -not $iac.props.hclDiff) { $issues += 'IaCDriftBanner.hclDiff empty' }
    return $issues
}

Write-Host "`nContextPane smoke test -> $BaseUrl  (tenant $TenantId)" -ForegroundColor Cyan

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

$null = Invoke-Check -Name hydrate -Method GET -Path "/api/recipe/default/hydrate?tenantId=$TenantId" -BudgetMs 150 -Schema {
    param($r)
    $i = Test-Layout $r.layout
    if ($r.telemetry.tier -ne 'Tier 0') { $i += "tier $($r.telemetry.tier) != Tier 0" }
    if ($r.telemetry.tokensUsed.total -ne 0) { $i += 'Tier 0 used tokens' }
    if (-not $r.recipe.recipeId) { $i += 'recipe missing' }
    $i
}

$hoverEntity = if ($TenantId -eq 'tenant-contoso-01') { 'lynne.robins.contoso@c4a8shili.onmicrosoft.com' } else { 'grady.archie.legal@fabrikamlegal.onmicrosoft.com' }
$null = Invoke-Check -Name hover -Method POST -Path '/api/hover' -Body @{ tenantId = $TenantId; entityId = $hoverEntity } -BudgetMs 350 -Schema {
    param($r)
    $p = $r.popover
    $i = @()
    if (-not $p) { return @('popover missing') }
    foreach ($k in 'entityId', 'entityType', 'status', 'headline', 'facts', 'quickActions', 'providerTelemetry') { if ($null -eq $p.$k) { $i += "popover.$k missing" } }
    if ($p.headline.Length -gt 120) { $i += 'headline > 120 chars' }
    if ($r.telemetry.tier -ne 'Tier 1A') { $i += "tier $($r.telemetry.tier) != Tier 1A" }
    $i
}
$null = Invoke-Check -Name hover-code -Method POST -Path '/api/hover' -Body @{ tenantId = $TenantId; entityId = 'AADSTS53003'; entityType = 'errorCode' } -BudgetMs 350 -Schema {
    param($r)
    $i = @()
    if ($r.popover.errorCodeTranslation.code -ne 'AADSTS53003') { $i += 'errorCodeTranslation missing' }
    $i
}

$null = Invoke-Check -Name correlate -Method POST -Path '/api/correlate' -Body @{ tenantId = $TenantId } -Schema {
    param($r)
    $i = Test-Layout $r.layout
    if ($r.telemetry.tier -notin @('Tier 1B', 'Tier 2')) { $i += "tier $($r.telemetry.tier) not 1B/2" }
    $types = @($r.layout.components | ForEach-Object type)
    foreach ($t in 'TenantSummaryHeader', 'LicenseDriftCard', 'EntraSignInTimeline', 'IaCDriftBanner') { if ($types -notcontains $t) { $i += "missing $t" } }
    if (-not $r.layout.provenance.validated -and $r.layout.provenance.repaired.Count -eq 0) { $i += 'provenance.validated false without repair' }
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

if (-not $SkipRemediate) {
    $rem = Invoke-Check -Name remediate -Method POST -Path '/api/remediate' -Body @{ tenantId = $TenantId } -Schema {
        param($r)
        $d = $r.drawer
        $i = @()
        if (-not $d) { return @('drawer missing') }
        foreach ($k in 'remediationId', 'ticketId', 'powershellScript', 'terraformDiff', 'verificationStatus', 'approval', 'affectedEntities', 'synthesizedBy') { if ($null -eq $d.$k) { $i += "drawer.$k missing" } }
        if ($d.powershellScript -notmatch 'Set-MgUserLicense') { $i += 'script lacks Set-MgUserLicense' }
        if ($d.terraformDiff -notmatch '^@@' -and $d.terraformDiff -notmatch '\n@@') { $i += 'terraformDiff is not unified' }
        if ($d.verificationStatus.verdict -eq 'Verification Failed') { $i += "verdict: $($d.verificationStatus.verdict) ($($d.verificationStatus.findings -join '; '))" }
        if ($d.approval.state -ne 'pending') { $i += "approval.state $($d.approval.state) != pending" }
        if ($r.telemetry.tier -notlike 'Tier 3*') { $i += "tier $($r.telemetry.tier) not Tier 3" }
        $i
    }
    if ($rem) {
        $v = $rem.drawer.verificationStatus
        Write-Host "  pre-flight: $($v.verdict)  ast=$($v.astCheckPassed) fmt=$($v.terraformFmtPassed) validate=$($v.terraformValidatePassed) sandbox=$($v.sandboxProvider) $($v.validationLatencyMs)ms  branch=$($rem.drawer.staging.branchName)" -ForegroundColor DarkGray
        $null = Invoke-Check -Name approve -Method POST -Path '/api/approve' -Body @{ remediationId = $rem.drawer.remediationId } -Schema {
            param($r)
            $i = @()
            if ($r.drawer.approval.state -notin @('approved', 'simulated', 'executed')) { $i += "approval.state $($r.drawer.approval.state)" }
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
