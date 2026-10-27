import { describe, expect, test } from "bun:test";
import { ContextualMiniDashboardSchema, selectionDataPtr, selectionHash } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("./brief.ts");
const { buildSelectionSlice, sliceToCard } = await import("./selection.ts");
const { resolveDataPtr, resolveSelectionPtr } = await import("./dataplane.ts");
const { PLACEHOLDER_RE, exploreSelection } = await import("../tiers/explore.ts");

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

  test('"SG-Contoso-Finance-AVD" on INC-4092 leads with the enforced policy that blocks it, never a report-only one', async () => {
    // Mirror the lab tenant: beside the enforced legacy block it holds CA-001 and a report-only CA-004 that names the group.
    const ctx = await gatherContext("INC-4092");
    const base = ctx.policies!.data[0]!;
    const extra = [
      { ...base, id: "ca-001-test", displayName: "[ContextPane-Demo] CA-001-Require-PhishingResistant-MFA-Admins", includeGroupNames: ["SG-Contoso-Admins"], includeGroupIds: ["g-admins"], grant: { operator: "OR", builtInControls: ["mfa"] }, blocks: false },
      { ...base, id: "ca-004-test", displayName: "[ContextPane-Demo] CA-004-Block-Legacy-Auth", state: "enabledForReportingButNotEnforced", includeGroupNames: ["SG-Contoso-Finance-AVD"], includeGroupIds: ["g-avd"], blocks: true },
    ];
    const live = { ...ctx, policies: { ...ctx.policies!, data: [...ctx.policies!.data, ...extra] } };
    const s = buildSelectionSlice(live, "SG-Contoso-Finance-AVD", buildScenarioBrief(live).steps);
    expect(s.kind).toBe("entra-ca-policies");
    expect(s.rows.find((r) => r.id === "ca-004-test")?.role).toBe("report-only");
    expect(s.rows.some((r) => r.state === "enabledForReportingButNotEnforced" && r.role === "blocking")).toBe(false);
    const lead = s.rows[0]!;
    expect(lead.role).toBe("blocking");
    expect(lead.state).toBe("enabled");
    expect(Number(lead.blockedSignIns)).toBeGreaterThan(0);
    expect(s.suggestedAction.scriptPreview).toContain(`'${lead.id}'`);
    expect(s.suggestedAction.scriptPreview).toContain("enabledForReportingButNotEnforced");
    expect(s.suggestedAction.scriptPreview).not.toContain("state = 'enabled'");
    expect(ContextualMiniDashboardSchema.safeParse(sliceToCard(live, "SG-Contoso-Finance-AVD", s)).success).toBe(true);
  });

  test('"Mail.ReadWrite" on ANOM-APP-401 revokes that assignment and the delegated grant by their real ids', async () => {
    const { slice: s } = await slice("ANOM-APP-401", "Mail.ReadWrite");
    expect(s.kind).toBe("workload-identity");
    expect(s.suggestedAction.label).toBe("Revoke Mail.ReadWrite");
    const script = s.suggestedAction.scriptPreview;
    expect(script).toContain("Remove-MgServicePrincipalAppRoleAssignment -ServicePrincipalId '8d2e3f4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a' -AppRoleAssignmentId 'ara-spn-contoso-erp-sync-mail-readwrite'");
    expect(script).toContain("Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId 'grant-spn-contoso-erp-sync-001'");
    expect(PLACEHOLDER_RE.test(script)).toBe(false);
  });

  test("no suggested action of any slice carries a <placeholder>", async () => {
    const probes: Array<[string, string]> = [
      ["INC-4092", "SG-Contoso-Finance-AVD"], ["INC-4092", "SPE_E3"], ["INC-4092", "port 3389"], ["INC-4092", "AADSTS53003"], ["INC-4092", "zzz-quantum-flux-capacitor"],
      ["INC-4099", "BitLocker"], ["INC-4099", "uncompliant device"], ["ANOM-INT-309", "firewall"], ["ANOM-LIC-101", "disabled accounts"],
      ["ANOM-CA-204", "CA-004"], ["ANOM-CA-204", "SG-BreakGlass-Accounts"], ["ANOM-APP-401", "Mail.ReadWrite"], ["ANOM-APP-401", "Sites.FullControl.All"], ["ANOM-APP-401", "alex.wilber"],
    ];
    for (const [id, text] of probes) {
      const { slice: s } = await slice(id, text);
      expect({ id, text, script: s.suggestedAction.scriptPreview, placeholder: PLACEHOLDER_RE.test(s.suggestedAction.scriptPreview) }).toMatchObject({ placeholder: false });
    }
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
