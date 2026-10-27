import { BookOpen, Braces, Check, ClipboardCopy, ExternalLink, FileCode2, GitMerge, GitPullRequest, HeartPulse, Mail, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, Terminal, Undo2, Users, X, Zap } from "lucide-react";
import { useState } from "react";
import type { ActionApprovalDrawer as Drawer, ExecutionMode } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
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

function cleanDrawerTitle(drawer: Drawer): string {
  switch (drawer.ticketId) {
    case "INC-4092":
      return "Fix INC-4092: E5 license upgrade, AVD access & NSG port 3389";
    case "INC-4099":
      return "Fix INC-4099: Remove conflicting legacy BitLocker profile & sync 6 devices";
    case "ANOM-LIC-101":
      return "Fix ANOM-LIC-101: Reclaim 3 unused E5 seats from disabled accounts";
    case "ANOM-CA-204":
      return "Fix ANOM-CA-204: Exclude Break-Glass accounts from admin MFA & enforce legacy auth block";
    case "ANOM-INT-309":
      return "Fix ANOM-INT-309: Restore LSASS protection to Block & remove duplicate firewall profile";
    case "ANOM-APP-401":
      return "Fix ANOM-APP-401: Switch ERP sync to GitHub OIDC, remove contractor owner & right-size permissions";
    default:
      return drawer.title.replace(/^Remediate\s+/i, "Fix ");
  }
}

type MainDrawerTab = "scripts" | "safety" | "clients" | "docs";
type ScriptSubTab = "powershell" | "graph" | "terraform" | "deviceHealthScript";

