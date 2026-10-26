import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import {
  ActionApprovalDrawerSchema,
  RemediationBundleArgsSchema,
  TENANT_REGISTRY,
  formatIssues,
  getRemediationBundleToolDefinition,
  parseToolArguments,
  zodToToolParameters,
  type ActionApprovalDrawer,
  type AuditEntry,
  type Convergence,
  type OpenAIFunctionTool,
  type RemediationBundleArgs,
  type RouterTelemetry,
  type TenantId,
  type VerificationStatus,
} from "@contextpane/catalog";
import { msgraphService } from "@contextpane/mcp-msgraph";
import { config, models, providers } from "../config.ts";
import { buildRemediationBundle } from "../local/remediate.ts";
import { contextForModel, gatherContext, invalidateContext, type CorrelationContext } from "../mcp/context.ts";
import { runLocalPreflight } from "../preflight/local.ts";
import { modalConfigured, modalWarm, runModalPreflight, warmModalSandbox } from "../preflight/modal.ts";
import { githubRepoUrl, openPullRequest, stageRemediationBranch } from "../preflight/staging.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { auditLedger } from "../store/audit.ts";
import { convergenceStore } from "../store/convergence.ts";
import { remediationStore } from "../store/remediations.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { progressReporter, type ProgressSink } from "./progress.ts";

export interface RemediateInput {
  tenantId: string;
  fresh?: boolean;
}

export interface RemediateResult {
  drawer: ActionApprovalDrawer;
  telemetry: RouterTelemetry;
}

/* ------------------------------ Tier 3A planner ---------------------------- */

const PlanArgsSchema = z.object({
  steps: z.array(z.string().max(300)).min(1).max(8).describe("Ordered remediation steps, each one concrete action"),
  rollback: z.array(z.string().max(300)).max(6).default([]),
  risks: z.array(z.string().max(300)).max(6).default([]),
});
type PlanArgs = z.infer<typeof PlanArgsSchema>;

const PLAN_TOOL: OpenAIFunctionTool = {
  type: "function",
  function: {
    name: "emit_remediation_plan",
    description: "Plan the remediation for a correlated Microsoft 365 / Entra / Azure escalation. Concrete, ordered, reversible.",
    parameters: zodToToolParameters(PlanArgsSchema),
  },
};

const PLANNER_PROMPT = `You are ContextPane's remediation planner (Tier 3A) for a managed service provider.
Given the correlated escalation context, produce an ordered plan that (1) fixes license drift with Set-MgUserLicense, (2) neutralises the blocking Conditional Access policy safely by excluding the entitlement group and moving the policy to report-only with Update-MgIdentityConditionalAccessPolicy, and (3) reconciles Azure NSG drift back to the Terraform baseline (remove rogue rules, restore tags).
Each step, rollback and risk is one sentence of at most 200 characters; name the cmdlet and the entity, not the full parameter list.
Respond only through emit_remediation_plan. Never plan destructive actions (no user/group/resource deletion).`;

/** The plan is display-only, so an over-long sentence is clipped rather than costing the whole plan. */
function clipPlanText(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clip = (v: unknown) => (Array.isArray(v) ? v.map((s) => (typeof s === "string" && s.length > 300 ? `${s.slice(0, 299)}…` : s)) : v);
  const plan = raw as Record<string, unknown>;
  return { ...plan, steps: clip(plan.steps), rollback: clip(plan.rollback), risks: clip(plan.risks) };
}

const CODER_PROMPT = `You are ContextPane's remediation coder (Tier 3B). Produce the exact artefacts a human will approve:
1. powershellScript: a complete PowerShell 7 script with [CmdletBinding(SupportsShouldProcess)], Microsoft.Graph cmdlets only. It MUST use Set-MgUserLicense for every drifted user and Update-MgIdentityConditionalAccessPolicy for the policy change, wrap mutations in $PSCmdlet.ShouldProcess, and fail fast if Get-MgContext is missing or the tenant id differs.
2. terraformDiff: a unified diff (---/+++ headers, @@ hunks) that transforms the live NSG state into the Terraform baseline. A reference diff is supplied; reproduce it exactly unless it is wrong.
Use only identifiers from the context. A deterministic reference bundle is supplied: match its cmdlets and entities, improve clarity where useful. Respond only through emit_remediation_bundle.`;

