import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/* -------------------------------------------------------------------------- */
/* Manifest types (mirror demo-iac/demo-lab-manifest.json)                     */
/* -------------------------------------------------------------------------- */

export interface ManifestGroup {
  displayName: string;
  mailNickname: string;
  objectId: string;
  description: string;
  memberUpns: string[];
}

export interface ManifestUserExtension {
  extensionName: string;
  expectedSku: string;
  currentSku: string;
  driftStatus: "compliant" | "drifted" | "unassigned";
  contractId: string;
  lastSyncedAt: string;
}

export interface ManifestUser {
  objectId: string;
  upn: string;
  displayName: string;
  jobTitle: string;
  department: string;
  usageLocation: string;
  currentSku: string;
  expectedSku: string;
  driftStatus: "compliant" | "drifted" | "unassigned";
  extension: ManifestUserExtension | null;
}

export interface ManifestLicenses {
  skuPartNumber: string;
  skuName: string;
  skuId: string;
  erpBilledCount: number;
  entraAssignedCount: number;
  monthlyUnitPriceUsd: number;
  legacySkuPartNumber: string;
  legacySkuId: string;
}

export interface ManifestCaPolicy {
  id: string;
  displayName: string;
  state: "enabled" | "disabled" | "enabledForReportingButNotEnforced";
  createdDateTime: string;
  modifiedDateTime: string;
  conditions: {
    users: { includeGroups: string[]; includeGroupNames: string[]; excludeGroups: string[]; excludeGroupNames: string[] };
    applications: { includeApplications: string[]; includeApplicationNames: string[] };
    clientAppTypes: string[];
  };
  grantControls: { operator: string; builtInControls: string[] };
}

export interface ManifestSignIn {
  id: string;
  createdDateTime: string;
  userPrincipalName: string;
  userDisplayName: string;
  appId: string;
  appDisplayName: string;
  clientAppUsed: string;
  ipAddress: string;
  location: string;
  deviceDetail: { displayName: string; operatingSystem: string; isCompliant: boolean; trustType: string };
  status: { errorCode: number; failureReason: string | null };
  conditionalAccessStatus: "success" | "failure" | "notApplied" | "unknown";
  appliedConditionalAccessPolicies: Array<{ id: string; displayName: string; result: string; enforcedGrantControls: string[] }>;
}

export interface ManifestSecurityRule {
  name: string;
  priority: number;
  direction: "Inbound" | "Outbound";
  access: "Allow" | "Deny";
  protocol: string;
  sourcePortRange: string;
  destinationPortRange: string;
  sourceAddressPrefix: string;
  destinationAddressPrefix: string;
  description?: string;
}

export interface ManifestAzure {
  resourceGroup: string;
  location: string;
  terraformFile: string;
  gitBranch: string;
  nsg: {
    name: string;
    id: string;
    tags: Record<string, string>;
    securityRules: ManifestSecurityRule[];
  };
}

export interface ManifestTenant {
  displayName: string;
  tenantId: string;
  verifiedDomain: string;
  subscriptionId: string;
  groups: ManifestGroup[];
  users: ManifestUser[];
  licenses: ManifestLicenses;
  conditionalAccessPolicies: ManifestCaPolicy[];
  signInEvents: ManifestSignIn[];
  azure: ManifestAzure;
}

export interface LabManifest {
  schemaVersion: number;
  generatedAt: string;
  generatedBy: string;
  liveSeeded: boolean;
  notes?: string;
  tenants: Record<string, ManifestTenant>;
}

/* -------------------------------------------------------------------------- */
/* Resolution & loading                                                        */
/* -------------------------------------------------------------------------- */

const MANIFEST_REL = join("demo-iac", "demo-lab-manifest.json");

/** Walk upwards from several anchors until a directory containing demo-iac/ is found. */
export function findRepoRoot(anchors: string[] = [process.cwd(), import.meta.dir]): string | null {
  for (const anchor of anchors) {
    let dir = resolve(anchor);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, MANIFEST_REL))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function resolveManifestPath(): string {
  const override = process.env.CTX_DEMO_MANIFEST;
  if (override && existsSync(override)) return resolve(override);
  const root = findRepoRoot();
  if (!root) {
    throw new Error(
      `demo-lab-manifest.json not found. Set CTX_DEMO_MANIFEST or run from inside the ContextPane repository (cwd=${process.cwd()}).`,
    );
  }
  return join(root, MANIFEST_REL);
}

let cache: { path: string; mtimeMs: number; manifest: LabManifest } | null = null;

/** Load (and cache by mtime) the manifest so the seed script can rewrite it without a restart. */
export function loadManifest(): LabManifest {
  const path = resolveManifestPath();
  const mtimeMs = statSync(path).mtimeMs;
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.manifest;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as LabManifest;
  if (!manifest.tenants || typeof manifest.tenants !== "object") {
    throw new Error(`Manifest at ${path} has no tenants`);
  }
  cache = { path, mtimeMs, manifest };
  return manifest;
}

export function getManifestTenant(tenantId: string): ManifestTenant {
  const tenant = loadManifest().tenants[tenantId];
  if (!tenant) throw new Error(`Tenant '${tenantId}' not present in demo-lab-manifest.json`);
  return tenant;
}
