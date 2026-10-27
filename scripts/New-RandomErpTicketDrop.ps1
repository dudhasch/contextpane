#Requires -Version 7.0
<#
.SYNOPSIS
    Drops a realistic, randomised ERP ticket folder into <root>/input/tickets/#<id>/ for the live inbox watcher.

.DESCRIPTION
    Writes <root>/input/tickets/#<7-digit id>/ticketbody.json plus ./attachment1.png, exactly the contract
    the orchestrator's ERP inbox watcher (apps/orchestrator/src/local/erp-inbox.ts) ingests within ~1 s:
    the ticket becomes the ERP-<id> work item (display id #<id>) in the unified queue, triaged against the
    live-seeded c4a8shili.onmicrosoft.com / rg-contoso-avd-prod state.

    The body mixes the tenant's own people (lynne.robins, diego.siciliani, patti.fernandez, alex.wilber,
    spn-contoso-erp-sync), error codes (AADSTS53003, 0x87D1FDE8, AADSTS7000222, CountViolation) and
    infrastructure targets (vdpool-contoso-fin-01, nsg-contoso-avd-hostpool-01, Intune-Win11-ASR-Baseline,
    CA-001). The PNG is a 640x400 "customer screenshot" of the matching error dialog, drawn with
    System.Drawing where available; otherwise a minimal valid PNG. Either way it carries tEXt chunks
    (ErrorCode, CorrelationId, Timestamp, Device, User) that the deterministic vision fallback reads.

    This script uses alternate field names (ticketId / title / body / customer / requester / priority /
    createdAt) on purpose: the watcher accepts both this and the id / subject / description shape.

.PARAMETER TicketId
    "#2026323" or "2026323". Random #2026xxx when omitted.
.PARAMETER Archetype
    Random (default), AVD, Intune, CA, WorkloadIdentity, Licensing or Mixed.
.PARAMETER InboxDir
    Defaults to <repo>/input/tickets (CTX_INBOX_DIR when set).
.PARAMETER Force
    Overwrite an existing folder of the same id.

.EXAMPLE
    pwsh ./scripts/New-RandomErpTicketDrop.ps1
.EXAMPLE
    pwsh ./scripts/New-RandomErpTicketDrop.ps1 -TicketId "#2026323" -Archetype AVD -Force
#>
[CmdletBinding()]
param(
    [string]$TicketId,
    [ValidateSet('Random', 'AVD', 'Intune', 'CA', 'WorkloadIdentity', 'Licensing', 'Mixed')]
    [string]$Archetype = 'Random',
    [string]$InboxDir = $(if ($env:CTX_INBOX_DIR) { $env:CTX_INBOX_DIR } else { Join-Path $PSScriptRoot '..' 'input' 'tickets' }),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ($TicketId -and ($TicketId -match '^#?(INC-2026-)?88[45]\d{2}$' -or $TicketId -match '^#?202688[45]\d{2}$')) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $inboxResolved = [System.IO.Path]::GetFullPath($InboxDir)
    $js = @"
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { generateLabTicketDrop } from './apps/orchestrator/src/local/erp-drop-generator.ts';
const drop = generateLabTicketDrop(process.env.CTX_DROP_ID!);
const dir = join(process.env.CTX_DROP_INBOX!, drop.folder);
if (existsSync(dir) && process.env.CTX_DROP_FORCE !== '1') {
  console.error(dir + ' exists; pass -Force to overwrite');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'attachment1.png'), drop.png);
