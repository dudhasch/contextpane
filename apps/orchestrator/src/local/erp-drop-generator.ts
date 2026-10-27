import { Canvas, type Rgb } from "./png.ts";

/**
 * Random ERP ticket drops: a realistic `ticketbody.json` plus a customer "screenshot"
 * (`attachment1.png`) that matches the symptom, written as a folder into input/tickets/#<id>/.
 * Entities, error codes and infrastructure targets are the ones the live-seeded lab tenant
 * knows, so the Tier 0 extractor resolves them. The PowerShell twin is
 * scripts/New-RandomErpTicketDrop.ps1; both exercise the same inbox watcher.
 */

export const DROP_ARCHETYPES = ["AVD", "Intune", "CA", "WorkloadIdentity", "Licensing", "Mixed"] as const;
export type DropArchetype = (typeof DROP_ARCHETYPES)[number];

export interface ErpTicketBody {
  id: string;
  incidentId?: string;
  category?: string;
  severity?: string;
  source: "ERP";
  subject: string;
  description: string;
  customer: string;
  tenantDomain?: string;
  tenantId?: string;
  subscriptionId?: string;
  requester: { displayName: string; upn: string; role: string };
  priority: "P1" | "P2" | "P3";
  createdAt: string;
  attachments: string[];
  /** The symptom the screenshot shows; also embedded in the PNG's tEXt chunks. */
  telemetry: { errorCode: string; correlationId: string; timestamp: string; device: string };
}

export interface GeneratedDrop {
  folder: string;
  displayId: string;
  archetype: DropArchetype;
  body: ErpTicketBody;
  png: Uint8Array;
}

interface Persona {
  displayName: string;
  upn: string;
  role: string;
  device: string;
}

const DOMAIN = "c4a8shili.onmicrosoft.com";
const TENANT_GUID = "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea";
const SUBSCRIPTION_GUID = "20505597-043c-4742-a884-42dc3f621aef";

const PEOPLE: Persona[] = [
  { displayName: "Lynne Robins", upn: `lynne.robins.contoso@${DOMAIN}`, role: "Finance Analyst", device: "CONTOSO-LT-0471" },
  { displayName: "Diego Siciliani", upn: `diego.siciliani.contoso@${DOMAIN}`, role: "Finance Controller", device: "CONTOSO-LT-0488" },
  { displayName: "Patti Fernandez", upn: `patti.fernandez.contoso@${DOMAIN}`, role: "Accounts Payable", device: "CONTOSO-FIN-014" },
  { displayName: "Alex Wilber", upn: `alex.wilber.contoso@${DOMAIN}`, role: "Contractor · ERP Integration", device: "CONTOSO-FIN-021" },
];

const MIRIAM: Persona = {
  displayName: "Miriam Graham",
  upn: `miriam.graham.contoso@${DOMAIN}`,
  role: "Financial Controller",
  device: "CONTOSO-LT-0288",
};

export interface LabIncidentSpec {
  /** Folder & ERP display id, e.g. `#202688412` (maps to `ERP-202688412`). */
  id: string;
  /** Canonical incident id from the escalation queue, e.g. `INC-2026-88412`. */
  incidentId: string;
  category: string;
  severity: string;
  priority: ErpTicketBody["priority"];
  archetype: DropArchetype;
  subject: string;
  description: string;
  requester: Persona;
  createdAt: string;
  errorCode: string;
  correlationId: string;
  dialogTitle: string;
  dialogLines: string[];
  app: string;
}

/**
 * 20 MSP L3 escalation tickets specialized for the live lab tenant `c4a8shili.onmicrosoft.com`
 * (Contoso Finance, tenantId 4cc41c20-8b01-40a3-93c6-b4f1e846f6ea, sub 20505597-043c-4742-a884-42dc3f621aef).
 * Contains only the trigger, client IT escalation note, and telemetry/error payload — never the resolution.
 */
