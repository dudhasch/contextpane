import { z } from "zod";

export const RolePermissionCategorySchema = z.enum([
  "Microsoft Graph Permission",
  "Entra ID Built-In Role",
  "Azure RBAC Role",
]);
export type RolePermissionCategory = z.infer<typeof RolePermissionCategorySchema>;

export const RolePermissionGrantTypeSchema = z.enum([
  "Application",
  "Delegated",
  "Entra Directory Role",
  "Azure RBAC",
]);
export type RolePermissionGrantType = z.infer<typeof RolePermissionGrantTypeSchema>;

export const PrivilegeRiskTierSchema = z.enum([
  "Critical Tier-0",
  "High",
  "Least-Privilege",
]);
export type PrivilegeRiskTier = z.infer<typeof PrivilegeRiskTierSchema>;

export const RolePermissionEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  aliases: z.array(z.string()).default([]),
  guid: z.string(),
  category: RolePermissionCategorySchema,
  grantType: RolePermissionGrantTypeSchema,
  riskTier: PrivilegeRiskTierSchema,
  summary: z.string(),
  allowedActions: z.array(z.string()),
  leastPrivilegeAlternative: z.string(),
  referenceUrl: z.string().url(),
});
export type RolePermissionEntry = z.infer<typeof RolePermissionEntrySchema>;

