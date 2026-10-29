import { baseScenarioOf, isCustomScenarioId, isFreeRoamActionId, type ActionApprovalDrawer } from "@contextpane/catalog";
import { config, isLiveCloudMode } from "../config.ts";
import { buildInverseRollback, verifyIdempotency, type InverseRollbackBundle } from "../local/formal-verifier.ts";
import { buildInverseFromSnapshot, type SnapshotInverse } from "../local/inverse-rollback.ts";
import { applySnapshotState, type LabWriteOutcome } from "../local/lab.ts";
import { captureEntitySnapshot, compareSnapshots, type EntitySnapshot, type SnapshotDifference } from "../local/snapshot.ts";
import { gatherContext, invalidateContext } from "../mcp/context.ts";
import { auditLedger } from "../store/audit.ts";
import { convergenceStore } from "../store/convergence.ts";
import { remediationStore } from "../store/remediations.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { runScriptText } from "./tier3-remediate.ts";
import { ABAC_LAB, deleteAbacRoleAssignmentsLive } from "@contextpane/mcp-azure-iac";
import { getAbacLabState, invalidateAbacLabState, isAbacTicketText } from "../local/abac.ts";
import { getCustomScenario, type CustomScenarioId } from "@contextpane/catalog";

/**
 * Real f⁻¹ (U-5).
 *
 * The approve path captured the affected entities before it wrote (`convergenceStore.snapshot`).
 * Revert derives the inverse from that snapshot and the executed bundle (`inverse-rollback.ts`),
 * executes it through the same write path approve used (`applySnapshotState` → msgraph / azure
 * services → live.ts; the inverse script only under CTX_ALLOW_EXECUTE, as approve ran the
 * forward script), then reads the entities back and compares them with the snapshot. What
 * comes back is only what happened on the server: `executed` is true when a live inverse
 * landed, `execution: "simulated"` when the lab state was reverted in memory because
 * LIVE_CLOUD_MODE is off, `none` when nothing could run; `canary.matchesPreSnapshot` is the
 * read-back, not an assertion. A Free-Roam action, or a ticket nothing executed for, has nothing
 * to revert and says so. The static per-scenario `buildInverseRollback` stays as the reference
 * script shown before anything ran.
 */

export interface RollbackCanary {
  probeSource: "live-read" | "simulated-read";
  matchesPreSnapshot: boolean;
  differences: SnapshotDifference[];
  capturedAt: string;
}

export interface RollbackResult {
  ok: boolean;
  scenarioId: string;
  /** True only when a live inverse write landed (or the inverse script ran and the read-back matches the snapshot). */
  executed: boolean;
  execution: "live-graph" | "simulated" | "none";
  reason: string;
  latencyMs: number;
  inverseSource: "pre-snapshot" | "static-reference" | "none";
  rollback: InverseRollbackBundle | SnapshotInverse;
  executionLog: string[];
  canary: RollbackCanary | null;
  preSnapshotAt: string | null;
  /** True when the server dropped the convergence (the canvas returns to the drifted state). */
  convergenceCleared: boolean;
  idempotency: ReturnType<typeof verifyIdempotency>;
}

export interface InverseExecution {
  write: LabWriteOutcome | null;
  script: { ok: boolean; log: string[] } | null;
  log: string[];
  /** A live write landed with every row ok, or the inverse script exited 0. */
  landed: boolean;
}

/**
 * Executes the snapshot inverse the way approve executed the forward bundle: lab writes through
 * `applySnapshotState` (simulated outside live mode), the inverse PowerShell only when
 * CTX_ALLOW_EXECUTE is on and the forward bundle was a script-executed custom one.
 */
