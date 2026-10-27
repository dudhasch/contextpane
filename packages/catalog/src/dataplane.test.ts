import { describe, expect, test } from "bun:test";
import {
  HUMAN_FOVEAL_CAPACITY_BITS,
  PII_FIELDS,
  applyPtrQuery,
  buildColumnarIndex,
  bumpDataPlaneEpoch,
  computeBurstiness,
  computeLog2RowBucket,
  createPiiVault,
  dataPtr,
  datasetsFor,
  fencedDataPtr,
  formatSourceRef,
  getDataPlaneEpoch,
  getHydrateLayoutToolDefinition,
  isMachineOrNonPersonalPii,
  locateJsonPath,
  parseDataPtr,
  parsePtrQuery,
  pseudonymizeForLlm,
  registerDataset,
  resolvePointer,
  scoreInformationBottleneck,
  verifyPointerFence,
} from "./index.ts";

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

describe("ptr:// v3 generation fencing, columnar bitmap index, order-preserving HMAC & IB scorer", () => {
  test("generation & tenant fence fails closed on stale epochs and cross-tenant pointers", () => {
    const epochBefore = getDataPlaneEpoch();
    const rows = [
      { upn: "lynne@contoso.com", status: "drifted", assignedSku: "E3" },
      { upn: "diego@contoso.com", status: "drifted", assignedSku: "E3" },
    ];
    const reg = registerDataset("INC-4092", "entra/users", rows, {
      tenantId: "tenant-contoso-01",
      epoch: epochBefore,
    });
    expect(reg.fence.tenantId).toBe("tenant-contoso-01");
    expect(reg.fence.epoch).toBe(epochBefore);
    expect(reg.fence.generation).toBeGreaterThanOrEqual(1);

    const fenced = fencedDataPtr("INC-4092", "entra/users", reg.fence);
    expect(verifyPointerFence(fenced, "tenant-contoso-01", epochBefore).valid).toBe(true);
    expect(verifyPointerFence(fenced, "tenant-fabrikam-02", epochBefore).valid).toBe(false);
    expect(verifyPointerFence(fenced, "tenant-fabrikam-02", epochBefore).reason).toBe("cross-tenant");

    const nextEpoch = bumpDataPlaneEpoch();
    expect(verifyPointerFence(fenced, "tenant-contoso-01", nextEpoch).valid).toBe(false);
    expect(verifyPointerFence(fenced, "tenant-contoso-01", nextEpoch).reason).toBe("stale-epoch");
  });

  test("ColumnarTableView executes bitmap filtering & pre-sorted index permutation and records columnarScanNs", () => {
    const rows = [
      { upn: "zoe@contoso.com", status: "drifted", sku: "E3" },
      { upn: "amy@contoso.com", status: "compliant", sku: "E5" },
      { upn: "bob@contoso.com", status: "drifted", sku: "E3" },
    ];
    const view = buildColumnarIndex(rows);
    expect(view).not.toBeNull();
    expect(view!.rowCount).toBe(3);
    expect([...view!.columns.keys()]).toEqual(["upn", "status", "sku"]);
    const res = applyPtrQuery(
      rows,
      {
        where: [{ field: "status", operator: "eq", value: "drifted" }],
        select: ["upn", "sku"],
        order: { field: "upn", direction: "asc" },
      },
      view,
    );
    expect(res.error).toBeUndefined();
    expect(res.columnarScanNs).toBeGreaterThanOrEqual(0);
    expect(res.rows).toEqual([
      { upn: "bob@contoso.com", sku: "E3" },
      { upn: "zoe@contoso.com", sku: "E3" },
    ]);
  });

  test("order-preserving PII vault tokens preserve order=upn sort equivalence and protect human svc-admin@contoso.com", () => {
    // Human UPN with svc- prefix must NEVER be exempted from GDPR vaulting
    expect(isMachineOrNonPersonalPii("upn", "svc-admin@contoso.com", { upn: "svc-admin@contoso.com" })).toBe(false);
    // Attested machine SPN without @ is exempted
    expect(isMachineOrNonPersonalPii("upn", "spn-contoso-erp-sync", { upn: "spn-contoso-erp-sync", clientApp: "GitHub Actions" })).toBe(true);

    const cleartext = [
      { upn: "zoe.admin@contoso.com", status: "drifted" },
      { upn: "alice.fin@contoso.com", status: "drifted" },
      { upn: "svc-admin@contoso.com", status: "drifted" },
      { upn: "bob.ops@contoso.com", status: "drifted" },
    ];
    const vault = createPiiVault();
    const vaulted = vault.pseudonymize(cleartext) as typeof cleartext;

    // Ensure svc-admin@contoso.com is vaulted
    expect(JSON.stringify(vaulted)).not.toContain("svc-admin@contoso.com");

    // Sort cleartext vs sort vaulted by upn and depseudonymize
    const sortedCleartextUpns = resolvePointer("ptr://inc-4092/entra/users?order=upn", cleartext).rows.map((r) => String(r.upn));
    const sortedVaultedRows = resolvePointer("ptr://inc-4092/entra/users?order=upn", vaulted).rows;
    const unvaultedSortedUpns = (vault.depseudonymize(sortedVaultedRows) as typeof cleartext).map((r) => String(r.upn));
    expect(unvaultedSortedUpns).toEqual(sortedCleartextUpns);
  });

  test("Honest Blind Structural Sketches compute burstiness B in [-1, 1] and log2RowBucket", () => {
    const burstyRows = [
      { timestamp: "2026-10-26T08:00:00Z" },
      { timestamp: "2026-10-26T08:00:01Z" },
      { timestamp: "2026-10-26T08:00:02Z" },
      { timestamp: "2026-10-26T08:30:00Z" },
    ];
    const b = computeBurstiness(burstyRows);
    expect(b).toBeGreaterThanOrEqual(-1);
    expect(b).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThan(0); // bursty arrivals have sigma > mu -> B > 0
    expect(computeLog2RowBucket(0)).toBe(0);
    expect(computeLog2RowBucket(6)).toBe(3);
  });

  test("Information Bottleneck scorer enforces viewportEntropyBits <= 42.0 bits", () => {
    const report = scoreInformationBottleneck([
      { id: "LicenseDriftCard", rowCount: 15, columns: ["upn", "sku", "status", "group", "error"], aggregates: { "status:drifted": 3 } },
      { id: "EntraSignInTimeline", rowCount: 24, columns: ["timestamp", "upn", "status", "errorCode", "policy"], aggregates: { "status:failure": 6 } },
      { id: "IaCDriftBanner", rowCount: 8, columns: ["ruleName", "port", "source", "access"], aggregates: { "severity:critical": 1 } },
    ]);
    expect(report.humanCapacityBits).toBe(HUMAN_FOVEAL_CAPACITY_BITS);
    expect(report.viewportEntropyBits).toBeLessThanOrEqual(HUMAN_FOVEAL_CAPACITY_BITS);
    expect(report.uncollapsedEntropyBits).toBeGreaterThan(report.viewportEntropyBits);
    expect(report.withinBudget).toBe(true);
    expect(report.mutualInfoScore).toBeGreaterThan(0.5);
  });
});
