import { describe, expect, test } from "bun:test";
import { SCENARIO_IDS } from "@contextpane/catalog";
import {
  FLEET_DIRECTORY,
  FLEET_TENANTS,
  SIGNATURE_BY_SCENARIO,
  activeTenantForScenario,
  immunizeFleet,
  signatureForScenario,
  stageFleetCampaign,
  tenantSlug,
} from "./fleet-immunizer.ts";

const UPN_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

describe("fleet immunizer", () => {
  test("signature per scenario", () => {
    expect(SIGNATURE_BY_SCENARIO["INC-4092"]).toBe("AVD-E3-SKU-Mismatch-With-Open-RDP");
    expect(SIGNATURE_BY_SCENARIO["ANOM-CA-204"]).toBe("CA-BreakGlass-Exclusion-Missing");
    expect(SIGNATURE_BY_SCENARIO["ANOM-INT-309"]).toBe("Intune-ASR-LSASS-Audit-Weakening");
    expect(SIGNATURE_BY_SCENARIO["INC-4099"]).toBe("Intune-BitLocker-LegacyProfile-Conflict");
    expect(SIGNATURE_BY_SCENARIO["ANOM-LIC-101"]).toBe("LIC-SPE-E5-CountViolation-Orphaned-Seats");
    for (const id of SCENARIO_IDS) expect(signatureForScenario(id)).toBe(SIGNATURE_BY_SCENARIO[id]);
  });

  test("fleet directory is exactly the five named tenants, no PII in signatures", () => {
    expect([...FLEET_TENANTS]).toEqual([
      "Contoso Finance",
      "Fabrikam Legal",
      "Northwind Traders",
      "Tailspin Aerospace",
      "Woodgrove Bank",
    ]);
    expect(FLEET_DIRECTORY.map((d) => d.tenant)).toEqual([...FLEET_TENANTS]);
    for (const entry of FLEET_DIRECTORY) {
      for (const sig of entry.signatures) {
        expect(sig).not.toMatch(UPN_RE);
        expect(sig).not.toMatch(IP_RE);
      }
    }
    for (const sig of Object.values(SIGNATURE_BY_SCENARIO)) {
      expect(sig).not.toMatch(UPN_RE);
      expect(sig).not.toMatch(IP_RE);
    }
  });

  test("affected tenants are deterministic per scenario and strictly exclude the active origin tenant", () => {
    const affected = (id: string) => immunizeFleet(id).tenants.filter((t) => t.affected).map((t) => t.tenant);
    expect(affected("INC-4092")).toEqual(["Northwind Traders", "Tailspin Aerospace", "Woodgrove Bank"]);
    expect(affected("INC-4092")).not.toContain("Contoso Finance");
    expect(affected("INC-4099")).toEqual(["Contoso Finance", "Northwind Traders", "Tailspin Aerospace"]);
    expect(affected("INC-4099")).not.toContain("Fabrikam Legal");
    expect(affected("ANOM-LIC-101")).toEqual(["Fabrikam Legal", "Northwind Traders"]);
    expect(affected("ANOM-CA-204")).toEqual(["Northwind Traders", "Tailspin Aerospace", "Woodgrove Bank"]);
    expect(affected("ANOM-INT-309")).toEqual([
      "Fabrikam Legal",
      "Tailspin Aerospace",
      "Woodgrove Bank",
    ]);
    expect(affected("ANOM-APP-401")).toEqual(["Fabrikam Legal", "Northwind Traders"]);
    for (const id of SCENARIO_IDS) {
      const r = immunizeFleet(id);
      const originTenant = activeTenantForScenario(id);
      expect(r.scenarioId).toBe(id);
      expect(r.signature).toBe(SIGNATURE_BY_SCENARIO[id]);
      expect(r.tenants).toHaveLength(5);
      expect(r.tenants.filter((t) => t.affected).map((t) => t.tenant)).not.toContain(originTenant);
      expect(r.affectedCount).toBe(r.tenants.filter((t) => t.affected).length);
      expect(r.affectedCount).toBeGreaterThan(0);
      expect(immunizeFleet(id)).toEqual(r);
    }
  });

  test("campaign branches + verification", () => {
    const campaign = stageFleetCampaign("INC-4092");
    expect(campaign.verified).toBe(true);
    expect(typeof campaign.latencyMs).toBe("number");
    expect(campaign.latencyMs).toBeGreaterThanOrEqual(0);
    expect(campaign.latencyMs).toBeLessThan(100);
    expect(campaign.campaignId).toContain("inc-4092");
    expect(campaign.branches).toHaveLength(immunizeFleet("INC-4092").affectedCount);
    expect(campaign.branches.map((b) => b.tenant)).toEqual([
      "Northwind Traders",
      "Tailspin Aerospace",
      "Woodgrove Bank",
    ]);
    for (const b of campaign.branches) {
      expect(b.branch).toBe(`fleet/AVD-E3-SKU-Mismatch-With-Open-RDP/${tenantSlug(b.tenant)}`);
      expect(b.prPreview).toContain(b.tenant);
      expect(b.prPreview).toContain(b.branch);
      expect(b.prPreview).not.toMatch(UPN_RE);
      expect(b.prPreview).not.toMatch(IP_RE);
    }
    for (const id of SCENARIO_IDS) {
      const c = stageFleetCampaign(id);
      expect(c.verified).toBe(true);
      expect(c.branches).toHaveLength(immunizeFleet(id).affectedCount);
      expect(stageFleetCampaign(id).branches).toEqual(c.branches);
      expect(stageFleetCampaign(id).campaignId).toBe(c.campaignId);
    }
  });

  test("unknown scenario throws", () => {
    expect(() => immunizeFleet("NOPE-0000")).toThrow(/unknown scenarioId/);
    expect(() => immunizeFleet("")).toThrow(/unknown scenarioId/);
    expect(() => stageFleetCampaign("NOPE-0000")).toThrow(/unknown scenarioId/);
    expect(() => signatureForScenario("nope")).toThrow(/unknown scenarioId/);
  });
});
