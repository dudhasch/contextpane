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

    Live agency: POST /api/explore-selection (highlight → ContextualMiniDashboard, rows under
    ptr://<scenario>/selection/<hash>), POST /api/tickets/triage-custom (an unscripted ticket becomes a
    CUSTOM-<hash> scenario with ptr://custom-<hash>/... pointers, brief, correlate, formal proof and timeline),
    and after a break-glass approval GET /api/tickets/:id/resolution-note + POST /api/tickets/close
    (ticket.closed in the audit ledger).

    Unified work queue & ERP inbox: GET /api/scenarios carries origin / displayId / createdAt for every
    item (psa, anomaly, erp-drop, unscripted); GET /api/tickets/inbox lists the seeded input/tickets/#2026323
    drop with attachment1.png; GET /api/tickets/inbox-attachment/%232026323/attachment1.png serves the PNG;
    POST /api/tickets/simulate-drop writes a fresh #2026xxx folder that the watcher ingests (brief, correlate,
    POST /api/vision/triage reading the file from disk, muse-vision or the deterministic fallback); the folder
    is removed afterwards and must leave the inbox on the next scan. #ANOM-APP-401: summary and steps end on
    full words, the sign-in / audit history carries distinct timestamps.

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
    [ValidateSet('INC-4092', 'INC-4099', 'ANOM-LIC-101', 'ANOM-CA-204', 'ANOM-INT-309', 'ANOM-APP-401')]
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
    'ANOM-APP-401' = @('EntraSignInTimeline')
}
$TenantId = $(if ($ScenarioId -eq 'INC-4099') { 'tenant-fabrikam-02' } else { 'tenant-contoso-01' })
# A phrase an engineer would highlight in each scenario's text, and the dataset it must resolve to.
$SelectionProbe = @{
    'INC-4092'     = @{ text = 'port 3389'; kind = 'azure-nsg-rules' }
    'INC-4099'     = @{ text = 'uncompliant device'; kind = 'intune-devices' }
    'ANOM-LIC-101' = @{ text = 'disabled accounts'; kind = 'entra-users' }
    'ANOM-CA-204'  = @{ text = 'SG-BreakGlass-Accounts'; kind = 'entra-ca-policies' }
    'ANOM-INT-309' = @{ text = 'ASR'; kind = 'intune-settings' }
    'ANOM-APP-401' = @{ text = 'expired client secret'; kind = 'workload-identity' }
}
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
    $builtIn = @($r.scenarios | Where-Object { -not $_.custom })
    if ($builtIn.Count -ne 6) { $i += "expected 6 built-in scenarios, got $($builtIn.Count)" }
    if (@($builtIn | Where-Object kind -eq 'ticket').Count -ne 2) { $i += 'expected 2 built-in tickets' }
    if (@($builtIn | Where-Object kind -eq 'anomaly').Count -ne 4) { $i += 'expected 4 anomalies' }
    if (@($builtIn | Where-Object origin -eq 'psa').Count -ne 2 -or @($builtIn | Where-Object origin -eq 'anomaly').Count -ne 4) { $i += 'built-in origins must be 2 psa + 4 anomaly' }
    foreach ($s in $r.scenarios) {
        if ($s.origin -notin @('psa', 'anomaly', 'erp-drop', 'unscripted')) { $i += "$($s.scenarioId) origin '$($s.origin)'" }
        if (-not $s.displayId -or -not $s.displayId.StartsWith('#')) { $i += "$($s.scenarioId) displayId '$($s.displayId)'" }
        if (-not $s.createdAt) { $i += "$($s.scenarioId) createdAt missing" }
    }
    foreach ($c in @($r.scenarios | Where-Object custom)) {
        if ($c.scenarioId -notmatch '^(CUSTOM-[A-Z0-9]{4,12}|ERP-[A-Z0-9]{3,16})$' -or $c.kind -ne 'ticket') { $i += "custom scenario $($c.scenarioId) malformed" }
        if ($c.custom.origin -ne $c.origin) { $i += "$($c.scenarioId) custom.origin != origin" }
    }
    $seed = $r.scenarios | Where-Object scenarioId -eq 'ERP-2026323'
    if (-not $seed) { $i += 'seeded ERP-2026323 (input/tickets/#2026323) not in the queue' }
    elseif ($seed.origin -ne 'erp-drop' -or $seed.displayId -ne '#2026323') { $i += "ERP-2026323 origin/displayId $($seed.origin)/$($seed.displayId)" }
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
            if ($r.canary.finalState -ne 'CONVERGED') { $i += "canary $($r.canary.finalState) != CONVERGED" }
            if (@($r.canary.stages.stage) -join ',' -ne 'APPLIED,CANARY_RING_0,SYNTHETIC_PROBED,CONVERGED') { $i += 'canary stage order wrong' }
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
        # --- Live agency 4: end-to-end closure (a converged scenario drafts its PSA note, then closes) ---
        if ($Mode -eq 'break-glass') {
            $null = Invoke-Check -Name resolution-note -Method GET -Path "/api/tickets/$ScenarioId/resolution-note" -Schema {
                param($r)
                $n = $r.note
                $i = @()
                if (-not $n) { return @('note missing') }
                if ($n.status -ne 'RESOLVED & VERIFIED') { $i += "status $($n.status)" }
                if (-not $n.customerSummary) { $i += 'customerSummary empty' }
                $trail = @($n.technicalAuditTrail) -join "`n"
                foreach ($k in 'Formal invariants', 'Canary probes', 'Git:', 'Inverse rollback', 'Pre-flight') { if ($trail -notmatch [regex]::Escape($k)) { $i += "audit trail lacks '$k'" } }
                if ($trail -notmatch 'CONVERGED') { $i += 'canary trace not CONVERGED' }
                if ($n.markdown -notmatch '## Technical audit trail') { $i += 'markdown lacks audit trail' }
                $i
            }
            $null = Invoke-Check -Name ticket-close -Method POST -Path '/api/tickets/close' -Body @{ scenarioId = $ScenarioId } -Schema {
                param($r)
                $i = @()
                if (-not $r.ok) { $i += 'close not ok' }
                if ($r.note.status -ne 'CLOSED') { $i += "note status $($r.note.status)" }
                if ($r.audit.actionType -ne 'ticket-closed') { $i += "audit $($r.audit.actionType) != ticket-closed" }
                if ($r.audit.detail -notmatch 'ticket\.closed') { $i += 'audit detail lacks ticket.closed' }
                $i
            }
        }
        $null = Invoke-Check -Name reset -Method POST -Path '/api/lab/reset-drift' -Body @{ scenarioId = $ScenarioId } -Schema {
            param($r)
            $i = @()
            if (-not $r.ok) { $i += "reset failed: $(($r.results.failed | ForEach-Object { $_.id }) -join ', ')" }
            $i
        }
        $null = Invoke-Check -Name audit -Method GET -Path '/api/audit?limit=8' -Schema {
            param($r)
            $i = @()
            $types = @($r.entries.actionType)
            $expected = @('remediation-verified', 'hitl-approval', 'drift-reset') + $(if ($Mode -eq 'break-glass') { @('ticket-closed') } else { @() })
            foreach ($t in $expected) { if ($t -notin $types) { $i += "audit lacks $t" } }
            $i
        }
    }
}