const tmp = join(dir, '.ticketbody.json.tmp');
writeFileSync(tmp, JSON.stringify(drop.body, null, 2) + '\n', 'utf8');
renameSync(tmp, join(dir, 'ticketbody.json'));
console.log(JSON.stringify({ Folder: drop.folder, ScenarioId: 'ERP-' + drop.folder.slice(1), Archetype: drop.archetype, Dir: dir, ErrorCode: drop.body.telemetry.errorCode }));
"@
    $env:CTX_DROP_ID = $TicketId
    $env:CTX_DROP_INBOX = $inboxResolved
    $env:CTX_DROP_FORCE = if ($Force) { '1' } else { '0' }
    Push-Location $repoRoot
    try {
        $jsonOut = & bun -e $js
        if ($LASTEXITCODE -ne 0) { throw "Failed to drop lab ticket $TicketId" }
        $parsed = $jsonOut | Select-Object -Last 1 | ConvertFrom-Json
        Write-Host "Dropped $($parsed.Folder) ($($parsed.Archetype)) -> $($parsed.Dir)" -ForegroundColor Green
        return [pscustomobject]$parsed
    } finally {
        Pop-Location
        Remove-Item Env:CTX_DROP_ID, Env:CTX_DROP_INBOX, Env:CTX_DROP_FORCE -ErrorAction SilentlyContinue
    }
}
$rng = [System.Random]::new()
$domain = 'c4a8shili.onmicrosoft.com'
$people = @(
    @{ displayName = 'Lynne Robins';    upn = "lynne.robins.contoso@$domain";    role = 'Finance Analyst';             device = 'CONTOSO-LT-0471' }
    @{ displayName = 'Diego Siciliani'; upn = "diego.siciliani.contoso@$domain"; role = 'Finance Controller';          device = 'CONTOSO-LT-0488' }
    @{ displayName = 'Patti Fernandez'; upn = "patti.fernandez.contoso@$domain"; role = 'Accounts Payable';            device = 'CONTOSO-FIN-014' }
    @{ displayName = 'Alex Wilber';     upn = "alex.wilber.contoso@$domain";     role = 'Contractor · ERP Integration'; device = 'CONTOSO-FIN-021' }
)
if ($Archetype -eq 'Random') { $Archetype = @('AVD', 'Intune', 'CA', 'WorkloadIdentity', 'Licensing', 'Mixed')[$rng.Next(6)] }
$who = if ($Archetype -eq 'WorkloadIdentity') { $people[3] } else { $people[$rng.Next(3)] }
$other = $people | Where-Object { $_.upn -ne $who.upn } | Get-Random
$digits = if ($TicketId) { ($TicketId -replace '^#', '') -replace '[^0-9A-Za-z]', '' } else { '2026{0:d3}' -f $rng.Next(1000) }
$displayId = "#$digits"
$at = (Get-Date).ToUniversalTime().AddMinutes(-(20 + $rng.Next(300)))
$stamp = $at.ToString('yyyy-MM-ddTHH:mm:ssZ')
$when = "$($at.ToString('HH:mm')) UTC today"
$corr = [guid]::NewGuid().ToString()

