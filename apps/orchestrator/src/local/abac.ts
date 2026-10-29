import type { ClarifyingQuestion, CustomRemediationTemplate, ElementRoutingDecision, MissingElementSpec, SteeringParams, SynthesizedDynamicCard } from "@contextpane/catalog";
import {
  ABAC_LAB,
  abacCondition,
  abacExpression,
  fixtureAbacLabState,
  readAbacLabLive,
  ticketActivityEvent,
  type AbacActivityEvent,
  type AbacLabState,
} from "@contextpane/mcp-azure-iac";
import { isLiveCloudMode } from "../config.ts";

/**
 * Act II: a developer's deployment failed on "some ABAC policy" on Blob Storage, with no resource
 * names. This module recognises such a ticket, gives the Goal Clarifier its two steering questions,
 * hands the sub-agents the live lab facts (storage account, the Function App identity, the deny
 * policy, the denied write) and builds the deterministic bundle the coder falls back to.
 */

const ABAC_RE = /\bABAC\b|attribute[- ]based access|role assignment condition|RequestDisallowedByPolicy/i;
const STORAGE_RE = /\bblob|storage\b|stcontoso|payroll/i;

export function isAbacTicketText(text: string): boolean {
  return ABAC_RE.test(text) && STORAGE_RE.test(text);
}

/** The two Act II lab tickets, in queue order: the first synthesizes the view, the second reuses it. */
export const ABAC_TICKET_FOLDERS = ["#202688564", "#202688571"] as const;

/** The catalog element every ABAC ticket routes to, so the second ticket finds the first one's card. */
export const ABAC_ELEMENT_ID = "ManagementGroupAbacInheritanceCard";

export function abacMissingElement(): MissingElementSpec {
  return {
    status: "element_not_existent",
    elementId: ABAC_ELEMENT_ID,
    title: "Management Group ABAC Inheritance",
    domain: "azure",
    reason:
      "No catalog view shows how a Require-ABAC deny policy inherits down the scope chain onto a storage account, or which role-assignment condition would satisfy it.",
    requiredPrimitives: ["policy-chain", "data-table", "config-diff", "event-stream"],
  };
}

/* ---------------------------------------------------------------- clarifier */

export const ABAC_STRATEGY_QID = "abac-strategy";
export const ABAC_CONTAINER_QID = "abac-container";

export const ABAC_STRATEGY = {
  exemption: `Policy exemption for ${ABAC_LAB.identityName}`,
  condition: "Inject ABAC condition (least privilege)",
  reader: "Storage Blob Data Reader only",
} as const;
export const ABAC_ALL_CONTAINERS = `All containers in ${ABAC_LAB.storageAccount}`;

/**
 * Two questions. The defaults are what the requester asked for (exempt the app, all containers):
 * the drafted script shows that ask, and steering it is the operator's call.
 */
export function abacClarifyingQuestions(answers: Record<string, string> = {}): ClarifyingQuestion[] {
  const pick = (id: string, fallback: string) => answers[id] ?? fallback;
  return [
    {
      id: ABAC_STRATEGY_QID,
      question: "How should the Function App get write access to payroll storage?",
      category: "strategy",
      options: [
        { id: "opt-abac-exemption", label: "Policy exemption", value: ABAC_STRATEGY.exemption, description: `What the ticket asks for: waive ${ABAC_LAB.policyName} for the app` },
        { id: "opt-abac-condition", label: "Inject ABAC condition", value: ABAC_STRATEGY.condition, description: "Storage Blob Data Contributor, limited to one container by a role-assignment condition" },
        { id: "opt-abac-reader", label: "Read-only role", value: ABAC_STRATEGY.reader, description: "Storage Blob Data Reader: the ingest job could no longer write" },
      ],
      selectedValue: pick(ABAC_STRATEGY_QID, ABAC_STRATEGY.exemption),
    },
    {
      id: ABAC_CONTAINER_QID,
      question: "Which container may it write to?",
      category: "scope",
      customHint: "Or type a container name",
      options: [
        // Labels carry a space so the UI shows the container name verbatim instead of title-casing a slug.
        { id: "opt-container-all", label: "All containers", value: ABAC_ALL_CONTAINERS, description: "No container limit" },
        { id: "opt-container-payroll-drop", label: "payroll-drop container", value: "payroll-drop container", description: "The ingest drop zone the payroll files land in" },
        { id: "opt-container-payroll-archive", label: "payroll-archive container", value: "payroll-archive container", description: "Long-term archive" },
      ],
      selectedValue: pick(ABAC_CONTAINER_QID, ABAC_ALL_CONTAINERS),
    },
  ];
}

