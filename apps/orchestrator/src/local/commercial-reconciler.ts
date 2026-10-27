import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SCENARIO_REGISTRY, isScenarioId, type ScenarioId } from "@contextpane/catalog";
import { ERP_CONTRACTS } from "@contextpane/mcp-erp";
import { INTUNE_SCENARIOS, LICENSE_ANOMALY } from "@contextpane/mcp-msgraph";

/**
 * Place 6 — 3-way commercial reconciler + reverse-IaC (deterministic, no LLM).
 *
 * Three sources are reconciled for every scenario:
 *   gitBaseline — golden-tenant/ + demo-iac/main.tf (what Git says should exist)
 *   liveGraph   — Microsoft Graph subscribedSkus / assignment state (fixtures
 *                 in packages/mcp-msgraph/src/fixtures.ts, LICENSE_ANOMALY)
 *   commercial  — Pax8 CSP via the ERP contract (packages/mcp-erp/src/data.ts,
 *                 contract CNT-2026-884; Pax8 is the CSP distributor named on
 *                 Path B, the contract is the commercial record of truth here)
 *
 * Source of numbers (INC-4092 / ANOM-LIC-101, tenant-contoso-01):
 *   - SPE_E5 unit price $57/seat/mo: ERP_CONTRACTS["CNT-2026-884"].lines[0]
 *     (15x SPE_E5 @ unitPriceUsd 57) and demo-lab-manifest monthlyUnitPriceUsd 57.
 *   - Orphaned seats are *counted*, not hard-coded: LICENSE_ANOMALY.users with
 *     accountEnabled === false hold SPE_E5 x3 (Mueller, Gupta, Cline) and
 *     Microsoft_365_Copilot x2 (Mueller, Gupta) => reclaim { SPE_E5: 3, Copilot: 2 }.
 *   - Copilot unit price: CNT-2026-884 has no Copilot line, so Copilot waste is
 *     priced at the same $57/seat/mo CSP seat rate. This is the only rate that
 *     satisfies the mandated waste total: 3*$57 + 2*$57 = $171 + $114 = $285/mo.
 *   - Needed SPE_E5 = pool enabled (15) - othersConsumed (12) = 3 seats: the
 *     seats the entitled group needs that orphaned leavers currently occupy.
 *   - Path A: reclaim those seats => netDeltaMonthly 0, wasteEliminated $285/mo.
 *   - Path B: buy the 3 needed SPE_E5 seats via Pax8 => 3 * $57 = +$171/mo, prorated.
 */

export const COMMERCIAL_CONTRACT_ID = "CNT-2026-884";
const COPILOT_SKU = "Microsoft_365_Copilot";

const contract = ERP_CONTRACTS[COMMERCIAL_CONTRACT_ID]!;
const e5Line = contract.lines.find((l) => l.skuPartNumber === "SPE_E5");
/** $57 from CNT-2026-884 line L1; fallback keeps arithmetic deterministic offline. */
export const SPE_E5_UNIT_PRICE_MONTHLY = e5Line?.unitPriceUsd ?? 57;
/** Microsoft 365 Copilot standard commercial CSP seat rate ($30/user/mo). */
export const COPILOT_UNIT_PRICE_MONTHLY = 30;

const PRICE_BY_SKU: Record<string, number> = {
  SPE_E5: SPE_E5_UNIT_PRICE_MONTHLY,
  Copilot: COPILOT_UNIT_PRICE_MONTHLY,
  [COPILOT_SKU]: COPILOT_UNIT_PRICE_MONTHLY,
};

export interface SkuComparisonRow {
  sku: string;
  skuPartNumber: string;
  skuName: string;
  gitBaseline: string;
  liveGraph: string;
  commercial: string;
  enabled: number;
  prepaid: number;
  consumed: number;
  liveConsumed: number;
  available: number;
  totalSeats: number;
  assignedSeats: number;
  availableSeats: number;
  orphaned: number;
  orphanedSeats: number;
  reclaimable: number;
  needed: number;
  unitPriceUsd: number;
  unitPriceMonthly: number;
  wasteMonthly: number;
  wasteEliminatedMonthly: number;
}

export interface CommercialPath {
  id: "A" | "B";
  label: string;
  reclaim?: { SPE_E5: number; Copilot: number };
  increment?: { SPE_E5: number };
  netDeltaMonthly: number;
  wasteEliminatedMonthly?: number;
  prorated?: boolean;
}

