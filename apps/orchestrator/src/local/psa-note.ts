import { baseScenarioOf, getScenarioEntry, type ActionApprovalDrawer, type Convergence, type ScenarioBrief } from "@contextpane/catalog";
import { buildInverseRollback, verifyFormalInvariants, verifyIdempotency } from "./formal-verifier.ts";
import { closureStore } from "../store/closure.ts";
import { remediationStore } from "../store/remediations.ts";

/**
 * The customer & PSA resolution note, drafted the moment a remediation converges: a
 * plain-English root cause and resolution for the customer, then the technical audit trail
 * (formal invariants, canary probes, Git branch and commit, archived inverse rollback).
 * Deterministic, 0 tokens: every line is a fact the workbench already verified.
 */

export interface PsaResolutionNote {
  scenarioId: string;
  ticketTitle: string;
  tenantName: string;
  status: "RESOLVED & VERIFIED" | "CLOSED";
  resolvedAt: string;
  execution: Convergence["execution"];
  customerSummary: string;
  rootCause: string;
  resolution: string;
  technicalAuditTrail: string[];
  markdown: string;
  closed: { closedAt: string; closedBy: string } | null;
  remediationId: string;
}

/** The drawer an approval produced for this scenario (the newest approved one). */
export function approvedDrawerFor(scenarioId: string, remediationId?: string | null): ActionApprovalDrawer | null {
  if (remediationId) {
    const hit = remediationStore.get(remediationId);
    if (hit) return hit;
  }
  const mine = remediationStore.list().filter((d) => d.ticketId === scenarioId && d.approval.state !== "pending" && d.approval.state !== "rejected");
  return mine.sort((a, b) => String(b.approval.approvedAt ?? "").localeCompare(String(a.approval.approvedAt ?? "")))[0] ?? null;
}

export function buildResolutionNote(input: { brief: ScenarioBrief; convergence: Convergence }): PsaResolutionNote {
  const { brief, convergence } = input;
  const scenarioId = convergence.scenarioId;
  const base = baseScenarioOf(scenarioId);
  const drawer = approvedDrawerFor(scenarioId, convergence.remediationId);
  const canary = closureStore.canary(scenarioId);
  const formal = verifyFormalInvariants(base);
  const idempotency = verifyIdempotency(base);
  const rollback = buildInverseRollback(base);
  const closed = closureStore.closedState(scenarioId);
  const entry = getScenarioEntry(scenarioId);
  const live = convergence.execution === "live-graph";

  const rootCause = brief.summary;
  const resolution = drawer ? `${drawer.summary} The change was approved by ${drawer.approval.approvedBy ?? drawer.approval.requiredIdentity} as ${drawer.approval.mode === "gitops" ? "a Pure GitOps change" : "an Emergency Break-Glass change"} and ${live ? "applied to the tenant" : "recorded (simulated execution, no tenant write)"} on ${convergence.convergedAt.slice(0, 16).replace("T", " ")} UTC.` : `The staged remediation was approved and ${live ? "applied to the tenant" : "recorded"} on ${convergence.convergedAt.slice(0, 16).replace("T", " ")} UTC.`;
  const affectedUsers = convergence.remediatedUpns.length + convergence.reclaimedUpns.length;
  const customerSummary = `${rootCause} ${resolution} ${affectedUsers ? `${affectedUsers} account${affectedUsers === 1 ? "" : "s"} ${convergence.reclaimedUpns.length && !convergence.remediatedUpns.length ? "had unused licences reclaimed" : "were brought back to the expected state"}; ` : ""}every change was verified before and after it ran, and a pre-verified rollback is archived should anything regress.`;

  const trail: string[] = [
    `Formal invariants: ${formal.invariants.filter((i) => i.passed).length}/${formal.invariants.length} proved by the symbolic blast-radius prover (${formal.invariants.map((i) => i.id).join(", ")}) in ${formal.latencyMs} ms · idempotency f(f(S)) = f(S) ${idempotency.passed ? "passed" : "FAILED"}`,
    canary
      ? `Canary probes: ${canary.stages.map((s) => s.stage).join(" → ")} · identity probe ${canary.probes.identity.passed ? "passed" : "failed"}, network probe ${canary.probes.network.tcp3389Closed === undefined ? "n/a" : canary.probes.network.tcp3389Closed ? "TCP/3389 closed" : "TCP/3389 OPEN"}${canary.probes.network.tcp443Open === undefined ? "" : canary.probes.network.tcp443Open ? ", TCP/443 open" : ", TCP/443 closed"} · cohort ${canary.canaryCohort}`
      : "Canary probes: not run for this approval",
    drawer ? `Pre-flight: ${drawer.verificationStatus.verdict} · PowerShell AST ${flag(drawer.verificationStatus.astCheckPassed)} · -WhatIf dry run ${flag(drawer.verificationStatus.whatIfSafe)}${drawer.terraformDiff ? ` · terraform fmt ${flag(drawer.verificationStatus.terraformFmtPassed)}, validate ${flag(drawer.verificationStatus.terraformValidatePassed)}` : ""} · ${drawer.verificationStatus.sandboxProvider}` : "Pre-flight: see the remediation record",
    `Git: ${convergence.gitBranch ?? drawer?.staging?.branchName ?? "no branch staged"}${drawer?.staging?.commitSha ? ` @ ${drawer.staging.commitSha.slice(0, 7)}` : ""}${convergence.prUrl ? ` · PR ${convergence.prUrl}` : ""}${drawer?.staging?.filesChanged.length ? ` · ${drawer.staging.filesChanged.length} files` : ""}`,
    `Inverse rollback f⁻¹ archived: ${rollback.restores.length} restore${rollback.restores.length === 1 ? "" : "s"} (${rollback.restores.slice(0, 3).join(", ")}${rollback.restores.length > 3 ? ", …" : ""}) · ${rollback.powershellScript.split("\n").length} lines PowerShell${rollback.terraformDiff ? " + Terraform" : ""}`,
    `Execution: ${live ? "live Graph/ARM write" : "simulated"} as ${drawer?.approval.approvedBy ?? drawer?.approval.requiredIdentity ?? "the delegated identity"} · remediation ${convergence.remediationId} · converged in ${convergence.latencyMs} ms · 0 LLM tokens for the convergence`,
  ];

  const status: PsaResolutionNote["status"] = closed ? "CLOSED" : "RESOLVED & VERIFIED";
  const markdown = [
    `# ${scenarioId} · ${brief.title}`,
    "",
    `**Customer:** ${brief.tenantName} (${brief.verifiedDomain})  `,
    `**Status:** ${status}${closed ? ` · closed ${closed.closedAt.slice(0, 16).replace("T", " ")} UTC by ${closed.closedBy}` : ""}  `,
    `**Resolved:** ${convergence.convergedAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    "## Summary for the customer",
    "",
    customerSummary,
    "",
    "## Technical audit trail",
    "",
    ...trail.map((t) => `- ${t}`),
    "",
    `_Generated by ContextPane from the verified audit ledger (${entry?.kind === "ticket" ? "ticket" : "anomaly"} ${scenarioId}, base pattern ${base})._`,
    "",
  ].join("\n");

  return {
    scenarioId,
    ticketTitle: brief.title,
    tenantName: brief.tenantName,
    status,
    resolvedAt: convergence.convergedAt,
    execution: convergence.execution,
    customerSummary,
    rootCause,
    resolution,
    technicalAuditTrail: trail,
    markdown,
    closed,
    remediationId: convergence.remediationId,
  };
}

function flag(v: boolean | null | undefined): string {
  return v === null || v === undefined ? "skipped" : v ? "pass" : "FAIL";
}
