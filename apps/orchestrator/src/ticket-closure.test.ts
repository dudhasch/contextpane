import { afterEach, describe, expect, test } from "bun:test";
import type { ActionApprovalDrawer, AuditEntry, Convergence } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { app } = await import("./app.ts");
const { auditLedger } = await import("./store/audit.ts");
const { closureStore } = await import("./store/closure.ts");
const { convergenceStore } = await import("./store/convergence.ts");
const { remediationStore } = await import("./store/remediations.ts");

const SCENARIO = "INC-4092";
const TENANT = "tenant-contoso-01";
const converged: Convergence = {
  scenarioId: SCENARIO,
  tenantId: TENANT,
  remediationId: "rem-closure-test",
  ticketId: SCENARIO,
  convergedAt: "2026-10-27T11:32:01Z",
  latencyMs: 12,
  prUrl: null,
  gitBranch: "fix/INC-4092-contoso-remediation",
  execution: "simulated",
  remediatedUpns: [],
  reclaimedUpns: [],
};

// Nothing in this file may write data/: capture ledger rows, serve one pending drawer from memory.
const appended: AuditEntry[] = [];
const realAppend = auditLedger.append.bind(auditLedger);
auditLedger.append = ((input: Parameters<typeof realAppend>[0]) => {
  const entry = { ...input, id: `test-${appended.length}`, timestamp: new Date().toISOString(), detail: input.detail ?? "", execution: input.execution ?? "none" } as AuditEntry;
  appended.push(entry);
  return entry;
}) as typeof auditLedger.append;
const realGet = remediationStore.get.bind(remediationStore);
remediationStore.get = ((id: string) => (id === converged.remediationId ? ({ remediationId: id, ticketId: SCENARIO, tenantId: TENANT } as ActionApprovalDrawer) : realGet(id))) as typeof remediationStore.get;

const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => {
  convergenceStore.clear(SCENARIO, TENANT);
  closureStore.clear(SCENARIO);
  appended.length = 0;
});

describe("a resolved ticket is not remediated twice", () => {
  test("POST /api/remediate answers 409 once the ticket converged, and names closure once it is closed", async () => {
    convergenceStore.set(converged);
    const verified = await post("/api/remediate", { scenarioId: SCENARIO });
    expect(verified.status).toBe(409);
    expect(((await verified.json()) as { error: string }).error).toContain("already resolved");
    closureStore.close(SCENARIO, "cloudadmin@c4a8shili.onmicrosoft.com");
    const closed = await post("/api/remediate", { scenarioId: SCENARIO });
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { error: string }).error).toBe("Ticket is already resolved and closed. Reopen or reset drift before running remediation again.");
  });

  test("a duplicate break-glass approval of a closed ticket is refused with 409 before anything runs", async () => {
    convergenceStore.set(converged);
    closureStore.close(SCENARIO, "cloudadmin@c4a8shili.onmicrosoft.com");
    const res = await post("/api/remediate/approve", { remediationId: converged.remediationId, mode: "break-glass" });
    expect(res.status).toBe(409);
    expect(appended.some((e) => e.actionType === "hitl-approval")).toBe(false);
    expect(convergenceStore.get(SCENARIO)?.remediationId).toBe(converged.remediationId);
  });

  test("POST /api/tickets/reopen clears closure and convergence, logs ticket-reopened, and unblocks the guard", async () => {
    convergenceStore.set(converged);
    closureStore.close(SCENARIO, "cloudadmin@c4a8shili.onmicrosoft.com");
    const res = await post("/api/tickets/reopen", { scenarioId: SCENARIO });
    expect(res.status).toBe(200);
    expect(closureStore.closedState(SCENARIO)).toBeNull();
    expect(convergenceStore.get(SCENARIO)).toBeNull();
    expect(appended.map((e) => e.actionType)).toEqual(["ticket-reopened"]);
    // Nothing left to reopen.
    expect((await post("/api/tickets/reopen", { scenarioId: SCENARIO })).status).toBe(409);
  });
});

describe("POST /api/rollback (L-09)", () => {
  test("stages the revert script and never claims it executed", async () => {
    const res = await post("/api/rollback", { scenarioId: SCENARIO });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { executed: unknown; reason?: string; executionLog: string[] };
    expect(body.executed).toBe(false);
    expect(body.reason).toContain("not executed");
    expect(body.executionLog.join(" ")).not.toMatch(/restored/i);
  });
});