export interface AbacChoice {
  strategy: "exemption" | "condition" | "reader";
  /** null: every container (no container limit). */
  container: string | null;
}

/** Reads the two answers, matching on value, label or option id, case-insensitively. */
export function abacChoiceFromAnswers(answers: Record<string, string> = {}): AbacChoice {
  const s = (answers[ABAC_STRATEGY_QID] ?? "").toLowerCase();
  const strategy: AbacChoice["strategy"] = /condition|least/.test(s) ? "condition" : /reader|read-only/.test(s) ? "reader" : "exemption";
  // The answer may be the option value, its label, its id or a title-cased display form ("Payroll Drop"): map it to the real container name.
  const c = (answers[ABAC_CONTAINER_QID] ?? "").trim().toLowerCase().replace(/^opt-container-/, "").replace(/\s+container$/, "");
  if (!c || /^all\b/.test(c)) return { strategy, container: null };
  const slug = c.replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
  const known = ABAC_LAB.containers.find((name) => slug === name || slug.includes(name));
  return { strategy, container: known ?? slug };
}

/* ---------------------------------------------------------------- live facts */

let cached: { state: AbacLabState; at: number } | null = null;
const CACHE_MS = 15_000;

/** The lab state: live in Real-Tenant mode (15 s cache), the fixture otherwise or when the read fails. */
export async function getAbacLabState(options: { fresh?: boolean } = {}): Promise<AbacLabState> {
  if (!isLiveCloudMode()) return fixtureAbacLabState("Simulated-Lab mode");
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.state;
  try {
    const state = await readAbacLabLive(8000);
    cached = { state, at: Date.now() };
    return state;
  } catch (error) {
    return fixtureAbacLabState(error instanceof Error ? error.message.slice(0, 200) : String(error));
  }
}

export function invalidateAbacLabState(): void {
  cached = null;
}

/** The last state read (sync callers: the selection slice); the fixture until a read happened. */
export function peekAbacLabState(): AbacLabState {
  if (!isLiveCloudMode()) return fixtureAbacLabState("Simulated-Lab mode");
  return cached?.state ?? fixtureAbacLabState("not read yet");
}

/**
 * The trace the lens shows for a highlighted "ABAC" phrase: from the sender's denied write to the
 * identity, the storage account, the deny policy and where it is assigned.
 */
export function abacTraceRows(state: AbacLabState, ticket: { createdAt: string; requesterUpn?: string }): Array<Record<string, string>> {
  const src = state.source === "live" ? "live ARM" : "fixture";
  const rgName = ABAC_LAB.resourceGroup;
  return [
    ...abacActivity(state, ticket).map((e) => ({
      step: "Activity Log",
      object: e.code,
      detail: `${e.operation.split("/").slice(-2).join("/")} by ${e.caller} · ABAC RBAC condition required`,
      state: e.status,
      source: e.source === "live" ? "live Activity Log" : "ticket payload",
    })),
    { step: "Function App identity", object: state.identity.name, detail: state.identity.principalId ? `principalId ${state.identity.principalId}` : "not found", state: state.assignments.length ? `${state.assignments.length} blob role(s)` : "no blob access", source: src },
    { step: "Storage account", object: state.storage.name, detail: `${rgName} · ${state.storage.location || "westeurope"} · ${state.containers.filter((c) => c.exists).map((c) => c.name).join(", ")}`, state: state.storage.exists ? "exists" : "missing", source: src },
    { step: "Policy assignment", object: ABAC_LAB.policyName, detail: `Deny ${ABAC_LAB.roleName} without an ABAC condition · assigned at ${rgName}`, state: state.policy.exists ? state.policy.effect : "missing", source: src },
    { step: "Scope chain", object: "Tenant Root Group", detail: `${ABAC_LAB.managementGroup} → ${ABAC_LAB.subscriptionName} → ${rgName} → ${state.storage.name} (definition at ${state.policy.definitionScope.includes("managementGroups") ? "management group" : "subscription"})`, state: "inherited", source: src },
  ];
}

