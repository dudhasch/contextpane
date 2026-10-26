#Requires -Version 7.0
<#
.SYNOPSIS
    Publishes ContextPane to GitHub in a way that complies with the Meta Global AI Developer Hackathon rules.

.DESCRIPTION
    Sections 3 and 4 of the hackathon rules require new work only, built during the event, which starts with the
    kickoff on 2026-10-26 at 17:00 CET (12:00 PM ET). This script makes the git history provably post-kickoff and
    single-authored before anything leaves the machine:

      1. Audits the history: commit count, earliest / latest timestamps, every author and committer identity,
         Co-Authored-By trailers.
      2. -NormalizeTimestampsToNow rewrites every commit (git filter-branch --env-filter + --msg-filter) so that
           - author AND committer are solely <AuthorName> <AuthorEmail>,
           - every Co-Authored-By / Signed-off-by trailer is stripped from the message,
           - author and committer dates are monotonically increasing and all >= the current time,
             which must itself be >= the kickoff (the script refuses to normalise before kickoff unless -Force).
         Backup refs (refs/original) are dropped and reflog expired so the old objects do not travel with the push.
      3. Checks `gh auth status`. When -PushNow is passed, or the local time is already past kickoff, it creates the
         public repository with `gh repo create <RepoName> --public --source . --remote origin --push`
         (or just pushes when `origin` already exists).

    Once `origin` exists the orchestrator can open real pull requests from the Tier 3 HITL drawer:
    set CTX_GH_PR_ON_APPROVE=true (or tick "Open GitHub PR" in the drawer) and [Approve & Execute] pushes the staged
    fix/<ticket>-<tenant>-remediation branch and returns its open PR, or runs `gh pr create` when there is none.

    Supports -WhatIf for every mutating step. Requires a clean working tree and no extra worktrees.

.EXAMPLE
    pwsh ./scripts/Publish-ContextPaneRepo.ps1                                   # audit only (push only if past kickoff)
.EXAMPLE
    pwsh ./scripts/Publish-ContextPaneRepo.ps1 -NormalizeTimestampsToNow -WhatIf  # show what the rewrite would do
