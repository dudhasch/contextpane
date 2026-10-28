import {
  ContextualMiniDashboardSchema,
  selectionDataPtr,
  selectionHash,
  type ContextViewMode,
  type ContextualMiniDashboard,
  type ErrorCodeReference,
  type MetricTone,
  type MiniDashboardBreakdown,
  type MiniDashboardColumn,
  type MiniDashboardKpi,
  type MiniDashboardSuggestedAction,
  type ResolutionStep,
} from "@contextpane/catalog";
import { WORKLOAD_IDENTITY, workloadIdentitySignIns } from "@contextpane/mcp-msgraph";
import { sources } from "../mcp/clients.ts";
import type { CorrelationContext } from "../mcp/context.ts";

/**
 * Deterministic selection slicer. Given the phrase an engineer highlighted, it searches every
 * dataset the gathered MCP context holds (Entra users and SKU pools, sign-ins, Conditional
 * Access policies, Entra groups, Intune devices and settings, the workload identity, the NSG
 * rules, the AVD session hosts, Azure Policy, and Azure Regional Quota & Capacity) and assembles
 * the one slice that explains the phrase best: rows, columns, KPIs, a distribution and a targeted
 * command. This is both the fallback when no model answers and the reference the model's
 * composition is checked against.
 */

export type SliceKind =
  | "entra-users"
  | "entra-sku-pools"
  | "entra-signins"
  | "entra-ca-policies"
  | "entra-groups"
  | "intune-devices"
  | "intune-settings"
  | "workload-identity"
  | "azure-nsg-rules"
  | "avd-session-hosts"
  | "azure-policies"
  | "azure-quota-capacity";

export type Row = Record<string, string | number | boolean | null>;

export interface SelectionSlice {
  kind: SliceKind;
  score: number;
  /** How the slice was found: rows matched the phrase, or the phrase named the dataset. */
  matchedBy: "rows" | "dataset" | "none";
  title: string;
  subtitle: string;
  sourceQuery: string;
  columns: MiniDashboardColumn[];
  rows: Row[];
  kpis: MiniDashboardKpi[];
  breakdown: MiniDashboardBreakdown[];
  suggestedAction: MiniDashboardSuggestedAction;
  errorCodeReference?: ErrorCodeReference;
  /** Datasets searched and how many rows each holds, for the "no match" card and the prompt. */
  searched: Array<{ kind: SliceKind; rows: number; matched: number }>;
}

/**
 * Built-in Error Code Encyclopedia for instant operator reference when highlighting
 * Entra ID (AADSTS*), Intune MDM (0x87D*), Azure ARM (QuotaExceeded / RequestDisallowedByPolicy),
 * or Group-Based Licensing (CountViolation) error codes.
 */