function metaStep(modelId: string): ChainStep {
  return { provider: "meta", modelId, hasKey: providers.meta.hasKey };
}

function bundleIsSound(bundle: RemediationBundleArgs, reference: RemediationBundleArgs): string[] {
  const issues: string[] = [];
  const ps = bundle.powershellScript;
  if (!/Set-MgUserLicense/i.test(ps)) issues.push("powershellScript lacks Set-MgUserLicense");
  if (/Update-MgIdentityConditionalAccessPolicy/i.test(reference.powershellScript) && !/Update-MgIdentityConditionalAccessPolicy/i.test(ps)) {
    issues.push("powershellScript lacks Update-MgIdentityConditionalAccessPolicy");
  }
  if (!/^---\s/m.test(bundle.terraformDiff) || !/^\+\+\+\s/m.test(bundle.terraformDiff) || !/^@@/m.test(bundle.terraformDiff)) {
    issues.push("terraformDiff is not a unified diff");
  }
  for (const e of reference.affectedEntities.filter((x) => x.type === "upn")) {
    if (!ps.includes(e.id)) issues.push(`powershellScript does not mention ${e.id}`);
  }
  return issues;
}

/**
 * Tier 3A + 3B — agentic remediation with a verifiable pre-flight sandbox.
 * Only triggered by an explicit "Generate Fix & Stage PR" click.
 */
