import type { SlaTier, TicketSeverity } from "@contextpane/catalog";

/**
 * Deterministic ERP / PSA data for the two demo customers.
 * In a real MSP this comes from ConnectWise, Autotask, HaloPSA or Dynamics 365.
 */

export type EntityKind = "upn" | "group" | "errorCode" | "sku" | "resource" | "policy" | "contract" | "ticket";

export interface ErpEntityRef {
  type: EntityKind;
  id: string;
  label: string;
}

export interface ErpTicket {
  ticketId: string;
  tenantId: string;
  title: string;
  description: string;
  severity: TicketSeverity;
  status: "Open" | "In Progress" | "Pending Customer" | "Resolved";
  openedAt: string;
  updatedAt: string;
  slaBreachAt: string;
  requester: { displayName: string; upn: string; role: string };
  assignedEngineer: string;
  affectedUpns: string[];
  affectedGroups: string[];
  relatedContractId: string;
  category: string;
  entities: ErpEntityRef[];
  /** Free-text infrastructure spec from the ticket; the IaC CodeLens renders above it. */
  infrastructureSpec: string;
  timeline: Array<{ at: string; actor: string; note: string }>;
  /** Files the customer attached; url is served by the web app (apps/web/public). */
  attachments?: Array<{ fileName: string; mimeType: string; url: string; uploadedBy: string; uploadedAt: string; sizeBytes: number }>;
}

export interface ErpContractLine {
  lineId: string;
  description: string;
  skuPartNumber: string;
  skuName: string;
  quantity: number;
  unitPriceUsd: number;
  billingCycle: "monthly" | "annual";
  entitlementGroup: string | null;
  /** The line the Semantic Floating Toolbar attaches to. */
  semanticAnchor: boolean;
}

export interface ErpContract {
  contractId: string;
  tenantId: string;
  title: string;
  startDate: string;
  endDate: string;
  slaTier: SlaTier;
  monthlyValueUsd: number;
  lines: ErpContractLine[];
  terms: string[];
}

export interface ErpTenant {
  tenantId: string;
  displayName: string;
  legalName: string;
  verifiedDomain: string;
  entraTenantId: string;
  azureSubscriptionId: string;
  slaTier: SlaTier;
  accountManager: string;
  region: string;
  industry: string;
  primaryTicketId: string;
  primaryContractId: string;
}

export const ERP_TENANTS: Record<string, ErpTenant> = {
  "tenant-contoso-01": {
    tenantId: "tenant-contoso-01",
    displayName: "Contoso Finance",
    legalName: "Contoso Finance AG",
    verifiedDomain: "c4a8shili.onmicrosoft.com",
    entraTenantId: "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea",
    azureSubscriptionId: "20505597-043c-4742-a884-42dc3f621aef",
    slaTier: "Platinum",
    accountManager: "Sabine Keller",
    region: "Switzerland",
    industry: "Financial Services",
    primaryTicketId: "INC-4092",
    primaryContractId: "CNT-2026-884",
  },
  "tenant-fabrikam-02": {
    tenantId: "tenant-fabrikam-02",
    displayName: "Fabrikam Legal",
    legalName: "Fabrikam Legal Partners LLP",
    verifiedDomain: "fabrikamlegal.onmicrosoft.com",
    entraTenantId: "7f3c9b2e-5d41-4a8e-9c6f-2b1d8e4f7a30",
    azureSubscriptionId: "e1c2d3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    slaTier: "Gold",
    accountManager: "Marc Dubois",
    region: "Switzerland",
    industry: "Legal Services",
    primaryTicketId: "INC-4099",
    primaryContractId: "CNT-2026-912",
  },
};