/** The denied write the ticket reports, plus any live RequestDisallowedByPolicy rows the Activity Log already holds. */
export function abacActivity(state: AbacLabState, ticket: { createdAt: string; requesterUpn?: string }): AbacActivityEvent[] {
  return [ticketActivityEvent({ timestamp: ticket.createdAt, caller: ticket.requesterUpn ?? ABAC_LAB.requesterUpn }), ...state.activity].slice(0, 6);
}

/** The compact fact sheet the gatekeeper, Wonder and the coder receive: names they must not invent. */
export function abacFacts(state: AbacLabState, ticket: { createdAt: string; requesterUpn?: string }, choice?: AbacChoice) {
  const container = choice?.container ?? "payroll-drop";
  return {
    source: state.source,
    readAt: state.readAt,
    ...(state.fallbackReason ? { fallbackReason: state.fallbackReason } : {}),
    tenant: ABAC_LAB.tenantDomain,
    subscription: `${state.subscription.name} (${state.subscription.id})`,
    scopeChain: [
      { level: "Tenant Root Group", id: `/providers/Microsoft.Management/managementGroups/${ABAC_LAB.tenantId}` },
      { level: "Management group", id: `/providers/Microsoft.Management/managementGroups/${ABAC_LAB.managementGroup}` },
      { level: "Subscription", id: `/subscriptions/${ABAC_LAB.subscriptionId}` },
      { level: "Resource group", id: `/subscriptions/${ABAC_LAB.subscriptionId}/resourceGroups/${ABAC_LAB.resourceGroup}` },
      { level: "Storage account", id: state.storage.id },
      { level: "Container", id: `${state.storage.id}/blobServices/default/containers/${container}` },
    ],
    policy: {
      name: ABAC_LAB.policyName,
      effect: state.policy.effect,
      definitionScope: state.policy.definitionScope,
      assignmentScope: state.policy.scope,
      rule: "Deny Microsoft.Authorization/roleAssignments where roleDefinitionId = Storage Blob Data Contributor and condition is missing or empty",
      exists: state.policy.exists,
    },
    storageAccount: { name: state.storage.name, location: state.storage.location, sku: state.storage.sku, exists: state.storage.exists },
    containers: state.containers,
    identity: { name: state.identity.name, kind: state.identity.kind, principalId: state.identity.principalId },
    currentAssignments: state.assignments.map((a) => ({ role: ABAC_LAB.roleName, condition: a.condition ? "conditioned" : "none", createdOn: a.createdOn })),
    activity: abacActivity(state, ticket),
    role: { name: ABAC_LAB.roleName, id: ABAC_LAB.roleDefinitionGuid },
    conditionVersion: "2.0",
    conditionExpression: abacExpression(container),
    condition: abacCondition(container),
  };
}

