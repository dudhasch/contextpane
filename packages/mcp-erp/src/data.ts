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
    title: "Six Windows 11 laptops lost access to Outlook and Teams: BitLocker not encrypting",
    description:
      "Fabrikam Legal reports that six Windows 11 laptops lost access to Outlook, Teams and SharePoint this morning. " +
      "Affected user: grady.archie.legal@fabrikamlegal.onmicrosoft.com sees AADSTS53000 (device not compliant). Intune shows " +
      "silent BitLocker encryption failing with 0x87D1FDE8 on the devices in SG-Fabrikam-Win11-Devices since the new Endpoint Security " +
      "disk encryption baseline was rolled out; the 7-day grace period of Fabrikam-Win11-Compliance expired yesterday. " +
      "A legacy Fabrikam-Legacy-BitLocker-DeviceConfig profile from the 2024 rollout is still assigned to the same group.",
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
      "debra.berger.legal@fabrikamlegal.onmicrosoft.com",
    ],
    affectedGroups: ["SG-Fabrikam-Win11-Devices"],
    relatedContractId: "CNT-2026-912",
    category: "Endpoint Management / Intune",
    entities: [
      { type: "upn", id: "grady.archie.legal@fabrikamlegal.onmicrosoft.com", label: "grady.archie.legal@fabrikamlegal.onmicrosoft.com" },
      { type: "errorCode", id: "AADSTS53000", label: "AADSTS53000" },
      { type: "errorCode", id: "0x87D1FDE8", label: "0x87D1FDE8" },
      { type: "group", id: "SG-Fabrikam-Win11-Devices", label: "SG-Fabrikam-Win11-Devices" },
      { type: "policy", id: "Fabrikam-Win11-Compliance", label: "Fabrikam-Win11-Compliance" },
      { type: "policy", id: "Fabrikam-Legacy-BitLocker-DeviceConfig", label: "Fabrikam-Legacy-BitLocker-DeviceConfig" },
    ],
    infrastructureSpec:
      "Devices: 40x Windows 11 Enterprise 24H2, Microsoft Entra joined, Intune managed\n" +
      "Assignment group: SG-Fabrikam-Win11-Devices\n" +
      "Disk encryption: Fabrikam-EndpointSecurity-DiskEncryption (XTS-AES 256, silent)\n" +
      "Compliance: Fabrikam-Win11-Compliance (BitLocker required, 7-day grace period)\n" +
      "Conditional Access: Require compliant device for Office 365",
    timeline: [
      { at: "2026-10-18T09:00:00Z", actor: "Fabrikam IT", note: "Endpoint Security disk encryption baseline assigned to SG-Fabrikam-Win11-Devices." },
      { at: "2026-10-18T11:30:00Z", actor: "Intune", note: "First devices report BitLocker 0x87D1FDE8; compliance grace period starts." },
      { at: "2026-10-25T11:30:00Z", actor: "Intune", note: "Grace period expired: six devices NonCompliant." },
      { at: "2026-10-26T07:20:00Z", actor: "Grady Archie", note: "Ticket opened: Outlook and Teams blocked with AADSTS53000." },
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
    title: "Fabrikam Legal: Modern Workplace & Intune Managed Service",
    startDate: "2026-03-01",
    endDate: "2027-02-28",
    slaTier: "Gold",
    monthlyValueUsd: 1142,
    lines: [
      {
        lineId: "L1",
        description: "6x Microsoft 365 E5 (SPE_E5) for SG-Fabrikam-Legal",
        skuPartNumber: "SPE_E5",
        skuName: "Microsoft 365 E5",
        quantity: 6,
        unitPriceUsd: 57,
        billingCycle: "monthly",
        entitlementGroup: "SG-Fabrikam-Legal",
        semanticAnchor: true,
      },
      {
        lineId: "L2",
        description: "Managed Intune endpoints (40 Windows 11 devices, golden baseline in Git)",
        skuPartNumber: "MSP-INTUNE-ENDPOINT",
        skuName: "Managed Intune Endpoint",
        quantity: 40,
        unitPriceUsd: 20,
        billingCycle: "monthly",
        entitlementGroup: "SG-Fabrikam-Win11-Devices",
        semanticAnchor: false,
      },
    ],
    terms: [
      "P2 response 1 h / resolution 8 h (Gold)",
      "Intune configuration changes via the golden-tenant Git repository only; portal changes are drift",
      "Device compliance reported weekly; BitLocker required on every managed device",
    ],
  },
};
