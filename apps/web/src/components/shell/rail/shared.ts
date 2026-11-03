import { useCallback, useMemo } from "react";
import type { ActionApprovalDrawer as Drawer } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import type { Tone } from "../../ui/Pill";

export type { Drawer };

export const VERDICT_TONE: Record<Drawer["verificationStatus"]["verdict"], Tone> = {
  "Verified Safe": "healthy",
  "Verified With Warnings": "warning",
  "Verification Failed": "critical",
  Pending: "muted",
  Overridden: "warning",
};

/** Short verdict words for the 440 px prover strip; the full verdict stays in the pill's title. */
export const VERDICT_SHORT: Record<Drawer["verificationStatus"]["verdict"], string> = {
  "Verified Safe": "Safe",
  "Verified With Warnings": "Warnings",
  "Verification Failed": "Failed",
  Pending: "Pending",
  Overridden: "Overridden",
};

/* State-changing PowerShell: Set-/New-/Remove-/Update-/Add-/Start-/Stop-/Restart- cmdlets, or a Graph /
 * REST call with a mutating method. Session-local helpers (New-Object, Add-Member, Start-Sleep …) do
 * not touch the tenant and are ignored. */
const MUTATING_CMDLET = /\b(?:Set|New|Remove|Update|Add|Start|Stop|Restart)-(?!(?:StrictMode|Variable|Location|Object|TimeSpan|Member|Type|Sleep|Transcript|Alias)\b)[A-Za-z]\w*/i;
const MUTATING_REQUEST = /\bInvoke-\w*(?:Method|Request)\b[^\n]*-Method\s+['"]?(?:PATCH|POST|PUT|DELETE)\b/i;

/**
 * True when a staged bundle only reads (a Free-Roam inventory query). The orchestrator puts no
 * read-only marker on the drawer, so it is derived here: a `FREE-` bundle whose PowerShell (comments
 * stripped) has no state-changing cmdlet and no mutating Graph / REST request. Scenario fixes never are.
 */
export function isReadOnlyBundle(drawer: Pick<Drawer, "ticketId" | "powershellScript">): boolean {
  if (!drawer.ticketId.startsWith("FREE-")) return false;
  const code = drawer.powershellScript.replace(/<#[\s\S]*?#>/g, "").replace(/(^|\s)#.*$/gm, "$1");
  if (!code.trim()) return false;
  return !MUTATING_CMDLET.test(code) && !MUTATING_REQUEST.test(code);
}

export function cleanDrawerTitle(drawer: Drawer): string {
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

export function humanizeInvariant(id: string, scenarioId: string, fallback: string): string {
  switch (id) {
    case "break-glass-non-lockout":
      return "Emergency Break-Glass accounts won't be locked out";
    case "target-remediation":
      if (scenarioId === "INC-4092") return "3 affected Finance users will regain AVD access";
      if (scenarioId === "INC-4099") return "6 affected Windows 11 laptops will encrypt silently and regain compliance";
      if (scenarioId === "ANOM-LIC-101") return "2 users with license errors will receive active E5 seats";
      if (scenarioId === "ANOM-CA-204") return "Emergency Break-Glass group is excluded from phishing-resistant MFA";
      if (scenarioId === "ANOM-INT-309") return "11 affected workstations will resolve firewall policy conflicts";
      if (scenarioId === "ANOM-APP-401") return "ERP sync service principal switches to OIDC without breaking scheduled jobs";
      return "All affected users and devices will return to a healthy state";
    case "nsg-reachability":
      if (scenarioId === "INC-4092") return "Port 3389 closed; AVD port 443 stays open";
      if (scenarioId === "INC-4099") return "Conflicting legacy BitLocker profile unassigned; XTS-AES 256 encryption baseline intact";
      if (scenarioId === "ANOM-LIC-101") return "Zero active-user license removals; only disabled/unassigned E5 seats reclaimed";
      if (scenarioId === "ANOM-CA-204") return "Legacy authentication blocked; phishing-resistant MFA enforced on admin roles";
      if (scenarioId === "ANOM-INT-309") return "ASR LSASS rule set to Block with scoped ContosoErpSync.exe exclusion; duplicate firewall profile removed";
      if (scenarioId === "ANOM-APP-401") return "GitHub Actions OIDC federated; overprivileged Graph scopes removed";
      return "Security & network posture baseline preserved (no unauthorized exposure)";
    case "shadow-admin-zero-transitive":
      return "Non-admin contractor owner removed; 0 shadow-admin escalation paths";
    case "proactive-remediation-detect-read-only":
      return "Intune detection script is strictly read-only";
    default:
      return fallback;
  }
}

/**
 * The blast radius modelled for a built-in scenario (its symbolic fixture model), or null for a ticket
 * without one. These sentences describe the model, not a measurement of the tenant, so callers label
 * them "modelled" and never show one for an ad-hoc ticket.
 */
export function blastSummarySentence(scenarioId: string): string | null {
  switch (scenarioId) {
    case "INC-4092":
      return "3 Finance users unblocked · 0 collateral users · emergency admin accounts untouched · port 3389 closed";
    case "INC-4099":
      return "6 Windows 11 laptops unblocked · 0 other devices affected · emergency admin accounts untouched";
    case "ANOM-LIC-101":
      return "3 unused E5 seats reclaimed from disabled accounts · 2 active users licensed · 0 active users disrupted";
    case "ANOM-CA-204":
      return "Break-Glass group excluded from CA-001 · legacy auth blocked · 0 admin lockouts";
    case "ANOM-INT-309":
      return "LSASS credential rule set to Block (with finance exclusion) · 11 workstations cleared of conflict";
    case "ANOM-APP-401":
      return "Contractor app owner removed · Graph permissions right-sized · GitHub Actions switched to OIDC";
    default:
      return null;
  }
}

/** The blast-radius pill: tone and words from the formal result, "modelled" because it is the fixture model. */
export function blastRadiusPill(formal: { formal: { passed: boolean | null }; blastRadius: { collateralChanges: number; rows: Array<{ cohort: string; entities: string[] }> } } | null): { tone: Tone; label: string; title: string } | null {
  if (!formal) return null;
  if (formal.formal.passed === null) return { tone: "muted", label: "blast radius not modelled", title: "No symbolic model exists for this ticket, so no blast radius is claimed" };
  const targets = formal.blastRadius.rows.find((r) => r.cohort === "target")?.entities.length;
  const collateral = formal.blastRadius.collateralChanges;
  const label = `${targets !== undefined ? `${targets} target${targets === 1 ? "" : "s"} · ` : ""}${collateral} collateral (modelled)`;
  return {
    tone: collateral === 0 ? "healthy" : "critical",
    label,
    title: `Modelled blast radius on the scenario's fixture model: ${collateral} collateral change${collateral === 1 ? "" : "s"}. Not a measurement of the live tenant.`,
  };
}

/** Clipboard copy with a toast, as the drawer did it. */
export function useCopy(): (text: string, what: string) => Promise<void> {
  const toast = useWorkbench((s) => s.toast);
  return useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({ tone: "healthy", title: `${what} copied`, detail: "Ready to paste or run with -WhatIf first." });
      } catch (error) {
        toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
      }
    },
    [toast],
  );
}