/** The gatekeeper's routing for an ABAC ticket: the canonical element and plan steps naming the real objects. */
export function abacRoutingDecision(): ElementRoutingDecision {
  return {
    matchedExistingElements: [],
    missingElements: [abacMissingElement()],
    extractedEntities: [],
    customBrief: {
      summary: `${ABAC_LAB.identityName} was denied ${ABAC_LAB.roleName} on ${ABAC_LAB.storageAccount}: ${ABAC_LAB.policyName} only allows that role with an ABAC condition.`,
      steps: [
        { title: "Trace the denied write", detail: `Activity Log: RequestDisallowedByPolicy on ${ABAC_LAB.storageAccount} for ${ABAC_LAB.identityName}`, category: "azure", actionLabel: "Inspect" },
        { title: "Choose how to satisfy the policy", detail: "Exemption, ABAC condition or a read-only role, and which container", category: "azure", actionLabel: "Steer" },
        { title: "Grant with the condition", detail: `New-AzRoleAssignment -Condition on ${ABAC_LAB.storageAccount}, verified in the sandbox`, category: "azure", actionLabel: "Stage Fix" },
      ],
    },
  };
}

/** Points a reused card's event stream at this ticket's denied write; every other block stays as synthesized. */
export function rebindAbacEvents(card: SynthesizedDynamicCard, activity: AbacActivityEvent[]): SynthesizedDynamicCard {
  if (!activity.length) return card;
  return {
    ...card,
    blocks: card.blocks.map((b) =>
      b.kind === "event-stream"
        ? { ...b, events: activity.map((e) => ({ id: e.id, timestamp: e.timestamp, operation: e.operation, status: e.status, code: e.code, caller: e.caller, detail: e.detail || e.resource })) }
        : b,
    ),
  };
}

/* ---------------------------------------------------------------- bundle */

const RG_SCOPE = `/subscriptions/${ABAC_LAB.subscriptionId}/resourceGroups/${ABAC_LAB.resourceGroup}`;

/** The coder must produce a script that carries these exact tokens for the chosen steering. */
export function abacScriptExpectations(choice: AbacChoice): string[] {
  if (choice.strategy === "exemption") return ["New-AzPolicyExemption", ABAC_LAB.policyName];
  const tokens = ["New-AzRoleAssignment", ABAC_LAB.storageAccount, ABAC_LAB.identityName];
  if (choice.container) tokens.push("-Condition", "-ConditionVersion", "StringEqualsIgnoreCase", choice.container);
  return tokens;
}

/**
 * The deterministic bundle for the chosen steering: what the coder falls back to, and what the
 * typed ARM executor applies for an approved condition (the same role, scope and condition).
 */