export async function executeInverse(input: { scenarioId: string; snapshot: EntitySnapshot | null; drawer: ActionApprovalDrawer | null; inverse: SnapshotInverse | InverseRollbackBundle | null }): Promise<InverseExecution> {
  const log: string[] = [];
  let write: LabWriteOutcome | null = null;
  let script: { ok: boolean; log: string[] } | null = null;
  const live = isLiveCloudMode();
  const customScript = Boolean(input.drawer && isCustomScenarioId(input.drawer.ticketId) && !baseScenarioOf(input.drawer.ticketId));
  if (live && config.allowExecute && customScript && input.inverse?.powershellScript.trim()) {
    log.push("LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE → running the inverse script via the delegated identity");
    script = await runScriptText(input.inverse.powershellScript, `Invoke-Rollback-${input.scenarioId}`);
    log.push(...script.log);
  }
  if (input.snapshot) {
    const sections = input.inverse && "sections" in input.inverse ? input.inverse.sections : undefined;
    write = await applySnapshotState(input.snapshot, sections);
    if (write.source === "live-graph") {
      log.push(`Inverse write${write.arm ? " (Graph + ARM)" : " (Graph)"}: ${write.summary} in ${write.latencyMs} ms`);
      for (const f of write.results.filter((r) => !r.ok)) log.push(`  ${f.id}: HTTP ${f.status} ${f.error ?? ""}`.trimEnd());
    } else {
      log.push(live ? `Inverse write simulated (${write.fallbackReason ?? "no live-capable section"})` : `LIVE_CLOUD_MODE=false: inverse simulated against the in-process lab state (${write.summary}); nothing written live`);
    }
  } else if (!script) {
    log.push("No pre-change snapshot for this ticket: there is nothing captured to restore");
  }
  const landed = (write?.source === "live-graph" && write.results.every((r) => r.ok)) || Boolean(script?.ok);
  return { write, script, log, landed };
}

