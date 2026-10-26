import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StagingInfo } from "@contextpane/catalog";
import { REPO_ROOT, config } from "../config.ts";

/**
 * Stage a remediation on a real git branch without touching the user's
 * checkout: a throw-away worktree is created from HEAD, the bundle is
 * committed there, and the worktree is removed. The branch stays.
 *
 * Every ticket has one canonical branch (fix/INC-4092-contoso-remediation),
 * force-updated by each new remediation, so repeated demo runs leave at most
 * one branch per ticket instead of one per run.
 */

export interface StagingBundle {
  ticketId: string;
  tenantName: string;
  remediationId: string;
  title: string;
  /** Canonical PR title for the ticket; stays the same across runs. */
  prTitle: string;
  summary: string;
  powershellScript: string;
  /** Empty when the fix has no IaC part; no patch file is written then. */
  terraformDiff: string;
  /** Graph request bodies (JSON) the fix sends; empty to skip. */
  graphPatch?: string;
  terraformFile: string;
  verificationSummary: string;
}

function git(args: string[], cwd: string, timeoutMs = 20_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: stderr + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function must(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

export function branchNameFor(ticketId: string, tenantName: string): string {
  const slug = (tenantName.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "") || "tenant";
  return `fix/${ticketId.replace(/[^A-Za-z0-9-]/g, "")}-${slug}-remediation`;
}

// One staging at a time: two remediations for the same ticket share a branch and a worktree path.
let stagingQueue: Promise<unknown> = Promise.resolve();

export function stageRemediationBranch(bundle: StagingBundle): Promise<{ staging: StagingInfo | null; findings: string[] }> {
  const next = stagingQueue.then(() => stageNow(bundle));
  stagingQueue = next.catch(() => {});
  return next;
}

async function stageNow(bundle: StagingBundle): Promise<{ staging: StagingInfo | null; findings: string[] }> {
  const findings: string[] = [];
  const inRepo = await git(["rev-parse", "--is-inside-work-tree"], REPO_ROOT);
  if (inRepo.code !== 0 || inRepo.stdout !== "true") {
    return { staging: null, findings: ["Not a git repository; PR staging skipped"] };
  }
  const branchName = branchNameFor(bundle.ticketId, bundle.tenantName);
  const worktreeDir = join(config.stagingDir, branchName.replace(/[\\/]/g, "_"));
  mkdirSync(config.stagingDir, { recursive: true });
  if (existsSync(worktreeDir)) {
    await git(["worktree", "remove", "--force", worktreeDir], REPO_ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], REPO_ROOT);

  try {
    const head = await must(["rev-parse", "HEAD"], REPO_ROOT);
    // -B force-updates the ticket's canonical branch to HEAD instead of failing when it exists.
    await must(["worktree", "add", "-B", branchName, worktreeDir, head], REPO_ROOT);

    const relDir = join("demo-iac", "remediations", bundle.ticketId);
    const absDir = join(worktreeDir, relDir);
    mkdirSync(absDir, { recursive: true });
    const scriptFile = join(relDir, `Invoke-Remediate-${bundle.ticketId}.ps1`);
    const patchFile = join(relDir, "nsg-drift.patch");
    const graphFile = join(relDir, "graph-requests.json");
    const readmeFile = join(relDir, "REMEDIATION.md");
    const hasIac = bundle.terraformDiff.trim() !== "";
    writeFileSync(join(worktreeDir, scriptFile), bundle.powershellScript, "utf8");
    if (hasIac) writeFileSync(join(worktreeDir, patchFile), bundle.terraformDiff.endsWith("\n") ? bundle.terraformDiff : bundle.terraformDiff + "\n", "utf8");
    if (bundle.graphPatch?.trim()) writeFileSync(join(worktreeDir, graphFile), bundle.graphPatch.endsWith("\n") ? bundle.graphPatch : bundle.graphPatch + "\n", "utf8");
    writeFileSync(
      join(worktreeDir, readmeFile),
      [
        `# ${bundle.title}`,
        "",
        `**Ticket:** ${bundle.ticketId} · **Tenant:** ${bundle.tenantName} · **Remediation:** ${bundle.remediationId}`,
        "",
        bundle.summary,
        "",
        "## Pre-flight",
        "",
        bundle.verificationSummary,
        "",
        "## Apply",
        "",
        "```powershell",
        `pwsh -NoProfile -File ./${scriptFile.replace(/\\/g, "/")} -WhatIf   # dry run`,
        `pwsh -NoProfile -File ./${scriptFile.replace(/\\/g, "/")}           # execute (delegated identity)`,
        "```",
        "",
        ...(hasIac
          ? ["```bash", `terraform -chdir=demo-iac plan   # reconciles ${bundle.terraformFile} against Azure (removes rogue rules, restores tags)`, "```", ""]
          : []),
        "_Staged by ContextPane Tier 3. Human approval required before execution._",
        "",
      ].join("\n"),
      "utf8",
    );

    await must(["add", "-A"], worktreeDir);
    const message = `fix(${bundle.ticketId}): stage remediation for ${bundle.tenantName}\n\n${bundle.summary}\n\nStaged by ContextPane Tier 3 (${bundle.remediationId}); human approval pending.`;
    await must(["commit", "-q", "-m", message], worktreeDir);
    const sha = await must(["rev-parse", "HEAD"], worktreeDir);
    const files = (await must(["show", "--name-only", "--format=", "HEAD"], worktreeDir)).split("\n").filter(Boolean);

    return {
      staging: {
        branchName,
        commitSha: sha,
        filesChanged: files,
        worktreePath: worktreeDir,
        prTitle: bundle.prTitle,
        pushed: false,
        prUrl: null,
      },
      findings,
    };
  } catch (error) {
    findings.push(`PR staging failed: ${error instanceof Error ? error.message : String(error)}`);
    return { staging: null, findings };
  } finally {
    await git(["worktree", "remove", "--force", worktreeDir], REPO_ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
    await git(["worktree", "prune"], REPO_ROOT);
  }
}

/**
 * Emergency break-glass: after the live write, commit the state it produced on top of the
 * remediation's staged commit, on the same canonical fix/* branch, so Git records exactly
 * what the hotfix changed and the PR (when one is opened) carries both commits.
 */
export function reconcileStagedBranch(staging: StagingInfo, files: Array<{ path: string; content: string }>, message: string): Promise<{ staging: StagingInfo; log: string[] }> {
  const next = stagingQueue.then(() => reconcileNow(staging, files, message));
  stagingQueue = next.catch(() => {});
  return next;
}

async function reconcileNow(staging: StagingInfo, files: Array<{ path: string; content: string }>, message: string): Promise<{ staging: StagingInfo; log: string[] }> {
  const worktreeDir = join(config.stagingDir, `${staging.branchName.replace(/[\\/]/g, "_")}-reconcile`);
  mkdirSync(config.stagingDir, { recursive: true });
  if (existsSync(worktreeDir)) {
    await git(["worktree", "remove", "--force", worktreeDir], REPO_ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], REPO_ROOT);
  try {
    // Build on this remediation's own commit, even if a later run has moved the branch since.
    await must(["worktree", "add", "-B", staging.branchName, worktreeDir, staging.commitSha ?? staging.branchName], REPO_ROOT);
    for (const f of files) {
      mkdirSync(join(worktreeDir, f.path, ".."), { recursive: true });
      writeFileSync(join(worktreeDir, f.path), f.content.endsWith("\n") ? f.content : `${f.content}\n`, "utf8");
    }
    await must(["add", "-A"], worktreeDir);
    await must(["commit", "-q", "-m", message], worktreeDir);
    const sha = await must(["rev-parse", "HEAD"], worktreeDir);
    const changed = (await must(["show", "--name-only", "--format=", "HEAD"], worktreeDir)).split("\n").filter(Boolean);
    return {
      staging: { ...staging, commitSha: sha, filesChanged: [...new Set([...staging.filesChanged, ...changed])] },
      log: [`Reconcile commit ${sha.slice(0, 7)} on ${staging.branchName}: ${changed.join(", ")}`],
    };
  } catch (error) {
    return { staging, log: [`Reconcile commit failed: ${error instanceof Error ? error.message : String(error)}`] };
  } finally {
    await git(["worktree", "remove", "--force", worktreeDir], REPO_ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
    await git(["worktree", "prune"], REPO_ROOT);
  }
}

/* ------------------------------ GitHub (gh CLI) ----------------------------- */

export interface GitHubStatus {
  origin: string | null;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  account: string | null;
  prOnApprove: boolean;
  prBase: string;
}

let githubStatusCache: { at: number; value: GitHubStatus } | null = null;

function run(command: string, args: string[], cwd: string, timeoutMs = 20_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: stderr + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** Is there a remote origin and an authenticated gh CLI? Cached for 60 s; `gh auth status` is slow-ish. */
export async function githubStatus(fresh = false): Promise<GitHubStatus> {
  if (!fresh && githubStatusCache && Date.now() - githubStatusCache.at < 60_000) return githubStatusCache.value;
  const origin = await git(["remote", "get-url", "origin"], REPO_ROOT);
  const auth = await run("gh", ["auth", "status"], REPO_ROOT, 15_000);
  const combined = `${auth.stdout}\n${auth.stderr}`;
  const account = /account (\S+)/.exec(combined)?.[1] ?? null;
  const value: GitHubStatus = {
    origin: origin.code === 0 && origin.stdout ? origin.stdout : null,
    ghInstalled: auth.code !== null && !/not recognized|not found|ENOENT/i.test(auth.stderr),
    ghAuthenticated: auth.code === 0,
    account,
    prOnApprove: config.github.prOnApprove,
    prBase: config.github.prBase,
  };
  githubStatusCache = { at: Date.now(), value };
  return value;
}

/** https://github.com/<owner>/<repo> for the origin remote, or null when origin is not on GitHub. */
export async function githubRepoUrl(): Promise<string | null> {
  const origin = (await githubStatus()).origin;
  const m = origin ? /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(origin) : null;
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

/**
 * Push a staged branch and open a real pull request with `gh pr create`.
 * Only ever called from the HITL approve endpoint, only when the operator
 * opted in, and only when a remote origin plus gh auth exist.
 *
 * Idempotent per ticket: the approved commit is force-pushed to the canonical
 * branch, and when that branch already has an open PR its URL is returned
 * instead of opening a duplicate.
 */
export async function openPullRequest(staging: StagingInfo, body: string): Promise<{ staging: StagingInfo; log: string[] }> {
  const log: string[] = [];
  const status = await githubStatus(true);
  if (!status.origin) return { staging, log: ["No remote origin: run scripts/Publish-ContextPaneRepo.ps1 first; PR skipped"] };
  if (!status.ghAuthenticated) return { staging, log: ["gh CLI is not authenticated (gh auth login); PR skipped"] };
  if (staging.prUrl) return { staging, log: [`PR already open: ${staging.prUrl}`] };

  // Push the commit this remediation staged, even if a later run has moved the local branch since.
  const ref = staging.commitSha ?? staging.branchName;
  const push = await git(["push", "--force", "origin", `${ref}:refs/heads/${staging.branchName}`], REPO_ROOT, 60_000);
  if (push.code !== 0) return { staging, log: [`git push failed: ${push.stderr || push.stdout}`] };
  log.push(`Force-pushed ${staging.branchName} @ ${ref.slice(0, 7)} to ${status.origin}`);

  const bodyFile = join(config.stagingDir, `${staging.branchName.replace(/[\\/]/g, "_")}.pr.md`);
  mkdirSync(config.stagingDir, { recursive: true });
  writeFileSync(bodyFile, body, "utf8");
  try {
    const existing = await run("gh", ["pr", "view", staging.branchName, "--json", "url,state"], REPO_ROOT, 30_000);
    let openUrl: string | null = null;
    try {
      const found = existing.code === 0 ? (JSON.parse(existing.stdout) as { url?: string; state?: string }) : {};
      if (found.url && found.state === "OPEN") openUrl = found.url;
    } catch {
      // Unparseable answer: fall through to gh pr create, which refuses a duplicate itself.
    }
    if (openUrl) {
      // Same PR, new commit: refresh the description so it matches what was just pushed.
      const edit = await run("gh", ["pr", "edit", openUrl, "--title", staging.prTitle, "--body-file", bodyFile], REPO_ROOT, 30_000);
      log.push(`Pull request already open, updated in place: ${openUrl}${edit.code === 0 ? "" : ` (description not refreshed: ${edit.stderr || edit.stdout})`}`);
      return { staging: { ...staging, pushed: true, prUrl: openUrl }, log };
    }

    const pr = await run("gh", ["pr", "create", "--head", staging.branchName, "--base", config.github.prBase, "--title", staging.prTitle, "--body-file", bodyFile], REPO_ROOT, 60_000);
    const url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(`${pr.stdout}\n${pr.stderr}`)?.[0] ?? null;
    if (pr.code !== 0 && !url) return { staging: { ...staging, pushed: true }, log: [...log, `gh pr create failed: ${pr.stderr || pr.stdout}`] };
    log.push(url ? `Pull request opened: ${url}` : "gh pr create finished without a URL");
    return { staging: { ...staging, pushed: true, prUrl: url }, log };
  } finally {
    rmSync(bodyFile, { force: true });
  }
}

export async function listStagedBranches(): Promise<string[]> {
  const r = await git(["branch", "--list", "fix/*", "--format=%(refname:short)"], REPO_ROOT);
  return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}
