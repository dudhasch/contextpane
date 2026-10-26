#Requires -Version 7.0
<#
.SYNOPSIS
    Installs every Az and Microsoft.Graph submodule ContextPane needs, fast, using ModuleFast by Justin Grote.

.DESCRIPTION
    ModuleFast (https://github.com/JustinGrote/ModuleFast) resolves the dependency graph in parallel and
    downloads straight from the PowerShell Gallery CDN, so the Microsoft.Graph submodules land in seconds
    rather than the minutes Install-Module needs. Modules go to the CurrentUser scope
    ($HOME\Documents\PowerShell\Modules on Windows) and nothing is written outside that folder.

    The bootstrap is the one-liner ModuleFast documents, Invoke-RestMethod <bootstrap url> | Invoke-Expression,
    tried against each -BootstrapUrl in order (bit.ly/modulefast resolves to the latest GitHub release of
    ModuleFast.ps1; aka.ms/modulefast is kept as a second candidate). The payload is only evaluated when it
    really defines Install-ModuleFast, so a redirect to an HTML page can never be executed.
    Pass -NoBootstrap to use an already-installed ModuleFast module instead.
    If ModuleFast cannot be loaded at all, the script falls back to Install-PSResource / Install-Module so the
    seed script still gets its dependencies, just slower.

    Required set (also consumed by Invoke-SeedContextPaneLab.ps1 and the live MCP servers):
      Az.Accounts, Az.Resources, Az.Network
      Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Groups,
      Microsoft.Graph.Identity.SignIns, Microsoft.Graph.DirectoryObjects, Microsoft.Graph.Applications

    Exit code 0 when every module is available afterwards, 1 otherwise.

.EXAMPLE
    pwsh -NoProfile -File ./scripts/Install-ContextPaneModules.ps1
.EXAMPLE
    pwsh ./scripts/Install-ContextPaneModules.ps1 -Verify      # only report, install nothing
.EXAMPLE
    pwsh ./scripts/Install-ContextPaneModules.ps1 -PassThru    # returns the Get-Module -ListAvailable table
#>
[CmdletBinding()]
param(
    [string[]]$Modules = @(
        'Az.Accounts', 'Az.Resources', 'Az.Network',
        'Microsoft.Graph.Authentication', 'Microsoft.Graph.Users', 'Microsoft.Graph.Groups',
        'Microsoft.Graph.Identity.SignIns', 'Microsoft.Graph.DirectoryObjects', 'Microsoft.Graph.Applications'
    ),
    # Where ModuleFast (and the fallback installers) put the modules. Defaults to the CurrentUser PSModulePath root.
    [string]$Destination = $(if ($IsWindows) { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PowerShell' 'Modules' } else { Join-Path $HOME '.local' 'share' 'powershell' 'Modules' }),
    # Report what is missing without installing anything.
    [switch]$Verify,
    # Use an already-installed ModuleFast instead of the web bootstrap.
    [switch]$NoBootstrap,
    # Bootstrap candidates, tried in order until one returns the ModuleFast script.
    [string[]]$BootstrapUrl = @('https://bit.ly/modulefast', 'https://aka.ms/modulefast'),
    # Re-resolve even when every module already exists (picks up newer Gallery versions).
    [switch]$Update,
    [switch]$PassThru
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Keep([string]$Message) { Write-Host "    [=] $Message" -ForegroundColor DarkGray }

function Get-InstalledModuleTable([string[]]$Names) {
    foreach ($n in $Names) {
        $found = Get-Module -ListAvailable -Name $n -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
        [pscustomobject]@{
            Module    = $n
            Installed = [bool]$found
            Version   = if ($found) { $found.Version.ToString() } else { '-' }
            Path      = if ($found) { Split-Path -Parent $found.ModuleBase } else { '-' }
        }
    }
}

# ---------------------------------------------------------------------------
# 1. What is already there
# ---------------------------------------------------------------------------
Write-Step "Checking $($Modules.Count) modules (scope: CurrentUser -> $Destination)"
$before = @(Get-InstalledModuleTable $Modules)
$missing = @($before | Where-Object { -not $_.Installed } | ForEach-Object Module)
foreach ($row in $before) {
    if ($row.Installed) { Write-Keep "$($row.Module) $($row.Version)" } else { Write-Host "    [ ] $($row.Module) missing" -ForegroundColor Yellow }
}

if ($Verify) {
    if ($PassThru) { $before }
    if ($missing.Count -gt 0) { Write-Host "`n$($missing.Count) module(s) missing. Run without -Verify to install." -ForegroundColor Yellow; exit 1 }
    Write-Host "`nAll $($Modules.Count) modules available." -ForegroundColor Green
    exit 0
}

if ($missing.Count -eq 0 -and -not $Update) {
    Write-Host "`nAll $($Modules.Count) modules already available ($([int]$sw.Elapsed.TotalSeconds)s)." -ForegroundColor Green
    if ($PassThru) { $before }
    exit 0
}

$toInstall = if ($Update) { $Modules } else { $missing }

# ---------------------------------------------------------------------------
# 2. Make sure the CurrentUser module folder exists and is on PSModulePath
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
$sep = [IO.Path]::PathSeparator
if (($env:PSModulePath -split [regex]::Escape($sep)) -notcontains $Destination) {
    $env:PSModulePath = "$Destination$sep$env:PSModulePath"
}

# ---------------------------------------------------------------------------
# 3. ModuleFast (Justin Grote): parallel resolve + CDN download
# ---------------------------------------------------------------------------
$moduleFastReady = $false
try {
    if ($NoBootstrap) {
        Import-Module ModuleFast -ErrorAction Stop
    } else {
        $bootstrapped = $false
        foreach ($url in $BootstrapUrl) {
            Write-Step "Bootstrapping ModuleFast (Invoke-RestMethod '$url' | Invoke-Expression)"
            try {
                $payload = Invoke-RestMethod -Uri $url -MaximumRedirection 10 -TimeoutSec 60
                # The release asset is a bootstrap script (param block + Import-Module of the ModuleFast release); an HTML page is never evaluated.
                if ($payload -isnot [string] -or $payload -match '<html' -or $payload -notmatch 'Install-ModuleFast') {
                    Write-Warning "$url did not return the ModuleFast script (got $(if ($payload -is [string]) { "$($payload.Length) chars of non-PowerShell content" } else { $payload.GetType().Name })); trying the next bootstrap URL"
                    continue
                }
                $payload | Invoke-Expression
                $bootstrapped = $true
                break
            } catch {
                Write-Warning "$url failed: $($_.Exception.Message)"
            }
        }
        if (-not $bootstrapped) { throw "none of the bootstrap URLs returned ModuleFast ($($BootstrapUrl -join ', '))" }
    }
    if (Get-Command Install-ModuleFast -ErrorAction SilentlyContinue) {
        $moduleFastReady = $true
        $mfVersion = (Get-Command Install-ModuleFast).Module.Version
        Write-Ok "ModuleFast $mfVersion ready"
    }
} catch {
    Write-Warning "ModuleFast bootstrap failed: $($_.Exception.Message)"
}

if ($moduleFastReady) {
    Write-Step "Install-ModuleFast $($toInstall -join ', ')"
    try {
        # -Destination keeps everything under the CurrentUser scope; -NoProfileUpdate leaves $PROFILE alone;
        # -Update only matters when the caller asked to re-resolve already-installed modules.
        $mfParams = @{ Specification = $toInstall; Destination = $Destination; NoProfileUpdate = $true; Update = [bool]$Update }
        Install-ModuleFast @mfParams
        Write-Ok "ModuleFast finished in $([int]$sw.Elapsed.TotalSeconds)s"
    } catch {
        Write-Warning "Install-ModuleFast failed: $($_.Exception.Message)"
        $moduleFastReady = $false
    }
}

# ---------------------------------------------------------------------------
# 4. Fallback: Install-PSResource / Install-Module (slower, same result)
# ---------------------------------------------------------------------------
$stillMissing = @((Get-InstalledModuleTable $toInstall) | Where-Object { -not $_.Installed } | ForEach-Object Module)
if (-not $moduleFastReady -and $stillMissing.Count -gt 0) {
    Write-Step "Falling back to the built-in installer for $($stillMissing -join ', ')"
    foreach ($m in $stillMissing) {
        try {
            if (Get-Command Install-PSResource -ErrorAction SilentlyContinue) {
                Install-PSResource -Name $m -Scope CurrentUser -TrustRepository -ErrorAction Stop
            } else {
                Install-Module -Name $m -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
            }
            Write-Ok "$m installed"
        } catch {
            Write-Warning "$m failed: $($_.Exception.Message)"
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Verify via Get-Module -ListAvailable
# ---------------------------------------------------------------------------
Write-Step 'Verifying with Get-Module -ListAvailable'
$after = @(Get-InstalledModuleTable $Modules)
$after | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$failed = @($after | Where-Object { -not $_.Installed })
if ($PassThru) { $after }
if ($failed.Count -gt 0) {
    Write-Host "$($failed.Count) module(s) still missing: $($failed.Module -join ', ')  ($([int]$sw.Elapsed.TotalSeconds)s)" -ForegroundColor Red
    exit 1
}
Write-Host "All $($Modules.Count) modules available ($([int]$sw.Elapsed.TotalSeconds)s)." -ForegroundColor Green
exit 0