export async function rollbackRemediation(scenarioId: string, options: { approvedBy?: string } = {}): Promise<RollbackResult> {
  const started = performance.now();
  const targetId = baseScenarioOf(scenarioId) ?? scenarioId;
  const idempotency = verifyIdempotency(targetId);
  const finish = (partial: Omit<RollbackResult, "ok" | "scenarioId" | "latencyMs" | "idempotency">): RollbackResult => ({
    ok: true,
    scenarioId,
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    idempotency,
    ...partial,
  });

  // A staged Free-Roam action never executed: nothing to revert (HARD_CASES 29).
  if (isFreeRoamActionId(scenarioId)) {
    const rollback = buildInverseRollback(scenarioId);
    return finish({ executed: false, execution: "none", reason: rollback.note ?? "staged action, nothing to revert", inverseSource: "none", rollback, executionLog: [`${scenarioId} is a staged Free-Roam action: nothing was executed, so there is nothing to revert.`], canary: null, preSnapshotAt: null, convergenceCleared: false });
  }

  const convergence = convergenceStore.get(scenarioId);
  const snapshot = convergenceStore.snapshot(scenarioId);
  const drawer = convergence ? remediationStore.get(convergence.remediationId) : null;
  const reference = buildInverseRollback(scenarioId);

  // ABAC: the inverse of the ARM PUT is an ARM DELETE of the identity's role assignments on the payroll account, then a read-back.
  const abacEntry = getCustomScenario(scenarioId as CustomScenarioId);
  if (abacEntry && isAbacTicketText(`${abacEntry.ticket.title}\n${abacEntry.ticket.body}`)) {
    const rollback = { ...reference, powershellScript: abacEntry.customRemediation?.rollbackScript ?? reference.powershellScript, restores: [`Remove ${ABAC_LAB.roleName} for ${ABAC_LAB.identityName} on ${ABAC_LAB.storageAccount}`] };
    const log: string[] = [];
    let executed = false;
    if (isLiveCloudMode() && config.allowExecute) {
      log.push(`ARM DELETE: ${ABAC_LAB.roleName} assignments of ${ABAC_LAB.identityName} on ${ABAC_LAB.storageAccount}`);
      try {
        const res = await deleteAbacRoleAssignmentsLive();
        log.push(res.removed.length ? `Removed ${res.removed.length} assignment${res.removed.length === 1 ? "" : "s"} in ${res.latencyMs} ms · ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}` : "No assignment to remove");
        if (res.failed.length) log.push(`${res.failed.length} delete(s) failed`);
        // ARM's role-assignment list can trail a DELETE by a few seconds: read back until it agrees, at most ~6 s.
        invalidateAbacLabState();
        let after = await getAbacLabState({ fresh: true });
        for (let attempt = 0; attempt < 4 && res.removed.length && after.source === "live" && after.assignments.length > 0; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          invalidateAbacLabState();
          after = await getAbacLabState({ fresh: true });
        }
        executed = res.removed.length > 0 && res.failed.length === 0 && after.source === "live" && after.assignments.length === 0;
        log.push(`Read-back (live): ${after.assignments.length} ${ABAC_LAB.roleName} assignment(s) left for ${ABAC_LAB.identityName}`);
      } catch (error) {
        log.push(`ARM DELETE refused: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      log.push(`Revert staged, not executed (${!isLiveCloudMode() ? "Simulated-Lab mode" : "CTX_ALLOW_EXECUTE=false"})`);
    }
    const convergenceCleared = executed && Boolean(convergence);
    if (convergence && convergenceCleared) convergenceStore.clear(scenarioId, convergence.tenantId);
    if (drawer && convergenceCleared) remediationStore.save({ ...drawer, approval: { ...drawer.approval, state: "rolled-back" } });
    auditLedger.append({
      tenantId: abacEntry.tenantId,
      ticketId: scenarioId,
      actionType: "hitl-rollback",
      delegatedIdentity: options.approvedBy ?? drawer?.approval.approvedBy ?? config.lab.delegatedIdentity,
      modalSandboxVerified: false,
      astPass: null,
      tfValidatePass: null,
      gitBranch: drawer?.staging?.branchName ?? null,
      prUrl: null,
      latencyMs: Math.round(performance.now() - started),
      execution: executed ? "live-graph-and-arm-reverted" : "none",
      detail: `${executed ? "ARM DELETE executed" : "revert staged"} · ${ABAC_LAB.roleName} on ${ABAC_LAB.storageAccount}`,
    });
    return finish({
      executed,
      execution: executed ? "live-graph" : "none",
      reason: executed ? "role assignment deleted through ARM and the read-back shows none left" : "the ARM DELETE did not run or did not land; the revert script is staged",
      inverseSource: executed ? "pre-snapshot" : "static-reference",
      rollback,
      executionLog: log,
      canary: null,
      preSnapshotAt: null,
      convergenceCleared,
    });
  }

  if (!convergence || !snapshot) {
    const reason = !convergence ? "nothing was approved for this ticket; the revert script is the static reference for the scenario" : "no pre-change snapshot was captured for this approval; the revert script is the static reference";
    return finish({
      executed: false,
      execution: "none",
      reason,
      inverseSource: "static-reference",
      rollback: reference,
      executionLog: [`Revert script staged for ${scenarioId}: ${reference.restores.length} restore step${reference.restores.length === 1 ? "" : "s"}, ${reference.powershellScript.split("\n").length} lines PowerShell${reference.terraformDiff ? " + Terraform" : ""}`, `${reason}. Review it, run it with -WhatIf, then run it as the delegated admin.`],
      canary: null,
      preSnapshotAt: null,
      convergenceCleared: false,
    });
  }

  const inverse = buildInverseFromSnapshot(snapshot, drawer ?? { powershellScript: "", graphPatch: "", terraformDiff: "", affectedEntities: [] });
  const log: string[] = [`Inverse f⁻¹ derived from the pre-change snapshot of ${snapshot.capturedAt} (${inverse.sections.join(", ") || "no section"}): ${inverse.restores.length} restore step${inverse.restores.length === 1 ? "" : "s"}`];
  const run = await executeInverse({ scenarioId, snapshot, drawer, inverse });
  log.push(...run.log);

  // Read-back: the same entities, read again, against the snapshot. This is the only source of "restored".
  invalidateContext(scenarioId);
  let canary: RollbackCanary | null = null;
  try {
    const after = await gatherContext(scenarioId, { fresh: true });
    const post = await captureEntitySnapshot(after, snapshot.users.map((u) => u.upn));
    const cmp = compareSnapshots(snapshot, post);
    canary = { probeSource: isLiveCloudMode() ? "live-read" : "simulated-read", matchesPreSnapshot: cmp.equal, differences: cmp.differences.slice(0, 20), capturedAt: post.capturedAt };
    log.push(cmp.equal ? `Read-back (${canary.probeSource}): every captured entity matches the pre-change snapshot` : `Read-back (${canary.probeSource}): ${cmp.differences.length} entit${cmp.differences.length === 1 ? "y" : "ies"} still differ${cmp.differences.length === 1 ? "s" : ""} from the snapshot (${cmp.differences.slice(0, 3).map((d) => d.path).join(", ")})`);
  } catch (error) {
    log.push(`Read-back skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const live = isLiveCloudMode();
  const executed = live && run.landed && (canary?.matchesPreSnapshot ?? run.write?.source === "live-graph");
  const execution: RollbackResult["execution"] = executed ? "live-graph" : run.write || run.script ? "simulated" : "none";
  const reason = executed
    ? "inverse executed through the live write path and the read-back matches the pre-change snapshot"
    : !live
      ? "LIVE_CLOUD_MODE=false: the inverse ran against the in-process lab state only; nothing was written to a tenant"
      : run.landed
        ? "the inverse write landed but the read-back still differs from the snapshot; review the differences before relying on it"
        : run.write?.fallbackReason ?? "no inverse write could run; the script is staged for the delegated admin";

  // The canvas follows what happened: a landed inverse, or a simulated one in simulated mode, puts the drift back.
  const convergenceCleared = executed || (!live && execution === "simulated");
  if (convergenceCleared) convergenceStore.clear(scenarioId, convergence.tenantId);
  if (drawer && convergenceCleared) remediationStore.save({ ...drawer, approval: { ...drawer.approval, state: "rolled-back" } });

  const latencyMs = Math.round(performance.now() - started);
  auditLedger.append({
    tenantId: convergence.tenantId,
    ticketId: scenarioId,
    actionType: "hitl-rollback",
    delegatedIdentity: options.approvedBy ?? drawer?.approval.approvedBy ?? drawer?.approval.requiredIdentity ?? config.lab.delegatedIdentity,
    modalSandboxVerified: false,
    astPass: null,
    tfValidatePass: null,
    gitBranch: drawer?.staging?.branchName ?? null,
    prUrl: null,
    latencyMs,
    execution: executed ? "live-graph-and-arm-reverted" : execution === "simulated" ? "simulated" : "none",
    detail: `${executed ? "inverse executed" : execution === "simulated" ? "inverse simulated" : "inverse staged"} · ${inverse.sections.join(", ") || "no section"} · read-back ${canary ? (canary.matchesPreSnapshot ? "matches snapshot" : `${canary.differences.length} difference(s)`) : "skipped"}`.slice(0, 300),
  });
  telemetry.record({
    requestId: telemetry.nextRequestId("t0"),
    endpoint: "/api/rollback",
    tier: "Tier 0",
    provider: "local",
    modelId: "deterministic",
    latencyMs,
    tokensUsed: { ...ZERO_USAGE },
    fallbackChain: [],
    tenantId: convergence.tenantId,
  });
  return finish({ executed, execution, reason, inverseSource: "pre-snapshot", rollback: inverse, executionLog: log, canary, preSnapshotAt: snapshot.capturedAt, convergenceCleared });
}