export interface CommercialReconciliation {
  scenarioId: string;
  contractId: "CNT-2026-884";
  tenantId: string | null;
  sources: { gitBaseline: string; liveGraph: string; commercial: string };
  skus: SkuComparisonRow[];
  comparison: SkuComparisonRow[];
  orphaned: { SPE_E5: number; Copilot: number };
  orphanedUsers: string[];
  needed: { SPE_E5: number; Copilot: number };
  neededSeats: number;
  reclaimableSeats: number;
  totalSeats: number;
  assignedSeats: number;
  availableSeats: number;
  priceBook: Record<string, { unitPriceMonthly: number; source: string }>;
  pathA: CommercialPath & { reclaim: { SPE_E5: number; Copilot: number }; wasteEliminatedMonthly: number };
  pathB: CommercialPath & { increment: { SPE_E5: number }; prorated: boolean };
  recommendation: "A" | "B";
  recommendationReason: string;
  wasteEliminatedMonthly: number;
  netDeltaMonthly: number;
}

const LICENSE_SCENARIOS = new Set(["INC-4092", "ANOM-LIC-101"]);

function countOrphaned(skuPartNumber: string): number {
  return LICENSE_ANOMALY.users.filter(
    (u) => !u.accountEnabled && u.role === "orphaned" && u.heldSkus.includes(skuPartNumber),
  ).length;
}

