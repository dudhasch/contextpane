import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { SCENARIO_IDS } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext } = await import("../mcp/context.ts");
const { buildRemediationPlan } = await import("./remediate.ts");
const { buildInverseRollback } = await import("./formal-verifier.ts");
const { buildDeviceHealthScripts } = await import("./intune-remediation.ts");
const { checkPowerShellAst } = await import("../preflight/local.ts");

const HAS_PWSH = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

/** Ids from before the Dim 4 ledger fixes (G-1, G-3, G-4, I-1, I-9, R-1..R-6): synthetic or the wrong SKU. */
const PHANTOM_IDS = [
  "6fd2c87f-b296-42f0-b197-1e91e994b900", // Office 365 E3, not Microsoft 365 E3
  "6f8a9b0c-1d2e-4f3a-9b8c-7d6e5f4a3b2c",
  "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
  "d09ae604-9c1e-4b9c-9a5d-000000000001",
  "d4e5f6a7-b8c9-4d5e-8f0a-1b2c3d4e5f6a",
  "b1c2d3e4-1111-4222-8333-444455556666",
  "c3d4e5f6-2222-4333-8444-555566667777",
];

describe("generated cloud scripts (Dim 4 ledger)", () => {
  test("INC-4092: ids resolved at runtime, no swallowed 404, conditions.users carried whole", async () => {
    const plan = buildRemediationPlan(await gatherContext("INC-4092", { fresh: true }));
    const script = plan.bundle.powershellScript;
    expect(script).toContain("#Requires -Modules Microsoft.Graph.Users, Microsoft.Graph.Users.Actions");
    expect(script).toContain("Get-GroupByName $LegacyGroupName");
    expect(script).not.toContain("-ErrorAction SilentlyContinue");
    expect(script).toContain("includeRoles  = @($u.IncludeRoles)");
    expect(script).not.toMatch(/includeGroups\)\s*\+/);
    const patch = JSON.parse(plan.bundle.graphPatch) as Array<{ method: string; url: string; body?: { conditions?: { users?: { includeGroups?: string[] } } } }>;
    expect(patch.some((r) => r.url.includes("/groups/5e82f43a-f4cb-4ef9-8206-1cf01e101a54/members/"))).toBe(true);
    const ca = patch.find((r) => r.method === "PATCH");
    expect(ca?.url).toContain("d09ae604-4c06-4769-ad01-20ec8efa18ad");
    expect(ca?.body?.conditions?.users?.includeGroups).toEqual(["5e82f43a-f4cb-4ef9-8206-1cf01e101a54"]);
  });

  test("INC-4099: detect is compliant at the golden value 7 and the assignment remediates on a schedule", async () => {
    const plan = buildRemediationPlan(await gatherContext("INC-4099", { fresh: true }));
    const script = plan.bundle.powershellScript;
    expect(script).toContain("Microsoft.Graph.Beta.DeviceManagement");
    expect(script).toContain("$fve.$_ -ne 7");
    expect(script).toContain("runRemediationScript = $true");
    expect(script).toContain("deviceHealthScriptDailySchedule");
    expect(script).toContain("Get-GroupByName $AssignmentGroupName");
    expect(script).not.toMatch(/Remove-ItemProperty[^\n]*AllowWarningForOtherDiskEncryption/);
  });

  test("no phantom or wrong-SKU ids in any forward or inverse script", async () => {
    for (const id of SCENARIO_IDS) {
      const plan = buildRemediationPlan(await gatherContext(id, { fresh: true }));
      const text = [plan.bundle.powershellScript, plan.bundle.graphPatch, buildInverseRollback(id).powershellScript].join("\n");
      for (const fake of PHANTOM_IDS) expect({ id, has: text.includes(fake) }).toEqual({ id, has: false });
      expect(text).not.toContain("Invoke-MgDeviceManagementManagedDeviceSyncDevice");
    }
  });

  test.skipIf(!HAS_PWSH)(
    "every generated script parses with the PowerShell 7 parser",
    async () => {
      const scripts: Array<[string, string]> = [];
      for (const id of SCENARIO_IDS) {
        scripts.push([`${id} forward`, buildRemediationPlan(await gatherContext(id, { fresh: true })).bundle.powershellScript]);
        scripts.push([`${id} inverse`, buildInverseRollback(id).powershellScript]);
      }
      for (const id of ["INC-4099", "ANOM-INT-309"]) {
        const { detect, remediate } = buildDeviceHealthScripts(id);
        scripts.push([`${id} Detect.ps1`, detect], [`${id} Remediate.ps1`, remediate]);
      }
      // Tenant scripts also go through the pre-flight verb allow-list; endpoint scripts (*.ps1) only need to parse.
      const lint = (name: string) => (name.endsWith(".ps1") ? /parse|AST runner|Unbalanced/i : /parse|AST runner|Verb outside|Unbalanced|Forbidden/i);
      const results = await Promise.all(scripts.map(async ([name, s]) => ({ name, findings: (await checkPowerShellAst(s, 30_000, [])).findings.filter((f) => lint(name).test(f)) })));
      expect(results.filter((r) => r.findings.length > 0)).toEqual([]);
    },
    120_000,
  );
});
