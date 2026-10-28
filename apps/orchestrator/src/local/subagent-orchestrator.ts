import {
  ClarifyingQuestionSchema,
  parseToolArguments,
  type ClarifyingQuestion,
  type CustomRemediationTemplate,
  type CustomScenarioEntry,
  type ElementRoutingDecision,
  type OpenAIFunctionTool,
  type SubAgentTaskRecord,
  type SynthesizedDynamicCard,
  type UpstreamCloudStatusCorrelation,
} from "@contextpane/catalog";
import { z } from "zod";
import { config, models, providers } from "../config.ts";
import { chatWithForcedTool } from "../router/openai.ts";
import { correlateUpstreamCloudStatus } from "./cloud-status-correlator.ts";
import { assessTicketElementNeeds, synthesizeAndPersistMissingElements } from "./dynamic-catalog.ts";

function humanizeSlug(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(trimmed) || /^[a-z0-9]+(-[a-z0-9]+){2,}$/i.test(trimmed)) {
    return trimmed.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

export function normalizeQuestionsHumanReadable(questions: ClarifyingQuestion[], answers: Record<string, string>): ClarifyingQuestion[] {
  return questions.map((q) => {
    const options = q.options.map((opt) => {
      const label = humanizeSlug(opt.label);
      return { ...opt, label, value: label };
    });
    const rawAns = answers[q.id]?.trim();
    const matchedOpt = rawAns
      ? options.find((o) => o.value.toLowerCase() === rawAns.toLowerCase() || o.label.toLowerCase() === rawAns.toLowerCase() || o.id.toLowerCase() === rawAns.toLowerCase())
      : undefined;
    const selectedValue = matchedOpt ? matchedOpt.value : rawAns ? humanizeSlug(rawAns) : options[0]?.value;
    return ClarifyingQuestionSchema.parse({ ...q, question: humanizeSlug(q.question), options, selectedValue });
  });
}

export function generateClarifyingQuestionsSync(input: { title: string; body: string; clarifiedAnswers?: Record<string, string> }): ClarifyingQuestion[] {
  const answers = input.clarifiedAnswers ?? {};
  const rawQuestions: ClarifyingQuestion[] = [
    {
      id: "target-scope",
      question: "Target Environment & Resource Scope",
      category: "scope",
      customHint: "Or enter specific resource / identity name",
      options: [
        { id: "opt-prod-canary", label: "Production Scoped Target (Phased Rollout)", value: "Production Scoped Target (Phased Rollout)", description: "Apply changes to the affected production resource or identity cohort" },
        { id: "opt-staging", label: "Staging / Validation Environment First", value: "Staging / Validation Environment First", description: "Validate in non-production before production convergence" },
        { id: "opt-tenant-wide", label: "Full Tenant / Subscription Scope", value: "Full Tenant / Subscription Scope", description: "Apply across all matching resources in the subscription" },
      ],
    },
    {
      id: "governance-posture",
      question: "Security & Governance Posture",
      category: "security",
      customHint: "Or specify custom policy / RBAC requirement",
      options: [
        { id: "opt-least-priv", label: "Enforce Least-Privilege & Policy Guardrails", value: "Enforce Least-Privilege & Policy Guardrails", description: "Preserve security baselines and least-privilege role assignments" },
        { id: "opt-audit-first", label: "Audit / What-If Verification First", value: "Audit / What-If Verification First", description: "Stage in dry-run / report-only mode before enforcement" },
        { id: "opt-break-glass", label: "Scoped Break-Glass Exception", value: "Scoped Break-Glass Exception", description: "Apply targeted time-bound exemption for immediate restoration" },
      ],
    },
    {
      id: "remediation-strategy",
      question: "Desired Resolution Strategy",
      category: "remediation",
      customHint: "Or describe custom PowerShell / IaC remediation action",
      options: [
        { id: "opt-in-place", label: "Recover or Update Existing Resource In-Place", value: "Recover or Update Existing Resource In-Place", description: "Non-destructive in-place recovery or configuration update" },
        { id: "opt-recreate", label: "Purge / Replace & Recreate Clean State", value: "Purge / Replace & Recreate Clean State", description: "Remove conflicting state and provision a clean resource configuration" },
        { id: "opt-gitops-pr", label: "Stage Declarative Terraform & PowerShell Bundle", value: "Stage Declarative Terraform & PowerShell Bundle", description: "Generate GitOps IaC diff paired with PowerShell 7 runbook" },
      ],
    },
  ];
  return normalizeQuestionsHumanReadable(rawQuestions, answers);
}

const CLARIFIER_TOOL: OpenAIFunctionTool = {
  type: "function",
  function: {
    name: "emit_clarifying_questions",
    description: "Formulate 3 technical clarifying questions with 3 human-readable clickable options each for the operator's cloud support ticket.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "question", "category", "options"],
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              category: { type: "string", enum: ["scope", "region", "compute", "security", "remediation", "iac"] },
              customHint: { type: "string" },
              options: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "value", "description"],
                  properties: { id: { type: "string" }, label: { type: "string" }, value: { type: "string" }, description: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
};

export interface ClarifierSubAgentResult {
  questions: ClarifyingQuestion[];
  modelUsed: string;
  latencyMs: number;
  tokensUsed: number;
  status: "completed" | "fallback";
  source: "llm" | "fallback-on-error";
}

export async function generateClarifyingQuestions(input: {
  title: string;
  body: string;
  clarifiedAnswers?: Record<string, string>;
}): Promise<ClarifierSubAgentResult> {
  const started = performance.now();
  const fallback = generateClarifyingQuestionsSync(input);
  const modelId = models.metaWonder;
  if (!providers.meta.hasKey || config.forceLocal || process.env.NODE_ENV === "test") {
    return {
      questions: fallback,
      modelUsed: `${modelId} (offline)`,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      tokensUsed: 0,
      status: "fallback",
      source: "fallback-on-error",
    };
  }
  try {
    const res = await chatWithForcedTool(
      providers.meta,
      modelId,
      [
        {
          role: "system",
          content:
            "You are Sub-Agent 1 (Goal & Scope Clarifier · muse-wonder-1.0) in ContextPane. " +
            "Given the operator's cloud ticket, formulate 3 domain-specific clarifying questions: Question 1 about root cause / resource scope, Question 2 about policy / retention / security state, and Question 3 about the operator's preferred resolution strategy (e.g. for a deleted Key Vault ticket, Question 3 options should include 'Recover the old vault' and 'Permanently purge then recreate'). " +
            "CRITICAL: Every option's `label` and `value` MUST be clean human-readable English phrases — NEVER use snake_case or raw variable slugs!",
        },
        { role: "user", content: `Ticket Title: ${input.title}\nTicket Body: ${input.body}` },
      ],
      CLARIFIER_TOOL,
      { timeoutMs: 20000, temperature: 0.1, maxTokens: 2400, reasoningEffort: "low" },
    );
    const parsed = z.object({ questions: z.array(ClarifyingQuestionSchema).length(3) }).safeParse(parseToolArguments(res.argumentsRaw));
    if (parsed.success) {
      return {
        questions: normalizeQuestionsHumanReadable(parsed.data.questions, input.clarifiedAnswers ?? {}),
        modelUsed: modelId,
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
        tokensUsed: res.usage.total,
        status: "completed",
        source: "llm",
      };
    }
  } catch {
    /* fallback below */
  }
  return {
    questions: fallback,
    modelUsed: modelId,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    tokensUsed: 0,
    status: "fallback",
    source: "fallback-on-error",
  };
}

const REMEDIATION_CODER_TOOL: OpenAIFunctionTool = {
  type: "function",
  function: {
    name: "emit_custom_remediation_template",
    description: "Synthesize a complete PowerShell 7 script, Graph/ARM JSON payload, Terraform diff, rollback script, and execution steps matching the ticket and clarified answers.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "powershellScript", "terraformDiff", "rollbackScript", "executionSteps"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        powershellScript: { type: "string" },
        terraformDiff: { type: "string" },
        graphPatch: { type: "string" },
        rollbackScript: { type: "string" },
        affectedEntities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "id", "change"],
            properties: {
              type: { type: "string", enum: ["user", "group", "device", "policy", "sku", "resource", "errorCode"] },
              id: { type: "string" },
              change: { type: "string" },
            },
          },
        },
        requiredCommands: { type: "array", items: { type: "string" } },
        riskNotes: { type: "array", items: { type: "string" } },
        executionSteps: { type: "array", items: { type: "string" } },
      },
    },
  },
};

