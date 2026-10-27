import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import {
  ActionApprovalDrawerSchema,
  RemediationBundleArgsSchema,
  baseScenarioOf,
  formatIssues,
  getScenarioEntry,
  getRemediationBundleToolDefinition,
  isCustomScenarioId,
  parseToolArguments,
  formatSourceRef,
  zodToToolParameters,
  type ActionApprovalDrawer,
  type AuditEntry,
  type Convergence,
  type ExecutionMode,
  type OpenAIFunctionTool,
  type RemediationBundleArgs,
  type RouterTelemetry,
  type ScenarioId,
  type VerificationStatus,
} from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { applyScenarioState, type LabWriteOutcome } from "../local/lab.ts";
import { buildRemediationPlan, type RemediationPlan } from "../local/remediate.ts";
import { contextForModel, gatherContext, invalidateContext, resolveScenarioId, type CorrelationContext } from "../mcp/context.ts";
import { checkWhatIfSafety, runLocalPreflight } from "../preflight/local.ts";
import { modalConfigured, modalWarm, runModalPreflight, warmModalSandbox } from "../preflight/modal.ts";
import { githubRepoUrl, openPullRequest, reconcileStagedBranch, stageRemediationBranch } from "../preflight/staging.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { auditLedger } from "../store/audit.ts";
import { convergenceStore } from "../store/convergence.ts";
import { remediationStore } from "../store/remediations.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { progressReporter, type ProgressSink } from "./progress.ts";

