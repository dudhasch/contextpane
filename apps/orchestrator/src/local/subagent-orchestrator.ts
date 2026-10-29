import {
  ClarifyingQuestionSchema,
  parseToolArguments,
  type ClarifyingQuestion,
  type CustomRemediationTemplate,
  type CustomScenarioEntry,
  type ElementRoutingDecision,
  type OpenAIFunctionTool,
  type SteeringParams,
  type SubAgentTaskRecord,
  type SynthesizedDynamicCard,
  type UpstreamCloudStatusCorrelation,
} from "@contextpane/catalog";
import { z } from "zod";
import { models, providers } from "../config.ts";
import { chatWithForcedTool, metaCallsEnabled, type TokenUsage } from "../router/openai.ts";
import { progressReporter, type ProgressSink } from "../tiers/progress.ts";
import { correlateUpstreamCloudStatus } from "./cloud-status-correlator.ts";
import { assessTicketElementNeeds, findCatalogEntry, synthesizeAndPersistMissingElements } from "./dynamic-catalog.ts";
import { deriveSteeringFromAnswers, steeringForCoder } from "./steering.ts";
import {
  ABAC_ELEMENT_ID,
  abacChoiceFromAnswers,
  abacClarifyingQuestions,
  abacFacts,
  abacMissingElement,
  abacRoutingDecision,
  abacScriptExpectations,
  buildAbacRemediationSync,
  getAbacLabState,
  isAbacTicketText,
  rebindAbacEvents,
} from "./abac.ts";

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
  if (isAbacTicketText(`${input.title}\n${input.body}`)) return abacClarifyingQuestions(answers);
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
  /** Prompt / completion split when the provider reported one. */
  usage?: TokenUsage;
  status: "completed" | "fallback";
  source: "llm" | "fallback-on-error" | "not-attempted";
}

