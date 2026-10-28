import { afterAll, describe, expect, test } from "bun:test";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { getMcpDataMode, setMcpDataMode } = await import("@contextpane/mcp-azure-iac");
const { config, isLiveCloudMode } = await import("./config.ts");
const { telemetry } = await import("./telemetry.ts");
const { inProcessSources } = await import("./mcp/clients.ts");

const bootMode = getMcpDataMode();
afterAll(() => {
  setMcpDataMode(bootMode);
});

const record = () =>
  telemetry.record({ requestId: "cfg-truth", endpoint: "/test", tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 0, tokensUsed: { prompt: 0, completion: 0, total: 0 }, fallbackChain: [] });

describe("config truth", () => {
  test("LIVE_CLOUD_MODE follows the Real-Tenant / Simulated-Lab toggle at runtime, not the boot value (M-10)", () => {
    expect(config.liveCloudMode).toBe(false);
    setMcpDataMode("real-tenant");
    expect(isLiveCloudMode()).toBe(true);
    expect(record().liveCloudMode).toBe(true);
    expect(telemetry.stats().liveCloudMode).toBe(true);
    setMcpDataMode("simulated-lab");
    expect(isLiveCloudMode()).toBe(false);
    expect(record().liveCloudMode).toBe(false);
    // The boot-time constant never moved.
    expect(config.liveCloudMode).toBe(false);
  });

  test("MCP tool counts come from each server's registry", async () => {
    const status = await inProcessSources.status();
    const counts = Object.fromEntries(status.servers.map((s) => [s.name, s.tools]));
    expect(counts["contextpane-erp"]).toBeGreaterThan(0);
    expect(counts["contextpane-msgraph"]).toBeGreaterThan(0);
    // Was hard-coded as 11 while the server registers 12.
    expect(counts["contextpane-azure-iac"]).toBe(12);
    expect(status.servers.every((s) => s.ok)).toBe(true);
  });
});