export function buildAbacRemediationSync(input: { scenarioId: string; clarifiedAnswers?: Record<string, string>; steering?: SteeringParams }): CustomRemediationTemplate {
  const choice = abacChoiceFromAnswers(input.clarifiedAnswers);
  const container = choice.container;
  const role = choice.strategy === "reader" ? "Storage Blob Data Reader" : ABAC_LAB.roleName;
  const steeringLine = `# Steering v${input.steering?.version ?? 0}: ${choice.strategy}${container ? ` · ${container}` : " · all containers"}`;
  const header = [
    "#Requires -Version 7.0",
    "[CmdletBinding(SupportsShouldProcess = $true)]",
    "param(",
    `  [string]$SubscriptionId = '${ABAC_LAB.subscriptionId}',`,
    `  [string]$ResourceGroupName = '${ABAC_LAB.resourceGroup}',`,
    `  [string]$StorageAccountName = '${ABAC_LAB.storageAccount}',`,
    `  [string]$IdentityName = '${ABAC_LAB.identityName}'${container ? "," : ""}`,
    ...(container ? [`  [string]$Container = '${container}'`] : []),
    ")",
    "$ErrorActionPreference = 'Stop'",
    steeringLine,
    "if ((Get-AzContext).Subscription.Id -ne $SubscriptionId) { throw \"Refusing: the active subscription is not $SubscriptionId\" }",
    "$scope = (Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName).Id",
    "$principalId = (Get-AzUserAssignedIdentity -ResourceGroupName $ResourceGroupName -Name $IdentityName).PrincipalId",
  ];
  const conditionLines = container
    ? [
        // The canonical (!(ActionMatches…) OR expression) form ARM stores and the portal editor renders.
        `$condition = "${abacCondition("CONTAINER").replace("'CONTAINER'", "'$Container'")}"`,
      ]
    : [];
  let body: string[];
  let title: string;
  let summary: string;
  if (choice.strategy === "exemption") {
    title = `Exempt ${ABAC_LAB.identityName} from ${ABAC_LAB.policyName}`;
    summary = `Waives ${ABAC_LAB.policyName} for the payroll storage account and grants ${ABAC_LAB.roleName} without a condition: what the ticket asks for, with no data-plane limit.`;
    body = [
      `$assignment = Get-AzPolicyAssignment -Name '${ABAC_LAB.policyName}' -Scope "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName"`,
      "if ($PSCmdlet.ShouldProcess($StorageAccountName, 'Waive the ABAC policy and grant Storage Blob Data Contributor')) {",
      `  New-AzPolicyExemption -Name 'exempt-${ABAC_LAB.identityName}' -PolicyAssignment $assignment -Scope $scope -ExemptionCategory Waiver -Description 'Requested in the ticket' | Out-Null`,
      `  New-AzRoleAssignment -ObjectId $principalId -ObjectType ServicePrincipal -RoleDefinitionName '${ABAC_LAB.roleName}' -Scope $scope | Out-Null`,
      "}",
    ];
  } else {
    title = container ? `Grant ${role} on ${container} with an ABAC condition` : `Grant ${role} on ${ABAC_LAB.storageAccount}`;
    summary = container
      ? `${role} for ${ABAC_LAB.identityName} on ${ABAC_LAB.storageAccount}, limited by an ABAC condition to the ${container} container (conditionVersion 2.0). Satisfies ${ABAC_LAB.policyName}.`
      : `${role} for ${ABAC_LAB.identityName} on every container of ${ABAC_LAB.storageAccount}, with no condition. ${ABAC_LAB.policyName} denies this.`;
    body = [
      ...conditionLines,
      `if ($PSCmdlet.ShouldProcess("$StorageAccountName${container ? "/$Container" : ""}", 'Grant ${role}${container ? " with an ABAC condition" : ""}')) {`,
      `  New-AzRoleAssignment -ObjectId $principalId -ObjectType ServicePrincipal -RoleDefinitionName '${role}' -Scope $scope${container ? " -Condition $condition -ConditionVersion '2.0'" : ""} -Description 'ContextPane ${input.scenarioId}' | Out-Null`,
      "}",
      `Get-AzRoleAssignment -Scope $scope -ObjectId $principalId | Select-Object RoleDefinitionName, Condition, ConditionVersion`,
    ];
  }
  const powershellScript = [...header, ...body, ""].join("\n");
  const tfCondition = container ? abacCondition(container) : "";
  const tfLines =
    choice.strategy === "exemption"
      ? [
          `resource "azurerm_resource_policy_exemption" "payroll_ingest" {`,
          `  name                 = "exempt-${ABAC_LAB.identityName}"`,
          `  resource_id          = "${RG_SCOPE}/providers/Microsoft.Storage/storageAccounts/${ABAC_LAB.storageAccount}"`,
          `  policy_assignment_id = "${RG_SCOPE}/providers/Microsoft.Authorization/policyAssignments/${ABAC_LAB.policyName}"`,
          `  exemption_category   = "Waiver"`,
          "}",
        ]
      : [
          `data "azurerm_user_assigned_identity" "payroll_ingest" {`,
          `  name                = "${ABAC_LAB.identityName}"`,
          `  resource_group_name = "${ABAC_LAB.resourceGroup}"`,
          "}",
          "",
          `resource "azurerm_role_assignment" "payroll_ingest_blob" {`,
          `  scope                = "${RG_SCOPE}/providers/Microsoft.Storage/storageAccounts/${ABAC_LAB.storageAccount}"`,
          `  role_definition_name = "${role}"`,
          "  principal_id         = data.azurerm_user_assigned_identity.payroll_ingest.principal_id",
          `  principal_type       = "ServicePrincipal"`,
          ...(container ? [`  condition_version    = "2.0"`, `  condition            = ${JSON.stringify(tfCondition)}`] : []),
          "}",
        ];
  const terraformDiff = ["--- a/demo-iac/payroll-abac.tf", "+++ b/demo-iac/payroll-abac.tf", `@@ -0,0 +1,${tfLines.length} @@`, ...tfLines.map((l) => `+${l}`)].join("\n");
  const rollbackScript = [
    "#Requires -Version 7.0",
    "[CmdletBinding(SupportsShouldProcess = $true)]",
    `param([string]$ResourceGroupName = '${ABAC_LAB.resourceGroup}', [string]$StorageAccountName = '${ABAC_LAB.storageAccount}', [string]$IdentityName = '${ABAC_LAB.identityName}')`,
    "$scope = (Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName).Id",
    "$principalId = (Get-AzUserAssignedIdentity -ResourceGroupName $ResourceGroupName -Name $IdentityName).PrincipalId",
    `Get-AzRoleAssignment -Scope $scope -ObjectId $principalId | Where-Object { $_.RoleDefinitionName -eq '${role}' } | ForEach-Object {`,
    "  if ($PSCmdlet.ShouldProcess($_.RoleAssignmentName, 'Remove the role assignment')) { Remove-AzRoleAssignment -InputObject $_ | Out-Null }",
    "}",
    "",
  ].join("\n");
  return {
    title: title.slice(0, 120),
    summary: summary.slice(0, 500),
    powershellScript,
    terraformDiff,
    graphPatch: JSON.stringify(
      {
        method: "PUT",
        path: `${RG_SCOPE}/providers/Microsoft.Storage/storageAccounts/${ABAC_LAB.storageAccount}/providers/Microsoft.Authorization/roleAssignments/{guid}?api-version=2022-04-01`,
        body: { properties: { roleDefinitionName: role, principalType: "ServicePrincipal", ...(container ? { condition: abacCondition(container), conditionVersion: "2.0" } : {}) } },
      },
      null,
      2,
    ),
    rollbackScript,
    affectedEntities: [
      { type: "resource", id: ABAC_LAB.storageAccount, change: container ? `${role} for ${ABAC_LAB.identityName}, condition: container = ${container}` : `${role} for ${ABAC_LAB.identityName}, no condition` },
      { type: "policy", id: ABAC_LAB.policyName, change: choice.strategy === "exemption" ? "waived for the storage account" : "satisfied by the condition" },
    ],
    requiredCommands: choice.strategy === "exemption" ? ["get-azpolicyassignment", "new-azpolicyexemption", "new-azroleassignment"] : ["get-azstorageaccount", "get-azuserassignedidentity", "new-azroleassignment"],
    riskNotes:
      choice.strategy === "exemption"
        ? ["A waiver removes the data-plane limit the policy exists to enforce.", "Every container in the account becomes writable for the app."]
        : container
          ? [`Writes outside ${container} stay denied at the data plane.`, "Other blob actions of the role pass through unconditioned."]
          : [`${ABAC_LAB.policyName} denies an unconditioned assignment.`],
    executionSteps: [
      `[Step 1/3] Confirm subscription ${ABAC_LAB.subscriptionName} and resolve ${ABAC_LAB.identityName}`,
      choice.strategy === "exemption"
        ? `[Step 2/3] New-AzPolicyExemption on ${ABAC_LAB.storageAccount}, then New-AzRoleAssignment`
        : `[Step 2/3] New-AzRoleAssignment ${role}${container ? ` -Condition (container = ${container}) -ConditionVersion 2.0` : ""}`,
      "[Step 3/3] Read the role assignment back",
    ],
  };
}
