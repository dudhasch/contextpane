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

export function blastSummarySentence(scenarioId: string): string {
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
      return "Affected users unblocked · 0 collateral users · emergency admin accounts untouched";
  }
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

export function usePreflight(): PreflightState {
  const drawer = useWorkbench((s) => s.drawer);
  const formal = useWorkbench((s) => s.formal);
  const status = useWorkbench((s) => s.remediateStatus);
  return useMemo(() => {
    const formalPassed = formal?.formal.passed;
    const overridden = drawer?.verificationStatus.verdict === "Overridden";
    const failed = Boolean(
      drawer && (drawer.verificationStatus.verdict === "Verification Failed" || (formalPassed === false && !overridden) || status === "error"),
    );
    const blocked = Boolean(drawer && (drawer.verificationStatus.verdict === "Verification Failed" || (formalPassed === false && !overridden)));
    const reasons: string[] = [];
    if (drawer) {
      for (const f of drawer.verificationStatus.findings) if (f && !reasons.includes(f)) reasons.push(f);
      if (!drawer.verificationStatus.astCheckPassed) reasons.push("PowerShell AST syntax or command safety check failed.");
      if (!drawer.verificationStatus.whatIfSafe) reasons.push("Mutating PowerShell cmdlet detected outside a ShouldProcess (-WhatIf) guard.");
    }
    if (formal && formal.formal.passed === false) {
      for (const inv of formal.formal.invariants) if (!inv.passed) reasons.push(`Safety invariant failed: ${inv.statement}`);
    }
    if (reasons.length === 0 && failed) {
      reasons.push("Pre-flight safety verification failed: script requires a ShouldProcess (-WhatIf) guard or admin justification.");
    }
    return { failed, overridden, blocked, reasons };
  }, [drawer, formal, status]);
}
