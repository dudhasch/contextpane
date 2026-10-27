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

/** Nightly AADSTS7000222 token failures of the SPN from the GitHub Actions IP range (relative to now). */
export function workloadIdentitySignIns(now = Date.now()): WorkloadSignInEvent[] {
  return Array.from({ length: 7 }, (_, i) => {
    const at = new Date(now - (i + 1) * 86_400_000 + 2.25 * 3_600_000);
    at.setUTCHours(2, 15, 0, 0);
    return {
      id: `sgn-spn-erp-${(i + 1).toString().padStart(4, "0")}`,
      timestamp: at.toISOString().replace(/\.\d{3}Z$/, "Z"),
      upn: WORKLOAD_IDENTITY.spn.displayName,
      displayName: WORKLOAD_IDENTITY.spn.displayName,
      appId: WORKLOAD_IDENTITY.spn.appId,
      appDisplayName: WORKLOAD_IDENTITY.spn.displayName,
      status: "failure" as const,
      errorCode: WORKLOAD_IDENTITY.errorCode,
      errorCodeLabel: WORKLOAD_IDENTITY.errorCodeLabel,
      failureReason: "AADSTS7000222: The provided value for the 'client_secret' is expired.",
      conditionalAccessStatus: "notApplied" as const,
      clientApp: "GitHub Actions",
      location: "Chicago, US",
      ipAddress: `185.199.108.${40 + i}`,
      deviceName: "",
      deviceCompliant: null,
    };
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
