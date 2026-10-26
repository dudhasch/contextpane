import { describe, expect, test } from "bun:test";
import { LayoutSchema, convergeLayout, type Layout } from "./index.ts";

const telemetry = { tier: "Tier 1B", provider: "meta", modelId: "muse-spark-1.3", latencyMs: 4000, tokensUsed: 10000 } as const;

function driftedLayout(): Layout {
  return LayoutSchema.parse({
    tenantId: "tenant-contoso-01",
    ticketId: "INC-4092",
    layoutId: "lay-test",
    generatedAt: "2026-10-26T08:40:00Z",
    provenance: { tier: "Tier 1B", provider: "meta", modelId: "muse-spark-1.3", latencyMs: 4000, tokensUsed: 10000 },
    components: [
      {
        type: "TenantSummaryHeader",
        id: "header",
        props: {
          tenantName: "Contoso Finance",
          tenantId: "4cc41c20-8b01-40a3-93c6-b4f1e846f6ea",
          verifiedDomain: "c4a8shili.onmicrosoft.com",
          erpContractId: "CNT-2026-884",
          slaTier: "Platinum",
          activeEscalation: { ticketId: "INC-4092", severity: "P1", title: "AVD blocked", badge: "P1 · Breach in 2h" },
          healthSummary: { licenses: "critical", identity: "critical", infrastructure: "critical" },
          providerTelemetry: telemetry,
        },
      },
      {
        type: "LicenseDriftCard",
        id: "license",
        props: {
          skuName: "Microsoft 365 E5",
          skuPartNumber: "SPE_E5",
          groupName: "SG-Contoso-Finance-AVD",
          contractId: "CNT-2026-884",
          erpBilledCount: 15,
          entraAssignedCount: 12,
          driftedCount: 3,
          monthlyUnitPriceUsd: 57,
          burnRateDeltaUsdPerMonth: 171,
          users: [
            { upn: "lynne@x", displayName: "Lynne", currentSku: "SPE_E3", expectedSku: "SPE_E5", driftStatus: "drifted" },
            { upn: "alex@x", displayName: "Alex", currentSku: "SPE_E5", expectedSku: "SPE_E5", driftStatus: "compliant" },
            { upn: "diego@x", displayName: "Diego", currentSku: "SPE_E3", expectedSku: "SPE_E5", driftStatus: "drifted" },
            { upn: "patti@x", displayName: "Patti", currentSku: "SPE_E3", expectedSku: "SPE_E5", driftStatus: "drifted" },
          ],
          state: "critical",
        },
      },
      {
        type: "IaCDriftBanner",
        id: "iac",
        props: {
          resourceName: "nsg-contoso-avd-hostpool-01",
          resourceGroup: "rg-contoso-avd-prod",
          terraformFile: "demo-iac/main.tf",
          driftState: "drift-detected",
          tagDrift: [{ key: "Environment", expectedInTf: "Production", actualInAzure: "Prod-Hotfix-Manual" }],
          rogueSecurityRules: [],
          hclDiff: "@@ -1 +1 @@",
          summary: "DRIFT DETECTED",
          state: "critical",
          comparedAgainst: "live-azure",
        },
      },
    ],
  });
}

describe("convergeLayout", () => {
  test("flips remediated users, counts and health to compliant without touching the input", () => {
    const before = driftedLayout();
    const after = convergeLayout(before, { remediatedUpns: ["LYNNE@x", "diego@x", "patti@x"] });
    const license = after.components.find((c) => c.type === "LicenseDriftCard");
    if (license?.type !== "LicenseDriftCard") throw new Error("license card missing");
    expect(license.props.entraAssignedCount).toBe(15);
    expect(license.props.driftedCount).toBe(0);
    expect(license.props.burnRateDeltaUsdPerMonth).toBe(0);
    expect(license.props.state).toBe("healthy");
    expect(license.props.users.every((u) => u.driftStatus === "compliant" && u.currentSku === "SPE_E5")).toBe(true);

    const header = after.components.find((c) => c.type === "TenantSummaryHeader");
    if (header?.type !== "TenantSummaryHeader") throw new Error("header missing");
    expect(Object.values(header.props.healthSummary)).toEqual(["healthy", "healthy", "healthy"]);
    expect(header.props.activeEscalation?.badge).toBe("P1 · Remediated");

    const iac = after.components.find((c) => c.type === "IaCDriftBanner");
    if (iac?.type !== "IaCDriftBanner") throw new Error("banner missing");
    expect(iac.props.driftState).toBe("in-sync");
    expect(iac.props.tagDrift).toHaveLength(0);

    expect(LayoutSchema.safeParse(after).success).toBe(true);
    const original = before.components.find((c) => c.type === "LicenseDriftCard");
    expect(original?.type === "LicenseDriftCard" && original.props.driftedCount).toBe(3);
  });

  test("a partial remediation leaves the rest drifted", () => {
    const after = convergeLayout(driftedLayout(), { remediatedUpns: ["lynne@x"] });
    const license = after.components.find((c) => c.type === "LicenseDriftCard");
    if (license?.type !== "LicenseDriftCard") throw new Error("license card missing");
    expect(license.props.entraAssignedCount).toBe(13);
    expect(license.props.driftedCount).toBe(2);
    expect(license.props.state).toBe("warning");
  });
});
