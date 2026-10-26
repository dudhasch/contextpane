import { describe, expect, test } from "bun:test";
import { branchNameFor } from "../preflight/staging.ts";
import { canonicalPrTitle, summarizeTerraformDiff } from "./tier3-remediate.ts";

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

describe("Tier 3 staging", () => {
  test("one canonical branch per ticket", () => {
    expect(branchNameFor("INC-4092", "Contoso Finance")).toBe("fix/INC-4092-contoso-remediation");
    expect(branchNameFor("INC-4099", "Fabrikam Legal")).toBe("fix/INC-4099-fabrikam-remediation");
  });

  test("canonical PR title", () => {
    expect(canonicalPrTitle("tenant-contoso-01", "INC-4092", "Contoso Finance")).toBe(
      "fix(INC-4092): remediate Contoso Finance AVD NSG drift & E5 license state [ContextPane Tier 3]",
    );
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