export async function generateClarifyingQuestions(input: {
  title: string;
  body: string;
  clarifiedAnswers?: Record<string, string>;
}): Promise<ClarifierSubAgentResult> {
  const started = performance.now();
  const fallback = generateClarifyingQuestionsSync(input);
  const modelId = models.metaWonder;
  // ABAC tickets get the policy's two steering questions: no model call, and the pills stay stable across takes.
  if (isAbacTicketText(`${input.title}\n${input.body}`)) {
    return { questions: fallback, modelUsed: "abac-policy-contract", latencyMs: Math.max(1, Math.round(performance.now() - started)), tokensUsed: 0, status: "completed", source: "not-attempted" };
  }
  if (!metaCallsEnabled()) {
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
        usage: res.usage,
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

/** The Key Vault a ticket names (kv-contoso-fin-02, "Key Vault kv-x"), or null. */
function keyVaultNameIn(text: string): string | null {
  const m = /\b(kv-[a-z0-9][a-z0-9-]{1,22}|(?:key ?vault|vault)\s+([a-z0-9][a-z0-9-]{2,23}))\b/i.exec(text);
  if (!m) return null;
  return (m[2] ?? m[1] ?? "").replace(/^(key ?vault|vault)\s+/i, "") || null;
}

/**
 * The deterministic coder. It reads the typed steering, so the offline path produces the same
 * cmdlet family as the model path would: a soft-deleted Key Vault steered to "recover" gets
 * Undo-AzKeyVaultRemoval, steered to "purge-recreate" gets Remove-AzKeyVault -InRemovedState
 * followed by New-AzKeyVault. Anything else keeps the generic inspect-first template.
 */
export function buildCustomTicketRemediationSync(input: {
  scenarioId: string;
  ticketTitle: string;
  ticketBody: string;
  clarifiedAnswers?: Record<string, string>;
  steering?: SteeringParams;
}): CustomRemediationTemplate {
  if (isAbacTicketText(`${input.ticketTitle}\n${input.ticketBody}`)) return buildAbacRemediationSync(input);
  const scopeText = Object.values(input.clarifiedAnswers ?? {}).join(" · ") || "Default Scope";
  const cleanTitle = input.ticketTitle.trim() || "Cloud Remediation";
  const strategy = input.steering?.remediationStrategy?.value;
  const steeringLine = input.steering ? `# Steering v${input.steering.version}: ${["remediationStrategy", "scope", "governance", "targetResource", "region"].map((k) => { const p = (input.steering as Record<string, { value?: unknown } | undefined>)[k]; return p ? `${k}=${String(p.value)}` : null; }).filter(Boolean).join(" ") || "defaults"}` : "# Steering: defaults";
  const vault = input.steering?.targetResource?.value ?? keyVaultNameIn(`${input.ticketTitle}\n${input.ticketBody}`);
  const whatIf = (target: string, action: string, body: string[]) =>
    [
      "#Requires -Version 7.0",
      "[CmdletBinding(SupportsShouldProcess = $true)]",
      // No region literal unless the operator steered one: the vault's own location is read back at run time.
      `param([string]$Target = "${target}", [string]$ResourceGroupName = "", [string]$Location = "${input.steering?.region?.value ?? ""}")`,
      "$ErrorActionPreference = 'Stop'",
      `# Clarified Scope: ${scopeText}`,
      steeringLine,
      `if ($PSCmdlet.ShouldProcess($Target, "${action.replace(/"/g, "'")}")) {`,
      ...body.map((l) => `  ${l}`),
      "}",
      "",
    ].join("\n");
  if (vault && /key ?vault|kv-|soft[- ]delete|purge/i.test(`${input.ticketTitle} ${input.ticketBody}`) && (strategy === "recover" || strategy === "purge-recreate")) {
    const recover = strategy === "recover";
    const script = recover
      ? whatIf(vault, `Recover soft-deleted Key Vault ${vault} in place`, [
          "$deleted = Get-AzKeyVault -InRemovedState | Where-Object { $_.VaultName -eq $Target -and (-not $Location -or $_.Location -eq $Location) } | Select-Object -First 1",
          "if (-not $deleted) { throw \"Key Vault $Target is not in the soft-deleted state\" }",
          "Undo-AzKeyVaultRemoval -VaultName $Target -ResourceGroupName $deleted.ResourceGroupName -Location $deleted.Location | Out-Null",
          "Get-AzKeyVault -VaultName $Target | Select-Object VaultName, ResourceGroupName, EnablePurgeProtection",
        ])
      : whatIf(vault, `Purge soft-deleted Key Vault ${vault} and recreate it clean`, [
          "$deleted = Get-AzKeyVault -InRemovedState | Where-Object { $_.VaultName -eq $Target -and (-not $Location -or $_.Location -eq $Location) } | Select-Object -First 1",
          "if (-not $deleted) { throw \"Key Vault $Target is not in the soft-deleted state\" }",
          "if ($deleted.EnablePurgeProtection) { throw \"Key Vault $Target has purge protection: it cannot be purged before its retention ends\" }",
          "Remove-AzKeyVault -VaultName $Target -Location $deleted.Location -InRemovedState -Force",
          "New-AzKeyVault -VaultName $Target -ResourceGroupName ($ResourceGroupName ? $ResourceGroupName : $deleted.ResourceGroupName) -Location $deleted.Location -EnablePurgeProtection | Out-Null",
        ]);
    return {
      title: `${recover ? "Recover" : "Purge & recreate"} Key Vault ${vault}`.slice(0, 120),
      summary: recover
        ? `Recovers the soft-deleted Key Vault ${vault} in place with Undo-AzKeyVaultRemoval; keys, secrets and access policies return as they were (${scopeText}).`
        : `Purges the soft-deleted Key Vault ${vault} and recreates it clean; refused by Azure while purge protection is on (${scopeText}).`,
      powershellScript: script,
      terraformDiff: "",
      graphPatch: JSON.stringify({ scenarioId: input.scenarioId, keyVault: vault, strategy, clarifiedScope: input.clarifiedAnswers ?? {} }, null, 2),
      rollbackScript: recover
        ? whatIf(vault, `Soft-delete Key Vault ${vault} again (reverses the recovery)`, ["Remove-AzKeyVault -VaultName $Target -Force"])
        : whatIf(vault, `Remove the recreated Key Vault ${vault} (the purged vault cannot be restored)`, ["Remove-AzKeyVault -VaultName $Target -Force"]),
      affectedEntities: [{ type: "resource", id: vault, change: recover ? "soft-deleted -> recovered in place" : "soft-deleted -> purged, recreated empty" }],
      requiredCommands: recover ? ["get-azkeyvault", "undo-azkeyvaultremoval"] : ["get-azkeyvault", "remove-azkeyvault", "new-azkeyvault"],
      riskNotes: recover
        ? ["Recovery keeps every key, secret and certificate; nothing is lost."]
        : ["Purging is irreversible: every key and secret in the vault is destroyed.", "Azure refuses the purge while purge protection is enabled."],
      executionSteps: recover
        ? [`[Step 1/2] Confirm ${vault} is soft-deleted in $Location`, `[Step 2/2] Undo-AzKeyVaultRemoval and read the vault back`]
        : [`[Step 1/2] Confirm ${vault} is soft-deleted and not purge-protected`, `[Step 2/2] Remove-AzKeyVault -InRemovedState, then New-AzKeyVault`],
    };
  }
  return {
    title: `Remediate ${input.scenarioId}: ${cleanTitle}`.slice(0, 120),
    summary: `Remediation bundle for "${cleanTitle}" (${scopeText}).`,
    powershellScript: whatIf(input.steering?.targetResource?.value ?? input.scenarioId, `Apply remediation for ${cleanTitle}`, ["Get-AzResource | Select-Object -First 5"]),
    terraformDiff: `--- a/demo-iac/remediation.tf\n+++ b/demo-iac/remediation.tf\n@@ -1,3 +1,5 @@\n+# Scenario: ${input.scenarioId}\n+# Scope: ${scopeText}\n`,
    graphPatch: JSON.stringify({ scenarioId: input.scenarioId, clarifiedScope: input.clarifiedAnswers ?? {} }, null, 2),
    rollbackScript: `#Requires -Version 7.0\n[CmdletBinding(SupportsShouldProcess = $true)]\nparam([string]$Target = "${input.scenarioId}")\n`,
    affectedEntities: [{ type: "resource", id: input.steering?.targetResource?.value ?? input.scenarioId, change: `Apply clarified remediation (${scopeText})`.slice(0, 180) }],
    requiredCommands: ["get-azresource"],
    riskNotes: ["All mutating cmdlets are wrapped in $PSCmdlet.ShouldProcess (-WhatIf safe)."],
    executionSteps: [`[Step 1/2] Inspect live state for ${input.scenarioId} (${scopeText})`, `[Step 2/2] Run the approved PowerShell 7 remediation`],
  };
}

export interface RemediationCoderMeta {
  modelUsed: string;
  latencyMs: number;
  tokensUsed: number;
  /** Prompt / completion split when the provider reported one. */
  usage?: TokenUsage;
  status: "completed" | "fallback";
  source: "llm" | "fallback-on-error";
}

export type SynthesizedRemediationWithMeta = CustomRemediationTemplate & { _meta?: RemediationCoderMeta };

export interface CoderInput {
  scenarioId: string;
  ticketTitle: string;
  ticketBody: string;
  clarifiedAnswers?: Record<string, string>;
  /** Typed operator steering; the prompt receives it as the contract the script must honour (U-1). */
  steering?: SteeringParams;
  /** The script a re-parameterisation starts from: the model changes only what the steering requires. */
  previousScript?: string;
  /** Sandbox findings from the last pre-flight; a repair turn fixes exactly these (U-2). */
  repairFindings?: string[];
}

export async function synthesizeCustomRemediation(input: CoderInput): Promise<SynthesizedRemediationWithMeta> {
  const started = performance.now();
  const fallback = buildCustomTicketRemediationSync(input);
  const modelId = models.metaWonder;
  if (!metaCallsEnabled()) {
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
  const abacChoice = isAbacTicketText(`${input.ticketTitle}\n${input.ticketBody}`) ? abacChoiceFromAnswers(input.clarifiedAnswers) : null;
  const abacContext = abacChoice ? abacFacts(await getAbacLabState(), { createdAt: new Date().toISOString() }, abacChoice) : null;
  try {
    const res = await chatWithForcedTool(
      providers.meta,
      modelId,
      [
        {
          role: "system",
          content:
            "You are Sub-Agent 4 (IaC & PowerShell 7 Coder · muse-wonder-1.0) in ContextPane. " +
            (abacChoice
              ? `This is an Azure ABAC ticket: use only the names in abacFacts and never invent resources. Steering: strategy=${abacChoice.strategy}, container=${abacChoice.container ?? "all"}. ` +
                (abacChoice.strategy === "exemption"
                  ? "Write New-AzPolicyExemption on the storage account for the named policy assignment, then New-AzRoleAssignment. "
                  : `Write New-AzRoleAssignment for the identity on the storage account scope${abacChoice.container ? " with -Condition set to exactly abacFacts.condition and -ConditionVersion '2.0'" : " without a condition"}; terraformDiff is an OpenTofu azurerm_role_assignment${abacChoice.container ? " with condition_version and condition" : ""}. `) +
                "Start the script with a guard that throws unless (Get-AzContext).Subscription.Id equals the lab subscription id. "
              : "") +
            "Synthesize a concise, domain-accurate 15-line PowerShell 7 script (using [CmdletBinding(SupportsShouldProcess = $true)] and $PSCmdlet.ShouldProcess), unified Terraform diff, rollback script, and 3 executionSteps directly matching the operator's ticket AND the typed `steering` contract (remediationStrategy, scope, governance, targetResource, targetIds, region, dryRun) derived from their clarifier answers and in-card selections. " +
            "CRITICAL: The PowerShell cmdlets MUST reflect `steering.remediationStrategy` exactly (recover => in-place recovery cmdlets such as Undo-AzKeyVaultRemoval, never a purge; purge-recreate => Remove-… -InRemovedState then New-…; gitops-bundle => declarative Terraform plus a thin runbook). " +
            (input.previousScript ? "A `previousScript` is supplied: re-parameterise it — keep its structure, parameter names and guards, change only the lines the new steering requires, and keep every unrelated line byte-identical. " : "") +
            (input.repairFindings?.length ? "`repairFindings` lists what the sandbox pre-flight rejected in the previous script: fix exactly those findings (add the missing param() block, wrap every mutating cmdlet in $PSCmdlet.ShouldProcess, remove forbidden commands) and change nothing else. " : ""),
        },
        {
          role: "user",
          content: JSON.stringify({
            scenarioId: input.scenarioId,
            ticketTitle: input.ticketTitle,
            ticketBody: input.ticketBody,
            clarifiedAnswers: input.clarifiedAnswers ?? {},
            ...(input.steering ? { steering: steeringForCoder(input.steering) } : {}),
            ...(input.previousScript ? { previousScript: input.previousScript } : {}),
            ...(input.repairFindings?.length ? { repairFindings: input.repairFindings } : {}),
            ...(abacContext ? { abacFacts: abacContext } : {}),
          }),
        },
      ],
      REMEDIATION_CODER_TOOL,
      { timeoutMs: 32000, temperature: 0.1, maxTokens: 4000, reasoningEffort: "low" },
    );
    const raw = parseToolArguments(res.argumentsRaw) as Partial<CustomRemediationTemplate>;
    // An ABAC script that lost the steered cmdlet, a lab name or the condition is not shipped: the template is.
    const abacOk = !abacChoice || (typeof raw?.powershellScript === "string" && abacScriptExpectations(abacChoice).every((t) => raw.powershellScript!.includes(t)));
    if (raw && abacOk && typeof raw.title === "string" && typeof raw.powershellScript === "string" && raw.powershellScript.length > 30) {
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
          usage: res.usage,
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

export interface SyntaxPrecheckResult {
  name: "syntax-heuristic";
  repairedScript: string;
  passed: boolean;
  repaired: boolean;
  warnings: string[];
  latencyMs: number;
}

/**
 * The cheap pre-check that runs before any sandbox: brace counting, a destructive-wildcard
 * regex, an empty-default-parameter regex and the SupportsShouldProcess guard. It is a
 * heuristic, not an AST parse and not a verdict (M-01, U-2): the real verification is the
 * pre-flight in `preflight/*` (pwsh AST + cmdlet allow-list + terraform validate, in the
 * Modal sandbox when configured). When the guard is the only thing missing it wraps the
 * script in one, keeping a leading param() block as the first statement; Auto-Fix and the
 * triage path use that.
 */
/** Splits a script's leading param(...) block (balanced parentheses) from the statements after it. */
function splitParamBlock(lines: string[]): { paramLines: string[]; bodyLines: string[] } {
  const start = lines.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (start < 0 || !/^param\s*\(/i.test(lines[start]!.trim())) return { paramLines: [], bodyLines: lines };
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth <= 0) return { paramLines: lines.slice(start, i + 1), bodyLines: [...lines.slice(0, start), ...lines.slice(i + 1)] };
  }
  return { paramLines: [], bodyLines: lines };
}

export function syntaxHeuristicPrecheck(script: string, scenarioId: string): SyntaxPrecheckResult {
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
    const lines = current
      .split(/\r?\n/)
      .filter((line) => !/^#Requires\b/i.test(line.trim()) && !/^\[CmdletBinding/i.test(line.trim()));
    // A param() block must stay the first statement: keep it outside the ShouldProcess guard.
    const { paramLines, bodyLines } = splitParamBlock(lines);
    current = [
      "#Requires -Version 7.0",
      "[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]",
      ...(paramLines.length ? paramLines : [`param([string]$Target = "${scenarioId}")`]),
      "$ErrorActionPreference = 'Stop'",
      `if ($PSCmdlet.ShouldProcess("${scenarioId}", "Execute verified remediation for ${scenarioId}")) {`,
      ...bodyLines.map((l) => `  ${l}`),
      "}",
    ].join("\n");
    repaired = true;
  } else if (!hasShouldProcessAttr || !hasShouldProcessCall) {
    warnings.push("Script is missing [CmdletBinding(SupportsShouldProcess = $true)] or $PSCmdlet.ShouldProcess guard.");
  }

  return {
    name: "syntax-heuristic",
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
  /** Prompt / completion split, stored on the record so the Router Savings HUD can show it (HARD_CASES 10). */
  usage?: TokenUsage;
  status?: "completed" | "running" | "fallback";
  source?: SubAgentTaskRecord["source"];
  iterations?: number;
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
  // The split is what the records carry; a step without one contributes only to the total.
  const prompt = llmSteps.reduce((sum, t) => sum + (t.tokensPrompt ?? 0), 0);
  const completion = llmSteps.reduce((sum, t) => sum + (t.tokensCompletion ?? 0), 0);
  return {
    provider: llmSteps.length ? "meta" : "local",
    modelId: llmSteps.length ? [...new Set(llmSteps.map((t) => t.modelId))].join(" + ") : "deterministic-router",
    tokensUsed: { prompt, completion, total },
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
      ...(m[1]?.usage ? { tokensPrompt: m[1].usage.prompt, tokensCompletion: m[1].usage.completion } : {}),
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
      ...(m[2]?.usage ? { tokensPrompt: m[2].usage.prompt, tokensCompletion: m[2].usage.completion } : {}),
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
      ...(m[3]?.usage ? { tokensPrompt: m[3].usage.prompt, tokensCompletion: m[3].usage.completion } : {}),
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
      ...(m[4]?.usage ? { tokensPrompt: m[4].usage.prompt, tokensCompletion: m[4].usage.completion } : {}),
      ...(m[4]?.iterations !== undefined ? { iterations: m[4].iterations } : {}),
      inputSummary: `Target parameters: ${activePairs.join(", ")}`,
      outputSummary: !m[4] ? "Not run for this ticket" : m[4].outputSummary ?? "Synthesized PowerShell 7 runbook, REST payload & IaC diff",
      timestamp: now,
    },
    {
      stepIndex: 5,
      task: "preflight-and-undo",
      agentName: "5. Safety Verifier",
      role: "Safety & Rollback Verifier Sub-Agent",
      modelId: m[5] ? (m[5].modelId ?? "syntax-heuristic") : "not run",
      status: m[5] ? (m[5].status ?? "completed") : "fallback",
      source: m[5] ? (m[5].source ?? "syntax-heuristic") : "not-attempted",
      latencyMs: m[5]?.latencyMs ?? 0,
      ...(m[5]?.startOffsetMs !== undefined ? { startOffsetMs: m[5].startOffsetMs } : {}),
      ...(m[5]?.tokensUsed !== undefined ? { tokensUsed: m[5].tokensUsed } : {}),
      ...(m[5]?.usage ? { tokensPrompt: m[5].usage.prompt, tokensCompletion: m[5].usage.completion } : {}),
      inputSummary: `Syntax pre-check (braces, guard, wildcards) for ${input.scenarioId}; sandbox pre-flight when the fix is staged`,
      outputSummary: !m[5] ? "Not run for this ticket" : m[5].outputSummary ?? "Syntax pre-check passed; the sandbox pre-flight runs when the fix is staged",
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

/**
 * Streams the pipeline as it runs (WP6): `agent:<n>:start` when a sub-agent launches and
 * `agent:<n>:done` with whatever it produced, so each block can refill on its own beat. Stage 3
 * also reports `agent:3:routed` with the gatekeeper's decision (the plan steps) before the
 * synthesizer finishes the card.
 */
export async function runSubAgentPipeline(
  input: {
    scenarioId: string;
    title: string;
    body: string;
    probeText: string;
    createdAt: string;
    matchedSeededComponents: string[];
    clarifiedAnswers?: Record<string, string>;
    /** The steering the entry already carries; its version continues from here. */
    steering?: SteeringParams;
    /** The ticket's sender; the ABAC scout starts from this identity. */
    requesterUpn?: string;
  },
  onProgress?: ProgressSink,
): Promise<{
  routingDecision: ElementRoutingDecision;
  gatekeeperModel: string;
  cloudStatusCorrelation: UpstreamCloudStatusCorrelation;
  clarifyingQuestions: ClarifyingQuestion[];
  clarifiedAnswers: Record<string, string>;
  steering: SteeringParams;
  synthesizedElements: SynthesizedDynamicCard[];
  customRemediation: CustomRemediationTemplate;
  subAgentTasks: SubAgentTaskRecord[];
}> {
  const pipelineStart = performance.now();
  const offset = (t: number) => Math.round(t - pipelineStart);
  const report = progressReporter(onProgress);
  // S2 needs nothing from the other sub-agents, so it probes telemetry for the whole run.
  const t2Start = performance.now();
  const abac = isAbacTicketText(`${input.title}\n${input.body}`);
  // ABAC: the scout reads the payroll estate live (storage, identity, deny policy, denied writes) next to the cloud feeds.
  const abacStatePromise = abac ? getAbacLabState({ fresh: true }) : null;
  report("agent:2:start", abac ? "Telemetry Scout reading the sender's denied write, storage and policy state" : "Telemetry Scout probing live tenant & upstream cloud status");
  const statusPromise = Promise.all([
    correlateUpstreamCloudStatus({
      ticketText: `${input.title}\n${input.body}`,
      createdAt: input.createdAt,
    }),
    abacStatePromise,
  ]).then(([res, abacState]) => {
    const wallClockMs = Math.max(1, Math.round(performance.now() - t2Start));
    const abacLine = abacState
      ? ` · ${abacState.source === "live" ? "live" : "fixture"} ARM read: ${abacState.storage.name}, ${abacState.identity.name}, ${abacState.policy.assignmentName} (${abacState.latencyMs} ms) · RequestDisallowedByPolicy correlated`
      : "";
    report("agent:2:done", `Telemetry Scout correlated ${res.services.length} cloud feeds${abacLine} (${wallClockMs} ms)`, {
      cloudStatusCorrelation: res,
      ...(abacState ? { abacLab: abacFacts(abacState, { createdAt: input.createdAt, ...(input.requesterUpn ? { requesterUpn: input.requesterUpn } : {}) }) } : {}),
    });
    return { data: res, wallClockMs, abac: abacState };
  });

  // S1 first: its answers steer the gatekeeper, the UI architect and the coder (L-05, L-07).
  const t1Start = performance.now();
  report("agent:1:start", "Goal Clarifier scoping target & parameters");
  const clarifierRes = await generateClarifyingQuestions({
    title: input.title,
    body: input.body,
    ...(input.clarifiedAnswers ? { clarifiedAnswers: input.clarifiedAnswers } : {}),
  }).then((res) => ({ ...res, wallClockMs: Math.max(1, Math.round(performance.now() - t1Start)) }));
  const effectiveAnswers = effectiveClarifiedAnswers(clarifierRes.questions, input.clarifiedAnswers);
  // The typed steering both S3 and S4 read; the coder gets it as its contract, not a label string (U-1).
  const steering = deriveSteeringFromAnswers(clarifierRes.questions, effectiveAnswers, { previous: input.steering });
  report("agent:1:done", `Goal Clarifier scoped ${clarifierRes.questions.length} parameters (${clarifierRes.wallClockMs} ms)`, {
    clarifyingQuestions: clarifierRes.questions,
    clarifiedAnswers: effectiveAnswers,
  });

  // S3 is a real Spark → Wonder chain: the synthesizer builds what the gatekeeper decided.
  // The gatekeeper call carries its own 10 s budget and falls back to the deterministic seed.
  const t3Start = performance.now();
  // N+1: an ABAC ticket whose view the catalog already holds skips the gatekeeper and Wonder entirely.
  const catalogHit = abac && findCatalogEntry(ABAC_ELEMENT_ID) !== null;
  report("agent:3:start", catalogHit ? "UI Architect: catalog lookup" : "UI Architect routing the diagnostic view");
  const routingPromise: ReturnType<typeof assessTicketElementNeeds> = catalogHit
    ? Promise.resolve({ decision: abacRoutingDecision(), modelUsed: "dynamic-catalog", latencyMs: 0, tokensUsed: 0, source: "fallback-on-error" as const })
    : (async () => {
        // Spark sees the ticket only (the zero-context ask); Wonder gets the live facts below.
        const routing = await assessTicketElementNeeds({
          title: input.title,
          body: input.probeText,
          matchedSeededComponents: input.matchedSeededComponents,
          clarifiedAnswers: effectiveAnswers,
          ...(abac ? { timeoutMs: 15000 } : {}),
        });
        if (!abac) return routing;
        // Every ABAC ticket names the same element, so the next one finds this one's card in the catalog.
        return routing.source === "llm" ? { ...routing, decision: { ...routing.decision, missingElements: [abacMissingElement()] } } : { ...routing, decision: abacRoutingDecision() };
      })();
  const uiPromise = routingPromise.then(async (routing) => {
    report("agent:3:routed", catalogHit ? `Catalog hit: ${ABAC_ELEMENT_ID} is already in the catalog · no Wonder call` : `Gatekeeper routed ${routing.decision.missingElements.length} view element(s) · ${routing.decision.customBrief.steps.length} plan steps`, {
      elementRouting: routing.decision,
    });
    const facts = abacStatePromise ? abacFacts(await abacStatePromise, { createdAt: input.createdAt, ...(input.requesterUpn ? { requesterUpn: input.requesterUpn } : {}) }) : null;
    let elements = await synthesizeAndPersistMissingElements({
      ticketId: input.scenarioId,
      ticketPrompt: `${input.title}\n${input.body}`,
      decision: routing.decision,
      gatekeeperModel: routing.source === "llm" ? routing.modelUsed : "deterministic-router",
      clarifiedAnswers: effectiveAnswers,
      ...(facts ? { facts, reuseFromCatalog: true } : {}),
    });
    // A reused view is rebound to this ticket's denied write; its layout and blocks stay as synthesized.
    if (catalogHit && facts) elements = elements.map((card) => rebindAbacEvents(card, facts.activity));
    const wallClockMs = Math.max(1, Math.round(performance.now() - t3Start));
    const hit = elements.some((e) => e.synthesisMeta.reusedFromCatalog);
    report("agent:3:done", hit ? `UI Architect reused ${elements.map((e) => e.elementId).join(", ")} from the catalog (${elements[0]?.synthesisMeta.latencyMs ?? 0} ms, 0 tokens)` : `UI Architect synthesized ${elements.map((e) => e.elementId).join(", ") || "no element"} (${wallClockMs} ms)`, { synthesizedElements: elements });
    return { routing, elements, wallClockMs: hit ? elements[0]?.synthesisMeta.latencyMs ?? 0 : wallClockMs, hit };
  });

  const t4Start = performance.now();
  report("agent:4:start", "IaC & PS7 Coder writing the PowerShell 7 runbook");
  const coderPromise = synthesizeCustomRemediation({
    scenarioId: input.scenarioId,
    ticketTitle: input.title,
    ticketBody: input.body,
    clarifiedAnswers: effectiveAnswers,
    steering,
  }).then((res) => {
    const wallClockMs = Math.max(1, Math.round(performance.now() - t4Start));
    const { _meta: _coderMeta, ...customRemediation } = res;
    report("agent:4:done", `IaC & PS7 Coder wrote ${customRemediation.powershellScript.split("\n").length} script lines (${wallClockMs} ms)`, { customRemediation });
    return { data: res, wallClockMs };
  });

  const [statusRes, uiRes, coderRes] = await Promise.all([statusPromise, uiPromise, coderPromise]);

  const routingDecision = uiRes.routing.decision;
  const gatekeeperModel = uiRes.routing.source === "llm" ? uiRes.routing.modelUsed : "deterministic-router";
  const synthesizedElements = uiRes.elements;

  const enrichedRemediation = enrichRemediationFromCard(coderRes.data, synthesizedElements[0]);
  const t5Start = performance.now();
  const safetyCheck = syntaxHeuristicPrecheck(enrichedRemediation.powershellScript, input.scenarioId);
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
        ...(clarifierRes.usage ? { usage: clarifierRes.usage } : {}),
        status: clarifierRes.status,
        source: clarifierRes.source,
      },
      2: {
        latencyMs: statusRes.wallClockMs,
        startOffsetMs: offset(t2Start),
        modelId: "mcp-msgraph + cloud-status",
        status: "completed",
        source: "mcp-probe",
        outputSummary: `Correlated ${statusRes.data.services.length} upstream cloud feeds (${statusRes.data.primaryRegion})${statusRes.abac ? ` · ${statusRes.abac.source === "live" ? "live" : "fixture"} ARM read of ${statusRes.abac.storage.name}, ${statusRes.abac.identity.name} and ${statusRes.abac.policy.assignmentName} (${statusRes.abac.latencyMs} ms) · RequestDisallowedByPolicy from the sender correlated` : ""}`,
      },
      3: uiRes.hit
        ? {
            latencyMs: uiRes.wallClockMs,
            startOffsetMs: offset(t3Start),
            modelId: "dynamic-catalog (N+1 hit)",
            tokensUsed: 0,
            status: "completed",
            source: "not-attempted",
            outputSummary: `Catalog hit: ${synthesizedElements.map((e) => e.elementId).join(", ")} reused ×${synthesizedElements[0]?.synthesisMeta.reuseCount ?? 1} in ${uiRes.wallClockMs} ms, no Wonder call`,
          }
        : {
            latencyMs: uiRes.wallClockMs,
            startOffsetMs: offset(t3Start),
            modelId: `${gatekeeperModel} -> ${uiUsedLlm ? models.metaWonder : "deterministic-template"}`,
            tokensUsed: uiRes.routing.tokensUsed ?? 0,
            ...(uiRes.routing.usage ? { usage: uiRes.routing.usage } : {}),
            status: uiUsedLlm ? "completed" : "fallback",
            source: uiUsedLlm ? "llm" : "fallback-on-error",
          },
      4: {
        latencyMs: coderRes.wallClockMs,
        startOffsetMs: offset(t4Start),
        modelId: coderRes.data._meta?.modelUsed ?? models.metaWonder,
        tokensUsed: coderRes.data._meta?.tokensUsed ?? 0,
        ...(coderRes.data._meta?.usage ? { usage: coderRes.data._meta.usage } : {}),
        status: coderRes.data._meta?.status ?? "fallback",
        source: coderRes.data._meta?.source ?? "fallback-on-error",
      },
      5: {
        latencyMs: safetyCheck.latencyMs,
        startOffsetMs: offset(t5Start),
        modelId: "syntax-heuristic",
        status: safetyCheck.passed ? "completed" : "fallback",
        source: "syntax-heuristic",
        outputSummary: safetyCheck.passed
          ? safetyCheck.repaired
            ? "Syntax pre-check: wrapped the script in a SupportsShouldProcess (-WhatIf) guard; the sandbox pre-flight runs when the fix is staged"
            : "Syntax pre-check passed (braces, guard, no destructive wildcards); the sandbox pre-flight runs when the fix is staged"
          : `Syntax pre-check flagged ${safetyCheck.warnings.length} warning(s): ${safetyCheck.warnings.join(" ")}`,
      },
    },
  });

  report("agent:5:done", safetyCheck.passed ? `Safety Verifier passed (${safetyCheck.latencyMs} ms)` : `Safety Verifier flagged ${safetyCheck.warnings.length} warning(s)`, {
    customRemediation,
    subAgentTasks,
  });

  return {
    routingDecision,
    gatekeeperModel,
    cloudStatusCorrelation: statusRes.data,
    clarifyingQuestions: clarifierRes.questions,
    clarifiedAnswers: effectiveAnswers,
    steering,
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
  const steering = deriveSteeringFromAnswers(updatedQuestions, mergedAnswers, { previous: entry.steering });
  const updatedRemediation =
    coderUsedLlm && entry.customRemediation
      ? entry.customRemediation
      : buildCustomTicketRemediationSync({ scenarioId: entry.scenarioId, ticketTitle: entry.ticket.title, ticketBody: entry.ticket.body, clarifiedAnswers: mergedAnswers, steering });
  return { ...entry, ...(updatedRouting ? { elementRouting: updatedRouting } : {}), customRemediation: updatedRemediation, clarifyingQuestions: updatedQuestions, clarifiedAnswers: mergedAnswers, steering };
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

/**
 * `onProgress` streams the refine (WP6): `agent:0:done` once the operator's answers are applied
 * (Tier 0, instant), then the pipeline's per-agent events. Without a model the Tier 0 pass is the
 * whole refine, so its event carries the routing and the remediation too.
 */
export async function refineEntryWithSubAgentsAsync(
  entry: CustomScenarioEntry,
  clarifiedAnswers: Record<string, string>,
  onProgress?: ProgressSink,
): Promise<CustomScenarioEntry> {
  const refineStart = performance.now();
  const report = progressReporter(onProgress);
  report("agent:0:start", "Applying the clarified scope");
  const synced = applyClarifiedAnswersToEntry(entry, clarifiedAnswers);
  const runsPipeline = metaCallsEnabled();
  report("agent:0:done", runsPipeline ? "Scope applied · sub-agents re-running" : "Scope applied (Tier 0, 0 tokens)", {
    clarifyingQuestions: synced.clarifyingQuestions ?? [],
    clarifiedAnswers: synced.clarifiedAnswers ?? {},
    // With the pipeline running, the routing and the script are stale until their agents report.
    ...(runsPipeline
      ? {}
      : {
          ...(synced.elementRouting ? { elementRouting: synced.elementRouting } : {}),
          ...(synced.customRemediation ? { customRemediation: synced.customRemediation } : {}),
        }),
  });
  if (!runsPipeline) return synced;
  const mergedAnswers = synced.clarifiedAnswers ?? clarifiedAnswers;
  // One clock for the whole refine: the pipeline's own reporter starts at 0, so shift it by the Tier 0 pass.
  const offsetMs = Math.round(performance.now() - refineStart);
  const pipelineSink: ProgressSink | undefined = onProgress ? (event) => onProgress({ ...event, elapsedMs: event.elapsedMs + offsetMs }) : undefined;
  const pipeline = await runSubAgentPipeline(
    {
      scenarioId: entry.scenarioId,
      title: entry.ticket.title,
      body: entry.ticket.body,
      probeText: entry.ticket.body,
      createdAt: entry.createdAt,
      matchedSeededComponents: [],
      clarifiedAnswers: mergedAnswers,
      ...(entry.ticket.requester?.upn ? { requesterUpn: entry.ticket.requester.upn } : {}),
      ...(synced.steering ? { steering: synced.steering } : {}),
    },
    pipelineSink,
  );
  return {
    ...synced,
    elementRouting: pipeline.routingDecision,
    synthesizedElements: pipeline.synthesizedElements,
    customRemediation: pipeline.customRemediation,
    subAgentTasks: pipeline.subAgentTasks,
    steering: pipeline.steering,
  };
}