export const LAB_INCIDENT_TICKETS: readonly LabIncidentSpec[] = [
  {
    id: "#202688412",
    incidentId: "INC-2026-88412",
    category: "Category 1: Microsoft Entra ID, Conditional Access & Hybrid Identity",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "CA",
    subject: "INC-2026-88412 · Conditional Access Lockout on Intune Enrollment & AVD Control Plane",
    description: [
      `Trigger: Mass user lockout in ${DOMAIN} after client IT modified Conditional Access Policy CAP-004-Require-Compliant-Device ([ContextPane-Demo] CA-004-Block-Legacy-Auth / CA-001-Require-PhishingResistant-MFA-Admins).`,
      "",
      "Client IT Escalation Note:",
      `"We updated CAP-004 (CA-004) in ${DOMAIN} 20 minutes ago to enforce 'Require device to be marked as compliant' across 'All cloud apps' for SG-Contoso-Finance-AVD and SG-All-Workstations to close an audit finding. Immediately after, new Autopilot deployments on CONTOSO-LT-0488 and CONTOSO-LT-0519 started failing mid-ESP, and remote Finance users (lynne.robins.contoso@${DOMAIN}, patti.fernandez.contoso@${DOMAIN}) cannot launch Azure Virtual Desktop sessions on vdpool-contoso-fin-01—even on devices that show 'Compliant' in Intune (CONTOSO-LT-0471). Worse, our own L2 admins are getting blocked when trying to open the Intune portal from our jump host in rg-contoso-avd-prod. Since your MSP team holds the break-glass Global Admin accounts (bg-admin-01@${DOMAIN} in SG-BreakGlass-Accounts), we need an immediate rollback or exclusion fix."`,
      "",
      "Telemetry / Error Payload:",
      "Sign-in error code: AADSTS53003 (53003)",
      "Failure reason: Access has been blocked by Conditional Access policies.",
      `Tenant: ${DOMAIN} (${TENANT_GUID})`,
      "Application: Microsoft Intune Enrollment (d4ebce55-015a-49b5-a083-c84d1797ae8c)",
      "Resource: Windows Azure Service Management API (797f4846-ba00-4fd7-ba43-dac1f8f63013)",
      "Device state: Unregistered / Non-Compliant (Evaluating)",
    ].join("\n"),
    requester: PEOPLE[1]!,
    createdAt: "2026-10-27T07:40:00Z",
    errorCode: "AADSTS53003",
    correlationId: "88412001-4c2a-4b11-9a01-c4a853003001",
    dialogTitle: "MICROSOFT ENTRA - SIGN-IN BLOCKED",
    dialogLines: [
      "ERROR AADSTS53003: ACCESS BLOCKED",
      "BY CONDITIONAL ACCESS (CAP-004)",
      "",
      `USER: DIEGO.SICILIANI.CONTOSO@${DOMAIN.toUpperCase()}`,
      "APP: MICROSOFT INTUNE ENROLLMENT",
      "RESOURCE: WINDOWS AZURE SERVICE MGMT API",
    ],
    app: "Microsoft Intune Enrollment",
  },
  {
    id: "#202688419",
    incidentId: "INC-2026-88419",
    category: "Category 1: Microsoft Entra ID, Conditional Access & Hybrid Identity",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "AVD",
    subject: "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening",
    description: [
      `Trigger: Entra Domain Services health status in ${DOMAIN} transitioned to Critical (AADDS104: Network error) and AADDS501 (Replica set offline).`,
      "",
      "Client IT Escalation Note:",
      `"Our legacy Finance ERP connector in rg-contoso-avd-prod (vnet-contoso-avd-prod) suddenly lost LDAPS and Kerberos authentication against our managed domain (aadds.${DOMAIN}) used by SG-Contoso-Finance-Legacy and vdpool-contoso-fin-01. Yesterday our network team cleaned up 'permissive' inbound/outbound rules on nsg-contoso-avd-hostpool-01 (nsg-aadds-subnet) to satisfy a pentest report. Now the Entra portal for ${DOMAIN} shows the managed domain is unhealthy and hasn't synced password hashes for 14 hours. We tried removing our custom deny rule, but the health check won't clear and we can't RDP into the domain controllers because Microsoft manages them."`,
      "",
      "Telemetry / Error Payload:",
      JSON.stringify(
        {
          alertCode: "AADDS104",
          secondaryAlertCode: "AADDS501",
          severity: "Error",
          tenantId: TENANT_GUID,
          managedDomain: `aadds.${DOMAIN}`,
          nsg: "nsg-contoso-avd-hostpool-01",
          raisedAt: "2026-10-27T04:15:00Z",
          issue: "The platform is unable to reach the domain controllers for this managed domain.",
        },
        null,
        2,
      ),
    ].join("\n"),
    requester: PEOPLE[0]!,
    createdAt: "2026-10-27T07:45:00Z",
    errorCode: "AADDS104",
    correlationId: "88419002-5d3b-4c22-8b02-c4a8aadds104",
    dialogTitle: "ENTRA DOMAIN SERVICES - CRITICAL ALERT",
    dialogLines: [
      "ERROR AADDS104 / AADDS501",
      "MANAGED DOMAIN REPLICA SET OFFLINE",
      "",
      `DOMAIN: AADDS.${DOMAIN.toUpperCase()}`,
      "NSG: NSG-CONTOSO-AVD-HOSTPOOL-01",
      "STATUS: SUSPENDED (HEARTBEAT LOST)",
    ],
    app: "Microsoft Entra Domain Services",
  },
  {
    id: "#202688425",
    incidentId: "INC-2026-88425",
    category: "Category 1: Microsoft Entra ID, Conditional Access & Hybrid Identity",
    severity: "Sev 1 (Security Incident)",
    priority: "P1",
    archetype: "CA",
    subject: "INC-2026-88425 · Entra ID Protection — Persistent Impossible Travel & Token Replay (AiTM)",
    description: [
      `Trigger: Automated Entra ID Protection alert in ${DOMAIN}: Users at risk detected (Risk Level: High) via Impossible Travel and Anomalous Token.`,
      "",
      "Client IT Escalation Note:",
      `"We received a High Risk alert in ${DOMAIN} for our Financial Controller (miriam.graham.contoso@${DOMAIN} on CONTOSO-LT-0288, member of SG-Contoso-Finance-AVD and SG-Contoso-M365-E5). The Entra sign-in log shows a sign-in from Zurich followed 4 minutes later by an IP in Bucharest (AS9009 M247 Europe). We forced a password reset in Active Directory twice and synced it via Entra Connect, and Miriam confirmed MFA via Authenticator number matching under CA-001-Require-PhishingResistant-MFA-Admins. However, 15 minutes after the second password reset, ID Protection flagged another anomalous sign-in from a different hosting ASN! Why is the password reset not kicking the attacker out?"`,
      "",
      "Telemetry / Error Payload:",
      "RiskEventType: anomalousToken / impossibleTravel",
      `UserPrincipalName: miriam.graham.contoso@${DOMAIN}`,
      `TenantId: ${TENANT_GUID} (${DOMAIN})`,
      "TokenIssuerType: AzureAD",
      "AuthenticationRequirement: multiFactorAuthentication",
      "IncomingTokenType: primaryRefreshToken / refreshToken",
      "ClientAppUsed: Browser (Edge 130.0.0.0)",
    ].join("\n"),
    requester: MIRIAM,
    createdAt: "2026-10-27T07:50:00Z",
    errorCode: "AnomalousToken",
    correlationId: "88425003-6e4c-4d33-9c03-c4a8aitm0003",
    dialogTitle: "ENTRA ID PROTECTION - HIGH RISK USER",
    dialogLines: [
      "ERROR: ANOMALOUSTOKEN / IMPOSSIBLE TRAVEL",
      "RISK LEVEL: HIGH (TOKEN REPLAY)",
      "",
      `USER: MIRIAM.GRAHAM.CONTOSO@${DOMAIN.toUpperCase()}`,
      "ASN: AS9009 M247 EUROPE (BUCHAREST)",
      "TOKEN: PRIMARYREFRESHTOKEN / REFRESHTOKEN",
    ],
    app: "Microsoft Entra ID Protection",
  },
  {
    id: "#202688431",
    incidentId: "INC-2026-88431",
    category: "Category 1: Microsoft Entra ID, Conditional Access & Hybrid Identity",
    severity: "Sev 2 (High)",
    priority: "P2",
    archetype: "WorkloadIdentity",
    subject: "INC-2026-88431 · PIM Governance Alert — Out-of-Band Permanent Role Assignment via CI/CD",
    description: [
      `Trigger: Native Entra PIM Alert in ${DOMAIN}: Roles are being assigned outside of Privileged Identity Management & Roles don't require multi-factor authentication for activation.`,
      "",
      "Client IT Escalation Note:",
      `"Our CISO at Contoso Finance (${DOMAIN}) got two automated PIM digest emails this morning flagging that permanent privileged roles were assigned outside PIM, and that a privileged role allows activation without MFA. We don't even have permissions to edit PIM role settings or assign permanent directory roles—only your MSP engineers (SG-ContextPane-Demo-Admins) and our automated deployment pipelines (spn-contoso-erp-sync, owned by contractor alex.wilber@${DOMAIN} with Directory.ReadWrite.All and RoleManagement.ReadWrite.Directory) have high privileges. Can you check the Entra Audit Logs in ${DOMAIN}, find out who bypassed PIM, and lock it down?"`,
      "",
      "Telemetry / Error Payload:",
      JSON.stringify(
        {
          activityDisplayName: "Add member to role outside of PIM (permanent)",
          tenantId: TENANT_GUID,
          initiatedBy: {
            app: {
              displayName: "spn-contoso-erp-sync",
              appId: "44b8e1a7-3c5d-4f2a-9b6e-7d8c9a0b1e2f",
              servicePrincipalId: "8d2e3f4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a",
            },
          },
          targetResources: [{ displayName: "Application Administrator", type: "Role" }],
        },
        null,
        2,
      ),
    ].join("\n"),
    requester: PEOPLE[3]!,
    createdAt: "2026-10-27T07:55:00Z",
    errorCode: "PIMRoleOutsideGovernance",
    correlationId: "88431004-7f5d-4e44-8d04-c4a8pim00004",
    dialogTitle: "ENTRA PIM - GOVERNANCE ALERT",
    dialogLines: [
      "ERROR: PIMROLEOUTSIDEGOVERNANCE",
      "PERMANENT ROLE ASSIGNED OUTSIDE PIM",
      "",
      "INITIATED BY: SPN-CONTOSO-ERP-SYNC",
      "ROLE: APPLICATION ADMINISTRATOR",
      `OWNER: ALEX.WILBER@${DOMAIN.toUpperCase()}`,
    ],
    app: "Microsoft Entra PIM",
  },
  {
    id: "#202688440",
    incidentId: "INC-2026-88440",
    category: "Category 1: Microsoft Entra ID, Conditional Access & Hybrid Identity",
    severity: "Sev 3 (Medium)",
    priority: "P3",
    archetype: "CA",
    subject: "INC-2026-88440 · Entra Connect Sync Failure — LargeObject on userCertificate Attribute",
    description: [
      `Trigger: Entra Connect Health alert for ${DOMAIN}: Export Errors detected during synchronization cycle.`,
      "",
      "Client IT Escalation Note:",
      `"Three Finance leadership accounts (lynne.robins.contoso@${DOMAIN}, diego.siciliani.contoso@${DOMAIN}, and patti.fernandez.contoso@${DOMAIN}) are no longer syncing changes from our on-prem AD to Entra ID (${DOMAIN}). Specifically, UPN/proxyAddress updates and group memberships for SG-Contoso-Finance-AVD and SG-Contoso-M365-E5 are stuck. Synchronization Service Manager on SRV-ENTRACONNECT-01 shows a LargeObject export error on the Connector Space for ${DOMAIN}. We didn't attach any huge photos to their AD accounts—thumbnailPhoto is only 12 KB. We're afraid to touch the sync rules in the Synchronization Rules Editor."`,
      "",
      "Telemetry / Error Payload:",
      "Error Type: LargeObject",
      "Fault Details: ExceededAllowedLength",
      `Connector Space: ${DOMAIN} (${TENANT_GUID})`,
      "Attribute Name: userCertificate",
      `Affected Users: lynne.robins.contoso@${DOMAIN}, diego.siciliani.contoso@${DOMAIN}, patti.fernandez.contoso@${DOMAIN}`,
      "Description: The attribute 'userCertificate' exceeded the maximum allowed length of 15 multi-valued entries in Microsoft Entra ID. Current count in AD: 23.",
    ].join("\n"),
    requester: PEOPLE[2]!,
    createdAt: "2026-10-27T08:00:00Z",
    errorCode: "LargeObject",
    correlationId: "88440005-8a6e-4f55-9e05-c4a8sync0005",
    dialogTitle: "ENTRA CONNECT HEALTH - EXPORT ERROR",
    dialogLines: [
      "ERROR: LARGEOBJECT (EXCEEDEDALLOWEDLENGTH)",
      "ATTRIBUTE: USERCERTIFICATE (23 > MAX 15)",
      "",
      `CONNECTOR: ${DOMAIN.toUpperCase()}`,
      `USER: PATTI.FERNANDEZ.CONTOSO@${DOMAIN.toUpperCase()}`,
      "SERVER: SRV-ENTRACONNECT-01",
    ],
    app: "Microsoft Entra Connect Sync",
  },
  {
    id: "#202688449",
    incidentId: "INC-2026-88449",
    category: "Category 1: Microsoft Entra ID, Conditional Access & Hybrid Identity",
    severity: "Sev 3 (Medium)",
    priority: "P3",
    archetype: "CA",
    subject: "INC-2026-88449 · B2B Guest Redemption Failure (AADSTS50020) After Partner Tenant Migration",
    description: [
      `Trigger: External supplier & audit engineers locked out of SharePoint and Azure DevOps in ${DOMAIN} (AADSTS50020 / AlternativeSecurityId mismatch).`,
      "",
      "Client IT Escalation Note:",
      `"Our external ERP & CAD engineering partner merged with another company over the weekend and migrated their M365 tenant, keeping the exact same email domain (@partner-eng.com). Today, all 18 of their B2B guest users in our tenant (${DOMAIN}, coordinated by alex.wilber.contoso@${DOMAIN} in SG-Contoso-Finance-Legacy) get AADSTS50020: User account from identity provider does not exist in tenant 'Contoso Finance'. We do NOT want to delete and recreate their Guest accounts in ${DOMAIN} because they have granular permissions across 40 SharePoint sites, Teams channels, and Azure DevOps work items."`,
      "",
      "Telemetry / Error Payload:",
      "Error Code: AADSTS50020",
      `Resource Tenant: ${DOMAIN} (${TENANT_GUID})`,
      "Message: The signed in user 'j.doe@partner-eng.com' matches an existing guest object by mail, but the immutable ObjectID/TenantID in the incoming SAML/OIDC token does not match the bound AlternativeSecurityId on the local Guest User object.",
    ].join("\n"),
    requester: PEOPLE[3]!,
    createdAt: "2026-10-27T08:05:00Z",
    errorCode: "AADSTS50020",
    correlationId: "88449006-9b7f-4a66-8f06-c4a850020006",
    dialogTitle: "MICROSOFT ENTRA B2B - SIGN-IN ERROR",
    dialogLines: [
      "ERROR AADSTS50020: GUEST REDEMPTION",
      "ALTERNATIVESECURITYID MISMATCH",
      "",
      "GUEST: J.DOE@PARTNER-ENG.COM",
      `TENANT: ${DOMAIN.toUpperCase()}`,
      `SPONSOR: ALEX.WILBER.CONTOSO@${DOMAIN.toUpperCase()}`,
    ],
    app: "SharePoint Online / Azure DevOps",
  },
  {
    id: "#202688455",
    incidentId: "INC-2026-88455",
    category: "Category 2: Azure Infrastructure, Compute & Storage (AMBA & Operations)",
    severity: "Sev 2 (High)",
    priority: "P2",
    archetype: "AVD",
    subject: "INC-2026-88455 · Azure Backup Failing with UserErrorGuestAgentStatusUnavailable",
    description: [
      `Trigger: AMBA Recovery Services Vault Alert in rg-contoso-avd-prod (tenant ${DOMAIN}, subscription ${SUBSCRIPTION_GUID}): Backup Job Failure Event (Sev 1).`,
      "",
      "Client IT Escalation Note:",
      `"Backups for our primary Finance AVD & ERP database server (vm-contoso-avd-0 in rg-contoso-avd-prod, behind nsg-contoso-avd-hostpool-01) have failed for three consecutive nights in rsv-contoso-prod-westeurope with UserErrorGuestAgentStatusUnavailable. Following Microsoft's docs, we logged into vm-contoso-avd-0 via RDP and restarted the WindowsAzureGuestAgent and RdAgent services, which are both showing 'Running' in services.msc. However, when we trigger an on-demand backup after the recent EndpointSecurity-Firewall-Prod / Win11-Firewall-MDM rollout, it hangs at 'Snapshot in progress' for 45 minutes and fails with the exact same error. Please investigate."`,
      "",
      "Telemetry / Error Payload:",
      "ErrorCode: UserErrorGuestAgentStatusUnavailable",
      "ErrorMessage: VM agent is unable to communicate with the Azure Backup Service.",
      `ResourceId: /subscriptions/${SUBSCRIPTION_GUID}/resourceGroups/rg-contoso-avd-prod/providers/Microsoft.Compute/virtualMachines/vm-contoso-avd-0`,
      "Extension: VMSnapshot (Microsoft.Azure.RecoveryServices.VMSnapshot) - State: Transitioning / Timeout",
      "WaAppAgent.log: [00001204] Failed to connect to WireServer 168.63.129.16:32526. SocketException (10060): Connection timed out.",
    ].join("\n"),
    requester: PEOPLE[1]!,
    createdAt: "2026-10-27T08:10:00Z",
    errorCode: "UserErrorGuestAgentStatusUnavailable",
    correlationId: "88455007-1c8a-4b77-9a07-c4a8backup07",
    dialogTitle: "AZURE BACKUP - JOB FAILURE ALERT",
    dialogLines: [
      "ERROR: USERERRORGUESTAGENTSTATUSUNAVAILABLE",
      "VMSNAPSHOT EXTENSION TIMEOUT",
      "",
      "VM: VM-CONTOSO-AVD-0 (RG-CONTOSO-AVD-PROD)",
      "WIRESERVER: 168.63.129.16:32526 TIMED OUT",
      "VAULT: RSV-CONTOSO-PROD-WESTEUROPE",
    ],
    app: "Azure Recovery Services Vault",
  },
  {
    id: "#202688462",
    incidentId: "INC-2026-88462",
    category: "Category 2: Azure Infrastructure, Compute & Storage (AMBA & Operations)",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "AVD",
    subject: "INC-2026-88462 · AMBA OS Disk Free Space Under 10% — Resize Blocked by ASR & Active Snapshot",
    description: [
      `Trigger: AMBA Alert in rg-contoso-avd-prod (${DOMAIN}): OS Disk Free Space Percentage less than 10% (currently at 2.1% / 2.6 GB free on 128 GB P10 disk on vm-contoso-avd-1).`,
      "",
      "Client IT Escalation Note:",
      `"Our Finance session & print server (vm-contoso-avd-1 in rg-contoso-avd-prod, host pool vdpool-contoso-fin-01, subscription ${SUBSCRIPTION_GUID}) triggered a Sev 1 disk space alert on C:\\. C:\\Windows\\Temp and C:\\Windows\\Logs\\CBS are completely full of gigabytes of .cab and CbsPersist logs that are locked by TiWorker.exe. We stopped vm-contoso-avd-1 during an emergency noon window to expand the OS disk (disk-vm-contoso-avd-1-os) from 128 GB (P10) to 256 GB (P15) in the Azure Portal, but Azure throws an OperationNotAllowed error refusing to resize the disk because of replication/restore points. We had to boot it back up before C:\\ hits 0 bytes!"`,
      "",
      "Telemetry / Error Payload:",
      "Code: OperationNotAllowed",
      `ResourceGroup: rg-contoso-avd-prod (Subscription: ${SUBSCRIPTION_GUID})`,
      "Message: Changing size of disk 'disk-vm-contoso-avd-1-os' is not allowed while Azure Site Recovery protection or active incremental snapshots exist on the disk resource.",
    ].join("\n"),
    requester: PEOPLE[2]!,
    createdAt: "2026-10-27T08:15:00Z",
    errorCode: "OperationNotAllowed",
    correlationId: "88462008-2d9b-4c88-8b08-c4a8disk0008",
    dialogTitle: "AZURE MONITOR (AMBA) - DISK CRITICAL",
    dialogLines: [
      "ERROR: OPERATIONNOTALLOWED (DISK RESIZE)",
      "OS DISK C: FREE SPACE AT 2.1% (2.6 GB)",
      "",
      "VM: VM-CONTOSO-AVD-1 (VDPOOL-CONTOSO-FIN-01)",
      "DISK: DISK-VM-CONTOSO-AVD-1-OS (P10 128GB)",
      "BLOCKED BY: ASR / INCREMENTAL SNAPSHOT",
    ],
    app: "Azure Resource Manager / Compute",
  },
  {
    id: "#202688470",
    incidentId: "INC-2026-88470",
    category: "Category 2: Azure Infrastructure, Compute & Storage (AMBA & Operations)",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "AVD",
    subject: "INC-2026-88470 · VM Availability Drop to 0% — Linux initramfs Missing Hyper-V VMBus Drivers",
    description: [
      `Trigger: AMBA Alert in rg-contoso-avd-prod (${DOMAIN}): VM Availability Metric less than 100% over 5 minutes & AMA Heartbeat missing.`,
      "",
      "Client IT Escalation Note:",
      `"Our production RHEL 8 ERP reverse proxy (vm-contoso-erp-proxy-01 in rg-contoso-avd-prod, behind nsg-contoso-avd-hostpool-01, subscription ${SUBSCRIPTION_GUID}) went completely dark at 03:15 AM right after our automated OS patching window. Azure Resource Health shows 'Available (No platform issues detected)', and the VM status in the portal says 'Running', but we cannot SSH into it, Nginx reverse proxy for spn-contoso-erp-sync is down, and the Azure Monitor Agent stopped sending heartbeats. Restarting the VM from the portal does nothing."`,
      "",
      "Telemetry / Error Payload:",
      "[Serial Console / Boot Diagnostics Log — vm-contoso-erp-proxy-01 (rg-contoso-avd-prod)]",
      "dracut-initqueue[312]: Warning: dracut-initqueue timeout - starting timeout scripts",
      "Warning: /dev/disk/by-uuid/4a8b12c9-991a-4b22-8f11-0192837465ab does not exist",
      'Generating "/run/initramfs/rdsosreport.txt"',
      "Entering emergency mode. Exit the shell to continue.",
      "dracut:/#",
    ].join("\n"),
    requester: PEOPLE[3]!,
    createdAt: "2026-10-27T08:20:00Z",
    errorCode: "DracutEmergencyMode",
    correlationId: "88470009-3eac-4d99-9c09-c4a8dracut09",
    dialogTitle: "AZURE SERIAL CONSOLE - BOOT FAILURE",
    dialogLines: [
      "ERROR: DRACUTEMERGENCYMODE (INITRAMFS)",
      "TIMEOUT WAITING FOR ROOT FS UUID",
      "",
      "VM: VM-CONTOSO-ERP-PROXY-01",
      "RG: RG-CONTOSO-AVD-PROD (WESTEUROPE)",
      "SHELL: DRACUT:/# (AMA HEARTBEAT LOST)",
    ],
    app: "Azure Serial Console / Boot Diagnostics",
  },
  {
    id: "#202688478",
    incidentId: "INC-2026-88478",
    category: "Category 2: Azure Infrastructure, Compute & Storage (AMBA & Operations)",
    severity: "Sev 2 (High)",
    priority: "P2",
    archetype: "AVD",
    subject: "INC-2026-88478 · AVD Session Host Deployment Failure (AADLoginForWindows & Domain Join)",
    description: [
      `Trigger: ARM Template / Portal deployment failure in rg-contoso-avd-prod (VMExtensionProvisioningError / 0x801C0042).`,
      "",
      "Client IT Escalation Note:",
      `"We are trying to scale out our Entra-joined Azure Virtual Desktop host pool (vdpool-contoso-fin-01 in rg-contoso-avd-prod, tenant ${DOMAIN}) by adding 4 new Standard_D4s_v5 session hosts for SG-Contoso-Finance-AVD ahead of month-end closing. Every deployment fails after 12 minutes on the AADLoginForWindows extension. The VMs get created behind nsg-contoso-avd-hostpool-01, boot up, and have private IPs, but they never appear as 'Available' in vdpool-contoso-fin-01 and aren't showing as Entra Joined in ${DOMAIN}."`,
      "",
      "Telemetry / Error Payload:",
      JSON.stringify(
        {
          code: "VMExtensionProvisioningError",
          resourceGroup: "rg-contoso-avd-prod",
          hostPool: "vdpool-contoso-fin-01",
          tenantId: TENANT_GUID,
          message:
            "VM has reported a failure when processing extension 'AADLoginForWindows'. Error message: 'AAD Join failed with exit code: -2145648574 (0x801C0042 / DSREG_E_DEVICE_MESSAGE_FORMAT_ERROR / Connectivity to enterpriseregistration.windows.net failed).'",
        },
        null,
        2,
      ),
    ].join("\n"),
    requester: PEOPLE[0]!,
    createdAt: "2026-10-27T08:25:00Z",
    errorCode: "0x801C0042",
    correlationId: "88478010-4fbd-4eaa-8d10-c4a8avdext10",
    dialogTitle: "AZURE DEPLOYMENT - EXTENSION FAILED",
    dialogLines: [
      "ERROR 0X801C0042: AADLOGINFORWINDOWS",
      "VMEXTENSIONPROVISIONINGERROR (-2145648574)",
      "",
      "HOST POOL: VDPOOL-CONTOSO-FIN-01",
      "RG: RG-CONTOSO-AVD-PROD",
      "TARGET: ENTERPRISEREGISTRATION.WINDOWS.NET",
    ],
    app: "Azure Virtual Desktop / ARM",
  },
  {
    id: "#202688483",
    incidentId: "INC-2026-88483",
    category: "Category 2: Azure Infrastructure, Compute & Storage (AMBA & Operations)",
    severity: "Sev 2 (High)",
    priority: "P2",
    archetype: "WorkloadIdentity",
    subject: "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMismatch",
    description: [
      "Trigger: Application exceptions following security hardening of stcontosofslogix01 in rg-contoso-avd-prod.",
      "",
      "Client IT Escalation Note:",
      `"To resolve a Defender for Cloud recommendation in subscription ${SUBSCRIPTION_GUID} (${DOMAIN}), we disabled public network access on stcontosofslogix01 in rg-contoso-avd-prod, created a Private Endpoint in our app/AVD subnet behind nsg-contoso-avd-hostpool-01, and disabled Storage Account Key access (allowSharedKeyAccess: false). We granted our ERP sync workload identity (spn-contoso-erp-sync) and our App Service's System-Assigned Managed Identity the Owner role directly on stcontosofslogix01. Despite having full Owner permissions, the invoice portal used by patti.fernandez.contoso@${DOMAIN} is throwing 403 AuthorizationPermissionMismatch on every single PDF upload!"`,
      "",
      "Telemetry / Error Payload:",
      '<?xml version="1.0" encoding="utf-8"?>',
      "<Error>",
      "  <Code>AuthorizationPermissionMismatch</Code>",
      "  <Message>This request is not authorized to perform this operation using this permission.",
      "  StorageAccount:stcontosofslogix01 ResourceGroup:rg-contoso-avd-prod",
      "  RequestId:7a91b200-401e-0032-5f12-998172000000</Message>",
      "</Error>",
    ].join("\n"),
    requester: PEOPLE[2]!,
    createdAt: "2026-10-27T08:30:00Z",
    errorCode: "AuthorizationPermissionMismatch",
    correlationId: "7a91b200-401e-0032-5f12-998172000000",
    dialogTitle: "AZURE BLOB STORAGE - HTTP 403 ERROR",
    dialogLines: [
      "ERROR: AUTHORIZATIONPERMISSIONMISMATCH",
      "HTTP 403 FORBIDDEN (SHARED KEY DISABLED)",
      "",
      "STORAGE: STCONTOSOFSLOGIX01",
      "IDENTITY: SPN-CONTOSO-ERP-SYNC (OWNER)",
      "RG: RG-CONTOSO-AVD-PROD",
    ],
    app: "Azure Storage (stcontosofslogix01)",
  },
  {
    id: "#202688491",
    incidentId: "INC-2026-88491",
    category: "Category 3: Networking, Hybrid Connectivity & IaC Deployment Failures",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "AVD",
    subject: "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase 2 PFS Mismatch)",
    description: [
      `Trigger: AMBA Alert in rg-contoso-avd-prod (${DOMAIN}): Virtual Network Gateway Tunnel Ingress/Egress Bytes = 0 & Tunnel Connectivity State = Disconnected.`,
      "",
      "Client IT Escalation Note:",
      `"Our Site-to-Site VPN between Azure (vng-contoso-hub-westeurope in rg-contoso-avd-prod, subscription ${SUBSCRIPTION_GUID}) and our Zurich headquarters FortiGate 200F keeps dropping like clockwork every 8 hours (28,800 seconds). When it drops, all SMB file shares on stcontosofslogix01 and print queues for vdpool-contoso-fin-01 (SG-Contoso-Finance-AVD) freeze until someone manually clicks 'Reset' on the connection in Azure or bounces the tunnel on the FortiGate. We checked our Pre-Shared Key and IKEv2 settings—if they were wrong, the tunnel wouldn't come up at all!"`,
      "",
      "Telemetry / Error Payload:",
      "[IKEDiagnosticLog - AzureDiagnostics — vng-contoso-hub-westeurope (rg-contoso-avd-prod)]",
      "Category: IKEDiagnosticLog",
      "Message: [MainMode / QuickMode] CREATE_CHILD_SA responder failed.",
      "Proposal mismatch on Phase 2 Rekey: Peer proposed Encryption=AES_CBC_256, Integrity=SHA256, DHGroup=DHGroup14. Local policy configured with PFS=None (DHGroup=None). ErrorCode: 13806 / NO_PROPOSAL_CHOSEN.",
    ].join("\n"),
    requester: PEOPLE[1]!,
    createdAt: "2026-10-27T08:35:00Z",
    errorCode: "NO_PROPOSAL_CHOSEN",
    correlationId: "88491012-5ace-4fbb-9e12-c4a8ipsec012",
    dialogTitle: "AZURE VPN GATEWAY - TUNNEL DROPPED",
    dialogLines: [
      "ERROR: NO_PROPOSAL_CHOSEN (13806)",
      "CREATE_CHILD_SA PHASE 2 REKEY FAILED",
      "",
      "GATEWAY: VNG-CONTOSO-HUB-WESTEUROPE",
      "PEER: ZURICH HQ FORTIGATE (DHGROUP14)",
      "RG: RG-CONTOSO-AVD-PROD",
    ],
    app: "Azure Virtual Network Gateway",
  },
  {
    id: "#202688502",
    incidentId: "INC-2026-88502",
    category: "Category 3: Networking, Hybrid Connectivity & IaC Deployment Failures",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "AVD",
    subject: "INC-2026-88502 · ExpressRoute Asymmetric Routing Drop After Adding Central Azure Firewall",
    description: [
      "Trigger: TCP connections from on-premises Finance clients (CONTOSO-LT-0471, CONTOSO-LT-0488) to rg-contoso-avd-prod (vnet-contoso-spoke-sap) reset after 3 seconds (SYN / SYN-ACK lost).",
      "",
      "Client IT Escalation Note:",
      `"We just cut over a new SAP & Finance application subnet (10.50.4.0/24) in rg-contoso-avd-prod alongside vdpool-contoso-fin-01 and nsg-contoso-avd-hostpool-01. Following your Hub-and-Spoke architecture guide, we attached a route table (rt-contoso-spoke-sap) to the subnet with 0.0.0.0/0 -> 10.0.1.4 (central Hub Azure Firewall). Now, on-prem Finance users (lynne.robins.contoso@${DOMAIN}, diego.siciliani.contoso@${DOMAIN}) coming in over ExpressRoute cannot establish TCP sessions to the SAP/AVD servers (vm-contoso-avd-0). Strangely, ICMP ping from the servers out to on-prem works fine, and Azure-to-Azure traffic works fine."`,
      "",
      "Telemetry / Error Payload:",
      "[AZFWNetworkRule Log — rg-contoso-avd-prod]",
      "Action: Deny (Invalid TCP State / Asymmetric Routing)",
      "Rule: AsymmetricRoutingDeny",
      "Protocol: TCP | SourceIP: 10.50.4.10 (vm-contoso-avd-0) | DestIP: 192.168.10.45 (CONTOSO-LT-0471)",
      "Flags: SYN-ACK (No matching SYN state in stateful session table)",
    ].join("\n"),
    requester: PEOPLE[0]!,
    createdAt: "2026-10-27T08:40:00Z",
    errorCode: "AsymmetricRoutingDeny",
    correlationId: "88502013-6bdf-4acc-8f13-c4a8azfw0013",
    dialogTitle: "AZURE FIREWALL - STATEFUL TCP DROP",
    dialogLines: [
      "ERROR: ASYMMETRICROUTINGDENY (TCP SYN-ACK)",
      "NO MATCHING SYN STATE IN SESSION TABLE",
      "",
      "SRC: 10.50.4.10 (VM-CONTOSO-AVD-0)",
      "DST: 192.168.10.45 (CONTOSO-LT-0471)",
      "UDR: RT-CONTOSO-SPOKE-SAP -> 10.0.1.4",
    ],
    app: "Azure Firewall / ExpressRoute",
  },
  {
    id: "#202688511",
    incidentId: "INC-2026-88511",
    category: "Category 3: Networking, Hybrid Connectivity & IaC Deployment Failures",
    severity: "Sev 3 (Medium)",
    priority: "P3",
    archetype: "WorkloadIdentity",
    subject: "INC-2026-88511 · Bicep Pipeline Failure — RoleAssignmentUpdateNotPermitted",
    description: [
      `Trigger: GitHub Actions CI/CD deployment failure in rg-contoso-avd-prod (Status: 400 BadRequest on Microsoft.Authorization/roleAssignments).`,
      "",
      "Client IT Escalation Note:",
      `"Our platform team (alex.wilber.contoso@${DOMAIN}) deleted and recreated Key Vault kv-contoso-fin-prod and a User-Assigned Managed Identity in rg-contoso-avd-prod (subscription ${SUBSCRIPTION_GUID}, tenant ${DOMAIN}) to test a disaster recovery runbook for spn-contoso-erp-sync. Now, when our GitHub Actions Bicep/Terraform pipeline runs to re-deploy the infrastructure, it fails hard on the RBAC role assignment module with RoleAssignmentUpdateNotPermitted. Why is Bicep failing when the Managed Identity is brand new?"`,
      "",
      "Telemetry / Error Payload:",
      JSON.stringify(
        {
          status: "Failed",
          scope: `/subscriptions/${SUBSCRIPTION_GUID}/resourceGroups/rg-contoso-avd-prod`,
          error: {
            code: "RoleAssignmentUpdateNotPermitted",
            message: "Tenant ID, application ID, principal ID, and scope are not allowed to be updated. (Code: RoleAssignmentUpdateNotPermitted)",
          },
        },
        null,
        2,
      ),
    ].join("\n"),
    requester: PEOPLE[3]!,
    createdAt: "2026-10-27T08:45:00Z",
    errorCode: "RoleAssignmentUpdateNotPermitted",
    correlationId: "88511014-7ce0-4bdd-9a14-c4a8bicep014",
    dialogTitle: "GITHUB ACTIONS - BICEP DEPLOY FAILED",
    dialogLines: [
      "ERROR: ROLEASSIGNMENTUPDATENOTPERMITTED",
      "HTTP 400 BADREQUEST ON ROLEASSIGNMENTS",
      "",
      "RG: RG-CONTOSO-AVD-PROD",
      "APP: SPN-CONTOSO-ERP-SYNC",
      `USER: ALEX.WILBER.CONTOSO@${DOMAIN.toUpperCase()}`,
    ],
    app: "GitHub Actions / Azure ARM",
  },
  {
    id: "#202688519",
    incidentId: "INC-2026-88519",
    category: "Category 3: Networking, Hybrid Connectivity & IaC Deployment Failures",
    severity: "Sev 3 (Medium)",
    priority: "P3",
    archetype: "AVD",
    subject: "INC-2026-88519 · ARM Deployment Blocked — RequestDisallowedByPolicy in Landing Zone Spoke",
    description: [
      `Trigger: Azure Policy Deny effect triggered during Application Gateway deployment in rg-contoso-avd-prod (subscription ${SUBSCRIPTION_GUID}).`,
      "",
      "Client IT Escalation Note:",
      `"Our web team at Contoso Finance (${DOMAIN}) is trying to deploy a public-facing Azure Application Gateway WAF_v2 in our spoke resource group rg-contoso-avd-prod (subscription ${SUBSCRIPTION_GUID}, alongside nsg-contoso-avd-hostpool-01 and vdpool-contoso-fin-01), which requires creating a Standard Public IP (pip-contoso-appgw-prod). The deployment is blocked by an Azure Policy named Deny-Public-IP assigned at the Management Group level (mg-contoso-landingzones-corp). We are Subscription Contributors, so we cannot edit or exempt the policy. How are we supposed to expose a public web app if Public IPs are banned?"`,
      "",
      "Telemetry / Error Payload:",
      JSON.stringify(
        {
          code: "RequestDisallowedByPolicy",
          target: "pip-contoso-appgw-prod",
          resourceGroup: "rg-contoso-avd-prod",
          message:
            'Resource \'pip-contoso-appgw-prod\' was disallowed by policy. PolicyIdentifiers: \'[{"policyAssignment":{"name":"Deny-Public-IP","id":"/providers/Microsoft.Management/managementGroups/mg-contoso-landingzones-corp/providers/Microsoft.Authorization/policyAssignments/Deny-Public-IP"}}]\'',
        },
        null,
        2,
      ),
    ].join("\n"),
    requester: MIRIAM,
    createdAt: "2026-10-27T08:50:00Z",
    errorCode: "RequestDisallowedByPolicy",
    correlationId: "88519015-8df1-4cee-8b15-c4a8policy15",
    dialogTitle: "AZURE POLICY - DEPLOYMENT DISALLOWED",
    dialogLines: [
      "ERROR: REQUESTDISALLOWEDBYPOLICY",
      "POLICY: DENY-PUBLIC-IP (MG-CONTOSO-CORP)",
      "",
      "TARGET: PIP-CONTOSO-APPGW-PROD",
      "RG: RG-CONTOSO-AVD-PROD",
      `SUBSCRIPTION: ${SUBSCRIPTION_GUID}`,
    ],
    app: "Azure Policy / ARM",
  },
  {
    id: "#202688527",
    incidentId: "INC-2026-88527",
    category: "Category 3: Networking, Hybrid Connectivity & IaC Deployment Failures",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "AVD",
    subject: "INC-2026-88527 · AKS Node Pool Scale-Up Failure (SubnetIsFull via Azure CNI Pre-Allocation)",
    description: [
      `Trigger: Cluster Autoscaler failure on aks-contoso-fin-westeurope-01 in rg-contoso-avd-prod (${DOMAIN}) during high-traffic month-end event.`,
      "",
      "Client IT Escalation Note:",
      `"Our production Finance AKS cluster (aks-contoso-fin-westeurope-01 in rg-contoso-avd-prod, subscription ${SUBSCRIPTION_GUID}, behind nsg-contoso-avd-hostpool-01) is stuck at 7 nodes and failing to scale out to 10 nodes while CPU sits at 92%. The activity log shows SubnetIsFull on snet-contoso-aks-nodes (10.240.0.0/24). This makes zero sense to us: a /24 subnet has 251 usable Azure IPs, and we only have 7 VM nodes and roughly 65 pods running right now! Why does Azure claim all 251 IP addresses are exhausted?"`,
      "",
      "Telemetry / Error Payload:",
      JSON.stringify(
        {
          code: "SubnetIsFull",
          resourceGroup: "rg-contoso-avd-prod",
          message: `Subnet /subscriptions/${SUBSCRIPTION_GUID}/resourceGroups/rg-contoso-avd-prod/providers/Microsoft.Network/virtualNetworks/vnet-contoso-avd-prod/subnets/snet-contoso-aks-nodes with address prefix 10.240.0.0/24 does not have enough capacity for 31 IP addresses.`,
        },
        null,
        2,
      ),
    ].join("\n"),
    requester: PEOPLE[1]!,
    createdAt: "2026-10-27T08:55:00Z",
    errorCode: "SubnetIsFull",
    correlationId: "88527016-9ea2-4dff-9c16-c4a8subnet16",
    dialogTitle: "AZURE AKS AUTOSCALER - SCALE FAILED",
    dialogLines: [
      "ERROR: SUBNETISFULL (SNET-CONTOSO-AKS-NODES)",
      "10.240.0.0/24 LACKS CAPACITY FOR 31 IPS",
      "",
      "CLUSTER: AKS-CONTOSO-FIN-WESTEUROPE-01",
      "RG: RG-CONTOSO-AVD-PROD (7/10 NODES)",
      "NSG: NSG-CONTOSO-AVD-HOSTPOOL-01",
    ],
    app: "Azure Kubernetes Service (AKS)",
  },
  {
    id: "#202688534",
    incidentId: "INC-2026-88534",
    category: "Category 4: Log Analytics (LAW), Sentinel & Cost Management Anomalies",
    severity: "Sev 1 (Critical)",
    priority: "P1",
    archetype: "CA",
    subject: "INC-2026-88534 · Log Analytics Daily Cap Reached (OverQuota) — Sentinel Telemetry Blackout",
    description: [
      `Trigger: MSP KQL Alert on _LogOperation in law-contoso-sentinel-prod-01 (rg-contoso-avd-prod, tenant ${DOMAIN}): Category =~ "Ingestion" and Detail contains "OverQuota".`,
      "",
      "Client IT Escalation Note:",
      `"We just got an automated alert from law-contoso-sentinel-prod-01 in rg-contoso-avd-prod (subscription ${SUBSCRIPTION_GUID}) stating that data ingestion has stopped because our 50 GB/day Daily Cap was reached at 11:20 AM! Our SOC dashboards monitoring ${DOMAIN} (CA-001-Require-PhishingResistant-MFA-Admins, CA-004-Block-Legacy-Auth, and bg-admin-01@${DOMAIN}) are completely frozen and no new security alerts are firing. Last week we only averaged 8 GB/day. On top of that, Cost Management shows our Log Analytics spend still climbing even after the cap hit! Please find out what flooded the workspace and restore Sentinel immediately."`,
      "",
      "Telemetry / Diagnostic KQL:",
      "_LogOperation",
      '| where TimeGenerated > ago(2h) and Category =~ "Ingestion" and Detail contains "OverQuota"',
      '// Result: Operation="Data collection stopped", Detail="Daily cap of 50 GB reached. OverQuota."',
      "",
      "Usage",
      "| where TimeGenerated > ago(24h) and IsBillable == true",
      "| summarize BillableGB = sum(Quantity) / 1024 by DataType",
      "| sort by BillableGB desc",
      "// Result: ContainerLogV2 = 64.2 GB (Overshoot before cap throttle kicked in!)",
    ].join("\n"),
    requester: MIRIAM,
    createdAt: "2026-10-27T09:00:00Z",
    errorCode: "OverQuota",
    correlationId: "88534017-af13-4e10-8d17-c4a8quota017",
    dialogTitle: "MICROSOFT SENTINEL - INGESTION STOPPED",
    dialogLines: [
      "ERROR: OVERQUOTA (DAILY CAP 50 GB HIT)",
      "DATA COLLECTION STOPPED AT 11:20 UTC",
      "",
      "WORKSPACE: LAW-CONTOSO-SENTINEL-PROD-01",
      "TABLE: CONTAINERLOGV2 (64.2 GB IN 24H)",
      `TENANT: ${DOMAIN.toUpperCase()}`,
    ],
    app: "Microsoft Sentinel / Log Analytics",
  },
  {
    id: "#202688542",
    incidentId: "INC-2026-88542",
    category: "Category 4: Log Analytics (LAW), Sentinel & Cost Management Anomalies",
    severity: "Sev 2 (High)",
    priority: "P2",
    archetype: "Intune",
    subject: "INC-2026-88542 · Massive Sentinel Ingestion Spike from Windows SecurityEvent (Event ID 5156)",
    description: [
      "Trigger: Log Analytics ingestion rate in law-contoso-sentinel-prod-01 (rg-contoso-avd-prod) spiked from 12 GB/day to 195 GB/day within 24 hours.",
      "",
      "Client IT Escalation Note:",
      `"Our Azure Sentinel ingestion in ${DOMAIN} (law-contoso-sentinel-prod-01) jumped nearly 16x overnight, exclusively in the SecurityEvent table across our session hosts (vm-contoso-avd-0, vm-contoso-avd-1) and SG-All-Workstations endpoints (CONTOSO-WS-2201, CONTOSO-LT-0471) where Intune-Win11-ASR-Baseline, EndpointSecurity-Firewall-Prod, and Win11-Firewall-MDM apply. Our sysadmins swear they haven't onboarded any new servers to Azure Arc or deployed any new VMs. We are worried our domain controllers and AVD hosts are under a massive brute-force attack generating millions of failed logon events. Can you run a deep KQL analysis to identify which servers and event IDs are causing this?"`,
      "",
      "Telemetry / Diagnostic KQL:",
      "SecurityEvent",
      "| where TimeGenerated > ago(2d) and _IsBillable == true",
      "| summarize RowCount = count(), BilledGB = round(sum(_BilledSize) / 1e9, 3) by Computer, EventID",
      "| sort by BilledGB desc",
      "| take 10",
      "// Result: EventID 5156 (The Windows Filtering Platform has permitted a connection) = 178.4 GB across 85 endpoints (vm-contoso-avd-0, vm-contoso-avd-1, CONTOSO-WS-2201)",
    ].join("\n"),
    requester: PEOPLE[0]!,
    createdAt: "2026-10-27T09:05:00Z",
    errorCode: "EventID5156",
    correlationId: "88542018-b024-4f21-9e18-c4a8ev515618",
    dialogTitle: "SENTINEL COST SPIKE - SECURITYEVENT",
    dialogLines: [
      "ERROR: EVENTID5156 INGESTION SPIKE",
      "195 GB/DAY (+16X) IN SECURITYEVENT TABLE",
      "",
      "HOSTS: VM-CONTOSO-AVD-0, CONTOSO-WS-2201",
      "GROUP: SG-ALL-WORKSTATIONS",
      "POLICY: ENDPOINTSECURITY-FIREWALL-PROD",
    ],
    app: "Microsoft Sentinel / AMA DCR",
  },
  {
    id: "#202688550",
    incidentId: "INC-2026-88550",
    category: "Category 4: Log Analytics (LAW), Sentinel & Cost Management Anomalies",
    severity: "Sev 3 (Medium)",
    priority: "P3",
    archetype: "Licensing",
    subject: "INC-2026-88550 · Late-Arriving Data Billing Dispute (_TimeReceived vs TimeGenerated)",
    description: [
      `Trigger: Client IT at Contoso Finance (${DOMAIN}) disputes Sunday ingestion spike on branch office server SRV-CONTOSO-BRANCH-04 in rg-contoso-avd-prod.`,
      "",
      "Client IT Escalation Note:",
      `"We are auditing our monthly Azure & M365 cost breakdown in ${DOMAIN} (alongside our SPE_E5 / Microsoft_365_Copilot license reconciliation on SG-Contoso-M365-E5) and noticed that SRV-CONTOSO-BRANCH-04 (an Azure Arc-enabled server at our Basel branch office) supposedly generated 74 GB of billable SecurityEvent and Syslog data yesterday (Sunday, Oct 26). That branch office was completely closed on Sunday, and when we run SecurityEvent | where Computer == 'SRV-CONTOSO-BRANCH-04' | where TimeGenerated > ago(2d), it only shows 400 MB of logs! Is Azure double-charging or hallucinating billable data?"`,
      "",
      "Telemetry / Diagnostic KQL:",
      "SecurityEvent",
      '| where Computer =~ "SRV-CONTOSO-BRANCH-04"',
      "| where _TimeReceived >= ago(2d) and _IsBillable == true",
      "| summarize BilledMB = round(sum(_BilledSize) / 1e6, 1) by bin(TimeGenerated, 1d)",
      "| sort by TimeGenerated asc",
      "// Result: 18 distinct days (Oct 8 to Oct 25) totaling 74,120 MB all received on Oct 26!",
    ].join("\n"),
    requester: PEOPLE[2]!,
    createdAt: "2026-10-27T09:10:00Z",
    errorCode: "LateArrivingData",
    correlationId: "88550019-c135-4a32-8f19-c4a8late0019",
    dialogTitle: "LOG ANALYTICS - BILLING AUDIT DISPUTE",
    dialogLines: [
      "ERROR: LATEARRIVINGDATA (_TIMERECEIVED)",
      "74.1 GB FLUSHED ON SUNDAY OCT 26",
      "",
      "SERVER: SRV-CONTOSO-BRANCH-04 (ARC)",
      `TENANT: ${DOMAIN.toUpperCase()}`,
      "SPAN: 18 DAYS (OCT 8 - OCT 25 CACHED)",
    ],
    app: "Azure Log Analytics Cost Audit",
  },
  {
    id: "#202688560",
    incidentId: "INC-2026-88560",
    category: "Category 4: Log Analytics (LAW), Sentinel & Cost Management Anomalies",
    severity: "Sev 2 (High)",
    priority: "P2",
    archetype: "Licensing",
    subject: "INC-2026-88560 · Cost Anomaly Alert (+340% Run Rate) — 72-Hour Latency & Orphaned Disks",
    description: [
      `Trigger: Microsoft Cost Management automated email for subscription ${SUBSCRIPTION_GUID} (${DOMAIN}): Cost Anomaly Detected - Daily run rate UP 340% (+$847/day).`,
      "",
      "Client IT Escalation Note:",
      `"Our CFO at Contoso Finance (${DOMAIN}) just forwarded an urgent Cost Anomaly Detected email from Azure stating that rg-contoso-avd-prod in subscription ${SUBSCRIPTION_GUID} jumped by 340% (+$847/day), citing Microsoft.Compute/virtualMachines and Microsoft.Storage/disks (on top of the orphaned SPE_E5 and Microsoft_365_Copilot seats we flagged on SG-Contoso-M365-E5 for henrietta.mueller.contoso@${DOMAIN} and pradeep.gupta.contoso@${DOMAIN}). Our dev lead says they spun up four large load-testing VMs (Standard_E64s_v5 with 4 TB Premium SSD v2 disks) in rg-contoso-avd-prod on Friday, finished the test, and deleted all four VMs on Sunday night. Why are we getting an anomaly alert on Tuesday morning, and why is our daily run rate still showing $310/day above baseline?"`,
      "",
      "Telemetry / Resource Graph Query:",
      "resources",
      '| where type =~ "microsoft.compute/disks" and resourceGroup =~ "rg-contoso-avd-prod"',
      '| where managedBy == "" or properties.diskState =~ "Unattached"',
      "| project name, sku.name, properties.diskSizeGB, properties.diskIOPSReadWrite, properties.diskMBpsReadWrite",
      "// Result: 8x PremiumV2_LRS disks (4096 GB each, 40,000 IOPS provisioned) in 'Unattached' state in rg-contoso-avd-prod!",
    ].join("\n"),
    requester: PEOPLE[1]!,
    createdAt: "2026-10-27T09:15:00Z",
    errorCode: "OrphanedDisksCostSpike",
    correlationId: "88560020-d246-4b43-9a20-c4a8cost0020",
    dialogTitle: "AZURE COST MANAGEMENT - ANOMALY ALERT",
    dialogLines: [
      "ERROR: ORPHANEDDISKSCOSTSPIKE (+340%)",
      "8X 4TB PREMIUMV2_LRS DISKS UNATTACHED",
      "",
      "RG: RG-CONTOSO-AVD-PROD (+$310/DAY)",
      `SUB: ${SUBSCRIPTION_GUID}`,
      `TENANT: ${DOMAIN.toUpperCase()}`,
    ],
    app: "Microsoft Cost Management",
  },
];

