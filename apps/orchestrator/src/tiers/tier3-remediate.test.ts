import { describe, expect, test } from "bun:test";
import { LayoutSchema, SCENARIO_IDS, SCENARIO_REGISTRY, ScenarioBriefSchema } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { branchNameFor } = await import("../preflight/staging.ts");
const { checkWhatIfSafety } = await import("../preflight/local.ts");
const { canonicalPrTitle, summarizeTerraformDiff } = await import("./tier3-remediate.ts");
const { gatherContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("../local/brief.ts");
const { buildLayout } = await import("../local/hydrate.ts");
const { buildRemediationPlan } = await import("../local/remediate.ts");
const { buildHoverDiagnostic } = await import("../local/hover.ts");
const { buildInverseRollback } = await import("../local/formal-verifier.ts");
const { buildResolutionNote } = await import("../local/psa-note.ts");
const { clearCustomTickets, registerCustomTicket, SAMPLE_UNSCRIPTED_TICKETS } = await import("../local/custom-ticket.ts");

const DIFF = `===================================================================
--- azure-live/nsg-contoso-avd-hostpool-01.tf	live state (Azure)
+++ demo-iac/main.tf	expected state (Terraform)
@@ -4,12 +4,11 @@
   resource_group_name = "rg-contoso-avd-prod"

   tags = {
-    ChangeTicket = "manual-hotfix-2026-10-24"
-    CostCenter   = "FIN-4092"
-    Environment  = "Prod-Hotfix-Manual"
-    ManagedBy    = "Terraform"
+    CostCenter  = "FIN-4092"
+    Environment = "Production"
+    ManagedBy   = "Terraform"
   }

   security_rule {
@@ -25,19 +24,6 @@
   }

   security_rule {
-    name                       = "Allow-Temp-RDP-Diagnostic-Drift"
-    priority                   = 150
-    direction                  = "Inbound"
-    access                     = "Allow"
-    protocol                   = "Tcp"
-    source_port_range          = "*"
-    destination_port_range     = "3389"
-    source_address_prefix      = "*"
-    destination_address_prefix = "*"
-  }
-
-  security_rule {
     name                       = "Allow-Internal-RDP-Shortpath"
`;

const provenance = { tier: "Tier 0" as const, provider: "local" as const, modelId: "deterministic", latencyMs: 0, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] };

describe("Tier 3 staging", () => {
  test("one canonical branch per scenario", () => {
    expect(branchNameFor("INC-4092", "Contoso Finance")).toBe("fix/INC-4092-contoso-remediation");
    expect(branchNameFor("INC-4099", "Fabrikam Legal")).toBe("fix/INC-4099-fabrikam-remediation");
    expect(branchNameFor("ANOM-CA-204", "Contoso Finance")).toBe("fix/ANOM-CA-204-contoso-remediation");
  });

  test("canonical PR title", () => {
    expect(canonicalPrTitle("INC-4092", "Contoso Finance")).toBe("fix(INC-4092): remediate Contoso Finance AVD NSG drift & E5 license state [ContextPane Tier 3]");
    expect(canonicalPrTitle("ANOM-LIC-101", "Contoso Finance")).toBe("fix(ANOM-LIC-101): remediate Contoso Finance SPE_E5 CountViolation & orphaned licenses [ContextPane Tier 3]");
  });

  test("reads the removed rule and tag changes out of the NSG diff", () => {
    const summary = summarizeTerraformDiff(DIFF);
    expect(summary.removedRules).toEqual([
      { name: "Allow-Temp-RDP-Diagnostic-Drift", priority: "150", direction: "Inbound", access: "Allow", protocol: "Tcp", port: "3389", source: "*" },
    ]);
    expect(summary.tagChanges).toEqual([
      { key: "ChangeTicket", from: "manual-hotfix-2026-10-24", to: null },
      { key: "Environment", from: "Prod-Hotfix-Manual", to: "Production" },
    ]);
  });
});

describe("-WhatIf dry-run proof", () => {
  test("flags a mutation outside ShouldProcess", () => {
    const script = ["[CmdletBinding(SupportsShouldProcess)]", "param()", "Set-MgUserLicense -UserId x -AddLicenses @() -RemoveLicenses @()"].join("\n");
    expect(checkWhatIfSafety(script)).toEqual({ safe: false, unguarded: ["Set-MgUserLicense"] });
  });

  test("accepts guarded calls and ignores the help block", () => {
    const script = [
      "<#",
      "    Runs Invoke-MgLicenseUser for the failed members.",
      "#>",
      "[CmdletBinding(SupportsShouldProcess)]",
      "param()",
      "$json = ConvertTo-Json @(@{ '@odata.type' = '#microsoft.graph.x' })",
      "if ($PSCmdlet.ShouldProcess('x', 'reprocess')) {",
      "    Invoke-MgLicenseUser -UserId x | Out-Null",
      "}",
    ].join("\n");
    expect(checkWhatIfSafety(script).safe).toBe(true);
  });
});

