#Requires -Version 7.0
<#
.SYNOPSIS
    Configures the ContextPane 4-Tier Meta Model Router: provider keys, model ids, Modal sandbox and cloud mode.

.DESCRIPTION
    Writes <repo>/.env.local (git-ignored) and sets the same variables in the current session ($env:).
    Every parameter is optional; omitted values keep what is already in .env.local. With no keys at
    all the orchestrator runs every tier on the deterministic local engine, so the demo works offline.

    Providers configured:
      Meta Model API   https://api.meta.ai/v1            muse-spark-1.3, muse-wonder-1.0, muse-code, muse-glimmer-30b, muse-voice-transcribe
      Baseten          https://inference.baseten.co/v1   meta-models/muse-spark-open-1026, muse-glimmer-30b
      Fireworks AI     https://api.fireworks.ai/inference/v1   accounts/fireworks/models/muse-glimmer-30b
      Modal            optional pre-flight sandbox web endpoint

.PARAMETER MetaApiKey
    Meta Model API key (Tier 1A fallback, Tier 2, Tier 3A/3B, voice transcription).
.PARAMETER BasetenApiKey
    Baseten API key (Tier 1B/2 primary, open-weight muse-spark-open-1026).
.PARAMETER FireworksApiKey
    Fireworks AI key (Tier 1A primary).
.PARAMETER ModalSandboxUrl
    URL of the deployed modal-sandbox web endpoint. Enables CTX_MODAL_SANDBOX_ENABLED=true.
.PARAMETER ModalSandboxToken
    Bearer token expected by the Modal endpoint.
.PARAMETER LiveCloudMode
    Switch mcp-msgraph / mcp-azure-iac to live PowerShell queries (needs Connect-MgGraph + Connect-AzAccount).
.PARAMETER OfflineMode
    Force LIVE_CLOUD_MODE=false.
.PARAMETER ForceLocal
    Pin every tier to the deterministic engine even when keys exist (demo safety switch).
.PARAMETER Interactive
    Prompt for any key that is still empty (masked input).
.PARAMETER Show
    Print the effective configuration (keys masked) and exit without writing.

.EXAMPLE
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -Interactive
.EXAMPLE
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -BasetenApiKey $env:BASETEN_API_KEY -LiveCloudMode
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$MetaApiKey,
    [string]$BasetenApiKey,
    [string]$FireworksApiKey,
    [string]$ModalSandboxUrl,
    [string]$ModalSandboxToken,
    [switch]$LiveCloudMode,
    [switch]$OfflineMode,
    [switch]$ForceLocal,
    [switch]$Interactive,
    [switch]$Show,
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $repoRoot '.env.local' }
$examplePath = Join-Path $repoRoot '.env.example'

function Read-EnvFile([string]$Path) {
    $map = [ordered]@{}
    if (-not (Test-Path $Path)) { return $map }
    foreach ($line in Get-Content $Path) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -le 0) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
        $map[$k] = $v
    }
    return $map
}

function Protect-Secret([string]$Value) {
    if (-not $Value) { return '(not set)' }
    if ($Value.Length -le 8) { return '****' }
    return $Value.Substring(0, 4) + ('*' * 8) + $Value.Substring($Value.Length - 4)
}

# Defaults come from .env.example, overridden by the existing .env.local
$config = Read-EnvFile $examplePath
foreach ($kv in (Read-EnvFile $EnvFile).GetEnumerator()) { $config[$kv.Key] = $kv.Value }

if ($Interactive) {
    foreach ($key in 'META_API_KEY', 'BASETEN_API_KEY', 'FIREWORKS_API_KEY') {
        if ($config[$key]) { continue }
        $secure = Read-Host -Prompt "$key (Enter to skip)" -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $secure).Password
        if ($plain) { $config[$key] = $plain }
    }
    if (-not $config['CTX_MODAL_SANDBOX_URL']) {
        $url = Read-Host -Prompt 'CTX_MODAL_SANDBOX_URL (Enter to skip)'
        if ($url) { $config['CTX_MODAL_SANDBOX_URL'] = $url }
    }
}

