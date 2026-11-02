import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { AuditEntry, Convergence } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { app } = await import("./app.ts");
const { apiSecurity } = await import("./security.ts");
const { config } = await import("./config.ts");
const { auditLedger } = await import("./store/audit.ts");
const { closureStore } = await import("./store/closure.ts");
const { convergenceStore } = await import("./store/convergence.ts");

const TOKEN = "test-token-0123456789";
const saved = { ...apiSecurity };
beforeAll(() => Object.assign(apiSecurity, { enforce: true, token: TOKEN }));
afterAll(() => Object.assign(apiSecurity, saved));

const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  app.request(`http://127.0.0.1:4000${path}`, { method: init.method ?? "GET", headers: { host: "127.0.0.1:4000", authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) }, ...(init.body ? { body: init.body } : {}) });

describe("local API guard (Host, bearer token, JSON-only writes)", () => {
  test("a request with the token and a local Host passes", async () => {
    expect((await call("/api/tenants")).status).toBe(200);
  });

  test("a DNS-rebinding Host is refused before anything else", async () => {
    const res = await call("/api/tenants", { headers: { host: "attacker.example:4000" } });
    expect(res.status).toBe(421);
  });

  test("a missing or wrong token is 401; the health probe stays open", async () => {
    expect((await call("/api/tenants", { headers: { authorization: "" } })).status).toBe(401);
    expect((await call("/api/tenants", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call("/api/health", { headers: { authorization: "" } })).status).toBe(200);
    expect((await call("/api/health", { method: "POST", headers: { authorization: "", "content-type": "application/json" }, body: "{}" })).status).toBe(401);
  });

  test("a text/plain or form write is 415, so a cross-site 'simple' request cannot change state", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await call("/api/dynamic-catalog/clear", { method: "POST", headers: { "content-type": type }, body: "{}" });
      expect(res.status).toBe(415);
    }
  });

  test("a write from a foreign Origin is 403, a local Origin passes the guard", async () => {
    const foreign = await call("/api/tickets/close", { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: "{}" });
    expect(foreign.status).toBe(403);
    const local = await call("/api/tickets/close", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ scenarioId: "INC-4092" }) });
    expect(local.status).toBe(409); // reached the route: nothing has converged
  });
});

describe("the recorded operator comes from the server, not the request", () => {
  const appended: AuditEntry[] = [];
  const realAppend = auditLedger.append.bind(auditLedger);
  beforeAll(() => {
    auditLedger.append = ((input: Parameters<typeof realAppend>[0]) => {
      const entry = { ...input, id: `sec-${appended.length}`, timestamp: new Date().toISOString(), detail: input.detail ?? "", execution: input.execution ?? "none" } as AuditEntry;
      appended.push(entry);
      return entry;
    }) as typeof auditLedger.append;
  });
  afterAll(() => {
    auditLedger.append = realAppend;
  });
  afterEach(() => {
    convergenceStore.clear("INC-4092", "tenant-contoso-01");
    closureStore.clear("INC-4092");
    appended.length = 0;
  });

  test("closedBy / reopenedBy in the body are ignored; the audit row names the delegated identity", async () => {
    const converged: Convergence = {
      scenarioId: "INC-4092",
      tenantId: "tenant-contoso-01",
      remediationId: "rem-sec-test",
      ticketId: "INC-4092",
      convergedAt: "2026-10-27T11:32:01Z",
      latencyMs: 1,
      prUrl: null,
      gitBranch: "fix/INC-4092-contoso-remediation",
      execution: "simulated",
      remediatedUpns: [],
      reclaimedUpns: [],
    };
    convergenceStore.set(converged);
    const json = { "content-type": "application/json" };
    const closed = await call("/api/tickets/close", { method: "POST", headers: json, body: JSON.stringify({ scenarioId: "INC-4092", closedBy: "mallory@attacker.example" }) });
    expect(closed.status).toBe(200);
    const reopened = await call("/api/tickets/reopen", { method: "POST", headers: json, body: JSON.stringify({ scenarioId: "INC-4092", reopenedBy: "mallory@attacker.example" }) });
    expect(reopened.status).toBe(200);
    expect(appended.map((e) => e.delegatedIdentity)).toEqual([config.lab.delegatedIdentity, config.lab.delegatedIdentity]);
  });
});
