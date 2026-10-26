import { Check, ExternalLink, FileCode2, GitBranch, GitPullRequest, Rocket, ShieldAlert, ShieldCheck, Sparkles, Terminal, Users, X, XCircle } from "lucide-react";
import { useState } from "react";
import type { ActionApprovalDrawer as Drawer } from "@contextpane/catalog";
import { PROVIDER_LABEL, fmtMs, shortSha } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Pill, type Tone } from "../ui/Pill";
import { DiffView } from "./DiffView";
import { ProgressRail } from "./ProgressRail";

type Tab = "powershell" | "terraform" | "entities";

const VERDICT_TONE: Record<Drawer["verificationStatus"]["verdict"], Tone> = {
  "Verified Safe": "healthy",
  "Verified With Warnings": "warning",
  "Verification Failed": "critical",
  Pending: "muted",
};

/** HITL remediation drawer — the only place anything can be executed from. */
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
  const [tab, setTab] = useState<Tab>("powershell");
  if (!open) return null;
  const prPossible = Boolean(github?.origin && github.ghAuthenticated);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-canvas/70" onClick={() => setOpen(false)}>
      <aside className="flex h-full w-[600px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-popover" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Sparkles className="size-4 text-meta" />
          <span className="text-[13px] font-semibold">Action Approval</span>
          <Pill tone="meta">Tier 3 · muse-wonder + muse-code</Pill>
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
                <Pill tone="muted" icon={<FileCode2 />}>
                  fmt {flag(drawer.verificationStatus.terraformFmtPassed)} · validate {flag(drawer.verificationStatus.terraformValidatePassed)}
                </Pill>
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

            <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-2">
              <TabButton active={tab === "powershell"} onClick={() => setTab("powershell")} icon={<Terminal />} label="PowerShell" />
              <TabButton active={tab === "terraform"} onClick={() => setTab("terraform")} icon={<FileCode2 />} label="Terraform diff" />
              <TabButton active={tab === "entities"} onClick={() => setTab("entities")} icon={<Users />} label={`Entities (${drawer.affectedEntities.length})`} />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "powershell" && <CodeBlock code={drawer.powershellScript} />}
              {tab === "terraform" && (
                <CodeBlock code={drawer.terraformDiff} render={(wrap) => <DiffView diff={drawer.terraformDiff} maxHeight="max-h-none" wrap={wrap} className="pt-8" />} />
              )}
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

            <footer className="shrink-0 space-y-2 border-t border-border p-4">
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
                    icon={<Rocket />}
                    className="flex-1"
                    disabled={drawer.verificationStatus.verdict === "Verification Failed"}
                    onClick={() => void approve("approve")}
                  >
                    Approve &amp; Execute via Delegated Identity
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="md" icon={<Check />} className="w-full" disabled>
                  {drawer.approval.state === "rejected" ? "Rejected" : `Approved · ${drawer.approval.state}`}
                </Button>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function flag(v: boolean | null): string {
  return v === null ? "skipped" : v ? "pass" : "FAIL";
}

function VerificationBadge({ drawer }: { drawer: Drawer }) {
  const v = drawer.verificationStatus;
  const tone = VERDICT_TONE[v.verdict];
  const label = v.verdict === "Verified Safe" ? "Verified Safe (AST + Terraform Validated)" : v.verdict;
  return (
    <Pill tone={tone} icon={tone === "healthy" ? <ShieldCheck /> : <ShieldAlert />} mono={false} className="font-semibold">
      {label}
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
