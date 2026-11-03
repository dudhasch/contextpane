import type { ScenarioId } from "@contextpane/catalog";
import { azureIacService, type NsgWriteResult } from "@contextpane/mcp-azure-iac";
import { WORKLOAD_IDENTITY, getManifestTenant, msgraphService, type LabLicenseState } from "@contextpane/mcp-msgraph";
import { SCENARIO_REGISTRY } from "@contextpane/catalog";
import type { EntitySnapshot, SnapshotInverseSections } from "./snapshot.ts";

/**
 * The lab writes behind an Emergency Break-Glass approval (state "remediated") and
 * Reset Drift (state "drifted"), per scenario. Licensing is modelled in the open
 * extension com.contextpane.licenseState, so no real seat is ever consumed; Conditional
 * Access and Intune changes PATCH the seeded [ContextPane-Demo] objects through the
 * delegated Connect-MgGraph token; INC-4092's NSG is put back to the Terraform baseline
 * (or the seeded drift) over ARM with the Az token. Anything the tenant cannot take is
 * reported as simulated, with the reason. A Pure GitOps approval writes nothing here.
 * Every live write is behind one gate in the services (LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE, and the
 * token's tenant must be the lab tenant); with the gate closed these writes are simulated and labelled so.
 */

export interface LabWriteOutcome {
  source: "live-graph" | "simulated";
  fallbackReason?: string;
  latencyMs: number;
  /** One row per user or policy written. */
  results: Array<{ id: string; ok: boolean; status: number; error?: string }>;
  /** One line for the execution log / audit entry. */
  summary: string;
  /** The ARM side of a scenario with an Azure estate (INC-4092's NSG). */
  arm?: NsgWriteResult;
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
      // Graph (licensing + Conditional Access) and ARM (NSG) are independent writes; the NSG one waits for each long-running operation.
      const [w, ca, nsg] = await Promise.all([
        msgraphService.setLicenseExtensionState(tenantId, targets, state),
        msgraphService.setConditionalAccessState(tenantId, state),
        azureIacService.setNsgState(tenantId, state),
      ]);
      const ok = w.results.filter((r) => r.ok).length;
      const nsgOps = nsg.results.map((r) => r.id).join(", ") || "already at target";
      const caSummary = fixed ? "CA Block AVD → report-only (excludes SG-Contoso-Finance-AVD)" : "CA Block AVD → enabled";
      // Source and failures over ALL three writes: one live write landing never makes the others count as done.
      const combined = combineWrites([
        { label: "licences", live: w.source === "live-graph", fallbackReason: w.fallbackReason, rows: w.results.map((r) => ({ id: r.upn, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })) },
        { label: "ca", live: ca.source === "live-graph", fallbackReason: ca.fallbackReason, rows: ca.results.map((r) => ({ id: `ca ${r.id}`, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })) },
        { label: "nsg", live: nsg.source === "live-azure", fallbackReason: nsg.fallbackReason, rows: nsg.results.map((r) => ({ id: `nsg ${r.id}`, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })) },
      ]);
      return {
        ...combined,
        latencyMs: Math.max(w.latencyMs, ca.latencyMs, nsg.latencyMs),
        summary: `${ok}/${w.results.length} users → ${fixed ? "SPE_E5 / Compliant" : "SPE_E3 / Drift_Missing_E5_SKU"} · ${caSummary} · NSG ${nsg.source === "live-azure" ? `(ARM): ${nsgOps}` : `simulated (${nsg.fallbackReason ?? "no Azure context"})`}`,
        arm: nsg,
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
    case "ANOM-APP-401": {
      // Fixture-only scenario: no lab write exists for the SPN, so both states simulate.
      return {
        source: "simulated",
        fallbackReason: "workload identity fixture (no lab SPN seeded)",
        latencyMs: 0,
        results: [{ id: WORKLOAD_IDENTITY.spn.displayName, ok: true, status: 0 }],
        summary: fixed
          ? `${WORKLOAD_IDENTITY.spn.displayName}: owner ${WORKLOAD_IDENTITY.owner.upn} removed, delegated grant revoked, scopes right-sized to ${WORKLOAD_IDENTITY.requiredPermissions.join(", ")}, GitHub Actions OIDC federated`
          : `${WORKLOAD_IDENTITY.spn.displayName}: shadow-admin owner, overprivileged scopes and expired secret restored (fixture)`,
      };
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

/**
 * f⁻¹ through the forward write path: every section of the captured pre-change snapshot
 * is written back through the same service methods the approve path writes through, so the
 * rollback honours LIVE_CLOUD_MODE and the live-capable tenant list exactly as approve does.
 * Outside live mode the writes are simulated and the in-memory lab state follows the snapshot.
 */
export async function applySnapshotState(snapshot: EntitySnapshot, sections?: SnapshotInverseSections): Promise<LabWriteOutcome> {
  const started = performance.now();
  const want = (s: SnapshotInverseSections[number]) => !sections || sections.includes(s);
  const summaries: string[] = [];
  let arm: NsgWriteResult | undefined;
  const parts: WritePart[] = [];
  if (want("users") && snapshot.users.length) {
    const w = await msgraphService.restoreLicenseExtensions(
      snapshot.tenantId,
      snapshot.users.map((u) => ({
        upn: u.upn,
        fields: {
          currentSku: u.currentSku,
          expectedSku: u.expectedSku,
          driftStatus: u.driftStatus,
          assignmentState: u.assignmentState,
          assignmentPath: u.assignmentPath,
          entraAssignedSku: u.currentSku,
          avdEntitlementStatus: u.driftStatus === "compliant" ? "Compliant" : "Drift_Missing_E5_SKU",
        },
      })),
    );
    parts.push({ label: "licences", live: w.source === "live-graph", fallbackReason: w.fallbackReason, rows: w.results.map((r) => ({ id: r.upn, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })) });
    summaries.push(`${w.results.filter((r) => r.ok).length}/${w.results.length} users → captured licence state`);
  }
  if (want("conditional-access") && snapshot.caPolicies.length) {
    const w = await msgraphService.restoreConditionalAccessPolicies(snapshot.tenantId, snapshot.caPolicies);
    parts.push({ label: "ca", live: w.source === "live-graph", fallbackReason: w.fallbackReason, rows: w.results.map((r) => ({ id: `ca ${r.id}`, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })) });
    summaries.push(`${snapshot.caPolicies.length} CA polic${snapshot.caPolicies.length === 1 ? "y" : "ies"} → captured state`);
  }
  if (want("nsg") && snapshot.nsg) {
    const w = await azureIacService.restoreNsgState(snapshot.tenantId, { rules: snapshot.nsg.rules, tags: snapshot.nsg.tags });
    arm = w;
    parts.push({ label: "nsg", live: w.source === "live-azure", fallbackReason: w.fallbackReason, rows: w.results.map((r) => ({ id: `nsg ${r.id}`, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) })) });
    summaries.push(`NSG ${snapshot.nsg.name} → ${snapshot.nsg.rules.length} captured rules${w.source === "live-azure" ? ` (ARM: ${w.results.map((r) => r.id).join(", ") || "already at target"})` : " (simulated)"}`);
  }
  if (want("intune") && snapshot.intune) {
    const w = await msgraphService.restoreIntuneAssignments(snapshot.intune.key, { policies: snapshot.intune.policies, settings: snapshot.intune.settings });
    parts.push({ label: "intune", live: w.source === "live-graph", fallbackReason: w.fallbackReason, rows: w.results });
    summaries.push("Intune assignments and settings → captured state");
  }
  if (want("workload-identity") && snapshot.workloadIdentity) {
    // Fixture-only estate: no lab SPN exists to write to (same as the forward write for ANOM-APP-401).
    parts.push({ label: "workload identity", live: false, fallbackReason: "workload identity fixture (no lab SPN seeded)", rows: [{ id: snapshot.workloadIdentity.displayName, ok: true, status: 0 }] });
    summaries.push(`${snapshot.workloadIdentity.displayName}: owners and app roles → captured state (fixture)`);
  }
  const combined = combineWrites(parts);
  return {
    ...combined,
    ...(combined.source === "simulated" && !combined.fallbackReason ? { fallbackReason: "no section to write" } : {}),
    latencyMs: Math.round(performance.now() - started),
    summary: summaries.join(" · ") || "nothing captured to restore",
    ...(arm ? { arm } : {}),
  };
}

interface WritePart {
  label: string;
  live: boolean;
  fallbackReason?: string;
  rows: LabWriteOutcome["results"];
}

/**
 * One outcome over several writes. All simulated → simulated, with every reason. Any live → live, and
 * every part that did not go out live (simulated, a missing context) becomes a failed row: approve reports
 * "executed" and a rollback "landed" only when every write landed live.
 */
export function combineWrites(parts: WritePart[]): Pick<LabWriteOutcome, "source" | "fallbackReason" | "results"> {
  const reasons = [...new Set(parts.map((p) => p.fallbackReason).filter((r): r is string => Boolean(r)))];
  if (!parts.some((p) => p.live)) {
    return { source: "simulated", results: parts.flatMap((p) => p.rows), ...(reasons.length ? { fallbackReason: reasons.join("; ") } : {}) };
  }
  const results = parts.flatMap((p) =>
    p.live ? p.rows : [{ id: p.label, ok: false, status: 0, error: `not written live: ${p.fallbackReason ?? "simulated"}` }],
  );
  const failedReasons = parts.filter((p) => p.live && p.rows.some((r) => !r.ok) && p.fallbackReason).map((p) => p.fallbackReason!);
  return { source: "live-graph", results, ...(failedReasons.length ? { fallbackReason: [...new Set(failedReasons)].join("; ") } : {}) };
}

function pick(w: { source: "live-graph" | "simulated"; fallbackReason?: string; latencyMs: number }) {
  return { source: w.source, latencyMs: w.latencyMs, ...(w.fallbackReason ? { fallbackReason: w.fallbackReason } : {}) };
}
