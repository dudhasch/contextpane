import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  ActionApprovalDrawerSchema,
  ContextualMiniDashboardModelArgsSchema,
  ContextualMiniDashboardSchema,
  EntityTypeSchema,
  TENANT_REGISTRY,
  formatIssues,
  getComposeMiniDashboardToolDefinition,
  parseToolArguments,
  selectionDataPtr,
  selectionHash,
  type ActionApprovalDrawer,
  type ContextViewMode,
  type ContextualMiniDashboard,
  type MetricTone,
  type MiniDashboardBreakdown,
  type MiniDashboardColumn,
  type MiniDashboardKpi,
  type RouterTelemetry,
  type ScenarioListItem,
  type TenantId,
} from "@contextpane/catalog";
import type { McpDataMode } from "@contextpane/mcp-msgraph";
import { config, models, providers } from "../config.ts";
import { sources } from "../mcp/clients.ts";
import { gatherContext, invalidateContext } from "../mcp/context.ts";
import { checkWhatIfSafety, runLocalPreflight } from "../preflight/local.ts";
import { InvalidSchemaError, runChain, type ChainStep } from "../router/chain.ts";
import { chatWithForcedTool, type TokenUsage } from "../router/openai.ts";
import { remediationStore } from "../store/remediations.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { exploreSelection, type ExploreResult } from "../tiers/explore.ts";
import { progressReporter, type ProgressSink } from "../tiers/progress.ts";
import { coerceAffectedEntityType } from "./entity-type.ts";
import { customScenarioListItem, listCustomScenarios, registerCustomTicket } from "./custom-ticket.ts";
import { publishSelection } from "./dataplane.ts";
import { ERROR_CODE_ENCYCLOPEDIA } from "./selection.ts";
import { synthesizeCustomRemediation } from "./subagent-orchestrator.ts";

const SETTINGS_FILE = resolve(import.meta.dir, "../../data/settings.json");

interface PersistedSettings {
  dataMode: McpDataMode;
  updatedAt: string;
}

export function initDataModeOnStartup(): McpDataMode {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Partial<PersistedSettings>;
      if (parsed.dataMode === "real-tenant" || parsed.dataMode === "simulated-lab") {
        sources.setDataMode(parsed.dataMode);
        return parsed.dataMode;
      }
    }
  } catch {
    // Fall back to config default
  }
  const initial: McpDataMode = config.liveCloudMode ? "real-tenant" : "simulated-lab";
  sources.setDataMode(initial);
  return initial;
}

export function getPersistedDataMode(): McpDataMode {
  return sources.getDataMode();
}

