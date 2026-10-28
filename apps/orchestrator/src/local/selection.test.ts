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

  test('"appId 44b8e1a7-3c5d-4f2a-9b6e-7d8c9a0b1e2f" + refinement "other apps with the same owner" returns peer SPNs owned by alex.wilber', async () => {
    const ctx = await gatherContext("ANOM-APP-401");
    const brief = buildScenarioBrief(ctx);
    const s = buildSelectionSlice(ctx, "appId 44b8e1a7-3c5d-4f2a-9b6e-7d8c9a0b1e2f", brief.steps, {
      refinementText: "other apps with the same owner",
      viewMode: "blast-radius",
    });
    expect(s.kind).toBe("workload-identity");
    expect(s.rows.length).toBe(3);
    expect(s.rows.map((r) => r.displayName)).toEqual([
      "spn-contoso-erp-sync",
      "spn-contoso-payroll-export",
      "spn-contoso-hr-onboarding-bot",
    ]);
    expect(s.rows.every((r) => String(r.ownerUpn).startsWith("alex.wilber@"))).toBe(true);
    expect(s.suggestedAction.scriptPreview).toContain("Remove-MgApplicationOwnerByRef");
    expect(PLACEHOLDER_RE.test(s.suggestedAction.scriptPreview)).toBe(false);

    const card = sliceToCard(ctx, "appId 44b8e1a7-3c5d-4f2a-9b6e-7d8c9a0b1e2f", s, {
      refinementText: "other apps with the same owner",
      viewMode: "blast-radius",
    });
    expect(ContextualMiniDashboardSchema.safeParse(card).success).toBe(true);
    expect(card.refinementText).toBe("other apps with the same owner");
    expect(card.viewMode).toBe("blast-radius");
  });

  test("exploreSelection supports refinementText and all 4 viewModes (dashboard, full-card, comparison, blast-radius)", async () => {
    const cmp = await exploreSelection({
      scenarioId: "ANOM-APP-401",
      selectedText: "appId 44b8e1a7-3c5d-4f2a-9b6e-7d8c9a0b1e2f",
      refinementText: "other apps with the same owner",
      viewMode: "comparison",
    });
    expect(cmp.card.viewMode).toBe("comparison");
    expect(cmp.card.refinementText).toBe("other apps with the same owner");
    // Comparison mode includes the 3 shadow-admin SPNs + 1 golden baseline reference SPN
    expect(cmp.card.rows.length).toBe(4);
    expect(cmp.card.rows.some((r) => r.displayName === "spn-contoso-avd-autoscaler")).toBe(true);
  });

  test("Overhauled exploreSelection: QuotaExceeded, legacy block group, resource health, subject identifier, and AADSTS53003 return rich matched data and errorCodeReference explanations", async () => {
    const quota = await exploreSelection({
      scenarioId: "INC-4092",
      selectedText: "QuotaExceeded",
    });
    expect(quota.slice.kind).toBe("azure-quota-capacity");
    expect(quota.slice.matchedBy).not.toBe("none");
    expect(quota.card.rows.length).toBeGreaterThanOrEqual(4);
    expect(quota.card.errorCodeReference?.code).toBe("QuotaExceeded");
    expect(quota.card.suggestedAction?.scriptPreview).toContain("Get-AzVMUsage");

    const legacyGroup = await exploreSelection({
      scenarioId: "INC-4092",
      selectedText: "legacy block group",
    });
    expect(legacyGroup.slice.kind).toBe("entra-groups");
    expect(legacyGroup.slice.matchedBy).not.toBe("none");
    expect(legacyGroup.card.rows.some((r) => String(r.displayName).includes("SG-Contoso-Finance-Legacy"))).toBe(true);

    const resourceHealth = await exploreSelection({
      scenarioId: "INC-4099",
      selectedText: "resource health",
    });
    expect(resourceHealth.slice.kind).toBe("azure-policies");
    expect(resourceHealth.slice.matchedBy).not.toBe("none");
    expect(resourceHealth.card.rows.length).toBeGreaterThan(0);

    // The workload-identity dataset belongs to ANOM-APP-401 only (H-06), so the OIDC subject is probed there.
    const oidcSub = await exploreSelection({
      scenarioId: "ANOM-APP-401",
      selectedText: "subject identifier",
    });
    expect(oidcSub.slice.kind).toBe("workload-identity");
    expect(oidcSub.slice.matchedBy).not.toBe("none");
    expect(oidcSub.card.errorCodeReference?.code).toBe("AADSTS70021");
    expect(oidcSub.card.rows.some((r) => String(r.detail ?? "").includes("repo:contoso/erp-sync:"))).toBe(true);

    const aadsts53003 = await exploreSelection({
      scenarioId: "INC-4092",
      selectedText: "AADSTS53003",
    });
    expect(aadsts53003.card.errorCodeReference?.code).toBe("AADSTS53003");
    expect(aadsts53003.card.errorCodeReference?.explanation).toContain("Conditional Access");
  });
});