export function findLabIncidentSpec(ticketOrIncidentId: string): LabIncidentSpec | undefined {
  const clean = ticketOrIncidentId.trim().toUpperCase();
  const digits = clean.replace(/[^0-9]/g, "");
  return LAB_INCIDENT_TICKETS.find(
    (s) =>
      s.incidentId.toUpperCase() === clean ||
      s.id.toUpperCase() === clean ||
      s.id.slice(1).toUpperCase() === clean ||
      (digits.length >= 5 && s.id.endsWith(digits)),
  );
}

export function generateLabTicketDrop(specOrId: LabIncidentSpec | string): GeneratedDrop {
  const spec = typeof specOrId === "string" ? findLabIncidentSpec(specOrId) : specOrId;
  if (!spec) throw new Error(`Unknown lab incident ticket id: ${String(specOrId)}`);
  const t: Template = {
    subject: spec.subject,
    description: spec.description,
    errorCode: spec.errorCode,
    priority: spec.priority,
    dialogTitle: spec.dialogTitle,
    dialogLines: spec.dialogLines,
    app: spec.app,
  };
  const body: ErpTicketBody = {
    id: spec.id,
    incidentId: spec.incidentId,
    category: spec.category,
    severity: spec.severity,
    source: "ERP",
    subject: spec.subject,
    description: spec.description,
    customer: "Contoso Finance",
    tenantDomain: DOMAIN,
    tenantId: TENANT_GUID,
    subscriptionId: SUBSCRIPTION_GUID,
    requester: { displayName: spec.requester.displayName, upn: spec.requester.upn, role: spec.requester.role },
    priority: spec.priority,
    createdAt: spec.createdAt,
    attachments: ["attachment1.png"],
    telemetry: {
      errorCode: spec.errorCode,
      correlationId: spec.correlationId,
      timestamp: spec.createdAt,
      device: spec.requester.device,
    },
  };
  return {
    folder: spec.id,
    displayId: spec.id,
    archetype: spec.archetype,
    body,
    png: paintScreenshot(t, body, spec.requester),
  };
}

