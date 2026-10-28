import type { NsgRule, NsgState } from "./hcl.ts";
import { cachedTokenClaims, getAccessToken, invalidateAccessToken } from "./token.ts";

/**
 * Live Azure reads against the ARM REST API with a bearer token minted once from
 * the cached Az sign-in (see token.ts). Requires an existing `Connect-AzAccount`.
 */

const ARM = "https://management.azure.com";
const NSG_API_VERSION = "2024-03-01";

async function armGet<T>(path: string, timeoutMs: number): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(`${ARM}/`, Math.max(timeoutMs, 30_000));
    const response = await fetch(`${ARM}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401 && attempt === 0) {
      invalidateAccessToken(`${ARM}/`);
      continue;
    }
    const body = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new Error(`ARM HTTP ${response.status}: ${body.error?.code ?? ""} ${body.error?.message ?? response.statusText}`.trim());
    return body;
  }
  throw new Error("ARM token rejected twice");
}

interface ArmNsg {
  id: string;
  name: string;
  location: string;
  tags?: Record<string, string>;
  properties: {
    securityRules?: Array<{
      name: string;
      properties: {
        priority: number;
        direction: string;
        access: string;
        protocol: string;
        sourcePortRange?: string;
        sourcePortRanges?: string[];
        destinationPortRange?: string;
        destinationPortRanges?: string[];
        sourceAddressPrefix?: string;
        sourceAddressPrefixes?: string[];
        destinationAddressPrefix?: string;
        destinationAddressPrefixes?: string[];
        description?: string;
      };
    }>;
  };
}

const first = (single: string | undefined, many: string[] | undefined): string => single ?? many?.[0] ?? "*";

export async function fetchNsgLive(resourceGroup: string, nsgName: string, subscriptionId: string, timeoutMs: number): Promise<NsgState & { id: string }> {
  const nsg = await armGet<ArmNsg>(
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}?api-version=${NSG_API_VERSION}`,
    timeoutMs,
  );
  const rules: NsgRule[] = (nsg.properties.securityRules ?? []).map(({ name, properties: r }) => ({
    name,
    priority: r.priority,
    direction: r.direction === "Outbound" ? "Outbound" : "Inbound",
    access: r.access === "Deny" ? "Deny" : "Allow",
    protocol: r.protocol,
    sourcePortRange: first(r.sourcePortRange, r.sourcePortRanges),
    destinationPortRange: first(r.destinationPortRange, r.destinationPortRanges),
    sourceAddressPrefix: first(r.sourceAddressPrefix, r.sourceAddressPrefixes),
    destinationAddressPrefix: first(r.destinationAddressPrefix, r.destinationAddressPrefixes),
    ...(r.description ? { description: r.description } : {}),
  }));
  return { id: nsg.id, name: nsg.name, resourceGroup, location: nsg.location, tags: nsg.tags ?? {}, rules };
}

/* -------------------------------------------------------------------------- */
/* Break-glass writes (approve) and drift re-assertion (reset)                 */
/* -------------------------------------------------------------------------- */

const nsgPath = (subscriptionId: string, resourceGroup: string, nsgName: string) =>
  `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}`;

/**
 * One ARM write, then the long-running operation followed to its end: NSG rule PUT and
 * DELETE are asynchronous, and the next write on the same NSG fails with
 * AnotherOperationInProgress until the previous one finished.
 */
