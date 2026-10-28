import type { ContextViewMode } from "@contextpane/catalog";

export interface QuickChip {
  label: string;
  prompt: string;
  viewMode: ContextViewMode;
}

/** One-click tenant lenses. The first three are the "Try:" suggestions; the rest live in the "More…" popover. */
export const QUICK_TENANT_CHIPS: QuickChip[] = [
  { label: "Azure VMs (Get-AzVM)", prompt: "what vms do we have ?", viewMode: "dashboard" },
  { label: "Users & License Drift", prompt: "Entra ID users, SKU assignments, and disabled accounts holding licenses", viewMode: "dashboard" },
  { label: "Workload Identities & OIDC", prompt: "Service principal client secret expiry, OIDC federation, and app permissions", viewMode: "blast-radius" },
  { label: "Azure ARM Resources", prompt: "what resources do we have ?", viewMode: "dashboard" },
  { label: "Conditional Access Posture", prompt: "Conditional Access policies, report-only drift, and break-glass exclusions", viewMode: "comparison" },
  { label: "Failed Sign-In Audit", prompt: "Failed Entra sign-in events, AADSTS error codes, and blocking policies", viewMode: "dashboard" },
  { label: "Intune Device Compliance", prompt: "Non-compliant and conflicting Intune managed devices and settings catalog", viewMode: "full-card" },
  { label: "Azure Quotas & Policies", prompt: "Azure regional vCPU compute quotas, NSG rules, and policy compliance", viewMode: "dashboard" },
];

/** Number of tenant chips shown inline as "Try:" suggestions when no lens is open. */
export const TRY_CHIP_COUNT = 3;

/** Reference matrices (knowledge scope). Rendered in the "Knowledge matrices" fold of the context zone. */
export const QUICK_KNOWLEDGE_CHIPS: QuickChip[] = [
  { label: "Token Protection vs CAE", prompt: "Compare Entra ID Conditional Access Token Protection vs Continuous Access Evaluation (CAE)", viewMode: "comparison" },
  { label: "Private Link vs Service Endpoints", prompt: "Compare Azure Private Link (Private Endpoints) vs VNet Service Endpoints for PaaS security", viewMode: "comparison" },
  { label: "Zero Trust Break-Glass", prompt: "Zero Trust emergency break-glass account architecture, FIDO2 binding, and monitoring", viewMode: "full-card" },
  { label: "OIDC vs Client Secrets", prompt: "Workload Identity Federation (OIDC) subject claims vs static client secrets (AADSTS7000222 / AADSTS70021)", viewMode: "blast-radius" },
  { label: "AVD Reverse Connect", prompt: "Azure Virtual Desktop Reverse Connect TLS 443 transport vs inbound TCP 3389 RDP exposure", viewMode: "dashboard" },
];

export const OVERVIEW_PROMPT = "Live Tenant Identity, Licensing, Conditional Access & Infrastructure Posture Overview";
