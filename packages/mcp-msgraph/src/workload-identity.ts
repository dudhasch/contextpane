import { LAB_DOMAIN } from "./fixtures.ts";

/**
 * ANOM-APP-401 · Entra workload identity fixture: shadow-admin app owner,
 * overprivileged Microsoft Graph scopes and an expired client secret
 * (AADSTS7000222) on spn-contoso-erp-sync. Golden baseline:
 * golden-tenant/entra/apps/spn-contoso-erp-sync.json (observedState L12-L34).
 */

export interface WorkloadSignInEvent {
  id: string;
  timestamp: string;
  upn: string;
  displayName: string;
  appId: string;
  appDisplayName: string;
  status: "success" | "failure" | "interrupted";
  errorCode: number;
  errorCodeLabel?: string;
  failureReason?: string;
  conditionalAccessStatus: "success" | "failure" | "notApplied" | "unknown";
  clientApp: string;
  location: string;
  ipAddress: string;
  deviceName: string;
  deviceCompliant: boolean | null;
  isHighlighted?: boolean;
}

export interface WorkloadIdentityFixture {
  scenarioId: "ANOM-APP-401";
  goldenSource: string;
  spn: {
    displayName: string;
    appId: string;
    objectId: string;
    servicePrincipalId: string;
    signInAudience: string;
  };
  owner: {
    upn: string;
    displayName: string;
    objectId: string;
    /** Directory roles held by the owner: none — a non-admin shadow-admin owner. */
    directoryRoles: string[];
  };
  passwordCredential: {
    displayName: string;
    keyId: string;
    endDateTime: string;
    expired: boolean;
  };
  errorCode: number;
  errorCodeLabel: "AADSTS7000222";
  failureSource: string;
  /** Application permissions (app roles) currently granted on Microsoft Graph. */
  appPermissions: string[];
  /** Delegated grant held by the SPN. */
  oauth2PermissionGrant: {
    id: string;
    scope: string;
    consentType: string;
    verifiedPublisher: boolean;
  };
  activity: {
    windowDays: number;
    calls: Array<{ method: string; endpoint: string; count: number }>;
  };
  /** Least-privilege permissions the 90-day activity actually requires. */
  requiredPermissions: string[];
  federatedCredential: {
    name: string;
    issuer: string;
    subject: string;
    audiences: string[];
  };
}

export const WORKLOAD_IDENTITY: WorkloadIdentityFixture = {
  scenarioId: "ANOM-APP-401",
  goldenSource: "golden-tenant/entra/apps/spn-contoso-erp-sync.json",
  spn: {
    displayName: "spn-contoso-erp-sync",
    appId: "44b8e1a7-3c5d-4f2a-9b6e-7d8c9a0b1e2f",
    objectId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    servicePrincipalId: "8d2e3f4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a",
    signInAudience: "AzureADMyOrg",
  },
  owner: {
    upn: `alex.wilber@${LAB_DOMAIN}`,
    displayName: "Alex Wilber",
    objectId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    directoryRoles: [],
  },
  passwordCredential: {
    displayName: "github-actions-erp-sync",
    keyId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    endDateTime: "2026-10-19T23:59:59Z",
    expired: true,
  },
  errorCode: 7000222,
  errorCodeLabel: "AADSTS7000222",
  failureSource: "GitHub Actions IP range",
  appPermissions: ["Directory.ReadWrite.All", "Sites.FullControl.All", "Mail.ReadWrite", "RoleManagement.ReadWrite.Directory"],
  oauth2PermissionGrant: {
    id: "grant-spn-contoso-erp-sync-001",
    scope: "Mail.ReadWrite offline_access",
    consentType: "AllPrincipals",
    verifiedPublisher: false,
  },
  activity: {
    windowDays: 90,
    calls: [
      { method: "GET", endpoint: "/v1.0/users", count: 91 },
      { method: "POST", endpoint: "/v1.0/sites/{fin-site-id}/lists", count: 88 },
    ],
  },
  requiredPermissions: ["User.Read.All", "Sites.Selected"],
  federatedCredential: {
    name: "github-actions-main",
    issuer: "https://token.actions.githubusercontent.com",
    subject: "repo:contoso/erp-sync:ref:refs/heads/main",
    audiences: ["api://AzureADTokenExchange"],
  },
};

/**
 * Realistic sign-in and audit history for ANOM-APP-401 / spn-contoso-erp-sync (newest first):
 * - today 02:15:00Z: AADSTS7000222 expired secret from GitHub Actions
 * - today 02:10:14Z: AADSTS7000222 retry failure
 * - today 01:42:19Z: unverified OAuth grant Mail.ReadWrite + offline_access by the non-admin owner
 * - yesterday 18:05Z: unused Directory.ReadWrite.All scope flagged by the 90-day scope audit
 * - yesterday 11:20Z: access review lists the non-admin contractor Alex Wilber as App Owner
 * - Oct 19 23:59Z: secret 'github-actions-erp-sync' expired
 * - Sep 15: baseline successful sync call
 */