describe("every scenario (offline fixtures)", () => {
  for (const scenarioId of SCENARIO_IDS) {
    test(`${scenarioId}: brief, layout and a dry-run-safe remediation`, async () => {
      const ctx = await gatherContext(scenarioId, { fresh: true });
      const brief = ScenarioBriefSchema.parse(buildScenarioBrief(ctx));
      const cards = SCENARIO_REGISTRY[scenarioId].components;
      expect(brief.steps.length).toBe(3);
      expect(brief.entities.every((e) => cards.includes(e.target))).toBe(true);
      expect(brief.steps.every((s) => cards.includes(s.target))).toBe(true);

      const layout = LayoutSchema.parse(buildLayout(ctx, provenance));
      expect(layout.components.map((c) => c.type)).toEqual(cards);
      expect(layout.components.every((c) => c.triggeredBy.length > 0)).toBe(true);

      const plan = buildRemediationPlan(ctx);
      expect(checkWhatIfSafety(plan.bundle.powershellScript)).toEqual({ safe: true, unguarded: [] });
      for (const cmd of plan.requiredCommands) expect(plan.bundle.powershellScript.toLowerCase()).toContain(cmd);
      // Terraform ships with the IaC card, plus ANOM-APP-401's OpenTofu OIDC federation resource.
      expect(Boolean(plan.bundle.terraformDiff)).toBe(cards.includes("IaCDriftBanner") || scenarioId === "ANOM-APP-401");
      expect(() => JSON.parse(plan.bundle.graphPatch)).not.toThrow();

      // Zero <...> placeholders in powershellScript, graphPatch, terraformDiff, or inverseRollback
      const anglePlaceholderRe = /<[^>\n]+ (?:id|skuId)>/i;
      expect(plan.bundle.powershellScript).not.toMatch(anglePlaceholderRe);
      expect(plan.bundle.graphPatch).not.toMatch(anglePlaceholderRe);
      expect(plan.bundle.terraformDiff).not.toMatch(anglePlaceholderRe);
      const rollback = buildInverseRollback(scenarioId);
      expect(rollback.powershellScript).not.toMatch(anglePlaceholderRe);
      expect(rollback.terraformDiff).not.toMatch(anglePlaceholderRe);

      // Valid unified diff headers when terraformDiff is present
      if (plan.bundle.terraformDiff) {
        expect(plan.bundle.terraformDiff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
        expect(plan.bundle.terraformDiff).not.toContain("@@ workload identity @@");
      }
    });
  }

  test("INC-4092 uses group-based licensing (Remove-MgGroupMemberByRef + Invoke-MgLicenseUser) and preserves CA includeGroups", async () => {
    const ctx = await gatherContext("INC-4092", { fresh: true });
    const plan = buildRemediationPlan(ctx);
    expect(plan.bundle.powershellScript).toContain("Remove-MgGroupMemberByRef");
    expect(plan.bundle.powershellScript).toContain("Invoke-MgLicenseUser");
    expect(plan.bundle.powershellScript).not.toContain("Set-MgUserLicense");
    const ops = JSON.parse(plan.bundle.graphPatch) as Array<{ method: string; url: string; body?: Record<string, unknown> }>;
    expect(ops.some((o) => o.url.includes("/reprocessLicenseAssignment"))).toBe(true);
    const caPatch = ops.find((o) => o.method === "PATCH" && o.url.includes("/identity/conditionalAccess/policies/"));
    expect(caPatch).toBeDefined();
    const usersCond = (caPatch?.body?.conditions as { users?: { includeGroups?: string[]; excludeGroups?: string[] } })?.users;
    expect(usersCond?.includeGroups).toEqual(["6f8a9b0c-1d2e-4f3a-9b8c-7d6e5f4a3b2c"]);
    expect(usersCond?.excludeGroups).toContain("a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d");
  });

  test("INC-4099 primary script and graphPatch include New-MgBetaDeviceManagementDeviceHealthScript for tattooed BitLocker registry cleanup", async () => {
    const ctx = await gatherContext("INC-4099", { fresh: true });
    const plan = buildRemediationPlan(ctx);
    expect(plan.bundle.powershellScript).toContain("New-MgBetaDeviceManagementDeviceHealthScript");
    expect(plan.bundle.powershellScript).toContain("EncryptionMethodWithXtsOs");
    const ops = JSON.parse(plan.bundle.graphPatch) as Array<{ method: string; url: string }>;
    expect(ops.some((o) => o.url === "/beta/deviceManagement/deviceHealthScripts")).toBe(true);
  });

  test("ANOM-APP-401 scopes appRoleAssignment removal to over-privileged roles and grants SharePoint site permission via New-MgSitePermission", async () => {
    const ctx = await gatherContext("ANOM-APP-401", { fresh: true });
    const plan = buildRemediationPlan(ctx);
    expect(plan.bundle.powershellScript).toContain("$overprivilegedRoleIds");
    expect(plan.bundle.powershellScript).toContain("Where-Object { $overprivilegedRoleIds -contains $_.AppRoleId");
    expect(plan.bundle.powershellScript).toContain("New-MgSitePermission");
    const ops = JSON.parse(plan.bundle.graphPatch) as Array<{ method: string; url: string }>;
    expect(ops.some((o) => o.url.includes("/sites/") && o.url.endsWith("/permissions"))).toBe(true);
  });

  test("PSA resolution note on custom unscripted ticket contains zero internal triage debug text", async () => {
    const sample = SAMPLE_UNSCRIPTED_TICKETS[2]!;
    const entry = registerCustomTicket(sample);
    try {
      const ctx = await gatherContext(entry.scenarioId, { fresh: true });
      const brief = buildScenarioBrief(ctx);
      const note = buildResolutionNote({
        brief,
        convergence: {
          scenarioId: entry.scenarioId,
          tenantId: entry.tenantId,
          remediationId: "rem-test-01",
          ticketId: entry.scenarioId,
          convergedAt: "2026-10-27T16:00:00.000Z",
          latencyMs: 12,
          prUrl: null,
          gitBranch: "fix/ANOM-APP-401-contoso-remediation",
          execution: "simulated",
          remediatedUpns: [],
          reclaimedUpns: [],
        },
      });
      expect(note.customerSummary).not.toContain("Unscripted ticket triaged live");
      expect(note.customerSummary).not.toContain("matched MCP data");
      expect(note.customerSummary).not.toContain("inheriting the");
      expect(note.rootCause).not.toContain("Unscripted ticket triaged live");
    } finally {
      clearCustomTickets("unscripted");
    }
  });

  test("user hover: assigned vs expected SKU, assignment state, groups, last block + two micro-actions", async () => {
    const ctx = await gatherContext("INC-4092");
    const hover = buildHoverDiagnostic(ctx, { entityId: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", entityType: "upn" });
    expect(hover.facts.map((f) => f.label)).toEqual(expect.arrayContaining(["Assigned SKU", "Assignment", "Groups", "Last block", "Blocked by"]));
    expect(hover.facts.find((f) => f.label === "Assigned SKU")?.value).toBe("SPE_E3 · expected SPE_E5");
    expect(hover.quickActions.map((a) => a.label)).toEqual(["Inspect Blocking CA Policy", "Stage License Fix"]);
  });
});

describe("remediate() unexpected-error path (L-01)", () => {
  test("a crash before pre-flight yields Verification Failed with every check unknown", async () => {
    const { spyOn } = await import("bun:test");
    const remediateModule = await import("../local/remediate.ts");
    const { remediate } = await import("./tier3-remediate.ts");
    const spy = spyOn(remediateModule, "buildRemediationPlan").mockImplementationOnce(() => {
      throw new Error("simulated planner crash");
    });
    try {
      const { drawer } = await remediate({ scenarioId: "INC-4092", fresh: false });
      expect(drawer.verificationStatus.verdict).toBe("Verification Failed");
      expect(drawer.verificationStatus.astCheckPassed).toBeNull();
      expect(drawer.verificationStatus.whatIfSafe).toBeNull();
      expect(drawer.verificationStatus.terraformFmtPassed).toBeNull();
      expect(drawer.verificationStatus.validationLatencyMs).toBe(0);
      expect(drawer.verificationStatus.findings).toEqual(["pre-flight not run: simulated planner crash"]);
    } finally {
      spy.mockRestore();
    }
  });
});
