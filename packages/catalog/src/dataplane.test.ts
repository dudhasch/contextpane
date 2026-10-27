import { describe, expect, test } from "bun:test";
import { PII_FIELDS, applyPtrQuery, createPiiVault, dataPtr, datasetsFor, formatSourceRef, getHydrateLayoutToolDefinition, locateJsonPath, parseDataPtr, parsePtrQuery, pseudonymizeForLlm, resolvePointer } from "./index.ts";

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

describe("ptr:// v2 relational queries", () => {
  const rows = [
    { upn: "b@x", status: "drifted", assignedSku: "E3", expectedSku: "E5" },
    { upn: "a@x", status: "compliant", assignedSku: "E5", expectedSku: "E5" },
    { upn: "c@x", status: "drifted", assignedSku: "E3", expectedSku: "E5" },
  ];
  test("where filters (comma = AND)", () => {
    expect(resolvePointer("ptr://inc-4092/entra/users?where=status:drifted", rows).rows.map((r) => r.upn)).toEqual(["b@x", "c@x"]);
    expect(resolvePointer("ptr://inc-4092/entra/users?where=status:drifted,assignedSku:E3", rows).rows).toHaveLength(2);
    expect(resolvePointer("ptr://inc-4092/entra/users?where=status:drifted,assignedSku:E5", rows).rows).toHaveLength(0);
  });
  test("select projects only requested fields", () => {
    expect(resolvePointer("ptr://inc-4092/entra/users?select=upn,expectedSku", rows).rows[0]).toEqual({ upn: "b@x", expectedSku: "E5" });
  });
  test("order asc and -field desc", () => {
    expect(resolvePointer("ptr://inc-4092/entra/users?order=upn", rows).rows.map((r) => r.upn)).toEqual(["a@x", "b@x", "c@x"]);
    expect(resolvePointer("ptr://inc-4092/entra/users?order=-upn", rows).rows.map((r) => r.upn)).toEqual(["c@x", "b@x", "a@x"]);
  });
  test("combined where+select+order (spec example shape)", () => {
    const hit = resolvePointer("ptr://inc-4092/entra/users?where=status:drifted&select=upn,assignedSku,expectedSku&order=upn", rows);
    expect(hit.found).toBe(true);
    expect(hit.rows).toEqual([{ upn: "b@x", assignedSku: "E3", expectedSku: "E5" }, { upn: "c@x", assignedSku: "E3", expectedSku: "E5" }]);
    expect(parseDataPtr("ptr://inc-4092/entra/users?where=status:drifted&select=upn&order=-upn")?.query).toEqual({ where: [{ field: "status", operator: "eq", value: "drifted" }], select: ["upn"], order: { field: "upn", direction: "desc" } });
  });
  test("invalid field/operator/param fails closed, never raw", () => {
    for (const ptr of ["ptr://inc-4092/entra/users?where=nope:drifted", "ptr://inc-4092/entra/users?select=nope", "ptr://inc-4092/entra/users?order=nope", "ptr://inc-4092/entra/users?where=status=drifted", "ptr://inc-4092/entra/users?where=status!=drifted", "ptr://inc-4092/entra/users?limit=2"]) {
      const hit = resolvePointer(ptr, rows);
      expect(hit.found).toBe(false);
      expect(hit.rows).toEqual([]);
      expect(hit.value).toEqual([]);
    }
    expect(parseDataPtr("ptr://inc-4092/entra/users?where=status=drifted")).toBeNull();
    expect(parsePtrQuery("?where=status:drifted").error).toBeUndefined();
    expect(applyPtrQuery(rows, { where: [{ field: "nope", operator: "eq", value: "x" }] }).rows).toEqual([]);
  });
  test("plain ptr backwards compatible", () => {
    expect(parseDataPtr("ptr://inc-4092/entra/users")).toEqual({ scenario: "inc-4092", dataset: "entra/users" });
    expect(resolvePointer("ptr://inc-4092/entra/users", rows).value).toEqual(rows);
  });
});

describe("PII Pseudonym Vault", () => {
  test("registry tags sensitive fields @pii EU-GDPR-Personal", () => {
    for (const f of ["upn", "displayName", "ipAddress", "userId", "deviceName"] as const) expect(PII_FIELDS[f].annotation).toBe('@pii(classification:"EU-GDPR-Personal")');
  });
  test("deterministic tokens, round-trip, metrics, no raw in LLM output", () => {
    const vault = createPiiVault();
    const input = [{ upn: "alice@contoso.com", displayName: "Alice", ipAddress: "10.0.0.1", deviceName: "WS-1", status: "drifted" }, { upn: "bob@contoso.com", displayName: "Bob", ipAddress: "10.0.0.2", deviceName: "WS-2", status: "drifted" }];
    const safe = vault.pseudonymize(input) as typeof input;
    expect(safe[0]!.upn).toBe("upn_tok_01");
    expect(safe[1]!.upn).toBe("upn_tok_02");
    expect(safe[0]!.ipAddress).toBe("ip_tok_01");
    expect(safe[0]!.status).toBe("drifted");
    const json = JSON.stringify(safe);
    expect(json).not.toContain("alice@contoso.com");
    expect(json).not.toContain("10.0.0.1");
    expect(vault.unvault("upn_tok_01")).toBe("alice@contoso.com");
    expect(vault.depseudonymize(safe)).toEqual(input);
    const m = vault.metrics();
    expect(m.zeroRawPiiInLlmPrompt).toBe(true);
    expect(m.piiFieldsVaulted).toBe(8);
    expect(m.tokenMappings.upn_tok_01).toBe("alice@contoso.com");
    expect(m.sampleMappings.ip_tok_01).toBe("10.0.0.1");
    // deterministic: same input in a fresh vault yields same tokens
    expect((createPiiVault().pseudonymize(input) as typeof input)[0]!.upn).toBe("upn_tok_01");
    expect(JSON.stringify(pseudonymizeForLlm(input, createPiiVault()))).not.toContain("bob@contoso.com");
  });

  test("excludes machine service principals and GitHub Actions runner IPs from EU-GDPR-Personal vaulting", () => {
    const vault = createPiiVault();
    const rows = [
      { upn: "spn-contoso-erp-sync", displayName: "spn-contoso-erp-sync", ipAddress: "185.199.108.40", clientApp: "GitHub Actions", deviceName: "", status: "failure" },
      { upn: "alex.wilber@c4a8shili.onmicrosoft.com", displayName: "Alex Wilber", ipAddress: "52.114.77.21", clientApp: "Browser", deviceName: "CONTOSO-LT-0471", status: "success" },
    ];
    const safe = vault.pseudonymize(rows) as typeof rows;
    expect(safe[0]!.upn).toBe("spn-contoso-erp-sync");
    expect(safe[0]!.displayName).toBe("spn-contoso-erp-sync");
    expect(safe[0]!.ipAddress).toBe("185.199.108.40");
    expect(safe[1]!.upn).toBe("upn_tok_01");
    expect(safe[1]!.displayName).toBe("displayName_tok_01");
    expect(safe[1]!.ipAddress).toBe("ip_tok_01");
    expect(safe[1]!.deviceName).toBe("device_tok_01");
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