export function workloadIdentitySignIns(now = Date.now()): WorkloadSignInEvent[] {
  const ref = new Date(now);
  const year = ref.getUTCFullYear();

  // Anchor nightly failure times relative to today
  const tFail1 = new Date(now);
  tFail1.setUTCHours(2, 15, 0, 0);

  const tFail2 = new Date(now);
  tFail2.setUTCHours(2, 10, 14, 0);

  const tGrant = new Date(now);
  tGrant.setUTCHours(1, 42, 19, 0);

  const tScopeAudit = new Date(now - 86_400_000);
  tScopeAudit.setUTCHours(18, 5, 0, 0);

  const tOwnerReview = new Date(now - 86_400_000);
  tOwnerReview.setUTCHours(11, 20, 0, 0);

  const tExpiry = new Date(Date.UTC(year, 9, 19, 23, 59, 59));
  if (tExpiry.getTime() > now) tExpiry.setUTCFullYear(year - 1);

  const tSep15 = new Date(Date.UTC(year, 8, 15, 14, 0, 0));
  if (tSep15.getTime() > now) tSep15.setUTCFullYear(year - 1);

  const events: WorkloadSignInEvent[] = [
    {
      id: "sgn-spn-erp-0001",
      timestamp: tSep15.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.spn.displayName,
      displayName: WORKLOAD_IDENTITY.spn.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: "Microsoft Graph (/v1.0/users)",
      status: "success",
      errorCode: 0,
      conditionalAccessStatus: "notApplied",
      clientApp: "GitHub Actions",
      location: "Chicago, US",
      ipAddress: "185.199.108.40",
      deviceName: "",
      deviceCompliant: null,
      isHighlighted: false,
    },
    {
      id: "sgn-spn-erp-0002",
      timestamp: tOwnerReview.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.owner.upn,
      displayName: WORKLOAD_IDENTITY.owner.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: "Access review · App Owner (0 roles)",
      status: "success",
      errorCode: 0,
      failureReason: "Access review: non-admin contractor Alex Wilber listed as App Owner (0 directory roles)",
      conditionalAccessStatus: "notApplied",
      clientApp: "Access Review",
      location: "Chicago, US",
      ipAddress: "198.51.100.44",
      deviceName: "CONTOSO-FIN-014",
      deviceCompliant: true,
      isHighlighted: false,
    },
    {
      id: "sgn-spn-erp-0003",
      timestamp: tScopeAudit.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.spn.displayName,
      displayName: WORKLOAD_IDENTITY.spn.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: "Directory.ReadWrite.All scope audit",
      status: "interrupted",
      errorCode: 0,
      errorCodeLabel: "Scope Audit",
      failureReason: "Directory.ReadWrite.All granted but unused in 90 days: overprivileged (90-day scope audit)",
      conditionalAccessStatus: "notApplied",
      clientApp: "Entra Permissions Management",
      location: "Redmond, US",
      ipAddress: "198.51.100.12",
      deviceName: "",
      deviceCompliant: null,
      isHighlighted: false,
    },
    {
      id: "sgn-spn-erp-0004",
      timestamp: tExpiry.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.spn.displayName,
      displayName: WORKLOAD_IDENTITY.spn.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: `Secret '${WORKLOAD_IDENTITY.passwordCredential.displayName}' expired`,
      status: "interrupted",
      errorCode: 0,
      errorCodeLabel: "Secret Expired",
      failureReason: `PasswordCredential '${WORKLOAD_IDENTITY.passwordCredential.displayName}' expired ${WORKLOAD_IDENTITY.passwordCredential.endDateTime}`,
      conditionalAccessStatus: "notApplied",
      clientApp: "Key Vault Lifecycle",
      location: "Redmond, US",
      ipAddress: "198.51.100.10",
      deviceName: "",
      deviceCompliant: null,
      isHighlighted: false,
    },
    {
      id: "sgn-spn-erp-0005",
      timestamp: tGrant.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.owner.upn,
      displayName: WORKLOAD_IDENTITY.owner.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: `Grant: ${WORKLOAD_IDENTITY.oauth2PermissionGrant.scope.replace(" ", " + ")}`,
      status: "interrupted",
      errorCode: 0,
      errorCodeLabel: "OAuth Grant",
      failureReason: `Unverified OAuth grant: ${WORKLOAD_IDENTITY.oauth2PermissionGrant.scope.replace(" ", " + ")} consented by non-admin owner`,
      conditionalAccessStatus: "notApplied",
      clientApp: "Azure Portal · Consent",
      location: "Redmond, US",
      ipAddress: "198.51.100.82",
      deviceName: "CONTOSO-FIN-014",
      deviceCompliant: true,
      isHighlighted: false,
    },
    {
      id: "sgn-spn-erp-0006",
      timestamp: tFail2.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.spn.displayName,
      displayName: WORKLOAD_IDENTITY.spn.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: "Microsoft Graph",
      status: "failure",
      errorCode: WORKLOAD_IDENTITY.errorCode,
      errorCodeLabel: WORKLOAD_IDENTITY.errorCodeLabel,
      failureReason: "AADSTS7000222: Client secret expired · GitHub Actions retry failure",
      conditionalAccessStatus: "notApplied",
      clientApp: "GitHub Actions (retry)",
      location: "Chicago, US",
      ipAddress: "185.199.108.41",
      deviceName: "",
      deviceCompliant: null,
      isHighlighted: true,
    },
    {
      id: "sgn-spn-erp-0007",
      timestamp: tFail1.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.spn.displayName,
      displayName: WORKLOAD_IDENTITY.spn.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: "Microsoft Graph",
      status: "failure",
      errorCode: WORKLOAD_IDENTITY.errorCode,
      errorCodeLabel: WORKLOAD_IDENTITY.errorCodeLabel,
      failureReason: "AADSTS7000222: The provided value for the 'client_secret' is expired.",
      conditionalAccessStatus: "notApplied",
      clientApp: "GitHub Actions",
      location: "Chicago, US",
      ipAddress: "185.199.108.40",
      deviceName: "",
      deviceCompliant: null,
      isHighlighted: true,
    },
  ];

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