export async function remediate(input: RemediateInput, sink?: ProgressSink): Promise<RemediateResult> {
  const started = performance.now();
  const requestId = telemetry.nextRequestId("t3");
  const report = progressReporter(sink);
  const remediationId = `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // The sandbox container boots while muse-wonder plans and codes, so the pre-flight below starts warm.
  warmModalSandbox("remediate");
  report("mcp:start", "Refreshing MCP context");
  const ctx = await gatherContext(input.tenantId, { fresh: input.fresh ?? true });
  report("mcp:done", `Context ready (${ctx.gatherLatencyMs} ms)`, { sources: ctx.sourcesUsed });

  const reference = buildRemediationBundle(ctx);
  let bundle: RemediationBundleArgs = reference;
  let usage: TokenUsage = { ...ZERO_USAGE };
  let provider: RouterTelemetry["provider"] = "local";
  let planner = "deterministic";
  let coder = "deterministic";
  const chain: RouterTelemetry["fallbackChain"] = [];

  if (!config.forceLocal && providers.meta.hasKey) {
    const model = contextForModel(ctx);
    /* ---- 3A: plan with muse-wonder ---- */
    report("plan:start", `Tier 3A · ${models.metaWonder} planning remediation`);
    const planOutcome = await runChain([metaStep(models.metaWonder)], async (step) => {
      const result = await chatWithForcedTool(
        providers.meta,
        step.modelId,
        [
          { role: "system", content: PLANNER_PROMPT },
          { role: "user", content: JSON.stringify({ context: model, referenceSummary: reference.summary }) },
        ],
        PLAN_TOOL,
        { timeoutMs: config.timeouts.remediateMs, temperature: 0.1, maxTokens: 4000, reasoningEffort: config.reasoning.remediate },
      );
      const parsed = PlanArgsSchema.safeParse(clipPlanText(parseToolArguments(result.argumentsRaw)));
      if (!parsed.success) throw new InvalidSchemaError("plan failed validation", formatIssues(parsed.error));
      return { plan: parsed.data, usage: result.usage };
    });
    chain.push(...planOutcome.chain);
    let plan: PlanArgs | null = null;
    if (planOutcome.result) {
      plan = planOutcome.result.plan;
      usage = addUsage(usage, planOutcome.result.usage);
      planner = models.metaWonder;
      report("plan:done", `Plan: ${plan.steps.length} steps`, { steps: plan.steps });
    } else {
      report("plan:fallback", "Planner unavailable → deterministic plan");
    }

    /* ---- 3B: code with muse-code ---- */
    report("code:start", `Tier 3B · ${models.metaCode} synthesising PowerShell + Terraform`);
    const tool = getRemediationBundleToolDefinition();
    const codeOutcome = await runChain([metaStep(models.metaCode)], async (step) => {
      const result = await chatWithForcedTool(
        providers.meta,
        step.modelId,
        [
          { role: "system", content: CODER_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              plan: plan ?? { steps: ["Follow the deterministic reference bundle"] },
              context: { ...model, azureNsgDrift: { ...model.azureNsgDrift } },
              referenceBundle: reference,
            }),
          },
        ],
        tool,
        { timeoutMs: config.timeouts.remediateMs, temperature: 0, maxTokens: 12000, reasoningEffort: config.reasoning.remediate },
      );
      const parsed = RemediationBundleArgsSchema.safeParse(parseToolArguments(result.argumentsRaw));
      if (!parsed.success) throw new InvalidSchemaError("bundle failed validation", formatIssues(parsed.error));
      const issues = bundleIsSound(parsed.data, reference);
      if (issues.length) throw new InvalidSchemaError("bundle failed structural checks", issues);
      return { bundle: parsed.data, usage: result.usage };
    });
    chain.push(...codeOutcome.chain);
    if (codeOutcome.result) {
      bundle = codeOutcome.result.bundle;
      usage = addUsage(usage, codeOutcome.result.usage);
      provider = "meta";
      coder = models.metaCode;
      report("code:done", "Model bundle accepted");
    } else {
      report("code:fallback", "Coder unavailable or rejected → deterministic bundle");
    }
  } else {
    chain.push(
      { provider: "meta", modelId: models.metaWonder, outcome: config.forceLocal ? "skipped" : "no-key", latencyMs: 0 },
      { provider: "meta", modelId: models.metaCode, outcome: config.forceLocal ? "skipped" : "no-key", latencyMs: 0 },
    );
    report("llm:skip", config.forceLocal ? "CTX_FORCE_LOCAL=true → deterministic bundle" : "No META_API_KEY → deterministic bundle");
  }

  /* ---- pre-flight ---- */
  const preflightInput = {
    powershellScript: bundle.powershellScript,
    terraformDiff: bundle.terraformDiff,
    actualHcl: ctx.drift.data.actualHcl,
    expectedHcl: ctx.drift.data.expectedHcl,
  };
  let verification: VerificationStatus;
  if (modalConfigured()) {
    report("preflight:start", "Pre-flight in Modal sandbox");
    try {
      await modalWarm();
      verification = await runModalPreflight(preflightInput);
    } catch (error) {
      report("preflight:fallback", `Modal sandbox failed (${error instanceof Error ? error.message : String(error)}) → local pre-flight`);
      verification = await runLocalPreflight(preflightInput);
      verification.findings.unshift("Modal sandbox unavailable; validated locally instead");
    }
  } else {
    report("preflight:start", "Pre-flight: PowerShell AST parse + terraform fmt/validate (local)");
    verification = await runLocalPreflight(preflightInput);
  }
  report("preflight:done", `${verification.verdict} in ${verification.validationLatencyMs} ms`, { ...verification });

  /* ---- stage PR branch ---- */
  report("stage:start", "Staging remediation on a git branch");
  const { staging, findings: stagingFindings } = await stageRemediationBranch({
    ticketId: ctx.ticketId,
    tenantName: ctx.erp.tenant.displayName,
    remediationId,
    title: bundle.title,
    prTitle: canonicalPrTitle(ctx.tenantId, ctx.ticketId, ctx.erp.tenant.displayName),
    summary: bundle.summary,
    powershellScript: bundle.powershellScript,
    terraformDiff: bundle.terraformDiff,
    terraformFile: ctx.drift.data.terraformFile,
    verificationSummary: `${verification.verdict} · AST ${fmt(verification.astCheckPassed)} · terraform fmt ${fmt(verification.terraformFmtPassed)} · terraform validate ${fmt(verification.terraformValidatePassed)} · ${verification.sandboxProvider} · ${verification.validationLatencyMs} ms`,
  });
  if (stagingFindings.length) verification.findings.push(...stagingFindings);
  report("stage:done", staging ? `Branch ${staging.branchName} @ ${staging.commitSha?.slice(0, 7)}` : "Staging skipped", { ...(staging ?? {}) });

  const latencyMs = Math.round(performance.now() - started);
  const tier: RouterTelemetry["tier"] = "Tier 3B";
  const drawer = ActionApprovalDrawerSchema.parse({
    remediationId,
    ticketId: ctx.ticketId,
    tenantId: ctx.tenantId,
    title: bundle.title,
    summary: bundle.summary,
    synthesizedBy: { planner, coder, provider },
    powershellScript: bundle.powershellScript,
    terraformDiff: bundle.terraformDiff,
    affectedEntities: bundle.affectedEntities,
    verificationStatus: verification,
    staging,
    approval: { state: "pending", requiredIdentity: config.lab.delegatedIdentity, approvedBy: null, approvedAt: null },
    providerTelemetry: { tier, provider, modelId: provider === "local" ? "deterministic" : planner === coder ? coder : `${planner} + ${coder}`, latencyMs, tokensUsed: usage.total },
  });
  remediationStore.save(drawer);
  auditLedger.append({
    ...verificationProof(drawer),
    actionType: "remediation-verified",
    delegatedIdentity: drawer.approval.requiredIdentity,
    latencyMs: verification.validationLatencyMs,
    detail: `${verification.verdict} · ${verification.sandboxProvider} · ${drawer.affectedEntities.length} entities`,
  });

  const event = telemetry.record({
    requestId,
    endpoint: "/api/remediate",
    tier,
    provider,
    modelId: drawer.providerTelemetry.modelId,
    latencyMs,
    tokensUsed: usage,
    fallbackChain: chain,
    tenantId: input.tenantId,
  });
  report("complete", `Remediation ${remediationId} ready for approval`, { remediationId, verdict: verification.verdict, branch: staging?.branchName ?? null });
  return { drawer, telemetry: event };
}

/** The verification fields every audit entry about a remediation carries. */
function verificationProof(drawer: ActionApprovalDrawer): Pick<AuditEntry, "tenantId" | "ticketId" | "modalSandboxVerified" | "astPass" | "tfValidatePass" | "gitBranch" | "prUrl"> {
  const v = drawer.verificationStatus;
  return {
    tenantId: drawer.tenantId,
    ticketId: drawer.ticketId,
    modalSandboxVerified: v.sandboxProvider === "modal-cloud-sandbox" && v.verdict !== "Verification Failed" && v.verdict !== "Pending",
    astPass: v.astCheckPassed,
    tfValidatePass: v.terraformValidatePassed,
    gitBranch: drawer.staging?.branchName ?? null,
    prUrl: drawer.staging?.prUrl ?? null,
  };
}

function fmt(v: boolean | null): string {
  return v === null ? "skipped" : v ? "pass" : "FAIL";
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { prompt: a.prompt + b.prompt, completion: a.completion + b.completion, total: a.total + b.total };
}

/* --------------------------------- approval -------------------------------- */

export interface ApproveInput {
  remediationId: string;
  approvedBy?: string;
  decision?: "approve" | "reject";
  /** Push the staged branch and `gh pr create` (defaults to CTX_GH_PR_ON_APPROVE). */
  openPullRequest?: boolean;
}

/** One PR title per ticket, so the canonical branch keeps one PR however often the demo runs. */
export function canonicalPrTitle(tenantId: string, ticketId: string, tenantName: string): string {
  const scope = TENANT_REGISTRY[tenantId as TenantId]?.remediationScope ?? "infrastructure drift & license state";
  return `fix(${ticketId}): remediate ${tenantName} ${scope} [ContextPane Tier 3]`;
}

interface TerraformDiffSummary {
  removedRules: { name: string; priority?: string; direction?: string; access?: string; protocol?: string; port?: string; source?: string }[];
  tagChanges: { key: string; from: string | null; to: string | null }[];
}

/** Reads the removed security_rule blocks and the changed tags out of the unified NSG diff. */
export function summarizeTerraformDiff(diff: string): TerraformDiffSummary {
  const removedRules: TerraformDiffSummary["removedRules"] = [];
  const removedTags = new Map<string, string>();
  const addedTags = new Map<string, string>();
  const ruleFields: Record<string, "priority" | "direction" | "access" | "protocol" | "port" | "source"> = {
    priority: "priority",
    direction: "direction",
    access: "access",
    protocol: "protocol",
    destination_port_range: "port",
    source_address_prefix: "source",
  };
  let rule: TerraformDiffSummary["removedRules"][number] | null = null;
  for (const line of diff.split("\n")) {
    if (/^(---|\+\+\+)\s/.test(line)) continue;
    const attr = /^([-+])\s*([A-Za-z_]\w*)\s*=\s*"?([^"]*?)"?\s*$/.exec(line);
    const sign = attr?.[1];
    const key = attr?.[2] ?? "";
    const value = attr?.[3] ?? "";
    if (rule) {
      // A removed security_rule block is a run of "-" lines that ends at its closing brace.
      if (!line.startsWith("-") || /^-\s*}/.test(line)) {
        removedRules.push(rule);
        rule = null;
      } else {
        const field = ruleFields[key];
        if (field) rule[field] = value;
        continue;
      }
    }
    if (!attr) continue;
    if (sign === "-" && key === "name") rule = { name: value };
    // Tag keys are PascalCase in this repo; HCL attributes are snake_case.
    else if (/^[A-Z]/.test(key)) (sign === "-" ? removedTags : addedTags).set(key, value);
  }
  if (rule) removedRules.push(rule);
  const tagChanges = [...new Set([...removedTags.keys(), ...addedTags.keys()])]
    .map((key) => ({ key, from: removedTags.get(key) ?? null, to: addedTags.get(key) ?? null }))
    .filter((t) => t.from !== t.to);
  return { removedRules, tagChanges };
}

function check(v: boolean | null): string {
  return v === null ? "⏭️ skipped" : v ? "✅ pass" : "❌ FAIL";
}

function ms(v: number | undefined): string {
  return v === undefined ? "–" : `${Math.round(v)} ms`;
}

export function pullRequestBody(drawer: ActionApprovalDrawer, state: string, log: string[], ctx: CorrelationContext | null, repoUrl: string | null): string {
  const v = drawer.verificationStatus;
  const registry = TENANT_REGISTRY[drawer.tenantId as TenantId];
  const tenantName = ctx?.erp.tenant.displayName ?? registry?.displayName ?? drawer.tenantId;
  const contractId = ctx?.erp.contract.contractId ?? registry?.contractId ?? "n/a";
  const files = drawer.staging?.filesChanged ?? [];
  const link = (path: string | undefined) =>
    path ? (repoUrl && drawer.staging ? `[\`${path}\`](${repoUrl}/blob/${drawer.staging.branchName}/${path})` : `\`${path}\``) : null;
  const scriptPath = files.find((f) => f.endsWith(".ps1"));
  const patchPath = files.find((f) => f.endsWith(".patch"));
  const readmePath = files.find((f) => f.endsWith(".md"));
  const upns = drawer.affectedEntities.filter((e) => e.type === "upn");
  const policies = drawer.affectedEntities.filter((e) => e.type === "policy");
  const nsg = summarizeTerraformDiff(drawer.terraformDiff);
  const nsgName = ctx?.drift.data.resourceName ?? drawer.affectedEntities.find((e) => e.type === "resource")?.id.split("/")[0] ?? "the NSG";

  const correlation: string[] = [];
  if (ctx) {
    const t = ctx.erp.ticket;
    const c = ctx.erp.contract;
    const lic = ctx.license.data;
    const line = c.lines.find((l) => l.skuPartNumber === lic.sku.skuPartNumber) ?? c.lines.find((l) => l.semanticAnchor);
    const policy = ctx.policies.data.find((p) => policies.some((e) => e.id.toLowerCase() === p.id.toLowerCase()));
    correlation.push(
      "| | |",
      "|---|---|",
      `| **ERP ticket** | **#${t.ticketId}** · ${t.severity} · ${t.title} · SLA breach ${t.slaBreachAt} |`,
      `| **Contract** | **#${c.contractId}** · ${c.title} · ${c.slaTier} SLA |`,
      `| **Requester** | ${t.requester.displayName} (\`${t.requester.upn}\`), ${t.requester.role} |`,
      ...(line ? [`| **Entitlement** | ${line.quantity} × ${line.skuName} (\`${line.skuPartNumber}\`)${line.entitlementGroup ? ` via \`${line.entitlementGroup}\`` : ""} |`] : []),
      `| **License drift** | ${upns.length} user${upns.length === 1 ? "" : "s"} billed for ${lic.sku.skuPartNumber} but not assigned it |`,
      ...(policy ? [`| **Blocking CA policy** | ${policy.displayName} (\`${policy.id}\`, ${policy.state}) |`] : []),
      `| **NSG drift** | \`${nsgName}\` (${ctx.drift.data.terraformFile}) |`,
    );
  } else {
    correlation.push(`**#${drawer.ticketId}** × **#${contractId}** · ${tenantName}`);
  }

  return [
    `## #${drawer.ticketId} × #${contractId} · ${tenantName}`,
    "",
    drawer.summary,
    "",
    "> Staged by **ContextPane Tier 3** and opened only after a human approved it in the Action Approval drawer.",
    "> The pipeline never runs the PowerShell itself (`CTX_ALLOW_EXECUTE=false`); it is here for review and a manual, delegated run.",
    "",
    "### Ticket × contract correlation",
    "",
    ...correlation,
    "",
    "### Modal cloud sandbox pre-flight",
    "",
    "| Check | Result | Time in sandbox |",
    "|---|---|---|",
    `| PowerShell AST parse + cmdlet allow-list | ${check(v.astCheckPassed)} | ${ms(v.checkLatencyMs?.powershellAst)} |`,
    `| \`terraform fmt -check\` | ${check(v.terraformFmtPassed)} | ${ms(v.checkLatencyMs?.terraformFmt)} |`,
    `| \`terraform validate\` (diff applied to the live NSG state) | ${check(v.terraformValidatePassed)} | ${ms(v.checkLatencyMs?.terraformValidate)} |`,
    `| **Verdict: ${v.verdict}** | \`${v.sandboxProvider}\` | ${ms(v.sandboxLatencyMs)} in the container · ${ms(v.validationLatencyMs)} round trip |`,
    ...(v.findings.length ? ["", ...v.findings.map((f) => `- ${f}`)] : []),
    "",
    `### Infrastructure drift reconciled on \`${nsgName}\``,
    "",
    ...nsg.removedRules.map((r) => {
      const traffic = [r.direction, r.access, r.protocol && r.port ? `${r.protocol.toUpperCase()}/${r.port}` : null, r.source ? `from \`${r.source}\`` : null].filter(Boolean).join(" ");
      const detail = [r.priority ? `priority ${r.priority}` : null, traffic || null].filter(Boolean).join(", ");
      return `- Removed rogue rule **\`${r.name}\`**${detail ? ` (${detail})` : ""}`;
    }),
    ...nsg.tagChanges.map((t) =>
      t.from && t.to ? `- Restored tag \`${t.key} = "${t.to}"\` (was \`"${t.from}"\`)` : t.to ? `- Added tag \`${t.key} = "${t.to}"\`` : `- Removed out-of-band tag \`${t.key} = "${t.from}"\``,
    ),
    ...(patchPath ? [`- Unified diff: ${link(patchPath)}`] : []),
    "",
    "### Identity & licensing remediation (PowerShell)",
    "",
    ...(scriptPath ? [`Script: ${link(scriptPath)}`, ""] : []),
    ...upns.map((e) => `- \`Set-MgUserLicense\` · ${e.id}: ${e.change}`),
    ...policies.map((e) => `- \`Update-MgIdentityConditionalAccessPolicy\` · \`${e.id}\`: ${e.change}`),
    "",
    "```powershell",
    "Connect-MgGraph -Scopes User.ReadWrite.All, Group.Read.All, Policy.Read.All, Policy.ReadWrite.ConditionalAccess",
    ...(scriptPath ? [`pwsh -NoProfile -File ./${scriptPath} -WhatIf   # dry run`, `pwsh -NoProfile -File ./${scriptPath}           # execute as the delegated identity`] : []),
    "```",
    ...(readmePath ? ["", `Runbook: ${link(readmePath)}`] : []),
    "",
    "### Approval & audit",
    "",
    `- Approved by **${drawer.approval.approvedBy ?? drawer.approval.requiredIdentity}** at ${drawer.approval.approvedAt ?? "n/a"} → \`${state}\``,
    `- Remediation \`${drawer.remediationId}\`${drawer.staging?.commitSha ? ` · commit \`${drawer.staging.commitSha.slice(0, 7)}\`` : ""}`,
    ...log.map((l) => `- ${l}`),
    "",
    `_Synthesised by ContextPane Tier 3 (${drawer.synthesizedBy.planner} → ${drawer.synthesizedBy.coder}, ${drawer.synthesizedBy.provider}). Every run force-updates this ticket's branch, so this PR always shows the latest approved remediation._`,
    "",
  ].join("\n");
}