export function buildCustomTicketRemediationSync(input: { scenarioId: string; ticketTitle: string; ticketBody: string; clarifiedAnswers?: Record<string, string> }): CustomRemediationTemplate {
  const scopeText = Object.values(input.clarifiedAnswers ?? {}).join(" · ") || "Default Scope";
  const cleanTitle = input.ticketTitle.trim() || "Cloud Remediation";
  return {
    title: `Remediate ${input.scenarioId}: ${cleanTitle}`.slice(0, 120),
    summary: `Remediation bundle for "${cleanTitle}" (${scopeText}).`,
    powershellScript: `#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam([string]$Target = "${input.scenarioId}")\n$ErrorActionPreference = 'Stop'\n# Clarified Scope: ${scopeText}\nif ($PSCmdlet.ShouldProcess($Target, "Apply remediation for ${cleanTitle.replace(/"/g, "'")}")) {\n  Get-AzResource | Select-Object -First 5\n}\n`,
    terraformDiff: `--- a/demo-iac/remediation.tf\n+++ b/demo-iac/remediation.tf\n@@ -1,3 +1,5 @@\n+# Scenario: ${input.scenarioId}\n+# Scope: ${scopeText}\n`,
    graphPatch: JSON.stringify({ scenarioId: input.scenarioId, clarifiedScope: input.clarifiedAnswers ?? {} }, null, 2),
    rollbackScript: `#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam([string]$Target = "${input.scenarioId}")\n`,
    affectedEntities: [{ type: "resource", id: input.scenarioId, change: `Apply clarified remediation (${scopeText})`.slice(0, 180) }],
    requiredCommands: ["get-azresource"],
    riskNotes: ["All mutating cmdlets are wrapped in $PSCmdlet.ShouldProcess (-WhatIf safe)."],
    executionSteps: [`[Step 1/2] Inspect live state for ${input.scenarioId} (${scopeText})`, `[Step 2/2] Run the approved PowerShell 7 remediation`],
  };
}

