import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LIVE_CLOUD_MODE = "false";
const { AuditLedger, GENESIS_HASH, hashAuditEntry, verifyAuditChain } = await import("./audit.ts");

const BASE = {
  tenantId: "tenant-contoso-01",
  ticketId: "INC-4092",
  actionType: "hitl-approval" as const,
  delegatedIdentity: "cloudadmin@c4a8shili.onmicrosoft.com",
  modalSandboxVerified: false,
  astPass: null,
  tfValidatePass: null,
  gitBranch: null,
  prUrl: null,
  latencyMs: 12,
};

function ledgerIn(dir: string) {
  return new AuditLedger({ file: join(dir, "audit-log.jsonl"), persist: true });
}

describe("hash-chained audit ledger (review H5)", () => {
  test("appends one JSON line per entry, linked by prevHash, and verifies end to end", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-audit-"));
    const ledger = ledgerIn(dir);
    const a = ledger.append({ ...BASE, detail: "one" });
    const b = ledger.append({ ...BASE, detail: "two" });
    const c = ledger.append({ ...BASE, detail: "three", delegatedIdentity: "contextpane-fleet" });
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(a.hash).toBe(hashAuditEntry(a));
    expect(a.identitySource).toBe("configured-default");
    expect(c.identitySource).toBe("system");
    expect(readFileSync(ledger.path(), "utf8").trim().split("\n")).toHaveLength(3);
    expect(ledger.verify()).toEqual({ ok: true, entries: 3 });
    // A fresh process reads the same chain back.
    expect(ledgerIn(dir).list(10).map((e) => e.detail)).toEqual(["three", "two", "one"]);
  });

  test("an edited, removed or garbled line breaks the chain at that entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-audit-"));
    const ledger = ledgerIn(dir);
    const first = ledger.append({ ...BASE, detail: "approve 3 users" });
    const second = ledger.append({ ...BASE, detail: "rollback" });
    ledger.append({ ...BASE, detail: "close" });
    const file = ledger.path();
    const lines = readFileSync(file, "utf8").trim().split("\n");

    writeFileSync(file, `${[lines[0]!.replace("approve 3 users", "approve 0 users"), lines[1], lines[2]].join("\n")}\n`);
    expect(ledgerIn(dir).verify()).toMatchObject({ ok: false, brokenAt: first.id, reason: expect.stringContaining("hash") });

    writeFileSync(file, `${[lines[0], lines[2]].join("\n")}\n`);
    expect(ledgerIn(dir).verify()).toMatchObject({ ok: false, reason: expect.stringContaining("prevHash") });

    writeFileSync(file, `${[lines[0], "{not json", lines[2]].join("\n")}\n`);
    expect(ledgerIn(dir).verify()).toMatchObject({ ok: false, reason: expect.stringContaining("line 2") });

    expect(verifyAuditChain([first, second])).toEqual({ ok: true, entries: 2 });
  });

  test("a pre-chain audit-log.json is migrated once into a verifying chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-audit-"));
    const legacy = [1, 2].map((n) => ({ ...BASE, id: `aud-old-${n}`, timestamp: `2026-10-2${n}T10:00:00.000Z`, detail: `old ${n}`, execution: "none", executionMode: null }));
    writeFileSync(join(dir, "audit-log.json"), JSON.stringify({ version: 1, entries: legacy }));
    const ledger = ledgerIn(dir);
    expect(ledger.list(10).map((e) => e.id)).toEqual(["aud-old-2", "aud-old-1"]);
    expect(existsSync(join(dir, "audit-log.json"))).toBe(false);
    expect(existsSync(join(dir, "audit-log.json.migrated"))).toBe(true);
    ledger.append({ ...BASE, detail: "after migration" });
    expect(ledgerIn(dir).verify()).toEqual({ ok: true, entries: 3 });
  });
});
