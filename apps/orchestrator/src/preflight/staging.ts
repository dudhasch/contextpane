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

export async function listStagedBranches(): Promise<string[]> {
  const r = await git(["branch", "--list", "fix/*", "--format=%(refname:short)"], REPO_ROOT);
  return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}
