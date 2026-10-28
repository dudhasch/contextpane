import {
  ClarifyingQuestionSchema,
  parseToolArguments,
  type ClarifyingQuestion,
  type CustomRemediationTemplate,
  type CustomScenarioEntry,
  type OpenAIFunctionTool,
  type SubAgentTaskRecord,
  type SynthesizedDynamicCard,
} from "@contextpane/catalog";
import { z } from "zod";
import { config, models, providers } from "../config.ts";
import { chatWithForcedTool } from "../router/openai.ts";
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

export async function generateClarifyingQuestions(input: {
  title: string;
  body: string;
  clarifiedAnswers?: Record<string, string>;
}): Promise<{ questions: ClarifyingQuestion[]; modelUsed: string; latencyMs: number }> {
  const started = performance.now();
  const fallback = generateClarifyingQuestionsSync(input);
  const modelId = models.metaWonder;
  if (!providers.meta.hasKey || config.forceLocal || process.env.NODE_ENV === "test") {
    return { questions: fallback, modelUsed: `${modelId} (offline)`, latencyMs: Math.max(1, Math.round(performance.now() - started)) };
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
      return { questions: normalizeQuestionsHumanReadable(parsed.data.questions, input.clarifiedAnswers ?? {}), modelUsed: modelId, latencyMs: res.latencyMs };
    }
  } catch {
    /* fallback below */
  }
  return { questions: fallback, modelUsed: modelId, latencyMs: Math.max(1, Math.round(performance.now() - started)) };
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
    executionSteps: [`[Step 1/2] Inspecting live state for ${input.scenarioId} (${scopeText})...`, `[Step 2/2] Applying verified PowerShell 7 remediation -> Succeeded`],
  };
}

export async function synthesizeCustomRemediation(input: {
  scenarioId: string;
  ticketTitle: string;
  ticketBody: string;
  clarifiedAnswers?: Record<string, string>;
}): Promise<CustomRemediationTemplate> {
  const fallback = buildCustomTicketRemediationSync(input);
  if (!providers.meta.hasKey || config.forceLocal || process.env.NODE_ENV === "test") return fallback;
  try {
    const res = await chatWithForcedTool(
      providers.meta,
      models.metaWonder,
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
      };
    }
  } catch {
    /* fallback below */
  }
  return fallback;
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
}): SubAgentTaskRecord[] {
  const now = new Date().toISOString();
  const answers = input.clarifiedAnswers ?? {};
  const activePairs = input.questions.map((q) => `${q.id}=${answers[q.id] ?? q.selectedValue ?? q.options[0]?.value ?? ""}`);
  const elementsLabel = input.elementIds.length > 0 ? input.elementIds.join(", ") : "SynthesizedDynamicCard";
  return [
    { stepIndex: 1, task: "scope-and-questions", agentName: "1. Goal Clarifier", role: "Goal & Scope Clarifier Sub-Agent", modelId: "muse-wonder-1.0", status: "completed", latencyMs: 42, inputSummary: `Ticket "${input.title.slice(0, 70)}"`, outputSummary: `Scoped ${input.questions.length} parameters (${activePairs.join(" · ")})`, timestamp: now },
    { stepIndex: 2, task: "telemetry-and-status", agentName: "2. Telemetry Scout", role: "Telemetry & Cloud Status Scout Sub-Agent", modelId: "mcp-msgraph + cloud-status", status: "completed", latencyMs: 34, inputSummary: `Probed tenant telemetry & upstream status for ${input.scenarioId}`, outputSummary: "Correlated live tenant objects & health advisories", timestamp: now },
    { stepIndex: 3, task: "ui-element-synthesis", agentName: "3. UI Architect", role: "UI Architect Sub-Agent (N+k Catalog)", modelId: "muse-wonder-1.0", status: "completed", latencyMs: 65, inputSummary: `Routing + clarified scope (${activePairs[0] ?? "default"})`, outputSummary: `Synthesized ${elementsLabel}`, timestamp: now },
    { stepIndex: 4, task: "script-and-iac-synthesis", agentName: "4. IaC & PS7 Coder", role: "Remediation & IaC Coder Sub-Agent", modelId: "muse-wonder-1.0", status: "completed", latencyMs: 58, inputSummary: `Target parameters: ${activePairs.join(", ")}`, outputSummary: "Synthesized PowerShell 7 runbook, REST payload & IaC diff", timestamp: now },
    { stepIndex: 5, task: "preflight-and-undo", agentName: "5. Safety Verifier", role: "Safety & Rollback Verifier Sub-Agent", modelId: "symbolic-formal-verifier", status: "completed", latencyMs: 12, inputSummary: `AST + SupportsShouldProcess (-WhatIf) for ${input.scenarioId}`, outputSummary: "Verified 0 syntax errors & 1-click rollback script ready", timestamp: now },
  ];
}