$null = Invoke-Check -Name formal -Method GET -Path "/api/formal/$ScenarioId" -Schema {
    param($r)
    $i = @()
    if (-not $r.formal.passed) { $i += 'formal invariants failed' }
    if (@($r.formal.invariants).Count -ne 3) { $i += "expected 3 invariants, got $(@($r.formal.invariants).Count)" }
    if ($r.formal.latencyMs -ge 100) { $i += "formal prover $($r.formal.latencyMs)ms >= 100ms" }
    if ($r.blastRadius.collateralChanges -ne 0) { $i += 'collateral changes != 0' }
    if ($ScenarioId -eq 'INC-4092' -and $r.blastRadius.targetBlockedToAllowed -lt 1) { $i += 'no target Blocked->Allowed' }
    if (-not $r.rollback.powershellScript) { $i += 'rollback f^-1 powershell missing' }
    if (-not $r.idempotency.passed) { $i += 'idempotency f(f(S))=f(S) failed' }
    $i
}

$null = Invoke-Check -Name timeline -Method GET -Path "/api/timeline/$ScenarioId" -Schema {
    param($r)
    $i = @()
    $s = @($r.timeline.slices)
    if ($s.Count -lt 4 -or $s.Count -gt 5) { $i += "expected 4-5 slices, got $($s.Count)" }
    if ($r.telemetry.tier -ne 'Tier 0') { $i += 'timeline not Tier 0' }
    if ($ScenarioId -eq 'INC-4092') {
        if ($s[0].relativeLabel -ne 'T-18m') { $i += 'first slice not T-18m' }
        if ($s[-1].relativeLabel -ne 'T+Fix') { $i += 'last slice not T+Fix' }
    }
    $i
}

$null = Invoke-Check -Name skills-compile -Method POST -Path '/api/skills/compile' -Body @{ scenarioId = $ScenarioId } -Schema {
    param($r)
    $i = @()
    if (-not $r.promoted) { $i += 'skill not promoted to Tier 0' }
    if ($r.skill.fuzz.passed -ne 100 -or $r.skill.fuzz.cases -ne 100) { $i += "fuzz $($r.skill.fuzz.passed)/$($r.skill.fuzz.cases) != 100/100" }
    if ($r.skill.tier -ne 0) { $i += 'skill tier != 0' }
    $i
}

