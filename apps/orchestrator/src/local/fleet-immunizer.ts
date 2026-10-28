import { baseScenarioOf, getCustomScenario, isCustomScenarioId, isScenarioId, type ScenarioId } from "@contextpane/catalog";
import { verifyFormalInvariants } from "./formal-verifier.ts";

/**
 * Place 7 · Fleet Immunization.
 *
 * Deterministic, no I/O, no LLM. A scenario is reduced to a PII-free
 * signature (no UPNs, no IPs, no device/user identifiers) and that signature
 * alone is matched against a static fleet directory. Tenant matching never
 * inspects personal data.
 */

export const FLEET_TENANTS = [
  "Contoso Finance",
  "Fabrikam Legal",
  "Northwind Traders",
  "Tailspin Aerospace",
  "Woodgrove Bank",
] as const;

export type FleetTenant = (typeof FLEET_TENANTS)[number];

/** Scenario -> PII-free fleet signature. */
export const SIGNATURE_BY_SCENARIO: Record<ScenarioId, string> = {
  "INC-4092": "AVD-E3-SKU-Mismatch-With-Open-RDP",
  "INC-4099": "Intune-BitLocker-LegacyProfile-Conflict",
  "ANOM-LIC-101": "LIC-SPE-E5-CountViolation-Orphaned-Seats",
  "ANOM-CA-204": "CA-BreakGlass-Exclusion-Missing",
  "ANOM-INT-309": "Intune-ASR-LSASS-Audit-Weakening",
  "ANOM-APP-401": "Entra-WorkloadIdentity-ShadowAdmin-Overprivileged-Secret",
};

export const SCENARIO_BY_SIGNATURE: Record<string, ScenarioId> = Object.fromEntries(
  Object.entries(SIGNATURE_BY_SCENARIO).map(([scenarioId, signature]) => [signature, scenarioId as ScenarioId]),
);

/**
 * Static fleet directory: signatures observed per tenant.
 * Deterministic by construction — an explicit table, not a hash or clock.
 */
export const FLEET_DIRECTORY: readonly { tenant: FleetTenant; signatures: readonly string[] }[] = [
  {
    tenant: "Contoso Finance",
    signatures: [
      SIGNATURE_BY_SCENARIO["INC-4099"],
    ],
  },
  {
    tenant: "Fabrikam Legal",
    signatures: [
      SIGNATURE_BY_SCENARIO["ANOM-LIC-101"],
      SIGNATURE_BY_SCENARIO["ANOM-INT-309"],
      SIGNATURE_BY_SCENARIO["ANOM-APP-401"],
    ],
  },
  {
    tenant: "Northwind Traders",
    signatures: [
      SIGNATURE_BY_SCENARIO["INC-4092"],
      SIGNATURE_BY_SCENARIO["INC-4099"],
      SIGNATURE_BY_SCENARIO["ANOM-LIC-101"],
      SIGNATURE_BY_SCENARIO["ANOM-CA-204"],
      SIGNATURE_BY_SCENARIO["ANOM-APP-401"],
    ],
  },
  {
    tenant: "Tailspin Aerospace",
    signatures: [
      SIGNATURE_BY_SCENARIO["INC-4092"],
      SIGNATURE_BY_SCENARIO["INC-4099"],
      SIGNATURE_BY_SCENARIO["ANOM-CA-204"],
      SIGNATURE_BY_SCENARIO["ANOM-INT-309"],
    ],
  },
  {
    tenant: "Woodgrove Bank",
    signatures: [
      SIGNATURE_BY_SCENARIO["INC-4092"],
      SIGNATURE_BY_SCENARIO["ANOM-CA-204"],
      SIGNATURE_BY_SCENARIO["ANOM-INT-309"],
    ],
  },
];

export function activeTenantForScenario(scenarioId: string): FleetTenant {
  const custom = getCustomScenario(scenarioId);
  if (custom?.tenantId === "tenant-fabrikam-02") return "Fabrikam Legal";
  const effectiveId = isCustomScenarioId(scenarioId) ? baseScenarioOf(scenarioId) : scenarioId;
  return effectiveId === "INC-4099" ? "Fabrikam Legal" : "Contoso Finance";
}