switch ($Archetype) {
    'AVD' {
        $code = 'AADSTS53003'; $priority = 'P1'
        $title = "$($who.displayName) cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on the host pool"
        $body = "$($who.displayName) ($($who.role)) gets a Conditional Access block when opening the Windows App against vdpool-contoso-fin-01 since $when; the dialog shows AADSTS53003 with correlation id $corr. The user was moved to the Microsoft 365 E5 bundle last week but still appears on E3. While checking nsg-contoso-avd-hostpool-01 a vendor rule allowing RDP 3389 from the internet is visible in the portal and is not in our Terraform."
        $dialog = 'WINDOWS APP - SIGN-IN ERROR'; $app = 'Azure Virtual Desktop'
        $lines = @('Your sign-in was blocked by Conditional Access (AADSTS53003)', "User: $($who.upn)", 'App: Azure Virtual Desktop client', 'Host pool: vdpool-contoso-fin-01')
    }
    'Intune' {
        $code = '0x87D1FDE8'; $priority = 'P2'
        $title = "$($who.device) shows Not compliant after the ASR baseline update (0x87D1FDE8)"
        $body = "$($who.displayName)'s laptop $($who.device) reports 'Not compliant' in the Company Portal since $when. Intune shows error 0x87D1FDE8 on Intune-Win11-ASR-Baseline and a conflict with the firewall profile; the device check-in succeeded but the ASR rule stays in Audit. $($other.displayName) on $($other.device) sees the same banner."
        $dialog = 'COMPANY PORTAL - DEVICE STATUS'; $app = 'Intune Company Portal'
        $lines = @('This device is not compliant', 'Error 0x87D1FDE8', "Device: $($who.device)", 'Policy: Intune-Win11-ASR-Baseline')
    }
    'CA' {
        $code = 'AADSTS53003'; $priority = 'P1'
        $title = 'Finance users blocked by CA-001 since the break-glass change (AADSTS53003)'
        $body = "Since $when $($who.displayName) and $($other.displayName) are blocked by Conditional Access policy CA-001 when signing in to Outlook and Teams (AADSTS53003, correlation $corr). The emergency access account bg-admin-01 is no longer excluded from the policy and CA-004 is still in report-only mode. Please check the break-glass exclusion before more users are locked out."
        $dialog = 'MICROSOFT ENTRA - SIGN-IN BLOCKED'; $app = 'Microsoft 365'
        $lines = @('Access has been blocked by Conditional Access policies', 'Error AADSTS53003', "User: $($who.upn)", 'Policy: CA-001')
    }
    'WorkloadIdentity' {
        $code = 'AADSTS7000222'; $priority = 'P2'
        $title = 'ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired secret)'
        $body = "The nightly GitHub Actions run of spn-contoso-erp-sync fails since $when with AADSTS7000222: the client secret has expired. The app registration still lists the contractor Alex Wilber as owner although he holds no admin role, and the granted Graph scopes (Directory.ReadWrite.All, Sites.FullControl.All, Mail.ReadWrite) are far wider than the sync needs. Please rotate to a federated credential and right-size the permissions."
        $dialog = 'GITHUB ACTIONS - RUN FAILED'; $app = 'GitHub Actions'
        $lines = @('Error: AADSTS7000222', 'The provided client secret is expired', 'App: spn-contoso-erp-sync', "Run: $stamp")
    }
    'Licensing' {
        $code = 'CountViolation'; $priority = 'P2'
        $title = "SPE_E5 group licensing shows CountViolation and $($who.displayName) lost Teams"
        $body = "Since $when the group-based licensing of SG-Finance-E5 reports CountViolation on SPE_E5; $($who.displayName) ($($who.role)) lost Teams and Exchange while several disabled accounts still hold E5 seats and a Copilot add-on. Please reclaim the orphaned seats and re-apply the licence to the active users."
        $dialog = 'MICROSOFT 365 ADMIN - LICENSES'; $app = 'Microsoft 365 admin center'
        $lines = @('License assignment failed', 'CountViolation on SPE_E5', 'Group: SG-Finance-E5', "User: $($who.upn)")
    }
    'Mixed' {
        $code = 'AADSTS53003'; $priority = 'P1'
        $title = "$($who.displayName): AVD sign-in blocked (AADSTS53003), $($who.device) not compliant (0x87D1FDE8)"
        $body = "$($who.displayName) ($($who.role)) gets a Conditional Access block when opening the Windows App against vdpool-contoso-fin-01 since $when; the dialog shows AADSTS53003 with correlation id $corr. While checking nsg-contoso-avd-hostpool-01 a vendor rule allowing RDP 3389 from the internet is visible in the portal and is not in our Terraform. The same laptop $($who.device) shows 'Not compliant' in the Company Portal with 0x87D1FDE8 on Intune-Win11-ASR-Baseline, so the compliant-device requirement of CA-001 can never be met."
        $dialog = 'WINDOWS APP - SIGN-IN ERROR'; $app = 'Azure Virtual Desktop'
        $lines = @('Your sign-in was blocked by Conditional Access (AADSTS53003)', "User: $($who.upn)", "Device: $($who.device) - not compliant (0x87D1FDE8)", 'Host pool: vdpool-contoso-fin-01')
    }
}

$dir = Join-Path $InboxDir $displayId
if ((Test-Path $dir) -and -not $Force) { throw "$dir exists; pass -Force to overwrite or omit -TicketId for a random id" }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# --- attachment1.png ---------------------------------------------------------------------------
$texts = [ordered]@{ Title = "$displayId $dialog"; ErrorCode = $code; CorrelationId = $corr; Timestamp = $stamp; Device = "$($who.device) · Entra joined"; User = $who.upn; App = $app; Software = 'ContextPane New-RandomErpTicketDrop.ps1' }