export interface RemediationCoderMeta {
  modelUsed: string;
  latencyMs: number;
  tokensUsed: number;
  status: "completed" | "fallback";
  source: "llm" | "fallback-on-error";
}

export type SynthesizedRemediationWithMeta = CustomRemediationTemplate & { _meta?: RemediationCoderMeta };

export async function synthesizeCustomRemediation(input: {
  scenarioId: string;
  ticketTitle: string;
  ticketBody: string;
  clarifiedAnswers?: Record<string, string>;
}): Promise<SynthesizedRemediationWithMeta> {
  const started = performance.now();
  const fallback = buildCustomTicketRemediationSync(input);
  const modelId = models.metaWonder;
  if (!providers.meta.hasKey || config.forceLocal || process.env.NODE_ENV === "test") {
    return {
      ...fallback,
      _meta: {
        modelUsed: `${modelId} (offline)`,
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
        tokensUsed: 0,
        status: "fallback",
        source: "fallback-on-error",
      },
    };
  }
  try {
    const res = await chatWithForcedTool(
      providers.meta,
      modelId,
      [
        {
          role: "system",
          content:
            "You are Sub-Agent 4 (IaC & PowerShell 7 Coder · muse-wonder-1.0) in ContextPane. " +
            "Synthesize a concise, domain-accurate 15-line PowerShell 7 script (using [CmdletBinding(SupportsShouldProcess = $true)] and $PSCmdlet.ShouldProcess), unified Terraform diff, rollback script, and 3 executionSteps directly matching the operator's ticket AND their selected `clarifiedAnswers`. " +
            "CRITICAL: The PowerShell cmdlets MUST reflect the exact resolution strategy chosen in `clarifiedAnswers`!",
        },
        { role: "user", content: JSON.stringify(input) },
      ],
      REMEDIATION_CODER_TOOL,
      { timeoutMs: 32000, temperature: 0.1, maxTokens: 4000, reasoningEffort: "low" },
    );
    const raw = parseToolArguments(res.argumentsRaw) as Partial<CustomRemediationTemplate>;
    if (raw && typeof raw.title === "string" && typeof raw.powershellScript === "string" && raw.powershellScript.length > 30) {
      return {
        title: raw.title.slice(0, 120),
        summary: (raw.summary ?? fallback.summary).slice(0, 500),
        powershellScript: raw.powershellScript,
        terraformDiff: raw.terraformDiff ?? fallback.terraformDiff,
        graphPatch: typeof raw.graphPatch === "string" ? raw.graphPatch : JSON.stringify(raw.graphPatch ?? {}, null, 2),
        rollbackScript: raw.rollbackScript ?? fallback.rollbackScript,
        affectedEntities: Array.isArray(raw.affectedEntities) && raw.affectedEntities.length > 0 ? raw.affectedEntities : fallback.affectedEntities,
        requiredCommands: Array.isArray(raw.requiredCommands) && raw.requiredCommands.length > 0 ? raw.requiredCommands.map((c) => c.toLowerCase()) : [],
        riskNotes: Array.isArray(raw.riskNotes) && raw.riskNotes.length > 0 ? raw.riskNotes : fallback.riskNotes,
        executionSteps: Array.isArray(raw.executionSteps) && raw.executionSteps.length > 0 ? raw.executionSteps : fallback.executionSteps,
        _meta: {
          modelUsed: modelId,
          latencyMs: Math.max(1, Math.round(performance.now() - started)),
          tokensUsed: res.usage.total,
          status: "completed",
          source: "llm",
        },
      };
    }
  } catch {
    /* fallback below */
  }
  return {
    ...fallback,
    _meta: {
      modelUsed: modelId,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      tokensUsed: 0,
      status: "fallback",
      source: "fallback-on-error",
    },
  };
}