$null = Invoke-Check -Name skills-match -Method GET -Path "/api/skills/match/$ScenarioId" -Schema {
    param($r)
    $i = @()
    if (-not $r.matched) { $i += 'Tier 0 skill lookup missed' }
    $i
}

$ptr = [uri]::EscapeDataString("ptr://$($ScenarioId.ToLower())/entra/users?where=driftStatus:drifted&select=upn,currentSku,expectedSku&order=upn")
$null = Invoke-Check -Name dataplane-ptr-v2 -Method GET -Path "/api/dataplane?ptr=$ptr" -Schema {
    param($r)
    $i = @()
    # License scenarios publish users; others may 404 the entra/users dataset — Invoke-Check already flags HTTP errors.
    if ($r.rows) { foreach ($row in @($r.rows)) { if ($row.PSObject.Properties.Name -contains 'displayName') { $i += 'select projection leaked displayName' } } }
    $i
}

$null = Invoke-Check -Name dataplane-pii -Method GET -Path "/api/dataplane/$ScenarioId" -Schema {
    param($r)
    $i = @()
    if ($null -eq $r.piiMetrics) { $i += 'piiMetrics missing' }
    elseif ($r.piiMetrics.zeroRawPiiInLlmPrompt -ne $true) { $i += 'zeroRawPiiInLlmPrompt != true' }
    $i
}

# --- Live agency 1: highlight any text -> ContextualMiniDashboard --------------------------------
$probe = $SelectionProbe[$ScenarioId]
$explore = Invoke-Check -Name explore-selection -Method POST -Path '/api/explore-selection' -Body @{ scenarioId = $ScenarioId; selectedText = $probe.text } -BudgetMs 8000 -Schema {
    param($r)
    $c = $r.card
    $i = @()
    if (-not $c) { return @('card missing') }
    if ($c.provenanceCategory -ne 'selection') { $i += "provenanceCategory $($c.provenanceCategory) != selection" }
    if ($c.selectionText -ne $probe.text) { $i += "selectionText '$($c.selectionText)'" }
    if (@($c.kpis).Count -lt 2 -or @($c.kpis).Count -gt 4) { $i += "kpis $(@($c.kpis).Count) not 2-4" }
    if (@($c.breakdown).Count -lt 2 -or @($c.breakdown).Count -gt 5) { $i += "breakdown $(@($c.breakdown).Count) not 2-5" }
    foreach ($k in $c.kpis) { if ($k.tone -notin @('default', 'warning', 'critical', 'success')) { $i += "kpi tone $($k.tone)" } }
    if ($c.rowsPtr -notlike "ptr://$($ScenarioId.ToLower())/selection/*") { $i += "rowsPtr $($c.rowsPtr)" }
    if ($c.rowsPtr -ne $r.dataPtr) { $i += 'rowsPtr != dataPtr' }
    if (@($c.rows).Count -lt 1) { $i += 'no rows matched' }
    if (@($c.rows).Count -ne $r.slice.rowCount) { $i += "rows $(@($c.rows).Count) != slice.rowCount $($r.slice.rowCount)" }
    if ($r.slice.kind -ne $probe.kind) { $i += "slice $($r.slice.kind) != $($probe.kind)" }
    if (-not $c.sourceQuery) { $i += 'sourceQuery missing' }
    if (-not $c.suggestedAction.scriptPreview) { $i += 'suggestedAction.scriptPreview missing' }
    if ($r.tier -ne 'Tier 1B') { $i += "tier $($r.tier) != Tier 1B" }
    if ($r.telemetry.endpoint -ne '/api/explore-selection') { $i += 'telemetry endpoint' }
    $i
}
if ($explore) {
    Write-Host "  explore: '$($probe.text)' -> $($explore.slice.kind) · $($explore.slice.rowCount) rows · $($explore.modelId) · $($explore.tokenCount) tok · $($explore.latencyMs) ms · $($explore.dataPtr)" -ForegroundColor DarkGray
    $selPtr = [uri]::EscapeDataString($explore.dataPtr)
    $null = Invoke-Check -Name explore-ptr -Method GET -Path "/api/dataplane?ptr=$selPtr" -Schema {
        param($r)
        $i = @()
        if (@($r.rows).Count -ne @($explore.card.rows).Count) { $i += "pointer rows $(@($r.rows).Count) != card rows $(@($explore.card.rows).Count)" }
        if ($r.descriptor.selectedText -ne $probe.text) { $i += 'descriptor.selectedText mismatch' }
        if ($r.descriptor.aggregates.PSObject.Properties.Name -contains 'upn') { $i += 'descriptor aggregates upn' }
        $i
    }
}