/**
 * the revert buttons say what a click will do. "Revert change now" only when the server can
 * execute an inverse derived from the pre-change snapshot; otherwise the inverse script is staged.
 */
export function useRevertLabel(): { label: string; title: string } {
  const executable = useWorkbench((s) => Boolean(s.drawer && s.convergence[s.drawer.ticketId]?.inverseExecutable));
  return executable
    ? { label: "Revert change now", title: "Execute the inverse (f⁻¹) derived from the pre-change snapshot, then read the entities back" }
    : { label: "Stage revert", title: "Stage the inverse script (f⁻¹) for this change; nothing is executed against the tenant" };
}

/** The staged fix touches Intune: the rail shows the Device health tab. */
export function useHasIntune(): boolean {
  return useWorkbench((s) =>
    Boolean(s.drawer && (s.drawer.ticketId === "INC-4099" || s.drawer.ticketId === "ANOM-INT-309" || (s.intuneHealth && s.intuneHealth.csp.length > 0))),
  );
}

export interface PreflightState {
  /** The pre-flight did not pass (or generation failed): the prover strip turns critical. */
  failed: boolean;
  overridden: boolean;
  /** Approve stays disabled. */
  blocked: boolean;
  reasons: string[];
}

/**
 * The approve gate as a pure function: the Approve button (through usePreflight) and the `x` hotkey
 * both read it, so a keypress can never approve what the button would refuse.
 */
export function preflightGate(drawer: Drawer | null, formal: { formal: { passed: boolean | null; invariants: Array<{ passed: boolean; statement: string }> } } | null | undefined, status: string): PreflightState {
  const formalPassed = formal?.formal.passed;
  const overridden = drawer?.verificationStatus.verdict === "Overridden";
  const failed = Boolean(
    drawer && (drawer.verificationStatus.verdict === "Verification Failed" || (formalPassed === false && !overridden) || status === "error"),
  );
  const blocked = Boolean(drawer && (drawer.verificationStatus.verdict === "Verification Failed" || (formalPassed === false && !overridden)));
  const reasons: string[] = [];
  if (drawer) {
    for (const f of drawer.verificationStatus.findings) if (f && !reasons.includes(f)) reasons.push(f);
    if (drawer.verificationStatus.astCheckPassed === false) reasons.push("PowerShell AST syntax or command safety check failed.");
    else if (drawer.verificationStatus.astCheckPassed === null) reasons.push("PowerShell AST check did not run.");
    if (drawer.verificationStatus.whatIfSafe === false) reasons.push("Mutating PowerShell cmdlet detected outside a ShouldProcess (-WhatIf) guard.");
  }
  if (formal && formal.formal.passed === false) {
    for (const inv of formal.formal.invariants) if (!inv.passed) reasons.push(`Safety invariant failed: ${inv.statement}`);
  }
  if (reasons.length === 0 && failed) {
    reasons.push("Pre-flight safety verification failed: script requires a ShouldProcess (-WhatIf) guard or admin justification.");
  }
  return { failed, overridden, blocked, reasons };
}

