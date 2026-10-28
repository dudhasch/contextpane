import { ExternalLink, GitPullRequest, Lightbulb, RotateCcw, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { ExecutionMode } from "@contextpane/catalog";
import { useWorkbench, type CodeRailTab } from "@/store";
import { SmartTechPath } from "../../canvas/Section";
import { DiffView } from "../../canvas/DiffView";
import { Pill } from "../../ui/Pill";
import { ScriptCode } from "./ScriptCode";
import { cleanDrawerTitle, useHasIntune, type Drawer } from "./shared";

const TAB_NAME: Record<CodeRailTab, string> = {
  powershell: "PowerShell",
  opentofu: "OpenTofu diff",
  graph: "Graph API JSON",
  devicehealth: "Intune detect & fix scripts",
};

/** Rail `staging` body: what the fix does, how it applies, and the script of the active tab, full-bleed. */
export function ScriptsTab({ drawer }: { drawer: Drawer }) {
  const rawTab = useWorkbench((s) => s.codeRailTab);
  const focusUpn = useWorkbench((s) => s.drawerFocusUpn);
  const focusBanner = useWorkbench((s) => s.drawerFocusBanner);
  const approveLog = useWorkbench((s) => s.approveLog);
  const resolved = useWorkbench((s) => Boolean(s.convergence[drawer.ticketId]));
  const closed = useWorkbench((s) => Boolean(s.resolutionNote?.closed && s.resolutionNote.scenarioId === drawer.ticketId));
  const reopenTicket = useWorkbench((s) => s.reopenTicket);
  const hasIntune = useHasIntune();
  const tab: CodeRailTab = rawTab === "devicehealth" && !hasIntune ? "powershell" : rawTab;
  const prUrl = drawer.staging?.prUrl;

  return (
    <div className="flex flex-col pb-3">
      <div className="space-y-1.5 px-3 pt-2.5 pb-2.5">
        {focusBanner && (
          <p className="flex min-w-0 items-baseline gap-1.5 text-11" data-testid="drawer-focus-banner">
            <span aria-hidden className="text-signal">
              ✦
            </span>
            <span className="min-w-0 truncate font-medium text-signal">{focusBanner}</span>
            <span className="shrink-0 font-mono text-faint">· {TAB_NAME[tab]}</span>
          </p>
        )}
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="min-w-0 flex-1 text-13 font-medium text-text" title={cleanDrawerTitle(drawer)}>
            {cleanDrawerTitle(drawer)}
          </h2>
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noreferrer" title={prUrl} className="inline-flex shrink-0 items-center gap-1 font-mono text-11 text-signal hover:underline">
              <GitPullRequest className="size-3" aria-hidden />
              PR #{prUrl.split("/pull/")[1] ?? "opened"}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
        <p className="text-12 text-muted">{drawer.summary}</p>
        {tab === "powershell" && focusUpn && (
          <p className="text-12 text-muted">
            <span className="text-warning">Targeted user</span> · includes the license &amp; group update for <span className="font-mono text-text">{focusUpn}</span>
          </p>
        )}
        {drawer.approval.state === "pending" && resolved && (
          <p className="flex items-center gap-2 text-12" data-testid="already-resolved">
            <Pill variant="status" tone="healthy" mono={false}>
              {closed ? "Already resolved & closed" : "Already resolved & verified"}
            </Pill>
            <button type="button" onClick={() => void reopenTicket()} className="inline-flex items-center gap-1 text-11 text-muted hover:text-text">
              <RotateCcw className="size-3" aria-hidden />
              Reopen ticket
            </button>
          </p>
        )}
        <ExecutionModeSwitch drawer={drawer} />
      </div>

      <div data-testid="path-a">
        {tab === "powershell" && <ScriptCode code={drawer.powershellScript} name={`${drawer.ticketId.toLowerCase()}-fix.ps1 · PowerShell 7`} />}
        {tab === "graph" && <ScriptCode code={drawer.graphPatch || "[]"} name="graph-patch.json · Microsoft Graph" />}
        {tab === "opentofu" &&
          (drawer.terraformDiff ? (
            <ScriptCode
              code={drawer.terraformDiff}
              name="main.tf · OpenTofu plan diff"
              render={(wrap) => <DiffView diff={drawer.terraformDiff} maxHeight="" wrap={wrap} edges="b" />}
            />
          ) : (
            <p className="border-y border-hairline px-3 py-2 text-12 text-muted">This fix changes no OpenTofu-managed resource.</p>
          ))}
        {tab === "devicehealth" && <DeviceHealthScript />}
      </div>

      <CommercialCallout ticketId={drawer.ticketId} />

      {approveLog.length > 0 && (
        <section className="mx-3 mt-3 border-t border-hairline pt-2">
          <div className="section-label text-faint">Last run</div>
          <div className="mt-1 space-y-0.5 font-mono text-11 break-words text-muted">
            {approveLog.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One row of text toggles: apply live now or stage a PR only, plus the audit-PR box in break-glass mode. */
function ExecutionModeSwitch({ drawer }: { drawer: Drawer }) {
  const selected = useWorkbench((s) => s.executionMode);
  const setMode = useWorkbench((s) => s.setExecutionMode);
  const openPr = useWorkbench((s) => s.openPrOnApprove);
  const setOpenPr = useWorkbench((s) => s.setOpenPrOnApprove);
  const github = useWorkbench((s) => s.health?.github);
  const prPossible = Boolean(github?.origin && github.ghAuthenticated);
  const locked = drawer.approval.state !== "pending" && drawer.approval.state !== "rolled-back";
  const current = locked ? (drawer.approval.mode ?? selected) : selected;
  const options: Array<{ id: ExecutionMode; label: string; icon: ReactNode }> = [
    { id: "break-glass", label: "Apply live now", icon: <Zap className="size-3" aria-hidden="true" /> },
    { id: "gitops", label: "Stage PR only", icon: <GitPullRequest className="size-3" aria-hidden="true" /> },
  ];
  return (
    <div className="flex min-w-0 items-center gap-3 pt-0.5">
      <div role="radiogroup" aria-label="How to apply" className="flex items-center gap-3" data-testid="execution-mode">
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
              className={`relative inline-flex h-6 items-center gap-1 text-12 whitespace-nowrap transition-colors duration-120 disabled:cursor-default ${
                active ? "font-medium text-text" : "text-muted hover:text-text"
              } ${locked && !active ? "opacity-40" : ""}`}
            >
              {o.icon}
              {o.label}
              {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
            </button>
          );
        })}
      </div>
      {current === "break-glass" && (
        <label
          className={`ml-auto inline-flex shrink-0 items-center gap-1.5 text-11 whitespace-nowrap ${prPossible ? "text-muted hover:text-text" : "text-faint"}`}
          title={
            prPossible
              ? `Commit changes to ${drawer.staging?.branchName ?? "fix/*"} and open an audit GitHub Pull Request alongside live execution`
              : "Local Git branch staged; remote GitHub PR requires an authenticated GitHub CLI origin"
          }
        >
          <input
            type="checkbox"
            className="size-3 accent-[var(--signal)]"
            checked={openPr && prPossible}
            disabled={!prPossible || !drawer.staging || drawer.approval.state !== "pending"}
            onChange={(e) => setOpenPr(e.target.checked)}
          />
          Sync audit PR
        </label>
      )}
    </div>
  );
}

export function CommercialCallout({ ticketId }: { ticketId: string }) {
  const rec = useWorkbench((s) => s.commercial);
  const isCustomTicket = ticketId.startsWith("CUSTOM-");
  const isLicenseTicket = !isCustomTicket && (ticketId === "INC-4092" || ticketId === "ANOM-LIC-101" || Boolean(rec?.neededSeats && rec.neededSeats > 0));
  if (!rec && !isLicenseTicket) return null;
  return (
    <section className="mx-3 mt-3 border-t border-hairline pt-2 text-12" data-testid="commercial-reconciler">
      <p className="text-text">
        <Lightbulb className="mr-1 inline size-3.5 align-[-2px] text-healthy" aria-hidden="true" />
        <span className="font-medium text-healthy">License &amp; cost impact</span>{" "}
        {isLicenseTicket
          ? `$0/mo: uses ${rec?.neededSeats ?? 3} unassigned E5 seats already paid for in your contract${rec ? ` (#${rec.contractId} · saves $${rec.pathA.wasteEliminatedMonthly}/mo in unused seats)` : ""}`
          : "$0/mo: configuration change only, no extra licenses needed"}
      </p>
      <p className="mt-0.5 font-mono text-11 text-faint">contract vs. billed vs. active seats</p>
    </section>
  );
}

function DeviceHealthScript() {
  const health = useWorkbench((s) => s.intuneHealth);
  if (!health) return <p className="border-y border-hairline px-3 py-2 text-12 text-muted">Loading Intune remediation scripts…</p>;
  const verified = health.verification.passed && health.verification.detectReadOnly;
  return (
    <div data-testid="device-health-script">
      <div className="border-t border-hairline px-3 py-1.5">
        <Pill variant="status" tone={verified ? "healthy" : "critical"} mono={false}>
          {verified ? "Detection script verified read-only" : "Detection script check failed"}
        </Pill>
      </div>
      <ScriptCode code={health.detect} name="Detect.ps1 · read-only check" maxHeight="max-h-56" />
      <div className="h-2" />
      <ScriptCode code={health.remediate} name="Remediate.ps1 · registry & policy fix" maxHeight="max-h-64" />
      {health.csp.length > 0 && (
        <section className="px-3 pt-2.5">
          <div className="section-label text-faint">Affected Windows settings &amp; registry keys</div>
          <ul className="mt-1">
            {health.csp.map((c) => (
              <li key={c.settingName} className="border-t border-hairline-2 py-1.5 first:border-t-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-12 font-medium text-text" title={c.settingName}>
                    {c.settingName}
                  </span>
                  {c.tattooedOnUnassign ? (
                    <Pill variant="status" tone="warning" mono={false}>
                      stays tattooed
                    </Pill>
                  ) : (
                    <span className="shrink-0 text-11 text-faint">reverts cleanly</span>
                  )}
                </div>
                {c.registryPath || c.cspUri ? <SmartTechPath path={c.registryPath ?? c.cspUri!} /> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