# --- Live agency 2: unscripted ticket -> CUSTOM-<hash> ---------------------------------------
$samples = Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/tickets/samples" -TimeoutSec $TimeoutSec
$sample = $samples.samples | Where-Object id -eq 'avd-diego' | Select-Object -First 1
$triage = Invoke-Check -Name triage-custom -Method POST -Path '/api/tickets/triage-custom' -Body @{ title = $sample.title; body = $sample.body; customerName = $sample.customerName } -Schema {
    param($r)
    $i = @()
    if ($r.scenario.scenarioId -notmatch '^CUSTOM-[A-Z0-9]{4,12}$') { $i += "scenarioId $($r.scenario.scenarioId)" }
    if ($r.brief.scenarioId -ne $r.scenario.scenarioId) { $i += 'brief.scenarioId mismatch' }
    if ($r.extraction.baseScenarioId -ne 'INC-4092') { $i += "base $($r.extraction.baseScenarioId) != INC-4092" }
    if ($r.extraction.tenantId -ne 'tenant-contoso-01') { $i += "tenant $($r.extraction.tenantId)" }
    if (@($r.extraction.entities).Count -lt 4) { $i += "only $(@($r.extraction.entities).Count) entities extracted" }
    if (@($r.extraction.entities | Where-Object resolvedTo).Count -lt 3) { $i += 'fewer than 3 entities resolved live' }
    if (-not ($r.extraction.entities | Where-Object { $_.type -eq 'upn' -and $_.resolvedTo -like 'diego.siciliani*' })) { $i += 'Diego not resolved to a live UPN' }
    if (-not ($r.extraction.entities | Where-Object id -eq 'AADSTS53003')) { $i += 'AADSTS53003 not extracted' }
    if ($r.extraction.intents -notcontains 'nsg') { $i += 'nsg intent missing' }
    if ($r.extraction.components -notcontains 'IaCDriftBanner') { $i += 'IaCDriftBanner not selected' }
    if (@($r.dataPtrs).Count -lt 1) { $i += 'no ptr://custom pointers' }
    foreach ($p in $r.dataPtrs) { if ($p -notlike "ptr://$($r.scenario.scenarioId.ToLower())/*") { $i += "pointer $p" } }
    if (-not $r.verification.formal.passed) { $i += 'formal invariants failed' }
    if (-not $r.verification.idempotency.passed) { $i += 'idempotency failed' }
    if ($r.telemetry.tier -ne 'Tier 0' -or $r.telemetry.tokensUsed.total -ne 0) { $i += 'extraction not Tier 0 / 0 tokens' }
    $i
}
if ($triage) {
    $customId = $triage.scenario.scenarioId
    Write-Host "  triage: $customId · base $($triage.extraction.baseScenarioId) · $(@($triage.extraction.entities).Count) entities ($(@($triage.extraction.entities | Where-Object resolvedTo).Count) live) · intents $($triage.extraction.intents -join ',') · $($triage.latencyMs) ms" -ForegroundColor DarkGray
    $null = Invoke-Check -Name custom-brief -Method GET -Path "/api/scenarios/$customId/brief" -Schema {
        param($r)
        $i = @()
        if ($r.brief.kind -ne 'ticket') { $i += "kind $($r.brief.kind)" }
        if ($r.brief.title -ne $sample.title) { $i += 'title mismatch' }
        if (@($r.brief.steps).Count -lt 1) { $i += 'no steps' }
        foreach ($e in $r.brief.entities) { if ($triage.scenario.custom.components -notcontains $e.target) { $i += "entity $($e.id) targets $($e.target)" } }
        if ($null -eq $r.brief.extraction) { $i += 'brief.extraction missing' }
        $i
    }
    $null = Invoke-Check -Name custom-correlate -Method POST -Path '/api/correlate' -Body @{ scenarioId = $customId } -Schema {
        param($r)
        $i = Test-Layout $r.layout
        if ($r.layout.ticketId -ne $customId) { $i += "layout.ticketId $($r.layout.ticketId)" }
        $types = @($r.layout.components | ForEach-Object type)
        foreach ($t in $triage.scenario.custom.components) { if ($types -notcontains $t) { $i += "missing $t" } }
        foreach ($c in $r.layout.components) { foreach ($ptr in $c.dataPtrs.PSObject.Properties.Value) { if ($ptr -notlike "ptr://$($customId.ToLower())/*") { $i += "$($c.type) pointer $ptr" } } }
        $i
    }
    $null = Invoke-Check -Name custom-formal -Method GET -Path "/api/formal/$customId" -Schema {
        param($r)
        $i = @()
        if (-not $r.formal.passed) { $i += 'formal failed for custom ticket' }
        if ($r.baseScenarioId -ne 'INC-4092') { $i += "baseScenarioId $($r.baseScenarioId)" }
        $i
    }
    $null = Invoke-Check -Name custom-timeline -Method GET -Path "/api/timeline/$customId" -Schema {
        param($r)
        $i = @()
        if ($r.timeline.scenarioId -ne $customId) { $i += 'timeline not re-keyed to the custom ticket' }
        if (@($r.timeline.slices).Count -lt 4) { $i += 'fewer than 4 slices' }
        $i
    }
}

