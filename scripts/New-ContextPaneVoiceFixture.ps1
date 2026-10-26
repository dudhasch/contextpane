#Requires -Version 7.0
<#
.SYNOPSIS
    Synthesizes a spoken voice-steer command with Windows' built-in speech engine and, optionally, sends it to /api/voice-steer.

.DESCRIPTION
    Writes a 16 kHz, 16-bit mono WAV (System.Speech.Synthesis.SpeechSynthesizer, an English voice when one is installed).
    With -WebM it also encodes an Opus/WebM copy with ffmpeg, the container Chrome's MediaRecorder produces, so the
    browser upload path can be exercised without a microphone. With -Send it posts each file to the orchestrator as
    { audioBase64, mimeType } and prints the transcript, intent and telemetry.

.EXAMPLE
    pwsh ./scripts/New-ContextPaneVoiceFixture.ps1 -WebM -Send
#>
[CmdletBinding()]
param(
    [string]$Text = 'Only show license drift and the sign-in timeline',
    [string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data/test-voice-command.wav'),
    [int]$SampleRate = 16000,
    [switch]$WebM,
    [switch]$Send,
    [string]$BaseUrl = $(if ($env:CTX_ORCHESTRATOR_URL) { $env:CTX_ORCHESTRATOR_URL } else { 'http://127.0.0.1:4000' })
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path)

$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $english = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
    if ($english) { $synth.SelectVoice($english.VoiceInfo.Name) }
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new($SampleRate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile($Path, $format)
    $synth.Speak($Text)
} finally {
    $synth.Dispose()
}
Write-Host "Wrote $Path ($((Get-Item $Path).Length) bytes, voice $($english.VoiceInfo.Name ?? 'default'))" -ForegroundColor Green

$files = @(@{ Path = $Path; MimeType = 'audio/wav' })
if ($WebM) {
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'ffmpeg not found (winget install Gyan.FFmpeg)' }
    $webmPath = [System.IO.Path]::ChangeExtension($Path, '.webm')
    & ffmpeg -hide_banner -loglevel error -y -i $Path -c:a libopus -b:a 32k $webmPath
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
    Write-Host "Wrote $webmPath ($((Get-Item $webmPath).Length) bytes, Opus/WebM like MediaRecorder)" -ForegroundColor Green
    $files += @{ Path = $webmPath; MimeType = 'audio/webm;codecs=opus' }
}

if ($Send) {
    foreach ($f in $files) {
        $body = @{ tenantId = 'tenant-contoso-01'; audioBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Path)); mimeType = $f.MimeType } | ConvertTo-Json -Compress
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-RestMethod -Method POST -Uri "$($BaseUrl.TrimEnd('/'))/api/voice-steer" -ContentType 'application/json' -Body $body -TimeoutSec 60
        [pscustomobject]@{
            File          = Split-Path -Leaf $f.Path
            MimeType      = $f.MimeType
            Ms            = $sw.ElapsedMilliseconds
            Transcript    = $r.transcript
            Transcription = if ($r.transcription) { "$($r.transcription.provider)/$($r.transcription.modelId) $($r.transcription.latencyMs) ms" } else { '(none)' }
            Intent        = "$($r.intent.intent) [$(@($r.intent.componentTypes) -join ', ')] via $($r.intentSource)"
            Telemetry     = "$($r.telemetry.tier) $($r.telemetry.provider) $($r.telemetry.modelId)"
        } | Format-List | Out-String | Write-Host
    }
}