export const PERMISSIONS_DICTIONARY: RolePermissionEntry[] = [
  /* ---------------------- Microsoft Graph Permissions ---------------------- */
  {
    id: "Directory.ReadWrite.All",
    displayName: "Directory.ReadWrite.All",
    aliases: ["Directory.ReadWrite.All (Application)", "Directory.ReadWrite.All (AppRole)"],
    guid: "19dbc75e-c2e2-444c-a770-ec69d8559fc7",
    category: "Microsoft Graph Permission",
    grantType: "Application",
    riskTier: "Critical Tier-0",
    summary:
      "Allows the application to read and write all directory data in Microsoft Entra ID (users, groups, service principals, domains, and group memberships) without a signed-in user.",
    allowedActions: [
      "PATCH /v1.0/users/{id} & POST /v1.0/users",
      "POST /v1.0/groups/{id}/members/$ref (modify security group memberships)",
      "POST /v1.0/applications/{id}/addPassword (credential injection on non-tier-0 apps)",
      "DELETE /v1.0/directoryObjects/{id}",
    ],
    leastPrivilegeAlternative:
      "User.Read.All (df021288-bdef-4463-88db-98f22de89214) + GroupMember.Read.All for directory sync; scope write operations to Administrative Units.",
    referenceUrl: "https://graphpermissions.merill.net/permission/Directory.ReadWrite.All",
  },
  {
    id: "Sites.FullControl.All",
    displayName: "Sites.FullControl.All",
    aliases: ["Sites.FullControl.All (Application)"],
    guid: "a82116e5-55eb-4c41-a434-62fe8a61c773",
    category: "Microsoft Graph Permission",
    grantType: "Application",
    riskTier: "Critical Tier-0",
    summary:
      "Grants full control over every SharePoint Online site collection, OneDrive for Business library, and site permission ACL across the entire tenant.",
    allowedActions: [
      "GET / PATCH / DELETE /v1.0/sites/{site-id}/lists/{list-id}/items",
      "POST /v1.0/sites/{site-id}/permissions (modify site collection admins)",
      "GET /v1.0/drives/{drive-id}/root/children (exfiltrate all tenant files)",
    ],
    leastPrivilegeAlternative:
      "Sites.Selected (883ea226-0bf2-4a8f-9f9d-92c9162a727d) with explicit per-site permission grant to only the ERP SharePoint site.",
    referenceUrl: "https://graphpermissions.merill.net/permission/Sites.FullControl.All",
  },
  {
    id: "Sites.Selected",
    displayName: "Sites.Selected",
    aliases: ["Sites.Selected (Application)"],
    guid: "883ea226-0bf2-4a8f-9f9d-92c9162a727d",
    category: "Microsoft Graph Permission",
    grantType: "Application",
    riskTier: "Least-Privilege",
    summary:
      "Allows access only to the specific SharePoint Online site collections explicitly granted via the /sites/{id}/permissions endpoint (zero tenant-wide blast radius).",
    allowedActions: [
      "GET / PATCH /v1.0/sites/{granted-site-id}/lists/{list-id}/items",
      "PUT /v1.0/sites/{granted-site-id}/drive/items/{item-id}/content",
    ],
    leastPrivilegeAlternative:
      "Already Least-Privilege (pair with read/write role on the single target site collection).",
    referenceUrl: "https://graphpermissions.merill.net/permission/Sites.Selected",
  },
  {
    id: "Mail.ReadWrite",
    displayName: "Mail.ReadWrite",
    aliases: ["Mail.ReadWrite (Application)", "Mail.ReadWrite.All"],
    guid: "e2a3a72e-5f79-4c64-b1b1-878b674786c9",
    category: "Microsoft Graph Permission",
    grantType: "Application",
    riskTier: "High",
    summary:
      "Allows the daemon application to read, create, update, and delete email in every mailbox in the organization without a signed-in user, including executive and admin mailboxes.",
    allowedActions: [
      "GET /v1.0/users/{id}/messages (read any user or executive mailbox)",
      "POST /v1.0/users/{id}/messages & PATCH /v1.0/users/{id}/mailFolders",
      "DELETE /v1.0/users/{id}/messages/{message-id}",
    ],
    leastPrivilegeAlternative:
      "Restrict with an Exchange Online ApplicationAccessPolicy (New-ApplicationAccessPolicy) scoped to a single mail-enabled security group, or use Mail.Send scoped to a dedicated service mailbox.",
    referenceUrl: "https://graphpermissions.merill.net/permission/Mail.ReadWrite",
  },
  {
    id: "User.Read.All",
    displayName: "User.Read.All",
    aliases: ["User.Read.All (Application)", "User.Read"],
    guid: "df021288-bdef-4463-88db-98f22de89214",
    category: "Microsoft Graph Permission",
    grantType: "Application",
    riskTier: "Least-Privilege",
    summary:
      "Allows the application to read user profiles, job titles, departments, and assigned licenses across the directory without write or mutation privileges.",
    allowedActions: [
      "GET /v1.0/users?$select=id,userPrincipalName,displayName,assignedLicenses",
      "GET /v1.0/users/{id}/licenseDetails",
    ],
    leastPrivilegeAlternative:
      "Already Least-Privilege for tenant-wide user attribute and license synchronization (or User.ReadBasic.All if only display names/UPNs are required).",
    referenceUrl: "https://graphpermissions.merill.net/permission/User.Read.All",
  },
  {
    id: "RoleManagement.ReadWrite.Directory",
    displayName: "RoleManagement.ReadWrite.Directory",
    aliases: ["RoleManagement.ReadWrite.Directory (Application)"],
    guid: "9e3f62cf-ca93-4989-b6ce-bf83c28f9fe8",
    category: "Microsoft Graph Permission",
    grantType: "Application",
    riskTier: "Critical Tier-0",
    summary:
      "Allows the application to read and manage all Microsoft Entra RBAC role assignments, including directly assigning Global Administrator to any user or service principal.",
    allowedActions: [
      "POST /v1.0/roleManagement/directory/roleAssignments (assign Global Admin)",
      "POST /v1.0/roleManagement/directory/roleEligibilityScheduleRequests",
      "DELETE /v1.0/roleManagement/directory/roleAssignments/{id}",
    ],
    leastPrivilegeAlternative:
      "RoleManagement.Read.Directory (483bed4a-2ad3-4361-a73b-c83ccdbdc53c) for auditing; require PIM human approval for any role elevation.",
    referenceUrl: "https://graphpermissions.merill.net/permission/RoleManagement.ReadWrite.Directory",
  },
  {
    id: "offline_access",
    displayName: "offline_access",
    aliases: ["offline_access (Delegated)"],
    guid: "7427e0e9-2fba-42fe-b0c0-848c9e6a8182",
    category: "Microsoft Graph Permission",
    grantType: "Delegated",
    riskTier: "Least-Privilege",
    summary:
      "Allows the application to receive OAuth2 refresh tokens to maintain access to resources a user has consented to even when the user is not actively interacting.",
    allowedActions: [
      "POST /oauth2/v2.0/token (grant_type=refresh_token)",
    ],
    leastPrivilegeAlternative:
      "Bind refresh tokens with Continuous Access Evaluation (CAE) and Conditional Access sign-in frequency controls.",
    referenceUrl: "https://graphpermissions.merill.net/permission/offline_access",
  },

  /* ----------------------- Entra ID Built-In Roles ----------------------- */
  {
    id: "Global Administrator",
    displayName: "Global Administrator",
    aliases: ["Global Admin", "Company Administrator", "62e90394-69f5-4237-9190-012177145e10"],
    guid: "62e90394-69f5-4237-9190-012177145e10",
    category: "Entra ID Built-In Role",
    grantType: "Entra Directory Role",
    riskTier: "Critical Tier-0",
    summary:
      "Unrestricted Tier-0 control over all administrative features in Microsoft Entra ID, Microsoft 365 services, Conditional Access policies, and Azure subscription elevation.",
    allowedActions: [
      "microsoft.directory/conditionalAccessPolicies/* (enable/disable/delete any CA policy)",
      "microsoft.directory/roleAssignments/allProperties/allTasks (assign any directory role)",
      "microsoft.directory/applications/credentials/update (mint secrets/certs on any app)",
      "Elevate access to manage all Azure subscriptions and management groups",
    ],
    leastPrivilegeAlternative:
      "Use PIM time-bound eligible assignments and split operational duties across Conditional Access Administrator, License Administrator, and Intune Administrator.",
    referenceUrl: "https://www.azadvertizer.net/azentrarolesadvertizer/62e90394-69f5-4237-9190-012177145e10.html",
  },
  {
    id: "Security Administrator",
    displayName: "Security Administrator",
    aliases: ["Security Admin", "194ae4cb-b126-40b2-bd5b-6091b380977d"],
    guid: "194ae4cb-b126-40b2-bd5b-6091b380977d",
    category: "Entra ID Built-In Role",
    grantType: "Entra Directory Role",
    riskTier: "High",
    summary:
      "Allows reading security information and reports, and managing configuration in Microsoft Entra ID, Microsoft 365 Defender, and Identity Protection.",
    allowedActions: [
      "microsoft.directory/conditionalAccessPolicies/standard/read",
      "microsoft.directory/identityProtection/allProperties/allTasks",
      "microsoft.office365.security/allEntities/allTasks",
    ],
    leastPrivilegeAlternative:
      "Security Reader (5d6b6bb7-de71-4623-b4af-96380a352509) for SOC monitoring; Conditional Access Administrator only when modifying CA policies.",
    referenceUrl: "https://www.azadvertizer.net/azentrarolesadvertizer/194ae4cb-b126-40b2-bd5b-6091b380977d.html",
  },
  {
    id: "Global & Security Admins (Role)",
    displayName: "Global & Security Admins (Role)",
    aliases: ["Global & Security Admins", "Global and Security Admins", "Privileged Admin Roles"],
    guid: "62e90394-69f5-4237-9190-012177145e10",
    category: "Entra ID Built-In Role",
    grantType: "Entra Directory Role",
    riskTier: "Critical Tier-0",
    summary:
      "Conditional Access directory role target scope matching Global Administrator (62e90394-69f5-4237-9190-012177145e10) and Security Administrator (194ae4cb-b126-40b2-bd5b-6091b380977d) Requiring phishing-resistant FIDO2 MFA.",
    allowedActions: [
      "microsoft.directory/conditionalAccessPolicies/* (Tier-0 security policy management)",
      "microsoft.directory/roleAssignments/allProperties/allTasks",
      "microsoft.directory/identityProtection/allProperties/allTasks",
    ],
    leastPrivilegeAlternative:
      "Enforce phishing-resistant MFA (FIDO2 / Windows Hello for Business) on all Tier-0 roles while excluding emergency break-glass accounts (SG-BreakGlass-Accounts).",
    referenceUrl: "https://www.azadvertizer.net/azentrarolesadvertizer/62e90394-69f5-4237-9190-012177145e10.html",
  },
  {
    id: "Application Administrator",
    displayName: "Application Administrator",
    aliases: ["Application Admin", "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3"],
    guid: "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3",
    category: "Entra ID Built-In Role",
    grantType: "Entra Directory Role",
    riskTier: "Critical Tier-0",
    summary:
      "Allows creating and managing all aspects of app registrations and enterprise applications, including adding client secrets/certificates to privileged service principals (Tier-0 escalation path).",
    allowedActions: [
      "microsoft.directory/applications/credentials/update (add client secret/cert to any app)",
      "microsoft.directory/servicePrincipals/appRoleAssignedTo/update",
      "microsoft.directory/applications/owners/update",
    ],
    leastPrivilegeAlternative:
      "Use Cloud Application Administrator scoped to specific Administrative Units or custom role with applications/credentials/update restricted to non-privileged apps.",
    referenceUrl: "https://www.azadvertizer.net/azentrarolesadvertizer/9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3.html",
  },
  {
    id: "Cloud Application Administrator",
    displayName: "Cloud Application Administrator",
    aliases: ["Cloud App Admin", "158c047a-c907-4556-b7ef-446551a6b5f7"],
    guid: "158c047a-c907-4556-b7ef-446551a6b5f7",
    category: "Entra ID Built-In Role",
    grantType: "Entra Directory Role",
    riskTier: "High",
    summary:
      "Allows creating and managing all enterprise applications and app registrations (including credentials and federated OIDC trusts) except Microsoft Entra Application Proxy.",
    allowedActions: [
      "microsoft.directory/applications/credentials/update",
      "microsoft.directory/applications/federatedIdentityCredentials/*",
      "microsoft.directory/servicePrincipals/standard/read",
    ],
    leastPrivilegeAlternative:
      "Assign Application Developer (cf1c38e5-3621-4004-a7cb-879624dced7c) or scope credential management via Federated Identity Credentials (OIDC) without human app owners.",
    referenceUrl: "https://www.azadvertizer.net/azentrarolesadvertizer/158c047a-c907-4556-b7ef-446551a6b5f7.html",
  },

  /* --------------------------- Azure RBAC Roles --------------------------- */
  {
    id: "Owner",
    displayName: "Owner (Azure RBAC)",
    aliases: ["Owner", "Subscription Owner", "8e3af657-a8ff-443c-a75c-2fe8c4bcb635"],
    guid: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
    category: "Azure RBAC Role",
    grantType: "Azure RBAC",
    riskTier: "Critical Tier-0",
    summary:
      "Grants full access to manage all Azure resources across the scope, including assigning Azure RBAC roles in Microsoft.Authorization and deleting policy locks.",
    allowedActions: [
      "* (All control plane actions across all Azure resource providers)",
      "Microsoft.Authorization/roleAssignments/write",
      "Microsoft.Authorization/policyExemptions/write",
    ],
    leastPrivilegeAlternative:
      "Virtual Machine Contributor or Network Contributor scoped to the specific resource group (e.g. rg-contoso-avd-prod).",
    referenceUrl: "https://www.azadvertizer.net/azrolesadvertizer/8e3af657-a8ff-443c-a75c-2fe8c4bcb635.html",
  },
  {
    id: "Contributor",
    displayName: "Contributor (Azure RBAC)",
    aliases: ["Contributor", "b24988ac-6180-42a0-ab88-20f7382dd24c"],
    guid: "b24988ac-6180-42a0-ab88-20f7382dd24c",
    category: "Azure RBAC Role",
    grantType: "Azure RBAC",
    riskTier: "High",
    summary:
      "Grants full access to create, modify, and delete all Azure resources in the subscription or resource group, but cannot assign RBAC roles or create policy exemptions.",
    allowedActions: [
      "Microsoft.Compute/virtualMachines/write & delete",
      "Microsoft.Network/networkSecurityGroups/securityRules/write",
      "Microsoft.Resources/deployments/write",
    ],
    leastPrivilegeAlternative:
      "Virtual Machine Contributor (9980e02c-c2be-4d73-94e8-173b1dc7cf3c) or Network Contributor scoped to the target resource group.",
    referenceUrl: "https://www.azadvertizer.net/azrolesadvertizer/b24988ac-6180-42a0-ab88-20f7382dd24c.html",
  },
  {
    id: "Virtual Machine Contributor",
    displayName: "Virtual Machine Contributor",
    aliases: ["VM Contributor", "9980e02c-c2be-4d73-94e8-173b1dc7cf3c"],
    guid: "9980e02c-c2be-4d73-94e8-173b1dc7cf3c",
    category: "Azure RBAC Role",
    grantType: "Azure RBAC",
    riskTier: "Least-Privilege",
    summary:
      "Allows creating and managing virtual machines, managed disks, and VM extensions, and connecting VMs to existing virtual networks without modifying NSG rules or RBAC.",
    allowedActions: [
      "Microsoft.Compute/virtualMachines/*",
      "Microsoft.Compute/disks/*",
      "Microsoft.Network/virtualNetworks/subnets/join/action",
      "Microsoft.Resources/deployments/*",
    ],
    leastPrivilegeAlternative:
      "Already Least-Privilege for VM provisioning (cannot bypass Azure Policy Allowed Locations or modify NSGs).",
    referenceUrl: "https://www.azadvertizer.net/azrolesadvertizer/9980e02c-c2be-4d73-94e8-173b1dc7cf3c.html",
  },
  {
    id: "Network Contributor",
    displayName: "Network Contributor",
    aliases: ["4d97b98b-1d4f-4787-a291-c67834d212e7"],
    guid: "4d97b98b-1d4f-4787-a291-c67834d212e7",
    category: "Azure RBAC Role",
    grantType: "Azure RBAC",
    riskTier: "High",
    summary:
      "Allows managing Virtual Networks, Network Security Groups (NSGs), security rules, and Load Balancers, without access to VMs or RBAC.",
    allowedActions: [
      "Microsoft.Network/networkSecurityGroups/*",
      "Microsoft.Network/networkSecurityGroups/securityRules/write & delete",
      "Microsoft.Network/virtualNetworks/*",
    ],
    leastPrivilegeAlternative:
      "Enforce NSG rule modifications exclusively via GitOps Terraform CI/CD OIDC pipeline with Azure Policy Deny-Public-RDP-3389 guardrails.",
    referenceUrl: "https://www.azadvertizer.net/azrolesadvertizer/4d97b98b-1d4f-4787-a291-c67834d212e7.html",
  },
  {
    id: "Key Vault Administrator",
    displayName: "Key Vault Administrator",
    aliases: ["00482a5a-887f-4fb3-b363-3b7fe8e74483"],
    guid: "00482a5a-887f-4fb3-b363-3b7fe8e74483",
    category: "Azure RBAC Role",
    grantType: "Azure RBAC",
    riskTier: "High",
    summary:
      "Allows performing all data plane operations on a Key Vault, including reading, writing, and purging keys, secrets, and certificates.",
    allowedActions: [
      "Microsoft.KeyVault/vaults/secrets/*",
      "Microsoft.KeyVault/vaults/keys/*",
      "Microsoft.KeyVault/vaults/certificates/*",
    ],
    leastPrivilegeAlternative:
      "Key Vault Secrets User (4633458b-17de-408a-b874-0445c86b69e6) for read-only secret retrieval by managed identities.",
    referenceUrl: "https://www.azadvertizer.net/azrolesadvertizer/00482a5a-887f-4fb3-b363-3b7fe8e74483.html",
  },
  {
    id: "Reader",
    displayName: "Reader (Azure RBAC)",
    aliases: ["Reader", "acdd72a7-3385-48ef-bd42-f606fba81ae7"],
    guid: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
    category: "Azure RBAC Role",
    grantType: "Azure RBAC",
    riskTier: "Least-Privilege",
    summary:
      "Allows viewing all Azure resources, ARM deployment history, and regional compute quotas without making any changes or reading Key Vault secrets.",
    allowedActions: [
      "*/read",
      "Microsoft.Compute/locations/usages/read",
      "Microsoft.Authorization/policyStates/read",
    ],
    leastPrivilegeAlternative:
      "Already Least-Privilege for read-only Azure resource and quota inspection.",
    referenceUrl: "https://www.azadvertizer.net/azrolesadvertizer/acdd72a7-3385-48ef-bd42-f606fba81ae7.html",
  },
];