export function generateAllLabTicketDrops(): GeneratedDrop[] {
  return LAB_INCIDENT_TICKETS.map((spec) => generateLabTicketDrop(spec));
}

/** mulberry32: a seed reproduces the same drop (the seeded example and the unit tests rely on it). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
const guid = (r: () => number) => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? Math.floor(r() * 16) : 8 + Math.floor(r() * 4)) as number).toString(16));

interface Template {
  subject: string;
  description: string;
  errorCode: string;
  priority: ErpTicketBody["priority"];
  dialogTitle: string;
  dialogLines: string[];
  app: string;
}

function template(archetype: DropArchetype, r: () => number, who: Persona, when: string, stamp: string): Template {
  const other = pick(r, PEOPLE.filter((p) => p.upn !== who.upn));
  switch (archetype) {
    case "AVD":
      return {
        subject: `${who.displayName} cannot connect to AVD (${pick(r, ["AADSTS53003", "AADSTS53003"])}) and RDP 3389 looks open on the host pool`,
        description: `${who.displayName} (${who.role}) gets a Conditional Access block when opening the Windows App against vdpool-contoso-fin-01 since ${when}; the dialog shows AADSTS53003 with correlation id {CORR}. The user was moved to the Microsoft 365 E5 bundle last week but still appears on E3. While checking nsg-contoso-avd-hostpool-01 a vendor rule allowing RDP 3389 from the internet is visible in the portal and is not in our Terraform.`,
        errorCode: "AADSTS53003",
        priority: "P1",
        dialogTitle: "WINDOWS APP - SIGN-IN ERROR",
        dialogLines: ["YOUR SIGN-IN WAS BLOCKED BY", "CONDITIONAL ACCESS (AADSTS53003)", "", `USER: ${who.upn}`, "APP: AZURE VIRTUAL DESKTOP CLIENT", "HOST POOL: VDPOOL-CONTOSO-FIN-01"],
        app: "Azure Virtual Desktop",
      };
    case "Intune":
      return {
        subject: `${who.device} shows Not compliant after the ASR baseline update (0x87D1FDE8)`,
        description: `${who.displayName}'s laptop ${who.device} reports 'Not compliant' in the Company Portal since ${when}. Intune shows error 0x87D1FDE8 on Intune-Win11-ASR-Baseline and a conflict with the firewall profile; the device check-in succeeded but the ASR rule stays in Audit. ${other.displayName} on ${other.device} sees the same banner.`,
        errorCode: "0x87D1FDE8",
        priority: "P2",
        dialogTitle: "COMPANY PORTAL - DEVICE STATUS",
        dialogLines: ["THIS DEVICE IS NOT COMPLIANT", "ERROR 0X87D1FDE8", "", `DEVICE: ${who.device}`, "POLICY: INTUNE-WIN11-ASR-BASELINE", "SETTING: ASR RULE (AUDIT)"],
        app: "Intune Company Portal",
      };
    case "CA":
      return {
        subject: `Finance users blocked by CA-001 since the break-glass change (AADSTS53003)`,
        description: `Since ${when} ${who.displayName} and ${other.displayName} are blocked by Conditional Access policy CA-001 when signing in to Outlook and Teams (AADSTS53003, correlation {CORR}). The emergency access account bg-admin-01 is no longer excluded from the policy and CA-004 is still in report-only mode. Please check the break-glass exclusion before more users are locked out.`,
        errorCode: "AADSTS53003",
        priority: "P1",
        dialogTitle: "MICROSOFT ENTRA - SIGN-IN BLOCKED",
        dialogLines: ["ACCESS HAS BEEN BLOCKED BY", "CONDITIONAL ACCESS POLICIES", "ERROR AADSTS53003", "", `USER: ${who.upn}`, "POLICY: CA-001"],
        app: "Microsoft 365",
      };
    case "WorkloadIdentity":
      return {
        subject: `ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired secret)`,
        description: `The nightly GitHub Actions run of spn-contoso-erp-sync fails since ${when} with AADSTS7000222: the client secret has expired. The app registration still lists the contractor Alex Wilber as owner although he holds no admin role, and the granted Graph scopes (Directory.ReadWrite.All, Sites.FullControl.All, Mail.ReadWrite) are far wider than the sync needs. Please rotate to a federated credential and right-size the permissions.`,
        errorCode: "AADSTS7000222",
        priority: "P2",
        dialogTitle: "GITHUB ACTIONS - RUN FAILED",
        dialogLines: ["ERROR: AADSTS7000222", "THE PROVIDED CLIENT SECRET", "IS EXPIRED", "", "APP: SPN-CONTOSO-ERP-SYNC", `RUN: ${stamp}`],
        app: "GitHub Actions",
      };
    case "Licensing":
      return {
        subject: `SPE_E5 group licensing shows CountViolation and ${who.displayName} lost Teams`,
        description: `Since ${when} the group-based licensing of SG-Finance-E5 reports CountViolation on SPE_E5; ${who.displayName} (${who.role}) lost Teams and Exchange while several disabled accounts still hold E5 seats and a Copilot add-on. Please reclaim the orphaned seats and re-apply the licence to the active users.`,
        errorCode: "CountViolation",
        priority: "P2",
        dialogTitle: "MICROSOFT 365 ADMIN - LICENSES",
        dialogLines: ["LICENSE ASSIGNMENT FAILED", "COUNTVIOLATION ON SPE_E5", "", "GROUP: SG-FINANCE-E5", `USER: ${who.upn}`, "AVAILABLE SEATS: 0"],
        app: "Microsoft 365 admin center",
      };
    case "Mixed": {
      const avd = template("AVD", r, who, when, stamp);
      return {
        ...avd,
        subject: `${who.displayName}: AVD sign-in blocked (AADSTS53003), ${who.device} not compliant (0x87D1FDE8)`,
        description: `${avd.description} The same laptop ${who.device} shows 'Not compliant' in the Company Portal with 0x87D1FDE8 on Intune-Win11-ASR-Baseline, so the compliant-device requirement of CA-001 can never be met.`,
        priority: "P1",
      };
    }
  }
}

export interface GenerateOptions {
  archetype?: DropArchetype | "Random";
  /** `#2026323` or `2026323`; random `#2026xxx` otherwise. */
  ticketId?: string;
  seed?: number;
  now?: Date;
}

