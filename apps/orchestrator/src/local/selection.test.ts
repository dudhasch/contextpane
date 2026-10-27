import { describe, expect, test } from "bun:test";
import { ContextualMiniDashboardSchema, selectionDataPtr, selectionHash } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("./brief.ts");
const { buildSelectionSlice, sliceToCard } = await import("./selection.ts");
const { resolveDataPtr, resolveSelectionPtr } = await import("./dataplane.ts");
const { exploreSelection } = await import("../tiers/explore.ts");

async function slice(scenarioId: string, text: string) {
  const ctx = await gatherContext(scenarioId);
  const brief = buildScenarioBrief(ctx);
  return { ctx, slice: buildSelectionSlice(ctx, text, brief.steps) };
}

describe("highlight → selection slice", () => {
  test('"uncompliant device" on INC-4099 is the non-compliant Intune device cohort', async () => {
    const { ctx, slice: s } = await slice("INC-4099", "uncompliant device");
    expect(s.kind).toBe("intune-devices");
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.rows.every((r) => r.complianceState !== "Compliant")).toBe(true);
    expect(s.kpis.length).toBeGreaterThanOrEqual(2);
    expect(s.kpis.length).toBeLessThanOrEqual(4);
    expect(s.sourceQuery).toContain("deviceManagement/managedDevices");
    const card = sliceToCard(ctx, "uncompliant device", s);
    expect(ContextualMiniDashboardSchema.safeParse(card).success).toBe(true);
    expect(card.provenanceCategory).toBe("selection");
    expect(card.rowsPtr).toBe(selectionDataPtr("INC-4099", selectionHash("INC-4099", "uncompliant device")));
  });

  test('"port 3389" on INC-4092 finds the rogue RDP rule on the NSG', async () => {
    const { slice: s } = await slice("INC-4092", "port 3389");
    expect(s.kind).toBe("azure-nsg-rules");
    expect(s.rows.some((r) => String(r.port) === "3389")).toBe(true);
    expect(s.suggestedAction.scriptPreview).toContain("Remove-AzNetworkSecurityRuleConfig");
    expect(s.sourceQuery).toContain("networkSecurityGroups");
  });

  test('"disabled accounts" on ANOM-LIC-101 lists the orphaned seat holders', async () => {
    const { slice: s } = await slice("ANOM-LIC-101", "disabled accounts");
    expect(s.kind).toBe("entra-users");
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.rows.every((r) => r.accountEnabled === false)).toBe(true);
    expect(s.suggestedAction.label).toMatch(/Reclaim/);
  });

  test("an error code, a SKU, a UPN and an expired secret each resolve to the right dataset", async () => {
    expect((await slice("INC-4092", "AADSTS53003")).slice.kind).toBe("entra-signins");
    const e3 = (await slice("INC-4092", "SPE_E3")).slice;
    expect(e3.kind).toBe("entra-users");
    expect(e3.rows.every((r) => String(r.currentSku).includes("SPE_E3"))).toBe(true);
    const lynne = (await slice("INC-4092", "lynne.robins.contoso@c4a8shili.onmicrosoft.com")).slice;
    expect(lynne.rows.length).toBeGreaterThan(0);
    expect(lynne.rows.every((r) => String(r.upn).startsWith("lynne.robins"))).toBe(true);
    const secret = (await slice("ANOM-APP-401", "expired client secret")).slice;
    expect(secret.kind).toBe("workload-identity");
    expect(secret.rows.some((r) => r.expired === true)).toBe(true);
    expect((await slice("ANOM-CA-204", "SG-BreakGlass-Accounts")).slice.kind).toBe("entra-ca-policies");
  });

  test("a phrase nothing matches yields a valid zero-row card", async () => {
    const { ctx, slice: s } = await slice("INC-4092", "zzz-quantum-flux-capacitor");
    expect(s.matchedBy).toBe("none");
    expect(s.rows.length).toBeLessThanOrEqual(5);
    expect(ContextualMiniDashboardSchema.safeParse(sliceToCard(ctx, "zzz-quantum-flux-capacitor", s)).success).toBe(true);
  });
});

describe("POST /api/explore-selection pointer hydration and PII vaulting", () => {
  test("publishes the rows under ptr://<scenario>/selection/<hash>, vaults PII for the prompt, binds raw rows to the card", async () => {
    const result = await exploreSelection({ scenarioId: "INC-4092", selectedText: "SPE_E3" });
    expect(result.card.rowsPtr).toBe(result.dataPtr);
    expect(result.dataPtr).toMatch(/^ptr:\/\/inc-4092\/selection\/[a-z0-9]+$/);
    expect(result.tier).toBe("Tier 1B");
    expect(result.modelId).toBe("deterministic");
    expect(result.tokenCount).toBe(0);
    expect(result.card.rows.length).toBe(result.slice.rowCount);
    // Data plane: the pointer resolves to the same rows, the LLM-safe view carries tokens instead of UPNs.
    const hit = resolveDataPtr(result.dataPtr);
    expect(hit.found).toBe(true);
    expect(hit.value).toEqual(result.card.rows);
    expect(hit.descriptor?.piiFields).toEqual(expect.arrayContaining(["upn", "displayName"]));
    const safe = JSON.stringify(hit.llmSafeValue);
    for (const r of result.card.rows) {
      expect(safe).not.toContain(String(r.upn));
      expect(safe).not.toContain(String(r.displayName));
    }
    expect(safe).toContain("upn_tok_01");
    expect(hit.piiMetrics.zeroRawPiiInLlmPrompt).toBe(true);
    expect(resolveSelectionPtr(result.dataPtr)?.selectedText).toBe("SPE_E3");
    expect(result.descriptor.aggregates).not.toHaveProperty("upn");
    expect(result.telemetry.endpoint).toBe("/api/explore-selection");
  });

  test("a custom ticket's selection publishes under ptr://custom-<hash>/selection/...", async () => {
    const { registerCustomTicket, SAMPLE_UNSCRIPTED_TICKETS } = await import("./custom-ticket.ts");
    const entry = registerCustomTicket(SAMPLE_UNSCRIPTED_TICKETS[0]!);
    const result = await exploreSelection({ scenarioId: entry.scenarioId, selectedText: "port 3389", customTicketText: entry.ticket.body });
    expect(result.dataPtr.startsWith(`ptr://${entry.scenarioId.toLowerCase()}/selection/`)).toBe(true);
    expect(result.slice.kind).toBe("azure-nsg-rules");
  });
});
