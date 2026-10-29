import {
  RemediationBundleArgsSchema,
  getRemediationBundleToolDefinition,
  parseToolArguments,
  type RemediationBundleArgs,
  type RepairLoop,
  type RepairRound,
  type VerificationStatus,
} from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { synthesizeCustomRemediation, syntaxHeuristicPrecheck } from "../local/subagent-orchestrator.ts";
import type { CorrelationContext } from "../mcp/context.ts";
import { chatWithForcedTool, metaCallsEnabled, type TokenUsage } from "../router/openai.ts";

/**
 * Write-then-test (U-2): the sandbox is the test harness and the coder is the loop body.
 *
 * `remediate()` runs the real pre-flight (pwsh AST + cmdlet allow-list + -WhatIf proof +
 * terraform validate, in the Modal sandbox when configured). When that pre-flight returns
 * repairable findings, the findings are handed back to Sub-Agent 4 as a repair brief together
 * with the rejected script, the coder answers with a repaired script, the cheap syntax
 * pre-check runs, and the sandbox judges again. At most MAX_REPAIR_ITERATIONS turns run before
 * the drawer opens. Every turn is recorded on `verification.repair` (findings before and after,
 * model, tokens, latency, whether the script changed) so the pipeline pill and the System &
 * Audit drawer can show the loop.
 *
 * What the loop never does: it never changes a verdict itself. The verdict is always the last
 * thing the sandbox said; when the budget is exhausted with findings left, the drawer opens as
 * the sandbox left it (Verification Failed / With Warnings) and `repair.exhausted` is true
 * (L-01 stays: no forced verdicts). Findings that no script change can fix (the sandbox was
 * unavailable, terraform is not installed, git staging was skipped) do not start a turn.
 */

export const MAX_REPAIR_ITERATIONS = 2;

/** Findings the coder cannot repair: infrastructure of the pre-flight itself, not the script. */
const UNREPAIRABLE = [
  /Modal sandbox (unavailable|needs a redeploy|failed)/i,
  /terraform not available/i,
  /terraform validate skipped/i,
  /Git staging skipped/i,
  /AST check (timed out|could not run)/i,
  /pwsh unavailable/i,
  /pre-flight not run/i,
  /Auto-Fix:/i,
];

export function repairableFindings(verification: Pick<VerificationStatus, "verdict" | "findings">): string[] {
  if (verification.verdict === "Verified Safe" || verification.verdict === "Overridden") return [];
  return verification.findings.filter((f) => !UNREPAIRABLE.some((re) => re.test(f)));
}

export interface RepairLoopInput {
  bundle: RemediationBundleArgs;
  verification: VerificationStatus;
  ctx: CorrelationContext;
  requiredCommands: string[];
  /** The real pre-flight of the remediation tier; the loop re-runs it after every repair turn. */
  preflight: (bundle: Pick<RemediationBundleArgs, "powershellScript" | "terraformDiff">) => Promise<VerificationStatus>;
  report?: (step: string, message: string, data?: Record<string, unknown>) => void;
  maxIterations?: number;
}

export interface RepairLoopOutcome {
  bundle: RemediationBundleArgs;
  verification: VerificationStatus;
  repair: RepairLoop;
  usage: TokenUsage;
  /** For the Tier 3B fallback chain: one row per coder turn. */
  chain: Array<{ provider: "meta" | "local"; modelId: string; outcome: "ok" | "skipped" | "error"; latencyMs: number }>;
}

interface RepairTurn {
  script: string;
  bundlePatch: Partial<RemediationBundleArgs>;
  modelId: string;
  source: "llm" | "fallback-on-error";
  latencyMs: number;
  usage: TokenUsage;
}

const REPAIR_PROMPT = `${"You are ContextPane's remediation coder (Tier 3B) in a repair turn. The sandbox pre-flight rejected the previous powershellScript; `repairFindings` lists exactly what it rejected."} Fix those findings and nothing else: keep every unrelated line byte-identical, keep [CmdletBinding(SupportsShouldProcess)] and a leading param() block, wrap every mutating cmdlet in $PSCmdlet.ShouldProcess, use every cmdlet in requiredCommands, never use forbidden commands (Invoke-Expression, Remove-MgUser, Remove-MgGroup, Remove-AzResourceGroup, Remove-Item, Start-Process, Invoke-WebRequest, Invoke-RestMethod). Respond only through emit_remediation_bundle.`;

