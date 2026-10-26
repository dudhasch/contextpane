import { describe, expect, test } from "bun:test";
import { dataPtr, datasetsFor, formatSourceRef, getHydrateLayoutToolDefinition, locateJsonPath, parseDataPtr } from "./index.ts";

describe("ptr:// data-plane pointers", () => {
  test("pointers are deterministic per scenario and dataset, and parse back", () => {
    const ptr = dataPtr("INC-4092", "entra/users");
    expect(ptr).toBe("ptr://inc-4092/entra/users");
    expect(parseDataPtr(ptr)).toEqual({ scenario: "inc-4092", dataset: "entra/users" });
    expect(parseDataPtr("ptr://inc-4092/entra/nope")).toBeNull();
    expect(parseDataPtr("https://example.com")).toBeNull();
  });

  test("every row-set prop of a card has a dataset", () => {
    expect(datasetsFor("LicenseDriftCard")).toEqual(["entra/users", "entra/sku-pools", "entra/group-errors"]);
    expect(datasetsFor("IaCDriftBanner")).toContain("iac/drift-diff");
    expect(datasetsFor("IntuneDriftCard")).toContain("intune/devices");
    expect(datasetsFor("EntraSignInTimeline")).toContain("entra/signins");
  });

  test("the model-facing tool takes { dataPtr } for row sets and never asks for sourceRef", () => {
    const params = getHydrateLayoutToolDefinition().function.parameters as any;
    const cards = (params.properties.components.items.anyOf ?? params.properties.components.items.oneOf) as any[];
    const license = cards.find((c) => c.properties.type.const === "LicenseDriftCard");
    expect(Object.keys(license.properties.props.properties.users.properties)).toEqual(["dataPtr"]);
    const iac = cards.find((c) => c.properties.type.const === "IaCDriftBanner");
    expect(iac.properties.props.properties.hclDiff.properties.dataPtr.type).toBe("string");
    expect(iac.properties.props.properties).not.toHaveProperty("sourceRef");
  });
});

describe("JSON line provenance", () => {
  const doc = `${JSON.stringify({ state: "enabled", conditions: { users: { excludeGroups: ["SG-BreakGlass-Accounts"] } }, list: [1, { a: 2 }] }, null, 2)}\n`;

  test("locates a member from its key to the end of its value", () => {
    expect(locateJsonPath(doc, ["state"])).toEqual({ startLine: 2, endLine: 2 });
    expect(locateJsonPath(doc, ["conditions", "users", "excludeGroups"])).toEqual({ startLine: 5, endLine: 7 });
    expect(locateJsonPath(doc, ["list", 1, "a"])).toEqual({ startLine: 13, endLine: 13 });
    expect(locateJsonPath(doc, ["missing"])).toBeNull();
  });

  test("formats a CodeLens label", () => {
    expect(formatSourceRef({ file: "demo-iac/main.tf", startLine: 43, endLine: 84 })).toBe("demo-iac/main.tf:L43-L84");
    expect(formatSourceRef({ file: "a.json", startLine: 7, endLine: 7 })).toBe("a.json:L7");
  });
});