const BY_NORMALIZED_KEY = new Map<string, RolePermissionEntry>();
for (const entry of PERMISSIONS_DICTIONARY) {
  BY_NORMALIZED_KEY.set(entry.id.toLowerCase(), entry);
  BY_NORMALIZED_KEY.set(entry.displayName.toLowerCase(), entry);
  BY_NORMALIZED_KEY.set(entry.guid.toLowerCase(), entry);
  for (const alias of entry.aliases) {
    BY_NORMALIZED_KEY.set(alias.toLowerCase(), entry);
  }
}

/**
 * Look up a Microsoft Graph permission, Entra ID directory role, or Azure RBAC role
 * by its name, scope string, alias, or GUID.
 */
export function lookupRoleOrPermission(query: string | null | undefined): RolePermissionEntry | null {
  if (!query) return null;
  const cleaned = query.trim();
  if (!cleaned) return null;
  const direct = BY_NORMALIZED_KEY.get(cleaned.toLowerCase());
  if (direct) return direct;

  // Strip parenthetical qualifiers like "(Application)" or "(Role)" if not matched directly
  const stripped = cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  if (stripped && BY_NORMALIZED_KEY.has(stripped)) {
    return BY_NORMALIZED_KEY.get(stripped)!;
  }

  // Substring / prefix match for compound pills like "Directory.ReadWrite.All · Sites.FullControl.All"
  const lower = cleaned.toLowerCase();
  for (const entry of PERMISSIONS_DICTIONARY) {
    if (lower.includes(entry.id.toLowerCase())) {
      return entry;
    }
    for (const alias of entry.aliases) {
      if (alias.length >= 6 && lower.includes(alias.toLowerCase())) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Return all matching role/permission entries inside a compound label or text block.
 */
export function findRolePermissionsInText(text: string | null | undefined): RolePermissionEntry[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: RolePermissionEntry[] = [];
  const seen = new Set<string>();
  for (const entry of PERMISSIONS_DICTIONARY) {
    const terms = [entry.id, entry.displayName, ...entry.aliases];
    for (const term of terms) {
      if (term.length < 5) continue;
      if (lower.includes(term.toLowerCase()) && !seen.has(entry.id)) {
        seen.add(entry.id);
        found.push(entry);
        break;
      }
    }
  }
  return found;
}
