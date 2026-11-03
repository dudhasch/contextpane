import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

// Offline: no tenant, no pwsh. Live mode is switched on per test through the data mode, never through .env.local.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
process.env.CTX_SKIP_PWSH = "true";

const { ActionApprovalDrawerSchema } = await import("@contextpane/catalog");
const { setMcpDataMode } = await import("@contextpane/mcp-msgraph");
const azure = await import("@contextpane/mcp-azure-iac");
const { config } = await import("./config.ts");
const { app } = await import("./app.ts");
const contextModule = await import("./mcp/context.ts");
const formalModule = await import("./local/formal-verifier.ts");
const { applyScenarioState, combineWrites } = await import("./local/lab.ts");
const { remediationStore } = await import("./store/remediations.ts");
const { auditLedger } = await import("./store/audit.ts");
const { convergenceStore } = await import("./store/convergence.ts");
const { closureStore } = await import("./store/closure.ts");
const { ApproveRefusedError, approve, remediate } = await import("./tiers/tier3-remediate.ts");
const { clearCustomTickets, registerCustomTicket, SAMPLE_UNSCRIPTED_TICKETS } = await import("./local/custom-ticket.ts");

const mutable = config as { allowExecute: boolean };

function liveMode(on: boolean, allowExecute: boolean) {
  setMcpDataMode(on ? "real-tenant" : "simulated-lab");
  azure.setMcpDataMode(on ? "real-tenant" : "simulated-lab");
  mutable.allowExecute = allowExecute;
  if (allowExecute) process.env.CTX_ALLOW_EXECUTE = "true";
  else delete process.env.CTX_ALLOW_EXECUTE;
}

