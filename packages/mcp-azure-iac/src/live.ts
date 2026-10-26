import type { NsgRule, NsgState } from "./hcl.ts";
import { psq, runPwshJson } from "./shared.ts";

/**
 * Live Azure queries via PowerShell 7 + Az. Requires an existing
 * `Connect-AzAccount` context (the Az token cache persists across processes).
 */

interface AzNsgJson {
  Name: string;
  Location: string;
  ResourceGroupName: string;
  Id: string;
  Tag: Record<string, string> | null;
  SecurityRules: Array<{
    Name: string;
    Priority: number;
    Direction: string;
    Access: string;
    Protocol: string;
    SourcePortRange: string[] | string;
    DestinationPortRange: string[] | string;
    SourceAddressPrefix: string[] | string;
    DestinationAddressPrefix: string[] | string;
    Description: string | null;
  }>;
}

const first = (v: string[] | string | null | undefined): string => (Array.isArray(v) ? (v[0] ?? "*") : (v ?? "*"));

export async function fetchNsgLive(resourceGroup: string, nsgName: string, subscriptionId: string, timeoutMs: number): Promise<NsgState & { id: string }> {
  const script = `
if (-not (Get-Command Get-AzContext -ErrorAction SilentlyContinue)) { throw 'Az.Accounts module is not installed.' }
$ctx = Get-AzContext
if (-not $ctx) { throw 'No Azure context. Run Connect-AzAccount first.' }
if ($ctx.Subscription.Id -ne ${psq(subscriptionId)}) { $null = Set-AzContext -SubscriptionId ${psq(subscriptionId)} -ErrorAction Stop }
$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName ${psq(resourceGroup)} -Name ${psq(nsgName)} -ErrorAction Stop
[pscustomobject]@{
  Name              = $nsg.Name
  Location          = $nsg.Location
  ResourceGroupName = $nsg.ResourceGroupName
  Id                = $nsg.Id
  Tag               = $nsg.Tag
  SecurityRules     = @($nsg.SecurityRules | ForEach-Object {
    [pscustomobject]@{
      Name = $_.Name; Priority = [int]$_.Priority; Direction = [string]$_.Direction; Access = [string]$_.Access; Protocol = [string]$_.Protocol
      SourcePortRange = @($_.SourcePortRange); DestinationPortRange = @($_.DestinationPortRange)
      SourceAddressPrefix = @($_.SourceAddressPrefix); DestinationAddressPrefix = @($_.DestinationAddressPrefix)
      Description = $_.Description
    }
  })
} | ConvertTo-Json -Depth 6 -Compress
`;
  const json = await runPwshJson<AzNsgJson>(script, timeoutMs);
  const rules: NsgRule[] = (json.SecurityRules ?? []).map((r) => ({
    name: r.Name,
    priority: r.Priority,
    direction: r.Direction === "Outbound" ? "Outbound" : "Inbound",
    access: r.Access === "Deny" ? "Deny" : "Allow",
    protocol: r.Protocol,
    sourcePortRange: first(r.SourcePortRange),
    destinationPortRange: first(r.DestinationPortRange),
    sourceAddressPrefix: first(r.SourceAddressPrefix),
    destinationAddressPrefix: first(r.DestinationAddressPrefix),
    ...(r.Description ? { description: r.Description } : {}),
  }));
  return {
    id: json.Id,
    name: json.Name,
    resourceGroup: json.ResourceGroupName,
    location: json.Location,
    tags: json.Tag ?? {},
    rules,
  };
}

export async function fetchAzContextLive(timeoutMs: number): Promise<{ subscriptionId: string; subscriptionName: string; tenantId: string; account: string }> {
  const script = `
if (-not (Get-Command Get-AzContext -ErrorAction SilentlyContinue)) { throw 'Az.Accounts module is not installed.' }
$ctx = Get-AzContext
if (-not $ctx) { throw 'No Azure context. Run Connect-AzAccount first.' }
[pscustomobject]@{ subscriptionId = $ctx.Subscription.Id; subscriptionName = $ctx.Subscription.Name; tenantId = $ctx.Tenant.Id; account = $ctx.Account.Id } | ConvertTo-Json -Compress
`;
  return runPwshJson(script, timeoutMs);
}