export const ERP_TICKETS: Record<string, ErpTicket> = {
  "INC-4092": {
    ticketId: "INC-4092",
    tenantId: "tenant-contoso-01",
    title: "Finance department cannot access new AVD Host Pool after Microsoft 365 E5 upgrade",
    description:
      "Customer Contoso Finance department cannot access the new AVD Host Pool after their Microsoft 365 E5 upgrade. " +
      "Affected user: lynne.robins.contoso@c4a8shili.onmicrosoft.com. User reports error AADSTS53003 in the Windows App client when " +
      "connecting to vdpool-contoso-fin-01. Two further analysts in SG-Contoso-Finance-AVD report the same symptom. " +
      "Customer also mentions a vendor opened 'temporary RDP' on the host pool NSG during the cutover on Friday.",
    severity: "P1",
    status: "In Progress",
    openedAt: "2026-10-26T08:11:00Z",
    updatedAt: "2026-10-26T08:40:00Z",
    slaBreachAt: "2026-10-26T12:11:00Z",
    requester: { displayName: "Lynne Robins", upn: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", role: "Senior Financial Analyst" },
    assignedEngineer: "Timur Dudhasch",
    affectedUpns: [
      "lynne.robins.contoso@c4a8shili.onmicrosoft.com",
      "diego.siciliani.contoso@c4a8shili.onmicrosoft.com",
      "patti.fernandez.contoso@c4a8shili.onmicrosoft.com",
    ],
    affectedGroups: ["SG-Contoso-Finance-AVD"],
    relatedContractId: "CNT-2026-884",
    category: "Identity & Access / AVD",
    entities: [
      { type: "upn", id: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", label: "lynne.robins.contoso@c4a8shili.onmicrosoft.com" },
      { type: "group", id: "SG-Contoso-Finance-AVD", label: "SG-Contoso-Finance-AVD" },
      { type: "errorCode", id: "AADSTS53003", label: "AADSTS53003" },
      { type: "resource", id: "vdpool-contoso-fin-01", label: "vdpool-contoso-fin-01" },
      { type: "resource", id: "nsg-contoso-avd-hostpool-01", label: "nsg-contoso-avd-hostpool-01" },
    ],
    infrastructureSpec:
      "Host Pool: vdpool-contoso-fin-01 (Pooled, BreadthFirst, 2x D4s_v5)\n" +
      "Resource Group: rg-contoso-avd-prod (westeurope)\n" +
      "NSG: nsg-contoso-avd-hostpool-01 -> demo-iac/main.tf @ main\n" +
      "Identity: Entra joined session hosts, FSLogix on Azure Files\n" +
      "Entitlement: SG-Contoso-Finance-AVD (Microsoft 365 E5 / SPE_E5)",
    timeline: [
      { at: "2026-10-24T15:40:00Z", actor: "Vendor (cutover)", note: "E5 upgrade completed for Finance. CA policy for legacy E3 users created." },
      { at: "2026-10-24T16:05:00Z", actor: "Vendor (cutover)", note: "Opened temporary RDP on host pool NSG for diagnostics." },
      { at: "2026-10-26T08:11:00Z", actor: "Lynne Robins", note: "Ticket opened via portal: cannot connect to AVD, error AADSTS53003." },
      { at: "2026-10-26T08:40:00Z", actor: "Service Desk", note: "Escalated to P1 - three analysts affected, month-end close at risk." },
    ],
    attachments: [
      {
        fileName: "contoso-avd-error-screenshot.png",
        mimeType: "image/png",
        url: "/attachments/contoso-avd-error-screenshot.png",
        uploadedBy: "Lynne Robins",
        uploadedAt: "2026-10-26T08:11:00Z",
        sizeBytes: 295990,
      },
    ],
  },
  "INC-4099": {
    ticketId: "INC-4099",
    tenantId: "tenant-fabrikam-02",
    title: "M365 Copilot & Purview eDiscovery access failure for paralegal group",
    description:
      "Fabrikam Legal M365 Copilot & Purview eDiscovery access failure for paralegal group SG-Fabrikam-Legal. " +
      "Paralegals receive AADSTS50105 when opening Microsoft 365 Copilot and AADSTS53003 when opening Purview eDiscovery from " +
      "non-managed devices. Lead paralegal nestor.wilke.legal@fabrikamlegal.onmicrosoft.com is unaffected. " +
      "Customer security officer also flagged an unexpected SSH rule on the sovereign landing zone hub NSG.",
    severity: "P2",
    status: "Open",
    openedAt: "2026-10-26T07:20:00Z",
    updatedAt: "2026-10-26T07:55:00Z",
    slaBreachAt: "2026-10-26T15:20:00Z",
    requester: { displayName: "Grady Archie", upn: "grady.archie.legal@fabrikamlegal.onmicrosoft.com", role: "Paralegal" },
    assignedEngineer: "Timur Dudhasch",
    affectedUpns: [
      "grady.archie.legal@fabrikamlegal.onmicrosoft.com",
      "isaiah.langer.legal@fabrikamlegal.onmicrosoft.com",
      "lidia.holloway.legal@fabrikamlegal.onmicrosoft.com",
      "johanna.lorenz.legal@fabrikamlegal.onmicrosoft.com",
    ],
    affectedGroups: ["SG-Fabrikam-Legal"],
    relatedContractId: "CNT-2026-912",
    category: "Identity & Access / Compliance",
    entities: [
      { type: "upn", id: "grady.archie.legal@fabrikamlegal.onmicrosoft.com", label: "grady.archie.legal@fabrikamlegal.onmicrosoft.com" },
      { type: "group", id: "SG-Fabrikam-Legal", label: "SG-Fabrikam-Legal" },
      { type: "errorCode", id: "AADSTS50105", label: "AADSTS50105" },
      { type: "errorCode", id: "AADSTS53003", label: "AADSTS53003" },
      { type: "resource", id: "nsg-fabrikam-slz-hub-01", label: "nsg-fabrikam-slz-hub-01" },
    ],
    infrastructureSpec:
      "Sovereign Landing Zone: rg-fabrikam-slz-prod (switzerlandnorth)\n" +
      "Hub NSG: nsg-fabrikam-slz-hub-01 -> demo-iac/fabrikam.tf @ main\n" +
      "Data residency: CH only, Purview eDiscovery connector via private endpoint\n" +
      "Entitlement: SG-Fabrikam-Legal (Microsoft 365 E5 Compliance / INFORMATION_PROTECTION_COMPLIANCE)",
    timeline: [
      { at: "2026-10-25T08:02:00Z", actor: "Fabrikam SecOps", note: "Compliant-device CA policy tightened for Purview." },
      { at: "2026-10-25T09:30:00Z", actor: "Vendor", note: "E5 Compliance SKU roll-out started; 21 of 25 seats assigned." },
      { at: "2026-10-26T07:20:00Z", actor: "Grady Archie", note: "Ticket opened: Copilot and eDiscovery unavailable for paralegals." },
    ],
  },
};

export const ERP_CONTRACTS: Record<string, ErpContract> = {
  "CNT-2026-884": {
    contractId: "CNT-2026-884",
    tenantId: "tenant-contoso-01",
    title: "Contoso Finance — Modern Work & AVD Managed Service",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    slaTier: "Platinum",
    monthlyValueUsd: 2655,
    lines: [
      {
        lineId: "L1",
        description: "15x Microsoft 365 E5 (SPE_E5) licenses for SG-Contoso-Finance-AVD",
        skuPartNumber: "SPE_E5",
        skuName: "Microsoft 365 E5",
        quantity: 15,
        unitPriceUsd: 57,
        billingCycle: "monthly",
        entitlementGroup: "SG-Contoso-Finance-AVD",
        semanticAnchor: true,
      },
      {
        lineId: "L2",
        description: "Isolated AVD Host Pool vdpool-contoso-fin-01 (managed, 2 session hosts)",
        skuPartNumber: "MSP-AVD-POOL",
        skuName: "Managed AVD Host Pool",
        quantity: 1,
        unitPriceUsd: 1800,
        billingCycle: "monthly",
        entitlementGroup: null,
        semanticAnchor: false,
      },
    ],
    terms: [
      "P1 response 15 min / resolution 4 h (Platinum)",
      "Infrastructure changes via Terraform PR only; manual portal changes are billable drift remediation",
      "License true-up quarterly against Entra assignment counts",
    ],
  },
  "CNT-2026-912": {
    contractId: "CNT-2026-912",
    tenantId: "tenant-fabrikam-02",
    title: "Fabrikam Legal — Compliance & Sovereign Landing Zone",
    startDate: "2026-03-01",
    endDate: "2027-02-28",
    slaTier: "Gold",
    monthlyValueUsd: 2500,
    lines: [
      {
        lineId: "L1",
        description: "25x Microsoft 365 E5 Compliance (INFORMATION_PROTECTION_COMPLIANCE) SKUs for SG-Fabrikam-Legal",
        skuPartNumber: "INFORMATION_PROTECTION_COMPLIANCE",
        skuName: "Microsoft 365 E5 Compliance",
        quantity: 25,
        unitPriceUsd: 12,
        billingCycle: "monthly",
        entitlementGroup: "SG-Fabrikam-Legal",
        semanticAnchor: true,
      },
      {
        lineId: "L2",
        description: "Sovereign Landing Zone hub NSG & private endpoints (switzerlandnorth)",
        skuPartNumber: "MSP-SLZ-HUB",
        skuName: "Managed Sovereign Landing Zone",
        quantity: 1,
        unitPriceUsd: 2200,
        billingCycle: "monthly",
        entitlementGroup: null,
        semanticAnchor: false,
      },
    ],
    terms: [
      "P2 response 1 h / resolution 8 h (Gold)",
      "All data processing restricted to switzerlandnorth; DataResidency tag is audited monthly",
      "Inbound management access only via Bastion subnet 10.40.250.0/26",
    ],
  },
};