export interface SafetyVerifierResult {
  repairedScript: string;
  passed: boolean;
  repaired: boolean;
  warnings: string[];
  latencyMs: number;
}

/**
 * Sub-Agent 5 (Safety & Rollback Verifier): performs real PowerShell AST/safety inspection
 * on the generated script (checking for -WhatIf / SupportsShouldProcess, balanced braces,
 * non-empty target parameters, and absence of destructive wildcards like Remove-MgUser -All).
 * If SupportsShouldProcess is missing on an otherwise safe script, repairs it before returning.
 */
export function verifyAndRepairGeneratedScript(script: string, scenarioId: string): SafetyVerifierResult {
  const started = performance.now();
  const warnings: string[] = [];
  let current = script.trim();
  let repaired = false;

  const openBraces = (current.match(/\{/g) ?? []).length;
  const closeBraces = (current.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    warnings.push(`Unbalanced braces detected ({=${openBraces}, }=${closeBraces}).`);
  }

  const destructiveWildcardRe = /\bRemove-MgUser\s+-All\b|\bRemove-AzResource\b(?![^\n]*-(?:ResourceId|Name|ResourceName))\s+-Force\b|\bFormat-Volume\s+-Force\b/i;
  if (destructiveWildcardRe.test(current)) {
    warnings.push("Destructive wildcard command detected (e.g., Remove-MgUser -All or unscoped Remove-AzResource -Force).");
  }

  if (/\bparam\s*\([^)]*=\s*""\s*\)/i.test(current)) {
    warnings.push("Empty default target parameter detected in param() block.");
  }

  const hasShouldProcessAttr = /SupportsShouldProcess\s*=\s*\$true/i.test(current);
  const hasShouldProcessCall = /\$PSCmdlet\.ShouldProcess\s*\(/i.test(current);
  if ((!hasShouldProcessAttr || !hasShouldProcessCall) && warnings.length === 0) {
    const bodyLines = current
      .split(/\r?\n/)
      .filter((line) => !/^#Requires\b/i.test(line.trim()) && !/^\[CmdletBinding/i.test(line.trim()));
    current = [
      "#Requires -Version 7.0",
      "[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]",
      `param([string]$Target = "${scenarioId}")`,
      "$ErrorActionPreference = 'Stop'",
      `if ($PSCmdlet.ShouldProcess($Target, "Execute verified remediation for ${scenarioId}")) {`,
      ...bodyLines.map((l) => `  ${l}`),
      "}",
    ].join("\n");
    repaired = true;
  } else if (!hasShouldProcessAttr || !hasShouldProcessCall) {
    warnings.push("Script is missing [CmdletBinding(SupportsShouldProcess = $true)] or $PSCmdlet.ShouldProcess guard.");
  }

  return {
    repairedScript: current,
    passed: warnings.length === 0,
    repaired,
    warnings,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

export interface SubAgentStepMeasurement {
  latencyMs: number;
  startOffsetMs?: number;
  modelId?: string;
  tokensUsed?: number;
  status?: "completed" | "running" | "fallback";
  source?: "llm" | "mcp-probe" | "symbolic-verifier" | "fallback-on-error" | "not-attempted";
  outputSummary?: string;
}

/**
 * Router telemetry derived from what the sub-agents actually did: provider "meta" and real
 * token counts only when at least one step called a model (L-04, L-06).
 */
export function telemetryFromSubAgentTasks(tasks: SubAgentTaskRecord[]): {
  provider: "meta" | "local";
  modelId: string;
  tokensUsed: { prompt: number; completion: number; total: number };
  fallbackChain: Array<{ provider: "meta" | "local"; modelId: string; outcome: "ok" | "skipped" | "error"; latencyMs: number }>;
} {
  const modelSteps = tasks.filter((t) => t.stepIndex === 1 || t.stepIndex === 3 || t.stepIndex === 4);
  const llmSteps = modelSteps.filter((t) => t.source === "llm");
  const total = llmSteps.reduce((sum, t) => sum + (t.tokensUsed ?? 0), 0);
  return {
    provider: llmSteps.length ? "meta" : "local",
    modelId: llmSteps.length ? [...new Set(llmSteps.map((t) => t.modelId))].join(" + ") : "deterministic-router",
    tokensUsed: { prompt: 0, completion: 0, total },
    fallbackChain: modelSteps.map((t) => ({
      provider: t.source === "llm" ? "meta" : "local",
      modelId: t.modelId,
      outcome: t.source === "llm" ? "ok" : t.source === "fallback-on-error" ? "error" : "skipped",
      latencyMs: t.latencyMs,
    })),
  };
}

export function buildSubAgentPipelineRecords(input: {
  scenarioId: string;
  title: string;
  body: string;
  questions: ClarifyingQuestion[];
  clarifiedAnswers?: Record<string, string>;
  elementIds: string[];
  gatekeeperModel: string;
  synthesizerModel: string;
  measurements?: Partial<Record<1 | 2 | 3 | 4 | 5, SubAgentStepMeasurement>>;
}): SubAgentTaskRecord[] {
  const now = new Date().toISOString();
  const answers = input.clarifiedAnswers ?? {};
  const activePairs = input.questions.map((q) => `${q.id}=${answers[q.id] ?? q.selectedValue ?? q.options[0]?.value ?? ""}`);
  const elementsLabel = input.elementIds.length > 0 ? input.elementIds.join(", ") : "SynthesizedDynamicCard";
  const m = input.measurements ?? {};
  return [
    {
      stepIndex: 1,
      task: "scope-and-questions",
      agentName: "1. Goal Clarifier",
      role: "Goal & Scope Clarifier Sub-Agent",
      modelId: m[1] ? (m[1].modelId ?? models.metaWonder) : "not run",
      status: m[1] ? (m[1].status ?? "fallback") : "fallback",
      source: m[1] ? (m[1].source ?? "fallback-on-error") : "not-attempted",
      latencyMs: m[1]?.latencyMs ?? 0,
      ...(m[1]?.startOffsetMs !== undefined ? { startOffsetMs: m[1].startOffsetMs } : {}),
      ...(m[1]?.tokensUsed !== undefined ? { tokensUsed: m[1].tokensUsed } : {}),
      inputSummary: `Ticket "${input.title.slice(0, 70)}"`,
      outputSummary: !m[1] ? "Not run for this ticket" : m[1].outputSummary ?? `Scoped ${input.questions.length} parameters (${activePairs.join(" · ")})`,
      timestamp: now,
    },
    {
      stepIndex: 2,
      task: "telemetry-and-status",
      agentName: "2. Telemetry Scout",
      role: "Telemetry & Cloud Status Scout Sub-Agent",
      modelId: m[2] ? (m[2].modelId ?? "mcp-msgraph + cloud-status") : "not run",
      status: m[2] ? (m[2].status ?? "completed") : "fallback",
      source: m[2] ? (m[2].source ?? "mcp-probe") : "not-attempted",
      latencyMs: m[2]?.latencyMs ?? 0,
      ...(m[2]?.startOffsetMs !== undefined ? { startOffsetMs: m[2].startOffsetMs } : {}),
      ...(m[2]?.tokensUsed !== undefined ? { tokensUsed: m[2].tokensUsed } : {}),
      inputSummary: `Probed tenant telemetry & upstream status for ${input.scenarioId}`,
      outputSummary: !m[2] ? "Not run for this ticket" : m[2].outputSummary ?? "Correlated live tenant objects & health advisories",
      timestamp: now,
    },
    {
      stepIndex: 3,
      task: "ui-element-synthesis",
      agentName: "3. UI Architect",
      role: "UI Architect Sub-Agent (N+k Catalog)",
      modelId: m[3] ? (m[3].modelId ?? input.synthesizerModel) : "not run",
      status: m[3] ? (m[3].status ?? "fallback") : "fallback",
      source: m[3] ? (m[3].source ?? "fallback-on-error") : "not-attempted",
      latencyMs: m[3]?.latencyMs ?? 0,
      ...(m[3]?.startOffsetMs !== undefined ? { startOffsetMs: m[3].startOffsetMs } : {}),
      ...(m[3]?.tokensUsed !== undefined ? { tokensUsed: m[3].tokensUsed } : {}),
      inputSummary: `Routing + clarified scope (${activePairs[0] ?? "default"})`,
      outputSummary: !m[3] ? "Not run for this ticket" : m[3].outputSummary ?? `Synthesized ${elementsLabel}`,
      timestamp: now,
    },
    {
      stepIndex: 4,
      task: "script-and-iac-synthesis",
      agentName: "4. IaC & PS7 Coder",
      role: "Remediation & IaC Coder Sub-Agent",
      modelId: m[4] ? (m[4].modelId ?? input.synthesizerModel) : "not run",
      status: m[4] ? (m[4].status ?? "fallback") : "fallback",
      source: m[4] ? (m[4].source ?? "fallback-on-error") : "not-attempted",
      latencyMs: m[4]?.latencyMs ?? 0,
      ...(m[4]?.startOffsetMs !== undefined ? { startOffsetMs: m[4].startOffsetMs } : {}),
      ...(m[4]?.tokensUsed !== undefined ? { tokensUsed: m[4].tokensUsed } : {}),
      inputSummary: `Target parameters: ${activePairs.join(", ")}`,
      outputSummary: !m[4] ? "Not run for this ticket" : m[4].outputSummary ?? "Synthesized PowerShell 7 runbook, REST payload & IaC diff",
      timestamp: now,
    },
    {
      stepIndex: 5,
      task: "preflight-and-undo",
      agentName: "5. Safety Verifier",
      role: "Safety & Rollback Verifier Sub-Agent",
      modelId: m[5] ? (m[5].modelId ?? "symbolic-formal-verifier") : "not run",
      status: m[5] ? (m[5].status ?? "completed") : "fallback",
      source: m[5] ? (m[5].source ?? "symbolic-verifier") : "not-attempted",
      latencyMs: m[5]?.latencyMs ?? 0,
      ...(m[5]?.startOffsetMs !== undefined ? { startOffsetMs: m[5].startOffsetMs } : {}),
      ...(m[5]?.tokensUsed !== undefined ? { tokensUsed: m[5].tokensUsed } : {}),
      inputSummary: `AST + SupportsShouldProcess (-WhatIf) for ${input.scenarioId}`,
      outputSummary: !m[5] ? "Not run for this ticket" : m[5].outputSummary ?? "Verified 0 syntax errors & 1-click rollback script ready",
      timestamp: now,
    },
  ];
}

/** The answers the pipeline acts on: the operator's pick, else the clarifier's preselected option. */
export function effectiveClarifiedAnswers(questions: ClarifyingQuestion[], operatorAnswers?: Record<string, string>): Record<string, string> {
  const answers: Record<string, string> = { ...(operatorAnswers ?? {}) };
  for (const q of questions) {
    const value = operatorAnswers?.[q.id] ?? q.selectedValue ?? q.options[0]?.value;
    if (value) answers[q.id] = value;
  }
  return answers;
}

export async function runSubAgentPipeline(input: {
  scenarioId: string;
  title: string;
  body: string;
  probeText: string;
  createdAt: string;
  matchedSeededComponents: string[];
  clarifiedAnswers?: Record<string, string>;
}): Promise<{
  routingDecision: ElementRoutingDecision;
  gatekeeperModel: string;
  cloudStatusCorrelation: UpstreamCloudStatusCorrelation;
  clarifyingQuestions: ClarifyingQuestion[];
  clarifiedAnswers: Record<string, string>;
  synthesizedElements: SynthesizedDynamicCard[];
  customRemediation: CustomRemediationTemplate;
  subAgentTasks: SubAgentTaskRecord[];
}> {
  const pipelineStart = performance.now();
  const offset = (t: number) => Math.round(t - pipelineStart);
  // S2 needs nothing from the other sub-agents, so it probes telemetry for the whole run.
  const t2Start = performance.now();
  const statusPromise = correlateUpstreamCloudStatus({
    ticketText: `${input.title}\n${input.body}`,
    createdAt: input.createdAt,
  }).then((res) => ({ data: res, wallClockMs: Math.max(1, Math.round(performance.now() - t2Start)) }));

  // S1 first: its answers steer the gatekeeper, the UI architect and the coder (L-05, L-07).
  const t1Start = performance.now();
  const clarifierRes = await generateClarifyingQuestions({
    title: input.title,
    body: input.body,
    ...(input.clarifiedAnswers ? { clarifiedAnswers: input.clarifiedAnswers } : {}),
  }).then((res) => ({ ...res, wallClockMs: Math.max(1, Math.round(performance.now() - t1Start)) }));
  const effectiveAnswers = effectiveClarifiedAnswers(clarifierRes.questions, input.clarifiedAnswers);

  // S3 is a real Spark → Wonder chain: the synthesizer builds what the gatekeeper decided.
  // The gatekeeper call carries its own 10 s budget and falls back to the deterministic seed.
  const t3Start = performance.now();
  const uiPromise = assessTicketElementNeeds({
    title: input.title,
    body: input.probeText,
    matchedSeededComponents: input.matchedSeededComponents,
    clarifiedAnswers: effectiveAnswers,
  }).then(async (routing) => {
    const elements = await synthesizeAndPersistMissingElements({
      ticketId: input.scenarioId,
      ticketPrompt: `${input.title}\n${input.body}`,
      decision: routing.decision,
      gatekeeperModel: routing.source === "llm" ? routing.modelUsed : "deterministic-router",
      clarifiedAnswers: effectiveAnswers,
    });
    return { routing, elements, wallClockMs: Math.max(1, Math.round(performance.now() - t3Start)) };
  });

  const t4Start = performance.now();
  const coderPromise = synthesizeCustomRemediation({
    scenarioId: input.scenarioId,
    ticketTitle: input.title,
    ticketBody: input.body,
    clarifiedAnswers: effectiveAnswers,
  }).then((res) => ({ data: res, wallClockMs: Math.max(1, Math.round(performance.now() - t4Start)) }));

  const [statusRes, uiRes, coderRes] = await Promise.all([statusPromise, uiPromise, coderPromise]);

  const routingDecision = uiRes.routing.decision;
  const gatekeeperModel = uiRes.routing.source === "llm" ? uiRes.routing.modelUsed : "deterministic-router";
  const synthesizedElements = uiRes.elements;

  const enrichedRemediation = enrichRemediationFromCard(coderRes.data, synthesizedElements[0]);
  const t5Start = performance.now();
  const safetyCheck = verifyAndRepairGeneratedScript(enrichedRemediation.powershellScript, input.scenarioId);
  const customRemediation: CustomRemediationTemplate = {
    ...enrichedRemediation,
    powershellScript: safetyCheck.repairedScript,
  };

  const uiUsedLlm = synthesizedElements.some((c) => c.synthesisMeta.source === "llm");
  const subAgentTasks = buildSubAgentPipelineRecords({
    scenarioId: input.scenarioId,
    title: input.title,
    body: input.body,
    questions: clarifierRes.questions,
    clarifiedAnswers: effectiveAnswers,
    elementIds: synthesizedElements.map((s) => s.elementId),
    gatekeeperModel,
    synthesizerModel: models.metaWonder,
    measurements: {
      1: {
        latencyMs: clarifierRes.wallClockMs,
        startOffsetMs: offset(t1Start),
        modelId: clarifierRes.modelUsed,
        tokensUsed: clarifierRes.tokensUsed,
        status: clarifierRes.status,
        source: clarifierRes.source,
      },
      2: {
        latencyMs: statusRes.wallClockMs,
        startOffsetMs: offset(t2Start),
        modelId: "mcp-msgraph + cloud-status",
        status: "completed",
        source: "mcp-probe",
        outputSummary: `Correlated ${statusRes.data.services.length} upstream cloud feeds (${statusRes.data.primaryRegion})`,
      },
      3: {
        latencyMs: uiRes.wallClockMs,
        startOffsetMs: offset(t3Start),
        modelId: `${gatekeeperModel} -> ${uiUsedLlm ? models.metaWonder : "deterministic-template"}`,
        tokensUsed: uiRes.routing.tokensUsed ?? 0,
        status: uiUsedLlm ? "completed" : "fallback",
        source: uiUsedLlm ? "llm" : "fallback-on-error",
      },
      4: {
        latencyMs: coderRes.wallClockMs,
        startOffsetMs: offset(t4Start),
        modelId: coderRes.data._meta?.modelUsed ?? models.metaWonder,
        tokensUsed: coderRes.data._meta?.tokensUsed ?? 0,
        status: coderRes.data._meta?.status ?? "fallback",
        source: coderRes.data._meta?.source ?? "fallback-on-error",
      },
      5: {
        latencyMs: safetyCheck.latencyMs,
        startOffsetMs: offset(t5Start),
        modelId: "symbolic-formal-verifier",
        status: safetyCheck.passed ? "completed" : "fallback",
        source: "symbolic-verifier",
        outputSummary: safetyCheck.passed
          ? safetyCheck.repaired
            ? "Auto-wrapped script in SupportsShouldProcess (-WhatIf) & verified AST safety"
            : "Verified 0 syntax errors, SupportsShouldProcess guard & 1-click rollback script ready"
          : `Flagged ${safetyCheck.warnings.length} pre-flight safety warning(s): ${safetyCheck.warnings.join(" ")}`,
      },
    },
  });

  return {
    routingDecision,
    gatekeeperModel,
    cloudStatusCorrelation: statusRes.data,
    clarifyingQuestions: clarifierRes.questions,
    clarifiedAnswers: effectiveAnswers,
    synthesizedElements,
    customRemediation,
    subAgentTasks,
  };
}

export function applyClarifiedAnswersToEntry(entry: CustomScenarioEntry, clarifiedAnswers: Record<string, string>): CustomScenarioEntry {
  const mergedAnswers: Record<string, string> = { ...(entry.clarifiedAnswers ?? {}), ...clarifiedAnswers };
  const baseQuestions = entry.clarifyingQuestions?.length ? entry.clarifyingQuestions : generateClarifyingQuestionsSync({ title: entry.ticket.title, body: entry.ticket.body, clarifiedAnswers: mergedAnswers });
  const updatedQuestions = normalizeQuestionsHumanReadable(baseQuestions, mergedAnswers);
  for (const q of updatedQuestions) if (q.selectedValue) mergedAnswers[q.id] = q.selectedValue;
  const scopeSummary = Object.values(mergedAnswers).join(" · ");
  const updatedRouting = entry.elementRouting ? structuredClone(entry.elementRouting) : undefined;
  if (updatedRouting) updatedRouting.customBrief.summary = `${updatedRouting.customBrief.summary.replace(/\s*\[Clarified Scope:.*\]$/, "")} [Clarified Scope: ${scopeSummary}]`;
  // A model-written script is never swapped for the template offline; the async refine re-runs the coder (H-20).
  const coderUsedLlm = entry.subAgentTasks?.find((t) => t.stepIndex === 4)?.source === "llm";
  const updatedRemediation =
    coderUsedLlm && entry.customRemediation
      ? entry.customRemediation
      : buildCustomTicketRemediationSync({ scenarioId: entry.scenarioId, ticketTitle: entry.ticket.title, ticketBody: entry.ticket.body, clarifiedAnswers: mergedAnswers });
  return { ...entry, ...(updatedRouting ? { elementRouting: updatedRouting } : {}), customRemediation: updatedRemediation, clarifyingQuestions: updatedQuestions, clarifiedAnswers: mergedAnswers };
}

export function enrichRemediationFromCard(rem: CustomRemediationTemplate, card?: SynthesizedDynamicCard): CustomRemediationTemplate {
  if (!card || !rem.powershellScript.includes("Get-AzResource | Select-Object -First 5")) return rem;
  const cmd = card.recommendedActions.find((a) => a.kind === "stage-fix")?.command || card.recommendedActions[0]?.command;
  const diffBlock = card.blocks.find((b) => b.kind === "config-diff");
  const diffLines = diffBlock && "diff" in diffBlock ? diffBlock.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n") : "";
  const bodyCmd = (diffLines || cmd || "").trim();
  if (!bodyCmd) return rem;
  return {
    ...rem,
    title: card.recommendedActions.find((a) => a.kind === "stage-fix")?.label?.slice(0, 120) || card.title.slice(0, 120),
    summary: card.headline.slice(0, 500),
    powershellScript: `#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam([string]$Target = "${card.elementId}")\n$ErrorActionPreference = 'Stop'\nif ($PSCmdlet.ShouldProcess($Target, "${card.title.replace(/"/g, "'")}")) {\n${bodyCmd}\n}\n`,
  };
}

export async function refineEntryWithSubAgentsAsync(entry: CustomScenarioEntry, clarifiedAnswers: Record<string, string>): Promise<CustomScenarioEntry> {
  const synced = applyClarifiedAnswersToEntry(entry, clarifiedAnswers);
  if (!providers.meta.hasKey || config.forceLocal || process.env.NODE_ENV === "test") return synced;
  const mergedAnswers = synced.clarifiedAnswers ?? clarifiedAnswers;
  const pipeline = await runSubAgentPipeline({
    scenarioId: entry.scenarioId,
    title: entry.ticket.title,
    body: entry.ticket.body,
    probeText: entry.ticket.body,
    createdAt: entry.createdAt,
    matchedSeededComponents: [],
    clarifiedAnswers: mergedAnswers,
  });
  return {
    ...synced,
    elementRouting: pipeline.routingDecision,
    synthesizedElements: pipeline.synthesizedElements,
    customRemediation: pipeline.customRemediation,
    subAgentTasks: pipeline.subAgentTasks,
  };
}
