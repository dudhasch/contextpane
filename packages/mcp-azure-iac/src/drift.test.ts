import { describe, expect, test } from "bun:test";
import { parseNsgResources, renderNsgHcl } from "./hcl.ts";
import { azureIacService } from "./service.ts";

describe("hcl subset parser", () => {
  test("parses the Contoso baseline NSG with tags from locals", () => {
    const baseline = azureIacService.getTerraformBaseline("tenant-contoso-01");
    expect(baseline.nsg.name).toBe("nsg-contoso-avd-hostpool-01");
    expect(baseline.nsg.resourceGroup).toBe("rg-contoso-avd-prod");
    expect(baseline.nsg.location).toBe("westeurope");
    expect(baseline.nsg.tags.Environment).toBe("Production");
    expect(baseline.nsg.rules.map((r) => r.name)).toEqual([
      "Allow-AVD-ServiceTraffic",
      "Allow-Internal-RDP-Shortpath",
      "Deny-All-Inbound-Internet",
    ]);
  });

  test("render is stable and re-parseable", () => {
    const baseline = azureIacService.getTerraformBaseline("tenant-fabrikam-02");
    const rendered = renderNsgHcl(baseline.nsg, "x");
    const reparsed = parseNsgResources(rendered)[0];
    expect(reparsed?.name).toBe(baseline.nsg.name);
    expect(reparsed?.rules.length).toBe(baseline.nsg.rules.length);
    expect(reparsed?.tags).toEqual(baseline.nsg.tags);
  });
});

describe("drift computation (seeded manifest)", () => {
  test("Contoso: rogue RDP rule + Environment tag drift", async () => {
    const result = await azureIacService.getNsgDrift("tenant-contoso-01");
    expect(result.source).toBe("seeded-manifest");
    const d = result.data;
    expect(d.driftState).toBe("drift-detected");
    expect(d.rogueSecurityRules.map((r) => r.ruleName)).toEqual(["Allow-Temp-RDP-Diagnostic-Drift"]);
    expect(d.rogueSecurityRules[0]?.severity).toBe("critical");
    expect(d.rogueSecurityRules[0]?.port).toBe("3389");
    expect(d.tagDrift).toEqual(
      expect.arrayContaining([
        { key: "Environment", expectedInTf: "Production", actualInAzure: "Prod-Hotfix-Manual" },
        { key: "ChangeTicket", expectedInTf: null, actualInAzure: "manual-hotfix-2026-10-24" },
      ]),
    );
    expect(d.missingSecurityRules).toEqual([]);
    expect(d.hclDiff).toContain('-    name                       = "Allow-Temp-RDP-Diagnostic-Drift"');
    expect(d.hclDiff).toContain('+    Environment = "Production"');
    expect(d.summary).toContain("DRIFT DETECTED");
    expect(d.summary).toContain("TCP 3389");
  });

  test("Fabrikam: rogue SSH + residency tag drift", async () => {
    const { data } = await azureIacService.getNsgDrift("tenant-fabrikam-02");
    expect(data.rogueSecurityRules[0]?.ruleName).toBe("Allow-Temp-SSH-Vendor");
    expect(data.tagDrift.find((t) => t.key === "DataResidency")).toEqual({ key: "DataResidency", expectedInTf: "CH", actualInAzure: "Global" });
    expect(data.tagDrift.find((t) => t.key === "Classification")).toEqual({ key: "Classification", expectedInTf: "Confidential", actualInAzure: null });
  });
});