$null = Invoke-Check -Name reconcile-commercial -Method GET -Path "/api/reconcile/commercial/$ScenarioId" -Schema {
    param($r)
    $i = @()
    $x = $r.reconciliation
    if ($x.contractId -ne 'CNT-2026-884') { $i += "contract $($x.contractId)" }
    if ($x.pathA.netDeltaMonthly -ne 0) { $i += 'Path A not $0/mo' }
    if ($ScenarioId -eq 'INC-4092' -and $x.pathA.wasteEliminatedMonthly -ne 285) { $i += "waste $($x.pathA.wasteEliminatedMonthly) != 285" }
    if ($x.pathB.netDeltaMonthly -ne 171) { $i += "Path B $($x.pathB.netDeltaMonthly) != +171" }
    $i
}

$null = Invoke-Check -Name iac-reverse-compile -Method POST -Path '/api/iac/reverse-compile' -Body @{ scenarioId = $ScenarioId } -Schema {
    param($r)
    $i = @()
    if (@($r.result.imports).Count -lt 1) { $i += 'no import {} blocks' }
    elseif ($r.result.imports[0] -notmatch 'import \{') { $i += 'first import malformed' }
    if (-not $r.result.hcl) { $i += 'no HCL main.tf' }
    $i
}

$null = Invoke-Check -Name fleet-immunize -Method GET -Path "/api/fleet/immunize/$ScenarioId" -Schema {
    param($r)
    $i = @()
    if (-not $r.fleet.signature) { $i += 'no causal signature' }
    if (@($r.fleet.tenants).Count -ne 5) { $i += "fleet tenants $(@($r.fleet.tenants).Count) != 5" }
    if ($r.fleet.signature -match '@') { $i += 'signature leaks PII' }
    $i
}

$null = Invoke-Check -Name fleet-campaign -Method POST -Path "/api/fleet/campaign/$ScenarioId" -Body @{} -Schema {
    param($r)
    $i = @()
    if (-not $r.campaign.verified) { $i += 'campaign not formal-verified' }
    if (@($r.campaign.branches).Count -lt 1) { $i += 'no fleet branches staged' }
    $i
}

$null = Invoke-Check -Name runbook -Method GET -Path "/api/runbooks/$ScenarioId.md" -Schema {
    param($r)
    $i = @()
    if ($r -isnot [string]) { $i += 'runbook is not markdown text' }
    elseif ($r -notmatch 'Executive Root-Cause' -or $r -notmatch 'Inverse Rollback') { $i += 'runbook sections missing' }
    $i
}

$deadmanRem = Invoke-Check -Name remediate-deadman -Method POST -Path '/api/remediate' -Body @{ scenarioId = $ScenarioId } -Schema {
    param($r)
    $i = @()
    if (-not $r.drawer.remediationId) { $i += 'no remediation for dead-man test' }
    $i
}
if ($deadmanRem) {
    $null = Invoke-Check -Name approve-deadman -Method POST -Path '/api/remediate/approve' -Body @{ remediationId = $deadmanRem.drawer.remediationId; mode = $Mode; simulateCanaryFailure = $true } -Schema {
        param($r)
        $i = @()
        if ($r.canary.finalState -ne 'AUTO_ROLLED_BACK') { $i += "canary $($r.canary.finalState) != AUTO_ROLLED_BACK" }
        if ($r.convergence) { $i += 'dead-man rollback must not converge canvas' }
        $stages = @($r.canary.stages.stage)
        if ($stages -notcontains 'SYNTHETIC_PROBED') { $i += 'no SYNTHETIC_PROBED stage' }
        if ($stages[-1] -ne 'AUTO_ROLLED_BACK') { $i += 'last stage not AUTO_ROLLED_BACK' }
        $i
    }
    $null = Invoke-Check -Name reset-after-deadman -Method POST -Path '/api/lab/reset-drift' -Body @{ scenarioId = $ScenarioId } -Schema {
        param($r)
        $i = @()
        if (-not $r.ok) { $i += 'reset after dead-man failed' }
        $i
    }
}

$null = Invoke-Check -Name intune-health-script -Method GET -Path '/api/intune/health-script/INC-4099' -Schema {
    param($r)
    $i = @()
    if (-not $r.verification.passed) { $i += 'proactive remediation proof failed' }
    if (-not $r.verification.detectReadOnly) { $i += 'Detect.ps1 not read-only' }
    if ($r.detect -match 'Set-\w+|Remove-\w+') { $i += 'Detect.ps1 contains mutating verb' }
    if (-not ($r.csp | Where-Object cspUri -match 'BitLocker')) { $i += 'no BitLocker CSP URI' }
    if (-not ($r.csp | Where-Object tattooedOnUnassign -eq $true)) { $i += 'no tattooed-on-unassign setting' }
    $i
}