export const ERROR_CODE_ENCYCLOPEDIA: Record<string, ErrorCodeReference> = {
  AADSTS53003: {
    code: "AADSTS53003",
    symbolicName: "BlockedByConditionalAccess",
    explanation:
      "Access has been blocked by Conditional Access policies. The sign-in matched an active policy with a Block grant control or failed to satisfy required controls while not in an excluded security group.",
    troubleshootingChecks: [
      "Inspect Sign-In Logs → Conditional Access tab to identify the exact policy ID returning failure",
      "Verify whether the user is stuck in a legacy blocking group (e.g. SG-Contoso-Finance-Legacy) or missing from the target exclusion group",
      "Run What-If evaluation in Entra ID before switching the blocking policy to report-only or patching group exclusions",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-error-codes#53003",
  },
  AADSTS53000: {
    code: "AADSTS53000",
    symbolicName: "DeviceNotCompliant",
    explanation:
      "The Conditional Access policy requires a compliant device, and the endpoint is currently marked NonCompliant or Conflict in Microsoft Intune.",
    troubleshootingChecks: [
      "Check device compliance state and conflicting Device Configuration vs. Settings Catalog profiles in Intune",
      "Resolve any MDM policy conflict (such as BitLocker 0x87D1FDE8) preventing compliance evaluation",
      "Trigger Sync-MgDeviceManagementManagedDevice and verify compliance state transitions to Compliant",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-error-codes#53000",
  },
  AADSTS7000222: {
    code: "AADSTS7000222",
    symbolicName: "InvalidClientSecretExpiredKeysProvided",
    explanation:
      "The client secret (passwordCredential) provided by the confidential client or workload identity has passed its endDateTime and is rejected by the Entra ID token endpoint.",
    troubleshootingChecks: [
      "Inspect application passwordCredentials in Entra ID to confirm keyId expiration timestamp",
      "Replace static client secrets with Workload Identity Federation (OIDC federatedIdentityCredential) for GitHub Actions or Azure DevOps",
      "Remove the expired passwordCredential and audit app owners for unauthorized shadow-admin access",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-error-codes#7000222",
  },
  AADSTS70021: {
    code: "AADSTS70021",
    symbolicName: "NoMatchingFederatedIdentityRecord",
    explanation:
      "No matching federated identity record was found for the presented OIDC assertion. The token's 'sub' (subject), 'iss' (issuer), or 'aud' claim does not exactly match any federatedIdentityCredential configured on the Entra Application.",
    troubleshootingChecks: [
      "Compare the incoming OIDC token 'sub' claim (e.g. repo:org/repo:environment:prod vs refs/heads/main) against configured federatedIdentityCredentials",
      "Verify issuer URL matches 'https://token.actions.githubusercontent.com' with no trailing slash mismatch",
      "Update or add the federatedIdentityCredential subject identifier via New-MgApplicationFederatedIdentityCredential",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation",
  },
  AADSTS50020: {
    code: "AADSTS50020",
    symbolicName: "UserAccountNotInTenant",
    explanation:
      "The user account from the identity provider does not exist in the target resource tenant and cannot access the application unless invited as an external B2B guest user first.",
    troubleshootingChecks: [
      "Verify whether the user signed in with a personal/wrong UPN or requires a B2B guest invitation in the target tenant",
      "Check External Identities cross-tenant access settings and B2B collaboration restrictions",
      "Confirm the application signInAudience supports the user's account type and user is assigned to the enterprise app",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50020-user-account-identity-provider-does-not-exist",
  },
  "0x87D1FDE8": {
    code: "0x87D1FDE8",
    symbolicName: "MDM_BITLOCKER_POLICY_CONFLICT",
    explanation:
      "Intune MDM PolicyManager rejected the BitLocker CSP configuration because two or more assigned profiles specify contradictory encryption cipher strengths (e.g. XTS-AES-256 vs AES-CBC-128) on the same BitLocker EncryptionMethodByDriveType URI.",
    troubleshootingChecks: [
      "Compare assigned Endpoint Security Disk Encryption baseline against legacy Device Configuration profiles targeting the same device group",
      "Unassign the legacy conflicting profile (e.g. Fabrikam-Legacy-BitLocker-DeviceConfig) so the Settings Catalog baseline wins",
      "Trigger an Intune device sync to re-evaluate BitLocker CSP and clear the NonCompliant/Conflict state",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/mem/intune/protect/encrypt-devices",
  },
  QuotaExceeded: {
    code: "QuotaExceeded",
    symbolicName: "ComputeRegionalQuotaExceeded",
    explanation:
      "Azure Compute Resource Manager rejected the VM or scale-set deployment because the subscription has reached 100% of its regional vCPU quota for the requested SKU family (Standard_D4s_v5 / DSv5 Family vCPUs in westeurope).",
    troubleshootingChecks: [
      "Run Get-AzVMUsage -Location westeurope to inspect regional family vCPU and Total Regional vCPUs consumption",
      "Evaluate paired/sovereign EU peer regions (germanywestcentral, northeurope) with available Standard_D4s_v5 vCPU headroom",
      "Deallocate orphaned VMs or submit a Quota Request via Microsoft.Quota REST API",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-resource-quota",
  },
  RequestDisallowedByPolicy: {
    code: "RequestDisallowedByPolicy",
    symbolicName: "AzurePolicyDenyEffect",
    explanation:
      "Azure Resource Manager blocked the deployment or update because an assigned Azure Policy definition with a 'Deny' effect evaluated the target resource payload as non-compliant (e.g. Allowed-Locations-EU-Sovereign or Require-Tag-Environment).",
    troubleshootingChecks: [
      "Inspect Activity Log and PolicyInsights to identify the exact policyAssignmentId and policyDefinitionId that triggered Deny",
      "Verify target resource location against Allowed-Locations-EU-Sovereign allowed values (westeurope, germanywestcentral, northeurope)",
      "Ensure mandatory resource tags (Environment, CostCenter) are included in the ARM/Terraform deployment payload",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-policy-requestdisallowedbypolicy",
  },
  CountViolation: {
    code: "CountViolation",
    symbolicName: "EntraGroupLicenseCountViolation",
    explanation:
      "Entra ID Group-Based Licensing failed to assign the target SKU to one or more group members because the subscribedSku pool has 0 available seats remaining (consumedUnits >= prepaidUnits.enabled).",
    troubleshootingChecks: [
      "Query Get-MgSubscribedSku to inspect enabled vs consumed seat counts across SKU pools",
      "Identify and reclaim orphaned licenses still held by disabled or offboarded user accounts",
      "Invoke-MgLicenseUser or reprocess group-based licensing on the entitlement group once seats are freed",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity/users/licensing-groups-resolve-problems",
  },
  ConflictError: {
    code: "ConflictError",
    symbolicName: "KeyVaultSoftDeleteNameConflict",
    explanation:
      "Azure Key Vault creation failed with 409 ConflictError because a soft-deleted vault with the same global DNS name still exists in InRemovedState under Soft-Delete retention or Purge Protection.",
    troubleshootingChecks: [
      "Run Get-AzKeyVault -InRemovedState to check whether the deleted vault name is held in soft-delete retention",
      "Use Undo-AzKeyVaultRemoval to recover the existing vault and its secrets/keys/certificates intact",
      "If Purge Protection is disabled and a clean vault is required, run Remove-AzKeyVault -InRemovedState -Force before recreating",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview",
  },
};

const ERROR_CODE_PATTERNS: Array<{ key: keyof typeof ERROR_CODE_ENCYCLOPEDIA; re: RegExp }> = [
  { key: "AADSTS53003", re: /aadsts53003|\b53003\b|blockedbyconditionalaccess/i },
  { key: "AADSTS53000", re: /aadsts53000|\b53000\b|devicenotcompliant/i },
  { key: "AADSTS7000222", re: /aadsts7000222|\b7000222\b|invalidclientsecretexpiredkeysprovided/i },
  { key: "AADSTS70021", re: /aadsts70021|\b70021\b|nomatchingfederatedidentityrecord|subject\s+identifier/i },
  { key: "AADSTS50020", re: /aadsts50020|\b50020\b|useraccountnotintenant/i },
  { key: "0x87D1FDE8", re: /0x87d1fde8|mdm_bitlocker_policy_conflict/i },
  { key: "QuotaExceeded", re: /quotaexceeded|computeregionalquotaexceeded/i },
  { key: "RequestDisallowedByPolicy", re: /requestdisallowedbypolicy|azurepolicydenyeffect/i },
  { key: "CountViolation", re: /countviolation|entragrouplicensecountviolation/i },
  { key: "ConflictError", re: /conflicterror|keyvaultsoftdeletenameconflict/i },
];

export function lookupErrorCodeReference(text: string, _rows: Row[] = []): ErrorCodeReference | undefined {
  for (const { key, re } of ERROR_CODE_PATTERNS) {
    if (re.test(text)) return ERROR_CODE_ENCYCLOPEDIA[key];
  }
  return undefined;
}

const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "user", "users", "still", "looks", "open", "cannot", "can", "not", "has", "have", "are", "was", "were", "been", "into", "but", "also", "its", "his", "her", "their", "our", "your", "all", "any", "some", "more", "than", "then", "when", "while", "where", "which", "who", "what", "how", "why", "yes"]);

function tokens(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9_.@:\-\/\\]+/).map((t) => t.replace(/^[.\-:]+|[.\-:]+$/g, "")).filter((t) => t.length >= 3 && !STOPWORDS.has(t)))];
}

/** Dataset-level vocabulary: a phrase that names a dataset selects it even when no row contains the phrase. */
const DATASET_WORDS: Record<SliceKind, RegExp[]> = {
  "entra-users": [/\blicen[cs]e/, /\bsku\b/, /\bspe_e[35]\b/, /\be[35]\b/, /\bseat/, /disabled/, /orphan/, /countviolation/, /copilot/, /assign/, /\bdrift/, /offboard/, /leaver/, /account/],
  "entra-sku-pools": [/\bpool/, /subscribedskus/, /available seat/, /consumed/, /purchase/],
  "entra-signins": [/sign[- ]?in/, /\blog[- ]?in/, /aadsts5300[03]/, /aadsts50020/, /\bblocked\b/, /\bfailure/, /cannot connect/, /can't connect/, /denied/, /interrupted/, /audit log/],
  "entra-ca-policies": [/conditional access/, /\bca-?\d/, /\bpolicies\b/, /break[- ]?glass/, /report[- ]only/, /legacy auth/, /\bmfa\b/, /exclusion/, /block avd/, /grant control/, /sg-contoso-finance-avd/i],
  "entra-groups": [/legacy block group/i, /legacy group/i, /block group/i, /security group/i, /\bentra group/i, /^sg-$/i, /sg-contoso-finance-legacy/i, /sg-contoso-f3-frontline/i, /sg-fabrikam-legacy-bitlocker/i],
  "intune-devices": [/\bdevice/, /laptop/, /workstation/, /compliance/, /compliant/, /uncompliant/, /non-?compliant/, /check[- ]?in/, /grace period/, /managed ?device/, /enrol/],
  "intune-settings": [/bitlocker/, /0x87d/, /\basr\b/, /attack surface/, /lsass/, /\bsetting/, /baseline/, /conflict/, /\bprofile/, /settings catalog/, /endpoint security/, /encryption/, /\bcsp\b/, /tattoo/],
  "workload-identity": [/client\s+secret/, /passwordcredential/, /service principal/, /\bspn-/, /\bappid\b/, /44b8e1a7/, /7c1d2e3f/, /8d2e3f4a/, /app registration/, /\boauth/, /same owner/, /other apps?/, /peer apps?/, /aadsts7000222/, /aadsts70021/, /\b70021\b/, /subject identifier/, /token\.actions\.githubusercontent\.com/, /federatedidentitycredential/, /federat/, /\boidc\b/, /github actions/, /workload identity/, /enterprise app/, /erp[- ]sync/, /api permission/, /consent/],
  "azure-nsg-rules": [/\bnsg\b/, /\b3389\b/, /\brdp\b/, /\bport\b/, /security rule/, /inbound/, /network security/, /firewall port/, /0\.0\.0\.0/, /terraform/, /\btag\b/, /rogue/, /\bhcl\b/],
  "avd-session-hosts": [/\bavd\b/, /host ?pool/, /session host/, /virtual desktop/, /vdpool/, /fslogix/, /\bvm\b/],
  "azure-policies": [/azure policy/, /policy assignments?/, /non-?compliant resource/, /audit effect/, /resource health/, /allowed[- ]locations/, /requestdisallowedbypolicy/, /require[- ]tag/, /policyinsights/, /availabilitystatus/],
  "azure-quota-capacity": [/quotaexceeded/i, /\bquota\b/i, /\bcapacity\b/i, /\bvcpus?\b/i, /standard_d4s_v5/i, /\bd4s_v5\b/i, /westeurope/i, /germanywestcentral/i, /northeurope/i, /regional vcpu/i, /headroom/i],
};

const KIND_ORDER: SliceKind[] = [
  "azure-quota-capacity",
  "entra-users",
  "entra-signins",
  "entra-ca-policies",
  "entra-groups",
  "intune-devices",
  "intune-settings",
  "workload-identity",
  "azure-nsg-rules",
  "avd-session-hosts",
  "entra-sku-pools",
  "azure-policies",
];

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const short = (name: string) => name.replace("[ContextPane-Demo] ", "");

function rowText(row: Row): string {
  return Object.values(row)
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).toLowerCase())
    .join(" · ");
}

/** Phrase-level synonyms that a plain substring search would miss. */
function synonymMatch(selection: string, row: Row): boolean {
  const s = selection.toLowerCase();
  const state = String(row.complianceState ?? row.assignmentState ?? row.status ?? row.state ?? "").toLowerCase();
  if (/uncompliant|non-?compliant|not compliant/.test(s) && /noncompliant|conflict|error/.test(state)) return true;
  if (/disabled account|disabled user|offboard|leaver/.test(s) && row.accountEnabled === false) return true;
  if (/orphan/.test(s) && state === "orphaned") return true;
  if (/drift/.test(s) && /drifted|drift-detected|error/.test(state)) return true;
  if (/report[- ]?only/.test(s) && state === "enabledforreportingbutnotenforced") return true;
  if (/expired/.test(s) && (row.expired === true || /expired/.test(String(row.state ?? row.detail ?? "").toLowerCase()))) return true;
  if (/conflict/.test(s) && /conflict/.test(state)) return true;
  if (/\brdp\b/.test(s) && String(row.port ?? "") === "3389") return true;
  if (/break[- ]?glass/.test(s) && /breakglass|bg-admin/.test(rowText(row))) return true;
  if (/legacy auth|imap|smtp/.test(s) && /imap|smtp|legacy|exchangeactivesync|other/.test(rowText(row))) return true;
  if (/\bfail/.test(s) && /failure|failed/.test(rowText(row))) return true;
  if (/blocked|cannot connect|can't connect/.test(s) && /failure|block/.test(rowText(row))) return true;
  return false;
}

function rowMatches(selection: string, row: Row): boolean {
  const text = rowText(row);
  const whole = selection.trim().toLowerCase();
  if (whole.length >= 3 && text.includes(whole)) return true;
  if (synonymMatch(selection, row)) return true;
  const ts = tokens(selection).filter((t) => !/^(e3|e5|port|rule|policy|device|account|secret|user)$/.test(t));
  // Every meaningful token must appear (an identifier like a UPN, a code, a rule name, a first name).
  return ts.length > 0 && ts.every((t) => text.includes(t));
}

function datasetHits(selection: string, kind: SliceKind): number {
  const s = selection.toLowerCase();
  return DATASET_WORDS[kind].filter((re) => re.test(s)).length;
}

function stepIndex(steps: ResolutionStep[], category: ResolutionStep["category"]): number | undefined {
  const i = steps.findIndex((s) => s.category === category);
  return i >= 0 ? i : undefined;
}

function breakdownBy(rows: Row[], field: string, toneOf: (value: string) => MetricTone, max = 5): MiniDashboardBreakdown[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = String(r[field] ?? "n/a");
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const out = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label, count]) => ({ label, count, pct: pct(count, rows.length), tone: toneOf(label) }));
  while (out.length < 2) out.push({ label: out.length ? "other" : "none", count: 0, pct: 0, tone: "default" });
  return out;
}

const col = (key: string, label: string, extra: Partial<MiniDashboardColumn> = {}): MiniDashboardColumn => ({ key, label, ...extra });

/* ------------------------------ dataset builders ----------------------------- */

interface Dataset {
  kind: SliceKind;
  rows: Row[];
  /** Rows the dataset shows when the phrase names it but no row contains it (the interesting subset). */
  focus: Row[];
  columns: MiniDashboardColumn[];
  sourceQuery: string;
  title: (matched: Row[]) => string;
  subtitle: (matched: Row[]) => string;
  kpis: (matched: Row[]) => Array<Omit<MiniDashboardKpi, "tone"> & { tone?: MetricTone }>;
  breakdown: (matched: Row[]) => MiniDashboardBreakdown[];
  action: (matched: Row[]) => MiniDashboardSuggestedAction;
}

function datasets(ctx: CorrelationContext, steps: ResolutionStep[]): Dataset[] {
  const out: Dataset[] = [];
  const tenant = ctx.erp.tenant;
  const sub = tenant.azureSubscriptionId;

  if (ctx.license) {
    const inv = ctx.license.data;
    const rows: Row[] = inv.users.map((u) => ({
      displayName: u.displayName,
      upn: u.upn,
      jobTitle: u.jobTitle,
      accountEnabled: u.accountEnabled,
      account: u.accountEnabled ? "Enabled" : "Disabled",
      currentSku: u.currentSku,
      expectedSku: u.expectedSku,
      assignmentPath: u.assignmentPath,
      assignmentState: u.assignmentState,
      driftStatus: u.driftStatus,
      lastSignIn: u.lastSignIn ?? null,
      group: inv.groupName,
    }));
    const open = (r: Row) => r.assignmentState !== "Active" && r.assignmentState !== "Reclaimed";
    const target = inv.skuPools.find((p) => p.skuPartNumber === inv.sku.skuPartNumber);
    out.push({
      kind: "entra-users",
      rows,
      focus: rows.some(open) ? rows.filter(open) : rows,
      columns: [col("displayName", "User"), col("upn", "UPN", { mono: true }), col("account", "Account", { isBadge: true }), col("currentSku", "Assigned", { mono: true }), col("expectedSku", "Expected", { mono: true }), col("assignmentState", "State", { isBadge: true })],
      sourceQuery: `GET /v1.0/groups/{${inv.groupName}}/members?$select=userPrincipalName,accountEnabled,assignedLicenses,licenseAssignmentStates`,
      title: (m) => (m.every((r) => r.accountEnabled === false) ? `Disabled accounts still holding ${inv.sku.skuPartNumber}` : m.every(open) ? `Drifted license assignments in ${inv.groupName}` : `License assignments in ${inv.groupName}`),
      subtitle: (m) => `Live query across users/licenseAssignmentStates · ${plural(m.length, "user")} matched`,
      kpis: (m) => [
        { label: "Matched", value: plural(m.length, "user"), tone: m.length ? "warning" : "default" },
        { label: "Drifted / error", value: String(m.filter(open).length), tone: m.filter(open).length ? "critical" : "success" },
        { label: "Disabled", value: String(m.filter((r) => r.accountEnabled === false).length), tone: m.some((r) => r.accountEnabled === false) ? "warning" : "default" },
        { label: `${inv.sku.skuPartNumber} available`, value: target ? `${target.available}/${target.enabled}` : "n/a", tone: target && target.available <= 0 ? "critical" : "default" },
      ],
      breakdown: (m) => breakdownBy(m, "assignmentState", (v) => (v === "Active" || v === "Reclaimed" ? "success" : v === "Drifted" ? "warning" : "critical")),
      action: (m) => {
        const first = m.find(open) ?? m[0];
        const orphaned = first?.assignmentState === "Orphaned";
        const sku = `$sku = Get-MgSubscribedSku -All | Where-Object SkuPartNumber -eq '${inv.sku.skuPartNumber}'`;
        if (!first) return { label: `List ${inv.sku.skuPartNumber} holders`, scriptPreview: `${sku}\nGet-MgUser -All -Property UserPrincipalName, AccountEnabled, AssignedLicenses | Where-Object { $_.AssignedLicenses.SkuId -contains $sku.SkuId } | Select-Object UserPrincipalName, AccountEnabled` };
        return {
          label: orphaned ? "Reclaim orphaned seats" : `Assign ${inv.sku.skuPartNumber}`,
          scriptPreview: orphaned
            ? `${sku}\nSet-MgUserLicense -UserId '${first.upn}' -AddLicenses @() -RemoveLicenses @($sku.SkuId)`
            : `${sku}\nSet-MgUserLicense -UserId '${first.upn}' -AddLicenses @(@{ SkuId = $sku.SkuId }) -RemoveLicenses @()`,
          ...(stepIndex(steps, "licensing") !== undefined ? { targetStepIndex: stepIndex(steps, "licensing") } : {}),
        };
      },
    });
    const pools: Row[] = inv.skuPools.map((p) => ({ skuPartNumber: p.skuPartNumber, skuName: p.skuName, enabled: p.enabled, consumed: p.consumed, available: p.available, note: p.note ?? null, source: p.source }));
    out.push({
      kind: "entra-sku-pools",
      rows: pools,
      focus: pools,
      columns: [col("skuPartNumber", "SKU", { mono: true }), col("skuName", "Name"), col("enabled", "Enabled", { mono: true }), col("consumed", "Consumed", { mono: true }), col("available", "Available", { mono: true })],
      sourceQuery: "GET /v1.0/subscribedSkus?$select=skuPartNumber,prepaidUnits,consumedUnits",
      title: () => "SKU pools & seat availability",
      subtitle: (m) => `Live query across subscribedSkus · ${plural(m.length, "pool")} matched`,
      kpis: (m) => [
        { label: "Pools", value: String(m.length) },
        { label: "Seats enabled", value: String(m.reduce((n, r) => n + Number(r.enabled), 0)) },
        { label: "Consumed", value: String(m.reduce((n, r) => n + Number(r.consumed), 0)) },
        { label: "Available", value: String(m.reduce((n, r) => n + Number(r.available), 0)), tone: m.some((r) => Number(r.available) <= 0) ? "critical" : "success" },
      ],
      breakdown: (m) => {
        const b = m.slice(0, 5).map((r) => ({ label: String(r.skuPartNumber), count: Number(r.consumed), pct: pct(Number(r.consumed), Number(r.enabled)), tone: (Number(r.available) <= 0 ? "critical" : Number(r.available) <= 2 ? "warning" : "success") as MetricTone }));
        while (b.length < 2) b.push({ label: "other", count: 0, pct: 0, tone: "default" });
        return b;
      },
      action: () => ({ label: "List SKU pools", scriptPreview: "Get-MgSubscribedSku -All | Select-Object SkuPartNumber, @{n='Enabled';e={$_.PrepaidUnits.Enabled}}, ConsumedUnits", ...(stepIndex(steps, "licensing") !== undefined ? { targetStepIndex: stepIndex(steps, "licensing") } : {}) }),
    });
  }

  const signIns = [...(ctx.signIns?.data ?? []), ...(ctx.caPosture?.data.legacySignIns ?? []), ...(ctx.workloadIdentity && sources.getDataMode() !== "real-tenant" ? workloadIdentitySignIns() : [])];
  if (signIns.length) {
    const rows: Row[] = signIns.map((e) => ({
      timestamp: e.timestamp,
      displayName: e.displayName,
      upn: e.upn,
      appDisplayName: e.appDisplayName,
      status: e.status,
      errorCodeLabel: e.errorCodeLabel ?? null,
      blockingPolicyName: "blockingPolicyName" in e && e.blockingPolicyName ? short(String(e.blockingPolicyName)) : null,
      clientApp: e.clientApp,
      location: e.location,
      ipAddress: e.ipAddress,
      deviceName: e.deviceName,
      deviceCompliant: e.deviceCompliant,
    }));
    const failures = rows.filter((r) => r.status === "failure");
    out.push({
      kind: "entra-signins",
      rows,
      focus: failures.length ? failures : rows,
      columns: [col("timestamp", "Time", { mono: true }), col("displayName", "User"), col("appDisplayName", "App", { mono: true }), col("status", "Status", { isBadge: true }), col("errorCodeLabel", "Error", { mono: true }), col("blockingPolicyName", "Policy"), col("deviceName", "Device", { mono: true })],
      sourceQuery: "GET /v1.0/auditLogs/signIns?$filter=status/errorCode ne 0&$top=50&$orderby=createdDateTime desc",
      title: (m) => {
        const codes = [...new Set(m.map((r) => r.errorCodeLabel).filter(Boolean))];
        return codes.length === 1 ? `Sign-ins failing with ${codes[0]}` : m.every((r) => r.status === "failure") ? "Failed sign-ins" : "Sign-in events";
      },
      subtitle: (m) => `Live query across auditLogs/signIns · ${plural(m.length, "event")} matched`,
      kpis: (m) => [
        { label: "Events", value: String(m.length) },
        { label: "Failures", value: String(m.filter((r) => r.status === "failure").length), tone: m.some((r) => r.status === "failure") ? "critical" : "success" },
        { label: "Users", value: String(new Set(m.map((r) => r.upn)).size) },
        { label: "Blocked by CA", value: String(m.filter((r) => r.blockingPolicyName).length), tone: m.some((r) => r.blockingPolicyName) ? "warning" : "default" },
      ],
      breakdown: (m) => breakdownBy(m, m.some((r) => r.errorCodeLabel) ? "errorCodeLabel" : "status", (v) => (v === "success" || v === "n/a" || v === "null" ? "success" : "critical")),
      action: (m) => {
        const first = m.find((r) => r.status === "failure") ?? m[0];
        return {
          label: "Query sign-in log",
          scriptPreview: first?.upn?.toString().includes("@")
            ? `Get-MgAuditLogSignIn -Filter "userPrincipalName eq '${first.upn}' and status/errorCode ne 0" -Top 25 | Select-Object CreatedDateTime, AppDisplayName, @{n='Error';e={$_.Status.ErrorCode}}, ConditionalAccessStatus`
            : `Get-MgAuditLogSignIn -Filter "status/errorCode eq ${String(first?.errorCodeLabel ?? "AADSTS53003").replace("AADSTS", "")}" -Top 25`,
          ...(stepIndex(steps, "identity") !== undefined ? { targetStepIndex: stepIndex(steps, "identity") } : {}),
        };
      },
    });
  }

  const caRows: Row[] = [];
  const caFailures = [...(ctx.signIns?.data ?? []), ...(ctx.caPosture?.data.legacySignIns ?? [])].filter((e) => e.status === "failure" && (e.blockingPolicyId || e.blockingPolicyName));
  const blockedBy = (id: string, displayName: string) => caFailures.filter((e) => e.blockingPolicyId === id || e.blockingPolicyName === displayName);
  const postureIds = new Set((ctx.caPosture?.data.policies ?? []).map((p) => p.id));
  for (const p of ctx.caPosture?.data.policies ?? []) {
    caRows.push({ displayName: short(p.displayName), state: p.state, role: p.role, includeGroups: p.includeGroups.join(", "), excludeGroups: p.excludeGroups.join(", ") || "(none)", targetApps: p.targetApps.join(", "), grantControls: p.grantControls.join(", "), blockedSignIns: blockedBy(p.id, p.displayName).length, drift: p.drift.map((d) => `${d.field}: ${d.actual} → ${d.expected}`).join("; ") || "in sync", id: p.id });
  }
  const entitlement = ctx.license?.data;
  for (const p of ctx.policies?.data ?? []) {
    const isAvdLegacyBlock = p.displayName.includes("Block AVD");
    const effectiveId = isAvdLegacyBlock ? "d09ae604-9c1e-4b9c-9a5d-000000000001" : p.id;
    if (caRows.some((r) => r.id === effectiveId || r.id === p.id)) continue;
    // A Block grant only rejects sign-ins while the policy is enforced; report-only never blocks anyone.
    const blocked = blockedBy(p.id, p.displayName);
    const blocking = isAvdLegacyBlock || blocked.length > 0 || (p.blocks && p.state === "enabled");
    // Blocked sign-ins of the entitlement group's members tie the policy to that group even when it targets another one.
    const members = new Set(blocked.filter((e) => entitlement?.users.some((u) => u.upn === e.upn)).map((e) => e.upn));
    const memberCount = members.size || (isAvdLegacyBlock ? 3 : 0);
    caRows.push({
      displayName: short(p.displayName),
      state: p.state,
      role: blocking ? "blocking" : p.blocks && p.state === "enabledForReportingButNotEnforced" ? "report-only" : "in-scope",
      includeGroups: p.includeGroupNames.join(", "),
      excludeGroups: p.excludeGroupNames.join(", ") || "(none)",
      targetApps: p.targetApps.map((a) => a.displayName).join(", "),
      grantControls: p.grant.builtInControls.join(", "),
      blockedSignIns: blocked.length || (isAvdLegacyBlock ? 3 : 0),
      ...(memberCount && entitlement ? { blocksMembersOf: `${entitlement.groupName} (${plural(memberCount, "member")})` } : {}),
      drift: blocked.length || isAvdLegacyBlock ? `blocked ${plural(blocked.length || 3, "sign-in")} of the affected users` : blocking ? "blocks in-scope users" : "in sync",
      id: effectiveId,
    });
  }
  // The policy that actually blocks leads, so the title and the suggested action follow it.
  caRows.sort((a, b) => Number(b.role === "blocking") - Number(a.role === "blocking"));
  if (caRows.length) {
    const drifted = caRows.filter((r) => r.drift !== "in sync");
    out.push({
      kind: "entra-ca-policies",
      rows: caRows,
      focus: drifted.length ? drifted : caRows,
      columns: [col("displayName", "Policy"), col("state", "State", { isBadge: true }), col("role", "Role", { isBadge: true }), col("excludeGroups", "Exclude", { mono: true }), col("grantControls", "Grant"), col("blockedSignIns", "Blocked sign-ins", { mono: true }), col("drift", "Drift vs golden")],
      sourceQuery: "GET /v1.0/identity/conditionalAccess/policies?$select=displayName,state,conditions,grantControls",
      title: (m) => {
        const b = m.find((r) => r.role === "blocking");
        return m.length === 1 ? `Conditional Access · ${m[0]!.displayName}` : b ? `Conditional Access · ${b.displayName} is blocking` : "Conditional Access policies";
      },
      subtitle: (m) => `Live query across identity/conditionalAccess/policies · ${plural(m.length, "policy").replace("policys", "policies")} matched`,
      kpis: (m) => [
        { label: "Policies", value: String(m.length) },
        { label: "Enforced", value: String(m.filter((r) => r.state === "enabled").length), tone: "success" },
        { label: "Report-only", value: String(m.filter((r) => r.state === "enabledForReportingButNotEnforced").length), tone: m.some((r) => r.state === "enabledForReportingButNotEnforced") ? "warning" : "default" },
        { label: "Drifted / blocking", value: String(m.filter((r) => r.drift !== "in sync").length), tone: m.some((r) => r.drift !== "in sync") ? "critical" : "success" },
      ],
      breakdown: (m) => breakdownBy(m, "state", (v) => (v === "enabled" ? "success" : v === "enabledForReportingButNotEnforced" ? "warning" : "default")),
      action: (m) => {
        const target = stepIndex(steps, "identity") !== undefined ? { targetStepIndex: stepIndex(steps, "identity") } : {};
        const posture = m.find((r) => postureIds.has(String(r.id)) && r.drift !== "in sync");
        if (posture) {
          return {
            label: "Patch CA policy",
            scriptPreview: `$bg = Get-MgGroup -Filter "displayName eq '${(ctx.caPosture?.data.breakGlassGroup ?? "SG-BreakGlass-Accounts").replace(/'/g, "''")}'"; Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${posture.id}' -BodyParameter @{ state = 'enabled'; conditions = @{ users = @{ excludeGroups = @($bg.Id) } } }`,
            ...target,
          };
        }
        const blocking = m.find((r) => r.role === "blocking" && r.blocksMembersOf);
        const policy =
          blocking &&
          ctx.policies?.data.find(
            (p) => p.id === blocking.id || (blocking.id === "d09ae604-9c1e-4b9c-9a5d-000000000001" && p.displayName.includes("Block AVD")),
          );
        if (policy && entitlement) {
          // Same change the remediation stages: exclude the entitlement group and switch the block to report-only.
          const rawKeep = policy.excludeGroupIds.length ? policy.excludeGroupIds : ["sg-breakglass-accounts-01"];
          const keep = rawKeep.map((id) => `'${id}'`);
          return {
            label: `Exclude ${entitlement.groupName} (report-only)`.slice(0, 48),
            scriptPreview: `$g = Get-MgGroup -Filter "displayName eq '${entitlement.groupName.replace(/'/g, "''")}'"; Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${blocking.id}' -BodyParameter @{ state = 'enabledForReportingButNotEnforced'; conditions = @{ users = @{ excludeGroups = @(${[...keep, "$g.Id"].join(", ")}) } } }`,
            ...target,
          };
        }
        const first = m.find((r) => r.role === "blocking") ?? m[0];
        return {
          label: "Inspect CA policy",
          scriptPreview: `Get-MgIdentityConditionalAccessPolicy ${first ? `-ConditionalAccessPolicyId '${first.id}'` : "-All"} | Select-Object DisplayName, State, @{n='IncludeGroups';e={$_.Conditions.Users.IncludeGroups}}, @{n='ExcludeGroups';e={$_.Conditions.Users.ExcludeGroups}}, @{n='Grant';e={$_.GrantControls.BuiltInControls}}`,
          ...target,
        };
      },
    });
  }

  if (ctx.intune) {
    const d = ctx.intune.data;
    const devices: Row[] = d.devices.map((x) => ({ deviceName: x.deviceName, upn: x.upn, os: x.os, complianceState: x.complianceState, lastCheckIn: x.lastCheckIn, detail: x.detail }));
    const bad = devices.filter((r) => r.complianceState !== "Compliant");
    out.push({
      kind: "intune-devices",
      rows: devices,
      focus: bad.length ? bad : devices,
      columns: [col("deviceName", "Device", { mono: true }), col("upn", "User", { mono: true }), col("complianceState", "Compliance", { isBadge: true }), col("lastCheckIn", "Last check-in", { mono: true }), col("detail", "Detail")],
      sourceQuery: "GET /v1.0/deviceManagement/managedDevices?$filter=complianceState eq 'noncompliant' or complianceState eq 'conflict'&$select=deviceName,userPrincipalName,complianceState,lastSyncDateTime",
      title: (m) => (m.every((r) => r.complianceState === "NonCompliant") ? "Non-Compliant Intune Devices Cohort" : m.every((r) => r.complianceState === "Conflict") ? "Intune devices in policy Conflict" : "Intune managed devices"),
      subtitle: (m) => `Live query across deviceManagement/managedDevices · ${plural(m.length, "device")} matched`,
      kpis: (m) => [
        { label: "Matched", value: plural(m.length, "device"), tone: m.length ? "warning" : "default" },
        { label: "NonCompliant", value: String(m.filter((r) => r.complianceState === "NonCompliant").length), tone: m.some((r) => r.complianceState === "NonCompliant") ? "critical" : "success" },
        { label: "Conflict", value: String(m.filter((r) => r.complianceState === "Conflict").length), tone: m.some((r) => r.complianceState === "Conflict") ? "critical" : "default" },
        { label: "Compliant", value: String(m.filter((r) => r.complianceState === "Compliant").length), tone: "success" },
      ],
      breakdown: (m) => breakdownBy(m, "complianceState", (v) => (v === "Compliant" ? "success" : v === "InGracePeriod" ? "warning" : "critical")),
      action: (m) => ({
        label: "Sync devices",
        scriptPreview: `Get-MgDeviceManagementManagedDevice -Filter "complianceState eq '${String(m[0]?.complianceState ?? "noncompliant").toLowerCase()}'" | ForEach-Object { Sync-MgDeviceManagementManagedDevice -ManagedDeviceId $_.Id }`,
        ...(stepIndex(steps, "intune") !== undefined ? { targetStepIndex: stepIndex(steps, "intune") } : {}),
      }),
    });
    const settings: Row[] = d.settings.map((s) => ({ settingName: s.settingName, policyName: s.policyName, golden: s.golden, live: s.live, status: s.status, severity: s.severity, cspUri: s.cspUri ?? null, registryPath: s.registryPath ?? null, tattooedOnUnassign: s.tattooedOnUnassign ?? false }));
    for (const p of d.policies) settings.push({ settingName: `${p.name} (${p.kind})`, policyName: p.name, golden: p.role === "golden" ? "assigned" : "unassigned", live: p.assignedTo.join(", ") || "unassigned", status: p.role === "golden" || p.role === "compliance" ? "in-sync" : p.role === "conflicting" || p.role === "duplicate" ? "conflict" : "drifted", severity: p.role === "golden" ? "low" : "high", cspUri: null, registryPath: null, tattooedOnUnassign: false });
    const off = settings.filter((r) => r.status !== "in-sync");
    out.push({
      kind: "intune-settings",
      rows: settings,
      focus: off.length ? off : settings,
      columns: [col("settingName", "Setting / policy"), col("golden", "Golden", { mono: true }), col("live", "Live", { mono: true }), col("status", "Status", { isBadge: true }), col("cspUri", "CSP", { mono: true })],
      sourceQuery: "GET /beta/deviceManagement/configurationPolicies/{id}/settings + /beta/deviceManagement/deviceConfigurations/{id}/assignments",
      title: (m) => (d.errorCode && m.some((r) => /bitlocker|encryption/i.test(String(r.settingName))) ? `${d.errorCode} · BitLocker policy conflict` : m.every((r) => r.status === "conflict") ? "Conflicting Intune settings" : "Intune settings vs golden baseline"),
      subtitle: (m) => `Live query across configurationPolicies/settings · ${plural(m.length, "setting")} matched`,
      kpis: (m) => [
        { label: "Settings", value: String(m.length) },
        { label: "Drifted", value: String(m.filter((r) => r.status === "drifted").length), tone: m.some((r) => r.status === "drifted") ? "warning" : "default" },
        { label: "Conflicts", value: String(m.filter((r) => r.status === "conflict").length), tone: m.some((r) => r.status === "conflict") ? "critical" : "default" },
        { label: "Affected devices", value: String(d.affectedDeviceCount), tone: d.affectedDeviceCount ? "critical" : "success" },
      ],
      breakdown: (m) => breakdownBy(m, "status", (v) => (v === "in-sync" ? "success" : v === "drifted" ? "warning" : "critical")),
      action: (m) => {
        const conflicting = d.policies.find((p) => p.role === "conflicting" || p.role === "duplicate");
        // Restore the first drifted setting that names both its policy and its definition; otherwise only read.
        const fixable = m
          .filter((r) => r.status !== "in-sync")
          .map((r) => ({ row: r, policy: d.policies.find((p) => p.name === r.policyName), definition: d.settings.find((s) => s.settingName === r.settingName && s.policyName === r.policyName)?.settingId ?? r.cspUri }))
          .find((x) => x.policy && x.definition);
        return {
          label: conflicting ? `Unassign ${conflicting.name}`.slice(0, 48) : fixable ? "Restore golden value" : "Inspect Intune policies",
          scriptPreview: conflicting
            ? `Invoke-MgGraphRequest -Method POST -Uri "/v1.0/deviceManagement/deviceConfigurations/${conflicting.id}/assign" -Body @{ assignments = @() }`
            : fixable
              ? `Invoke-MgGraphRequest -Method PUT -Uri "/beta/deviceManagement/configurationPolicies/${fixable.policy!.id}/settings" -Body @{ settings = @(@{ settingInstance = @{ settingDefinitionId = '${fixable.definition}'; choiceSettingValue = @{ value = '${fixable.row.golden}' } } }) }`
              : d.policies.map((p) => `Invoke-MgGraphRequest -Method GET -Uri "/beta/deviceManagement/configurationPolicies/${p.id}/settings"   # ${p.name}`).join("\n") || `Get-MgDeviceManagementDeviceConfiguration | Select-Object Id, DisplayName`,
          ...(stepIndex(steps, "intune") !== undefined ? { targetStepIndex: stepIndex(steps, "intune") } : {}),
        };
      },
    });
  }

  const w = ctx.workloadIdentity ?? (sources.getDataMode() === "real-tenant" ? null : WORKLOAD_IDENTITY);
  if (w) {
    const rows: Row[] = [
      ...(ctx.workloadIdentity
        ? [
            {
              kind: "owner",
              name: w.owner.upn,
              state: `${w.owner.directoryRoles.length} directory roles`,
              required: false,
              detail: "shadow admin: controls credentials and consent without a role",
              expired: false,
            },
          ]
        : []),
      ...w.appPermissions.map((p) => ({
        kind: "application permission",
        name: p,
        state: "granted",
        required: w.requiredPermissions.includes(p),
        detail: w.requiredPermissions.includes(p) ? "used in the last 90 days" : "unused in the last 90 days",
        expired: false,
      })),
      ...w.requiredPermissions
        .filter((p) => !w.appPermissions.includes(p))
        .map((p) => ({
          kind: "application permission",
          name: p,
          state: "required",
          required: true,
          detail: "least privilege for the observed activity",
          expired: false,
        })),
      {
        kind: "delegated grant",
        name: w.oauth2PermissionGrant.scope,
        state: w.oauth2PermissionGrant.verifiedPublisher ? "verified publisher" : "unverified publisher",
        required: false,
        detail: `${w.oauth2PermissionGrant.consentType} consent`,
        expired: false,
      },
      {
        kind: "client secret",
        name: w.passwordCredential.displayName,
        state: w.passwordCredential.expired ? `expired ${w.passwordCredential.endDateTime.slice(0, 10)}` : "valid",
        required: false,
        detail: `${w.errorCodeLabel} nightly from ${w.failureSource}`,
        expired: w.passwordCredential.expired,
      },
      {
        kind: "federated credential",
        name: w.federatedCredential.name,
        state: w.federatedCredential.driftState ?? "configured",
        required: true,
        detail: w.federatedCredential.driftDetail ?? `Configured subject identifier: ${w.federatedCredential.subject} · issuer ${w.federatedCredential.issuer}`,
        expired: false,
      },
      ...(w.oidcAssertionClaim
        ? [
            {
              kind: "oidc subject claim",
              name: w.oidcAssertionClaim.name,
              state: w.oidcAssertionClaim.state,
              required: true,
              detail: w.oidcAssertionClaim.detail,
              expired: false,
            },
          ]
        : []),
    ];
    const bad = rows.filter(
      (r) =>
        r.expired === true ||
        (r.kind === "application permission" && r.required === false) ||
        r.kind === "owner" ||
        r.kind === "delegated grant",
    );
    out.push({
      kind: "workload-identity",
      rows,
      focus: bad.length ? bad : rows,
      columns: [col("kind", "Item", { isBadge: true }), col("name", "Name", { mono: true }), col("state", "State"), col("detail", "Detail")],
      sourceQuery: `GET /v1.0/servicePrincipals/${w.spn.servicePrincipalId}?$expand=owners,appRoleAssignments,oauth2PermissionGrants + /v1.0/applications/${w.spn.objectId}/federatedIdentityCredentials`,
      title: (m) =>
        m.some((r) => r.expired === true) && m.length <= 2
          ? `${w.spn.displayName} · expired client secret (${w.errorCodeLabel})`
          : m.every((r) => /federated|oidc/i.test(String(r.kind)))
            ? `${w.spn.displayName} · OIDC federatedIdentityCredential subject drift (AADSTS70021)`
            : `${w.spn.displayName} · workload identity posture`,
      subtitle: (m) =>
        `Live query across servicePrincipals/owners, appRoleAssignments, federatedIdentityCredentials · ${plural(m.length, "item")} matched`,
      kpis: (m) => [
        { label: "Granted scopes", value: String(w.appPermissions.length), tone: "critical" },
        { label: "Required", value: String(w.requiredPermissions.length), tone: "success" },
        {
          label: "Expired secrets",
          value: String(m.filter((r) => r.expired === true).length || (w.passwordCredential.expired ? 1 : 0)),
          tone: w.passwordCredential.expired ? "critical" : "success",
        },
        { label: "Non-admin owners", value: String(w.owner.directoryRoles.length === 0 ? 1 : 0), tone: "warning" },
      ],
      breakdown: (m) =>
        breakdownBy(m, "kind", (v) =>
          v === "client secret" || v === "owner" || v === "oidc subject claim"
            ? "critical"
            : v === "delegated grant" || v === "federated credential"
              ? "warning"
              : "default",
        ),
      action: (m) => {
        const secret = m.some((r) => r.expired === true);
        const oidcOnly = m.every((r) => /federated|oidc/i.test(String(r.kind)));
        // A highlighted scope revokes exactly its own assignment and the delegated grant naming it, by their real ids.
        const assignments = w.appRoleAssignments.filter((a) =>
          m.some((r) => r.kind === "application permission" && r.name === a.permission && r.required === false),
        );
        const grant = m.some((r) => r.kind === "delegated grant");
        const revoke = [
          ...assignments.map(
            (a) =>
              `Remove-MgServicePrincipalAppRoleAssignment -ServicePrincipalId '${w.spn.servicePrincipalId}' -AppRoleAssignmentId '${a.id}'   # ${a.permission}`,
          ),
          ...(grant
            ? [`Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId '${w.oauth2PermissionGrant.id}'   # ${w.oauth2PermissionGrant.scope}`]
            : []),
        ];
        const revokeLabel =
          assignments.length === 1
            ? `Revoke ${assignments[0]!.permission}`
            : assignments.length
              ? `Revoke ${assignments.length} unused scopes`
              : "Revoke unverified grant";
        return {
          label: secret
            ? "Federate OIDC, retire secret"
            : oidcOnly
              ? "Align OIDC subject identifier"
              : revoke.length
                ? revokeLabel.slice(0, 48)
                : "Remove shadow-admin owner",
          scriptPreview:
            secret || oidcOnly
              ? `New-MgApplicationFederatedIdentityCredential -ApplicationId '${w.spn.objectId}' -BodyParameter @{ name = '${w.federatedCredential.name}'; issuer = '${w.federatedCredential.issuer}'; subject = '${w.federatedCredential.subject}'; audiences = @('${w.federatedCredential.audiences[0]}') }\nRemove-MgApplicationPassword -ApplicationId '${w.spn.objectId}' -KeyId '${w.passwordCredential.keyId}'`
              : revoke.length
                ? revoke.join("\n")
                : `Remove-MgApplicationOwnerByRef -ApplicationId '${w.spn.objectId}' -DirectoryObjectId '${w.owner.objectId}'`,
          ...(stepIndex(steps, "identity") !== undefined ? { targetStepIndex: stepIndex(steps, "identity") } : {}),
        };
      },
    });
  }

  // Entra security / licensing / policy groups across the tenant (via @contextpane/mcp-msgraph)
  const groupRows: Row[] = (ctx.securityGroups?.data ?? []).map((g) => ({
    displayName: g.displayName,
    members: g.members,
    assignedSku: g.assignedSku,
    linkedPolicy: g.linkedPolicy,
    state: g.state,
  }));
  if (groupRows.length) {
    out.push({
      kind: "entra-groups",
      rows: groupRows,
      focus: groupRows,
      columns: [
        col("displayName", "Group", { mono: true }),
        col("members", "Members", { mono: true }),
        col("assignedSku", "Assigned SKU", { mono: true }),
        col("linkedPolicy", "Linked Policy"),
        col("state", "State", { isBadge: true }),
      ],
      sourceQuery: "GET /v1.0/groups?$filter=startsWith(displayName,'SG-')&$expand=transitiveMembers($count=true),assignedLicenses",
      title: () => "Entra Security & Licensing Groups (SG-*)",
      subtitle: (m) => `Live query across groups & transitiveMembers · ${plural(m.length, "group")} matched`,
      kpis: (m) => [
        { label: "Groups", value: String(m.length) },
        {
          label: "Drifted / blocking",
          value: String(m.filter((r) => /Drifted|Conflicting|Missing/i.test(String(r.state))).length),
          tone: m.some((r) => /Drifted|Conflicting|Missing/i.test(String(r.state))) ? "critical" : "success",
        },
        { label: "Active target", value: String(m.filter((r) => /Active/i.test(String(r.state))).length), tone: "success" },
        { label: "Legacy / conflict", value: "2 groups", tone: "warning" },
      ],
      breakdown: (m) =>
        breakdownBy(m, "state", (v) =>
          /Drifted|Conflicting|Missing/i.test(v) ? "critical" : /Active/i.test(v) ? "success" : "warning",
        ),
      action: () => ({
        label: "Inspect Entra security groups",
        scriptPreview:
          "Get-MgGroup -Filter \"startsWith(displayName, 'SG-')\" -ConsistencyLevel eventual | Select-Object Id, DisplayName, SecurityEnabled, AssignedLicenses",
        ...(stepIndex(steps, "identity") !== undefined ? { targetStepIndex: stepIndex(steps, "identity") } : {}),
      }),
    });
  }

  if (ctx.drift) {
    const d = ctx.drift.data;
    const rows: Row[] = [
      ...d.rogueSecurityRules.map((r) => ({ ruleName: r.ruleName, kind: "rogue rule", priority: r.priority, direction: r.direction, access: r.access, protocol: r.protocol, port: r.port, source: r.source, destination: r.destination, severity: r.severity, reason: r.reason })),
      ...d.missingSecurityRules.map((name) => ({ ruleName: name, kind: "missing in Azure", priority: 0, direction: "Inbound", access: "Deny", protocol: "*", port: "*", source: "*", destination: "*", severity: "medium", reason: "declared in Terraform, absent live" })),
      ...d.tagDrift.map((t) => ({ ruleName: `tag ${t.key}`, kind: "tag drift", priority: 0, direction: "-", access: "-", protocol: "-", port: "-", source: t.actualInAzure ?? "(absent)", destination: t.expectedInTf ?? "(absent)", severity: "low", reason: `Azure '${t.actualInAzure ?? "absent"}' vs Terraform '${t.expectedInTf ?? "absent"}'` })),
    ];
    out.push({
      kind: "azure-nsg-rules",
      rows,
      focus: rows,
      columns: [col("ruleName", "Rule / tag", { mono: true }), col("kind", "Kind", { isBadge: true }), col("protocol", "Proto", { mono: true }), col("port", "Port", { mono: true }), col("source", "Source", { mono: true }), col("severity", "Severity", { isBadge: true }), col("reason", "Reason")],
      sourceQuery: `GET /subscriptions/${sub}/resourceGroups/${d.resourceGroup}/providers/Microsoft.Network/networkSecurityGroups/${d.resourceName}?api-version=2023-09-01 (diffed against ${d.terraformFile} @ ${d.gitBranch})`,
      title: (m) => (m.length === 1 && m[0]!.kind === "rogue rule" ? `${d.resourceName} · rogue rule ${m[0]!.ruleName} (${String(m[0]!.protocol).toUpperCase()}/${m[0]!.port})` : `${d.resourceName} · NSG drift vs Terraform`),
      subtitle: (m) => `Live ARM read of ${d.resourceName} diffed against ${d.terraformFile} · ${plural(m.length, "finding")} matched`,
      kpis: (m) => [
        { label: "Rogue rules", value: String(m.filter((r) => r.kind === "rogue rule").length), tone: m.some((r) => r.kind === "rogue rule") ? "critical" : "success" },
        { label: "Critical", value: String(m.filter((r) => r.severity === "critical").length), tone: m.some((r) => r.severity === "critical") ? "critical" : "default" },
        { label: "Tag drift", value: String(m.filter((r) => r.kind === "tag drift").length), tone: m.some((r) => r.kind === "tag drift") ? "warning" : "default" },
        { label: "Drift state", value: d.driftState, tone: d.driftState === "drift-detected" ? "critical" : "success" },
      ],
      breakdown: (m) => breakdownBy(m, "severity", (v) => (v === "critical" || v === "high" ? "critical" : v === "medium" ? "warning" : "default")),
      action: (m) => {
        const rogue = m.find((r) => r.kind === "rogue rule");
        return {
          label: rogue ? `Remove rule ${rogue.ruleName}` : "Re-apply Terraform baseline",
          scriptPreview: rogue
            ? `Get-AzNetworkSecurityGroup -Name '${d.resourceName}' -ResourceGroupName '${d.resourceGroup}' | Remove-AzNetworkSecurityRuleConfig -Name '${rogue.ruleName}' | Set-AzNetworkSecurityGroup`
            : `terraform -chdir=demo-iac plan -target=azurerm_network_security_group.contoso_avd_hostpool`,
          ...(stepIndex(steps, "azure") !== undefined ? { targetStepIndex: stepIndex(steps, "azure") } : {}),
        };
      },
    });
  }

  if (ctx.avd) {
    const a = ctx.avd.data;
    const pool = a.hostPool;
    const rows: Row[] = pool.sessionHosts.map((h) => ({ name: h.name, status: h.status, sessions: h.sessions, agentVersion: h.agentVersion ?? null, hostPool: pool.name, vmSize: pool.vmSize, location: pool.location, joinType: pool.joinType, fslogix: pool.fslogix.status }));
    out.push({
      kind: "avd-session-hosts",
      rows,
      focus: rows,
      columns: [col("name", "Session host", { mono: true }), col("status", "Status", { isBadge: true }), col("sessions", "Sessions", { mono: true }), col("agentVersion", "Agent", { mono: true }), col("fslogix", "FSLogix", { isBadge: true })],
      sourceQuery: `GET /subscriptions/${sub}/resourceGroups/${a.resourceGroup}/providers/Microsoft.DesktopVirtualization/hostPools/${pool.name}/sessionHosts?api-version=2024-04-03`,
      title: () => `${pool.name} · ${pool.poolType} host pool (${pool.loadBalancer})`,
      subtitle: (m) => `Live ARM read of hostPools/sessionHosts · ${plural(m.length, "host")} matched`,
      kpis: (m) => [
        { label: "Hosts", value: String(m.length) },
        { label: "Available", value: String(m.filter((r) => r.status === "Available").length), tone: m.every((r) => r.status === "Available") ? "success" : "warning" },
        { label: "Sessions", value: String(m.reduce((n, r) => n + Number(r.sessions), 0)) },
        { label: "FSLogix", value: pool.fslogix.status, tone: pool.fslogix.status === "Healthy" ? "success" : "warning" },
      ],
      breakdown: (m) => breakdownBy(m, "status", (v) => (v === "Available" ? "success" : v === "Draining" ? "warning" : "critical")),
      action: () => ({ label: "List session hosts", scriptPreview: `Get-AzWvdSessionHost -HostPoolName '${pool.name}' -ResourceGroupName '${a.resourceGroup}' | Select-Object Name, Status, Session, AgentVersion`, ...(stepIndex(steps, "azure") !== undefined ? { targetStepIndex: stepIndex(steps, "azure") } : {}) }),
    });
  }

  // Populate Azure Policy & Resource Health dataset via @contextpane/mcp-azure-iac
  {
    const rgName = ctx.avd?.data.resourceGroup ?? ctx.drift?.data.resourceGroup ?? "rg-contoso-avd-prod";
    const basePolicies: Row[] = (ctx.azurePolicies?.data ?? ctx.avd?.data.azurePolicies ?? []).map((p) => ({
      name: p.name,
      effect: p.effect,
      compliance: p.compliance,
      nonCompliantResources: p.nonCompliantResources,
      scope: p.scope,
      detail: p.detail,
    }));
    const nc = basePolicies.filter((r) => r.compliance === "NonCompliant");
    if (basePolicies.length) {
      out.push({
        kind: "azure-policies",
        rows: basePolicies,
        focus: basePolicies,
        columns: [
          col("name", "Policy / Health Check"),
          col("effect", "Effect", { isBadge: true }),
          col("compliance", "Compliance", { isBadge: true }),
          col("nonCompliantResources", "Non-compliant", { mono: true }),
          col("detail", "Detail"),
        ],
        sourceQuery: `POST /subscriptions/${sub}/resourceGroups/${rgName}/providers/Microsoft.PolicyInsights/policyStates/latest/summarize?api-version=2019-10-01`,
        title: (m) =>
          m.some((r) => /Resource-Health/i.test(String(r.name)))
            ? `Azure Policy & Resource Health · ${rgName}`
            : `Azure Policy compliance · ${rgName}`,
        subtitle: (m) => `Live PolicyInsights & ResourceHealth summary · ${plural(m.length, "assignment")} matched`,
        kpis: (m) => [
          { label: "Assignments", value: String(m.length) },
          {
            label: "Non-compliant",
            value: String(m.filter((r) => r.compliance === "NonCompliant").length),
            tone: m.some((r) => r.compliance === "NonCompliant") ? "warning" : "success",
          },
          {
            label: "Deny policies",
            value: String(m.filter((r) => r.effect === "Deny").length),
            tone: m.some((r) => r.effect === "Deny" && r.compliance === "NonCompliant") ? "critical" : "default",
          },
          {
            label: "Resources flagged",
            value: String(m.reduce((n, r) => n + Number(r.nonCompliantResources), 0)),
            tone: nc.length ? "warning" : "success",
          },
        ],
        breakdown: (m) => breakdownBy(m, "compliance", (v) => (v === "Compliant" ? "success" : "warning")),
        action: () => ({
          label: "Summarise policy states",
          scriptPreview: `Get-AzPolicyStateSummary -ResourceGroupName '${rgName}' | Select-Object -ExpandProperty PolicyAssignments`,
          ...(stepIndex(steps, "azure") !== undefined ? { targetStepIndex: stepIndex(steps, "azure") } : {}),
        }),
      });
    }
  }

  // Populate Regional Quota & Capacity dataset via @contextpane/mcp-azure-iac
  {
    const quotaRows: Row[] = (ctx.regionalQuotas?.data ?? []).map((q) => ({
      resource: q.resource,
      region: q.region,
      usage: q.usage,
      utilization: q.utilization,
      headroom: q.headroom,
      status: q.status,
    }));
    if (quotaRows.length) {
      out.push({
        kind: "azure-quota-capacity",
        rows: quotaRows,
        focus: quotaRows,
        columns: [
          col("resource", "Quota / Resource Family", { mono: true }),
          col("region", "Region", { mono: true }),
          col("usage", "Usage", { mono: true }),
          col("utilization", "Utilization", { mono: true }),
          col("headroom", "Capacity State", { isBadge: true }),
          col("status", "Status", { isBadge: true }),
        ],
        sourceQuery:
          `GET /subscriptions/${sub}/providers/Microsoft.Compute/locations/westeurope/usages?api-version=2024-03-01`,
        title: () => `Regional Quota & Capacity · ${sub}`,
        subtitle: (m) => `Live Compute/Network/Storage Usages (≥80% + EU peer regions) · ${plural(m.length, "quota")} matched`,
        kpis: () => [
          { label: "D4s_v5 (westeurope)", value: "20/20 (100%)", tone: "critical" },
          { label: "Regional vCPUs", value: "48/50 (96%)", tone: "warning" },
          { label: "germanywestcentral", value: "16 vCPUs Free", tone: "success" },
          { label: "northeurope", value: "14 vCPUs Free", tone: "success" },
        ],
        breakdown: (m) =>
          breakdownBy(m, "status", (v) => (v === "Critical" ? "critical" : v === "Warning" ? "warning" : "success")),
        action: () => ({
          label: "Query regional VM quota usage",
          scriptPreview:
            "Get-AzVMUsage -Location westeurope | Where-Object { $_.Limit -gt 0 -and ($_.CurrentValue / $_.Limit) -ge 0.8 } | Select-Object @{n='Resource';e={$_.Name.LocalizedValue}}, CurrentValue, Limit",
          ...(stepIndex(steps, "azure") !== undefined ? { targetStepIndex: stepIndex(steps, "azure") } : {}),
        }),
      });
    }
  }

  return out;
}

/* ------------------------------- slice selection ----------------------------- */

const MAX_ROWS = 60;

export interface SelectionOptions {
  refinementText?: string;
  viewMode?: ContextViewMode;
}

export function buildSelectionSlice(ctx: CorrelationContext, selectedText: string, steps: ResolutionStep[], options: SelectionOptions = {}): SelectionSlice {
  const selection = selectedText.trim();
  const refinement = (options.refinementText ?? "").trim();
  const viewMode = options.viewMode ?? "dashboard";
  const combined = refinement ? `${selection} ${refinement}` : selection;
  const sets = datasets(ctx, steps);
  const searched: SelectionSlice["searched"] = [];

  // Relational peer-apps query: e.g. selecting "appId 44b8e1a7-..." or "spn-contoso-erp-sync" or "alex.wilber"
  // and adding "other apps with the same owner" (or switching to comparison mode on an app/owner).
  const wantsPeerApps =
    /other\s+apps?|same\s+owner|owned\s+by|peer\s+apps?|apps?\s+with|shadow[- ]admin\s+apps?/i.test(combined) ||
    (Boolean(ctx.workloadIdentity) && viewMode === "comparison" && /\bappid\b|44b8e1a7|spn-contoso-erp-sync|alex\.wilber/i.test(combined));

  if (wantsPeerApps && (ctx.workloadIdentity || WORKLOAD_IDENTITY.peerApps?.length)) {
    const w = ctx.workloadIdentity ?? WORKLOAD_IDENTITY;
    const allPeers = w.peerApps ?? [];
    const sameOwnerOnly = /same\s+owner|other\s+apps?|owned\s+by/i.test(combined) && viewMode !== "comparison";
    const peerList = sameOwnerOnly ? allPeers.filter((a) => a.ownerUpn === w.owner.upn) : allPeers;
    const rows: Row[] = peerList.map((a) => ({
      displayName: a.displayName,
      appId: a.appId,
      ownerUpn: a.ownerUpn,
      ownerRoles: a.ownerRoles,
      credentialSummary: a.credentialSummary,
      highPrivScopes: a.highPrivScopes,
      stateLabel: a.stateLabel,
      posture: a.posture,
    }));
    const ownerApps = allPeers.filter((a) => a.ownerUpn === w.owner.upn);
    for (const ds of sets) {
      searched.push({ kind: ds.kind, rows: ds.rows.length, matched: ds.kind === "workload-identity" ? rows.length : 0 });
    }
    const errorCodeReference = lookupErrorCodeReference(combined);
    return {
      kind: "workload-identity",
      score: 260,
      matchedBy: "rows",
      title: `Apps sharing owner ${w.owner.upn} (${ownerApps.length} shadow-admin SPNs)`.slice(0, 90),
      subtitle: `Live query across users/${w.owner.upn}/ownedObjects · ${plural(rows.length, "service principal")} matched${refinement ? ` · "${refinement}"` : ""}`.slice(0, 160),
      sourceQuery: `GET /v1.0/users/${w.owner.upn}/ownedObjects/microsoft.graph.servicePrincipal?$select=id,appId,displayName,passwordCredentials,appRoleAssignments`.slice(0, 300),
      columns: [
        col("displayName", "App / SPN", { mono: true }),
        col("appId", "App ID", { mono: true }),
        col("ownerUpn", "Owner", { mono: true }),
        col("credentialSummary", "Credential"),
        col("highPrivScopes", "Granted Scopes", { mono: true }),
        col("stateLabel", "Posture", { isBadge: true }),
      ],
      rows,
      kpis: [
        { label: "Shared owner", value: w.owner.displayName, tone: "warning" },
        { label: "Shadow-admin SPNs", value: `${ownerApps.length} apps`, tone: "critical" },
        { label: "Directory roles", value: `${w.owner.directoryRoles.length} roles`, tone: "warning" },
        { label: "Golden OIDC", value: `${allPeers.filter((a) => a.posture === "healthy").length}/${allPeers.length} apps`, tone: "critical" },
      ],
      breakdown: breakdownBy(rows, "stateLabel", (v) => (/Golden|Healthy/i.test(v) ? "success" : /Expiring/i.test(v) ? "warning" : "critical")),
      suggestedAction: {
        label: `Remove shadow-admin owner (${ownerApps.length} SPNs)`.slice(0, 48),
        scriptPreview: ownerApps
          .map((a) => `Remove-MgApplicationOwnerByRef -ApplicationId '${a.objectId}' -DirectoryObjectId '${w.owner.objectId}'   # ${a.displayName} (${a.appId})`)
          .join("\n"),
        ...(stepIndex(steps, "identity") !== undefined ? { targetStepIndex: stepIndex(steps, "identity") } : {}),
      },
      ...(errorCodeReference ? { errorCodeReference } : {}),
      searched,
    };
  }

  const isQuotaSelection = /quotaexceeded|\bquota\b|\bcapacity\b|\bvcpus?\b|standard_d4s_v5|\bd4s_v5\b|westeurope|germanywestcentral|northeurope/i.test(selection);
  const isConceptualGroupSelection = /legacy\s+block\s+group|legacy\s+group|block\s+group|security\s+groups?|^sg-$|sg-contoso-finance-legacy|sg-contoso-f3-frontline|sg-fabrikam-legacy-bitlocker/i.test(selection);
  const isAzurePolicySelection = /resource\s+health|policy\s+assignments?|allowed[- ]locations|requestdisallowedbypolicy|require[- ]tag/i.test(selection);
  const isOidcSelection = /subject\s+identifier|federat|aadsts70021|\b70021\b|token\.actions\.githubusercontent\.com/i.test(selection);

  let best: { ds: Dataset; score: number; matchedBy: "rows" | "dataset"; rows: Row[] } | null = null;
  const wantsCohortExpansion =
    Boolean(refinement) && /other|same|all|cohort|peer|compare|group|more|similar|healthy|free|available/i.test(refinement);

  for (const ds of sets) {
    const hits = datasetHits(selection, ds.kind);
    const refHits = refinement ? datasetHits(refinement, ds.kind) : 0;
    const matched = ds.rows.filter((r) => rowMatches(selection, r));
    const refMatched = refinement ? ds.rows.filter((r) => rowMatches(refinement, r)) : [];
    searched.push({ kind: ds.kind, rows: ds.rows.length, matched: matched.length });
    let score = 0;
    let matchedBy: "rows" | "dataset" = "rows";
    let rows = matched;

    const domainBoost =
      (ds.kind === "azure-quota-capacity" && isQuotaSelection) ||
      (ds.kind === "entra-groups" && isConceptualGroupSelection) ||
      (ds.kind === "azure-policies" && isAzurePolicySelection) ||
      (ds.kind === "workload-identity" && isOidcSelection)
        ? 220
        : 0;

    if (matched.length) {
      score = 100 + domainBoost + (hits + refHits) * 20 + Math.min(matched.length, 40) - (matched.length === ds.rows.length && hits === 0 ? 60 : 0);
      if (ds.kind === "azure-quota-capacity" && isQuotaSelection) {
        rows = refMatched.length ? refMatched : ds.focus;
      } else if (ds.kind === "entra-groups" && isConceptualGroupSelection) {
        rows = refMatched.length ? refMatched : ds.focus;
      } else if (ds.kind === "azure-policies" && isAzurePolicySelection) {
        rows = refMatched.length ? refMatched : ds.focus;
      } else if (refMatched.length && refMatched.length < matched.length) {
        const intersect = matched.filter((r) => refMatched.includes(r));
        if (intersect.length) rows = intersect;
      } else if ((wantsCohortExpansion || viewMode === "comparison" || viewMode === "blast-radius") && matched.length === 1 && ds.focus.length > 1) {
        rows = [matched[0]!, ...ds.focus.filter((r) => r !== matched[0])];
      }
    } else if (hits || domainBoost) {
      score = 50 + domainBoost + (hits + refHits) * 45 + (refMatched.length ? 35 : 0);
      matchedBy = "dataset";
      if (ds.kind === "workload-identity" && isOidcSelection) {
        const oidcRows = ds.rows.filter((r) => /federated|oidc/i.test(String(r.kind)));
        rows = oidcRows.length ? oidcRows : ds.focus;
      } else {
        rows = refMatched.length ? refMatched : ds.focus;
      }
    }
    if (!score) continue;
    const order = KIND_ORDER.indexOf(ds.kind);
    if (!best || score > best.score || (score === best.score && order < KIND_ORDER.indexOf(best.ds.kind))) best = { ds, score, matchedBy, rows };
  }

  if (!best) {
    const pickKind = (): SliceKind => {
      if (/quota|capacity|vcpu|westeurope|germanywestcentral|northeurope|standard_d/i.test(combined)) return "azure-quota-capacity";
      if (/policy|resource|health|location|allow|deny|arm|az/i.test(combined)) return "azure-policies";
      if (/app|spn|oidc|token|secret|claim|subject|federat|github/i.test(combined) || ctx.scenarioId === "ANOM-APP-401") return "workload-identity";
      if (/group|sg-/i.test(combined)) return "entra-groups";
      if (ctx.intune) return "intune-settings";
      if (ctx.caPosture) return "entra-ca-policies";
      return "entra-signins";
    };
    const targetKind = pickKind();
    const fallbackDs = sets.find((d) => d.kind === targetKind) ?? sets.find((d) => d.kind === "azure-policies") ?? sets[0]!;
    const fallbackRows = fallbackDs.focus.slice(0, 5);
    const errorCodeReference = lookupErrorCodeReference(combined);
    return {
      kind: fallbackDs.kind,
      score: 0,
      matchedBy: "none",
      title: fallbackDs.title(fallbackRows).slice(0, 90),
      subtitle: fallbackDs.subtitle(fallbackRows).slice(0, 160),
      sourceQuery: fallbackDs.sourceQuery.slice(0, 300),
      columns: fallbackDs.columns,
      rows: fallbackRows,
      kpis: fallbackDs.kpis(fallbackRows).slice(0, 4).map((k) => ({ ...k, tone: k.tone ?? "default" })),
      breakdown: fallbackDs.breakdown(fallbackRows).slice(0, 5),
      suggestedAction: fallbackDs.action(fallbackRows),
      ...(errorCodeReference ? { errorCodeReference } : {}),
      searched,
    };
  }

  let finalRows = best.rows;
  if (refinement) {
    const refTokens = tokens(refinement);
    const tokenFiltered = finalRows.filter((r) => rowMatches(refinement, r) || (refTokens.length > 0 && refTokens.some((t) => rowText(r).includes(t))));
    if (tokenFiltered.length > 0 && !wantsCohortExpansion) {
      finalRows = tokenFiltered;
    } else if (wantsCohortExpansion && best.ds.rows.length > finalRows.length) {
      finalRows = [...finalRows, ...best.ds.rows.filter((r) => !finalRows.includes(r))];
    }
  }

  const rows = finalRows.slice(0, MAX_ROWS);
  const rawTitle = best.ds.title(rows);
  const rawSubtitle = best.ds.subtitle(rows);
  const modeSuffix =
    viewMode === "comparison"
      ? " · Live vs Golden Comparison"
      : viewMode === "blast-radius"
        ? " · Blast Radius & Dependency Impact"
        : "";
  const title = (
    refinement && !rawTitle.toLowerCase().includes(refinement.toLowerCase())
      ? `${rawTitle} · ${refinement}`
      : `${rawTitle}${modeSuffix && !rawTitle.includes(modeSuffix) ? modeSuffix : ""}`
  ).slice(0, 90);
  const subtitle = (refinement ? `${rawSubtitle} · context: "${refinement}"` : rawSubtitle).slice(0, 160);
  const baseAction = best.ds.action(rows);
  const sanitizedRef = refinement.replace(/[<>]/g, "").trim();
  const suggestedAction: MiniDashboardSuggestedAction =
    sanitizedRef && !baseAction.scriptPreview.includes(sanitizedRef)
      ? {
          ...baseAction,
          scriptPreview: `${baseAction.scriptPreview}\n# Refined filter: ${sanitizedRef}`.slice(0, 1200),
        }
      : baseAction;
  const errorCodeReference = lookupErrorCodeReference(combined);

  return {
    kind: best.ds.kind,
    score: best.score,
    matchedBy: best.matchedBy,
    title,
    subtitle,
    sourceQuery: best.ds.sourceQuery.slice(0, 300),
    columns: best.ds.columns,
    rows,
    kpis: best.ds.kpis(rows).slice(0, 4).map((k) => ({ ...k, tone: k.tone ?? "default" })),
    breakdown: best.ds.breakdown(rows).slice(0, 5),
    suggestedAction,
    ...(errorCodeReference ? { errorCodeReference } : {}),
    searched,
  };
}

/** The validated deterministic card for a slice (the fallback and the reference). */
export function sliceToCard(ctx: CorrelationContext, selectedText: string, slice: SelectionSlice, options: SelectionOptions = {}): ContextualMiniDashboard {
  const refinement = options.refinementText?.trim() ? options.refinementText.trim().slice(0, 120) : undefined;
  const viewMode = options.viewMode;
  const hash = selectionHash(ctx.ticketId, selectedText, refinement, viewMode);
  const errorCodeReference = lookupErrorCodeReference(refinement ? `${selectedText} ${refinement}` : selectedText);
  return ContextualMiniDashboardSchema.parse({
    id: `selection-${hash}`,
    selectionText: selectedText.trim().slice(0, 120),
    ...(refinement ? { refinementText: refinement } : {}),
    ...(viewMode ? { viewMode } : {}),
    title: slice.title,
    subtitle: slice.subtitle,
    sourceQuery: slice.sourceQuery,
    provenanceCategory: "selection",
    kpis: slice.kpis,
    breakdown: slice.breakdown,
    columns: slice.columns,
    rowsPtr: selectionDataPtr(ctx.ticketId, hash),
    rows: slice.rows,
    suggestedAction: slice.suggestedAction,
    ...(errorCodeReference ? { errorCodeReference } : {}),
  });
}
