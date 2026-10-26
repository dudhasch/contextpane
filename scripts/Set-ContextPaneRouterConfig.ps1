#Requires -Version 7.0
<#
.SYNOPSIS
    Configures the ContextPane 4-Tier Meta Model Router: provider keys, model ids, Modal sandbox and cloud mode.

.DESCRIPTION
    Writes <repo>/.env.local (git-ignored) and sets the same variables in the current session ($env:).
    Every parameter is optional; omitted values keep what is already in .env.local. With no keys at
    all the orchestrator runs every tier on the deterministic local engine, so the demo works offline.

    Primary stack (first-class with only a Meta key and the Modal sandbox):
      Meta Model API   https://api.meta.ai/v1   muse-spark-1.3 (1A, 1B, 2), muse-wonder-1.0 (3A; muse-code when served),
                                                muse-voice-transcribe-1.0
      Modal            Tier 3B pre-flight sandbox web endpoint; optional vLLM muse-glimmer-30b (open weights)
      RunPod           optional vLLM muse-glimmer-30b pod (scripts/Start-RunPodGlimmer.ps1)
    Optional drop-in overrides when their keys arrive:
      Baseten          https://inference.baseten.co/v1   meta-models/muse-spark-open-1026, muse-glimmer-30b
      Fireworks AI     https://api.fireworks.ai/inference/v1   accounts/fireworks/models/muse-glimmer-30b

.PARAMETER MetaApiKey
    Meta Model API key (Tier 1A/1B when no open-weight endpoint is set, Tier 2, Tier 3A, voice transcription).
.PARAMETER BasetenApiKey
    Optional Baseten API key (open-weight muse-spark-open-1026 for Tier 1B, ahead of Meta).
.PARAMETER FireworksApiKey
    Optional Fireworks AI key (Tier 1A hover, ahead of Baseten and Meta).
.PARAMETER ModalSandboxUrl
    URL of the deployed modal-sandbox validate_remediation endpoint (Tier 3B). Enables CTX_MODAL_SANDBOX_ENABLED=true.
.PARAMETER ModalSandboxToken
    Bearer token expected by the Modal endpoint.
.PARAMETER ModalInferenceUrl
    OpenAI-compatible base URL (ending in /v1) of modal-sandbox/open_weights_vllm.py. Sets MODAL_INFERENCE_BASE_URL.
.PARAMETER RunPodBaseUrl
    OpenAI-compatible base URL (ending in /v1) of a RunPod vLLM pod. Sets RUNPOD_VLLM_BASE_URL.
.PARAMETER OpenWeightBaseUrl
    Explicit CTX_OPEN_WEIGHT_BASE_URL; overrides the Modal and RunPod URLs for Tier 1A / 1B.
.PARAMETER OpenWeightApiKey
    Bearer token for the open-weight vLLM server (if it was started with --api-key).
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
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalSandboxUrl https://<workspace>--contextpane-sandbox-validate-remediation.modal.run -LiveCloudMode
.EXAMPLE
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -RunPodBaseUrl https://<pod-id>-8000.proxy.runpod.net/v1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$MetaApiKey,
    [string]$BasetenApiKey,
    [string]$FireworksApiKey,
    [string]$ModalSandboxUrl,
    [string]$ModalSandboxToken,
    [string]$ModalInferenceUrl,
    [string]$RunPodBaseUrl,
    [string]$OpenWeightBaseUrl,
    [string]$OpenWeightApiKey,
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
# MODEL_API_KEY is an accepted alias; fold it into META_API_KEY so there is one source of truth
if (-not $config['META_API_KEY'] -and $config['MODEL_API_KEY']) { $config['META_API_KEY'] = $config['MODEL_API_KEY'] }
$config.Remove('MODEL_API_KEY')

if ($Interactive) {
    foreach ($key in 'META_API_KEY', 'BASETEN_API_KEY', 'FIREWORKS_API_KEY') {
        if ($config[$key]) { continue }
        $secure = Read-Host -Prompt "$key (Enter to skip)" -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $secure).Password
        if ($plain) { $config[$key] = $plain }
    }
    foreach ($key in 'CTX_MODAL_SANDBOX_URL', 'MODAL_INFERENCE_BASE_URL', 'RUNPOD_VLLM_BASE_URL') {
        if ($config[$key]) { continue }
        $url = Read-Host -Prompt "$key (Enter to skip)"
        if ($url) { $config[$key] = $url }
    }
    if ($config['CTX_MODAL_SANDBOX_URL'] -and -not $config['CTX_MODAL_SANDBOX_TOKEN']) {
        $secure = Read-Host -Prompt 'CTX_MODAL_SANDBOX_TOKEN (Enter to skip)' -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $secure).Password
        if ($plain) { $config['CTX_MODAL_SANDBOX_TOKEN'] = $plain }
    }
}

