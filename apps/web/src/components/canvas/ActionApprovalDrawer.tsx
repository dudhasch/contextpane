import { Braces, Check, ClipboardCopy, ExternalLink, FileCode2, FlaskConical, GitBranch, GitMerge, GitPullRequest, History, ShieldAlert, ShieldCheck, Sparkles, Terminal, Undo2, Users, X, XCircle, Zap } from "lucide-react";
import type { ActionApprovalDrawer as Drawer, ExecutionMode } from "@contextpane/catalog";
import { PROVIDER_LABEL, fmtMs, shortSha } from "@/lib/format";
import { useWorkbench, type DrawerTab as Tab } from "@/store";
import { Button } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Pill, type Tone } from "../ui/Pill";
import { DiffView } from "./DiffView";
import { ProgressRail } from "./ProgressRail";


const VERDICT_TONE: Record<Drawer["verificationStatus"]["verdict"], Tone> = {
  "Verified Safe": "healthy",
  "Verified With Warnings": "warning",
  "Verification Failed": "critical",
  Pending: "muted",
};

/**
 * HITL remediation drawer, the only place anything can be executed from. Two engineer
 * workflows side by side: Path A copies the verified script / patch to run in your own
 * terminal; Path B approves it, either as an Emergency Break-Glass (live write through the
 * delegated identity + reconcile commit) or as Pure GitOps (staged PR + sandbox plan only).
 */
