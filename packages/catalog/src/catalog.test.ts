import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RECIPE,
  HydrateLayoutArgsSchema,
  HYDRATE_LAYOUT_TOOL_NAME,
  ViewRecipeSchema,
  buildForcedToolRequest,
  getHydrateLayoutToolDefinition,
  getHoverDiagnosticToolDefinition,
  lookupAadsts,
  parseToolArguments,
  validateComponents,
} from "./index.ts";

describe("catalog tool definitions", () => {
  test("hydrate_contextpane_layout is a self-contained function tool", () => {
    const tool = getHydrateLayoutToolDefinition();
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe(HYDRATE_LAYOUT_TOOL_NAME);
    expect(tool.function.parameters).not.toHaveProperty("$schema");
    expect(tool.function.parameters.type).toBe("object");
    const props = tool.function.parameters.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["tenantId", "ticketId", "components"]));
    const json = JSON.stringify(tool);
    expect(json).toContain("LicenseDriftCard");
    expect(json).toContain("IaCDriftBanner");
  });

  test("forced tool_choice matches the tool name", () => {
    const req = buildForcedToolRequest(getHoverDiagnosticToolDefinition());
    expect(req.tool_choice).toEqual({ type: "function", function: { name: "emit_hover_diagnostic" } });
    expect(req.tools).toHaveLength(1);
  });
});

describe("validation helpers", () => {
  test("default recipe is valid", () => {
    expect(ViewRecipeSchema.safeParse(DEFAULT_RECIPE).success).toBe(true);
  });

  test("invalid components are rejected individually", () => {
    const result = validateComponents([
      { type: "MarkdownBlock", id: "x", props: { text: "hello" } },
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
          hclDiff: "",
          summary: "drift",
          state: "warning",
          comparedAgainst: "seeded-manifest",
        },
      },
    ]);
    expect(result.valid).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.type).toBe("MarkdownBlock");
  });

  test("hydrate args require at least one component", () => {
    expect(HydrateLayoutArgsSchema.safeParse({ tenantId: "t", ticketId: "i", components: [] }).success).toBe(false);
  });

  test("tool argument parsing tolerates fences", () => {
    expect(parseToolArguments('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseToolArguments('noise {"a":2} trailing')).toEqual({ a: 2 });
    expect(parseToolArguments("")).toBeNull();
  });

  test("AADSTS lookup is case-insensitive and numeric-aware", () => {
    expect(lookupAadsts("aadsts53003")?.category).toBe("conditional-access");
    expect(lookupAadsts(50105)?.code).toBe("AADSTS50105");
    expect(lookupAadsts("AADSTS1")).toBeNull();
  });
});