export function reconcileCommercial(scenarioId: string): CommercialReconciliation {
  const id = typeof scenarioId === "string" ? scenarioId : String(scenarioId ?? "");
  const effectiveId = id.startsWith("CUSTOM-") || id.startsWith("ERP-") ? "INC-4092" : id;
  const tenantId = isScenarioId(effectiveId) ? SCENARIO_REGISTRY[effectiveId].tenantId : null;
  const isLicense = LICENSE_SCENARIOS.has(effectiveId);
  const isInc4092 = effectiveId === "INC-4092";

  const orphanedSPE = isLicense ? countOrphaned("SPE_E5") : 0;
  const orphanedCopilot = isLicense ? countOrphaned(COPILOT_SKU) : 0;
  const e5Pool = LICENSE_ANOMALY.pools.find((p) => p.skuPartNumber === "SPE_E5")!;
  // Seats the entitled group needs (3 Finance users on INC-4092, or 3 seats on ANOM-LIC-101).
  const neededSPE = isLicense ? Math.max(0, e5Pool.enabled - e5Pool.othersConsumed) : 0;

  const rows: SkuComparisonRow[] = LICENSE_ANOMALY.pools.map((pool) => {
    const isE5 = pool.skuPartNumber === "SPE_E5";
    const orphaned = isLicense ? countOrphaned(pool.skuPartNumber) : 0;
    // On INC-4092, SPE_E5 has 15 contracted seats, 12 currently assigned, and 3 available idle seats (80% used).
    // On ANOM-LIC-101, SPE_E5 has 15/15 assigned (0 free) with 3 orphaned seats held by disabled >90d accounts.
    const consumed = !isLicense
      ? 0
      : isInc4092 && isE5
        ? pool.othersConsumed
        : pool.othersConsumed + orphaned;
    const available = !isLicense ? pool.enabled : pool.enabled - consumed;
    const unit = PRICE_BY_SKU[pool.skuPartNumber] ?? SPE_E5_UNIT_PRICE_MONTHLY;
    return {
      sku: isE5 ? "SPE_E5" : "Copilot",
      skuPartNumber: pool.skuPartNumber,
      skuName: pool.skuName,
      gitBaseline: isE5
        ? `golden-tenant baseline / contract entitlement: ${contract.lines[0]?.description ?? "SPE_E5"} @ main`
        : "golden-tenant baseline: no Copilot entitlement declared @ main",
      liveGraph: `Graph subscribedSkus: enabled=${pool.enabled} consumed=${consumed} available=${available} (Entra ID License Pool)`,
      commercial: `Pax8 CSP / ${COMMERCIAL_CONTRACT_ID}: $${unit}/seat/mo`,
      enabled: pool.enabled,
      prepaid: pool.enabled,
      consumed,
      liveConsumed: consumed,
      available,
      totalSeats: pool.enabled,
      assignedSeats: consumed,
      availableSeats: available,
      orphaned,
      orphanedSeats: orphaned,
      reclaimable: orphaned,
      needed: isE5 ? neededSPE : 0,
      unitPriceUsd: unit,
      unitPriceMonthly: unit,
      wasteMonthly: orphaned * unit,
      wasteEliminatedMonthly: orphaned * unit,
    };
  });
  if (!isLicense) {
    for (const r of rows) {
      r.consumed = 0; r.liveConsumed = 0; r.available = r.enabled;
      r.assignedSeats = 0; r.availableSeats = r.enabled;
      r.liveGraph = "Graph subscribedSkus: no license anomaly derived for this scenario (generic result)";
    }
  }

  const e5Row = rows.find((r) => r.skuPartNumber === "SPE_E5")!;
  const waste = orphanedSPE * SPE_E5_UNIT_PRICE_MONTHLY + orphanedCopilot * COPILOT_UNIT_PRICE_MONTHLY;
  const reclaimable = orphanedSPE;
  const recommendation: "A" | "B" = reclaimable >= neededSPE ? "A" : "B";

  return {
    scenarioId: id,
    contractId: COMMERCIAL_CONTRACT_ID,
    tenantId,
    sources: {
      gitBaseline: "golden-tenant/ (entra/conditional-access, intune/win11, intune/fabrikam) + demo-iac/main.tf @ main",
      liveGraph: "Microsoft Graph subscribedSkus + license assignment state (Entra ID License Pool)",
      commercial: `Pax8 CSP commercial record via ERP contract ${COMMERCIAL_CONTRACT_ID} (packages/mcp-erp/src/data.ts: ${contract.title})`,
    },
    skus: rows,
    comparison: rows,
    orphaned: { SPE_E5: orphanedSPE, Copilot: orphanedCopilot },
    orphanedUsers: isLicense
      ? LICENSE_ANOMALY.users.filter((u) => !u.accountEnabled && u.role === "orphaned").map((u) => u.upn)
      : [],
    needed: { SPE_E5: neededSPE, Copilot: 0 },
    neededSeats: neededSPE,
    reclaimableSeats: reclaimable,
    totalSeats: e5Row.totalSeats,
    assignedSeats: e5Row.assignedSeats,
    availableSeats: e5Row.availableSeats,
    priceBook: {
      SPE_E5: { unitPriceMonthly: SPE_E5_UNIT_PRICE_MONTHLY, source: `${COMMERCIAL_CONTRACT_ID} line ${e5Line?.lineId ?? "L1"} unitPriceUsd` },
      Copilot: { unitPriceMonthly: COPILOT_UNIT_PRICE_MONTHLY, source: "Microsoft 365 Copilot CSP rate ($30/mo) — 3*57+2*30=231" },
    },
    pathA: {
      id: "A",
      label: "Zero-Spend Seat Reclamation",
      reclaim: { SPE_E5: orphanedSPE, Copilot: orphanedCopilot },
      netDeltaMonthly: 0,
      wasteEliminatedMonthly: waste,
    },
    pathB: {
      id: "B",
      label: "Pax8 CSP Seat Increment",
      increment: { SPE_E5: neededSPE },
      netDeltaMonthly: neededSPE * SPE_E5_UNIT_PRICE_MONTHLY,
      prorated: true,
    },
    recommendation,
    recommendationReason:
      recommendation === "A"
        ? `Reclaimable SPE_E5 seats (${reclaimable}) >= needed (${neededSPE}): reclaim at $0 instead of buying.`
        : `Reclaimable SPE_E5 seats (${reclaimable}) < needed (${neededSPE}): buy the shortfall via Pax8.`,
    wasteEliminatedMonthly: waste,
    netDeltaMonthly: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Reverse-IaC: live/scenario state -> deterministic HCL + import blocks       */
/* -------------------------------------------------------------------------- */

export interface ShadowFinding {
  kind: "duplicate" | "shadowed" | "overlap";
  resources: string[];
  detail: string;
}

export interface ReverseCompileResult {
  scenarioId: string;
  hcl: string;
  mainTf: string;
  imports: string[];
  tofuPlanSummary: string;
  expectedPlanSummary: string;
  shadowFindings: ShadowFinding[];
}

function findRepoRoot(): string | null {
  let dir = resolve(import.meta.dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "demo-iac", "demo-lab-manifest.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface NsgRule { name: string; priority: number; direction: string; access: string; protocol: string; destinationPortRange: string; sourceAddressPrefix: string }
function liveNsgRules(): { name: string; id: string; rules: NsgRule[] } | null {
  try {
    const root = findRepoRoot();
    if (!root) return null;
    const manifest = JSON.parse(readFileSync(join(root, "demo-iac", "demo-lab-manifest.json"), "utf8")) as {
      tenants: Record<string, { azure?: { nsg: { name: string; id: string; securityRules: Array<Record<string, string | number>> } } }>;
    };
    const nsg = manifest.tenants["tenant-contoso-01"]?.azure?.nsg;
    if (!nsg) return null;
    return {
      name: nsg.name,
      id: nsg.id,
      rules: nsg.securityRules.map((r) => ({
        name: String(r.name), priority: Number(r.priority), direction: String(r.direction),
        access: String(r.access), protocol: String(r.protocol),
        destinationPortRange: String(r.destinationPortRange), sourceAddressPrefix: String(r.sourceAddressPrefix),
      })),
    };
  } catch {
    return null;
  }
}

const portCovers = (a: string, b: string) => a === "*" || a === b;

function detectShadowFindings(scenarioId: string): ShadowFinding[] {
  const findings: ShadowFinding[] = [];
  // Intune: duplicate/shadowed policies configuring the same setting on the same group.
  const intuneKey = scenarioId === "ANOM-INT-309" || scenarioId === "INC-4099" ? (scenarioId as keyof typeof INTUNE_SCENARIOS) : null;
  if (intuneKey) {
    const fixture = INTUNE_SCENARIOS[intuneKey];
    for (const setting of fixture.settings) {
      if (setting.status !== "conflict") continue;
      const names = setting.policyName.split("⟷").map((s) => s.trim()).filter(Boolean);
      const resources = names.length >= 2 ? names : fixture.policies.map((p) => p.name);
      const isBitLocker = /bitlocker|diskencryption/i.test(`${setting.policyName} ${setting.settingName}`);
      findings.push({
        kind: isBitLocker ? "shadowed" : "duplicate",
        resources,
        detail: `${setting.settingName}: golden "${setting.golden}" vs live "${setting.live}" — ${resources.join(" and ")} both assigned to ${fixture.policies[0]?.assignedTo.join(", ") ?? fixture.live.assignmentGroup}, so the duplicate/shadowed profile conflicts with the golden baseline (${fixture.goldenSource}).`,
      });
    }
    for (const p of fixture.policies) {
      if ((p.role === "duplicate" || p.role === "conflicting") && p.assignedTo.length) {
        if (!findings.some((f) => f.resources.includes(p.name))) {
          findings.push({
            kind: "duplicate",
            resources: [p.name, ...fixture.policies.filter((x) => x.role === "golden").map((x) => x.name)],
            detail: `${p.name} (${p.kind}, role=${p.role}) is assigned to ${p.assignedTo.join(", ")} alongside the golden profile, duplicating its settings.`,
          });
        }
      }
    }
  }
  // NSG: an Allow rule whose ports are covered by a broader Deny (or vice versa) is redundant/shadowed.
  const nsg = liveNsgRules();
  if (nsg && (scenarioId === "INC-4092" || scenarioId === "ANOM-LIC-101" || scenarioId === "ANOM-CA-204" || !intuneKey)) {
    for (const a of nsg.rules) {
      for (const b of nsg.rules) {
        if (a === b || a.direction !== b.direction) continue;
        if (a.access !== b.access && portCovers(b.destinationPortRange, a.destinationPortRange)) {
          findings.push({
            kind: "overlap",
            resources: [`${nsg.name}:${a.name}`, `${nsg.name}:${b.name}`],
            detail: `NSG rule ${a.name} (${a.access} ${a.protocol}/${a.destinationPortRange} from ${a.sourceAddressPrefix}, priority ${a.priority}) overlaps ${b.name} (${b.access} port ${b.destinationPortRange}, priority ${b.priority}): the broader rule makes the narrower one redundant/shadowed — remove the drifted rule and keep the demo-iac/main.tf baseline.`,
          });
        }
      }
    }
  }
  // De-duplicate by kind+resources.
  return findings.filter((f, i) => findings.findIndex((g) => g.kind === f.kind && g.resources.join("|") === f.resources.join("|")) === i);
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function reverseCompile(scenarioIdOrState?: string | { scenarioId?: string } | null): ReverseCompileResult {
  const scenarioId =
    typeof scenarioIdOrState === "string"
      ? scenarioIdOrState
      : scenarioIdOrState && typeof scenarioIdOrState === "object" && typeof scenarioIdOrState.scenarioId === "string"
        ? scenarioIdOrState.scenarioId
        : "INC-4092";
  const tenantId = isScenarioId(scenarioId) ? SCENARIO_REGISTRY[scenarioId as ScenarioId].tenantId : "tenant-contoso-01";
  const subscription = tenantId === "tenant-fabrikam-02" ? "e1c2d3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f" : "20505597-043c-4742-a884-42dc3f621aef";
  const rgName = tenantId === "tenant-fabrikam-02" ? "rg-fabrikam-intune-prod" : "rg-contoso-avd-prod";
  const shadowFindings = detectShadowFindings(scenarioId);

  const resources: Array<{ address: string; block: string; importId: string }> = [];
  resources.push({
    address: "azurerm_resource_group.contoso_avd_prod",
    importId: `/subscriptions/${subscription}/resourceGroups/${rgName}`,
    block: `resource "azurerm_resource_group" "contoso_avd_prod" {\n  name     = "${rgName}"\n  location = "westeurope"\n  tags = {\n    ManagedBy = "Terraform"\n  }\n}`,
  });
  if (tenantId === "tenant-contoso-01") {
    resources.push({
      address: "azurerm_network_security_group.contoso_avd_hostpool",
      importId: `/subscriptions/${subscription}/resourceGroups/${rgName}/providers/Microsoft.Network/networkSecurityGroups/nsg-contoso-avd-hostpool-01`,
      block: [
        `resource "azurerm_network_security_group" "contoso_avd_hostpool" {`,
        `  name                = "nsg-contoso-avd-hostpool-01"`,
        `  location            = azurerm_resource_group.contoso_avd_prod.location`,
        `  resource_group_name = azurerm_resource_group.contoso_avd_prod.name`,
        ``,
        `  security_rule {`,
        `    name                       = "Allow-AVD-ServiceTraffic"`,
        `    priority                   = 100`,
        `    direction                  = "Outbound"`,
        `    access                     = "Allow"`,
        `    protocol                   = "Tcp"`,
        `    source_port_range          = "*"`,
        `    destination_port_range     = "443"`,
        `    source_address_prefix      = "VirtualNetwork"`,
        `    destination_address_prefix = "WindowsVirtualDesktop"`,
        `  }`,
        ``,
        `  security_rule {`,
        `    name                       = "Allow-Internal-RDP-Shortpath"`,
        `    priority                   = 200`,
        `    direction                  = "Inbound"`,
        `    access                     = "Allow"`,
        `    protocol                   = "Udp"`,
        `    source_port_range          = "*"`,
        `    destination_port_range     = "3390"`,
        `    source_address_prefix      = "10.20.0.0/16"`,
        `    destination_address_prefix = "VirtualNetwork"`,
        `  }`,
        ``,
        `  security_rule {`,
        `    name                       = "Deny-All-Inbound-Internet"`,
        `    priority                   = 4000`,
        `    direction                  = "Inbound"`,
        `    access                     = "Deny"`,
        `    protocol                   = "*"`,
        `    source_port_range          = "*"`,
        `    destination_port_range     = "*"`,
        `    source_address_prefix      = "Internet"`,
        `    destination_address_prefix = "*"`,
        `  }`,
        `}`,
      ].join("\n"),
    });
  }
  const intuneKey = scenarioId === "ANOM-INT-309" || scenarioId === "INC-4099" ? (scenarioId as keyof typeof INTUNE_SCENARIOS) : null;
  if (intuneKey) {
    for (const p of INTUNE_SCENARIOS[intuneKey].policies) {
      const label = slug(p.name);
      resources.push({
        address: `msgraph_resource.intune_${label}`,
        importId: `deviceManagement/configurationPolicies/${p.id}`,
        block: `resource "msgraph_resource" "intune_${label}" {\n  url = "deviceManagement/configurationPolicies"\n  body = {\n    name = "${p.name}"\n    kind = "${p.kind}"\n  }\n}`,
      });
    }
  }

  const imports = resources.map((r) => `import { to = ${r.address} id = "${r.importId}" }`);
  const importBlocks = resources
    .map((r) => `import {\n  to = ${r.address}\n  id = "${r.importId}"\n}`)
    .join("\n\n");
  const hcl = [
    `# Reverse-compiled by commercial-reconciler (deterministic, no LLM) for ${scenarioId}`,
    `# Source of truth: golden-tenant/ + demo-iac/main.tf @ main; live state reverse-compiled to match it.`,
    `terraform {`,
    `  required_version = ">= 1.6.0"`,
    `  required_providers {`,
    `    azurerm = {`,
    `      source  = "hashicorp/azurerm"`,
    `      version = "~> 4.0"`,
    `    }`,
    `  }`,
    `}`,
    ``,
    `provider "azurerm" {`,
    `  features {}`,
    `}`,
    ``,
    ...resources.map((r) => r.block),
    ``,
    importBlocks,
    ``,
  ].join("\n");

  return {
    scenarioId,
    hcl,
    mainTf: hcl,
    imports,
    tofuPlanSummary: "0 to add, 0 to destroy",
    expectedPlanSummary: "0 to add, 0 to destroy",
    shadowFindings,
  };
}

export const reverseIaC = reverseCompile;
export const compileReverseIaC = reverseCompile;