if ($PSBoundParameters.ContainsKey('MetaApiKey'))        { $config['META_API_KEY'] = $MetaApiKey }
if ($PSBoundParameters.ContainsKey('BasetenApiKey'))     { $config['BASETEN_API_KEY'] = $BasetenApiKey }
if ($PSBoundParameters.ContainsKey('FireworksApiKey'))   { $config['FIREWORKS_API_KEY'] = $FireworksApiKey }
if ($PSBoundParameters.ContainsKey('ModalSandboxUrl'))   { $config['CTX_MODAL_SANDBOX_URL'] = $ModalSandboxUrl }
if ($PSBoundParameters.ContainsKey('ModalSandboxToken')) { $config['CTX_MODAL_SANDBOX_TOKEN'] = $ModalSandboxToken }
if ($PSBoundParameters.ContainsKey('ModalInferenceUrl')) { $config['MODAL_INFERENCE_BASE_URL'] = $ModalInferenceUrl }
if ($PSBoundParameters.ContainsKey('RunPodBaseUrl'))     { $config['RUNPOD_VLLM_BASE_URL'] = $RunPodBaseUrl }
if ($PSBoundParameters.ContainsKey('OpenWeightBaseUrl')) { $config['CTX_OPEN_WEIGHT_BASE_URL'] = $OpenWeightBaseUrl }
if ($PSBoundParameters.ContainsKey('OpenWeightApiKey'))  { $config['CTX_OPEN_WEIGHT_API_KEY'] = $OpenWeightApiKey }
if ($LiveCloudMode) { $config['LIVE_CLOUD_MODE'] = 'true' }
if ($OfflineMode)   { $config['LIVE_CLOUD_MODE'] = 'false' }
if ($ForceLocal)    { $config['CTX_FORCE_LOCAL'] = 'true' }
$config['CTX_MODAL_SANDBOX_ENABLED'] = if ($config['CTX_MODAL_SANDBOX_URL']) { 'true' } else { 'false' }

$openWeightUrl = @($config['CTX_OPEN_WEIGHT_BASE_URL'], $config['MODAL_INFERENCE_BASE_URL'], $config['RUNPOD_VLLM_BASE_URL']) | Where-Object { $_ } | Select-Object -First 1
$summary = [pscustomobject]@{
    'Meta Model API'  = "$($config['META_API_BASE_URL'])  key=$(Protect-Secret $config['META_API_KEY'])  hover=$($config['CTX_MODEL_META_HOVER']) catalog=$($config['CTX_MODEL_META_CATALOG']) spark=$($config['CTX_MODEL_META_SPARK']) wonder=$($config['CTX_MODEL_META_WONDER']) code=$($config['CTX_MODEL_META_CODE'])"
    'Modal sandbox'   = "enabled=$($config['CTX_MODAL_SANDBOX_ENABLED']) url=$($config['CTX_MODAL_SANDBOX_URL']) token=$(Protect-Secret $config['CTX_MODAL_SANDBOX_TOKEN'])"
    'Open weights'    = "$(if ($openWeightUrl) { $openWeightUrl } else { '(not set: Tier 1A/1B use the Meta API)' })  model=$($config['CTX_MODEL_OPEN_WEIGHT_GLIMMER'])  key=$(Protect-Secret $config['CTX_OPEN_WEIGHT_API_KEY'])"
    'Baseten'         = "$($config['BASETEN_BASE_URL'])  key=$(Protect-Secret $config['BASETEN_API_KEY'])  spark=$($config['CTX_MODEL_BASETEN_SPARK'])  (optional override)"
    'Fireworks'       = "$($config['FIREWORKS_BASE_URL'])  key=$(Protect-Secret $config['FIREWORKS_API_KEY'])  glimmer=$($config['CTX_MODEL_FIREWORKS_GLIMMER'])  (optional override)"
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

$keyed = @(@('META_API_KEY', 'BASETEN_API_KEY', 'FIREWORKS_API_KEY') | Where-Object { $config[$_] })
if ($openWeightUrl) { $keyed = @('open-weight vLLM') + $keyed }
if ($keyed.Count -eq 0) {
    Write-Host 'No provider keys set: every tier will use the deterministic local engine (offline-safe demo).' -ForegroundColor Yellow
} else {
    Write-Host "Providers with keys: $($keyed -join ', '). Restart the orchestrator to pick up changes." -ForegroundColor Green
}