async function armWrite(method: "PUT" | "DELETE" | "PATCH", path: string, body: unknown, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const token = await getAccessToken(`${ARM}/`, 30_000);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = await fetch(`${ARM}${path}?api-version=${NSG_API_VERSION}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok && response.status !== 404) {
    const err = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new Error(`ARM ${method} HTTP ${response.status}: ${err.error?.code ?? ""} ${err.error?.message ?? response.statusText}`.trim());
  }
  const operation = response.headers.get("azure-asyncoperation");
  while (operation && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = (await fetch(operation, { headers, signal: AbortSignal.timeout(15_000) }).then((r) => r.json())) as { status?: string; error?: { message?: string } };
    if (poll.status === "Succeeded") break;
    if (poll.status === "Failed" || poll.status === "Canceled") throw new Error(`ARM ${method} ${poll.status}: ${poll.error?.message ?? ""}`.trim());
  }
  return response.status;
}

export async function putNsgRuleLive(subscriptionId: string, resourceGroup: string, nsgName: string, rule: NsgRule, timeoutMs: number): Promise<number> {
  return armWrite(
    "PUT",
    `${nsgPath(subscriptionId, resourceGroup, nsgName)}/securityRules/${rule.name}`,
    {
      properties: {
        priority: rule.priority,
        direction: rule.direction,
        access: rule.access,
        protocol: rule.protocol,
        sourcePortRange: rule.sourcePortRange,
        destinationPortRange: rule.destinationPortRange,
        sourceAddressPrefix: rule.sourceAddressPrefix,
        destinationAddressPrefix: rule.destinationAddressPrefix,
        ...(rule.description ? { description: rule.description } : {}),
      },
    },
    timeoutMs,
  );
}

export async function deleteNsgRuleLive(subscriptionId: string, resourceGroup: string, nsgName: string, ruleName: string, timeoutMs: number): Promise<number> {
  return armWrite("DELETE", `${nsgPath(subscriptionId, resourceGroup, nsgName)}/securityRules/${ruleName}`, undefined, timeoutMs);
}

/** Replaces the NSG's tags (UpdateTags), leaving its rules alone. */
export async function patchNsgTagsLive(subscriptionId: string, resourceGroup: string, nsgName: string, tags: Record<string, string>, timeoutMs: number): Promise<number> {
  return armWrite("PATCH", nsgPath(subscriptionId, resourceGroup, nsgName), { tags }, timeoutMs);
}

export async function fetchAzContextLive(
  subscriptionId: string,
  timeoutMs: number,
): Promise<{ subscriptionId: string; subscriptionName: string; tenantId: string; account: string }> {
  const sub = await armGet<{ subscriptionId: string; displayName: string; tenantId?: string }>(`/subscriptions/${subscriptionId}?api-version=2022-12-01`, timeoutMs);
  const claims = cachedTokenClaims(`${ARM}/`) ?? {};
  return {
    subscriptionId: sub.subscriptionId,
    subscriptionName: sub.displayName,
    tenantId: sub.tenantId ?? String(claims.tid ?? ""),
    account: String(claims.upn ?? claims.unique_name ?? ""),
  };
}

/* -------------------------------------------------------------------------- */
/* Real Tenant Mode (Unfiltered Azure ARM Reads — Zero Seeded Manifest)       */
/* -------------------------------------------------------------------------- */

export interface RealArmSubscription {
  subscriptionId: string;
  displayName: string;
  state: string;
  tenantId: string;
}

export async function fetchRealSubscriptionsLive(timeoutMs: number): Promise<RealArmSubscription[]> {
  const res = await armGet<{
    value?: Array<{ subscriptionId: string; displayName: string; state?: string; tenantId?: string }>;
  }>("/subscriptions?api-version=2022-12-01", timeoutMs);
  return (res.value ?? []).map((s) => ({
    subscriptionId: s.subscriptionId,
    displayName: s.displayName,
    state: s.state ?? "Enabled",
    tenantId: s.tenantId ?? "",
  }));
}

export async function resolveRealSubscriptionIdLive(preferredSubId: string | undefined, timeoutMs: number): Promise<string> {
  const subs = await fetchRealSubscriptionsLive(timeoutMs);
  if (preferredSubId && subs.some((s) => s.subscriptionId.toLowerCase() === preferredSubId.toLowerCase())) {
    return preferredSubId;
  }
  const enabled = subs.find((s) => s.state === "Enabled") ?? subs[0];
  if (!enabled) throw new Error("No accessible Azure subscriptions found for the current ARM token");
  return enabled.subscriptionId;
}

export async function fetchAllNsgsLive(
  subscriptionId: string,
  timeoutMs: number,
): Promise<Array<NsgState & { id: string }>> {
  const res = await armGet<{ value?: ArmNsg[] }>(
    `/subscriptions/${subscriptionId}/providers/Microsoft.Network/networkSecurityGroups?api-version=${NSG_API_VERSION}`,
    timeoutMs,
  );
  return (res.value ?? []).map((nsg) => {
    const rgMatch = /\/resourceGroups\/([^/]+)\//i.exec(nsg.id);
    const resourceGroup = rgMatch?.[1] ?? "rg-default";
    const rules: NsgRule[] = (nsg.properties.securityRules ?? []).map(({ name, properties: r }) => ({
      name,
      priority: r.priority,
      direction: r.direction === "Outbound" ? "Outbound" : "Inbound",
      access: r.access === "Deny" ? "Deny" : "Allow",
      protocol: r.protocol,
      sourcePortRange: first(r.sourcePortRange, r.sourcePortRanges),
      destinationPortRange: first(r.destinationPortRange, r.destinationPortRanges),
      sourceAddressPrefix: first(r.sourceAddressPrefix, r.sourceAddressPrefixes),
      destinationAddressPrefix: first(r.destinationAddressPrefix, r.destinationAddressPrefixes),
      ...(r.description ? { description: r.description } : {}),
    }));
    return {
      id: nsg.id,
      name: nsg.name,
      resourceGroup,
      location: nsg.location,
      tags: nsg.tags ?? {},
      rules,
    };
  });
}

export interface RealArmResourceRow {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  tags: Record<string, string>;
}

export async function fetchRealArmResourcesLive(subscriptionId: string, timeoutMs: number): Promise<RealArmResourceRow[]> {
  const res = await armGet<{
    value?: Array<{ id: string; name: string; type: string; location: string; tags?: Record<string, string> }>;
  }>(`/subscriptions/${subscriptionId}/resources?api-version=2021-04-01`, timeoutMs);
  return (res.value ?? []).map((r) => {
    const rgMatch = /\/resourceGroups\/([^/]+)\//i.exec(r.id);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      location: r.location,
      resourceGroup: rgMatch?.[1] ?? "rg-default",
      tags: r.tags ?? {},
    };
  });
}

export interface RealArmPolicyAssignment {
  id: string;
  name: string;
  displayName: string;
  scope: string;
  enforcementMode: string;
  description: string;
}

export async function fetchRealAzurePolicyAssignmentsLive(
  subscriptionId: string,
  timeoutMs: number,
): Promise<RealArmPolicyAssignment[]> {
  const res = await armGet<{
    value?: Array<{
      id: string;
      name: string;
      properties?: {
        displayName?: string;
        scope?: string;
        enforcementMode?: string;
        description?: string;
      };
    }>;
  }>(`/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments?api-version=2022-06-01`, timeoutMs);
  return (res.value ?? []).slice(0, 40).map((a) => ({
    id: a.id,
    name: a.name,
    displayName: a.properties?.displayName ?? a.name,
    scope: a.properties?.scope ?? `/subscriptions/${subscriptionId}`,
    enforcementMode: a.properties?.enforcementMode ?? "Default",
    description: a.properties?.description ?? "Live Azure Policy Assignment",
  }));
}

export interface RealComputeUsageRow {
  name: string;
  localizedValue: string;
  currentValue: number;
  limit: number;
  location: string;
}

export async function fetchRealComputeQuotasLive(
  subscriptionId: string,
  location: string,
  timeoutMs: number,
): Promise<RealComputeUsageRow[]> {
  const res = await armGet<{
    value?: Array<{
      currentValue?: number;
      limit?: number;
      name?: { value?: string; localizedValue?: string };
    }>;
  }>(`/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${encodeURIComponent(location)}/usages?api-version=2024-03-01`, timeoutMs);
  return (res.value ?? [])
    .filter((u) => (u.currentValue ?? 0) > 0 || /cores|standardDSv5|standardDv5|virtualMachines/i.test(u.name?.value ?? ""))
    .slice(0, 15)
    .map((u) => ({
      name: u.name?.value ?? "compute",
      localizedValue: u.name?.localizedValue ?? u.name?.value ?? "Compute Quota",
      currentValue: u.currentValue ?? 0,
      limit: u.limit ?? 0,
      location,
    }));
}

export interface RealAvdHostPoolRow {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  hostPoolType: string;
  loadBalancerType: string;
  maxSessionLimit: number;
}

export async function fetchRealAvdHostPoolsLive(subscriptionId: string, timeoutMs: number): Promise<RealAvdHostPoolRow[]> {
  const res = await armGet<{
    value?: Array<{
      id: string;
      name: string;
      location: string;
      properties?: {
        hostPoolType?: string;
        loadBalancerType?: string;
        maxSessionLimit?: number;
      };
    }>;
  }>(`/subscriptions/${subscriptionId}/providers/Microsoft.DesktopVirtualization/hostPools?api-version=2023-09-05`, timeoutMs);
  return (res.value ?? []).map((hp) => {
    const rgMatch = /\/resourceGroups\/([^/]+)\//i.exec(hp.id);
    return {
      id: hp.id,
      name: hp.name,
      location: hp.location,
      resourceGroup: rgMatch?.[1] ?? "rg-default",
      hostPoolType: hp.properties?.hostPoolType ?? "Pooled",
      loadBalancerType: hp.properties?.loadBalancerType ?? "BreadthFirst",
      maxSessionLimit: hp.properties?.maxSessionLimit ?? 10,
    };
  });
}

export interface RealAzureVmRow {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  vmSize: string;
  osType: string;
  osOfferSku: string;
  nic: string;
  provisioningState: string;
  securityType: string;
  computerName: string;
  tags: Record<string, string>;
}

export async function fetchRealVirtualMachinesLive(subscriptionId: string, timeoutMs: number): Promise<RealAzureVmRow[]> {
  const res = await armGet<{
    value?: Array<{
      id: string;
      name: string;
      location: string;
      tags?: Record<string, string>;
      properties?: {
        hardwareProfile?: { vmSize?: string };
        provisioningState?: string;
        storageProfile?: {
          imageReference?: { publisher?: string; offer?: string; sku?: string };
          osDisk?: { osType?: string; name?: string };
        };
        osProfile?: { computerName?: string };
        securityProfile?: { securityType?: string };
        networkProfile?: {
          networkInterfaces?: Array<{ id?: string; properties?: { primary?: boolean } }>;
        };
      };
    }>;
  }>(`/subscriptions/${subscriptionId}/providers/Microsoft.Compute/virtualMachines?api-version=2024-03-01`, timeoutMs);

  return (res.value ?? []).map((vm) => {
    const rgMatch = /\/resourceGroups\/([^/]+)\//i.exec(vm.id);
    const primaryNic =
      vm.properties?.networkProfile?.networkInterfaces?.find((n) => n.properties?.primary) ??
      vm.properties?.networkProfile?.networkInterfaces?.[0];
    const nicName = primaryNic?.id?.split("/").pop() ?? "—";
    const offer = vm.properties?.storageProfile?.imageReference?.offer;
    const sku = vm.properties?.storageProfile?.imageReference?.sku;
    const osType = vm.properties?.storageProfile?.osDisk?.osType ?? "Windows";
    const osOfferSku = [offer, sku].filter(Boolean).join(" / ") || osType;
    return {
      id: vm.id,
      name: vm.name,
      resourceGroup: rgMatch?.[1] ?? "rg-default",
      location: vm.location,
      vmSize: vm.properties?.hardwareProfile?.vmSize ?? "Standard_D4s_v5",
      osType,
      osOfferSku,
      nic: nicName,
      provisioningState: vm.properties?.provisioningState ?? "Succeeded",
      securityType: vm.properties?.securityProfile?.securityType ?? "Standard",
      computerName: vm.properties?.osProfile?.computerName ?? vm.name,
      tags: vm.tags ?? {},
    };
  });
}
