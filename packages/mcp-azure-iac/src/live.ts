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
