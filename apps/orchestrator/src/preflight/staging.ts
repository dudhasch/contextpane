import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StagingInfo } from "@contextpane/catalog";
import { REPO_ROOT, config } from "../config.ts";

/**
 * Stage a remediation on a real git branch without touching the user's
 * checkout: a throw-away worktree is created from HEAD, the bundle is
 * committed there, and the worktree is removed. The branch stays.
 */

export interface StagingBundle {
  ticketId: string;
  tenantName: string;
  remediationId: string;
  title: string;
  summary: string;
  powershellScript: string;
  terraformDiff: string;
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

export function branchNameFor(ticketId: string, remediationId: string): string {
  const short = remediationId.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase();
  return `fix/${ticketId.toLowerCase()}-nsg-drift-${short}`;
}

export async function stageRemediationBranch(bundle: StagingBundle): Promise<{ staging: StagingInfo | null; findings: string[] }> {
  const findings: string[] = [];
  const inRepo = await git(["rev-parse", "--is-inside-work-tree"], REPO_ROOT);
  if (inRepo.code !== 0 || inRepo.stdout !== "true") {
    return { staging: null, findings: ["Not a git repository; PR staging skipped"] };
  }
  const branchName = branchNameFor(bundle.ticketId, bundle.remediationId);
  const worktreeDir = join(config.stagingDir, branchName.replace(/[\\/]/g, "_"));
  mkdirSync(config.stagingDir, { recursive: true });
  if (existsSync(worktreeDir)) {
    await git(["worktree", "remove", "--force", worktreeDir], REPO_ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], REPO_ROOT);

  try {
    const head = await must(["rev-parse", "HEAD"], REPO_ROOT);
    await must(["worktree", "add", "-b", branchName, worktreeDir, head], REPO_ROOT);

    const relDir = join("demo-iac", "remediations", bundle.ticketId);
    const absDir = join(worktreeDir, relDir);
    mkdirSync(absDir, { recursive: true });
    const scriptFile = join(relDir, `Invoke-Remediate-${bundle.ticketId}.ps1`);
    const patchFile = join(relDir, "nsg-drift.patch");
    const readmeFile = join(relDir, "REMEDIATION.md");
    writeFileSync(join(worktreeDir, scriptFile), bundle.powershellScript, "utf8");
    writeFileSync(join(worktreeDir, patchFile), bundle.terraformDiff.endsWith("\n") ? bundle.terraformDiff : bundle.terraformDiff + "\n", "utf8");
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
        "```bash",
        `terraform -chdir=demo-iac plan   # reconciles ${bundle.terraformFile} against Azure (removes rogue rules, restores tags)`,
        "```",
        "",
        "_Staged by ContextPane Tier 3. Human approval required before execution._",
        "",
      ].join("\n"),
      "utf8",
    );

    await must(["add", "-A"], worktreeDir);
    const message = `fix(${bundle.ticketId.toLowerCase()}): stage remediation for ${bundle.tenantName}\n\n${bundle.summary}\n\nStaged-By: ContextPane Tier 3 (HITL pending)`;
    await must(["commit", "-q", "-m", message], worktreeDir);
    const sha = await must(["rev-parse", "HEAD"], worktreeDir);
    const files = (await must(["show", "--name-only", "--format=", "HEAD"], worktreeDir)).split("\n").filter(Boolean);

    return {
      staging: {
        branchName,
        commitSha: sha,
        filesChanged: files,
        worktreePath: worktreeDir,
        prTitle: bundle.title,
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

/**
 * Push a staged branch and open a real pull request with `gh pr create`.
 * Only ever called from the HITL approve endpoint, only when the operator
 * opted in, and only when a remote origin plus gh auth exist.
 */
export async function openPullRequest(staging: StagingInfo, body: string): Promise<{ staging: StagingInfo; log: string[] }> {
  const log: string[] = [];
  const status = await githubStatus(true);
  if (!status.origin) return { staging, log: ["No remote origin: run scripts/Publish-ContextPaneRepo.ps1 first; PR skipped"] };
  if (!status.ghAuthenticated) return { staging, log: ["gh CLI is not authenticated (gh auth login); PR skipped"] };
  if (staging.prUrl) return { staging, log: [`PR already open: ${staging.prUrl}`] };

  const push = await git(["push", "-u", "origin", `${staging.branchName}:${staging.branchName}`], REPO_ROOT, 60_000);
  if (push.code !== 0) return { staging, log: [`git push failed: ${push.stderr || push.stdout}`] };
  log.push(`Pushed ${staging.branchName} to ${status.origin}`);

  const bodyFile = join(config.stagingDir, `${staging.branchName.replace(/[\\/]/g, "_")}.pr.md`);
  mkdirSync(config.stagingDir, { recursive: true });
  writeFileSync(bodyFile, body, "utf8");
  try {
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