function drawerFor(ticketId: string, verdict: "Verified Safe" | "Verification Failed" = "Verified Safe") {
  const drawer = ActionApprovalDrawerSchema.parse({
    remediationId: `rem-test-live-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    ticketId,
    tenantId: "tenant-contoso-01",
    title: "Live-write gate under test",
    summary: "Bundle under test",
    synthesizedBy: { planner: "deterministic", coder: "deterministic", provider: "local" },
    powershellScript: "[CmdletBinding(SupportsShouldProcess)]\nparam()\n",
    terraformDiff: "",
    graphPatch: "{}",
    affectedEntities: [],
    verificationStatus: { verdict, astCheckPassed: verdict === "Verified Safe", terraformFmtPassed: null, terraformValidatePassed: null, sandboxProvider: "local-pwsh", validationLatencyMs: 5, whatIfSafe: true, findings: [] },
    staging: null,
    approval: { state: "pending", requiredIdentity: "admin@test", approvedBy: null, approvedAt: null },
    providerTelemetry: { tier: "Tier 3B", provider: "local", modelId: "deterministic", latencyMs: 1, tokensUsed: 0 },
  });
  remediationStore.save(drawer);
  return drawer;
}

describe("live writes: one gate, honest outcomes", () => {
  const previousAllow = mutable.allowExecute;
  let auditSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    auditSpy = spyOn(auditLedger, "append").mockImplementation(((input: unknown) => input) as never);
  });
  afterEach(() => {
    auditSpy.mockRestore();
    liveMode(false, previousAllow);
    clearCustomTickets();
    // Leave no converged or closed ticket behind for other suites.
    for (const id of ["INC-4092", "INC-4099"] as const) {
      convergenceStore.clear(id, id === "INC-4092" ? "tenant-contoso-01" : "tenant-fabrikam-02");
      closureStore.clear(id);
    }
  });

  test("combineWrites: one live write landing never makes a simulated sibling count as done", () => {
    const out = combineWrites([
      { label: "licences", live: true, rows: [{ id: "u1", ok: true, status: 204 }] },
      { label: "ca", live: false, fallbackReason: "token expired", rows: [{ id: "ca-1", ok: true, status: 0 }] },
    ]);
    expect(out.source).toBe("live-graph");
    expect(out.results.find((r) => r.id === "ca")?.ok).toBe(false);
    expect(out.results.find((r) => r.id === "ca")?.error).toContain("token expired");
    const sim = combineWrites([{ label: "ca", live: false, fallbackReason: "LIVE_CLOUD_MODE=false", rows: [{ id: "ca-1", ok: true, status: 0 }] }]);
    expect(sim.source).toBe("simulated");
    expect(sim.results.every((r) => r.ok)).toBe(true);
  });

  test("INC-4092 in live mode with failing writes: no row reads as a success, so approve cannot report executed", async () => {
    liveMode(true, true);
    const write = await applyScenarioState("INC-4092", "remediated");
    expect(write.source).toBe("live-graph");
    expect(write.results.length).toBeGreaterThan(0);
    expect(write.results.some((r) => !r.ok)).toBe(true);
    expect(write.results.filter((r) => r.id.startsWith("ca")).every((r) => !r.ok)).toBe(true);
  });

  test("gate closed (live mode, CTX_ALLOW_EXECUTE=false): every lab write is simulated and says why", async () => {
    liveMode(true, false);
    const write = await applyScenarioState("INC-4092", "remediated");
    expect(write.source).toBe("simulated");
    expect(write.fallbackReason).toContain("CTX_ALLOW_EXECUTE=false");
  });

  test("POST /api/lab/reset-drift writes nothing live while the gate is closed", async () => {
    liveMode(true, false);
    const res = await app.request("/api/lab/reset-drift", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "INC-4092" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ source: string; fallbackReason?: string }> };
    expect(body.results[0]!.source).toBe("simulated");
    expect(body.results[0]!.fallbackReason).toContain("CTX_ALLOW_EXECUTE=false");
  });

  test("a live break-glass approval is refused when the pre-change snapshot cannot be captured", async () => {
    liveMode(true, true);
    const gatherSpy = spyOn(contextModule, "gatherContext").mockRejectedValue(new Error("Graph unreachable"));
    try {
      const drawer = drawerFor("INC-4092");
      const attempt = approve({ remediationId: drawer.remediationId, decision: "approve", mode: "break-glass" });
      await expect(attempt).rejects.toBeInstanceOf(ApproveRefusedError);
      await expect(approve({ remediationId: drawer.remediationId, decision: "approve", mode: "break-glass" })).rejects.toThrow(/Graph unreachable/);
      expect(remediationStore.get(drawer.remediationId)?.approval.state).toBe("pending");
    } finally {
      gatherSpy.mockRestore();
    }
  });

  test("simulated mode is unaffected: break-glass approves without a live snapshot", async () => {
    liveMode(false, false);
    const drawer = drawerFor("INC-4092");
    const result = await approve({ remediationId: drawer.remediationId, decision: "approve", mode: "break-glass" });
    expect(result.approval.state).toBe("simulated");
  });

  test("a custom ticket whose context fails is not remediated as its base demo scenario", async () => {
    const entry = registerCustomTicket(SAMPLE_UNSCRIPTED_TICKETS[0]!);
    const gatherSpy = spyOn(contextModule, "gatherContext").mockRejectedValue(new Error("MCP sources down"));
    try {
      const { drawer } = await remediate({ scenarioId: entry.scenarioId, fresh: true });
      expect(drawer.ticketId).toBe(entry.scenarioId);
      expect(drawer.verificationStatus.verdict).toBe("Verification Failed");
      expect(drawer.title).toContain("context unavailable");
      expect(drawer.powershellScript.startsWith("# No remediation generated")).toBe(true);
      expect(drawer.affectedEntities).toEqual([]);
      expect(drawer.verificationStatus.findings.join(" ")).toContain("MCP sources down");
    } finally {
      gatherSpy.mockRestore();
    }
  });

  test("the server refuses an approval whose formal invariants fail (409) unless an Override is recorded", async () => {
    const formalSpy = spyOn(formalModule, "verifyFormalInvariants").mockReturnValue({
      ...formalModule.verifyFormalInvariants("INC-4092"),
      passed: false,
      invariants: [{ id: "break-glass-non-lockout", statement: "Break-glass accounts keep access", passed: false, counterexamples: [] }],
    } as never);
    try {
      // INC-4099: a scenario no earlier case in this file approved, so no resolved-ticket conflict answers first.
      const drawer = drawerFor("INC-4099");
      const res = await app.request("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ remediationId: drawer.remediationId, decision: "approve" }) });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; failedInvariants: string[] };
      expect(body.failedInvariants).toEqual(["Break-glass accounts keep access"]);
      expect(remediationStore.get(drawer.remediationId)?.approval.state).toBe("pending");
    } finally {
      formalSpy.mockRestore();
    }
  });

  test("a Free-Roam action with a failed pre-flight is refused server-side (409)", async () => {
    const drawer = drawerFor("FREE-TEST01", "Verification Failed");
    const res = await app.request("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ remediationId: drawer.remediationId, decision: "approve" }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Free-Roam");
  });
});
