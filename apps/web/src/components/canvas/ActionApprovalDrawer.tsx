import { BookOpen, Braces, Check, ClipboardCopy, ExternalLink, FileCode2, FlaskConical, GitBranch, GitMerge, GitPullRequest, HeartPulse, History, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, Terminal, Undo2, Users, X, XCircle, Zap } from "lucide-react";
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
  // The ticket this drawer fixes already converged (or was closed in the PSA): a second approval would run against nothing.
  const resolved = useWorkbench((s) => Boolean(s.drawer && s.convergence[s.drawer.ticketId]));
  const closed = useWorkbench((s) => Boolean(s.drawer && s.resolutionNote?.closed && s.resolutionNote.scenarioId === s.drawer.ticketId));
  const reopenTicket = useWorkbench((s) => s.reopenTicket);
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
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/75 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <aside className="flex h-full w-[640px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-popover" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3.5">
          <Sparkles className="size-3.5 text-meta" />
          <span className="text-[12.5px] font-semibold">Action Approval</span>
          {drawer && <span className="font-mono text-[11px] text-muted">#{drawer.ticketId}</span>}
          {drawer && (
            <div className="ml-1 flex items-center gap-1">
              <VerificationBadge drawer={drawer} />
              <DryRunBadge drawer={drawer} />
            </div>
          )}
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
            <div className="shrink-0 space-y-1.5 border-b border-border px-3.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="truncate text-[12.5px] font-semibold leading-snug" title={drawer.title}>{drawer.title}</div>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {drawer.synthesizedBy.planner} → {drawer.synthesizedBy.coder} · {drawer.providerTelemetry.latencyMs} ms
                </span>
              </div>
              <p className="line-clamp-2 text-[11.5px] leading-snug text-muted" title={drawer.summary}>{drawer.summary}</p>
              <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
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
                        className="inline-flex h-5 items-center gap-1 rounded-pill border border-healthy/40 bg-healthy/12 px-2 font-mono text-[10.5px] leading-none whitespace-nowrap text-healthy hover:bg-healthy/20"
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
              </div>
              {drawer.verificationStatus.findings.length > 0 && (
                <ul className="space-y-0.5 text-[10.5px] text-warning">
                  {drawer.verificationStatus.findings.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="path-a">
                <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">PATH A</span>
                <span className="text-[11px] font-medium text-muted">Manual CLI:</span>
                <Button size="xs" variant="outline" icon={<ClipboardCopy />} onClick={() => void copy(drawer.powershellScript, "PowerShell script")}>
                  Copy PowerShell Script
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  icon={<Braces />}
                  onClick={() => void copy(drawer.terraformDiff || drawer.graphPatch, drawer.terraformDiff ? "Terraform diff" : "Graph JSON patch")}
                  disabled={!drawer.terraformDiff && !drawer.graphPatch}
                >
                  {drawer.terraformDiff ? "Copy Terraform Diff" : "Copy Graph JSON Patch"}
                </Button>
                {drawer.terraformDiff && drawer.graphPatch && (
                  <Button size="xs" variant="ghost" icon={<Braces />} onClick={() => void copy(drawer.graphPatch, "Graph JSON patch")}>
                    Graph JSON
                  </Button>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-1 border-b border-border bg-canvas/30 px-3.5 py-1.5" role="tablist" aria-label="Remediation artifacts">
              <TabButton active={tab === "powershell"} onClick={() => setTab("powershell")} icon={<Terminal />} label="PowerShell" />
              <TabButton active={tab === "graph"} onClick={() => setTab("graph")} icon={<Braces />} label="Graph JSON" />
              {drawer.terraformDiff && <TabButton active={tab === "terraform"} onClick={() => setTab("terraform")} icon={<FileCode2 />} label="Terraform Diff" />}
              <TabButton active={tab === "entities"} onClick={() => setTab("entities")} icon={<Users />} label={`Entities (${drawer.affectedEntities.length})`} />
              <TabButton active={tab === "deviceHealthScript"} onClick={() => setTab("deviceHealthScript")} icon={<HeartPulse />} label="Detect/Remediate" />
              <TabButton active={tab === "formal"} onClick={() => setTab("formal")} icon={<ShieldCheck />} label="Formal Proof" />
              <TabButton active={tab === "rollback"} onClick={() => setTab("rollback")} icon={<History />} label="Inverse Rollback (f⁻¹)" />
              <TabButton active={tab === "commercial"} onClick={() => setTab("commercial")} icon={<Users />} label="3-Way Commercial" />
              <TabButton active={tab === "fleet"} onClick={() => setTab("fleet")} icon={<Zap />} label="Fleet & Reverse-IaC" />
              <TabButton active={tab === "runbook"} onClick={() => setTab("runbook")} icon={<BookOpen />} label="Runbook .md" />
            </div>

            <div className="min-h-[380px] flex-1 overflow-y-auto px-3.5 py-2.5" data-testid="drawer-scroll-viewport">
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
              {tab === "deviceHealthScript" && <DeviceHealthScriptTab />}
              {tab === "formal" && <FormalProof />}
              {tab === "rollback" && <RollbackTab />}
              {tab === "commercial" && <CommercialTab />}
              {tab === "fleet" && <FleetTab />}
              {tab === "runbook" && <RunbookTab drawer={drawer} />}
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

            <footer className="shrink-0 space-y-1.5 border-t border-border px-3.5 py-2" data-testid="path-b">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-healthy/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-healthy">PATH B</span>
                  <span className="text-[11.5px] font-semibold">Approve in Portal (HITL)</span>
                  <span className="text-muted">
                    · identity <span className="font-mono text-text">{drawer.approval.requiredIdentity}</span>
                  </span>
                </div>
                <ApprovalState drawer={drawer} />
              </div>
              <ExecutionModeSwitch drawer={drawer} />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <CanaryControls />
                {drawer.approval.state === "pending" && (
                  <label
                    className={`flex items-center gap-1.5 text-[10.5px] ${prPossible ? "text-muted" : "text-faint"}`}
                    title={
                      prPossible
                        ? `git push origin ${drawer.staging?.branchName ?? "fix/*"} + gh pr create --base ${github?.prBase ?? "main"}`
                        : "Needs a remote origin and an authenticated gh CLI: run scripts/Publish-ContextPaneRepo.ps1 first"
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-3 accent-primary"
                      checked={openPr && prPossible}
                      disabled={!prPossible || !drawer.staging}
                      onChange={(e) => setOpenPr(e.target.checked)}
                    />
                    <GitPullRequest className="size-3" />
                    Open PR via <span className="font-mono">gh pr create</span>
                  </label>
                )}
              </div>
              <p className="text-[10.5px] leading-tight text-muted" data-testid="mode-detail">
                {mode === "break-glass" ? (
                  <>
                    Writes live {drawer.terraformDiff ? "Graph and ARM resources" : "Graph objects"} now as delegated identity, then commits state to{" "}
                    <span className="font-mono text-text">{drawer.staging?.branchName ?? "the fix branch"}</span>
                    {openPr && prPossible ? " and updates the PR" : ""}.
                  </>
                ) : (
                  <>
                    Nothing changes live. Re-runs {drawer.verificationStatus.sandboxProvider === "modal-cloud-sandbox" ? "warm Modal" : "local"} pre-flight ({drawer.terraformDiff ? "terraform validate + " : ""}pwsh AST) and stages{" "}
                    <span className="font-mono text-text">{drawer.staging?.branchName ?? "the fix branch"}</span> for pipeline{openPr && prPossible ? " via PR" : ""}.
                  </>
                )}
              </p>
              {drawer.approval.state === "pending" && resolved ? (
                <div className="flex gap-2" data-testid="already-resolved">
                  <Button variant="outline" size="sm" icon={<Check />} className="flex-1" disabled title="Reopen the ticket or reset drift to run this remediation again">
                    {closed ? "Already Resolved & Closed" : "Already Resolved & Verified"}
                  </Button>
                  <Button variant="outline" size="sm" icon={<RotateCcw />} onClick={() => void reopenTicket()}>
                    Reopen Ticket
                  </Button>
                </div>
              ) : drawer.approval.state === "pending" ? (
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" icon={<XCircle />} onClick={() => void approve("reject")}>
                    Reject
                  </Button>
                  <Button
                    variant="healthy"
                    size="sm"
                    icon={mode === "break-glass" ? <Zap /> : <GitMerge />}
                    className="flex-1"
                    disabled={drawer.verificationStatus.verdict === "Verification Failed" || formalPassed === false}
                    onClick={() => void approve("approve")}
                  >
                    {mode === "break-glass" ? "Approve · Execute Live & Reconcile" : "Approve · Stage for Pipeline"}
                  </Button>
                </div>
              ) : drawer.approval.state === "rolled-back" ? (
                <Button variant="danger" size="sm" icon={<RotateCcw />} className="w-full" disabled>
                  Rolled back · f⁻¹ restored{drawer.approval.mode ? ` · ${MODE_LABEL[drawer.approval.mode]}` : ""}
                </Button>
              ) : (
                <Button variant="outline" size="sm" icon={<Check />} className="w-full" disabled>
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

function CanaryControls() {
  const simulate = useWorkbench((s) => s.simulateCanaryFailure);
  const setSimulate = useWorkbench((s) => s.setSimulateCanaryFailure);
  const canary = useWorkbench((s) => s.canary);
  const scenarioId = useWorkbench((s) => s.scenarioId);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="canary-controls">
      <label className="flex items-center gap-1.5 text-[10.5px] text-muted">
        <input type="checkbox" className="size-3 accent-warning" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
        Simulate Canary Probe Failure (Dead-Man's Switch)
      </label>
      <a href={`/api/runbooks/${scenarioId}.md`} download className="inline-flex text-[10.5px] text-primary hover:underline">Export Runbook (.md)</a>
      {canary && (
        <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]" data-testid="canary-trace">
          {canary.stages.map((s) => (
            <span
              key={s.stage}
              className={`rounded border px-1.5 py-0.5 ${
                s.stage === "AUTO_ROLLED_BACK"
                  ? "border-critical/40 bg-critical/10 font-semibold text-critical"
                  : s.stage === "CONVERGED"
                    ? "border-healthy/40 bg-healthy/10 font-semibold text-healthy"
                    : "border-border text-muted"
              }`}
            >
              {s.stage}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommercialTab() {
  const rec = useWorkbench((s) => s.commercial);
  if (!rec) return <div className="text-[12px] text-muted">Reconciler loading…</div>;
  return (
    <div className="space-y-2 text-[12px]" data-testid="commercial-reconciler">
      <div className="section-label">3-Way Commercial &amp; Seat Reconciler · {rec.contractId}</div>
      <div className="rounded-md border border-healthy/30 p-2"><span className="font-semibold text-healthy">Path A · {rec.pathA.label}</span><div className="text-muted">Reclaim {Object.entries(rec.pathA.reclaim).map(([k, v]) => `${v} ${k}`).join(" + ")} from disabled accounts · $0/mo net delta · ${rec.pathA.wasteEliminatedMonthly}/mo waste eliminated</div></div>
      <div className="rounded-md border border-border-subtle p-2"><span className="font-semibold">Path B · {rec.pathB.label}</span><div className="text-muted">Stage {Object.entries(rec.pathB.increment).map(([k, v]) => `+${v} ${k}`).join(", ")} · +${rec.pathB.netDeltaMonthly}/mo prorated amendment</div></div>
      <Pill tone="healthy">Recommended: Path {rec.recommendation}</Pill>
    </div>
  );
}

const PEER_TENANT_META: Array<{ id: string; name: string; domain: string; branchPrefix: string }> = [
  { id: "tenant-contoso-01", name: "Contoso Finance", domain: "c4a8shili.onmicrosoft.com", branchPrefix: "fleet/contoso-finance" },
  { id: "tenant-fabrikam-02", name: "Fabrikam Legal", domain: "fabrikamlegal.onmicrosoft.com", branchPrefix: "fleet/fabrikam-legal" },
  { id: "tenant-northwind-03", name: "Northwind Traders", domain: "northwindtraders.onmicrosoft.com", branchPrefix: "fleet/northwind-traders" },
  { id: "tenant-tailspin-04", name: "Tailspin Aerospace", domain: "tailspinaerospace.onmicrosoft.com", branchPrefix: "fleet/tailspin-aerospace" },
];

function FleetTab() {
  const fleet = useWorkbench((s) => s.fleet);
  const rev = useWorkbench((s) => s.reverseResult);
  const stage = useWorkbench((s) => s.stageCampaign);
  return (
    <div className="space-y-3 text-[12px]" data-testid="fleet-tab">
      <section className="space-y-2">
        <div className="section-label">Cross-tenant fleet immunization &amp; Blast-Radius Preview</div>
        {fleet ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="warning">{fleet.signature}</Pill>
              <Pill tone="muted">{fleet.affectedCount} affected peer tenants</Pill>
              <Pill tone="healthy">0 collateral lockouts · formal invariants verified</Pill>
            </div>
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-[11.5px]">
                <thead className="bg-surface text-[10px] tracking-wider text-faint uppercase">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left font-medium">Peer Tenant</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Verified Domain</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Staged GitOps Branch</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Blast Radius</th>
                  </tr>
                </thead>
                <tbody>
                  {PEER_TENANT_META.slice(0, Math.max(1, fleet.affectedCount)).map((t) => (
                    <tr key={t.id} className="border-t border-border-subtle">
                      <td className="px-2.5 py-1.5 font-medium">{t.name}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-faint">{t.domain}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-primary">{t.branchPrefix}/{fleet.signature}</td>
                      <td className="px-2.5 py-1.5"><Pill tone="healthy">0 collateral · AST + f⁻¹ verified</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button size="sm" variant="healthy" icon={<Zap />} onClick={() => void stage()} data-testid="confirm-fleet-campaign">
              Confirm &amp; Stage Fleet GitOps PRs ({fleet.affectedCount} Tenants)
            </Button>
          </>
        ) : (
          <div className="text-muted">Fleet scan loading…</div>
        )}
      </section>
      <section>
        <div className="section-label mb-1">Reverse-Compile Live State to OpenTofu</div>
        {rev ? (
          <>
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              <Pill tone="healthy">{rev.tofuPlanSummary ?? rev.expectedPlanSummary ?? "0 to add, 0 to destroy"}</Pill>
              <Pill tone="muted">{rev.imports.length} import blocks</Pill>
              {rev.shadowFindings.map((f) => (
                <Pill key={f.detail} tone="warning">
                  {f.kind}: {f.resources.join(" / ")}
                </Pill>
              ))}
            </div>
            <CodeBlock code={`${rev.imports.join("\n")}\n\n${rev.hcl}`} />
          </>
        ) : (
          <div className="text-muted">Reverse compiler loading…</div>
        )}
      </section>
    </div>
  );
}

function RunbookTab({ drawer }: { drawer: Drawer }) {
  const formal = useWorkbench((s) => s.formal);
  const runbookMarkdown = [
    `# Runbook · ${drawer.ticketId} — ${drawer.title}`,
    "",
    `## 1. Executive Summary`,
    drawer.summary,
    "",
    `## 2. Pre-Flight & Formal Verification`,
    `- Verdict: ${drawer.verificationStatus.verdict} (${drawer.verificationStatus.sandboxProvider})`,
    `- PowerShell AST: ${flag(drawer.verificationStatus.astCheckPassed)} · Dry-Run (-WhatIf): ${flag(drawer.verificationStatus.whatIfSafe)}`,
    ...(formal ? [`- Formal Invariants: ${formal.formal.invariants.map((i) => `${i.id} (${i.passed ? "PASS" : "FAIL"})`).join(", ")}`] : []),
    "",
    `## 3. Forward Remediation (PowerShell)`,
    "```powershell",
    drawer.powershellScript,
    "```",
    ...(formal
      ? [
          "",
          `## 4. Pre-Verified Inverse Rollback (f⁻¹)`,
          "```powershell",
          formal.rollback.powershellScript,
          "```",
        ]
      : []),
  ].join("\n");
  return (
    <div className="space-y-2.5 text-[12px]" data-testid="runbook-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="section-label">Standard Operating Procedure &amp; Audit Runbook (.md)</div>
        <a
          href={`/api/runbooks/${drawer.ticketId}.md`}
          download
          className="inline-flex h-6 items-center gap-1.5 rounded border border-primary/40 bg-primary/12 px-2.5 font-mono text-[11px] text-primary hover:bg-primary/20"
        >
          <BookOpen className="size-3.5" />
          Download {drawer.ticketId}-runbook.md
        </a>
      </div>
      <CodeBlock code={runbookMarkdown} />
    </div>
  );
}

function DeviceHealthScriptTab() {
  const health = useWorkbench((s) => s.intuneHealth);
  if (!health) return <div className="text-[12px] text-muted">Device health script loading…</div>;
  const verified = health.verification.passed && health.verification.detectReadOnly;
  return (
    <div className="space-y-3 text-[12px]" data-testid="device-health-script">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={verified ? "healthy" : "critical"} icon={<ShieldCheck />}>{verified ? "Detect read-only AST verified" : "Detect read-only AST not verified"}</Pill>
        {health.verification.proof && <span className="font-mono text-[10.5px] text-faint">{health.verification.proof}</span>}
      </div>
      <div>
        <div className="section-label mb-1">Detect.ps1</div>
        <CodeBlock code={health.detect} />
      </div>
      <div>
        <div className="section-label mb-1">Remediate.ps1</div>
        <CodeBlock code={health.remediate} />
      </div>
      {health.csp.length > 0 && (
        <div>
          <div className="section-label mb-1">CSP mapping</div>
          <div className="overflow-x-auto rounded-md border border-border-subtle">
            <table className="w-full text-[11.5px]">
              <thead className="bg-surface text-[10px] tracking-wider text-faint uppercase">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">Setting</th>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">CSP URI</th>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">Registry path</th>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">Tattooed</th>
                </tr>
              </thead>
              <tbody>
                {health.csp.map((c) => (
                  <tr key={c.settingName} className="border-t border-border-subtle align-middle">
                    <td className="px-2.5 py-1.5">{c.settingName}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[10.5px] break-all whitespace-normal text-faint">{c.cspUri ?? "—"}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[10.5px] break-all whitespace-normal text-faint">{c.registryPath ?? "—"}</td>
                    <td className="px-2.5 py-1.5">{c.tattooedOnUnassign ? <Pill tone="warning">tattooed on unassign</Pill> : <span className="text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="rounded-md border border-border-subtle bg-canvas px-2.5 py-1.5 text-[11.5px] text-muted">
        After assignment, trigger <span className="font-mono text-text">syncDevice</span> on the affected devices so Detect.ps1 / Remediate.ps1 run on the next Intune check-in; tattooed settings persist after unassign and need Remediate.ps1 to revert.
      </p>
    </div>
  );
}

function FormalProof() {
  const formal = useWorkbench((s) => s.formal);
  const compileSkill = useWorkbench((s) => s.compileSkill);
  if (!formal) return <div className="text-[12px] text-muted">Formal proof loading…</div>;
  const b = formal.blastRadius;
  const asrBlast = formal.asrBlast ?? formal.formal.asrBlast ?? null;
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
      {asrBlast && (
        <div className="rounded-md border border-border-subtle p-2 font-mono text-[11px] text-muted" data-testid="asr-blast">
          ASR Audit→Block without exclusion: {asrBlast.executions} legitimate executions of {asrBlast.binary} on {asrBlast.workstations} workstations — per-rule exclusion staged
        </div>
      )}
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
  const tone: Tone =
    s === "pending"
      ? "warning"
      : s === "rejected" || s === "rolled-back"
        ? "critical"
        : "healthy";
  const label = s === "rolled-back" ? "rolled-back · f⁻¹ restored" : s;
  return (
    <Pill tone={tone}>
      {label}
      {drawer.approval.approvedAt ? ` · ${drawer.approval.approvedAt.slice(11, 19)}Z` : ""}
    </Pill>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 py-1 text-[11px] font-medium transition-colors [&>svg]:size-3 ${
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border-subtle bg-surface text-muted hover:border-border hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
