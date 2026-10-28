import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { AzurePolicyState, HostPool, RogueSecurityRule, Severity, SourceRef, TagDrift } from "@contextpane/catalog";
import { parseNsgResources, renderNsgHcl, ruleSignature, type NsgRule, type NsgState, type ParsedNsg } from "./hcl.ts";
import { deleteNsgRuleLive, fetchAzContextLive, fetchNsgLive, patchNsgTagsLive, putNsgRuleLive } from "./live.ts";
import { getManifestAzure, getManifestTenant, isLiveCloudMode, resolveIacDir, type ManifestAzureEstate, type ManifestAzureTenant } from "./shared.ts";

export type IacSource = "live-azure" | "seeded-manifest";

export interface IacResult<T> {
  source: IacSource;
  liveCloudMode: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  latencyMs: number;
  data: T;
}

const LIVE_CAPABLE_TENANTS = new Set(["tenant-contoso-01"]);
const LIVE_TIMEOUT_MS = Number.parseInt(process.env.CTX_AZ_TIMEOUT_MS ?? "25000", 10);
/** One ARM write including its long-running operation (NSG rule PUT/DELETE take a few seconds). */
const WRITE_TIMEOUT_MS = 60_000;

async function withSource<T>(tenantId: string, live: () => Promise<T>, fallback: () => T): Promise<IacResult<T>> {
  const started = performance.now();
  const liveMode = isLiveCloudMode();
  const done = (data: T, source: IacSource, fallbackReason?: string): IacResult<T> => ({
    source,
    liveCloudMode: liveMode,
    ...(fallbackReason ? { fallbackReason } : {}),
    fetchedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    data,
  });
  if (!liveMode) return done(fallback(), "seeded-manifest");
  if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return done(fallback(), "seeded-manifest", `${tenantId} is manifest-only`);
  try {
    return done(await live(), "live-azure");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[mcp-azure-iac] live query failed for ${tenantId}, falling back to manifest: ${reason}`);
    return done(fallback(), "seeded-manifest", reason);
  }
}

/* -------------------------------------------------------------------------- */
/* Baseline                                                                    */
/* -------------------------------------------------------------------------- */

export interface TerraformBaseline {
  file: string;
  relativePath: string;
  content: string;
  nsg: ParsedNsg;
}

type AzureTenant = ManifestAzureTenant & { azure: ManifestAzureEstate };

export function getTerraformBaseline(tenant: AzureTenant): TerraformBaseline {
  const dir = resolveIacDir();
  const file = join(dir, tenant.azure.terraformFile);
  const content = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const nsg = parseNsgResources(content).find((n) => n.name === tenant.azure.nsg.name);
  if (!nsg) throw new Error(`NSG ${tenant.azure.nsg.name} not found in ${tenant.azure.terraformFile}`);
  return { file, relativePath: `demo-iac/${tenant.azure.terraformFile}`, content, nsg };
}

function manifestNsgState(tenant: AzureTenant): NsgState & { id: string } {
  return {
    id: tenant.azure.nsg.id,
    name: tenant.azure.nsg.name,
    resourceGroup: tenant.azure.resourceGroup,
    location: tenant.azure.location,
    tags: tenant.azure.nsg.tags,
    rules: tenant.azure.nsg.securityRules.map((r) => ({ ...r })),
  };
}

/* -------------------------------------------------------------------------- */
/* Drift                                                                       */
/* -------------------------------------------------------------------------- */

export interface NsgDrift {
  tenantId: string;
  resourceName: string;
  resourceGroup: string;
  resourceId: string;
  resourceType: string;
  location: string;
  subscriptionId: string;
  gitBranch: string;
  terraformFile: string;
  /** Where the drifted resource is declared: the NSG resource block in the .tf file. */
  sourceRef: SourceRef;
  driftState: "in-sync" | "drift-detected";
  tagDrift: TagDrift[];
  rogueSecurityRules: RogueSecurityRule[];
  modifiedSecurityRules: Array<{ ruleName: string; expected: NsgRule; actual: NsgRule }>;
  missingSecurityRules: string[];
  expectedHcl: string;
  actualHcl: string;
  hclDiff: string;
  summary: string;
  severity: Severity | "none";
}

const ADMIN_PORTS = new Set(["22", "3389", "5985", "5986", "*"]);
const ANY_SOURCE = new Set(["*", "Internet", "0.0.0.0/0", "any"]);

function classifyRogue(rule: NsgRule): { severity: Severity; reason: string } {
  const openSource = ANY_SOURCE.has(rule.sourceAddressPrefix);
  const adminPort = ADMIN_PORTS.has(rule.destinationPortRange);
  if (rule.direction === "Inbound" && rule.access === "Allow" && openSource && adminPort) {
    return { severity: "critical", reason: `Inbound ${rule.protocol} ${rule.destinationPortRange} allowed from ${rule.sourceAddressPrefix} (management port exposed to the internet)` };
  }
  if (rule.direction === "Inbound" && rule.access === "Allow" && openSource) {
    return { severity: "high", reason: `Inbound ${rule.protocol} ${rule.destinationPortRange} allowed from ${rule.sourceAddressPrefix}` };
  }
  if (rule.direction === "Inbound" && rule.access === "Allow") {
    return { severity: "medium", reason: "Inbound allow rule not present in Terraform" };
  }
  return { severity: "low", reason: "Rule not present in Terraform baseline" };
}

export function computeDrift(tenantId: string, tenant: AzureTenant, expected: ParsedNsg, actual: NsgState & { id?: string }, baselinePath: string): NsgDrift {
  const expectedByName = new Map(expected.rules.map((r) => [r.name, r]));
  const actualByName = new Map(actual.rules.map((r) => [r.name, r]));

  const rogue: RogueSecurityRule[] = [];
  const modified: NsgDrift["modifiedSecurityRules"] = [];
  for (const rule of actual.rules) {
    const exp = expectedByName.get(rule.name);
    if (!exp) {
      const { severity, reason } = classifyRogue(rule);
      rogue.push({
        ruleName: rule.name,
        priority: rule.priority,
        direction: rule.direction,
        access: rule.access,
        protocol: rule.protocol,
        port: rule.destinationPortRange,
        source: rule.sourceAddressPrefix,
        destination: rule.destinationAddressPrefix,
        severity,
        reason,
      });
    } else if (ruleSignature(exp) !== ruleSignature(rule)) {
      modified.push({ ruleName: rule.name, expected: exp, actual: rule });
    }
  }
  const missing = expected.rules.filter((r) => !actualByName.has(r.name)).map((r) => r.name);

  const tagKeys = new Set([...Object.keys(expected.tags), ...Object.keys(actual.tags)]);
  const tagDrift: TagDrift[] = [];
  for (const key of [...tagKeys].sort()) {
    const e = expected.tags[key] ?? null;
    const a = actual.tags[key] ?? null;
    if (e !== a) tagDrift.push({ key, expectedInTf: e, actualInAzure: a });
  }

  const expectedHcl = renderNsgHcl(expected, expected.terraformLabel);
  const actualHcl = renderNsgHcl({ ...actual, name: expected.name }, expected.terraformLabel);
  const hclDiff = createTwoFilesPatch(
    `azure-live/${actual.name}.tf`,
    baselinePath,
    actualHcl,
    expectedHcl,
    "live state (Azure)",
    "expected state (Terraform)",
    { context: 3 },
  );

  const hasDrift = rogue.length > 0 || modified.length > 0 || missing.length > 0 || tagDrift.length > 0;
  const severity: NsgDrift["severity"] = rogue.some((r) => r.severity === "critical")
    ? "critical"
    : rogue.some((r) => r.severity === "high") || missing.length > 0
      ? "high"
      : hasDrift
        ? "medium"
        : "none";

  const parts: string[] = [];
  if (rogue.length) {
    const ports = [...new Set(rogue.map((r) => `${r.protocol.toUpperCase()} ${r.port}`))].join(", ");
    parts.push(`${rogue.length} Rogue NSG Rule${rogue.length > 1 ? "s" : ""} on ${ports}`);
  }
  if (modified.length) parts.push(`${modified.length} Modified Rule${modified.length > 1 ? "s" : ""}`);
  if (missing.length) parts.push(`${missing.length} Missing Rule${missing.length > 1 ? "s" : ""}`);
  if (tagDrift.length) parts.push("Tag Drift");
  const summary = hasDrift ? `DRIFT DETECTED (${parts.join(" + ")})` : "IN SYNC";

  return {
    tenantId,
    resourceName: actual.name,
    resourceGroup: actual.resourceGroup,
    resourceId: actual.id ?? tenant.azure.nsg.id,
    resourceType: "Microsoft.Network/networkSecurityGroups",
    location: actual.location,
    subscriptionId: tenant.subscriptionId,
    gitBranch: tenant.azure.gitBranch,
    terraformFile: baselinePath,
    sourceRef: { file: baselinePath, ...expected.lines, ref: tenant.azure.gitBranch },
    driftState: hasDrift ? "drift-detected" : "in-sync",
    tagDrift,
    rogueSecurityRules: rogue,
    modifiedSecurityRules: modified,
    missingSecurityRules: missing,
    expectedHcl,
    actualHcl,
    hclDiff,
    summary,
    severity,
  };
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

export const azureIacService = {
  getMode() {
    return { liveCloudMode: isLiveCloudMode(), liveCapableTenants: [...LIVE_CAPABLE_TENANTS], iacDir: resolveIacDir() };
  },

  async getAzContext() {
    return withSource(
      "tenant-contoso-01",
      () => fetchAzContextLive(getManifestTenant("tenant-contoso-01").subscriptionId, LIVE_TIMEOUT_MS),
      () => ({ subscriptionId: "", subscriptionName: "", tenantId: "", account: "" }),
    );
  },

  getTerraformBaseline(tenantId: string): TerraformBaseline {
    return getTerraformBaseline(getManifestAzure(tenantId));
  },

  async getNsgState(tenantId: string): Promise<IacResult<NsgState & { id: string }>> {
    const tenant = getManifestAzure(tenantId);
    return withSource(
      tenantId,
      () => fetchNsgLive(tenant.azure.resourceGroup, tenant.azure.nsg.name, tenant.subscriptionId, LIVE_TIMEOUT_MS),
      () => manifestNsgState(tenant),
    );
  },

  async getNsgDrift(tenantId: string): Promise<IacResult<NsgDrift>> {
    const tenant = getManifestAzure(tenantId);
    const baseline = getTerraformBaseline(tenant);
    const state = await azureIacService.getNsgState(tenantId);
    return { ...state, data: computeDrift(tenantId, tenant, baseline.nsg, state.data, baseline.relativePath) };
  },

  /**
   * Break-glass write behind Approve (state "remediated"): the live NSG is put back to the
   * Terraform baseline (rogue rules deleted, missing ones re-created, tags restored).
   * Reset Drift ("drifted") re-asserts the seeded drift from demo-lab-manifest.json.
   * Writes run one after another; ARM serialises operations on one NSG anyway.
   */
  async setNsgState(tenantId: string, state: "remediated" | "drifted"): Promise<NsgWriteResult> {
    const started = performance.now();
    const tenant = getManifestAzure(tenantId);
    const { resourceGroup } = tenant.azure;
    const nsgName = tenant.azure.nsg.name;
    const baseline = getTerraformBaseline(tenant);
    const target: NsgState = state === "remediated" ? baseline.nsg : manifestNsgState(tenant);
    const done = (source: NsgWriteResult["source"], results: NsgWriteResult["results"], fallbackReason?: string): NsgWriteResult => ({
      source,
      latencyMs: Math.round(performance.now() - started),
      results,
      ...(fallbackReason ? { fallbackReason } : {}),
    });
    if (!isLiveCloudMode()) return done("simulated", [], "LIVE_CLOUD_MODE=false");
    if (!LIVE_CAPABLE_TENANTS.has(tenantId)) return done("simulated", [], `${tenantId} is manifest-only`);
    let live: NsgState;
    try {
      live = await fetchNsgLive(resourceGroup, nsgName, tenant.subscriptionId, LIVE_TIMEOUT_MS);
    } catch (error) {
      return done("simulated", [], error instanceof Error ? error.message : String(error));
    }
    const targetByName = new Map(target.rules.map((r) => [r.name, r]));
    const liveByName = new Map(live.rules.map((r) => [r.name, r]));
    const ops: Array<{ id: string; run: () => Promise<number> }> = [];
    if (state === "remediated") {
      for (const r of live.rules.filter((x) => !targetByName.has(x.name))) {
        ops.push({ id: `delete ${r.name}`, run: () => deleteNsgRuleLive(tenant.subscriptionId, resourceGroup, nsgName, r.name, WRITE_TIMEOUT_MS) });
      }
    }
    for (const r of target.rules.filter((x) => !liveByName.has(x.name) || ruleSignature(liveByName.get(x.name)!) !== ruleSignature(x))) {
      ops.push({ id: `put ${r.name}`, run: () => putNsgRuleLive(tenant.subscriptionId, resourceGroup, nsgName, r, WRITE_TIMEOUT_MS) });
    }
    if (JSON.stringify(Object.entries(live.tags).sort()) !== JSON.stringify(Object.entries(target.tags).sort())) {
      ops.push({ id: "tags", run: () => patchNsgTagsLive(tenant.subscriptionId, resourceGroup, nsgName, target.tags, WRITE_TIMEOUT_MS) });
    }
    const results: NsgWriteResult["results"] = [];
    for (const op of ops) {
      try {
        results.push({ id: op.id, ok: true, status: await op.run() });
      } catch (error) {
        results.push({ id: op.id, ok: false, status: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return done("live-azure", results);
  },

  async getResourceInventory(tenantId: string) {
    const tenant = getManifestAzure(tenantId);
    const state = await azureIacService.getNsgState(tenantId);
    return {
      ...state,
      data: {
        subscriptionId: tenant.subscriptionId,
        resourceGroup: tenant.azure.resourceGroup,
        location: tenant.azure.location,
        resources: [
          {
            type: "Microsoft.Network/networkSecurityGroups",
            name: state.data.name,
            id: state.data.id,
            tags: state.data.tags,
            ruleCount: state.data.rules.length,
          },
        ],
      },
    };
  },

  /**
   * The AVD estate around the NSG: host pool topology (a fixture: the lab has no session
   * hosts) and the Azure Policy states of the resource group, derived from the live NSG
   * drift so they flip with it: an open management port fails "Management ports should be
   * closed", a drifted Environment tag fails the tagging policy.
   */
  async getAvdEstate(tenantId: string): Promise<IacResult<AvdEstate>> {
    const tenant = getManifestAzure(tenantId);
    const drift = await azureIacService.getNsgDrift(tenantId);
    const d = drift.data;
    const openMgmt = d.rogueSecurityRules.filter((r) => r.direction === "Inbound" && r.access === "Allow" && ADMIN_PORTS.has(r.port));
    const tagIssues = d.tagDrift.filter((t) => ["CostCenter", "Environment"].includes(t.key));
    const scope = tenant.azure.resourceGroup;
    const azurePolicies: AzurePolicyState[] = [
      {
        name: "Management ports should be closed on your virtual machines",
        effect: "AuditIfNotExists",
        compliance: openMgmt.length ? "NonCompliant" : "Compliant",
        nonCompliantResources: openMgmt.length ? 1 : 0,
        scope,
        detail: openMgmt.length
          ? `${openMgmt.map((r) => `${r.ruleName} (${r.protocol.toUpperCase()}/${r.port} from ${r.source})`).join(", ")} on ${d.resourceName}`.slice(0, 200)
          : "No inbound management port open",
      },
      {
        name: "Require CostCenter & Environment tags on resources",
        effect: "Audit",
        compliance: tagIssues.length ? "NonCompliant" : "Compliant",
        nonCompliantResources: tagIssues.length ? 1 : 0,
        scope,
        detail: tagIssues.length
          ? tagIssues.map((t) => `${t.key} = ${t.actualInAzure ?? "missing"} (expected ${t.expectedInTf ?? "absent"})`).join("; ").slice(0, 200)
          : "Tags match the Terraform baseline",
      },
      {
        name: "Azure Virtual Desktop session hosts should be Microsoft Entra joined",
        effect: "Audit",
        compliance: "Compliant",
        nonCompliantResources: 0,
        scope,
        detail: "Both session hosts are Microsoft Entra joined",
      },
    ];
    const hostPool: HostPool = {
      name: "vdpool-contoso-fin-01",
      poolType: "Pooled",
      loadBalancer: "BreadthFirst",
      maxSessionLimit: 12,
      vmSize: "Standard_D4s_v5",
      location: tenant.azure.location,
      joinType: "Microsoft Entra joined",
      fslogix: { status: "Healthy", share: "stcontosofslogix01.file.core.windows.net/profiles" },
      sessionHosts: [
        { name: "vm-contoso-avd-0", status: "Available", sessions: 0, agentVersion: "1.0.9742.1100" },
        { name: "vm-contoso-avd-1", status: "Available", sessions: 0, agentVersion: "1.0.9742.1100" },
      ],
      source: "fixture",
    };
    return { ...drift, data: { hostPool, azurePolicies, resourceGroup: scope, applicationGroup: "vdag-contoso-fin-01", workspace: "vdws-contoso-fin" } };
  },

  /** Hover-ready diagnostic for a resource name. */
  async getResourceDiagnostic(tenantId: string, resourceName: string) {
    const drift = await azureIacService.getNsgDrift(tenantId);
    const matches = drift.data.resourceName.toLowerCase() === resourceName.toLowerCase();
    return {
      ...drift,
      data: {
        found: matches,
        resourceName,
        drift: matches ? drift.data : null,
      },
    };
  },

  /** Azure Policy assignments & Resource Health posture across the tenant's subscription/resource group. */
  async getAzurePolicies(tenantId: string): Promise<IacResult<AzurePolicyAndHealthRow[]>> {
    const tenant = getManifestTenant(tenantId);
    const sub = tenant.subscriptionId;
    const rgName = tenant.azure?.resourceGroup ?? "rg-tenant-prod";
    let basePolicies: AzurePolicyAndHealthRow[] = [];
    if (tenant.azure) {
      try {
        const avd = await azureIacService.getAvdEstate(tenantId);
        basePolicies = avd.data.azurePolicies.map((p) => ({
          name: p.name,
          effect: p.effect,
          compliance: p.compliance,
          nonCompliantResources: p.nonCompliantResources,
          scope: p.scope,
          detail: p.detail,
        }));
      } catch {
        // Tenant may not have AVD estate; proceed with subscription-level policies
      }
    }
    const extraPolicies: AzurePolicyAndHealthRow[] = [
      {
        name: "Allowed-Locations-EU-Sovereign",
        effect: "Deny",
        compliance: "Compliant",
        nonCompliantResources: 0,
        scope: `/subscriptions/${sub}/resourceGroups/${rgName}`,
        detail: "RequestDisallowedByPolicy outside westeurope, germanywestcentral, northeurope (EU sovereign boundary)",
      },
      {
        name: "Require-Tag-Environment",
        effect: "Deny",
        compliance: "NonCompliant",
        nonCompliantResources: 2,
        scope: `/subscriptions/${sub}/resourceGroups/${rgName}`,
        detail: "RequestDisallowedByPolicy when mandatory tag 'Environment' is missing on compute/network resources",
      },
      {
        name: "Resource-Health-Compute-WestEurope",
        effect: "ResourceHealth",
        compliance: "NonCompliant",
        nonCompliantResources: 1,
        scope: `/subscriptions/${sub}/providers/Microsoft.ResourceHealth/availabilityStatuses`,
        detail: "Resource health degraded: AZ-WEU-CAP-409 Standard_D4s_v5 regional allocation pressure in westeurope",
      },
      {
        name: "Resource-Health-Compute-GermanyWestCentral",
        effect: "ResourceHealth",
        compliance: "Compliant",
        nonCompliantResources: 0,
        scope: `/subscriptions/${sub}/providers/Microsoft.ResourceHealth/availabilityStatuses`,
        detail: "Resource health available: Healthy compute capacity and policy compliance in germanywestcentral",
      },
    ];
    for (const ep of extraPolicies) {
      if (!basePolicies.some((p) => p.name === ep.name)) basePolicies.push(ep);
    }
    return {
      source: "seeded-manifest",
      liveCloudMode: isLiveCloudMode(),
      fetchedAt: new Date().toISOString(),
      latencyMs: 1,
      data: basePolicies,
    };
  },

  /** Regional Compute/Network/Storage quota and capacity headroom across EU sovereign regions. */
  async getRegionalQuotas(_tenantId: string): Promise<IacResult<RegionalQuotaRow[]>> {
    const quotaRows: RegionalQuotaRow[] = [
      {
        resource: "Standard_D4s_v5 (westeurope)",
        region: "westeurope",
        usage: "20/20",
        utilization: "100%",
        headroom: "QuotaExceeded",
        status: "Critical",
      },
      {
        resource: "Total Regional vCPUs (westeurope)",
        region: "westeurope",
        usage: "48/50",
        utilization: "96%",
        headroom: "Near Limit",
        status: "Warning",
      },
      {
        resource: "Public IPv4 Addresses (westeurope)",
        region: "westeurope",
        usage: "19/20",
        utilization: "95%",
        headroom: "Near Limit",
        status: "Warning",
      },
      {
        resource: "Premium SSD Managed Disks (westeurope)",
        region: "westeurope",
        usage: "42/50",
        utilization: "84%",
        headroom: "High Usage",
        status: "Warning",
      },
      {
        resource: "Standard_D4s_v5 (germanywestcentral)",
        region: "germanywestcentral",
        usage: "4/20",
        utilization: "20%",
        headroom: "16 vCPUs Free",
        status: "Healthy",
      },
      {
        resource: "Standard_D4s_v5 (northeurope)",
        region: "northeurope",
        usage: "6/20",
        utilization: "30%",
        headroom: "14 vCPUs Free",
        status: "Healthy",
      },
    ];
    return {
      source: "seeded-manifest",
      liveCloudMode: isLiveCloudMode(),
      fetchedAt: new Date().toISOString(),
      latencyMs: 1,
      data: quotaRows,
    };
  },
};

export interface AzurePolicyAndHealthRow {
  name: string;
  effect: string;
  compliance: "Compliant" | "NonCompliant";
  nonCompliantResources: number;
  scope: string;
  detail: string;
}

export interface RegionalQuotaRow {
  resource: string;
  region: string;
  usage: string;
  utilization: string;
  headroom: string;
  status: "Critical" | "Warning" | "Healthy";
}

/** Outcome of an NSG write: one row per ARM operation (rule delete / put, tag update). */
export interface NsgWriteResult {
  source: "live-azure" | "simulated";
  fallbackReason?: string;
  latencyMs: number;
  results: Array<{ id: string; ok: boolean; status: number; error?: string }>;
}

export interface AvdEstate {
  hostPool: HostPool;
  azurePolicies: AzurePolicyState[];
  resourceGroup: string;
  applicationGroup: string;
  workspace: string;
}

export type AzureIacService = typeof azureIacService;