export function generateDrop(options: GenerateOptions = {}): GeneratedDrop {
  if (options.ticketId) {
    const labSpec = findLabIncidentSpec(options.ticketId);
    if (labSpec) return generateLabTicketDrop(labSpec);
  }
  const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
  const r = rng(seed);
  const archetype: DropArchetype = !options.archetype || options.archetype === "Random" ? pick(r, DROP_ARCHETYPES) : options.archetype;
  const now = options.now ?? new Date();
  const digits = options.ticketId ? options.ticketId.replace(/^#/, "").replace(/[^0-9A-Za-z]/g, "") : `2026${String(Math.floor(r() * 1000)).padStart(3, "0")}`;
  const displayId = `#${digits}`;
  const who = archetype === "WorkloadIdentity" ? PEOPLE[3]! : pick(r, PEOPLE.slice(0, 3));
  const minutesAgo = 20 + Math.floor(r() * 300);
  const at = new Date(now.getTime() - minutesAgo * 60_000);
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, "Z");
  const when = `${stamp.slice(11, 16)} UTC today`;
  const t = template(archetype, r, who, when, stamp);
  const correlationId = guid(r);
  const body: ErpTicketBody = {
    id: displayId,
    source: "ERP",
    subject: t.subject,
    description: t.description.replace("{CORR}", correlationId),
    customer: "Contoso Finance",
    requester: { displayName: who.displayName, upn: who.upn, role: who.role },
    priority: t.priority,
    createdAt: at.toISOString(),
    attachments: ["attachment1.png"],
    telemetry: { errorCode: t.errorCode, correlationId, timestamp: stamp, device: who.device },
  };
  return { folder: displayId, displayId, archetype, body, png: paintScreenshot(t, body, who) };
}