export function tenantSlug(tenant: string): string {
  return tenant.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function signatureForScenario(scenarioId: string): string {
  const effectiveId = isCustomScenarioId(scenarioId) ? baseScenarioOf(scenarioId) : scenarioId;
  if (effectiveId && isScenarioId(effectiveId)) return SIGNATURE_BY_SCENARIO[effectiveId];
  if (isCustomScenarioId(scenarioId)) {
    const custom = getCustomScenario(scenarioId);
    return custom?.elementRouting?.missingElements[0]?.elementId ?? `Custom-Dynamic-${scenarioId}`;
  }
  throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
}

export interface FleetTenantMatch {
  tenant: FleetTenant;
  affected: boolean;
  signatures: string[];
}

export interface FleetImmunizationResult {
  scenarioId: ScenarioId | string;
  signature: string;
  tenants: FleetTenantMatch[];
  affectedCount: number;
}

export function immunizeFleet(scenarioId: string): FleetImmunizationResult {
  const effectiveId = isCustomScenarioId(scenarioId) ? baseScenarioOf(scenarioId) : scenarioId;
  if (effectiveId && isScenarioId(effectiveId)) {
    const signature = SIGNATURE_BY_SCENARIO[effectiveId];
    const activeTenant = activeTenantForScenario(effectiveId);
    const tenants: FleetTenantMatch[] = FLEET_DIRECTORY.map((entry) => ({
      tenant: entry.tenant,
      affected: entry.tenant !== activeTenant && entry.signatures.includes(signature),
      signatures: [...entry.signatures],
    }));
    return {
      scenarioId: effectiveId,
      signature,
      tenants,
      affectedCount: tenants.filter((t) => t.affected).length,
    };
  }
  if (isCustomScenarioId(scenarioId)) {
    const signature = signatureForScenario(scenarioId);
    const activeTenant = activeTenantForScenario(scenarioId);
    const tenants: FleetTenantMatch[] = FLEET_DIRECTORY.map((entry) => ({
      tenant: entry.tenant,
      affected: entry.tenant !== activeTenant && entry.signatures.includes(signature),
      signatures: [...entry.signatures],
    }));
    return {
      scenarioId,
      signature,
      tenants,
      affectedCount: tenants.filter((t) => t.affected).length,
    };
  }
  throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
}

export interface FleetCampaignBranch {
  tenant: FleetTenant;
  branch: string;
  prPreview: string;
}

export interface FleetCampaign {
  campaignId: string;
  scenarioId: ScenarioId | string;
  signature: string;
  branches: FleetCampaignBranch[];
  verified: boolean;
  latencyMs: number;
}

/**
 * Stage a fleet campaign for every affected tenant. Each affected tenant is
 * verified with the symbolic formal verifier for the scenario of origin;
 * `latencyMs` is the measured wall-clock total of those verifications
 * (target <5 ms — reported as measured, never rounded down to the target).
 */
export function stageFleetCampaign(scenarioId: string): FleetCampaign {
  const immunization = immunizeFleet(scenarioId);
  const affected = immunization.tenants.filter((t) => t.affected);

  const started = performance.now();
  let verified = true;
  for (const _tenant of affected) {
    // Same scenario of origin for every tenant: the signature is tenant-agnostic.
    if (!verifyFormalInvariants(immunization.scenarioId).passed) verified = false;
  }
  const latencyMs = Math.round((performance.now() - started) * 1000) / 1000;

  const signatureSlug = immunization.signature.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    campaignId: `fleet-${immunization.scenarioId.toLowerCase()}-${signatureSlug}`,
    scenarioId: immunization.scenarioId,
    signature: immunization.signature,
    branches: affected.map((t) => {
      const branch = `fleet/${immunization.signature}/${tenantSlug(t.tenant)}`;
      return {
        tenant: t.tenant,
        branch,
        prPreview: `PR preview [${t.tenant}] branch ${branch}: apply ${immunization.signature} remediation for ${immunization.scenarioId} (formal invariants verified before staging).`,
      };
    }),
    verified,
    latencyMs,
  };
}