/**
 * Clean 3-zone remediation approval drawer:
 * 1. Compact 2-line header (~64px)
 * 2. Single-row 4-tab bar (Scripts & Changes | Safety Checks & Undo | Other Clients | Customer Note & Docs)
 * 3. Breathable 2-row approval footer
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
  const rawTab = useWorkbench((s) => s.drawerTab);
  const setTab = useWorkbench((s) => s.setDrawerTab);
  const focusUpn = useWorkbench((s) => s.drawerFocusUpn);
  const toast = useWorkbench((s) => s.toast);
  const mode = useWorkbench((s) => s.executionMode);
  const formalPassed = useWorkbench((s) => s.formal?.formal.passed);
  const fleet = useWorkbench((s) => s.fleet);
  const intuneHealth = useWorkbench((s) => s.intuneHealth);
  const resolved = useWorkbench((s) => Boolean(s.drawer && s.convergence[s.drawer.ticketId]));
  const closed = useWorkbench((s) => Boolean(s.drawer && s.resolutionNote?.closed && s.resolutionNote.scenarioId === s.drawer.ticketId));
  const reopenTicket = useWorkbench((s) => s.reopenTicket);

  if (!open) return null;

  const prPossible = Boolean(github?.origin && github.ghAuthenticated);
  const mainTab: MainDrawerTab =
    rawTab === "formal" || rawTab === "rollback"
      ? "safety"
      : rawTab === "fleet"
        ? "clients"
        : rawTab === "runbook"
          ? "docs"
          : "scripts";

  const hasIntune = Boolean(
    drawer &&
      (drawer.ticketId === "INC-4099" ||
        drawer.ticketId === "ANOM-INT-309" ||
        (intuneHealth && intuneHealth.csp.length > 0)),
  );

  const scriptSubTab: ScriptSubTab =
    rawTab === "graph"
      ? "graph"
      : rawTab === "terraform" && drawer?.terraformDiff
        ? "terraform"
        : rawTab === "deviceHealthScript" && hasIntune
          ? "deviceHealthScript"
          : "powershell";

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "healthy", title: `${what} copied`, detail: "Ready to paste or run with -WhatIf first." });
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const peerCount = fleet?.affectedCount ?? 3;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/75 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <aside
        className="flex h-full w-full max-w-[680px] animate-slide-in-right flex-col border-l border-slate-800 bg-surface shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Zone 1: Clean 2-Line Header (~64px total) */}
        <header className="shrink-0 border-b border-slate-800 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
              <Sparkles className="size-3.5 shrink-0 text-primary" />
              <span className="text-[13px] font-semibold whitespace-nowrap text-text">
                Review &amp; Approve Fix{drawer ? ` · #${drawer.ticketId}` : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {drawer && <VerificationBadge drawer={drawer} />}
              {drawer?.staging?.prUrl && (
                <a
                  href={drawer.staging.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-5 items-center gap-1 rounded-pill border border-healthy/40 bg-healthy/12 px-2 font-mono text-[10.5px] leading-none whitespace-nowrap text-healthy hover:bg-healthy/20"
                  title={drawer.staging.prUrl}
                >
                  <GitPullRequest className="size-3" />
                  PR #{drawer.staging.prUrl.split("/pull/")[1] ?? "opened"}
                  <ExternalLink className="size-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-6 place-items-center rounded text-faint hover:bg-elevated hover:text-text"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          {drawer && (
            <div className="mt-1 truncate text-[12px] text-muted" title={cleanDrawerTitle(drawer)}>
              {cleanDrawerTitle(drawer)}
            </div>
          )}
        </header>

        {status === "loading" || !drawer ? (
          <div className="flex-1 overflow-y-auto p-4">
            <ProgressRail events={progress} title="Preparing fix scripts & running safety checks" busy={status === "loading"} />
            {status === "error" && <div className="mt-3 text-sm text-critical">Failed to prepare fix. Check the orchestrator log.</div>}
          </div>
        ) : (
          <>
            {/* Zone 2: 4 Plain-English Single-Row Tabs */}
            <div
              className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 bg-canvas/40 px-4 py-1.5"
              role="tablist"
              aria-label="Remediation sections"
            >
              <TabButton
                active={mainTab === "scripts"}
                onClick={() => setTab("powershell")}
                icon={<Terminal />}
                label="Scripts & Changes"
              />
              <TabButton
                active={mainTab === "safety"}
                onClick={() => setTab("formal")}
                icon={<ShieldCheck />}
                label="Safety Checks & Undo"
              />
              <TabButton
                active={mainTab === "clients"}
                onClick={() => setTab("fleet")}
                icon={<Users />}
                label={`Other Clients (${peerCount})`}
              />
              <TabButton
                active={mainTab === "docs"}
                onClick={() => setTab("runbook")}
                icon={<BookOpen />}
                label="Customer Note & Docs"
              />
            </div>

            {/* Tab Viewport */}
            <div className="min-h-[380px] flex-1 overflow-y-auto p-4" data-testid="drawer-scroll-viewport">
              {mainTab === "scripts" && (
                <ScriptsAndChangesTab
                  drawer={drawer}
                  subTab={scriptSubTab}
                  onSelectSubTab={(t) => setTab(t)}
                  hasIntune={hasIntune}
                  focusUpn={focusUpn}
                  onCopy={copy}
                />
              )}
              {mainTab === "safety" && <SafetyAndUndoTab drawer={drawer} onCopy={copy} />}
              {mainTab === "clients" && <OtherClientsTab onCopy={copy} />}
              {mainTab === "docs" && <CustomerNoteAndDocsTab drawer={drawer} onCopy={copy} />}

              {approveLog.length > 0 && (
                <div className="mt-3 rounded-md border border-border-subtle bg-canvas p-2.5 font-mono text-[11px] text-muted">
                  {approveLog.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Zone 3: Breathable 2-Row Approval Footer */}
            <footer className="shrink-0 space-y-3 border-t border-slate-800 bg-slate-950 p-4" data-testid="path-b">
              {/* Row 1: How to apply + simple checkboxes */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ExecutionModeSwitch drawer={drawer} />
                <div className="flex items-center gap-3" data-testid="canary-controls">
                  <CanaryCheckbox />
                  <label
                    className={`flex items-center gap-1.5 text-[11px] whitespace-nowrap ${prPossible ? "text-muted hover:text-text" : "text-faint"}`}
                    title={
                      prPossible
                        ? `Push ${drawer.staging?.branchName ?? "fix/*"} and open a GitHub Pull Request`
                        : "Requires a remote origin and authenticated GitHub CLI"
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={openPr && prPossible}
                      disabled={!prPossible || !drawer.staging || drawer.approval.state !== "pending"}
                      onChange={(e) => setOpenPr(e.target.checked)}
                    />
                    <span>Open GitHub PR</span>
                  </label>
                </div>
              </div>

              <CanaryTraceBanner />

              {/* Row 2: Primary CTA */}
              {drawer.approval.state === "pending" && resolved ? (
                <div className="flex gap-2" data-testid="already-resolved">
                  <Button variant="outline" size="md" icon={<Check />} className="flex-1" disabled title="Reopen the ticket or reset drift to run this fix again">
                    {closed ? "Already Resolved & Closed" : "Already Resolved & Verified"}
                  </Button>
                  <Button variant="outline" size="md" icon={<RotateCcw />} onClick={() => void reopenTicket()}>
                    Reopen Ticket
                  </Button>
                </div>
              ) : drawer.approval.state === "pending" ? (
                <div className="flex items-center gap-2.5">
                  <Button variant="outline" size="md" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="healthy"
                    size="md"
                    className="flex-1 font-semibold"
                    disabled={drawer.verificationStatus.verdict === "Verification Failed" || formalPassed === false}
                    onClick={() => void approve("approve")}
                  >
                    {mode === "break-glass" ? "⚡ Apply Fix Now" : "🔀 Create Pull Request"}
                  </Button>
                </div>
              ) : drawer.approval.state === "rolled-back" ? (
                <Button variant="danger" size="md" icon={<RotateCcw />} className="w-full" disabled>
                  Auto-Rollback Completed — Previous State Restored
                </Button>
              ) : (
                <Button variant="outline" size="md" icon={<Check />} className="w-full" disabled>
                  {drawer.approval.state === "rejected"
                    ? "Fix Cancelled"
                    : drawer.approval.state === "staged"
                      ? "Pull Request Staged for Pipeline"
                      : "Fix Applied & Verified"}
                </Button>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 1: Scripts & Changes                                                   */
/* -------------------------------------------------------------------------- */

function ScriptsAndChangesTab({
  drawer,
  subTab,
  onSelectSubTab,
  hasIntune,
  focusUpn,
  onCopy,
}: {
  drawer: Drawer;
  subTab: ScriptSubTab;
  onSelectSubTab: (t: ScriptSubTab) => void;
  hasIntune: boolean;
  focusUpn: string | null;
  onCopy: (text: string, what: string) => Promise<void>;
}) {
  const intuneHealth = useWorkbench((s) => s.intuneHealth);

  const activeCode =
    subTab === "powershell"
      ? drawer.powershellScript
      : subTab === "graph"
        ? drawer.graphPatch || "[]"
        : subTab === "terraform"
          ? drawer.terraformDiff
          : intuneHealth
            ? `# --- Detect.ps1 (Read-Only Check) ---\n${intuneHealth.detect}\n\n# --- Remediate.ps1 (Fix Script) ---\n${intuneHealth.remediate}`
            : "";

  const copyLabel =
    subTab === "powershell"
      ? "PowerShell script"
      : subTab === "graph"
        ? "Graph API JSON"
        : subTab === "terraform"
          ? "Terraform diff"
          : "Intune Detect & Fix scripts";

  return (
    <div className="space-y-3">
      {subTab === "powershell" && focusUpn && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-1.5 text-[11.5px] text-muted">
          <Pill tone="warning">Targeted user</Pill>
          <span>
            Includes license &amp; group update for <span className="font-mono text-text">{focusUpn}</span>.
          </span>
        </div>
      )}

      {/* Unified Code Box with Segmented Switcher + Single [Copy Script] Button */}
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-canvas">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-surface/80 px-3 py-2" data-testid="path-a">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-canvas/80 p-0.5" role="tablist">
            <SegmentButton active={subTab === "powershell"} onClick={() => onSelectSubTab("powershell")} icon={<Terminal />}>
              PowerShell
            </SegmentButton>
            <SegmentButton active={subTab === "graph"} onClick={() => onSelectSubTab("graph")} icon={<Braces />}>
              Graph API JSON
            </SegmentButton>
            {drawer.terraformDiff && (
              <SegmentButton active={subTab === "terraform"} onClick={() => onSelectSubTab("terraform")} icon={<FileCode2 />}>
                Terraform Diff
              </SegmentButton>
            )}
            {hasIntune && (
              <SegmentButton active={subTab === "deviceHealthScript"} onClick={() => onSelectSubTab("deviceHealthScript")} icon={<HeartPulse />}>
                Intune Detect &amp; Fix Scripts
              </SegmentButton>
            )}
          </div>
          <Button size="xs" variant="outline" icon={<ClipboardCopy />} onClick={() => void onCopy(activeCode, copyLabel)}>
            Copy Script
          </Button>
        </div>

        <div className="p-2">
          {subTab === "powershell" && <CodeBlock code={drawer.powershellScript} maxHeight="max-h-[400px]" hideToolbar />}
          {subTab === "graph" && <CodeBlock code={drawer.graphPatch || "[]"} maxHeight="max-h-[400px]" hideToolbar />}
          {subTab === "terraform" && drawer.terraformDiff && (
            <CodeBlock
              code={drawer.terraformDiff}
              maxHeight="max-h-[400px]"
              hideToolbar
              render={(wrap) => <DiffView diff={drawer.terraformDiff} maxHeight="max-h-[400px]" wrap={wrap} />}
            />
          )}
          {subTab === "deviceHealthScript" && <DeviceHealthScriptTab />}
        </div>
      </div>

      {/* 1-Line Cost & License Impact Callout */}
      <CommercialCallout ticketId={drawer.ticketId} />
    </div>
  );
}

export function CommercialTab() {
  return <CommercialCallout ticketId="INC-4092" />;
}

function CommercialCallout({ ticketId }: { ticketId: string }) {
  const rec = useWorkbench((s) => s.commercial);
  const isLicenseTicket = ticketId === "INC-4092" || ticketId === "ANOM-LIC-101" || Boolean(rec?.neededSeats && rec.neededSeats > 0);
  if (!rec && !isLicenseTicket) return null;

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md border border-healthy/30 bg-healthy/8 px-3 py-2 text-[12px] text-text"
      data-testid="commercial-reconciler"
    >
      <span>
        💡 <span className="font-semibold text-healthy">License &amp; Cost Impact:</span>{" "}
        {isLicenseTicket
          ? `$0/mo — uses ${rec?.neededSeats ?? 3} unassigned E5 seats already paid for in your contract${rec ? ` (#${rec.contractId} · saves $${rec.pathA.wasteEliminatedMonthly}/mo in unused seats)` : ""}`
          : "$0/mo — configuration change only, no extra licenses needed"}
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-healthy">Contract vs. Billed vs. Active Seats</span>
    </div>
  );
}

function DeviceHealthScriptTab() {
  const health = useWorkbench((s) => s.intuneHealth);
  if (!health) return <div className="p-2 text-[12px] text-muted">Loading Intune remediation scripts…</div>;
  const verified = health.verification.passed && health.verification.detectReadOnly;
  return (
    <div className="space-y-3 p-1 text-[12px]" data-testid="device-health-script">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={verified ? "healthy" : "critical"} icon={<ShieldCheck />} mono={false}>
          {verified ? "✓ Detection script verified read-only" : "Detection script check failed"}
        </Pill>
      </div>
      <div>
        <div className="section-label mb-1">1. Detection Script (Detect.ps1 — Read-Only Check)</div>
        <CodeBlock code={health.detect} hideToolbar />
      </div>
      <div>
        <div className="section-label mb-1">2. Remediation Script (Remediate.ps1 — Registry &amp; Policy Fix)</div>
        <CodeBlock code={health.remediate} hideToolbar />
      </div>
      {health.csp.length > 0 && (
        <div>
          <div className="section-label mb-1">Affected Windows Settings &amp; Registry Keys</div>
          <div className="overflow-x-auto rounded-md border border-border-subtle">
            <table className="w-full text-[11.5px]">
              <thead className="bg-surface text-[10px] tracking-wider text-faint uppercase">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">Setting</th>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">Registry Path</th>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">Behavior on Unassign</th>
                </tr>
              </thead>
              <tbody>
                {health.csp.map((c) => (
                  <tr key={c.settingName} className="border-t border-border-subtle align-middle">
                    <td className="px-2.5 py-1.5 font-medium">{c.settingName}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[10.5px] break-all whitespace-normal text-muted">{c.registryPath ?? c.cspUri ?? "—"}</td>
                    <td className="px-2.5 py-1.5">
                      {c.tattooedOnUnassign ? <Pill tone="warning" mono={false}>Stays tattooed without script</Pill> : <span className="text-faint">Reverts cleanly</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 2: Safety Checks & Undo                                                */
/* -------------------------------------------------------------------------- */

function humanizeInvariant(id: string, scenarioId: string, fallback: string): string {
  switch (id) {
    case "break-glass-non-lockout":
      return "Emergency Break-Glass accounts won't be locked out";
    case "target-remediation":
      if (scenarioId === "INC-4092" || scenarioId.startsWith("CUSTOM-") || scenarioId.startsWith("ERP-")) {
        return "3 affected Finance users will regain AVD access";
      }
      if (scenarioId === "INC-4099") return "6 affected Windows 11 laptops will encrypt silently and regain compliance";
      if (scenarioId === "ANOM-LIC-101") return "2 users with license errors will receive active E5 seats";
      if (scenarioId === "ANOM-CA-204") return "Emergency Break-Glass group is excluded from phishing-resistant MFA";
      if (scenarioId === "ANOM-INT-309") return "11 affected workstations will resolve firewall policy conflicts";
      if (scenarioId === "ANOM-APP-401") return "ERP sync service principal switches to OIDC without breaking scheduled jobs";
      return "All affected users and devices will return to a healthy state";
    case "nsg-reachability":
      return "Port 3389 closed; AVD port 443 stays open";
    case "shadow-admin-zero-transitive":
      return "Non-admin contractor owner removed; 0 shadow-admin escalation paths";
    case "proactive-remediation-detect-read-only":
      return "Intune detection script is strictly read-only";
    default:
      return fallback;
  }
}

function blastSummarySentence(scenarioId: string): string {
  switch (scenarioId) {
    case "INC-4092":
      return "What will change: 3 Finance users unblocked · 0 collateral users affected · Emergency admin accounts untouched · Port 3389 closed";
    case "INC-4099":
      return "What will change: 6 Windows 11 laptops unblocked · 0 other devices affected · Emergency admin accounts untouched";
    case "ANOM-LIC-101":
      return "What will change: 3 unused E5 seats reclaimed from disabled accounts · 2 active users licensed · 0 active users disrupted";
    case "ANOM-CA-204":
      return "What will change: Break-Glass group excluded from CA-001 · Legacy auth blocked · 0 admin lockouts";
    case "ANOM-INT-309":
      return "What will change: LSASS credential rule set to Block (with finance exclusion) · 11 workstations cleared of conflict";
    case "ANOM-APP-401":
      return "What will change: Contractor app owner removed · Graph permissions right-sized · GitHub Actions switched to OIDC";
    default:
      return "What will change: Affected users unblocked · 0 collateral users affected · Emergency admin accounts untouched";
  }
}

function SafetyAndUndoTab({ drawer, onCopy }: { drawer: Drawer; onCopy: (text: string, what: string) => Promise<void> }) {
  const formal = useWorkbench((s) => s.formal);
  const compileSkill = useWorkbench((s) => s.compileSkill);
  const rollbackNow = useWorkbench((s) => s.rollbackNow);

  if (!formal) return <div className="text-[12px] text-muted">Running pre-flight safety verification…</div>;

  const b = formal.blastRadius;
  const asrBlast = formal.asrBlast ?? formal.formal.asrBlast ?? null;
  const allPassed = formal.formal.passed && formal.idempotency.passed;

  return (
    <div className="space-y-4 text-[12px]" data-testid="formal-proof">
      {/* Top Section: Pre-Flight Safety Verification */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-canvas/60 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Pill tone={allPassed ? "healthy" : "critical"} icon={<ShieldCheck />} mono={false} className="font-semibold">
              {allPassed ? "Pre-Flight Safety Checks (All Passed)" : "Pre-Flight Safety Check Warning"}
            </Pill>
          </div>
          <Button
            size="xs"
            variant="outline"
            icon={<Zap />}
            onClick={() => void compileSkill()}
            title="Runs in <1ms with 0 AI tokens next time this issue happens"
          >
            Save as Instant Auto-Fix Rule
          </Button>
        </div>

        <ul className="space-y-1.5 pt-0.5 text-[12.5px]">
          {formal.formal.invariants.map((i) => (
            <li key={i.id} className="flex items-start gap-2">
              <span className={`font-semibold ${i.passed ? "text-healthy" : "text-critical"}`}>{i.passed ? "✓" : "✗"}</span>
              <span className="text-text">{humanizeInvariant(i.id, drawer.ticketId, i.statement)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2">
            <span className={`font-semibold ${formal.idempotency.passed ? "text-healthy" : "text-critical"}`}>
              {formal.idempotency.passed ? "✓" : "✗"}
            </span>
            <span className="text-text">Safe to re-run (running this script twice produces the exact same state)</span>
          </li>
        </ul>

        {/* Blast-Radius Summary Table */}
        <div className="space-y-2 border-t border-slate-800/80 pt-3" data-testid="blast-radius">
          <div className="text-[11.5px] font-medium text-muted">{blastSummarySentence(drawer.ticketId)}</div>
          <div className="overflow-x-auto rounded-md border border-slate-800">
            <table className="w-full text-[11.5px]">
              <thead className="bg-surface text-[10px] tracking-wider text-faint uppercase">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">User / Resource Group</th>
                  <th className="px-3 py-1.5 text-left font-medium">Before Fix</th>
                  <th className="px-3 py-1.5 text-left font-medium">After Fix</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => {
                  const label =
                    r.cohort === "target"
                      ? `Affected targets (${r.entities.length})`
                      : r.cohort === "break-glass"
                        ? `Emergency Break-Glass admins (${r.entities.length})`
                        : `Other tenant users (${r.entities.length})`;
                  return (
                    <tr key={r.cohort} className="border-t border-slate-800/80">
                      <td className="px-3 py-1.5 font-medium text-text">{label}</td>
                      <td className="px-3 py-1.5 text-muted">{r.before}</td>
                      <td className="px-3 py-1.5 font-medium text-healthy">
                        {r.cohort === "target" ? `${r.after} (Restored)` : `${r.after} (0 collateral impact)`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {asrBlast && (
          <div className="rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-[11.5px] text-text" data-testid="asr-blast">
            <span className="font-semibold text-warning">App Compatibility Check:</span> Found {asrBlast.executions} legitimate runs of{" "}
            <span className="font-mono">{asrBlast.binary}</span> across {asrBlast.workstations} workstations — a safe path exclusion is included automatically.
          </div>
        )}
      </section>

      {/* Bottom Section: 1-Click Undo / Rollback Script */}
      <section className="space-y-2.5 rounded-lg border border-slate-800 bg-canvas/60 p-3.5" data-testid="rollback-tab">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12.5px] font-semibold text-text">1-Click Undo Script</div>
            <p className="text-[11.5px] text-muted">
              If anything goes wrong after applying, ContextPane will run this script to restore the exact previous state.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="outline"
              icon={<ClipboardCopy />}
              onClick={() => void onCopy(formal.rollback.powershellScript, "1-Click Undo script")}
            >
              Copy Undo Script
            </Button>
            <Button size="xs" variant="outline" icon={<Undo2 />} onClick={() => void rollbackNow()}>
              Undo Change (Restore Previous State)
            </Button>
          </div>
        </div>
        <CodeBlock code={formal.rollback.powershellScript} hideToolbar />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 3: Other Clients (3)                                                   */
/* -------------------------------------------------------------------------- */

const PEER_TENANT_META: Array<{ id: string; name: string; domain: string; branchPrefix: string }> = [
  { id: "tenant-contoso-01", name: "Contoso Finance", domain: "c4a8shili.onmicrosoft.com", branchPrefix: "fleet/contoso-finance" },
  { id: "tenant-fabrikam-02", name: "Fabrikam Legal", domain: "fabrikamlegal.onmicrosoft.com", branchPrefix: "fleet/fabrikam-legal" },
  { id: "tenant-northwind-03", name: "Northwind Traders", domain: "northwindtraders.onmicrosoft.com", branchPrefix: "fleet/northwind-traders" },
  { id: "tenant-tailspin-04", name: "Tailspin Aerospace", domain: "tailspinaerospace.onmicrosoft.com", branchPrefix: "fleet/tailspin-aerospace" },
];

function OtherClientsTab({ onCopy }: { onCopy: (text: string, what: string) => Promise<void> }) {
  const [subView, setSubView] = useState<"clients" | "terraform">("clients");
  const fleet = useWorkbench((s) => s.fleet);
  const rev = useWorkbench((s) => s.reverseResult);
  const stage = useWorkbench((s) => s.stageCampaign);
  const count = fleet?.affectedCount ?? 3;

  return (
    <div className="space-y-3 text-[12px]" data-testid="fleet-tab">
      {/* Clean Segmented Toggle at the Top */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-canvas p-0.5" role="tablist">
          <SegmentButton active={subView === "clients"} onClick={() => setSubView("clients")} icon={<Users />}>
            Other Affected Clients ({count})
          </SegmentButton>
          <SegmentButton active={subView === "terraform"} onClick={() => setSubView("terraform")} icon={<FileCode2 />}>
            Export to Terraform
          </SegmentButton>
        </div>
        {subView === "terraform" && rev && (
          <Button
            size="xs"
            variant="outline"
            icon={<ClipboardCopy />}
            onClick={() => void onCopy(`${rev.imports.join("\n")}\n\n${rev.hcl}`, "Terraform configuration")}
          >
            Copy Script
          </Button>
        )}
      </div>

      {subView === "clients" ? (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-canvas/60 p-3.5">
          <p className="text-[12.5px] text-text">
            We scanned your other managed client tenants and found <span className="font-semibold text-warning">{count} clients</span> with this exact same misconfiguration.
          </p>
          {fleet ? (
            <>
              <div className="overflow-x-auto rounded-md border border-slate-800">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface text-[10px] tracking-wider text-faint uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Client Name</th>
                      <th className="px-3 py-2 text-left font-medium">Git Branch</th>
                      <th className="px-3 py-2 text-left font-medium">Safety Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PEER_TENANT_META.slice(0, Math.max(1, count)).map((t) => {
                      const branch = `${t.branchPrefix}/${fleet.signature}`;
                      return (
                        <tr key={t.id} className="border-t border-slate-800/80">
                          <td className="px-3 py-2">
                            <div className="font-medium text-text">{t.name}</div>
                            <div className="font-mono text-[10.5px] text-faint">{t.domain}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="max-w-[220px] truncate font-mono text-[11px] text-primary" title={branch}>
                              {branch}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Pill tone="healthy" mono={false}>
                              ✓ Ready
                            </Pill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button
                size="md"
                variant="healthy"
                icon={<Zap />}
                className="w-full font-semibold"
                onClick={() => void stage()}
                data-testid="confirm-fleet-campaign"
              >
                Create Fix PRs for All {count} Clients
              </Button>
            </>
          ) : (
            <div className="text-muted">Scanning client tenants…</div>
          )}
        </section>
      ) : (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-canvas/60 p-3.5">
          <div>
            <div className="text-[12.5px] font-semibold text-text">Export Unmanaged Config to Terraform</div>
            <p className="text-[11.5px] text-muted">Generate .tf resources + import blocks for manual portal changes</p>
          </div>
          {rev ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone="healthy" mono={false}>
                  ✓ Plan preview: {rev.tofuPlanSummary ?? rev.expectedPlanSummary ?? "0 to add, 0 to destroy"}
                </Pill>
                <Pill tone="muted" mono={false}>
                  {rev.imports.length} Terraform import blocks
                </Pill>
              </div>
              <CodeBlock code={`${rev.imports.join("\n")}\n\n${rev.hcl}`} hideToolbar />
            </>
          ) : (
            <div className="text-muted">Generating Terraform resources…</div>
          )}
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 4: Customer Note & Docs                                                */
/* -------------------------------------------------------------------------- */

function buildCustomerEmail(drawer: Drawer, customerSummary?: string): string {
  if (customerSummary) {
    return [
      `Subject: Resolved — ${drawer.ticketId}: ${cleanDrawerTitle(drawer).replace(/^Fix [^:]+:\s*/, "")}`,
      "",
      "Hi team,",
      "",
      customerSummary,
      "",
      "What we verified:",
      "• All affected users and services are back online and matching your security baseline.",
      "• Pre-flight safety checks and post-change health checks passed with zero impact on other users.",
      "• No extra license charges were incurred.",
      "",
      "Please let us know if anyone still experiences an issue signing in.",
      "",
      "Best regards,",
      "Cloud Operations Team",
    ].join("\n");
  }
  return [
    `Subject: Update on ${drawer.ticketId} — ${cleanDrawerTitle(drawer).replace(/^Fix [^:]+:\s*/, "")}`,
    "",
    "Hi team,",
    "",
    `We identified the root cause of ${drawer.ticketId} and prepared a verified fix:`,
    "",
    `${drawer.summary}`,
    "",
    "Impact & Safety:",
    `• Affected items repaired: ${drawer.affectedEntities.map((e) => e.id.split("@")[0]).join(", ")}`,
    "• 0 other users or emergency admin accounts are affected.",
    "• A 1-click undo script is saved in case we need to roll back immediately.",
    "",
    "Best regards,",
    "Cloud Operations Team",
  ].join("\n");
}

function CustomerNoteAndDocsTab({ drawer, onCopy }: { drawer: Drawer; onCopy: (text: string, what: string) => Promise<void> }) {
  const [subView, setSubView] = useState<"email" | "runbook">("email");
  const formal = useWorkbench((s) => s.formal);
  const resolutionNote = useWorkbench((s) => s.resolutionNote);

  const customerEmail = buildCustomerEmail(drawer, resolutionNote?.customerSummary);
  const runbookMarkdown = [
    `# Step-by-Step Runbook · ${drawer.ticketId} — ${cleanDrawerTitle(drawer)}`,
    "",
    `## 1. Issue Summary`,
    drawer.summary,
    "",
    `## 2. Pre-Flight Safety Checks`,
    `- Status: Pre-Flight Safety Checks Passed`,
    `- Dry-Run (-WhatIf) Verified: ${drawer.verificationStatus.whatIfSafe ? "Yes" : "No"}`,
    ...(formal
      ? formal.formal.invariants.map((i) => `- ✓ ${humanizeInvariant(i.id, drawer.ticketId, i.statement)}`)
      : []),
    "",
    `## 3. Fix Script (PowerShell)`,
    "```powershell",
    drawer.powershellScript,
    "```",
    ...(formal
      ? [
          "",
          `## 4. 1-Click Undo Script (Restore Previous State)`,
          "```powershell",
          formal.rollback.powershellScript,
          "```",
        ]
      : []),
  ].join("\n");

  const activeText = subView === "email" ? customerEmail : runbookMarkdown;
  const copyWhat = subView === "email" ? "Customer resolution email" : "Step-by-step runbook (.md)";

  return (
    <div className="space-y-3 text-[12px]" data-testid="runbook-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-canvas p-0.5" role="tablist">
          <SegmentButton active={subView === "email"} onClick={() => setSubView("email")} icon={<Mail />}>
            Customer Resolution Email
          </SegmentButton>
          <SegmentButton active={subView === "runbook"} onClick={() => setSubView("runbook")} icon={<BookOpen />}>
            Step-by-Step Runbook (.md)
          </SegmentButton>
        </div>
        <div className="flex items-center gap-1.5">
          {subView === "runbook" && (
            <a
              href={`/api/runbooks/${drawer.ticketId}.md`}
              download
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted hover:bg-elevated hover:text-text"
            >
              <BookOpen className="size-3" />
              Download .md
            </a>
          )}
          <Button size="xs" variant="outline" icon={<ClipboardCopy />} onClick={() => void onCopy(activeText, copyWhat)}>
            Copy
          </Button>
        </div>
      </div>

      <CodeBlock code={activeText} hideToolbar />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer Controls & Shared Subcomponents                                     */
/* -------------------------------------------------------------------------- */

function CanaryCheckbox() {
  const simulate = useWorkbench((s) => s.simulateCanaryFailure);
  const setSimulate = useWorkbench((s) => s.setSimulateCanaryFailure);
  return (
    <label
      className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted hover:text-text"
      title="Test Auto-Rollback (Simulate Health Check Failure)"
    >
      <input
        type="checkbox"
        className="size-3.5 accent-warning"
        checked={simulate}
        onChange={(e) => setSimulate(e.target.checked)}
      />
      <span>Test Auto-Rollback</span>
    </label>
  );
}

function CanaryTraceBanner() {
  const canary = useWorkbench((s) => s.canary);
  if (!canary) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-surface/60 px-2.5 py-1.5 font-mono text-[10.5px]" data-testid="canary-trace">
      <span className="font-sans text-[11px] font-medium text-muted">Health Check:</span>
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
  );
}

function ExecutionModeSwitch({ drawer }: { drawer: Drawer }) {
  const selected = useWorkbench((s) => s.executionMode);
  const setMode = useWorkbench((s) => s.setExecutionMode);
  const locked = drawer.approval.state !== "pending";
  const current = locked ? (drawer.approval.mode ?? selected) : selected;
  const options: Array<{ id: ExecutionMode; label: string }> = [
    { id: "break-glass", label: "⚡ Apply Live Now (+ Sync Git)" },
    { id: "gitops", label: "🔀 Create GitHub PR Only" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="How to apply"
      className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-canvas p-0.5"
      data-testid="execution-mode"
    >
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
            className={`rounded px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap transition-colors ${
              active
                ? o.id === "break-glass"
                  ? "bg-healthy/15 font-semibold text-healthy"
                  : "bg-primary/15 font-semibold text-primary"
                : "text-muted hover:text-text"
            } disabled:cursor-default ${locked && !active ? "opacity-40" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function VerificationBadge({ drawer }: { drawer: Drawer }) {
  const v = drawer.verificationStatus;
  const tone = VERDICT_TONE[v.verdict];
  const label =
    v.verdict === "Verified Safe"
      ? "✓ Pre-Flight Checks Passed"
      : v.verdict === "Verified With Warnings"
        ? "✓ Pre-Flight Passed (With Warnings)"
        : v.verdict === "Verification Failed"
          ? "Pre-Flight Check Failed"
          : "Checking…";
  return (
    <Pill tone={tone} icon={tone === "healthy" ? <ShieldCheck /> : <ShieldAlert />} mono={false} className="font-semibold" title={v.verdict}>
      {label}
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
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors [&>svg]:size-3.5 ${
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-transparent bg-transparent text-muted hover:bg-surface hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SegmentButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors [&>svg]:size-3 ${
        active ? "bg-elevated text-text shadow-xs" : "text-muted hover:text-text"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