export function usePreflight(): PreflightState {
  const drawer = useWorkbench((s) => s.drawer);
  const formal = useWorkbench((s) => s.formal);
  const status = useWorkbench((s) => s.remediateStatus);
  return useMemo(() => preflightGate(drawer, formal, status), [drawer, formal, status]);
}

export type FormalData = NonNullable<ReturnType<typeof useWorkbench.getState>["formal"]>;
export type CanaryData = NonNullable<ReturnType<typeof useWorkbench.getState>["canary"]>;

/** What the fix assigns in licences, read from the bundle itself; empty when it assigns none. */
export function licenceAdditions(drawer: Drawer): string[] {
  const found = new Set<string>();
  for (const e of drawer.affectedEntities) {
    // Clause by clause: "assign SPE_E5, remove SPE_E3" assigns E5 only.
    for (const clause of `${e.change ?? ""}`.split(/[,;·]|\band\b/)) {
      if (/\b(remove|revoke|reclaim|unassign)\b/i.test(clause)) continue;
      // "SPE_E3 → SPE_E5" or "CountViolation → Active (SPE_E5)": what is right of the arrow is assigned.
      const target = clause.includes("→") ? clause.slice(clause.lastIndexOf("→") + 1) : /\b(assign|add|grant)\b|\+/i.test(clause) ? clause : "";
      for (const m of target.matchAll(/\b(SPE_E[35]|ENTERPRISEPACK|ENTERPRISEPREMIUM|Microsoft_365_Copilot)\b/g)) found.add(m[1]!);
    }
  }
  // Set-MgUserLicense -AddLicenses @{SkuId = …SPE_E5…}: only the SKUs on an -AddLicenses line count.
  for (const line of drawer.powershellScript.split("\n")) {
    if (!/-AddLicenses\b/i.test(line)) continue;
    const added = line.slice(line.search(/-AddLicenses\b/i)).split(/-RemoveLicenses\b/i)[0]!;
    for (const m of added.matchAll(/\b(SPE_E[35]|ENTERPRISEPACK|ENTERPRISEPREMIUM|Microsoft_365_Copilot)\b/g)) found.add(m[1]!);
  }
  return [...found];
}

/**
 * The "what we verified" lines of the customer note, each one only when the state behind it is known:
 * the pre-flight verdict and where it ran, whether the change was written to the tenant or only staged,
 * the post-change health check (and that it ran on the modelled lab state), the modelled blast radius
 * and any licences the fix assigns. Nothing is asserted that was not measured.
 */
export function verifiedLines(input: { drawer: Drawer; execution: "live-graph" | "simulated" | null; canary: CanaryData | null; formal: FormalData | null }): string[] {
  const { drawer, execution, canary, formal } = input;
  const lines: string[] = [];
  if (execution === "live-graph") lines.push("• The change was applied to your tenant and read back afterwards.");
  else if (execution === "simulated") lines.push("• The change is approved and staged; it has not been applied to your tenant yet.");
  const v = drawer.verificationStatus;
  const where = v.sandboxProvider === "modal-cloud-sandbox" ? " in our isolated sandbox" : v.sandboxProvider === "local-pwsh" ? " on the engineer's workstation" : "";
  if (v.verdict === "Verified Safe") lines.push(`• Pre-flight safety checks passed${where}.`);
  else if (v.verdict === "Verified With Warnings") lines.push(`• Pre-flight safety checks passed with ${v.findings.length} warning${v.findings.length === 1 ? "" : "s"}${where}, reviewed by the engineer.`);
  else if (v.verdict === "Overridden") lines.push("• A pre-flight finding was overridden by the engineer with a recorded justification.");
  if (canary && canary.scenarioId === drawer.ticketId && canary.probeSource !== "none") {
    const modelled = canary.probeSource === "symbolic" ? " on the modelled lab state" : "";
    if (canary.finalState === "CONVERGED") lines.push(`• Post-change health checks passed${modelled}.`);
    else lines.push(canary.rollbackExecuted ? "• The post-change health check failed, so the change was rolled back automatically." : "• The post-change health check failed; the rollback is staged for the engineer.");
  }
  if (formal && formal.formal.passed === true && formal.blastRadius.collateralChanges === 0) {
    lines.push("• Our safety model of this change shows no other users or emergency admin accounts affected.");
  }
  const licences = licenceAdditions(drawer);
  if (licences.length) lines.push(`• Licences assigned by this fix: ${licences.join(", ")}. Seat counts may change on your next invoice.`);
  return lines;
}