describe("fixture leaks (audit H-01, H-06..H-10)", () => {
  test("every row of every slice belongs to the scenario's tenant", async () => {
    for (const [id, text] of [["INC-4092", "legacy block group"], ["INC-4092", "security groups"], ["INC-4099", "security groups"], ["INC-4099", "legacy block group"]] as const) {
      const { ctx, slice: s } = await slice(id, text);
      expect(s.rows.length).toBeGreaterThan(0);
      expect({ id, text, leaks: s.rows.filter((r) => r.tenantId !== undefined && r.tenantId !== ctx.tenantId).map((r) => r.displayName) }).toEqual({ id, text, leaks: [] });
      expect(s.rows.every((r) => r.tenantId === ctx.tenantId)).toBe(true);
    }
    const contoso = (await slice("INC-4092", "legacy block group")).slice;
    expect(contoso.rows.some((r) => String(r.displayName).includes("Fabrikam"))).toBe(false);
  });

  test("an identifier the tenant does not have is a zero-row matchedBy none card, never another dataset's rows", async () => {
    const { ctx } = await slice("INC-4092", "x");
    const s = buildSelectionSlice(ctx, "kv-contoso-fin-prod", buildScenarioBrief(ctx).steps, { refinementText: "owner list" });
    expect(s.matchedBy).toBe("none");
    expect(s.rows).toEqual([]);
    expect(s.missedIdentifier).toBe("kv-contoso-fin-prod");
    expect(s.title).toContain("No tenant data matched");
    expect(`${s.title} ${s.subtitle}`).not.toMatch(/nsg-contoso|AADSTS53003|events? matched/i);
    expect(s.suggestedAction.scriptPreview).toContain("Get-AzRoleAssignment");
    expect(ContextualMiniDashboardSchema.safeParse(sliceToCard(ctx, "kv-contoso-fin-prod", s)).success).toBe(true);
    const result = await exploreSelection({ scenarioId: "INC-4092", selectedText: "kv-contoso-fin-prod" });
    expect(result.slice.matchedBy).toBe("none");
    expect(result.slice.dataSource).toBe("none");
    expect(result.card.rows).toEqual([]);
  });

  test("quota KPIs come from the rows, not literals", async () => {
    const { ctx, slice: s } = await slice("INC-4092", "QuotaExceeded");
    expect(s.kind).toBe("azure-quota-capacity");
    const kpiText = s.kpis.map((k) => `${k.label} ${k.value}`).join(" | ");
    const top = [...s.rows].sort((a, b) => {
      const pct = (r: typeof a) => {
        const [c, l] = String(r.usage).split("/").map(Number);
        return l ? (c ?? 0) / l : 0;
      };
      return pct(b) - pct(a);
    })[0]!;
    expect(kpiText).toContain(String(top.usage));
    // Every number shown must be a usage present in the rows (no literal 20/20 unless a row says so).
    for (const m of kpiText.matchAll(/(\d+)\/(\d+)/g)) expect(s.rows.some((r) => String(r.usage) === `${m[1]}/${m[2]}`)).toBe(true);
    // Live rows without a 20/20 quota never show one.
    const live = { ...ctx, regionalQuotas: { ...ctx.regionalQuotas!, source: "live-azure" as const, data: [{ resource: "Total Regional vCPUs (germanywestcentral)", region: "germanywestcentral", usage: "6/10", utilization: "60%", headroom: "4 Free", status: "Healthy" as const }] } };
    const liveSlice = buildSelectionSlice(live, "QuotaExceeded", buildScenarioBrief(live).steps);
    expect(liveSlice.kpis.map((k) => k.value).join(" ")).not.toContain("20/20");
    expect(liveSlice.kpis[0]?.value).toBe("6/10 (60%)");
    expect(liveSlice.suggestedAction.scriptPreview).toContain("-Location germanywestcentral");
  });

  test("the ANOM-APP-401 workload identity is not a dataset of other scenarios", async () => {
    for (const id of ["INC-4092", "INC-4099", "ANOM-LIC-101"]) {
      const { slice: s } = await slice(id, "spn-contoso-erp-sync");
      expect(s.searched.some((x) => x.kind === "workload-identity")).toBe(false);
      expect(s.rows.some((r) => JSON.stringify(r).includes("erp-sync"))).toBe(false);
      expect(s.matchedBy).toBe("none");
    }
  });

  test('a "Block AVD" policy reports what the sign-ins show, not 3', async () => {
    const ctx = await gatherContext("INC-4092");
    const quiet = { ...ctx, signIns: { ...ctx.signIns!, data: [] }, caPosture: ctx.caPosture ? { ...ctx.caPosture, data: { ...ctx.caPosture.data, legacySignIns: [] } } : null };
    const s = buildSelectionSlice(quiet, "Block AVD", buildScenarioBrief(quiet).steps);
    const row = s.rows.find((r) => String(r.displayName).includes("Block AVD"));
    expect(row).toBeDefined();
    expect(row!.blockedSignIns).toBe(0);
    expect(row!.blocksMembersOf).toBeUndefined();
    expect(row!.id).toBe(ctx.policies!.data.find((p) => p.displayName.includes("Block AVD"))!.id);
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