/** One coder repair turn: the custom coder for ad-hoc tickets, the Tier 3B bundle coder for built-in scenarios. */
async function repairTurn(input: RepairLoopInput, findings: string[]): Promise<RepairTurn> {
  const started = performance.now();
  if (input.ctx.custom) {
    const res = await synthesizeCustomRemediation({
      scenarioId: input.ctx.ticketId,
      ticketTitle: input.ctx.custom.ticket.title,
      ticketBody: input.ctx.custom.ticket.body,
      ...(input.ctx.custom.clarifiedAnswers ? { clarifiedAnswers: input.ctx.custom.clarifiedAnswers } : {}),
      ...(input.ctx.custom.steering ? { steering: input.ctx.custom.steering } : {}),
      previousScript: input.bundle.powershellScript,
      repairFindings: findings,
    });
    const meta = res._meta;
    return {
      script: res.powershellScript,
      bundlePatch: { title: res.title.slice(0, 120), summary: res.summary.slice(0, 600), graphPatch: res.graphPatch, affectedEntities: res.affectedEntities.slice(0, 20).map((e) => ({ ...e, change: e.change.slice(0, 200) })) },
      modelId: meta?.modelUsed ?? models.metaWonder,
      source: meta?.source ?? "fallback-on-error",
      latencyMs: meta?.latencyMs ?? Math.max(1, Math.round(performance.now() - started)),
      usage: meta?.usage ?? { prompt: 0, completion: 0, total: meta?.tokensUsed ?? 0 },
    };
  }
  const result = await chatWithForcedTool(
    providers.meta,
    models.metaCode,
    [
      { role: "system", content: REPAIR_PROMPT },
      { role: "user", content: JSON.stringify({ repairFindings: findings, requiredCommands: input.requiredCommands, previousBundle: input.bundle }) },
    ],
    getRemediationBundleToolDefinition(),
    { timeoutMs: config.timeouts.remediateMs, temperature: 0, maxTokens: 12000, reasoningEffort: config.reasoning.remediate },
  );
  const parsed = RemediationBundleArgsSchema.safeParse(parseToolArguments(result.argumentsRaw));
  if (!parsed.success) throw new Error(`repair turn returned an invalid bundle: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return {
    script: parsed.data.powershellScript,
    bundlePatch: { ...parsed.data, terraformDiff: parsed.data.terraformDiff?.trim() ? parsed.data.terraformDiff : input.bundle.terraformDiff, graphPatch: parsed.data.graphPatch?.trim() ? parsed.data.graphPatch : input.bundle.graphPatch },
    modelId: models.metaCode,
    source: "llm",
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    usage: result.usage,
  };
}

export async function runRepairLoop(input: RepairLoopInput): Promise<RepairLoopOutcome> {
  const maxIterations = input.maxIterations ?? MAX_REPAIR_ITERATIONS;
  const report = input.report ?? (() => {});
  let bundle = input.bundle;
  let verification = input.verification;
  let usage: TokenUsage = { prompt: 0, completion: 0, total: 0 };
  const chain: RepairLoopOutcome["chain"] = [];
  const rounds: RepairRound[] = [];
  const done = (exhausted: boolean, skipped?: string): RepairLoopOutcome => ({
    bundle,
    verification: { ...verification, repair: { iterations: rounds.length, maxIterations, rounds, exhausted, ...(skipped ? { skipped } : {}) } },
    repair: { iterations: rounds.length, maxIterations, rounds, exhausted, ...(skipped ? { skipped } : {}) },
    usage,
    chain,
  });

  let findings = repairableFindings(verification);
  if (!findings.length) return done(false, verification.verdict === "Verified Safe" ? undefined : "no repairable finding");
  if (!metaCallsEnabled()) return done(false, "coder offline: findings left for Auto-Fix or the operator");

  while (findings.length && rounds.length < maxIterations) {
    const iteration = rounds.length + 1;
    report("repair:start", `Write-then-test ${iteration}/${maxIterations}: ${findings.length} sandbox finding(s) back to the coder`, { findings });
    let turn: RepairTurn;
    try {
      turn = await repairTurn({ ...input, bundle }, findings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      chain.push({ provider: "meta", modelId: input.ctx.custom ? models.metaWonder : models.metaCode, outcome: "error", latencyMs: 0 });
      rounds.push({ iteration, findingsBefore: findings, verdictBefore: verification.verdict, modelId: input.ctx.custom ? models.metaWonder : models.metaCode, source: "fallback-on-error", latencyMs: 0, tokensUsed: 0, scriptChanged: false, verdictAfter: verification.verdict, findingsAfter: verification.findings, preflightLatencyMs: 0 });
      report("repair:error", `Repair turn ${iteration} failed: ${message}`);
      break;
    }
    usage = { prompt: usage.prompt + turn.usage.prompt, completion: usage.completion + turn.usage.completion, total: usage.total + turn.usage.total };
    chain.push({ provider: turn.source === "llm" ? "meta" : "local", modelId: turn.modelId, outcome: turn.source === "llm" ? "ok" : "skipped", latencyMs: turn.latencyMs });
    // The cheap pre-check first: a script that still lacks its guard goes to the sandbox with that noted, never auto-wrapped here.
    const precheck = syntaxHeuristicPrecheck(turn.script, input.ctx.ticketId);
    const scriptChanged = turn.script !== bundle.powershellScript;
    if (!scriptChanged || turn.source !== "llm") {
      rounds.push({ iteration, findingsBefore: findings, verdictBefore: verification.verdict, modelId: turn.modelId, source: turn.source, latencyMs: turn.latencyMs, tokensUsed: turn.usage.total, tokensPrompt: turn.usage.prompt, tokensCompletion: turn.usage.completion, scriptChanged, verdictAfter: verification.verdict, findingsAfter: verification.findings, preflightLatencyMs: 0 });
      report("repair:unchanged", turn.source !== "llm" ? `Repair turn ${iteration}: coder offline, script unchanged` : `Repair turn ${iteration}: coder returned the same script`);
      break;
    }
    const candidate: RemediationBundleArgs = { ...bundle, ...turn.bundlePatch, powershellScript: turn.script };
    const verdictBefore = verification.verdict;
    const next = await input.preflight(candidate);
    next.precheck = { name: "syntax-heuristic", passed: precheck.passed, warnings: precheck.warnings, latencyMs: precheck.latencyMs };
    bundle = candidate;
    verification = next;
    rounds.push({ iteration, findingsBefore: findings, verdictBefore, modelId: turn.modelId, source: turn.source, latencyMs: turn.latencyMs, tokensUsed: turn.usage.total, tokensPrompt: turn.usage.prompt, tokensCompletion: turn.usage.completion, scriptChanged: true, verdictAfter: next.verdict, findingsAfter: next.findings, preflightLatencyMs: next.validationLatencyMs });
    report("repair:done", `Write-then-test ${iteration}/${maxIterations}: ${next.verdict} (${next.findings.length} finding(s))`, { verdict: next.verdict, findings: next.findings });
    findings = repairableFindings(next);
  }
  return done(findings.length > 0);
}