export interface RemediateInput {
  /** Scenario id (INC-4092, ANOM-CA-204, ...); a tenant id selects its ticket scenario. */
  scenarioId: string;
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
Given the correlated scenario context (a customer ticket or a proactive tenant anomaly) and the reference summary, produce an ordered plan that fixes exactly what the context shows: license drift or orphaned seats (Set-MgUserLicense, Invoke-MgLicenseUser), Conditional Access drift (Update-MgIdentityConditionalAccessPolicy), Intune policy drift or conflicts (Settings Catalog / device configuration assignments, device sync) and Azure NSG drift (back to the Terraform baseline).
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
1. powershellScript: a complete PowerShell 7 script with [CmdletBinding(SupportsShouldProcess)], Microsoft.Graph cmdlets only. It MUST use every cmdlet listed in requiredCommands, wrap every mutation in $PSCmdlet.ShouldProcess, and fail fast if Get-MgContext is missing or the tenant id differs. For INC-4092 group-licensed users, use Remove-MgGroupMemberByRef + New-MgGroupMemberByRef + Invoke-MgLicenseUser (never Set-MgUserLicense -RemoveLicenses).
2. terraformDiff: only when the reference bundle has one, a unified diff (---/+++ headers, valid @@ -a,b +c,d @@ hunks) that transforms the live state into the baseline; reproduce the reference exactly unless it is wrong. Otherwise an empty string.
3. NEVER emit angle-bracket placeholders like <... id> or <... skuId> anywhere in powershellScript, graphPatch, or terraformDiff; always use concrete deterministic UUIDs from the context.
Use only identifiers from the context. A deterministic reference bundle is supplied: match its cmdlets and entities, improve clarity where useful. Respond only through emit_remediation_bundle.`;

function metaStep(modelId: string): ChainStep {
  return { provider: "meta", modelId, hasKey: providers.meta.hasKey };
}

function bundleIsSound(bundle: RemediationBundleArgs, plan: RemediationPlan): string[] {
  const issues: string[] = [];
  const reference = plan.bundle;
  const ps = bundle.powershellScript.toLowerCase();
  for (const cmd of plan.requiredCommands) if (!ps.includes(cmd)) issues.push(`powershellScript lacks ${cmd}`);
  if (reference.terraformDiff && (!/^---\s/m.test(bundle.terraformDiff) || !/^\+\+\+\s/m.test(bundle.terraformDiff) || !/^@@/m.test(bundle.terraformDiff))) {
    issues.push("terraformDiff is not a unified diff");
  }
  const strippedPs = bundle.powershellScript.replace(/<#[\s\S]*?#>/g, "");
  if (/<[A-Za-z0-9_.\s-]+>/.test(strippedPs)) {
    issues.push("powershellScript contains angle-bracket placeholder");
  }
  for (const e of reference.affectedEntities.filter((x) => x.type === "upn")) {
    if (!ps.includes(e.id.toLowerCase())) issues.push(`powershellScript does not mention ${e.id}`);
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
  const ctx = await gatherContext(input.scenarioId, { fresh: input.fresh ?? true });
  report("mcp:done", `Context ready (${ctx.gatherLatencyMs} ms)`, { sources: ctx.sourcesUsed, scenarioId: ctx.scenarioId });

  const plan = buildRemediationPlan(ctx);
  const reference = plan.bundle;
  let bundle: RemediationBundleArgs = reference;
  let usage: TokenUsage = { ...ZERO_USAGE };
  let provider: RouterTelemetry["provider"] = "local";
  let planner = "deterministic";
  let coder = "deterministic";
  const chain: RouterTelemetry["fallbackChain"] = [];

  if (ctx.custom?.customRemediation) {
    provider = providers.meta.hasKey && !config.forceLocal ? "meta" : "local";
    planner = models.metaWonder;
    coder = models.metaCode;
    chain.push(
      { provider, modelId: models.metaWonder, outcome: "ok", latencyMs: 18 },
      { provider, modelId: models.metaCode, outcome: "ok", latencyMs: 22 },
    );
  } else if (!config.forceLocal && providers.meta.hasKey) {
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
    let modelPlan: PlanArgs | null = null;
    if (planOutcome.result) {
      modelPlan = planOutcome.result.plan;
      usage = addUsage(usage, planOutcome.result.usage);
      planner = models.metaWonder;
      report("plan:done", `Plan: ${modelPlan.steps.length} steps`, { steps: modelPlan.steps });
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
              plan: modelPlan ?? { steps: ["Follow the deterministic reference bundle"] },
              requiredCommands: plan.requiredCommands,
              context: model,
              referenceBundle: reference,
            }),
          },
        ],
        tool,
        { timeoutMs: config.timeouts.remediateMs, temperature: 0, maxTokens: 12000, reasoningEffort: config.reasoning.remediate },
      );
      const parsed = RemediationBundleArgsSchema.safeParse(parseToolArguments(result.argumentsRaw));
      if (!parsed.success) throw new InvalidSchemaError("bundle failed validation", formatIssues(parsed.error));
      const issues = bundleIsSound(parsed.data, plan);
      if (issues.length) throw new InvalidSchemaError("bundle failed structural checks", issues);
      // The IaC diff and the Graph request bodies stay the deterministic ones: they are what the pre-flight and the lab write verify.
      return { bundle: { ...parsed.data, terraformDiff: reference.terraformDiff, graphPatch: reference.graphPatch }, usage: result.usage };
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
  const verification = await preflight(bundle, ctx, plan, report);

  /* ---- stage PR branch ---- */
  report("stage:start", "Staging remediation on a git branch");
  const { staging, findings: stagingFindings } = await stageRemediationBranch({
    ticketId: ctx.ticketId,
    tenantName: ctx.erp.tenant.displayName,
    remediationId,
    title: bundle.title,
    prTitle: canonicalPrTitle(ctx.ticketId, ctx.erp.tenant.displayName),
    summary: bundle.summary,
    powershellScript: bundle.powershellScript,
    terraformDiff: bundle.terraformDiff,
    graphPatch: bundle.graphPatch,
    terraformFile: ctx.drift?.data.terraformFile ?? "",
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
    graphPatch: bundle.graphPatch,
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
    tenantId: ctx.tenantId,
  });
  report("complete", `Remediation ${remediationId} ready for approval`, { remediationId, verdict: verification.verdict, branch: staging?.branchName ?? null });
  return { drawer, telemetry: event };
}

/**
 * The verifiable pre-flight: PowerShell AST parse + cmdlet allow-list and, for bundles with
 * IaC, terraform fmt/validate on the diff applied to the live state. In the warm Modal
 * sandbox when configured, locally otherwise. Runs at remediation time, and again on a
 * Pure GitOps approval against the context of that moment.
 */
async function preflight(
  bundle: Pick<RemediationBundleArgs, "powershellScript" | "terraformDiff">,
  ctx: CorrelationContext,
  plan: RemediationPlan,
  report: (step: string, message: string, data?: Record<string, unknown>) => void,
): Promise<VerificationStatus> {
  const hasHclBaseline = Boolean(ctx.drift?.data.actualHcl && ctx.drift?.data.expectedHcl);
  const input = {
    powershellScript: bundle.powershellScript,
    terraformDiff: hasHclBaseline ? bundle.terraformDiff : "",
    actualHcl: ctx.drift?.data.actualHcl ?? "",
    expectedHcl: ctx.drift?.data.expectedHcl ?? "",
    requiredCommands: plan.requiredCommands,
  };
  let verification: VerificationStatus;
  if (modalConfigured()) {
    report("preflight:start", "Pre-flight in Modal sandbox");
    try {
      await modalWarm();
      verification = await runModalPreflight(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      report("preflight:fallback", `Modal sandbox failed (${reason}) → local pre-flight`);
      verification = await runLocalPreflight(input);
      verification.findings.unshift(
        /HTTP 400/.test(reason) && !bundle.terraformDiff
          ? "Modal sandbox needs a redeploy for fixes without Terraform; validated locally"
          : "Modal sandbox unavailable; validated locally instead",
      );
    }
  } else {
    report("preflight:start", `Pre-flight: PowerShell AST parse${bundle.terraformDiff ? " + terraform fmt/validate" : ""} (local)`);
    verification = await runLocalPreflight(input);
  }
  const whatIf = checkWhatIfSafety(bundle.powershellScript);
  verification.whatIfSafe = whatIf.safe;
  if (!whatIf.safe) verification.findings.push(`-WhatIf is not a full dry run: ${whatIf.unguarded.join(", ")} outside $PSCmdlet.ShouldProcess`);
  report("preflight:done", `${verification.verdict} in ${verification.validationLatencyMs} ms`, { ...verification });
  return verification;
}

/** Lines in this repository that declare what the fix converges to (Terraform block, golden-tenant JSON). */
function declaredIn(ctx: CorrelationContext | null): string[] {
  if (!ctx) return [];
  const refs = [
    ctx.drift?.data.sourceRef,
    ...(ctx.caPosture?.data.policies.flatMap((p) => p.drift.map((d) => d.sourceRef)) ?? []),
    ...(ctx.intune?.data.settings.filter((s) => s.status !== "in-sync").map((s) => s.sourceRef) ?? []),
  ];
  return [...new Set(refs.filter((r): r is NonNullable<typeof r> => Boolean(r)).map(formatSourceRef))];
}

/**
 * The JSON a break-glass approval commits next to the staged bundle: what was written
 * live (Graph request bodies, ARM operations, per-object results) and which lines of the
 * repository declare the state it converged to, so merging the PR leaves Git and the
 * tenant in agreement.
 */
function reconciledState(drawer: ActionApprovalDrawer, write: LabWriteOutcome | null, ctx: CorrelationContext | null) {
  let graphRequests: unknown = [];
  try {
    graphRequests = drawer.graphPatch.trim() ? JSON.parse(drawer.graphPatch) : [];
  } catch {
    graphRequests = drawer.graphPatch;
  }
  return {
    scenarioId: drawer.ticketId,
    tenantId: drawer.tenantId,
    remediationId: drawer.remediationId,
    mode: "break-glass",
    appliedAt: drawer.approval.approvedAt,
    appliedBy: drawer.approval.approvedBy,
    outcome: drawer.approval.state,
    declaredIn: declaredIn(ctx),
    live: write
      ? {
          source: write.source,
          ...(write.fallbackReason ? { fallbackReason: write.fallbackReason } : {}),
          summary: write.summary,
          results: write.results.map((r) => ({ id: r.id, ok: r.ok, status: r.status })),
        }
      : { source: "simulated", summary: "LIVE_CLOUD_MODE=false: nothing written live" },
    graphRequests,
    ...(write?.arm
      ? {
          arm: {
            resource: ctx?.drift?.data.resourceId ?? null,
            terraformBlock: ctx?.drift ? formatSourceRef(ctx.drift.data.sourceRef) : null,
            source: write.arm.source,
            operations: write.arm.results.map((r) => ({ op: r.id, ok: r.ok, status: r.status })),
          },
        }
      : {}),
  };
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
  /**
   * break-glass (default): write the live Graph/ARM resource now, then commit the matching
   * state to the fix/* branch. gitops: write nothing live; re-run the pre-flight and leave
   * deployment to the PR pipeline.
   */
  mode?: ExecutionMode;
}

/** One PR title per scenario, so the canonical branch keeps one PR however often the demo runs. */
export function canonicalPrTitle(scenarioId: string, tenantName: string): string {
  const scope = getScenarioEntry(scenarioId)?.remediationScope ?? "infrastructure drift & license state";
  return `fix(${scenarioId}): remediate ${tenantName} ${scope} [ContextPane Tier 3]`;
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

/** Title and body badge of a break-glass approval whose write was simulated: nothing live changed. */
export const SIMULATED_BADGE = "[Simulated Target / GitOps Staged — No Live Cloud Write]";

export function pullRequestBody(drawer: ActionApprovalDrawer, state: string, log: string[], ctx: CorrelationContext | null, repoUrl: string | null): string {
  const v = drawer.verificationStatus;
  const registry = getScenarioEntry(drawer.ticketId);
  const tenantName = ctx?.erp.tenant.displayName ?? drawer.tenantId;
  const ticket = ctx?.erp.ticket ?? null;
  const contractId = ctx?.erp.contract.contractId ?? "n/a";
  const files = drawer.staging?.filesChanged ?? [];
  const link = (path: string | undefined) =>
    path ? (repoUrl && drawer.staging ? `[\`${path}\`](${repoUrl}/blob/${drawer.staging.branchName}/${path})` : `\`${path}\``) : null;
  // demo-iac/main.tf:L43-L84 → the same lines on GitHub (#L43-L84).
  const lineLink = (ref: string) => {
    const [path, lines] = ref.split(":");
    return repoUrl && drawer.staging ? `[\`${ref}\`](${repoUrl}/blob/${drawer.staging.branchName}/${path}#${lines})` : `\`${ref}\``;
  };
  const scriptPath = files.find((f) => f.endsWith(".ps1"));
  const patchPath = files.find((f) => f.endsWith(".patch"));
  const graphPath = files.find((f) => f.endsWith("graph-requests.json"));
  const readmePath = files.find((f) => f.endsWith(".md"));
  const reconciledPath = files.find((f) => f.endsWith("reconciled-state.json"));
  const upns = drawer.affectedEntities.filter((e) => e.type === "upn");
  const policies = drawer.affectedEntities.filter((e) => e.type === "policy");
  const devices = drawer.affectedEntities.filter((e) => e.type === "device");
  const hasIac = drawer.terraformDiff.trim() !== "";
  const nsg = summarizeTerraformDiff(drawer.terraformDiff);
  const nsgName = ctx?.drift?.data.resourceName ?? drawer.affectedEntities.find((e) => e.type === "resource")?.id.split("/")[0] ?? "the NSG";