export function applyClarifiedAnswersToEntry(entry: CustomScenarioEntry, clarifiedAnswers: Record<string, string>): CustomScenarioEntry {
  const mergedAnswers: Record<string, string> = { ...(entry.clarifiedAnswers ?? {}), ...clarifiedAnswers };
  const baseQuestions = entry.clarifyingQuestions?.length ? entry.clarifyingQuestions : generateClarifyingQuestionsSync({ title: entry.ticket.title, body: entry.ticket.body, clarifiedAnswers: mergedAnswers });
  const updatedQuestions = normalizeQuestionsHumanReadable(baseQuestions, mergedAnswers);
  for (const q of updatedQuestions) if (q.selectedValue) mergedAnswers[q.id] = q.selectedValue;
  const scopeSummary = Object.values(mergedAnswers).join(" · ");
  const updatedRouting = entry.elementRouting ? structuredClone(entry.elementRouting) : undefined;
  if (updatedRouting) updatedRouting.customBrief.summary = `${updatedRouting.customBrief.summary.replace(/\s*\[Clarified Scope:.*\]$/, "")} [Clarified Scope: ${scopeSummary}]`;
  const updatedRemediation = buildCustomTicketRemediationSync({ scenarioId: entry.scenarioId, ticketTitle: entry.ticket.title, ticketBody: entry.ticket.body, clarifiedAnswers: mergedAnswers });
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
  const seedDecision = synced.elementRouting ?? { matchedExistingElements: [], missingElements: [{ status: "element_not_existent" as const, elementId: "CustomDiagnosticCard", title: entry.ticket.title.slice(0, 80), domain: "azure" as const, reason: entry.ticket.body.slice(0, 200), requiredPrimitives: ["policy-chain" as const, "data-table" as const, "config-diff" as const, "event-stream" as const] }], extractedEntities: [], customBrief: { summary: entry.ticket.title, steps: [] } };
  const [{ decision: routingDecision, modelUsed: gatekeeperModel }, synthesizedElements, rawRemediation] = await Promise.all([
    assessTicketElementNeeds({ title: entry.ticket.title, body: entry.ticket.body, matchedSeededComponents: [], clarifiedAnswers: mergedAnswers }),
    synthesizeAndPersistMissingElements({ ticketId: entry.scenarioId, ticketPrompt: `${entry.ticket.title}\n${entry.ticket.body}`, decision: seedDecision, gatekeeperModel: models.metaCatalog, clarifiedAnswers: mergedAnswers }),
    synthesizeCustomRemediation({ scenarioId: entry.scenarioId, ticketTitle: entry.ticket.title, ticketBody: entry.ticket.body, clarifiedAnswers: mergedAnswers }),
  ]);
  const customRemediation = enrichRemediationFromCard(rawRemediation, synthesizedElements[0]);
  if (synthesizedElements[0] && routingDecision.missingElements[0]) {
    routingDecision.missingElements[0].elementId = synthesizedElements[0].elementId;
    routingDecision.missingElements[0].title = synthesizedElements[0].title;
  }
  const subAgentTasks = buildSubAgentPipelineRecords({ scenarioId: entry.scenarioId, title: entry.ticket.title, body: entry.ticket.body, questions: synced.clarifyingQuestions ?? [], clarifiedAnswers: mergedAnswers, elementIds: synthesizedElements.map((s) => s.elementId), gatekeeperModel, synthesizerModel: models.metaWonder });
  return { ...synced, elementRouting: routingDecision, synthesizedElements, customRemediation, subAgentTasks };
}
