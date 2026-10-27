import { describe, expect, test } from "bun:test";
import { HOVER_JSON_SCHEMA, OPEN_WEIGHT_INFERENCE_CONFIG, buildHoverResponseFormat, buildOpenWeightHoverPayload } from "./glimmer-payload.ts";

/** Every object node in a JSON schema, for the additionalProperties sweep. */
function objectNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) objectNodes(item, out);
  } else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.type === "object") out.push(record);
    for (const value of Object.values(record)) objectNodes(value, out);
  }
  return out;
}

describe("buildHoverResponseFormat", () => {
  test("is a strict json_schema named HoverDiagnostic", () => {
    const format = buildHoverResponseFormat();
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.name).toBe("HoverDiagnostic");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema).toEqual(JSON.parse(JSON.stringify(HOVER_JSON_SCHEMA)));
  });

  test("requires exactly the HoverDiagnosticArgs fields and forbids extras at every level", () => {
    expect([...HOVER_JSON_SCHEMA.required].sort().join(",")).toBe(
      ["entityId", "entityType", "status", "headline", "errorCodeTranslation", "facts", "quickActions"].sort().join(","),
    );
    expect(Object.keys(HOVER_JSON_SCHEMA.properties).sort()).toEqual([...HOVER_JSON_SCHEMA.required].sort());
    for (const node of objectNodes(HOVER_JSON_SCHEMA)) {
      expect(node.additionalProperties).toBe(false);
      // Strict mode: every declared property is required (optionals are nullable).
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
    }
  });

  test("leaves no slot for a hallucinated ptr:// / dataPtr", () => {
    const serialized = JSON.stringify(HOVER_JSON_SCHEMA);
    expect(serialized).not.toContain('"dataPtr"');
    expect(serialized).not.toContain("ptr://<");
    const facts = HOVER_JSON_SCHEMA.properties.facts.items;
    expect(Object.keys(facts.properties)).not.toContain("dataPtr");
  });

  test("mirrors the catalog caps", () => {
    expect(HOVER_JSON_SCHEMA.properties.headline.maxLength).toBe(120);
    expect(HOVER_JSON_SCHEMA.properties.facts.maxItems).toBe(8);
    expect(HOVER_JSON_SCHEMA.properties.quickActions.maxItems).toBe(4);
    expect(HOVER_JSON_SCHEMA.properties.entityType.enum).toContain("errorCode");
    expect(HOVER_JSON_SCHEMA.properties.status.enum).toEqual(["healthy", "warning", "critical", "unknown"]);
  });

  test("each call returns an independent copy", () => {
    const a = buildHoverResponseFormat();
    (a.json_schema.schema as unknown as { required: string[] }).required.push("bogus");
    expect(buildHoverResponseFormat().json_schema.schema.required).not.toContain("bogus");
  });
});

describe("buildOpenWeightHoverPayload + OPEN_WEIGHT_INFERENCE_CONFIG", () => {
  test("payload carries the strict response_format and serializes to JSON", () => {
    const payload = buildOpenWeightHoverPayload({
      model: "muse-glimmer-30b",
      messages: [
        { role: "system", content: "diagnose" },
        { role: "user", content: "{}" },
      ],
    });
    expect(payload.model).toBe("muse-glimmer-30b");
    expect(payload.response_format).toEqual(buildHoverResponseFormat());
    expect(payload.stream).toBe(false);
    const roundTripped = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(roundTripped.response_format.json_schema.strict).toBe(true);
    expect(roundTripped.response_format.json_schema.name).toBe("HoverDiagnostic");
  });

  test("inference config constants match the llama-server flags", () => {
    expect(OPEN_WEIGHT_INFERENCE_CONFIG).toEqual({
      grammarConstrained: true,
      kvCacheQuant: "q8_0",
      speculativeDraftMax: 8,
      speculativeDraftMin: 2,
    });
  });
});