function Write-PngWithText {
    param([byte[]]$Png, [System.Collections.Specialized.OrderedDictionary]$Texts, [string]$Path)
    # Insert tEXt chunks right after IHDR (chunk 1 ends at offset 8 + 4 + 4 + 13 + 4 = 33).
    $crcTable = [uint32[]]::new(256)
    for ($n = 0; $n -lt 256; $n++) { $c = [uint32]$n; for ($k = 0; $k -lt 8; $k++) { if ($c -band 1) { $c = [uint32]3988292384 -bxor ($c -shr 1) } else { $c = $c -shr 1 } }; $crcTable[$n] = $c }
    $chunks = [System.Collections.Generic.List[byte]]::new()
    foreach ($key in $Texts.Keys) {
        [byte[]]$body = [System.Text.Encoding]::Latin1.GetBytes("tEXt$key") + [byte]0 + [System.Text.Encoding]::Latin1.GetBytes([string]$Texts[$key])
        $len = $body.Length - 4
        $crc = [uint32]::MaxValue
        foreach ($b in $body) { $crc = $crcTable[($crc -bxor $b) -band 0xFF] -bxor ($crc -shr 8) }
        $crc = $crc -bxor [uint32]::MaxValue
        $chunks.AddRange([byte[]]@((($len -shr 24) -band 0xFF), (($len -shr 16) -band 0xFF), (($len -shr 8) -band 0xFF), ($len -band 0xFF)))
        $chunks.AddRange($body)
        $chunks.AddRange([byte[]]@((($crc -shr 24) -band 0xFF), (($crc -shr 16) -band 0xFF), (($crc -shr 8) -band 0xFF), ($crc -band 0xFF)))
    }
    [byte[]]$out = $Png[0..32] + $chunks.ToArray() + $Png[33..($Png.Length - 1)]
    [System.IO.File]::WriteAllBytes($Path, $out)
}