$null = Invoke-Check -Name formal-asr-blast -Method GET -Path '/api/formal/ANOM-INT-309' -Schema {
    param($r)
    $i = @()
    if ($r.asrBlast.executions -ne 14) { $i += "ASR executions $($r.asrBlast.executions) != 14" }
    if ($r.asrBlast.workstations -ne 4) { $i += 'ASR workstations != 4' }
    if (-not $r.asrBlast.exclusionStaged) { $i += 'ASR exclusion not staged' }
    $i
}

$null = Invoke-Check -Name app401-brief -Method GET -Path '/api/scenarios/ANOM-APP-401/brief' -Schema {
    param($r)
    $i = @()
    if (-not $r.brief) { return @('APP-401 brief missing') }
    if (@($r.brief.entities).Count -lt 3) { $i += 'APP-401 entities missing' }
    # Micro-polish: every sentence and step ends on a full word and a period (no "…'github-actions" / "Sites.Selected per").
    if (-not $r.brief.summary.EndsWith('.')) { $i += "summary ends mid-phrase: '...$($r.brief.summary.Substring([Math]::Max(0, $r.brief.summary.Length - 30)))'" }
    if ($r.brief.summary -match "github-actions$") { $i += 'summary cut at github-actions' }
    if ($r.brief.summary -notmatch "github-actions-erp-sync' expired") { $i += 'summary lost the expired-secret sentence' }
    foreach ($s in $r.brief.steps) { if (-not $s.detail.EndsWith('.')) { $i += "step '$($s.title)' ends mid-word: '...$($s.detail.Substring([Math]::Max(0, $s.detail.Length - 25)))'" } }
    if ($r.brief.steps.Count -lt 2 -or $r.brief.steps[1].detail -notmatch 'Sites\.Selected per 90-day activity\.') { $i += 'step 2 does not end on "Sites.Selected per 90-day activity."' }
    if ($r.brief.originKind -ne 'anomaly' -or $r.brief.displayId -ne '#ANOM-APP-401') { $i += "originKind/displayId $($r.brief.originKind)/$($r.brief.displayId)" }
    $i
}

$null = Invoke-Check -Name app401-correlate -Method POST -Path '/api/correlate' -Body @{ scenarioId = 'ANOM-APP-401' } -Schema {
    param($r)
    $i = Test-Layout $r.layout
    $types = @($r.layout.components | ForEach-Object type)
    if ($types -notcontains 'EntraSignInTimeline') { $i += 'APP-401 missing EntraSignInTimeline' }
    if ($types.Count -ne 1) { $i += "APP-401 must render 1 existing card, got $($types.Count)" }
    # Micro-polish: distinct, realistic sign-in / audit timestamps instead of 7 x 02:15:00Z.
    $events = @(($r.layout.components | Where-Object type -eq 'EntraSignInTimeline').props.events)
    if ($events.Count -lt 5) { $i += "APP-401 history has only $($events.Count) rows" }
    $stamps = @($events | ForEach-Object timestamp | Sort-Object -Unique)
    if ($stamps.Count -ne $events.Count) { $i += "APP-401 timestamps not distinct ($($stamps.Count)/$($events.Count))" }
    # Invoke-RestMethod turns ISO-8601 strings into local DateTimes; compare on the UTC clock.
    $clock = @($events | ForEach-Object { ([datetime]$_.timestamp).ToUniversalTime().ToString('HH:mm:ss') })
    foreach ($t in @('02:15:00', '02:10:14', '01:42:19', '18:05:00', '11:20:00')) { if ($clock -notcontains $t) { $i += "APP-401 history missing the ${t}Z row" } }
    if (-not ($events | Where-Object { $_.appDisplayName -match 'Directory\.ReadWrite\.All' })) { $i += 'Directory.ReadWrite.All scope audit row missing' }
    if (-not ($events | Where-Object { $_.displayName -eq 'Alex Wilber' -and $_.appDisplayName -match 'App Owner' })) { $i += 'Alex Wilber App Owner row missing' }
    if (-not ($events | Where-Object { $_.appDisplayName -match 'Mail\.ReadWrite' })) { $i += 'OAuth grant row missing' }
    $i
}

