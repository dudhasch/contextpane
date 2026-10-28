import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SCENARIO_IDS } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";

const { app } = await import("../app.ts");
const { config } = await import("../config.ts");
const { sources } = await import("../mcp/clients.ts");
const { setPersistedDataMode } = await import("./free-roam.ts");

describe("Free-Roam Landing Page & MCP Data Mode ('real-tenant' vs 'simulated-lab')", () => {
  const prevForceLocal = config.forceLocal;
  beforeEach(() => {
    (config as { forceLocal: boolean }).forceLocal = true;
    process.env.CTX_SKIP_PWSH = "true";
  });
  afterEach(() => {
    (config as { forceLocal: boolean }).forceLocal = prevForceLocal;
    delete process.env.CTX_SKIP_PWSH;
    setPersistedDataMode("simulated-lab");
  });

  test("POST /api/settings/data-mode switches MCP servers between real-tenant and simulated-lab and filters seeded scenarios", async () => {
    // Switch to real-tenant mode
    const resReal = await app.request("/api/settings/data-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataMode: "real-tenant" }),
    });
    expect(resReal.status).toBe(200);
    const bodyReal = (await resReal.json()) as {
      ok: boolean;
      dataMode: string;
      scenarios: Array<{ scenarioId: string }>;
    };
    expect(bodyReal.ok).toBe(true);
    expect(bodyReal.dataMode).toBe("real-tenant");
    expect(sources.getDataMode()).toBe("real-tenant");

    // Seeded demo scenarios (INC-4092, INC-4099, ANOM-*) must be filtered out in real-tenant mode
    for (const seededId of SCENARIO_IDS) {
      expect(bodyReal.scenarios.some((s) => s.scenarioId === seededId)).toBe(false);
    }

    // Switch back to simulated-lab mode
    const resSim = await app.request("/api/settings/data-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataMode: "simulated-lab" }),
    });
    expect(resSim.status).toBe(200);
    const bodySim = (await resSim.json()) as {
      ok: boolean;
      dataMode: string;
      scenarios: Array<{ scenarioId: string }>;
    };
    expect(bodySim.dataMode).toBe("simulated-lab");
    expect(sources.getDataMode()).toBe("simulated-lab");
    for (const seededId of SCENARIO_IDS) {
      expect(bodySim.scenarios.some((s) => s.scenarioId === seededId)).toBe(true);
    }
  });

  test("GET /api/free-roam/inventory returns MCP entity categories and summary counts", async () => {
    setPersistedDataMode("simulated-lab");
    const res = await app.request("/api/free-roam/inventory");
    expect(res.status).toBe(200);
    const inv = (await res.json()) as {
      dataMode: string;
      summary: { users: number; caPolicies: number; skuPools: number };
      categories: Array<{ id: string; count: number; items: unknown[] }>;
    };
    expect(inv.dataMode).toBe("simulated-lab");
    expect(inv.summary.users).toBeGreaterThan(0);
    expect(inv.summary.caPolicies).toBeGreaterThan(0);
    expect(inv.categories.some((c) => c.id === "azure-vms")).toBe(true);
    expect(inv.categories.some((c) => c.id === "users")).toBe(true);
    expect(inv.categories.some((c) => c.id === "ca-policies")).toBe(true);
    expect(inv.categories.some((c) => c.id === "azure-resources")).toBe(true);
  });

  test("POST /api/free-roam/spawn dynamically composes a ContextualMiniDashboard for both tenant queries and general cloud knowledge", async () => {
    setPersistedDataMode("simulated-lab");

    // 0. VM query ("what vms do we have ?") matches azure-vms dataset without mentioning INC-4092
    const resVms = await app.request("/api/free-roam/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "what vms do we have ?",
        scope: "hybrid",
      }),
    });
    expect(resVms.status).toBe(200);
    const bodyVms = (await resVms.json()) as {
      slice: { kind: string; matchedBy: string };
      card: { title: string; subtitle: string; rows: Array<Record<string, unknown>> };
    };
    expect(bodyVms.slice.kind).toBe("azure-vms");
    expect(bodyVms.card.title).toContain("Azure Virtual Machines");
    expect(bodyVms.card.subtitle).not.toContain("INC-4092");

    // 1. Knowledge query
    const resKnowledge = await app.request("/api/free-roam/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Compare Azure Private Link vs VNet Service Endpoints",
        scope: "knowledge",
        viewMode: "comparison",
      }),
    });
    expect(resKnowledge.status).toBe(200);
    const bodyKnowledge = (await resKnowledge.json()) as {
      card: { title: string; rows: unknown[]; kpis: unknown[]; viewMode: string };
    };
    expect(bodyKnowledge.card.rows.length).toBeGreaterThanOrEqual(3);
    expect(bodyKnowledge.card.kpis.length).toBeGreaterThanOrEqual(2);
    expect(bodyKnowledge.card.viewMode).toBe("comparison");

    // 2. Strict real-tenant + tenant-only query with no matching object does not invent simulated users
    setPersistedDataMode("real-tenant");
    const resStrict = await app.request("/api/free-roam/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "nonexistent-object-xyz-99999",
        scope: "tenant-only",
        viewMode: "dashboard",
      }),
    });
    expect(resStrict.status).toBe(200);
    const bodyStrict = (await resStrict.json()) as {
      card: { subtitle: string; rows: Array<Record<string, unknown>> };
    };
    expect(bodyStrict.card.subtitle).toContain("Real-Tenant");
  });

  test("POST /api/free-roam/remediate stages a PowerShell 7 / IaC remediation bundle with Pre-Flight AST verification", async () => {
    const res = await app.request("/api/free-roam/remediate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Audit Conditional Access policies and enforce break-glass exclusion group",
        title: "Free-Roam CA Posture Remediation",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      drawer: {
        remediationId: string;
        powershellScript: string;
        verificationStatus: { astCheckPassed: boolean; verdict: string };
      };
    };
    expect(body.drawer.remediationId).toStartWith("rem-freeroam-");
    expect(body.drawer.powershellScript).toContain("SupportsShouldProcess");
    expect(body.drawer.verificationStatus.astCheckPassed).toBe(true);
  });

  test("POST /api/free-roam/remediate streams progress like /api/remediate when SSE is requested", async () => {
    const res = await app.request("/api/free-roam/remediate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        prompt: "Audit Conditional Access policies and enforce break-glass exclusion group",
        title: "Free-Roam CA Posture Remediation",
      }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const parsed = (await res.text())
      .split("\n\n")
      .filter((b) => b.trim())
      .map((b) => ({
        event: /^event: ?(.*)$/m.exec(b)?.[1]?.trim(),
        data: JSON.parse(
          b
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n"),
        ) as Record<string, any>,
      }));
    const stages = parsed.filter((p) => p.event === "progress").map((p) => p.data.stage as string);
    expect(stages[0]).toBe("code:start");
    expect(stages).toContain("bundle:ready");
    expect(stages.at(-1)).toBe("preflight:done");
    const bundle = parsed.find((p) => p.data.stage === "bundle:ready")!;
    expect(bundle.data.data.powershellScript).toContain("SupportsShouldProcess");
    const result = parsed.at(-1)!;
    expect(result.event).toBe("result");
    expect(result.data.drawer.remediationId).toStartWith("rem-freeroam-");
    expect(result.data.drawer.powershellScript).toBe(bundle.data.data.powershellScript);
  });

  test("POST /api/anomalies/scan inspects MCP datasets and registers live anomalies", async () => {
    setPersistedDataMode("simulated-lab");
    const res = await app.request("/api/anomalies/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      detectedCount: number;
      findings: Array<{ id: string; category: string }>;
    };
    expect(body.detectedCount).toBeGreaterThan(0);
    expect(body.findings.length).toBeGreaterThan(0);
  });
});