export function setPersistedDataMode(mode: McpDataMode): McpDataMode {
  sources.setDataMode(mode);
  invalidateContext();
  try {
    mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
    const payload: PersistedSettings = {
      dataMode: mode,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // Ignore filesystem errors in ephemeral environments
  }
  return mode;
}

export interface FreeRoamEntityItem {
  id: string;
  label: string;
  sublabel: string;
  badge: string;
  tone: MetricTone;
  queryPrompt: string;
}

export interface FreeRoamCategory {
  id: string;
  title: string;
  source: string;
  count: number;
  items: FreeRoamEntityItem[];
}

export interface FreeRoamInventory {
  dataMode: McpDataMode;
  tenant: {
    tenantId: string;
    displayName: string;
    verifiedDomain: string;
    entraTenantId: string;
  };
  sourcesUsed: Record<string, string>;
  fallbackReasons: string[];
  summary: {
    users: number;
    groups: number;
    skuPools: number;
    caPolicies: number;
    signInEvents: number;
    intuneDevices: number;
    azureResources: number;
    azurePolicies: number;
  };
  categories: FreeRoamCategory[];
  gatheredAt: string;
}

export async function getFreeRoamInventory(tenantIdInput?: string): Promise<FreeRoamInventory> {
  const tenantId: TenantId =
    tenantIdInput && tenantIdInput in TENANT_REGISTRY ? (tenantIdInput as TenantId) : "tenant-contoso-01";
  const dataMode = sources.getDataMode();

  const [
    erp,
    license,
    securityGroups,
    caPolicies,
    signIns,
    workloadIdentity,
    intune,
    virtualMachines,
    azureResources,
    azurePolicies,
    regionalQuotas,
  ] = await Promise.all([
    sources.erp.getTenantContext(tenantId),
    sources.msgraph.getLicenseInventory(tenantId).catch(() => null),
    sources.msgraph.getSecurityGroups(tenantId).catch(() => null),
    sources.msgraph.getConditionalAccessPolicies(tenantId).catch(() => null),
    sources.msgraph.getSignInEvents(tenantId, { top: 25 }).catch(() => null),
    sources.msgraph.getWorkloadIdentityPosture(tenantId).catch(() => null),
    sources.msgraph.getIntuneDrift(tenantId === "tenant-fabrikam-02" ? "INC-4099" : "ANOM-INT-309").catch(() => null),
    sources.azure.getVirtualMachines(tenantId).catch(() => null),
    sources.azure.getResourceInventory(tenantId).catch(() => null),
    sources.azure.getAzurePolicies(tenantId).catch(() => null),
    sources.azure.getRegionalQuotas(tenantId).catch(() => null),
  ]);

  const envelopes: Record<string, { source: string; fallbackReason?: string } | null> = {
    license,
    securityGroups,
    caPolicies,
    signIns,
    workloadIdentity,
    intune,
    virtualMachines,
    azureResources,
    azurePolicies,
    regionalQuotas,
  };

  const sourcesUsed: Record<string, string> = {};
  const fallbackReasons: string[] = [];
  for (const [k, v] of Object.entries(envelopes)) {
    if (v) {
      sourcesUsed[k] = v.source;
      if (v.fallbackReason) fallbackReasons.push(`${k}: ${v.fallbackReason}`);
    }
  }

  const users = license?.data.users ?? [];
  const skuPools = license?.data.skuPools ?? [];
  const groups = securityGroups?.data ?? [];
  const policies = caPolicies?.data ?? [];
  const signInList = signIns?.data ?? [];
  const devices = intune?.data.devices ?? [];
  const vms = virtualMachines?.data ?? [];
  const resourceInventory = azureResources?.data;
  const resources = resourceInventory?.resources ?? [];
  const armPolicies = azurePolicies?.data ?? [];
  const quotas = regionalQuotas?.data ?? [];

  const categories: FreeRoamCategory[] = [
    {
      id: "azure-vms",
      title: "Azure Virtual Machines (Get-AzVM)",
      source: virtualMachines?.source ?? (dataMode === "real-tenant" ? "live-azure" : "seeded-manifest"),
      count: vms.length,
      items: vms.map((vm) => ({
        id: vm.id,
        label: vm.name,
        sublabel: `${vm.resourceGroup} · ${vm.location} · ${vm.vmSize} · ${vm.osType} · NIC: ${vm.nic}`,
        badge: vm.provisioningState,
        tone: vm.provisioningState === "Succeeded" ? "success" : "warning",
        queryPrompt: `what vms do we have`,
      })),
    },
    {
      id: "users",
      title: "Entra ID Users & Licenses",
      source: license?.source ?? (dataMode === "real-tenant" ? "live-graph" : "seeded-manifest"),
      count: users.length,
      items: users.slice(0, 25).map((u) => ({
        id: u.upn,
        label: u.displayName,
        sublabel: u.upn,
        badge: u.currentSku ?? "UNLICENSED",
        tone: !u.accountEnabled && u.currentSku ? "warning" : u.assignmentState.startsWith("Error") ? "critical" : "success",
        queryPrompt: u.upn,
      })),
    },
    {
      id: "groups",
      title: "Entra Security & Licensing Groups",
      source: securityGroups?.source ?? (dataMode === "real-tenant" ? "live-graph" : "seeded-manifest"),
      count: groups.length,
      items: groups.slice(0, 25).map((g) => ({
        id: g.displayName,
        label: g.displayName,
        sublabel: `${g.members} members · ${g.linkedPolicy}`,
        badge: g.assignedSku !== "—" ? g.assignedSku : g.state,
        tone: g.state.toLowerCase().includes("violation") || g.state.toLowerCase().includes("block") ? "critical" : "default",
        queryPrompt: g.displayName,
      })),
    },
    {
      id: "ca-policies",
      title: "Conditional Access Policies",
      source: caPolicies?.source ?? (dataMode === "real-tenant" ? "live-graph" : "seeded-manifest"),
      count: policies.length,
      items: policies.slice(0, 25).map((p) => ({
        id: p.id,
        label: p.displayName,
        sublabel: `Grant: ${p.grant.builtInControls.join(", ") || "none"} · Exclude: ${p.excludeGroupNames.join(", ") || "none"}`,
        badge: p.state === "enabled" ? "Enforced" : p.state === "enabledForReportingButNotEnforced" ? "Report-Only" : "Disabled",
        tone: p.blocks && p.state === "enabled" ? "critical" : p.state === "enabledForReportingButNotEnforced" ? "warning" : "success",
        queryPrompt: p.displayName,
      })),
    },
    {
      id: "sku-pools",
      title: "Subscribed SKU Pools",
      source: license?.source ?? (dataMode === "real-tenant" ? "live-graph" : "seeded-manifest"),
      count: skuPools.length,
      items: skuPools.map((s) => ({
        id: s.skuPartNumber,
        label: s.skuPartNumber,
        sublabel: `${s.consumed} / ${s.enabled} seats consumed`,
        badge: `${s.available} free`,
        tone: s.available <= 0 ? "critical" : s.available <= 2 ? "warning" : "success",
        queryPrompt: `${s.skuPartNumber} license pool consumption`,
      })),
    },
    {
      id: "intune-devices",
      title: "Intune Managed Endpoints",
      source: intune?.source ?? (dataMode === "real-tenant" ? "live-graph" : "seeded-manifest"),
      count: devices.length,
      items: devices.slice(0, 25).map((d) => ({
        id: d.deviceName,
        label: d.deviceName,
        sublabel: `${d.upn} · ${d.os}`,
        badge: d.complianceState,
        tone: d.complianceState === "Compliant" ? "success" : d.complianceState === "InGracePeriod" ? "warning" : "critical",
        queryPrompt: d.deviceName,
      })),
    },
    {
      id: "azure-resources",
      title: "Azure ARM Resources & Policies",
      source: azureResources?.source ?? azurePolicies?.source ?? (dataMode === "real-tenant" ? "live-azure" : "seeded-manifest"),
      count: resources.length + armPolicies.length,
      items: [
        ...resources.slice(0, 25).map((r) => {
          const rg = ("resourceGroup" in r && typeof r.resourceGroup === "string" && r.resourceGroup) ? r.resourceGroup : (resourceInventory?.resourceGroup ?? "rg");
          const loc = ("location" in r && typeof r.location === "string" && r.location) ? r.location : (resourceInventory?.location ?? "westeurope");
          return {
            id: r.id,
            label: r.name,
            sublabel: `${r.type} · ${rg} (${loc})`,
            badge: "Provisioned",
            tone: "success" as MetricTone,
            queryPrompt: `${r.name} ${r.type}`,
          };
        }),
        ...armPolicies.slice(0, 10).map((p) => ({
          id: `${p.name}-${p.scope}`,
          label: p.name,
          sublabel: `${p.scope} · ${p.effect}`,
          badge: p.compliance,
          tone: (p.compliance === "NonCompliant" ? "critical" : "success") as MetricTone,
          queryPrompt: p.name,
        })),
      ],
    },
    {
      id: "regional-quotas",
      title: "Azure Regional Compute Quotas",
      source: regionalQuotas?.source ?? (dataMode === "real-tenant" ? "live-azure" : "seeded-manifest"),
      count: quotas.length,
      items: quotas.slice(0, 15).map((q) => ({
        id: `${q.region}-${q.resource}`,
        label: q.resource,
        sublabel: `${q.usage} · ${q.headroom}`,
        badge: q.utilization,
        tone: (q.status === "Critical" ? "critical" : q.status === "Warning" ? "warning" : "success") as MetricTone,
        queryPrompt: `${q.resource} quota in ${q.region}`,
      })),
    },
  ];

  if (workloadIdentity?.data) {
    const w = workloadIdentity.data;
    categories.splice(4, 0, {
      id: "workload-identities",
      title: "Workload Identities & Enterprise Apps",
      source: workloadIdentity.source,
      count: 1,
      items: [
        {
          id: w.spn.appId,
          label: w.spn.displayName,
          sublabel: `AppId ${w.spn.appId} · Owner: ${w.owner.upn}`,
          badge: w.passwordCredential.expired ? "Secret Expired" : "Active",
          tone: w.passwordCredential.expired ? "critical" : "success",
          queryPrompt: `${w.spn.displayName} workload identity posture`,
        },
      ],
    });
  }

  return {
    dataMode,
    tenant: {
      tenantId,
      displayName: erp.tenant.displayName,
      verifiedDomain: erp.tenant.verifiedDomain,
      entraTenantId: erp.tenant.entraTenantId,
    },
    sourcesUsed,
    fallbackReasons,
    summary: {
      users: users.length,
      groups: groups.length,
      skuPools: skuPools.length,
      caPolicies: policies.length,
      signInEvents: signInList.length,
      intuneDevices: devices.length,
      azureResources: resources.length,
      azurePolicies: armPolicies.length,
    },
    categories,
    gatheredAt: new Date().toISOString(),
  };
}

export interface SpawnFreeRoamInput {
  prompt: string;
  refinementText?: string;
  scope?: "hybrid" | "tenant-only" | "knowledge";
  viewMode?: ContextViewMode;
  tenantId?: string;
}

const FREE_ROAM_KNOWLEDGE_PROMPT = `You are ContextPane's Principal Cloud, Identity & Security Architect (muse-wonder-1.0) operating in Free-Roam Knowledge & Telemetry Explorer mode.
The operator typed an open-ended query on the Free-Roam Landing Page to spawn a rich interactive ContextualMiniDashboard.
You may receive live tenant MCP telemetry AND/OR an architectural, security, protocol, error-code, or cloud operations question.
Call compose_contextual_mini_dashboard exactly once.
CRITICAL RULES:
1. Tailor the title, subtitle, columns, synthesizedRows (5-7 rich, concrete, domain-accurate rows), kpis (4 high-signal KPIs), breakdown (3-5 distribution bars), and suggestedAction (a real, runnable PowerShell 7 / Microsoft.Graph / Az CLI / KQL diagnostic or remediation command) directly to the user's prompt.
2. When scope is "tenant-only" and live MCP data is provided, ground every row strictly in the live MCP tenant data.
3. When scope is "knowledge" or "hybrid" and the query asks about architecture, protocols, security patterns, error codes, or comparisons, synthesize a comprehensive reference matrix in synthesizedRows with concrete technical specifics (RFC/OIDC claims, registry paths, CSP URIs, Entra/ARM APIs, port numbers, or architectural trade-offs).`;

function buildDeterministicFreeRoamKnowledgeCard(
  prompt: string,
  refinementText: string | undefined,
  viewMode: ContextViewMode | undefined,
  hash: string,
  ptr: string,
  dataMode: McpDataMode,
  scope: "hybrid" | "tenant-only" | "knowledge",
): ContextualMiniDashboard {
  const combined = `${prompt} ${refinementText ?? ""}`.trim();
  const lower = combined.toLowerCase();

  // Check if an error code from ERROR_CODE_ENCYCLOPEDIA is mentioned
  const matchedErrorCode = Object.keys(ERROR_CODE_ENCYCLOPEDIA).find((code) =>
    lower.includes(code.toLowerCase()),
  );
  const errorCodeReference = matchedErrorCode ? ERROR_CODE_ENCYCLOPEDIA[matchedErrorCode] : undefined;

  if (scope === "tenant-only" && dataMode === "real-tenant") {
    const columns: MiniDashboardColumn[] = [
      { key: "dataset", label: "MCP Dataset", mono: true },
      { key: "mode", label: "Data Mode", isBadge: true },
      { key: "status", label: "Query Status" },
      { key: "detail", label: "Live Tenant Observation" },
    ];
    const rows = [
      {
        dataset: "msgraph / azure-arm",
        mode: "real-tenant",
        status: "0 exact row matches",
        detail: `No objects in the authenticated tenant matched "${prompt.slice(0, 80)}". Zero simulated fallback data was injected.`,
      },
    ];
    return ContextualMiniDashboardSchema.parse({
      id: `freeroam-${hash}`,
      selectionText: prompt.slice(0, 120),
      ...(refinementText ? { refinementText: refinementText.slice(0, 160) } : {}),
      viewMode: viewMode ?? "dashboard",
      title: `Real Tenant Query · ${prompt.slice(0, 64)}`.slice(0, 90),
      subtitle: "Strict Real-Tenant MCP Mode · Zero simulated fallback",
      sourceQuery: `MCP Real-Tenant Query: "${prompt.slice(0, 80)}"`,
      kpis: [
        { label: "Data Mode", value: "Real Tenant", tone: "success" },
        { label: "Simulated Fallback", value: "Disabled", tone: "success" },
        { label: "Matched Rows", value: "0", tone: "warning" },
      ],
      breakdown: [
        { label: "Live Tenant Objects", count: 0, pct: 0, tone: "default" },
        { label: "Simulated Objects", count: 0, pct: 0, tone: "success" },
      ],
      columns,
      rows,
      rowsPtr: ptr,
      provenanceCategory: "selection",
      suggestedAction: {
        label: "Query Live Tenant via Graph",
        scriptPreview: `Get-MgContext | Select-Object TenantId, Account, Scopes\nGet-MgUser -Top 25 | Select-Object DisplayName, UserPrincipalName, AccountEnabled`,
      },
      ...(errorCodeReference ? { errorCodeReference } : {}),
    });
  }

  // Synthesize rich domain knowledge rows based on the query topic
  const isZeroTrustOrCa = /zero\s*trust|conditional\s*access|token\s*protection|cae|continuous\s*access|break[-\s]?glass|mfa|phish/i.test(lower);
  const isNetworkingOrAzure = /private\s*link|service\s*endpoint|nsg|firewall|vnet|expressroute|bastion|dns|front\s*door|avd|rdp/i.test(lower);
  const isIdentityOrOidc = /oidc|federated|workload\s*identity|kerberos|saml|oauth|app\s*reg|service\s*principal|spn|secret/i.test(lower);

  const columns: MiniDashboardColumn[] = [
    { key: "dimension", label: "Component / Vector", mono: true },
    { key: "posture", label: "Classification", isBadge: true },
    { key: "mechanism", label: "Control Plane / Protocol Mechanism" },
    { key: "verification", label: "Telemetry / Audit Signal", mono: true },
    { key: "recommendation", label: "Principal Architect Guidance" },
  ];

  const rows: Array<Record<string, string | number | boolean | null>> = isZeroTrustOrCa
    ? [
        {
          dimension: "Phishing-Resistant MFA (FIDO2 / WHfB)",
          posture: "Critical Control",
          mechanism: "Enforces cryptographic authentication strength (00000000-0000-0000-0000-000000000004) resistant to AiTM proxy replay",
          verification: "authenticationRequirement == 'multiFactorAuthentication'",
          recommendation: "Require phishing-resistant strength for all privileged directory roles and Azure Management plane",
        },
        {
          dimension: "Continuous Access Evaluation (CAE)",
          posture: "Real-Time Enforcement",
          mechanism: "Near-real-time revocation of access tokens upon user disable, password reset, or IP location shift",
          verification: "isContinuousAccessEvaluation == true",
          recommendation: "Enable Strict Location enforcement and avoid legacy token lifetime overrides that bypass CAE",
        },
        {
          dimension: "Token Protection (Sign-In Session Binding)",
          posture: "Preview / High Security",
          mechanism: "Cryptographically binds PRT and refresh tokens to the endpoint TPM so stolen tokens fail replay elsewhere",
          verification: "sessionControls.signInTokenProtection",
          recommendation: "Deploy in report-only first for Windows 11 Intune-enrolled endpoints accessing Exchange/SharePoint",
        },
        {
          dimension: "Emergency Break-Glass Exclusions",
          posture: "Resilience Invariant",
          mechanism: "Cloud-only *.onmicrosoft.com accounts excluded from all CA policies and bound to FIDO2 hardware keys",
          verification: "conditions.users.excludeGroups contains SG-BreakGlass",
          recommendation: "Maintain 2 break-glass accounts excluded from every CA policy with Azure Monitor alert rules on sign-in",
        },
      ]
    : isNetworkingOrAzure
      ? [
          {
            dimension: "Azure Private Link (Private Endpoint)",
            posture: "Zero-Trust Network",
            mechanism: "Projects a private NIC from your VNet subnet into the PaaS resource via privatelink.* DNS zone",
            verification: "publicNetworkAccess == 'Disabled'",
            recommendation: "Use Private Endpoints + Private DNS Zones for Key Vault, Storage, and SQL to eliminate data exfiltration risk",
          },
          {
            dimension: "VNet Service Endpoints",
            posture: "Legacy Perimeter",
            mechanism: "Extends VNet identity to the PaaS public endpoint over Azure backbone; PaaS public IP remains reachable",
            verification: "virtualNetworkRules.state == 'Succeeded'",
            recommendation: "Migrate sensitive workloads from Service Endpoints to Private Link to block cross-tenant exfiltration",
          },
          {
            dimension: "AVD Reverse Connect vs RDP 3389",
            posture: "Attack Surface Reduction",
            mechanism: "Session hosts initiate outbound TLS 443 to AVD broker (*.wvd.microsoft.com); zero inbound ports required",
            verification: "NSG DenyTcp3389FromInternet == Allow/Deny",
            recommendation: "Close inbound TCP/UDP 3389 on all session host NSGs; enforce Azure Bastion or Reverse Connect only",
          },
          {
            dimension: "Azure Policy Guardrails (Deny / DeployIfNotExists)",
            posture: "Governance",
            mechanism: "Evaluates ARM PUT/PATCH payloads at control-plane admission before resource provisioning completes",
            verification: "Microsoft.PolicyInsights/policyStates",
            recommendation: "Enforce Deny on public IPs and open management ports at the management-group scope",
          },
        ]
      : isIdentityOrOidc
        ? [
            {
              dimension: "Workload Identity Federation (OIDC)",
              posture: "Zero Shared Secrets",
              mechanism: "Exchanges external IdP JWT (iss + sub + aud) for short-lived Entra access token without client secrets",
              verification: "applications/{id}/federatedIdentityCredentials",
              recommendation: "Match exact 'sub' claim (e.g. repo:org/repo:environment:prod) and retire all passwordCredentials",
            },
            {
              dimension: "Static Client Secrets (passwordCredentials)",
              posture: "High Risk / Expiry Drift",
              mechanism: "Long-lived symmetric secret stored in CI/CD variables; causes AADSTS7000222 outages upon expiration",
              verification: "passwordCredentials.endDateTime < UtcNow",
              recommendation: "Audit all service principals for expiring passwordCredentials and migrate pipelines to OIDC",
            },
            {
              dimension: "Application vs Delegated Graph Scopes",
              posture: "Least Privilege",
              mechanism: "App roles (appRoleAssignments) act tenant-wide without a signed-in user; Directory.ReadWrite.All is Tier-0 equivalent",
              verification: "servicePrincipals/{id}/appRoleAssignments",
              recommendation: "Replace broad Directory.ReadWrite.All with scoped roles or Administrative Unit restricted management",
            },
            {
              dimension: "Shadow-Admin Application Owners",
              posture: "Privilege Escalation Vector",
              mechanism: "Non-admin user listed as Application Owner can add credentials to a privileged Service Principal",
              verification: "applications/{id}/owners?$select=userPrincipalName",
              recommendation: "Remove standard users from privileged app ownership; govern changes via PIM for Groups",
            },
          ]
        : [
            {
              dimension: `Primary Scope · ${prompt.slice(0, 48)}`,
              posture: "Active Analysis",
              mechanism: "Correlated across Entra ID control plane, Intune MDM compliance, and Azure ARM resource graph",
              verification: "GET /v1.0/auditLogs/directoryAudits",
              recommendation: "Verify live tenant state via Microsoft Graph PowerShell and compare against golden baseline",
            },
            {
              dimension: "Identity & Access Posture",
              posture: "Enforced",
              mechanism: "Evaluates group-based licensing, Conditional Access grant controls, and workload identity credentials",
              verification: "Get-MgIdentityConditionalAccessPolicy -All",
              recommendation: "Ensure all policies exclude emergency break-glass accounts and avoid unbounded admin consents",
            },
            {
              dimension: "Device & Endpoint Compliance",
              posture: "Monitored",
              mechanism: "Checks Intune Settings Catalog vs legacy OMA-URI conflicts and BitLocker escrow status",
              verification: "Get-MgDeviceManagementManagedDevice",
              recommendation: "Eliminate duplicate Device Configuration profiles that cause 0x87D1FDE8 conflict states",
            },
            {
              dimension: "Infrastructure & Policy Guardrails",
              posture: "Baseline",
              mechanism: "Audits ARM resource locks, NSG security rules, and regional vCPU quota utilization",
              verification: "Get-AzPolicyState -Summary",
              recommendation: "Stage all infrastructure mutations via Terraform PR with What-If pre-flight verification",
            },
          ];

  const kpis: MiniDashboardKpi[] = [
    { label: "Explorer Mode", value: scope === "knowledge" ? "Knowledge Base" : "Hybrid MCP + AI", tone: "success" },
    { label: "Data Mode", value: dataMode === "real-tenant" ? "Real Tenant" : "Simulated Lab", tone: dataMode === "real-tenant" ? "success" : "default" },
    { label: "Analyzed Vectors", value: String(rows.length), tone: "default" },
    { label: "Action Ready", value: "PowerShell 7", tone: "success" },
  ];

  const breakdown: MiniDashboardBreakdown[] = [
    { label: "Identity & Access", count: 2, pct: 50, tone: "warning" },
    { label: "Endpoint & Network", count: 1, pct: 25, tone: "default" },
    { label: "Governance & Guardrails", count: 1, pct: 25, tone: "success" },
  ];

  return ContextualMiniDashboardSchema.parse({
    id: `freeroam-${hash}`,
    selectionText: prompt.slice(0, 120),
    ...(refinementText ? { refinementText: refinementText.slice(0, 160) } : {}),
    viewMode: viewMode ?? "dashboard",
    title: `Free-Roam Explorer · ${prompt.slice(0, 64)}`.slice(0, 90),
    subtitle: `Synthesized ${scope} lens · ${rows.length} architectural & telemetry vectors`.slice(0, 160),
    sourceQuery: `Free-Roam Query (${scope}): "${prompt.slice(0, 90)}"`,
    kpis,
    breakdown,
    columns,
    rows,
    rowsPtr: ptr,
    provenanceCategory: "selection",
    suggestedAction: {
      label: "Run Diagnostic Inspection",
      scriptPreview: isZeroTrustOrCa
        ? `Get-MgIdentityConditionalAccessPolicy -All | Select-Object Id, DisplayName, State, @{n='Grant';e={$_.GrantControls.BuiltInControls}}, @{n='ExcludeGroups';e={$_.Conditions.Users.ExcludeGroups}}`
        : isNetworkingOrAzure
          ? `Get-AzNetworkSecurityGroup | Select-Object Name, ResourceGroupName, @{n='OpenRules';e={($_.SecurityRules | Where-Object { $_.Access -eq 'Allow' -and $_.Direction -eq 'Inbound' }).Name -join ', '}}`
          : `Get-MgServicePrincipal -Top 25 | Select-Object DisplayName, AppId, ServicePrincipalType`,
    },
    ...(errorCodeReference ? { errorCodeReference } : {}),
  });
}

export async function spawnFreeRoamDashboard(input: SpawnFreeRoamInput): Promise<ExploreResult> {
  const started = performance.now();
  const prompt = input.prompt.replace(/\s+/g, " ").trim();
  if (prompt.length < 2) {
    throw new Error("Prompt must be at least 2 characters");
  }
  const scope = input.scope ?? "hybrid";
  const dataMode = sources.getDataMode();
  const tenantId: TenantId =
    input.tenantId && input.tenantId in TENANT_REGISTRY ? (input.tenantId as TenantId) : "tenant-contoso-01";

  // When scope is "hybrid" or "tenant-only", check if the prompt matches live MCP datasets first
  if (scope !== "knowledge") {
    const explored = await exploreSelection({
      scenarioId: "FREE-ROAM",
      selectedText: prompt,
      ...(input.refinementText ? { refinementText: input.refinementText } : {}),
      ...(input.viewMode ? { viewMode: input.viewMode } : {}),
    });

    // If it matched a real dataset in MCP, return it directly!
    if (explored.slice.matchedBy !== "none") {
      return explored;
    }
  }

  const isTenantInventoryQuestion =
    scope === "tenant-only" ||
    (dataMode === "real-tenant" &&
      scope !== "knowledge" &&
      /\b(what|which|list|show)\b.*\b(do we have|in our tenant|deployed|provisioned|exist)\b|\bour\s+(vms?|resources?|users?|groups?|policies|subscriptions?)\b/i.test(
        prompt,
      ));
  const effectiveScope = isTenantInventoryQuestion ? "tenant-only" : scope;

  // Otherwise compose a Free-Roam Knowledge / Hybrid dashboard
  const requestId = telemetry.nextRequestId("t1s");
  const hash = selectionHash("freeroam", prompt, input.refinementText, input.viewMode);
  const ptr = selectionDataPtr("freeroam", hash);
  let rowsSynthesized = false;
  const fallbackCard = buildDeterministicFreeRoamKnowledgeCard(
    prompt,
    input.refinementText,
    input.viewMode,
    hash,
    ptr,
    dataMode,
    effectiveScope,
  );
  publishSelection({
    ptr,
    scenarioId: "freeroam",
    selectedText: prompt,
    sourceQuery: fallbackCard.sourceQuery,
    rows: fallbackCard.rows,
  });

  let card = fallbackCard;
  let usage: TokenUsage = ZERO_USAGE;
  let provider: RouterTelemetry["provider"] = "local";
  let modelId = "deterministic-freeroam-synthesizer";
  let chain: RouterTelemetry["fallbackChain"] = [];

  const steps: ChainStep[] = [
    { provider: "meta", modelId: models.metaWonder, hasKey: providers.meta.hasKey, tier: "Tier 1B" },
    { provider: "meta", modelId: models.metaCatalog, hasKey: providers.meta.hasKey, tier: "Tier 1B" },
  ];

  if (!config.forceLocal && steps.some((s) => s.hasKey) && !(effectiveScope === "tenant-only" && dataMode === "real-tenant")) {
    const inventory = scope === "knowledge" ? null : await getFreeRoamInventory(tenantId).catch(() => null);
    const baseTool = getComposeMiniDashboardToolDefinition();
    const baseParams = baseTool.function.parameters as Record<string, unknown>;
    const baseProps = (baseParams.properties as Record<string, unknown>) ?? {};
    const baseReq = Array.isArray(baseParams.required) ? (baseParams.required as string[]) : [];
    const tool = {
      ...baseTool,
      function: {
        ...baseTool.function,
        parameters: {
          ...baseParams,
          required: [...new Set([...baseReq, "synthesizedRows"])],
          properties: {
            ...baseProps,
            synthesizedRows: {
              type: "array",
              description: "Provide 5-7 concrete, domain-accurate rows whose keys exactly match the keys in columns.",
              items: { type: "object" },
            },
          },
        },
      },
    };

    const payload = {
      mode: "free-roam-explorer",
      scope,
      dataMode,
      prompt,
      ...(input.refinementText ? { refinementText: input.refinementText } : {}),
      ...(input.viewMode ? { viewMode: input.viewMode } : {}),
      ...(inventory
        ? {
            tenantSummary: inventory.summary,
            tenantDomain: inventory.tenant.verifiedDomain,
            sampleEntities: inventory.categories.map((c) => ({
              category: c.title,
              count: c.count,
              sample: c.items.slice(0, 5).map((i) => `${i.label} (${i.badge})`),
            })),
          }
        : {}),
      descriptor: {
        dataPtr: ptr,
        matchedBy: "none",
        instruction: "Compose a rich ContextualMiniDashboard with bespoke columns, synthesizedRows (5-7 rows), 4 kpis, breakdown, and a concrete PowerShell 7 / Azure CLI suggestedAction.",
      },
    };

    const outcome = await runChain(steps, async (step) => {
      const result = await chatWithForcedTool(
        providers.meta,
        step.modelId,
        [
          { role: "system", content: FREE_ROAM_KNOWLEDGE_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
        tool,
        { timeoutMs: config.timeouts.exploreMs, temperature: 0.15, maxTokens: 2800, reasoningEffort: config.reasoning.catalog },
      );
      const rawArgs = parseToolArguments(result.argumentsRaw) as Record<string, unknown>;
      const synthesizedRowsRaw = Array.isArray(rawArgs?.synthesizedRows)
        ? (rawArgs.synthesizedRows as Array<Record<string, unknown>>)
        : null;
      const parsed = ContextualMiniDashboardModelArgsSchema.safeParse(rawArgs);
      if (!parsed.success) throw new InvalidSchemaError("free-roam mini-dashboard failed validation", formatIssues(parsed.error));
      const args = parsed.data;
      const sanitizedRows =
        synthesizedRowsRaw && synthesizedRowsRaw.length > 0
          ? synthesizedRowsRaw.slice(0, 12).map((r) => {
              const clean: Record<string, string | number | boolean | null> = {};
              for (const [k, v] of Object.entries(r)) {
                if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
                  clean[k] = v;
                } else if (v !== undefined) {
                  clean[k] = String(v);
                }
              }
              return clean;
            })
          : fallbackCard.rows;

      publishSelection({
        ptr,
        scenarioId: "freeroam",
        selectedText: prompt,
        sourceQuery: args.sourceQuery,
        rows: sanitizedRows,
      });

      const composed = ContextualMiniDashboardSchema.parse({
        ...fallbackCard,
        title: args.title,
        subtitle: args.subtitle,
        sourceQuery: args.sourceQuery,
        kpis: args.kpis,
        breakdown: args.breakdown,
        columns: args.columns.length ? args.columns : fallbackCard.columns,
        suggestedAction: args.suggestedAction,
        ...(fallbackCard.errorCodeReference ? { errorCodeReference: fallbackCard.errorCodeReference } : {}),
        rows: sanitizedRows,
        rowsPtr: ptr,
      });
      return { card: composed, usage: result.usage, synthesized: Boolean(synthesizedRowsRaw?.length) };
    });

    chain = outcome.chain;
    if (outcome.result && outcome.winner) {
      card = outcome.result.card;
      usage = outcome.result.usage;
      rowsSynthesized = outcome.result.synthesized;
      provider = outcome.winner.provider;
      modelId = outcome.winner.modelId;
    }
  }

  const latencyMs = Math.round(performance.now() - started);
  const pub = publishSelection({
    ptr,
    scenarioId: "freeroam",
    selectedText: prompt,
    sourceQuery: card.sourceQuery,
    rows: card.rows,
  });
  const event = telemetry.record({
    requestId,
    endpoint: "/api/free-roam/spawn",
    tier: "Tier 1B",
    provider,
    modelId,
    latencyMs,
    tokensUsed: usage,
    fallbackChain: chain,
    tenantId,
  });

  return {
    card,
    dataPtr: ptr,
    latencyMs,
    tier: "Tier 1B",
    modelId,
    provider,
    tokenCount: usage.total,
    slice: {
      kind: "entra-users",
      matchedBy: "none",
      rowCount: card.rows.length,
      searched: [],
      // Knowledge lenses are not tenant data: rows are the model's or the deterministic knowledge card's.
      dataSource: rowsSynthesized ? "model-synthesized" : "deterministic-knowledge",
    },
    descriptor: pub.descriptor,
    telemetry: event,
  };
}

/**
 * The coder model sometimes names an affected entity `user`, `app` or `subscription`; the drawer schema
 * only knows the catalog's entity types, so an unknown one would fail the whole staging. Map it instead.
 */
export interface StageFreeRoamRemediationInput {
  prompt: string;
  title?: string;
  scriptPreview?: string;
  tenantId?: string;
}

export async function stageFreeRoamRemediation(
  input: StageFreeRoamRemediationInput,
  onProgress?: ProgressSink,
): Promise<{ drawer: ActionApprovalDrawer; telemetry: RouterTelemetry }> {
  const started = performance.now();
  // Same stage ids as /api/remediate, so the rail ticker and the streamed script reveal apply (WP8).
  const report = progressReporter(onProgress);
  const requestId = telemetry.nextRequestId("t3");
  const tenantId: TenantId =
    input.tenantId && input.tenantId in TENANT_REGISTRY ? (input.tenantId as TenantId) : "tenant-contoso-01";
  const erp = await sources.erp.getTenantContext(tenantId);
  const remediationId = `rem-freeroam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  // Its own id, never INC-4092: a Free-Roam action must not inherit a scenario's drawer, rollback or lab write (audit H-05).
  const actionId = `FREE-${createHash("sha256").update(`${tenantId}|${input.prompt}|${remediationId}`).digest("hex").slice(0, 8).toUpperCase()}`;

  const title = input.title?.trim() || `Free-Roam Action · ${input.prompt.slice(0, 64)}`;
  report("code:start", `Writing PowerShell 7 and IaC for ${actionId}`);
  const synthesized = await synthesizeCustomRemediation({
    scenarioId: actionId,
    ticketTitle: title,
    ticketBody: input.scriptPreview
      ? `${input.prompt}\n\nSuggested PowerShell snippet:\n${input.scriptPreview}`
      : input.prompt,
  });

  const powershellScript = synthesized.powershellScript;
  report(synthesized._meta?.source === "llm" ? "code:done" : "code:fallback", synthesized._meta?.source === "llm" ? "Model bundle accepted" : "Coder unavailable → deterministic bundle");
  report("bundle:ready", `Script ready (${powershellScript.split("\n").length} lines) · pre-flight next`, {
    powershellScript,
    terraformDiff: synthesized.terraformDiff ?? "",
  });
  report("preflight:start", "Local pre-flight: AST parse and -WhatIf guard");
  const localPreflight = await runLocalPreflight({
    powershellScript,
    terraformDiff: synthesized.terraformDiff ?? "",
    requiredCommands: synthesized.requiredCommands ?? [],
    actualHcl: "",
    expectedHcl: "",
  });
  const safety = checkWhatIfSafety(powershellScript);
  const astCheckPassed = localPreflight.astCheckPassed ?? true;
  const whatIfSafe = localPreflight.whatIfSafe && safety.safe;
  const allFindings = [
    ...localPreflight.findings,
    ...safety.unguarded.map((u) => `Unguarded mutation cmdlet: ${u}`),
  ];

  report("preflight:done", `Pre-flight ${astCheckPassed && whatIfSafe ? "passed" : `flagged ${allFindings.length} finding(s)`}`, { astCheckPassed, whatIfSafe });
  const latencyMs = Math.round(performance.now() - started);
  const meta = synthesized._meta ?? {
    modelUsed: "deterministic",
    latencyMs: 1,
    tokensUsed: 0,
    status: "fallback" as const,
    source: "fallback-on-error" as const,
  };
  const usedLlm = meta.source === "llm";
  const provider: RouterTelemetry["provider"] = usedLlm ? "meta" : "local";

  const drawer = ActionApprovalDrawerSchema.parse({
    remediationId,
    ticketId: actionId,
    tenantId,
    title: (synthesized.title || title).slice(0, 120),
    summary: synthesized.summary.slice(0, 600),
    synthesizedBy: {
      planner: usedLlm ? meta.modelUsed : "deterministic",
      coder: usedLlm ? meta.modelUsed : "deterministic",
      provider,
    },
    powershellScript,
    terraformDiff: synthesized.terraformDiff ?? "",
    graphPatch: synthesized.graphPatch ?? "{}",
    affectedEntities:
      synthesized.affectedEntities.length > 0
        ? synthesized.affectedEntities.slice(0, 20).map(coerceAffectedEntityType)
        : [
            {
              type: "group",
              id: erp.tenant.verifiedDomain,
              change: `Free-Roam staged action on ${erp.tenant.displayName}`,
            },
          ],
    verificationStatus: {
      verdict: astCheckPassed && whatIfSafe ? "Verified Safe" : "Verified With Warnings",
      astCheckPassed,
      terraformFmtPassed: synthesized.terraformDiff ? localPreflight.terraformFmtPassed : null,
      terraformValidatePassed: synthesized.terraformDiff ? localPreflight.terraformValidatePassed : null,
      sandboxProvider: localPreflight.sandboxProvider,
      validationLatencyMs: localPreflight.validationLatencyMs,
      whatIfSafe,
      findings: allFindings.slice(0, 12),
    },
    staging: null,
    approval: {
      state: "pending",
      requiredIdentity: config.lab.delegatedIdentity,
      approvedBy: null,
      approvedAt: null,
    },
    providerTelemetry: {
      tier: "Tier 3B",
      provider,
      modelId: meta.modelUsed,
      latencyMs,
      tokensUsed: meta.tokensUsed,
    },
  });

  remediationStore.save(drawer);

  const event = telemetry.record({
    requestId,
    endpoint: "/api/free-roam/remediate",
    tier: "Tier 3B",
    provider,
    modelId: meta.modelUsed,
    latencyMs,
    tokensUsed: { prompt: 0, completion: 0, total: meta.tokensUsed },
    fallbackChain: [],
    tenantId,
  });

  return { drawer, telemetry: event };
}

export interface AnomalyScanResult {
  dataMode: McpDataMode;
  scannedAt: string;
  detectedCount: number;
  newlyRegistered: ScenarioListItem[];
  findings: Array<{
    id: string;
    category: string;
    severity: "critical" | "warning";
    title: string;
    detail: string;
    source: string;
  }>;
}

export async function scanTenantForAnomalies(tenantIdInput?: string): Promise<AnomalyScanResult> {
  const tenantId: TenantId =
    tenantIdInput && tenantIdInput in TENANT_REGISTRY ? (tenantIdInput as TenantId) : "tenant-contoso-01";
  const tenant = TENANT_REGISTRY[tenantId];
  const dataMode = sources.getDataMode();

  const [license, caPolicies, caPosture, workloadIdentity, intune, nsgDrift] = await Promise.all([
    sources.msgraph.getLicenseInventory(tenantId).catch(() => null),
    sources.msgraph.getConditionalAccessPolicies(tenantId).catch(() => null),
    sources.msgraph.getCaPosture(tenantId).catch(() => null),
    sources.msgraph.getWorkloadIdentityPosture(tenantId).catch(() => null),
    sources.msgraph.getIntuneDrift("INC-4099").catch(() => null),
    sources.azure.getNsgDrift(tenantId).catch(() => null),
  ]);

  const findings: AnomalyScanResult["findings"] = [];
  const newlyRegistered: ScenarioListItem[] = [];
  const existingTitles = new Set(listCustomScenarios().map((s) => s.title.toLowerCase()));

  // 1. Check disabled users holding licenses or group license errors
  if (license?.data) {
    const disabledWithLicense = license.data.users.filter((u) => !u.accountEnabled && u.currentSku);
    const errCount = license.data.groupErrors.length;
    if (disabledWithLicense.length > 0 || errCount > 0) {
      const title = `Live Anomaly: ${disabledWithLicense.length} disabled account(s) holding ${license.data.sku.skuPartNumber} seats (${errCount} group errors)`;
      const detail = `Detected via MCP (${license.source}): Disabled accounts [${disabledWithLicense.map((u) => u.upn).join(", ") || "none"}] hold active ${license.data.sku.skuPartNumber} licenses in ${license.data.groupName}, with ${errCount} group assignment errors.`;
      findings.push({
        id: "scan-lic-drift",
        category: "Entra Licensing",
        severity: errCount > 0 ? "critical" : "warning",
        title,
        detail,
        source: license.source,
      });
      if (!existingTitles.has(title.toLowerCase())) {
        const entry = registerCustomTicket(
          { title, body: detail, customerName: tenant.displayName },
          { origin: "anomaly" },
        );
        newlyRegistered.push(customScenarioListItem(entry, false));
      }
    }
  }

  // 2. Check Conditional Access report-only or missing break-glass exclusions
  const policies = caPolicies?.data ?? [];
  const reportOnlyPolicies = policies.filter((p) => p.state === "enabledForReportingButNotEnforced");
  const driftedPosture = caPosture?.data.policies.filter((p) => p.drift.length > 0) ?? [];
  if (reportOnlyPolicies.length > 0 || driftedPosture.length > 0) {
    const names = [
      ...reportOnlyPolicies.map((p) => p.displayName),
      ...driftedPosture.map((p) => p.displayName),
    ];
    const uniqueNames = [...new Set(names)];
    const title = `Live Anomaly: ${uniqueNames.length} Conditional Access policy posture drift (${uniqueNames.slice(0, 2).join(", ")})`;
    const detail = `Detected via MCP (${caPolicies?.source ?? caPosture?.source ?? "live-graph"}): Conditional Access policies [${uniqueNames.join(", ")}] are stuck in report-only state or missing emergency break-glass exclusions.`;
    findings.push({
      id: "scan-ca-posture",
      category: "Conditional Access",
      severity: "critical",
      title,
      detail,
      source: caPolicies?.source ?? caPosture?.source ?? "live-graph",
    });
    if (!existingTitles.has(title.toLowerCase())) {
      const entry = registerCustomTicket(
        { title, body: detail, customerName: tenant.displayName },
        { origin: "anomaly" },
      );
      newlyRegistered.push(customScenarioListItem(entry, false));
    }
  }

  // 3. Check Workload Identity expired secrets
  if (workloadIdentity?.data && workloadIdentity.data.passwordCredential.expired) {
    const w = workloadIdentity.data;
    const title = `Live Anomaly: Expired client secret on ${w.spn.displayName} (${w.errorCodeLabel})`;
    const detail = `Detected via MCP (${workloadIdentity.source}): Service Principal ${w.spn.displayName} (${w.spn.appId}) has an expired client secret (${w.passwordCredential.displayName}) and non-admin owner ${w.owner.upn}.`;
    findings.push({
      id: "scan-workload-id",
      category: "Workload Identity",
      severity: "critical",
      title,
      detail,
      source: workloadIdentity.source,
    });
    if (!existingTitles.has(title.toLowerCase())) {
      const entry = registerCustomTicket(
        { title, body: detail, customerName: tenant.displayName },
        { origin: "anomaly" },
      );
      newlyRegistered.push(customScenarioListItem(entry, false));
    }
  }

  // 4. Check Intune non-compliant / conflicting devices
  if (intune?.data) {
    const nonCompliant = intune.data.devices.filter((d) => d.complianceState !== "Compliant");
    if (nonCompliant.length > 0) {
      const title = `Live Anomaly: ${nonCompliant.length} Intune endpoint(s) in NonCompliant/Conflict state`;
      const detail = `Detected via MCP (${intune.source}): Endpoints [${nonCompliant.map((d) => `${d.deviceName} (${d.complianceState})`).join(", ")}] have compliance or settings catalog drift.`;
      findings.push({
        id: "scan-intune-drift",
        category: "Intune MDM",
        severity: "warning",
        title,
        detail,
        source: intune.source,
      });
      if (!existingTitles.has(title.toLowerCase())) {
        const entry = registerCustomTicket(
          { title, body: detail, customerName: tenant.displayName },
          { origin: "anomaly" },
        );
        newlyRegistered.push(customScenarioListItem(entry, false));
      }
    }
  }

  // 5. Check Azure NSG drift
  if (nsgDrift?.data && nsgDrift.data.rogueSecurityRules.length > 0) {
    const d = nsgDrift.data;
    const title = `Live Anomaly: NSG drift on ${d.resourceName} (${d.rogueSecurityRules.map((r) => r.ruleName).join(", ")})`;
    const detail = `Detected via MCP (${nsgDrift.source}): Network Security Group ${d.resourceName} in ${d.resourceGroup} has ${d.rogueSecurityRules.length} rogue rule(s) against Terraform baseline ${d.terraformFile}.`;
    findings.push({
      id: "scan-nsg-drift",
      category: "Azure Network Security",
      severity: "warning",
      title,
      detail,
      source: nsgDrift.source,
    });
    if (!existingTitles.has(title.toLowerCase())) {
      const entry = registerCustomTicket(
        { title, body: detail, customerName: tenant.displayName },
        { origin: "anomaly" },
      );
      newlyRegistered.push(customScenarioListItem(entry, false));
    }
  }

  return {
    dataMode,
    scannedAt: new Date().toISOString(),
    detectedCount: findings.length,
    newlyRegistered,
    findings,
  };
}