# --- Unified work queue & live ERP inbox ----------------------------------------------------------
$inbox = Invoke-Check -Name inbox -Method GET -Path '/api/tickets/inbox' -Schema {
    param($r)
    $i = @()
    if (-not $r.dir) { $i += 'inbox dir missing' }
    $seed = $r.items | Where-Object folder -eq '#2026323'
    if (-not $seed) { return @('seeded #2026323 not ingested (input/tickets/#2026323/ticketbody.json)') }
    if ($seed.scenarioId -ne 'ERP-2026323' -or $seed.displayId -ne '#2026323') { $i += "seed ids $($seed.scenarioId)/$($seed.displayId)" }
    $png = $seed.attachments | Where-Object fileName -eq 'attachment1.png'
    if (-not $png) { $i += 'attachment1.png not discovered' }
    elseif ($png.url -ne '/api/tickets/inbox-attachment/%232026323/attachment1.png' -or $png.mimeType -ne 'image/png') { $i += "attachment url/mime $($png.url) $($png.mimeType)" }
    $i
}
if ($inbox) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $row = [ordered]@{ Endpoint = 'GET /api/tickets/inbox-attachment/%232026323/attachment1.png'; Status = '-'; 'Latency(ms)' = 0; Tier = '-'; Provider = '-'; Model = '-'; Tokens = 0; Schema = '-'; Note = '' }
    try {
        $img = Invoke-WebRequest -Method GET -Uri "$BaseUrl/api/tickets/inbox-attachment/%232026323/attachment1.png" -TimeoutSec $TimeoutSec
        $sw.Stop(); $row.Status = 'OK'; $row.'Latency(ms)' = $sw.ElapsedMilliseconds
        $bytes = [byte[]]$img.Content
        $issues = @()
        if ($img.Headers['Content-Type'] -notlike 'image/png*') { $issues += "content-type $($img.Headers['Content-Type'])" }
        if ($bytes.Length -lt 100 -or $bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50 -or $bytes[2] -ne 0x4E -or $bytes[3] -ne 0x47) { $issues += 'not a PNG' }
        if ($issues.Count -eq 0) { $row.Schema = 'PASS' } else { $row.Schema = 'FAIL'; $row.Note = ($issues -join '; ') }
    } catch { $sw.Stop(); $row.Status = 'ERROR'; $row.Schema = 'FAIL'; $row.Note = $_.Exception.Message }
    $results.Add([pscustomobject]$row)
}

$dropDir = $null
$drop = Invoke-Check -Name simulate-drop -Method POST -Path '/api/tickets/simulate-drop' -Body @{ archetype = 'AVD' } -Schema {
    param($r)
    $i = @()
    if ($r.folder -notmatch '^#2026\d{3}$') { $i += "folder $($r.folder)" }
    if ($r.scenarioId -ne "ERP-$($r.folder.TrimStart('#'))") { $i += "scenarioId $($r.scenarioId)" }
    if ($r.displayId -ne $r.folder) { $i += "displayId $($r.displayId)" }
    if (@($r.files) -notcontains 'ticketbody.json' -or @($r.files) -notcontains 'attachment1.png') { $i += "files $($r.files -join ',')" }
    if (-not (Test-Path (Join-Path $r.dir 'ticketbody.json')) -or -not (Test-Path (Join-Path $r.dir 'attachment1.png'))) { $i += "drop not on disk at $($r.dir)" }
    if ($r.scenario.origin -ne 'erp-drop' -or $r.scenario.kind -ne 'ticket') { $i += "scenario origin/kind $($r.scenario.origin)/$($r.scenario.kind)" }
    if ($r.extraction.baseScenarioId -ne 'INC-4092') { $i += "AVD drop base $($r.extraction.baseScenarioId) != INC-4092" }
    if (-not ($r.extraction.entities | Where-Object id -eq 'AADSTS53003')) { $i += 'AADSTS53003 not extracted from the drop' }
    if (-not ($r.extraction.entities | Where-Object { $_.type -eq 'upn' -and $_.resolvedTo })) { $i += 'requester not resolved to a live UPN' }
    if ($r.brief.originKind -ne 'erp-drop' -or $r.brief.status -ne 'New' -or $r.brief.displayId -ne $r.folder) { $i += "brief originKind/status/displayId $($r.brief.originKind)/$($r.brief.status)/$($r.brief.displayId)" }
    if (@($r.brief.attachments).Count -ne 1 -or $r.brief.attachments[0].fileName -ne 'attachment1.png') { $i += 'brief attachment missing' }
    if (-not $r.brief.requester.upn) { $i += 'brief requester missing' }
    if (-not ($r.brief.timeline | Where-Object actor -eq 'ERP inbox watcher')) { $i += 'ingest timeline entry missing' }
    $i
}
if ($drop) {
    $dropDir = $drop.dir
    $dropId = $drop.scenarioId
    Write-Host "  drop: $($drop.folder) -> $dropId ($($drop.archetype)) · $(@($drop.extraction.entities).Count) entities · $($drop.latencyMs) ms · $dropDir" -ForegroundColor DarkGray
    $null = Invoke-Check -Name erp-correlate -Method POST -Path '/api/correlate' -Body @{ scenarioId = $dropId } -Schema {
        param($r)
        $i = Test-Layout $r.layout
        if ($r.layout.ticketId -ne $dropId) { $i += "layout.ticketId $($r.layout.ticketId)" }
        foreach ($c in $r.layout.components) { foreach ($ptr in $c.dataPtrs.PSObject.Properties.Value) { if ($ptr -notlike "ptr://$($dropId.ToLower())/*") { $i += "$($c.type) pointer $ptr" } } }
        $i
    }
    $null = Invoke-Check -Name vision-triage -Method POST -Path '/api/vision/triage' -Body @{ scenarioId = $dropId } -BudgetMs 30000 -Schema {
        param($r)
        $i = @()
        if ($r.source -notin @('muse-vision', 'deterministic')) { $i += "source $($r.source)" }
        if ($r.attachment.fileName -ne 'attachment1.png') { $i += "attachment $($r.attachment.fileName)" }
        if ($r.extraction.errorCode -ne 'AADSTS53003') { $i += "errorCode $($r.extraction.errorCode) (source $($r.source))" }
        # The 36-char correlation id in the pixel font is the one value the live vision read gets wrong now and then; the fallback always has it.
        if ($r.source -eq 'deterministic' -and -not $r.extraction.correlationId) { $i += 'correlationId empty' }
        if (-not $r.match.eventId) { $i += 'no sign-in matched' }
        if ($r.source -eq 'muse-vision' -and $r.telemetry.tier -ne 'Vision') { $i += 'tier != Vision' }
        if ($r.source -eq 'deterministic' -and $r.telemetry.tokensUsed.total -ne 0) { $i += 'fallback used tokens' }
        $i
    }
    # Clean up the generated drop; the watcher must drop it from the queue on its next scan.
    Remove-Item -Recurse -Force $dropDir
    $null = Invoke-Check -Name inbox-after-cleanup -Method GET -Path '/api/tickets/inbox?scan=1' -Schema {
        param($r)
        $i = @()
        if ($r.items | Where-Object scenarioId -eq $dropId) { $i += "$dropId still in the inbox after its folder was removed" }
        if (-not ($r.items | Where-Object scenarioId -eq 'ERP-2026323')) { $i += 'seeded ERP-2026323 vanished' }
        $i
    }
}