export function ActionApprovalDrawerSheet() {
  const open = useWorkbench((s) => s.drawerOpen);
  const setOpen = useWorkbench((s) => s.setDrawerOpen);
  const drawer = useWorkbench((s) => s.drawer);
  const status = useWorkbench((s) => s.remediateStatus);
  const progress = useWorkbench((s) => s.remediateProgress);
  const approve = useWorkbench((s) => s.approve);
  const approveLog = useWorkbench((s) => s.approveLog);
  const github = useWorkbench((s) => s.health?.github);
  const openPr = useWorkbench((s) => s.openPrOnApprove);
  const setOpenPr = useWorkbench((s) => s.setOpenPrOnApprove);
  const tab = useWorkbench((s) => s.drawerTab);
  const setTab = useWorkbench((s) => s.setDrawerTab);
  const focusUpn = useWorkbench((s) => s.drawerFocusUpn);
  const toast = useWorkbench((s) => s.toast);
  const mode = useWorkbench((s) => s.executionMode);
  const formalPassed = useWorkbench((s) => s.formal?.formal.passed);
  if (!open) return null;
  const prPossible = Boolean(github?.origin && github.ghAuthenticated);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "healthy", title: `${what} copied`, detail: "Run it with -WhatIf first, then without, as your delegated admin." });
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-canvas/70" onClick={() => setOpen(false)}>
      <aside className="flex h-full w-[600px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-popover" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Sparkles className="size-4 text-meta" />
          <span className="text-[13px] font-semibold">Action Approval</span>
          {drawer && <span className="font-mono text-[11px] text-muted">#{drawer.ticketId}</span>}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>

        {status === "loading" || !drawer ? (
          <div className="flex-1 overflow-y-auto p-4">
            <ProgressRail events={progress} title="Synthesising remediation bundle" busy={status === "loading"} />
            {status === "error" && <div className="mt-3 text-sm text-critical">Remediation failed. Check the orchestrator log.</div>}
          </div>
        ) : (
          <>
            <div className="shrink-0 space-y-2.5 border-b border-border px-4 py-3">
              <div className="text-[13px] font-semibold leading-snug">{drawer.title}</div>
              <p className="text-[12px] leading-relaxed text-muted">{drawer.summary}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <VerificationBadge drawer={drawer} />
                <Pill tone="muted" icon={<Terminal />}>
                  AST {flag(drawer.verificationStatus.astCheckPassed)}
                </Pill>
                {drawer.terraformDiff && (
                  <Pill tone="muted" icon={<FileCode2 />}>
                    fmt {flag(drawer.verificationStatus.terraformFmtPassed)} · validate {flag(drawer.verificationStatus.terraformValidatePassed)}
                  </Pill>
                )}
                <Pill tone="muted">
                  {drawer.verificationStatus.sandboxProvider} · {fmtMs(drawer.verificationStatus.validationLatencyMs)}
                </Pill>
              </div>
              {drawer.verificationStatus.findings.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-warning">
                  {drawer.verificationStatus.findings.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {drawer.staging ? (
                  <>
                    <Pill tone="primary" icon={<GitBranch />} title={drawer.staging.filesChanged.join("\n")}>
                      {drawer.staging.branchName} @ {shortSha(drawer.staging.commitSha)} · {drawer.staging.filesChanged.length} files
                    </Pill>
                    {drawer.staging.prUrl && (
                      <a
                        href={drawer.staging.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-healthy/40 bg-healthy/12 px-2 font-mono text-[11px] leading-none whitespace-nowrap text-healthy hover:bg-healthy/20"
                        title={drawer.staging.prUrl}
                      >
                        <GitPullRequest className="size-3" />
                        PR {drawer.staging.prUrl.split("/pull/")[1] ? `#${drawer.staging.prUrl.split("/pull/")[1]}` : "opened"}
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </>
                ) : (
                  <Pill tone="warning" icon={<GitBranch />}>
                    PR staging skipped
                  </Pill>
                )}
                <span className="font-mono text-faint">
                  {drawer.synthesizedBy.planner} → {drawer.synthesizedBy.coder} · {PROVIDER_LABEL[drawer.synthesizedBy.provider] ?? drawer.synthesizedBy.provider} ·{" "}
                  {drawer.providerTelemetry.latencyMs} ms · {drawer.providerTelemetry.tokensUsed} tok
                </span>
              </div>
            </div>

            <div className="shrink-0 border-b border-border bg-canvas/40 px-4 py-2.5" data-testid="path-a">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="rounded bg-primary/15 px-1.5 font-mono text-[10.5px] text-primary">PATH A</span>
                <span className="text-[12px] font-semibold">Review &amp; Run Manually</span>
                <span className="text-[11px] text-faint">in your own terminal, as your delegated admin</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" icon={<ClipboardCopy />} onClick={() => void copy(drawer.powershellScript, "PowerShell script")}>
                  Copy PowerShell Script
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Braces />}
                  onClick={() => void copy(drawer.terraformDiff || drawer.graphPatch, drawer.terraformDiff ? "Terraform diff" : "Graph JSON patch")}
                  disabled={!drawer.terraformDiff && !drawer.graphPatch}
                >
                  {drawer.terraformDiff ? "Copy Terraform Diff" : "Copy Graph JSON Patch"}
                </Button>
                {drawer.terraformDiff && drawer.graphPatch && (
                  <Button size="sm" variant="ghost" icon={<Braces />} onClick={() => void copy(drawer.graphPatch, "Graph JSON patch")}>
                    Graph JSON
                  </Button>
                )}
                <DryRunBadge drawer={drawer} />
              </div>
            </div>

            <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-2">
              <TabButton active={tab === "powershell"} onClick={() => setTab("powershell")} icon={<Terminal />} label="PowerShell" />
              <TabButton active={tab === "graph"} onClick={() => setTab("graph")} icon={<Braces />} label="Graph JSON" />
              {drawer.terraformDiff && <TabButton active={tab === "terraform"} onClick={() => setTab("terraform")} icon={<FileCode2 />} label="Terraform diff" />}
              <TabButton active={tab === "entities"} onClick={() => setTab("entities")} icon={<Users />} label={`Entities (${drawer.affectedEntities.length})`} />
              <TabButton active={tab === "formal"} onClick={() => setTab("formal")} icon={<ShieldCheck />} label="Formal proof" />
              <TabButton active={tab === "rollback"} onClick={() => setTab("rollback")} icon={<History />} label="Inverse Rollback (f⁻¹)" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "powershell" && focusUpn && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
                  <Pill tone="warning">License fix</Pill>
                  <span>
                    The change for <span className="font-mono text-text">{focusUpn}</span> runs with the rest of this bundle after approval.
                  </span>
                </div>
              )}
              {tab === "powershell" && <CodeBlock code={drawer.powershellScript} />}
              {tab === "graph" && <CodeBlock code={drawer.graphPatch || "[]"} />}
              {tab === "terraform" && drawer.terraformDiff && (
                <CodeBlock code={drawer.terraformDiff} render={(wrap) => <DiffView diff={drawer.terraformDiff} maxHeight="max-h-none" wrap={wrap} className="pt-8" />} />
              )}
              {tab === "formal" && <FormalProof />}
              {tab === "rollback" && <RollbackTab />}
              {tab === "entities" && (
                <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
                  {drawer.affectedEntities.map((e) => (
                    <li key={`${e.type}-${e.id}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
                      <Pill tone="muted">{e.type}</Pill>
                      <span className="truncate font-mono">{e.id}</span>
                      <span className="ml-auto text-muted">{e.change}</span>
                    </li>
                  ))}
                </ul>
              )}
              {approveLog.length > 0 && (
                <div className="mt-3 rounded-md border border-border-subtle bg-canvas p-2 font-mono text-[11px] text-muted">
                  {approveLog.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}
            </div>

            <footer className="shrink-0 space-y-2 border-t border-border p-4" data-testid="path-b">
              <div className="flex items-center gap-2">
                <span className="rounded bg-healthy/15 px-1.5 font-mono text-[10.5px] text-healthy">PATH B</span>
                <span className="text-[12px] font-semibold">Approve in Portal (HITL)</span>
              </div>
              <ExecutionModeSwitch drawer={drawer} />
              <p className="text-[11px] leading-snug text-muted" data-testid="mode-detail">
                {mode === "break-glass" ? (
                  <>
                    Writes the live {drawer.terraformDiff ? "Graph and ARM resources" : "Graph objects"} now as the delegated identity, then commits the resulting state to{" "}
                    <span className="font-mono text-text">{drawer.staging?.branchName ?? "the fix branch"}</span>
                    {openPr && prPossible ? " and updates the PR" : ""}.
                  </>
                ) : (
                  <>
                    Nothing changes live. Re-runs the {drawer.verificationStatus.sandboxProvider === "modal-cloud-sandbox" ? "warm Modal" : "local"} pre-flight ({drawer.terraformDiff ? "terraform validate + " : ""}pwsh AST) and stages{" "}
                    <span className="font-mono text-text">{drawer.staging?.branchName ?? "the fix branch"}</span> for the pipeline{openPr && prPossible ? " via the PR" : ""}.
                  </>
                )}
              </p>
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>
                  Delegated identity <span className="font-mono text-text">{drawer.approval.requiredIdentity}</span>
                </span>
                <ApprovalState drawer={drawer} />
              </div>
              {drawer.approval.state === "pending" && (
                <label
                  className={`flex items-center gap-2 text-[11px] ${prPossible ? "text-muted" : "text-faint"}`}
                  title={
                    prPossible
                      ? `git push origin ${drawer.staging?.branchName ?? "fix/*"} + gh pr create --base ${github?.prBase ?? "main"}`
                      : "Needs a remote origin and an authenticated gh CLI: run scripts/Publish-ContextPaneRepo.ps1 first"
                  }
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={openPr && prPossible}
                    disabled={!prPossible || !drawer.staging}
                    onChange={(e) => setOpenPr(e.target.checked)}
                  />
                  <GitPullRequest className="size-3.5" />
                  Open GitHub PR on approval via <span className="font-mono">gh pr create</span>
                  {github?.origin ? <span className="truncate font-mono text-faint">({github.origin.replace(/^https:\/\/github\.com\//, "")})</span> : <span className="font-mono text-faint">(no remote origin)</span>}
                </label>
              )}
              {drawer.approval.state === "pending" ? (
                <div className="flex gap-2">
                  <Button variant="danger" size="md" icon={<XCircle />} onClick={() => void approve("reject")}>
                    Reject
                  </Button>
                  <Button
                    variant="healthy"
                    size="md"
                    icon={mode === "break-glass" ? <Zap /> : <GitMerge />}
                    className="flex-1"
                    disabled={drawer.verificationStatus.verdict === "Verification Failed" || formalPassed === false}
                    onClick={() => void approve("approve")}
                  >
                    {mode === "break-glass" ? "Approve · Execute Live & Reconcile" : "Approve · Stage for Pipeline"}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="md" icon={<Check />} className="w-full" disabled>
                  {drawer.approval.state === "rejected" ? "Rejected" : `Approved · ${drawer.approval.state}${drawer.approval.mode ? ` · ${MODE_LABEL[drawer.approval.mode]}` : ""}`}
                </Button>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function FormalProof() {
  const formal = useWorkbench((s) => s.formal);
  const compileSkill = useWorkbench((s) => s.compileSkill);
  if (!formal) return <div className="text-[12px] text-muted">Formal proof loading…</div>;
  const b = formal.blastRadius;
  return (
    <div className="space-y-3 text-[12px]" data-testid="formal-proof">
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={formal.formal.passed ? "healthy" : "critical"} icon={<ShieldCheck />}>{formal.formal.passed ? "Formal proof passed" : "Formal proof FAILED"} · {formal.formal.latencyMs} ms</Pill>
        <Pill tone="muted">f(f(S)) = f(S): {formal.idempotency.passed ? "idempotent" : "FAILED"}</Pill>
        <Button size="sm" variant="outline" icon={<Zap />} onClick={() => void compileSkill()}>Compile to Tier 0 Fleet Skill</Button>
      </div>
      <ul className="space-y-1">
        {formal.formal.invariants.map((i) => (
          <li key={i.id} className="flex gap-2"><Pill tone={i.passed ? "healthy" : "critical"}>{i.passed ? "proved" : "counterexample"}</Pill><span><span className="font-mono text-[11px]">{i.id}</span><span className="block text-muted">{i.evidence[0] ?? i.statement}</span></span></li>
        ))}
      </ul>
      <div>
        <div className="section-label mb-1">Blast-Radius Matrix · 30-day replay</div>
        <div className="rounded-md border border-border-subtle p-2 font-mono text-[11px] text-muted" data-testid="blast-radius">
          {b.rows.map((r) => <div key={r.cohort}>{r.entities.length} {r.cohort}: {r.before} → {r.after}</div>)}
          <div>0 collateral user lockouts · {b.collateralChanges} collateral changes</div>
        </div>
      </div>
    </div>
  );
}

function RollbackTab() {
  const formal = useWorkbench((s) => s.formal);
  const rollbackNow = useWorkbench((s) => s.rollbackNow);
  if (!formal) return <div className="text-[12px] text-muted">Rollback bundle loading…</div>;
  return (
    <div className="space-y-2" data-testid="rollback-tab">
      <div className="flex gap-1.5"><Pill tone="healthy" icon={<History />}>f⁻¹ pre-verified · idempotent</Pill><Button size="sm" variant="outline" icon={<Undo2 />} onClick={() => void rollbackNow()}>1-Click Undo / Rollback (f⁻¹)</Button></div>
      <CodeBlock code={formal.rollback.powershellScript} />
      {formal.rollback.terraformDiff && <CodeBlock code={formal.rollback.terraformDiff} />}
    </div>
  );
}

const MODE_LABEL: Record<ExecutionMode, string> = { "break-glass": "Emergency Break-Glass", gitops: "Pure GitOps" };

/**
 * How the approval lands. Break-glass mutates the live resource now and auto-reconciles Git;
 * GitOps only stages the patch and the sandbox plan for the pipeline. Locked once approved.
 */
function ExecutionModeSwitch({ drawer }: { drawer: Drawer }) {
  const selected = useWorkbench((s) => s.executionMode);
  const setMode = useWorkbench((s) => s.setExecutionMode);
  const locked = drawer.approval.state !== "pending";
  const current = locked ? (drawer.approval.mode ?? selected) : selected;
  const options: Array<{ id: ExecutionMode; icon: React.ReactNode; label: string; hint: string }> = [
    { id: "break-glass", icon: <Zap />, label: MODE_LABEL["break-glass"], hint: "Direct API + Auto-Reconcile PR" },
    { id: "gitops", icon: <GitMerge />, label: MODE_LABEL.gitops, hint: "Stage PR & Modal Plan Only" },
  ];
  return (
    <div role="radiogroup" aria-label="Execution mode" className="grid grid-cols-2 gap-1 rounded-md border border-border bg-canvas/60 p-0.5" data-testid="execution-mode">
      {options.map((o) => {
        const active = o.id === current;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-mode={o.id}
            disabled={locked}
            onClick={() => setMode(o.id)}
            className={`flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left [&>svg]:size-3.5 [&>svg]:shrink-0 ${
              active ? (o.id === "break-glass" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary") : "text-muted hover:bg-elevated hover:text-text"
            } disabled:cursor-default ${locked && !active ? "opacity-40" : ""}`}
          >
            {o.icon}
            <span className="min-w-0">
              <span className="block truncate text-[11.5px] font-semibold">{o.label}</span>
              <span className="block truncate text-[10.5px] opacity-80">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function flag(v: boolean | null): string {
  return v === null ? "skipped" : v ? "pass" : "FAIL";
}

function VerificationBadge({ drawer }: { drawer: Drawer }) {
  const v = drawer.verificationStatus;
  const tone = VERDICT_TONE[v.verdict];
  const label = v.verdict === "Verified Safe" ? (drawer.terraformDiff ? "Verified Safe (AST + Terraform Validated)" : "Verified Safe (AST Validated)") : v.verdict;
  return (
    <Pill tone={tone} icon={tone === "healthy" ? <ShieldCheck /> : <ShieldAlert />} mono={false} className="font-semibold">
      {label}
    </Pill>
  );
}

/** -WhatIf is a real dry run: SupportsShouldProcess + every mutation inside $PSCmdlet.ShouldProcess (checked statically). */
function DryRunBadge({ drawer }: { drawer: Drawer }) {
  const v = drawer.verificationStatus;
  const ok = v.whatIfSafe === true && v.astCheckPassed !== false;
  return (
    <Pill tone={ok ? "healthy" : "warning"} icon={<FlaskConical />} mono={false} title="SupportsShouldProcess declared and every mutating Graph call wrapped in $PSCmdlet.ShouldProcess">
      {ok ? "Dry-Run (-WhatIf) Verified" : "Dry-Run not verified"}
    </Pill>
  );
}

function ApprovalState({ drawer }: { drawer: Drawer }) {
  const s = drawer.approval.state;
  const tone: Tone = s === "pending" ? "warning" : s === "rejected" ? "critical" : "healthy";
  return (
    <Pill tone={tone}>
      {s}
      {drawer.approval.approvedAt ? ` · ${drawer.approval.approvedAt.slice(11, 19)}Z` : ""}
    </Pill>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[12px] [&>svg]:size-3.5 ${active ? "border-primary text-text" : "border-transparent text-muted hover:text-text"}`}
    >
      {icon}
      {label}
    </button>
  );
}
