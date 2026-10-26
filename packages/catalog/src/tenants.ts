/**
 * Static registry of the demo tenants. Everything else about a tenant comes
 * from the MCP servers; this only maps ids to the identifiers the UI needs
 * before any data is loaded (tenant switcher labels, hotkeys).
 */
export const TENANT_IDS = ["tenant-contoso-01", "tenant-fabrikam-02"] as const;
export type TenantId = (typeof TENANT_IDS)[number];

export interface TenantRegistryEntry {
  tenantId: TenantId;
  displayName: string;
  ticketId: string;
  contractId: string;
  shortLabel: string;
}

export const TENANT_REGISTRY: Record<TenantId, TenantRegistryEntry> = {
  "tenant-contoso-01": {
    tenantId: "tenant-contoso-01",
    displayName: "Contoso Finance",
    ticketId: "INC-4092",
    contractId: "CNT-2026-884",
    shortLabel: "Contoso Finance (#INC-4092)",
  },
  "tenant-fabrikam-02": {
    tenantId: "tenant-fabrikam-02",
    displayName: "Fabrikam Legal",
    ticketId: "INC-4099",
    contractId: "CNT-2026-912",
    shortLabel: "Fabrikam Legal (#INC-4099)",
  },
};

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === "string" && (TENANT_IDS as readonly string[]).includes(value);
}

export function resolveTenantId(value: unknown, fallback: TenantId = "tenant-contoso-01"): TenantId {
  return isTenantId(value) ? value : fallback;
}

/** First-party Microsoft app ids that show up in the demo sign-in logs. */
export const KNOWN_APP_IDS: Record<string, string> = {
  "9cdead84-a844-4324-93f2-b2e6bb768d07": "Azure Virtual Desktop",
  "00000002-0000-0ff1-ce00-000000000000": "Office 365 Exchange Online",
  "80ccca67-54bd-44ab-8625-4b79c4dc7775": "Microsoft Purview",
  "fb8d773d-7ef8-4ec0-a117-179f88add510": "Microsoft 365 Copilot",
};