if ($PSBoundParameters.ContainsKey('MetaApiKey'))        { $config['META_API_KEY'] = $MetaApiKey }
if ($PSBoundParameters.ContainsKey('BasetenApiKey'))     { $config['BASETEN_API_KEY'] = $BasetenApiKey }
if ($PSBoundParameters.ContainsKey('FireworksApiKey'))   { $config['FIREWORKS_API_KEY'] = $FireworksApiKey }
if ($PSBoundParameters.ContainsKey('ModalSandboxUrl'))   { $config['CTX_MODAL_SANDBOX_URL'] = $ModalSandboxUrl }
if ($PSBoundParameters.ContainsKey('ModalSandboxToken')) { $config['CTX_MODAL_SANDBOX_TOKEN'] = $ModalSandboxToken }
if ($LiveCloudMode) { $config['LIVE_CLOUD_MODE'] = 'true' }
if ($OfflineMode)   { $config['LIVE_CLOUD_MODE'] = 'false' }
if ($ForceLocal)    { $config['CTX_FORCE_LOCAL'] = 'true' }
$config['CTX_MODAL_SANDBOX_ENABLED'] = if ($config['CTX_MODAL_SANDBOX_URL']) { 'true' } else { 'false' }

$summary = [pscustomobject]@{
    'Meta Model API'  = "$($config['META_API_BASE_URL'])  key=$(Protect-Secret $config['META_API_KEY'])  spark=$($config['CTX_MODEL_META_SPARK']) wonder=$($config['CTX_MODEL_META_WONDER']) code=$($config['CTX_MODEL_META_CODE'])"
    'Baseten'         = "$($config['BASETEN_BASE_URL'])  key=$(Protect-Secret $config['BASETEN_API_KEY'])  spark=$($config['CTX_MODEL_BASETEN_SPARK'])"
    'Fireworks'       = "$($config['FIREWORKS_BASE_URL'])  key=$(Protect-Secret $config['FIREWORKS_API_KEY'])  glimmer=$($config['CTX_MODEL_FIREWORKS_GLIMMER'])"
    'Modal sandbox'   = "enabled=$($config['CTX_MODAL_SANDBOX_ENABLED']) url=$($config['CTX_MODAL_SANDBOX_URL']) token=$(Protect-Secret $config['CTX_MODAL_SANDBOX_TOKEN'])"
    'LIVE_CLOUD_MODE' = $config['LIVE_CLOUD_MODE']
    'CTX_FORCE_LOCAL' = $config['CTX_FORCE_LOCAL']
    'Lab tenant'      = "$($config['CTX_LAB_TENANT_ID']) / $($config['CTX_LAB_DOMAIN']) / sub $($config['CTX_LAB_SUBSCRIPTION_ID'])"
}

Write-Host "`nContextPane router configuration" -ForegroundColor Cyan
$summary | Format-List | Out-String | Write-Host

if ($Show) { return }

$lines = @('# ContextPane local configuration - generated by scripts/Set-ContextPaneRouterConfig.ps1', "# $(Get-Date -Format o)", '')
foreach ($kv in $config.GetEnumerator()) { $lines += "$($kv.Key)=$($kv.Value)" }

if ($PSCmdlet.ShouldProcess($EnvFile, 'Write router configuration')) {
    Set-Content -Path $EnvFile -Value ($lines -join "`n") -Encoding utf8NoBOM
    Write-Host "Wrote $EnvFile" -ForegroundColor Green
}

foreach ($kv in $config.GetEnumerator()) {
    if ($PSCmdlet.ShouldProcess("`$env:$($kv.Key)", 'Set for this session')) {
        Set-Item -Path "Env:$($kv.Key)" -Value $kv.Value
    }
}

$keyed = @('META_API_KEY', 'BASETEN_API_KEY', 'FIREWORKS_API_KEY') | Where-Object { $config[$_] }
if ($keyed.Count -eq 0) {
    Write-Host 'No provider keys set: every tier will use the deterministic local engine (offline-safe demo).' -ForegroundColor Yellow
} else {
    Write-Host "Providers with keys: $($keyed -join ', '). Restart the orchestrator to pick up changes." -ForegroundColor Green
}
