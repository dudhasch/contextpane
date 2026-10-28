import { describe, expect, test } from "bun:test";
import { EntityTypeSchema } from "@contextpane/catalog";
import { coerceAffectedEntityType, type EntityType } from "./entity-type.ts";

describe("coerceAffectedEntityType", () => {
  test("keeps every catalog entity type unchanged", () => {
    for (const type of EntityTypeSchema.options) {
      expect(coerceAffectedEntityType({ type, id: "x", change: "c" })).toEqual({ type, id: "x", change: "c" });
    }
  });

  test("maps model-written labels onto the enum by keyword", () => {
    const cases: Array<[string, EntityType]> = [
      ["User account", "upn"],
      ["Entra identity", "upn"],
      ["Security group", "group"],
      ["Windows endpoint", "device"],
      ["NSG rule", "policy"],
      ["Conditional Access policy", "policy"],
      ["License SKU", "sku"],
      ["Tenant setting", "setting"],
      ["Virtual machine", "resource"],
      ["", "resource"],
    ];
    for (const [raw, expected] of cases) {
      const out = coerceAffectedEntityType({ type: raw, id: "x", change: "c" });
      expect(out.type).toBe(expected);
      expect(EntityTypeSchema.safeParse(out.type).success).toBe(true);
    }
  });
});