.EXAMPLE
    pwsh ./scripts/Publish-ContextPaneRepo.ps1 -NormalizeTimestampsToNow -PushNow
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$RepoName = 'contextpane',
    # Rewrite history so every commit is post-kickoff and solely authored by -AuthorName/-AuthorEmail.
    [switch]$NormalizeTimestampsToNow,
    # Create the public repo and push now, regardless of the kickoff gate.
    [switch]$PushNow,
    # GitHub owner/org for the new repo; defaults to the gh-authenticated account.
    [string]$Owner,
    [string]$AuthorName = 'Timur Dudhasch',
    [string]$AuthorEmail = '155721920+dudhasch@users.noreply.github.com',
    # Hackathon kickoff: 2026-10-26 17:00 CET (UTC+1) = 12:00 PM ET.
    [datetimeoffset]$Kickoff = [datetimeoffset]::Parse('2026-10-26T17:00:00+01:00'),
    [string]$Description = 'ContextPane: local-first, MCP-driven, catalog-constrained Generative UI workbench for MSP Azure & Microsoft 365 engineers (Meta Global AI Developer Hackathon 2026)',
    # Seconds between consecutive normalised commits (keeps the phase order readable in git log).
    [int]$SpacingSeconds = 1,
    # Allow normalisation before the kickoff time (timestamps would then be pre-kickoff: not what you want for submission).
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Keep([string]$Message) { Write-Host "    [=] $Message" -ForegroundColor DarkGray }
function Invoke-Git([string[]]$GitArgs, [switch]$AllowFailure) {
    $out = & git @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "git $($GitArgs -join ' ') failed: $($out -join "`n")" }
    return $out
}

# ---------------------------------------------------------------------------
# 0. Preconditions
# ---------------------------------------------------------------------------
Write-Step "Repository $repoRoot"
if ((Invoke-Git @('rev-parse', '--is-inside-work-tree') -AllowFailure) -ne 'true') { throw "$repoRoot is not a git repository" }
$branch = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')
$dirty = @(Invoke-Git @('status', '--porcelain'))
if ($dirty.Count -gt 0) { throw "Working tree is not clean ($($dirty.Count) entries). Commit or stash first." }
$worktrees = @(Invoke-Git @('worktree', 'list', '--porcelain') | Where-Object { $_ -like 'worktree *' })
if ($worktrees.Count -gt 1) { throw "Extra git worktrees are checked out ($($worktrees.Count - 1)); remove them (git worktree remove / prune) before rewriting history." }
Write-Ok "branch $branch, clean tree, single worktree"

$now = [datetimeoffset]::Now
$pastKickoff = $now -ge $Kickoff
Write-Host ("    now      {0:yyyy-MM-dd HH:mm:ss zzz}" -f $now)
Write-Host ("    kickoff  {0:yyyy-MM-dd HH:mm:ss zzz}  ({1})" -f $Kickoff, $(if ($pastKickoff) { 'past kickoff' } else { 'before kickoff: {0:hh\:mm\:ss} to go' -f ($Kickoff - $now) }))

# ---------------------------------------------------------------------------
# 1. Audit
# ---------------------------------------------------------------------------
function Get-HistoryAudit {
    $sep = [char]31
    $rows = @(Invoke-Git @('log', '--all', '--reverse', "--format=%H$sep%aI$sep%cI$sep%an <%ae>$sep%cn <%ce>$sep%s")) | ForEach-Object {
        $p = $_ -split [regex]::Escape($sep)
        [pscustomobject]@{ Sha = $p[0]; Short = $p[0].Substring(0, 7); AuthorDate = [datetimeoffset]::Parse($p[1]); CommitDate = [datetimeoffset]::Parse($p[2]); Author = $p[3]; Committer = $p[4]; Subject = $p[5] }
    }
    $trailers = @(Invoke-Git @('log', '--all', '--format=%H %B') | Where-Object { $_ -match '^\s*(Co-Authored-By|Signed-off-by):' })
    [pscustomobject]@{
        Commits    = $rows
        Identities = @($rows | ForEach-Object { $_.Author; $_.Committer } | Sort-Object -Unique)
        Trailers   = $trailers
        Earliest   = ($rows | ForEach-Object { $_.AuthorDate; $_.CommitDate } | Sort-Object | Select-Object -First 1)
        Latest     = ($rows | ForEach-Object { $_.AuthorDate; $_.CommitDate } | Sort-Object | Select-Object -Last 1)
    }
}
function Show-Audit($audit, [string]$Title, [datetimeoffset]$Threshold = $Kickoff) {
    Write-Step $Title
    $audit.Commits | Format-Table @{ n = 'sha'; e = 'Short' }, @{ n = 'author date'; e = { $_.AuthorDate.ToString('yyyy-MM-dd HH:mm:ss zzz') } }, @{ n = 'commit date'; e = { $_.CommitDate.ToString('yyyy-MM-dd HH:mm:ss zzz') } }, @{ n = 'author'; e = 'Author' }, @{ n = 'subject'; e = { if ($_.Subject.Length -gt 60) { $_.Subject.Substring(0, 57) + '...' } else { $_.Subject } } } -AutoSize | Out-String -Width 200 | Write-Host
    Write-Host "    commits: $($audit.Commits.Count)   identities: $($audit.Identities -join ' | ')"
    Write-Host "    earliest: $($audit.Earliest.ToString('yyyy-MM-dd HH:mm:ss zzz'))   latest: $($audit.Latest.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
    Write-Host "    co-author / sign-off trailers: $($audit.Trailers.Count)"
    $expected = "$AuthorName <$AuthorEmail>"
    $foreign = @($audit.Identities | Where-Object { $_ -ne $expected })
    $pre = @($audit.Commits | Where-Object { $_.AuthorDate -lt $Threshold -or $_.CommitDate -lt $Threshold })
    $what = if ($Threshold -eq $Kickoff) { 'post-kickoff' } else { ">= $($Threshold.ToString('HH:mm:ss zzz'))" }
    if ($foreign.Count -eq 0 -and $audit.Trailers.Count -eq 0 -and $pre.Count -eq 0) {
        Write-Ok "history is single-author, trailer-free and every timestamp is $what"
        if ($Threshold -lt $Kickoff) { Write-Host "    [!] still before kickoff ($($Kickoff.ToString('HH:mm zzz'))): re-run -NormalizeTimestampsToNow after kickoff before submitting" -ForegroundColor Yellow }
    } else {
        if ($foreign.Count)  { Write-Host "    [!] identities other than $expected : $($foreign -join ', ')" -ForegroundColor Yellow }
        if ($audit.Trailers.Count) { Write-Host "    [!] trailers present: $($audit.Trailers.Count)" -ForegroundColor Yellow }
        if ($pre.Count)      { Write-Host "    [!] $($pre.Count) commit(s) timestamped before $what" -ForegroundColor Yellow }
    }
    return ($foreign.Count -eq 0 -and $audit.Trailers.Count -eq 0 -and $pre.Count -eq 0)
}

$audit = Get-HistoryAudit
$compliant = Show-Audit $audit 'History before'

# ---------------------------------------------------------------------------
# 2. Normalise
# ---------------------------------------------------------------------------
if ($NormalizeTimestampsToNow) {
    if (-not $pastKickoff -and -not $Force) {
        throw "It is $($now.ToString('HH:mm zzz')), before the kickoff at $($Kickoff.ToString('HH:mm zzz')). Normalising now would stamp commits pre-kickoff. Re-run after kickoff, or pass -Force to do it anyway."
    }
    # whole seconds: git stores epoch seconds, so a sub-second base would make the first commit look earlier than the base
    $base = [datetimeoffset]::FromUnixTimeSeconds([datetimeoffset]::Now.ToUnixTimeSeconds()).ToOffset([datetimeoffset]::Now.Offset)
    $ordered = @(Invoke-Git @('rev-list', '--reverse', '--topo-order', '--all'))
    Write-Step "Normalising $($ordered.Count) commits to >= $($base.ToString('yyyy-MM-dd HH:mm:ss zzz')) as $AuthorName <$AuthorEmail>"

    # env-filter: one `case` arm per original commit so dates stay monotonic in topo order.
    $offset = $base.Offset
    $tz = ('{0}{1:00}{2:00}' -f $(if ($offset -lt [timespan]::Zero) { '-' } else { '+' }), [math]::Abs($offset.Hours), [math]::Abs($offset.Minutes))
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('case "$GIT_COMMIT" in')
    for ($i = 0; $i -lt $ordered.Count; $i++) {
        $epoch = $base.AddSeconds($i * $SpacingSeconds).ToUnixTimeSeconds()
        $lines.Add("  $($ordered[$i])) export GIT_AUTHOR_DATE='@$epoch $tz'; export GIT_COMMITTER_DATE='@$epoch $tz';;")
    }
    $lines.Add('esac')
    $lines.Add("export GIT_AUTHOR_NAME='$AuthorName'")
    $lines.Add("export GIT_AUTHOR_EMAIL='$AuthorEmail'")
    $lines.Add("export GIT_COMMITTER_NAME='$AuthorName'")
    $lines.Add("export GIT_COMMITTER_EMAIL='$AuthorEmail'")
    $envFile = Join-Path ([IO.Path]::GetTempPath()) "contextpane-env-filter-$PID.sh"
    [IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    $envFilePosix = $envFile -replace '\\', '/'
    $msgFilter = "sed -e '/^[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:/d' -e '/^[[:space:]]*[Ss]igned-off-by:/d'"

    Write-Host "    first -> $($base.ToString('HH:mm:ss zzz'))   last -> $($base.AddSeconds(($ordered.Count - 1) * $SpacingSeconds).ToString('HH:mm:ss zzz'))   tz $tz"
    if ($PSCmdlet.ShouldProcess("$($ordered.Count) commits on all refs", 'git filter-branch (rewrite author/committer/dates, strip trailers)')) {
        try {
            $env:FILTER_BRANCH_SQUELCH_WARNING = '1'
            Invoke-Git @('filter-branch', '-f', '--env-filter', ". '$envFilePosix'", '--msg-filter', $msgFilter, '--', '--all') | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            foreach ($ref in @(Invoke-Git @('for-each-ref', '--format=%(refname)', 'refs/original/'))) { Invoke-Git @('update-ref', '-d', $ref) | Out-Null }
            Invoke-Git @('reflog', 'expire', '--expire=now', '--all') | Out-Null
            Invoke-Git @('gc', '--prune=now', '--quiet') | Out-Null
            Write-Ok 'history rewritten, refs/original dropped, reflog expired, objects pruned'
        } finally {
            Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
            Remove-Item Env:\FILTER_BRANCH_SQUELCH_WARNING -ErrorAction SilentlyContinue
        }
        # Make sure future commits in this checkout carry the same identity.
        Invoke-Git @('config', 'user.name', $AuthorName) | Out-Null
        Invoke-Git @('config', 'user.email', $AuthorEmail) | Out-Null
        $audit = Get-HistoryAudit
        # With -Force before kickoff the rewrite is judged against its own base time; kickoff compliance is re-audited on the next run.
        $rewriteOk = Show-Audit $audit 'History after' -Threshold $(if ($pastKickoff) { $Kickoff } else { $base })
        if (-not $rewriteOk) { throw 'History is still not compliant after normalisation; inspect the audit above.' }
        $compliant = $rewriteOk -and $pastKickoff
    }
}

# ---------------------------------------------------------------------------
# 3. GitHub
# ---------------------------------------------------------------------------
Write-Step 'GitHub CLI'
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { Write-Warning 'gh CLI not found (winget install GitHub.cli). Skipping publish.'; exit $(if ($compliant) { 0 } else { 2 }) }
$authOut = & gh auth status 2>&1
$authenticated = $LASTEXITCODE -eq 0
$account = ($authOut | Select-String -Pattern 'account (\S+)' | Select-Object -First 1).Matches.Groups[1].Value
if ($authenticated) { Write-Ok "gh authenticated as $account" } else { Write-Warning "gh is not authenticated: run `gh auth login`. Skipping publish."; exit $(if ($compliant) { 0 } else { 2 }) }
if (-not $Owner) { $Owner = $account }

$origin = Invoke-Git @('remote', 'get-url', 'origin') -AllowFailure
$hasOrigin = $LASTEXITCODE -eq 0 -and $origin
if ($hasOrigin) { Write-Keep "remote origin = $origin" } else { Write-Keep 'no remote origin yet' }

$shouldPush = $PushNow -or $pastKickoff
if (-not $shouldPush) {
    Write-Host "`nNot publishing: before kickoff and -PushNow not passed. Re-run after $($Kickoff.ToString('HH:mm zzz')) or with -PushNow." -ForegroundColor Yellow
    exit $(if ($compliant) { 0 } else { 2 })
}
if (-not $compliant) {
    Write-Warning 'History is not hackathon-compliant (see audit). Pass -NormalizeTimestampsToNow before publishing.'
    exit 2
}

if ($hasOrigin) {
    if ($PSCmdlet.ShouldProcess("origin ($origin)", "git push -u origin $branch")) {
        Invoke-Git @('push', '-u', 'origin', $branch) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Write-Ok "pushed $branch to origin"
    }
} else {
    $target = "$Owner/$RepoName"
    if ($PSCmdlet.ShouldProcess($target, 'gh repo create --public --source . --remote origin --push')) {
        & gh repo create $target --public --source . --remote origin --push --description $Description 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        if ($LASTEXITCODE -ne 0) { throw "gh repo create $target failed" }
        Write-Ok "created https://github.com/$target and pushed $branch"
    }
}

$url = (& gh repo view --json url --jq .url 2>$null)
if ($url) { Write-Host "`nRepository: $url" -ForegroundColor Green }
Write-Host "Tier 3 PRs: set CTX_GH_PR_ON_APPROVE=true (or tick 'Open GitHub PR' in the approval drawer) so [Approve & Execute] runs gh pr create on the staged branch." -ForegroundColor DarkGray
exit 0