$pngPath = Join-Path $dir 'attachment1.png'
$drawn = $false
try {
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $bmp = [System.Drawing.Bitmap]::new(640, 400)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(17, 22, 32))
    $window = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 36, 48))
    $titleBar = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(40, 47, 62))
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 80, 100))
    $text = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(226, 232, 240))
    $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(148, 163, 184))
    $red = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(239, 68, 68))
    $amber = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 158, 11))
    $g.FillRectangle($window, 40, 30, 560, 340); $g.DrawRectangle($pen, 40, 30, 560, 340); $g.FillRectangle($titleBar, 41, 31, 558, 28)
    $fontTitle = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $font = [System.Drawing.Font]::new('Segoe UI', 10)
    $mono = [System.Drawing.Font]::new('Consolas', 9.5)
    $g.DrawString($dialog, $fontTitle, $text, 50, 36); $g.FillRectangle($red, 560, 38, 12, 12)
    $g.FillRectangle($red, 60, 80, 36, 36); $g.DrawString('!', [System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold), $text, 68, 80)
    $y = 82
    foreach ($line in $lines) { $g.DrawString($line, $font, $(if ($line -match 'AADSTS|0x87D|CountViolation') { $amber } else { $text }), 110, $y); $y += 22 }
    $y += 10; $g.DrawLine($pen, 60, $y, 580, $y); $y += 12
    foreach ($row in @("Error code: $code", "Correlation ID: $corr", "Timestamp: $stamp", "Device: $($who.device) - Entra joined", "App: $app")) { $g.DrawString($row, $mono, $(if ($row -like 'Error*') { $amber } else { $muted }), 60, $y); $y += 18 }
    $g.DrawString("Ticket $displayId - Contoso Finance - $($who.displayName)", $mono, $muted, 50, 350)
    $g.Dispose()
    $ms = [System.IO.MemoryStream]::new(); $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Write-PngWithText -Png $ms.ToArray() -Texts $texts -Path $pngPath
    $drawn = $true
} catch {
    Write-Warning "System.Drawing path failed ($($_.Exception.Message)); writing a minimal PNG"
}
if (-not $drawn) {
    # Minimal valid PNG: 320x200 RGB, one colour, zlib via .NET; the tEXt chunks carry the telemetry.
    $w = 320; $h = 200
    $raw = [byte[]]::new(($w * 3 + 1) * $h)
    for ($yy = 0; $yy -lt $h; $yy++) { $o = $yy * ($w * 3 + 1); $raw[$o] = 0; for ($x = 0; $x -lt $w; $x++) { $raw[$o + 1 + $x * 3] = 30; $raw[$o + 2 + $x * 3] = 36; $raw[$o + 3 + $x * 3] = 48 } }
    $ms = [System.IO.MemoryStream]::new()
    $z = [System.IO.Compression.ZLibStream]::new($ms, [System.IO.Compression.CompressionLevel]::Optimal, $true); $z.Write($raw, 0, $raw.Length); $z.Dispose()
    $idat = $ms.ToArray()
    $crcTable = [uint32[]]::new(256)
    for ($n = 0; $n -lt 256; $n++) { $c = [uint32]$n; for ($k = 0; $k -lt 8; $k++) { if ($c -band 1) { $c = [uint32]3988292384 -bxor ($c -shr 1) } else { $c = $c -shr 1 } }; $crcTable[$n] = $c }
    function Chunk([string]$type, [byte[]]$data) {
        [byte[]]$body = [System.Text.Encoding]::ASCII.GetBytes($type) + $data
        $crc = [uint32]::MaxValue; foreach ($b in $body) { $crc = $crcTable[($crc -bxor $b) -band 0xFF] -bxor ($crc -shr 8) }; $crc = $crc -bxor [uint32]::MaxValue
        $len = $data.Length
        return [byte[]]@((($len -shr 24) -band 0xFF), (($len -shr 16) -band 0xFF), (($len -shr 8) -band 0xFF), ($len -band 0xFF)) + $body + [byte[]]@((($crc -shr 24) -band 0xFF), (($crc -shr 16) -band 0xFF), (($crc -shr 8) -band 0xFF), ($crc -band 0xFF))
    }
    $ihdr = [byte[]]@(0, 0, (($w -shr 8) -band 0xFF), ($w -band 0xFF), 0, 0, (($h -shr 8) -band 0xFF), ($h -band 0xFF), 8, 2, 0, 0, 0)
    [byte[]]$png = [byte[]]@(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + (Chunk 'IHDR' $ihdr) + (Chunk 'IDAT' $idat) + (Chunk 'IEND' ([byte[]]@()))
    Write-PngWithText -Png $png -Texts $texts -Path $pngPath
}

# --- ticketbody.json (written last, atomically: the watcher only ingests complete drops) --------
$ticket = [ordered]@{
    ticketId   = $displayId
    source     = 'ERP'
    title      = $title
    body       = $body
    customer   = 'Contoso Finance'
    requester  = [ordered]@{ displayName = $who.displayName; upn = $who.upn; role = $who.role }
    priority   = $priority
    createdAt  = $at.ToString('o')
    attachments = @('attachment1.png')
    telemetry  = [ordered]@{ errorCode = $code; correlationId = $corr; timestamp = $stamp; device = $who.device }
}
$tmp = Join-Path $dir '.ticketbody.json.tmp'
$ticket | ConvertTo-Json -Depth 5 | Set-Content -Path $tmp -Encoding utf8NoBOM
Move-Item -Path $tmp -Destination (Join-Path $dir 'ticketbody.json') -Force

Write-Host "Dropped $displayId ($Archetype) -> $dir" -ForegroundColor Green
Write-Host "  ticketbody.json  $title" -ForegroundColor DarkGray
Write-Host "  attachment1.png  $((Get-Item $pngPath).Length) bytes $(if ($drawn) { '(System.Drawing)' } else { '(minimal PNG)' }) · $code" -ForegroundColor DarkGray
[pscustomobject]@{ Folder = $displayId; ScenarioId = "ERP-$digits"; Archetype = $Archetype; Dir = $dir; ErrorCode = $code }