export type ApproveResult = ActionApprovalDrawer & { executionLog: string[]; convergence: Convergence | null };

export async function approve(input: ApproveInput): Promise<ApproveResult> {
  const started = performance.now();
  const drawer = remediationStore.get(input.remediationId);
  if (!drawer) throw new Error(`Remediation '${input.remediationId}' not found`);
  const log: string[] = [];
  const now = new Date().toISOString();

  if (input.decision === "reject") {
    const updated = { ...drawer, approval: { ...drawer.approval, state: "rejected" as const, approvedBy: input.approvedBy ?? null, approvedAt: now } };
    remediationStore.save(updated);
    auditLedger.append({
      ...verificationProof(updated),
      actionType: "hitl-rejection",
      delegatedIdentity: input.approvedBy ?? drawer.approval.requiredIdentity,
      latencyMs: Math.round(performance.now() - started),
      detail: "Rejected by operator; nothing executed",
    });
    return { ...updated, executionLog: ["Rejected by operator"], convergence: null };
  }
  if (drawer.verificationStatus.verdict === "Verification Failed") {
    throw new Error("Cannot approve a bundle whose pre-flight verification failed");
  }

  const upns = drawer.affectedEntities.filter((e) => e.type === "upn").map((e) => e.id);
  const wantPullRequest = input.openPullRequest ?? config.github.prOnApprove;
  // The PR body quotes the ticket and contract; read them before the Graph write invalidates the context.
  const prContext = wantPullRequest ? await gatherContext(drawer.tenantId).catch(() => null) : null;
  let state: ActionApprovalDrawer["approval"]["state"] = "approved";
  let execution: Convergence["execution"] = "simulated";
  if (config.liveCloudMode) {
    if (config.allowExecute) {
      log.push("LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE → running the approved script via the delegated identity");
      const script = await runApprovedScript(drawer);
      log.push(...script.log);
    }
    // The lab models each user's license in the com.contextpane.licenseState open extension; one Graph $batch flips it.
    const write = await msgraphService.setLicenseExtensionState(drawer.tenantId, upns, "remediated");
    const failed = write.results.filter((r) => !r.ok);
    if (write.source === "live-graph") {
      log.push(`Graph $batch: ${write.results.length - failed.length}/${write.results.length} users → SPE_E5 / Compliant in ${write.latencyMs} ms`);
      for (const f of failed) log.push(`  ${f.upn}: HTTP ${f.status} ${f.error ?? ""}`.trimEnd());
      if (!failed.length) {
        state = "executed";
        execution = "live-graph";
      }
    } else {
      log.push(`Graph write simulated (${write.fallbackReason})`);
      state = "simulated";
    }
    invalidateContext(drawer.tenantId);
  } else {
    state = "simulated";
    log.push("Offline mode: approval recorded, execution simulated (no Graph context). Branch stays staged for the PR.");
  }

  let updated: ActionApprovalDrawer = {
    ...drawer,
    approval: { ...drawer.approval, state, approvedBy: input.approvedBy ?? drawer.approval.requiredIdentity, approvedAt: now },
  };

  /* ---- optional: real GitHub PR on the staged branch ---- */
  if (wantPullRequest) {
    if (updated.staging) {
      const pr = await openPullRequest(updated.staging, pullRequestBody(updated, state, log, prContext, await githubRepoUrl()));
      log.push(...pr.log);
      updated = { ...updated, staging: pr.staging };
    } else {
      log.push("No staged branch to open a PR from");
    }
  }

  remediationStore.save(updated);
  const latencyMs = Math.round(performance.now() - started);
  const convergence: Convergence = {
    tenantId: updated.tenantId,
    remediationId: updated.remediationId,
    ticketId: updated.ticketId,
    convergedAt: new Date().toISOString(),
    latencyMs,
    prUrl: updated.staging?.prUrl ?? null,
    gitBranch: updated.staging?.branchName ?? null,
    execution,
    remediatedUpns: upns,
  };
  convergenceStore.set(convergence);
  log.push(`Canvas converged via notifications/resources/updated (Tier 0, 0 tokens) · ${latencyMs} ms end to end`);
  auditLedger.append({
    ...verificationProof(updated),
    actionType: "hitl-approval",
    delegatedIdentity: updated.approval.approvedBy ?? updated.approval.requiredIdentity,
    latencyMs,
    execution,
    detail: `${state} · ${upns.length} users → SPE_E5${updated.staging?.prUrl ? " · PR opened" : ""}`,
  });
  telemetry.record({
    requestId: telemetry.nextRequestId("t0"),
    endpoint: "/api/remediate/approve",
    tier: "Tier 0",
    provider: "local",
    modelId: "deterministic",
    latencyMs,
    tokensUsed: { ...ZERO_USAGE },
    fallbackChain: [],
    tenantId: updated.tenantId,
  });
  return { ...updated, executionLog: log, convergence };
}

/** CTX_ALLOW_EXECUTE only: the approved PowerShell itself, as the signed-in delegated identity. */
async function runApprovedScript(drawer: ActionApprovalDrawer): Promise<{ ok: boolean; log: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "ctx-exec-"));
  const file = join(dir, `Invoke-Remediate-${drawer.ticketId}.ps1`);
  writeFileSync(file, drawer.powershellScript, "utf8");
  try {
    const result = await runProcess("pwsh", ["-NoProfile", "-NonInteractive", "-File", file], 120_000);
    const log = result.stdout.split("\n").filter(Boolean).slice(-20);
    if (result.code !== 0) log.push(`pwsh exited ${result.code}: ${result.stderr.split("\n").slice(-3).join(" | ")}`);
    return { ok: result.code === 0, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: stderr + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}