$null = Invoke-Check -Name app401-formal -Method GET -Path '/api/formal/ANOM-APP-401' -Schema {
    param($r)
    $i = @()
    if (@($r.formal.invariants).Count -ne 4) { $i += "APP-401 invariants $(@($r.formal.invariants).Count) != 4" }
    $shadow = $r.formal.invariants | Where-Object id -eq 'shadow-admin-zero-transitive'
    if (-not $shadow -or -not $shadow.passed) { $i += 'Shadow-Admin invariant not proved' }
    $i
}

$null = Invoke-Check -Name app401-remediate -Method POST -Path '/api/remediate' -Body @{ scenarioId = 'ANOM-APP-401' } -Schema {
    param($r)
    $i = @()
    if ($r.drawer.terraformDiff -notmatch 'azuread_application_federated_identity_credential') { $i += 'no OIDC federated credential in Terraform' }
    if ($r.drawer.powershellScript -notmatch 'User\.Read\.All') { $i += 'least-privilege right-sizing missing' }
    if ($r.drawer.verificationStatus.verdict -eq 'Verification Failed') { $i += 'APP-401 verification failed' }
    $i
}

$null = Invoke-Check -Name rollback -Method POST -Path '/api/rollback' -Body @{ scenarioId = $ScenarioId } -Schema {
    param($r)
    $i = @()
    if (-not $r.ok) { $i += 'rollback not ok' }
    if ($r.latencyMs -ge 1000) { $i += "rollback $($r.latencyMs)ms >= 1s" }
    if (-not $r.rollback.powershellScript) { $i += 'rollback script missing' }
    $i
}

$null = Invoke-Check -Name stats -Method GET -Path '/api/telemetry/stats' -Schema {
    param($r)
    $i = @()
    if ($r.totalRequests -lt 5) { $i += "only $($r.totalRequests) requests recorded" }
    if ($r.zeroTokenRequests -lt 1) { $i += 'no zero-token requests recorded' }
    $i
}

Write-Host ''
# Long pointer URLs would push Schema / Note off the right edge; keep every column on screen.
$results | Select-Object @{ n = 'Endpoint'; e = { if ($_.Endpoint.Length -gt 72) { $_.Endpoint.Substring(0, 69) + '...' } else { $_.Endpoint } } }, Status, 'Latency(ms)', Tier, Provider, Model, Tokens, Schema, Note |
    Format-Table -AutoSize -Wrap | Out-String -Width 240 | Write-Host

$failed = @($results | Where-Object { $_.Status -ne 'OK' -or $_.Schema -ne 'PASS' })
if ($failed.Count -eq 0) {
    Write-Host "All $($results.Count) checks passed." -ForegroundColor Green
    exit 0
}
foreach ($f in $failed) { Write-Host "  FAIL  $($f.Endpoint)  ->  $($f.Note)" -ForegroundColor Red }
Write-Host "$($failed.Count) of $($results.Count) checks failed." -ForegroundColor Red
exit 1
