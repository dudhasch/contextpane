#Requires -Version 7.0
<#
.SYNOPSIS
    Serves Meta's open-weight Muse Glimmer 30B (GGUF Q4_K_M, 16.8 GB) for Tier 1A / 1B and wires the orchestrator to it.

.DESCRIPTION
    -Target Modal (default): creates the contextpane-open-weights secret with a fresh bearer token, pulls the GGUF into
    a Modal Volume once, deploys modal-sandbox/glimmer_open_weights.py (llama-server on an L40S, scales to zero) and
    writes the endpoint + token into .env.local via Set-ContextPaneRouterConfig.ps1. Telemetry: "modal-open-weights".

    -Target Local: downloads the GGUF with `hf download` and starts llama-server (llama.cpp build b10353 or newer, on PATH
    or -LlamaServer) on 127.0.0.1:-Port, then points CTX_OPEN_WEIGHT_BASE_URL at it. Telemetry: "local-glimmer-30b".
    The 17 GB build needs ~17 GB of VRAM for full offload; lower -GpuLayers on smaller cards (much slower).

    Restart the orchestrator afterwards so it picks up the new endpoint.
.EXAMPLE
    pwsh ./scripts/Start-GlimmerOpenWeights.ps1
.EXAMPLE
    pwsh ./scripts/Start-GlimmerOpenWeights.ps1 -Target Local -GpuLayers 20
#>
[CmdletBinding()]
param(
    [ValidateSet('Modal', 'Local')][string]$Target = 'Modal',
    [string]$LlamaServer = 'llama-server',
    [string]$ModelDir = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'contextpane/models/Muse-Glimmer-30B-GGUF'),
    [int]$Port = 8080,
    [int]$GpuLayers = 99,
    [ValidateSet('low', 'medium', 'high', 'xhigh')][string]$ReasoningStrength = 'low',
    [int]$ReasoningBudget = 256
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$gguf = 'Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf'
$configure = Join-Path $PSScriptRoot 'Set-ContextPaneRouterConfig.ps1'

if ($Target -eq 'Modal') {
    $token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLower()
    uvx modal secret create --force contextpane-open-weights "CTX_OPEN_WEIGHT_API_KEY=$token" | Out-Null
    uvx modal run (Join-Path $repo 'modal-sandbox/glimmer_open_weights.py::download')
    $deploy = uvx modal deploy (Join-Path $repo 'modal-sandbox/glimmer_open_weights.py') 2>&1 | Out-String
    $url = [regex]::Match(($deploy -replace '\s+', ''), 'https://[\w.-]+--contextpane-glimmer-serve[\w.-]*\.modal\.run').Value
    if (-not $url) { throw "Could not find the serve URL in the deploy output:`n$deploy" }
    & $configure -ModalInferenceUrl "$url/v1" -OpenWeightApiKey $token
    Write-Host "Muse Glimmer 30B on Modal: $url/v1 (first request cold-starts the GPU container, ~1-3 min)"
    return
}

$versionText = & $LlamaServer --version 2>&1 | Out-String
# "version: 0.7.0-dev (build 11889, commit ...)" on current builds, "version: 6123 (...)" on older ones
$version = [regex]::Match($versionText, '\(build (\d+)')
if (-not $version.Success) { $version = [regex]::Match($versionText, 'version:\s*b?(\d+)\b(?!\.)') }
$build = $version.Success ? [int]$version.Groups[1].Value : 0
if ($build -lt 10353) { throw "llama-server build b$build predates Muse Glimmer support; install llama.cpp b10353 or newer." }
if (-not (Test-Path (Join-Path $ModelDir $gguf))) {
    uvx --from huggingface_hub hf download meta-models/Muse-Glimmer-30B-GGUF --include $gguf --local-dir $ModelDir
}
$serverArgs = @(
    '-m', (Join-Path $ModelDir $gguf), '-a', 'muse-glimmer-30b', '-ngl', $GpuLayers, '-np', 2, '-c', 32768, '--jinja',
    '--chat-template-kwargs', "{`"reasoning_strength`":`"$ReasoningStrength`"}", '--reasoning-budget', $ReasoningBudget,
    '--temp', '1.0', '--top-p', '0.95', '--top-k', '64', '--host', '127.0.0.1', '--port', $Port
)
$process = Start-Process -FilePath $LlamaServer -ArgumentList $serverArgs -PassThru -WindowStyle Minimized
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "llama-server exited with code $($process.ExitCode)" }
    try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2).status -eq 'ok') { break } } catch { Start-Sleep -Seconds 2 }
}
& $configure -OpenWeightBaseUrl "http://127.0.0.1:$Port/v1"
Write-Host "Muse Glimmer 30B on llama-server b$build (pid $($process.Id)): http://127.0.0.1:$Port/v1"