const BG: Rgb = [17, 22, 32];
const WINDOW: Rgb = [30, 36, 48];
const TITLE: Rgb = [40, 47, 62];
const BORDER: Rgb = [70, 80, 100];
const TEXT: Rgb = [226, 232, 240];
const MUTED: Rgb = [148, 163, 184];
const RED: Rgb = [239, 68, 68];
const AMBER: Rgb = [245, 158, 11];

/** A 640x400 "screenshot": window chrome, a red error badge and the symptom lines in the pixel font. */
function paintScreenshot(t: Template, body: ErpTicketBody, who: Persona): Uint8Array {
  const c = new Canvas(640, 400, BG);
  c.fillRect(40, 30, 560, 340, WINDOW);
  c.strokeRect(40, 30, 560, 340, BORDER);
  c.fillRect(41, 31, 558, 28, TITLE);
  c.text(52, 38, t.dialogTitle, TEXT, 2);
  c.fillRect(560, 38, 12, 12, RED);
  // Error badge
  c.fillRect(60, 80, 36, 36, RED);
  c.text(72, 88, "!", TEXT, 3);
  let y = 84;
  for (const line of t.dialogLines) {
    c.text(110, y, line, line.startsWith("ERROR") || /AADSTS|0X87D|COUNTVIOLATION/.test(line) ? AMBER : TEXT, 2);
    y += 20;
  }
  y += 10;
  c.fillRect(60, y, 520, 1, BORDER);
  y += 12;
  const tele = body.telemetry;
  c.text(60, y, `ERROR CODE: ${tele.errorCode}`, AMBER, 2);
  y += 18;
  c.text(60, y, `CORRELATION ID: ${tele.correlationId}`, MUTED, 2);
  y += 18;
  c.text(60, y, `TIMESTAMP: ${tele.timestamp}`, MUTED, 2);
  y += 18;
  c.text(60, y, `DEVICE: ${who.device} - ENTRA JOINED`, MUTED, 2);
  y += 18;
  c.text(60, y, `APP: ${t.app}`, MUTED, 2);
  c.text(52, 352, `TICKET ${body.id} - ${body.customer} - ${body.requester.displayName}`, MUTED, 2);
  return c.toPng({
    Title: `${body.id} ${t.dialogTitle}`,
    ErrorCode: tele.errorCode,
    CorrelationId: tele.correlationId,
    Timestamp: tele.timestamp,
    Device: `${who.device} · Entra joined`,
    User: who.upn,
    App: t.app,
    Software: "ContextPane random ERP drop generator",
  });
}
