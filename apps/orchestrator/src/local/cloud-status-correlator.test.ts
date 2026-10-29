import { describe, expect, spyOn, test } from "bun:test";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const msgraph = await import("@contextpane/mcp-msgraph");
const configModule = await import("../config.ts");
const { correlateUpstreamCloudStatus } = await import("./cloud-status-correlator.ts");

const TICKET = { ticketText: "Lynne cannot sign in to AVD since 08:00 UTC, AADSTS53003", createdAt: "2026-10-28T08:30:00Z" };

async function withLiveMode<T>(run: () => Promise<T>): Promise<T> {
  const liveSpy = spyOn(configModule, "isLiveCloudMode").mockReturnValue(true);
  // The public feeds are not reached from the tests: every fetch fails fast and those services stay "unknown".
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => Promise.reject(new Error("offline test"))) as never);
  try {
    return await run();
  } finally {
    liveSpy.mockRestore();
    fetchSpy.mockRestore();
  }
}

describe("Entra / Intune upstream status through Graph serviceAnnouncement/healthOverviews (HARD_CASES 31)", () => {
  test("outside live mode both services stay not probed and say why", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => Promise.reject(new Error("offline test"))) as never);
    try {
      const r = await correlateUpstreamCloudStatus(TICKET);
      const entra = r.services.find((s) => s.serviceId === "entra-id")!;
      expect(entra.status).toBe("unknown");
      expect(entra.statusLabel).toBe("Not probed");
      expect(entra.summary).toContain("No public machine-readable feed");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("a 403 from Graph names the missing ServiceHealth.Read.All scope instead of inventing a status", async () => {
    const spy = spyOn(msgraph, "fetchServiceHealthOverviewsLive").mockRejectedValue(new msgraph.GraphHttpError(403, "Insufficient privileges"));
    try {
      const r = await withLiveMode(() => correlateUpstreamCloudStatus(TICKET));
      const intune = r.services.find((s) => s.serviceId === "intune")!;
      expect(intune.status).toBe("unknown");
      expect(intune.summary).toContain("ServiceHealth.Read.All");
      expect(r.services.filter((s) => s.status === "operational")).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test("a live healthOverviews answer maps the Graph statuses and is labelled live-status-api", async () => {
    const spy = spyOn(msgraph, "fetchServiceHealthOverviewsLive").mockResolvedValue([
      { id: "Intune", service: "Microsoft Intune", status: "serviceDegradation" },
      { id: "AzureAD", service: "Microsoft Entra ID", status: "serviceOperational" },
    ]);
    try {
      const r = await withLiveMode(() => correlateUpstreamCloudStatus(TICKET));
      const entra = r.services.find((s) => s.serviceId === "entra-id")!;
      const intune = r.services.find((s) => s.serviceId === "intune")!;
      expect(entra.status).toBe("operational");
      expect(entra.probeSource).toBe("live-status-api");
      expect(entra.statusLabel).toBe("serviceOperational");
      expect(intune.status).toBe("degraded");
      expect(r.overallCorrelationSummary).toContain("Entra ID");
    } finally {
      spy.mockRestore();
    }
  });
});
