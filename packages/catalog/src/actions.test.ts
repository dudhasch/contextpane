import { describe, expect, test } from "bun:test";
import { LayoutSchema, SCENARIO_IDS, SCENARIO_REGISTRY, convergeLayout, type Layout } from "./index.ts";

function driftedLayout(): Layout {
  return LayoutSchema.parse({
    tenantId: "tenant-contoso-01",
    ticketId: "INC-4092",
    layoutId: "lay-test",
    generatedAt: "2026-10-26T08:40:00Z",
    provenance: { tier: "Tier 1B", provider: "meta", modelId: "muse-spark-1.3", latencyMs: 4000, tokensUsed: 10000 },
    components: [
      {
        type: "LicenseDriftCard",
        id: "license",
        props: {
          headline: "3 users on SPE_E3 instead of SPE_E5",
          skuName: "Microsoft 365 E5",
          skuPartNumber: "SPE_E5",
          groupName: "SG-Contoso-Finance-AVD",
          skuPools: [
            { skuPartNumber: "SPE_E5", skuName: "Microsoft 365 E5", enabled: 15, consumed: 12, available: 3, source: "fixture" },
            { skuPartNumber: "SPE_E3", skuName: "Microsoft 365 E3", enabled: 3, consumed: 3, available: 0, source: "fixture" },
          ],
          users: [
            { upn: "lynne@x", displayName: "Lynne", currentSku: "SPE_E3", expectedSku: "SPE_E5", assignmentState: "Drifted", driftStatus: "drifted" },
            { upn: "alex@x", displayName: "Alex", currentSku: "SPE_E5", expectedSku: "SPE_E5", assignmentState: "Active", driftStatus: "compliant" },
            { upn: "diego@x", displayName: "Diego", currentSku: "SPE_E3", expectedSku: "SPE_E5", assignmentState: "Drifted", driftStatus: "drifted" },
            { upn: "patti@x", displayName: "Patti", currentSku: "SPE_E3", expectedSku: "SPE_E5", assignmentState: "Drifted", driftStatus: "drifted" },
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
          azurePolicies: [{ name: "Management ports should be closed on your virtual machines", effect: "AuditIfNotExists", compliance: "NonCompliant", nonCompliantResources: 1, scope: "rg-contoso-avd-prod" }],
          state: "critical",
          comparedAgainst: "live-azure",
        },
      },
    ],
  });
}

function licenseOf(layout: Layout) {
  const license = layout.components.find((c) => c.type === "LicenseDriftCard");
  if (license?.type !== "LicenseDriftCard") throw new Error("license card missing");
  return license.props;
}

describe("convergeLayout", () => {
  test("activates remediated users, moves seats between pools and clears the NSG and Azure Policy drift", () => {
    const before = driftedLayout();
    const after = convergeLayout(before, { remediatedUpns: ["LYNNE@x", "diego@x", "patti@x"], reclaimedUpns: [] });
    const license = licenseOf(after);
    expect(license.state).toBe("healthy");
    expect(license.users.every((u) => u.assignmentState === "Active" && u.currentSku === "SPE_E5")).toBe(true);
    expect(license.skuPools.find((p) => p.skuPartNumber === "SPE_E5")).toMatchObject({ consumed: 15, available: 0 });
    expect(license.skuPools.find((p) => p.skuPartNumber === "SPE_E3")).toMatchObject({ consumed: 0, available: 3 });

    const iac = after.components.find((c) => c.type === "IaCDriftBanner");
    if (iac?.type !== "IaCDriftBanner") throw new Error("banner missing");
    expect(iac.props.driftState).toBe("in-sync");
    expect(iac.props.tagDrift).toHaveLength(0);
    expect(iac.props.azurePolicies.every((p) => p.compliance === "Compliant")).toBe(true);
    expect(iac.props.azurePolicies[0]?.detail).toBe("0 management ports exposed to Internet — TCP/3389 closed");

    expect(LayoutSchema.safeParse(after).success).toBe(true);
    expect(licenseOf(before).users.filter((u) => u.driftStatus === "drifted")).toHaveLength(3);
  });

  test("converges EntraSignInTimeline events to success and sets accurate workload-identity vs CA headline", () => {
    const workloadLayout = LayoutSchema.parse({
      ...driftedLayout(),
      components: [
        {
          type: "EntraSignInTimeline",
          id: "entra",
          props: {
            headline: "AADSTS7000222 nightly failures",
            focusUpn: "alex.wilber@c4a8shili.onmicrosoft.com",
            windowStart: "2026-10-26T00:00:00Z",
            windowEnd: "2026-10-26T08:00:00Z",
            events: [
              {
                id: "ev-1",
                timestamp: "2026-10-26T02:00:00Z",
                upn: "spn-contoso-erp-sync",
                displayName: "spn-contoso-erp-sync",
                appDisplayName: "Microsoft Graph",
                appId: "00000003-0000-0000-c000-000000000000",
                status: "failure",
                errorCode: 7000222,
                errorCodeLabel: "AADSTS7000222",
                conditionalAccessStatus: "notApplied",
                clientApp: "GitHub Actions",
                location: "Dublin, IE",
                ipAddress: "185.199.108.40",
                deviceName: "",
                deviceCompliant: null,
                isHighlighted: true,
              },
            ],
            rootCause: { errorCodeLabel: "AADSTS7000222", targetApp: "Microsoft Graph", explanation: "Secret expired" },
            policies: [
              {
                id: "spn-contoso-erp-sync-01",
                displayName: "spn-contoso-erp-sync",
                state: "enabled",
                role: "drifted",
                includeGroups: ["alex.wilber@c4a8shili.onmicrosoft.com"],
                excludeGroups: [],
                targetApps: ["Microsoft Graph"],
                clientAppTypes: ["GitHub Actions"],
                grantControls: ["Directory.ReadWrite.All"],
                drift: [{ field: "owners", expected: "none", actual: "alex", severity: "critical" }],
                modifiedDateTime: "2026-10-26T00:00:00Z",
              },
            ],
            microActions: [],
            state: "critical",
          },
        },
      ],
    });
    const converged = convergeLayout(workloadLayout, { remediatedUpns: [], reclaimedUpns: [] });
    const entra = converged.components[0];
    if (entra?.type !== "EntraSignInTimeline") throw new Error("entra missing");
    expect(entra.props.headline).toBe("Resolved · OIDC federation active, shadow-admin owner removed & Graph scopes right-sized");
    expect(entra.props.events[0]?.status).toBe("success");
    expect(entra.props.events[0]?.errorCodeLabel).toBeUndefined();
    expect(entra.props.policies[0]?.drift).toEqual([]);
  });

  test("a partial remediation leaves the rest drifted", () => {
    const license = licenseOf(convergeLayout(driftedLayout(), { remediatedUpns: ["lynne@x"], reclaimedUpns: [] }));
    expect(license.users.filter((u) => u.assignmentState === "Drifted")).toHaveLength(2);
    expect(license.state).toBe("warning");
  });

  test("reclaiming orphaned seats frees them for the CountViolation users", () => {
    const layout = LayoutSchema.parse({
      ...driftedLayout(),
      components: [
        {
          type: "LicenseDriftCard",
          id: "license",
          props: {
            headline: "SG-Contoso-M365-E5: CountViolation",
            skuName: "Microsoft 365 E5",
            skuPartNumber: "SPE_E5",
            groupName: "SG-Contoso-M365-E5",
            skuPools: [{ skuPartNumber: "SPE_E5", skuName: "Microsoft 365 E5", enabled: 15, consumed: 15, available: 0, source: "fixture" }],
            groupErrors: [{ groupName: "SG-Contoso-M365-E5", skuPartNumber: "SPE_E5", state: "CountViolation", affectedUsers: 2, detail: "15/15 consumed" }],
            users: [
              { upn: "old1@x", displayName: "Old 1", accountEnabled: false, currentSku: "SPE_E5", expectedSku: "NONE", assignmentState: "Orphaned", driftStatus: "drifted" },
              { upn: "old2@x", displayName: "Old 2", accountEnabled: false, currentSku: "SPE_E5", expectedSku: "NONE", assignmentState: "Orphaned", driftStatus: "drifted" },
              { upn: "old3@x", displayName: "Old 3", accountEnabled: false, currentSku: "SPE_E5", expectedSku: "NONE", assignmentState: "Orphaned", driftStatus: "drifted" },
              { upn: "new1@x", displayName: "New 1", currentSku: "NONE", expectedSku: "SPE_E5", assignmentState: "Error: CountViolation", driftStatus: "unassigned" },
              { upn: "new2@x", displayName: "New 2", currentSku: "NONE", expectedSku: "SPE_E5", assignmentState: "Error: CountViolation", driftStatus: "unassigned" },
            ],
            state: "critical",
          },
        },
      ],
    });
    const license = licenseOf(
      convergeLayout(layout, { remediatedUpns: ["new1@x", "new2@x"], reclaimedUpns: ["old1@x", "old2@x", "old3@x"] }),
    );
    expect(license.groupErrors).toHaveLength(0);
    expect(license.skuPools[0]).toMatchObject({ consumed: 14, available: 1 });
    expect(license.users.filter((u) => u.assignmentState === "Reclaimed")).toHaveLength(3);
    expect(license.state).toBe("healthy");
  });
});

describe("scenario registry", () => {
  test("every scenario renders at least one card and names a remediation scope", () => {
    for (const id of SCENARIO_IDS) {
      expect(SCENARIO_REGISTRY[id].components.length).toBeGreaterThan(0);
      expect(SCENARIO_REGISTRY[id].remediationScope.length).toBeGreaterThan(5);
    }
    expect(SCENARIO_IDS.filter((id) => SCENARIO_REGISTRY[id].kind === "anomaly")).toHaveLength(4);
  });
});
