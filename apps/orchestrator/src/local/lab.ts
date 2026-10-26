import type { ScenarioId } from "@contextpane/catalog";
import { getManifestTenant, msgraphService, type LabLicenseState } from "@contextpane/mcp-msgraph";
import { SCENARIO_REGISTRY } from "@contextpane/catalog";

/**
 * The lab writes behind Approve & Execute (state "remediated") and Reset Drift
 * (state "drifted"), per scenario. Licensing is modelled in the open extension
 * com.contextpane.licenseState, so no real seat is ever consumed; Conditional
 * Access and Intune changes PATCH the seeded [ContextPane-Demo] objects through
 * the delegated Connect-MgGraph token. Anything the tenant cannot take is
 * reported as simulated, with the reason.
 */

export interface LabWriteOutcome {
  source: "live-graph" | "simulated";
  fallbackReason?: string;
  latencyMs: number;
  /** One row per user or policy written. */
  results: Array<{ id: string; ok: boolean; status: number; error?: string }>;
  /** One line for the execution log / audit entry. */
  summary: string;
}

/** Upns of the INC-4092 users the demo keeps drifted. */
export function contosoDriftedUpns(): string[] {
  return getManifestTenant("tenant-contoso-01")
    .users.filter((u) => u.driftStatus !== "compliant")
    .map((u) => u.upn);
}

export async function applyScenarioState(scenarioId: ScenarioId, state: LabLicenseState, upns?: string[]): Promise<LabWriteOutcome> {
  const tenantId = SCENARIO_REGISTRY[scenarioId].tenantId;
  const fixed = state === "remediated";
  switch (scenarioId) {
    case "INC-4092": {
      const targets = upns?.length ? upns : contosoDriftedUpns();
      const w = await msgraphService.setLicenseExtensionState(tenantId, targets, state);
      const ok = w.results.filter((r) => r.ok).length;
      return {
        ...pick(w),
        results: w.results.map((r) => ({ id: r.upn, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })),
        summary: `${ok}/${w.results.length} users → ${fixed ? "SPE_E5 / Compliant" : "SPE_E3 / Drift_Missing_E5_SKU"}`,
      };
    }
    case "ANOM-LIC-101": {
      const w = await msgraphService.setLicenseAnomalyState(state);
      return {
        ...pick(w),
        results: w.results.map((r) => ({ id: r.upn, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })),
        summary: fixed ? "3 orphaned seats reclaimed, 2 CountViolation members → Active" : "3 disabled accounts hold SPE_E5 again, 2 members back to CountViolation",
      };
    }
    case "ANOM-CA-204": {
      const w = await msgraphService.setCaPostureState(state);
      return { ...pick(w), results: w.results, summary: fixed ? "CA-001 excludes SG-BreakGlass-Accounts, CA-004 enabled" : "CA-001 exclusion removed, CA-004 back to Report-Only" };
    }
    case "ANOM-INT-309":
    case "INC-4099": {
      const w = await msgraphService.setIntuneState(scenarioId, state);
      const summary =
        scenarioId === "INC-4099"
          ? fixed
            ? "Legacy BitLocker profile unassigned from SG-Fabrikam-Win11-Devices"
            : "Legacy BitLocker profile re-assigned to SG-Fabrikam-Win11-Devices"
          : fixed
            ? "ASR LSASS rule → Block, Win11-Firewall-MDM unassigned"
            : "ASR LSASS rule → Audit, Win11-Firewall-MDM re-assigned";
      return { ...pick(w), results: w.results, summary };
    }
  }
}

function pick(w: { source: "live-graph" | "simulated"; fallbackReason?: string; latencyMs: number }) {
  return { source: w.source, latencyMs: w.latencyMs, ...(w.fallbackReason ? { fallbackReason: w.fallbackReason } : {}) };
}
