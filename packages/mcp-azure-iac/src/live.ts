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