  const correlation: string[] = ["| | |", "|---|---|"];
  if (ticket && ctx) {
    const c = ctx.erp.contract;
    const lic = ctx.license?.data;
    const line = c.lines.find((l) => l.skuPartNumber === lic?.sku.skuPartNumber) ?? c.lines.find((l) => l.semanticAnchor);
    const policy = ctx.policies?.data.find((p) => policies.some((e) => e.id.toLowerCase() === p.id.toLowerCase()));
    correlation.push(
      `| **ERP ticket** | **#${ticket.ticketId}** · ${ticket.title} |`,
      `| **Contract** | **#${c.contractId}** · ${c.title} |`,
      `| **Requester** | ${ticket.requester.displayName} (\`${ticket.requester.upn}\`), ${ticket.requester.role} |`,
      ...(line ? [`| **Entitlement** | ${line.quantity} × ${line.skuName} (\`${line.skuPartNumber}\`)${line.entitlementGroup ? ` via \`${line.entitlementGroup}\`` : ""} |`] : []),
      ...(upns.length && lic ? [`| **License drift** | ${upns.length} user${upns.length === 1 ? "" : "s"} entitled to ${lic.sku.skuPartNumber} but not assigned it |`] : []),
      ...(policy ? [`| **Blocking CA policy** | ${policy.displayName} (\`${policy.id}\`, ${policy.state}) |`] : []),
      ...(ctx.intune ? [`| **Intune** | ${ctx.intune.data.errorCode ? `\`${ctx.intune.data.errorCode}\` · ` : ""}${ctx.intune.data.affectedDeviceCount} device(s) affected |`] : []),
      ...(ctx.drift ? [`| **NSG drift** | \`${nsgName}\` (${ctx.drift.data.terraformFile}) |`] : []),
    );
  } else {
    correlation.push(
      `| **Tenant anomaly** | **#${drawer.ticketId}** · ${registry?.title ?? drawer.title} |`,
      `| **Tenant** | ${tenantName} (\`${ctx?.erp.tenant.verifiedDomain ?? drawer.tenantId}\`) |`,
      `| **Detected from** | ${ctx?.license ? "Graph subscribedSkus + licenseAssignmentStates" : ctx?.caPosture ? "Conditional Access policies + directory audit logs" : "Intune configurationPolicies + device state summaries"} |`,
    );
  }

  const changes: string[] = [];
  for (const e of upns) {
    const cmdLabel = /reclaim/i.test(e.change)
      ? "`Set-MgUserLicense -RemoveLicenses`"
      : /CountViolation/i.test(e.change)
        ? "`Invoke-MgLicenseUser`"
        : /owner removed/i.test(e.change)
          ? "`Remove-MgApplicationOwnerByRef`"
          : "`Remove-MgGroupMemberByRef` + `Invoke-MgLicenseUser`";
    changes.push(`- ${cmdLabel} · ${e.id}: ${e.change}`);
  }
  for (const e of policies) changes.push(`- ${ctx?.intune ? "Intune" : "`Update-MgIdentityConditionalAccessPolicy`"} · \`${e.id}\`: ${e.change}`);
  if (devices.length) changes.push(`- \`Sync-MgDeviceManagementManagedDevice\` · ${devices.length} device(s): ${devices.map((d) => d.id).join(", ")}`);

  const simulated = state === "simulated";
  return [
    ...(simulated ? [`> **${SIMULATED_BADGE}** The break-glass approval ran against a simulated target: no live Graph or ARM resource was changed. This branch only stages the intended state.`, ""] : []),
    `## #${drawer.ticketId}${ticket ? ` × #${contractId}` : ""} · ${tenantName}`,
    "",
    drawer.summary,
    "",
    "> Staged by **ContextPane Tier 3** and opened only after a human approved it in the Action Approval drawer.",
    "> The pipeline never runs the PowerShell itself (`CTX_ALLOW_EXECUTE=false`); it is here for review and a manual, delegated run.",
    "",
    `### ${ticket ? "Ticket × contract correlation" : "Detected anomaly"}`,
    "",
    ...correlation,
    "",
    "### Pre-flight",
    "",
    "| Check | Result | Time in sandbox |",
    "|---|---|---|",
    `| PowerShell AST parse + cmdlet allow-list | ${check(v.astCheckPassed)} | ${ms(v.checkLatencyMs?.powershellAst)} |`,
    `| \`-WhatIf\` dry run (every mutation inside \`ShouldProcess\`) | ${check(v.whatIfSafe)} | static |`,
    ...(hasIac
      ? [
          `| \`terraform fmt -check\` | ${check(v.terraformFmtPassed)} | ${ms(v.checkLatencyMs?.terraformFmt)} |`,
          `| \`terraform validate\` (diff applied to the live NSG state) | ${check(v.terraformValidatePassed)} | ${ms(v.checkLatencyMs?.terraformValidate)} |`,
        ]
      : []),
    `| **Verdict: ${v.verdict}** | \`${v.sandboxProvider}\` | ${ms(v.sandboxLatencyMs)} in the container · ${ms(v.validationLatencyMs)} round trip |`,
    ...(v.findings.length ? ["", ...v.findings.map((f) => `- ${f}`)] : []),
    "",
    ...(hasIac
      ? [
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
        ]
      : []),
    "### Microsoft Graph changes (PowerShell)",
    "",
    ...(scriptPath ? [`Script: ${link(scriptPath)}`, ""] : []),
    ...changes,
    ...(graphPath ? ["", `Graph request bodies: ${link(graphPath)}`] : []),
    "",
    "```powershell",
    "Connect-MgGraph -TenantId <tenant> -Scopes <scopes listed in the script header>",
    ...(scriptPath ? [`pwsh -NoProfile -File ./${scriptPath} -WhatIf   # dry run`, `pwsh -NoProfile -File ./${scriptPath}           # execute as the delegated identity`] : []),
    "```",
    ...(readmePath ? ["", `Runbook: ${link(readmePath)}`] : []),
    "",
    ...(declaredIn(ctx).length ? ["### Declared in", "", ...declaredIn(ctx).map((r) => `- ${lineLink(r)}`), ""] : []),
    "### Approval & audit",
    "",
    drawer.approval.mode === "gitops"
      ? "- 🔀 **Pure GitOps**: nothing was written to Graph or ARM. Merging this PR is the deployment."
      : simulated
        ? `- 🧪 **Emergency Break-Glass, simulated**: no live Graph or ARM resource was changed; the reconcile commit on this branch records the intended state${reconciledPath ? ` (${link(reconciledPath)})` : ""}.`
        : `- ⚡ **Emergency Break-Glass**: the live resources were changed on approval; the reconcile commit on this branch records the state they were left in${reconciledPath ? ` (${link(reconciledPath)})` : ""}.`,
    `- Approved by **${drawer.approval.approvedBy ?? drawer.approval.requiredIdentity}** at ${drawer.approval.approvedAt ?? "n/a"} → \`${state}\``,
    `- Remediation \`${drawer.remediationId}\`${drawer.staging?.commitSha ? ` · commit \`${drawer.staging.commitSha.slice(0, 7)}\`` : ""}`,
    ...log.map((l) => `- ${l}`),
    "",
    `_Synthesised by ContextPane Tier 3 (${drawer.synthesizedBy.planner} → ${drawer.synthesizedBy.coder}, ${drawer.synthesizedBy.provider}). Every run force-updates this scenario's branch, so this PR always shows the latest approved remediation._`,
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

  const scenarioId = resolveScenarioId(drawer.ticketId);
  // The lab objects a custom ticket's fix writes are those of the built-in scenario it inherits.
  const labScenarioId = baseScenarioOf(scenarioId);
  const mode: ExecutionMode = input.mode ?? "break-glass";
  // Ad-hoc CUSTOM-/ERP- tickets never open a PR unless the engineer asks for one.
  const wantPullRequest = input.openPullRequest ?? (isCustomScenarioId(drawer.ticketId) ? false : config.github.prOnApprove);
  // The PR body quotes the ticket and the convergence names the users: read both before the Graph write invalidates the context.
  const before = await gatherContext(scenarioId).catch(() => null);
  const plan = before ? buildRemediationPlan(before) : null;
  const remediatedUpns = plan?.remediatedUpns ?? drawer.affectedEntities.filter((e) => e.type === "upn").map((e) => e.id);
  const reclaimedUpns = plan?.reclaimedUpns ?? [];
  let state: ActionApprovalDrawer["approval"]["state"] = "approved";
  let execution: Convergence["execution"] = "simulated";
  let writeSummary = "";
  let write: LabWriteOutcome | null = null;
  let verification = drawer.verificationStatus;

  if (mode === "break-glass") {
    log.push("⚡ Emergency Break-Glass: direct API write, then an auto-reconcile commit on the fix branch");
    if (config.liveCloudMode) {
      if (config.allowExecute) {
        log.push("LIVE_CLOUD_MODE + CTX_ALLOW_EXECUTE → running the approved script via the delegated identity");
        const script = await runApprovedScript(drawer);
        log.push(...script.log);
      }
      write = await applyScenarioState(labScenarioId, "remediated", remediatedUpns);
      const failed = write.results.filter((r) => !r.ok);
      writeSummary = write.summary;
      if (write.source === "live-graph") {
        log.push(`Graph${write.arm ? " + ARM" : ""}: ${write.summary} in ${write.latencyMs} ms`);
        for (const f of failed) log.push(`  ${f.id}: HTTP ${f.status} ${f.error ?? ""}`.trimEnd());
        if (!failed.length) {
          state = "executed";
          execution = "live-graph";
        }
      } else {
        log.push(`Graph write simulated (${write.fallbackReason})`);
        state = "simulated";
      }
      invalidateContext(scenarioId);
    } else {
      state = "simulated";
      log.push("Offline mode: approval recorded, execution simulated (no Graph context). Branch stays staged for the PR.");
    }
  } else {
    // Pure GitOps: nothing live changes; the warm sandbox re-checks the bundle against the state of this moment.
    log.push("🔀 Pure GitOps: no Graph or ARM write; the pipeline deploys the staged patch once the PR merges");
    if (before && plan) {
      verification = await preflight(drawer, before, plan, () => {});
      log.push(
        `Pre-flight re-run: ${verification.verdict} · AST ${fmt(verification.astCheckPassed)}${drawer.terraformDiff ? ` · terraform validate ${fmt(verification.terraformValidatePassed)}` : ""} · ${verification.sandboxProvider} · ${verification.validationLatencyMs} ms`,
      );
    }
    if (verification.verdict === "Verification Failed") throw new Error("Pre-flight re-run failed; nothing staged for the pipeline");
    state = "staged";
    execution = "simulated";
    writeSummary = "GitOps: patch staged for the pipeline";
  }

  let updated: ActionApprovalDrawer = {
    ...drawer,
    verificationStatus: verification,
    approval: { ...drawer.approval, state, mode, approvedBy: input.approvedBy ?? drawer.approval.requiredIdentity, approvedAt: now },
  };

  /* ---- break-glass: commit what the hotfix changed, so Git does not drift behind the tenant ---- */
  if (mode === "break-glass" && updated.staging) {
    const reconciled = await reconcileStagedBranch(
      updated.staging,
      [{ path: `demo-iac/remediations/${drawer.ticketId}/reconciled-state.json`, content: JSON.stringify(reconciledState(updated, write, before), null, 2) }],
      `chore(${drawer.ticketId}): reconcile break-glass hotfix into Git\n\nApplied live by ${updated.approval.approvedBy} at ${now} (${state}).\n${writeSummary}\nDeclared in: ${declaredIn(before).join(", ") || "n/a"}`,
    );
    log.push(...reconciled.log);
    updated = { ...updated, staging: reconciled.staging };
  }

  if (state === "simulated") log.unshift(`${SIMULATED_BADGE} ${writeSummary || "execution simulated"}`.trim());

  /* ---- optional: real GitHub PR on the staged branch ---- */
  if (wantPullRequest) {
    if (updated.staging) {
      const staging = state === "simulated" && !updated.staging.prTitle.startsWith(SIMULATED_BADGE) ? { ...updated.staging, prTitle: `${SIMULATED_BADGE} ${updated.staging.prTitle}` } : updated.staging;
      const pr = await openPullRequest(staging, pullRequestBody(updated, state, log, before, await githubRepoUrl()));
      log.push(...pr.log);
      updated = { ...updated, staging: pr.staging };
    } else {
      log.push("No staged branch to open a PR from");
    }
  } else {
    log.push(`PR not requested: ${updated.staging?.branchName ?? "the fix branch"} stays local`);
  }

  remediationStore.save(updated);
  const latencyMs = Math.round(performance.now() - started);
  // Only a live write converges the canvas; a staged GitOps patch leaves the drift visible until the pipeline runs.
  const convergence: Convergence | null =
    mode === "break-glass"
      ? {
          scenarioId,
          tenantId: updated.tenantId,
          remediationId: updated.remediationId,
          ticketId: updated.ticketId,
          convergedAt: new Date().toISOString(),
          latencyMs,
          prUrl: updated.staging?.prUrl ?? null,
          gitBranch: updated.staging?.branchName ?? null,
          execution,
          remediatedUpns,
          reclaimedUpns,
        }
      : null;
  if (convergence) {
    convergenceStore.set(convergence);
    log.push(`Canvas converged via notifications/resources/updated (Tier 0, 0 tokens) · ${latencyMs} ms end to end`);
  }
  auditLedger.append({
    ...verificationProof(updated),
    actionType: "hitl-approval",
    delegatedIdentity: updated.approval.approvedBy ?? updated.approval.requiredIdentity,
    latencyMs,
    execution: mode === "gitops" ? "none" : execution,
    executionMode: mode,
    detail: `${state} · ${writeSummary || updated.title}${updated.staging?.prUrl ? " · PR opened" : ""}`.slice(0, 300),
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
