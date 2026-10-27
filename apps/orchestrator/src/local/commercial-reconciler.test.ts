import { describe, expect, test } from "bun:test";
import { reconcileCommercial, reverseCompile } from "./commercial-reconciler.ts";

describe("3-way commercial reconciler", () => {
  test("INC-4092 / ANOM-LIC-101: Path A $0/$285, Path B +$171, contract CNT-2026-884", () => {
    for (const id of ["INC-4092", "ANOM-LIC-101"]) {
      const r = reconcileCommercial(id);
      expect(r.scenarioId).toBe(id);
      expect(r.contractId).toBe("CNT-2026-884");
      expect(r.sources.gitBaseline).toContain("golden-tenant");
      expect(r.sources.liveGraph.toLowerCase()).toContain("graph");
      expect(r.sources.commercial).toContain("Pax8");
      // Orphaned seats derived from disabled leavers in LICENSE_ANOMALY fixtures.
      expect(r.pathA.id).toBe("A");
      expect(r.pathA.label).toBe("Zero-Spend Seat Reclamation");
      expect(r.pathA.reclaim).toEqual({ SPE_E5: 3, Copilot: 2 });
      expect(r.pathA.netDeltaMonthly).toBe(0);
      // 3 SPE_E5 * $57 (CNT-2026-884 L1) + 2 Copilot * $57 = $285/mo waste.
      expect(r.pathA.wasteEliminatedMonthly).toBe(285);
      expect(r.wasteEliminatedMonthly).toBe(285);
      expect(r.pathB.id).toBe("B");
      expect(r.pathB.label).toBe("Pax8 CSP Seat Increment");
      expect(r.pathB.increment).toEqual({ SPE_E5: 3 });
      // 3 * $57 = $171/mo.
      expect(r.pathB.netDeltaMonthly).toBe(171);
      expect(r.pathB.prorated).toBe(true);
      expect(r.recommendation).toBe("A");
      const e5 = r.skus.find((s) => s.skuPartNumber === "SPE_E5")!;
      expect(e5.orphaned).toBe(3);
      expect(e5.unitPriceMonthly).toBe(57);
      const copilot = r.skus.find((s) => s.skuPartNumber === "Microsoft_365_Copilot")!;
      expect(copilot.orphaned).toBe(2);
      expect(e5.wasteMonthly + copilot.wasteMonthly).toBe(285);
      expect(r.orphanedUsers.length).toBe(3);
    }
  });

  test("other / unknown scenarios: generic zero result, no crash", () => {
    for (const id of ["INC-4099", "ANOM-CA-204", "ANOM-INT-309", "NOPE-0000", ""]) {
      const r = reconcileCommercial(id);
      expect(r.contractId).toBe("CNT-2026-884");
      expect(r.pathA.netDeltaMonthly).toBe(0);
      expect(r.pathA.wasteEliminatedMonthly).toBe(0);
      expect(r.pathB.netDeltaMonthly).toBe(0);
      expect(r.pathB.increment.SPE_E5).toBe(0);
      expect(["A", "B"]).toContain(r.recommendation);
    }
  });
});

describe("reverse-IaC", () => {
  test("contains resource + import blocks, tofu summary 0/0", () => {
    for (const id of ["INC-4092", "ANOM-INT-309", "INC-4099", undefined]) {
      const r = reverseCompile(id);
      expect(r.hcl).toContain('resource "azurerm_resource_group"');
      expect(r.hcl).toContain("import {");
      expect(r.imports.length).toBeGreaterThan(0);
      expect(r.imports[0]).toContain("import {");
      expect(r.imports[0]).toContain("to =");
      expect(r.imports[0]).toContain('id = "');
      expect(r.tofuPlanSummary).toBe("0 to add, 0 to destroy");
    }
    expect(reverseCompile("INC-4092").hcl).toContain('resource "azurerm_network_security_group" "contoso_avd_hostpool"');
    // Deterministic.
    expect(reverseCompile("ANOM-INT-309").hcl).toBe(reverseCompile("ANOM-INT-309").hcl);
    expect(reverseCompile({ scenarioId: "INC-4092" }).scenarioId).toBe("INC-4092");
  });

  test("shadow detection: duplicate Intune firewall (ANOM-INT-309) and NSG overlap (INC-4092)", () => {
    const intune = reverseCompile("ANOM-INT-309");
    expect(intune.shadowFindings.length).toBeGreaterThan(0);
    expect(intune.shadowFindings.some((f) => f.kind === "duplicate" || f.kind === "shadowed")).toBe(true);
    expect(intune.shadowFindings.flatMap((f) => f.resources).join(" ")).toContain("Win11-Firewall-MDM");

    const bitlocker = reverseCompile("INC-4099");
    expect(bitlocker.shadowFindings.some((f) => f.resources.join(" ").includes("BitLocker") || /bitlocker/i.test(f.detail))).toBe(true);

    const nsg = reverseCompile("INC-4092");
    expect(nsg.shadowFindings.length).toBeGreaterThan(0);
    expect(nsg.shadowFindings.some((f) => f.kind === "overlap")).toBe(true);
  });
});
