import { describe, expect, test } from "bun:test";
import { getScenarioEntry, isAnyScenarioId, isCustomScenarioId } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { SAMPLE_UNSCRIPTED_TICKETS, extractTicket, registerCustomTicket } = await import("./custom-ticket.ts");
const { gatherContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("./brief.ts");
const { publishDataPlane, resolveDataPtr } = await import("./dataplane.ts");
const { buildLayout } = await import("./hydrate.ts");
const { verifyFormalInvariants, verifyIdempotency } = await import("./formal-verifier.ts");
const { buildRemediationPlan } = await import("./remediate.ts");
const { getTimeline } = await import("./timeline.ts");

const [avd, legal, erp] = SAMPLE_UNSCRIPTED_TICKETS as [typeof SAMPLE_UNSCRIPTED_TICKETS[0], typeof SAMPLE_UNSCRIPTED_TICKETS[0], typeof SAMPLE_UNSCRIPTED_TICKETS[0]];

describe("dynamic entity & intent extraction", () => {
  test("Finance user Diego + AVD + port 3389 → INC-4092 pattern, Diego resolved live, NSG and sign-in cards", () => {
    const x = extractTicket(avd);
    expect(x.tenantId).toBe("tenant-contoso-01");
    expect(x.baseScenarioId).toBe("INC-4092");
    expect(x.intents).toEqual(expect.arrayContaining(["avd", "nsg", "license"]));
    expect(x.entities.find((e) => e.type === "upn" && e.resolvedTo?.startsWith("diego.siciliani"))).toBeDefined();
    expect(x.entities.find((e) => e.id === "AADSTS53003")).toBeDefined();
    expect(x.entities.find((e) => e.id === "SPE_E5")).toBeDefined();
    expect(x.entities.find((e) => e.id === "nsg-contoso-avd-hostpool-01")).toBeDefined();
    expect(x.components).toEqual(["LicenseDriftCard", "EntraSignInTimeline", "IaCDriftBanner"]);
  });

  test("Legal laptops + BitLocker conflict → Fabrikam tenant, INC-4099 pattern, 0x87D1FDE8 and Grady resolved", () => {
    const x = extractTicket(legal);
    expect(x.tenantId).toBe("tenant-fabrikam-02");
    expect(x.baseScenarioId).toBe("INC-4099");
    expect(x.intents).toEqual(expect.arrayContaining(["bitlocker", "intune-compliance"]));
    expect(x.entities.find((e) => e.id === "0x87D1FDE8")).toBeDefined();
    expect(x.entities.find((e) => e.id === "Fabrikam-Legacy-BitLocker-DeviceConfig")).toBeDefined();
    expect(x.entities.find((e) => e.type === "upn" && e.resolvedTo?.startsWith("grady.archie"))).toBeDefined();
    expect(x.components).toContain("IntuneDriftCard");
    expect(x.components).not.toContain("IaCDriftBanner");
  });

  test("ERP sync app + AADSTS7000222 + contractor owner → ANOM-APP-401 pattern", () => {
    const x = extractTicket(erp);
    expect(x.baseScenarioId).toBe("ANOM-APP-401");
    expect(x.intents).toEqual(expect.arrayContaining(["workload-identity", "secret", "oauth"]));
    expect(x.entities.find((e) => e.id === "AADSTS7000222")).toBeDefined();
    expect(x.entities.find((e) => e.id === "spn-contoso-erp-sync")).toBeDefined();
    expect(x.entities.find((e) => e.type === "upn" && e.resolvedTo?.startsWith("alex.wilber"))).toBeDefined();
    expect(x.components).toEqual(["EntraSignInTimeline"]);
  });

  test("a break-glass / legacy-auth ticket and an ASR ticket pick their anomaly patterns", () => {
    expect(extractTicket({ title: "CA policy edited", body: "CA-001 lost the SG-BreakGlass-Accounts exclusion and CA-004 is report-only, IMAP sign-ins keep coming." }).baseScenarioId).toBe("ANOM-CA-204");
    expect(extractTicket({ title: "ASR rule weakened", body: "The LSASS credential stealing ASR rule is Audit on SG-All-Workstations and the firewall profile conflicts." }).baseScenarioId).toBe("ANOM-INT-309");
    expect(extractTicket({ title: "Seats", body: "Group licensing shows CountViolation for SPE_E5 while three disabled leavers still hold Copilot." }).baseScenarioId).toBe("ANOM-LIC-101");
  });
});

describe("CUSTOM-<hash> registration, ptr://custom-* data plane and remediation verification", () => {
  test("registers a scenario, gathers its context, publishes pointers under ptr://custom-<hash>/", async () => {
    const entry = registerCustomTicket(avd);
    expect(isCustomScenarioId(entry.scenarioId)).toBe(true);
    expect(isAnyScenarioId(entry.scenarioId)).toBe(true);
    expect(getScenarioEntry(entry.scenarioId)?.title).toBe(avd.title);
    // Same text → same id (idempotent re-registration).
    expect(registerCustomTicket(avd).scenarioId).toBe(entry.scenarioId);

    const ctx = await gatherContext(entry.scenarioId, { fresh: true });
    expect(ctx.ticketId).toBe(entry.scenarioId);
    expect(ctx.scenarioId).toBe("INC-4092");
    expect(ctx.custom?.scenarioId).toBe(entry.scenarioId);
    expect(ctx.drift).not.toBeNull();

    const snapshot = publishDataPlane(ctx);
    const prefix = `ptr://${entry.scenarioId.toLowerCase()}/`;
    expect(snapshot.descriptors.length).toBeGreaterThan(0);
    for (const d of snapshot.descriptors) expect(d.ptr.startsWith(prefix)).toBe(true);
    const rules = resolveDataPtr(`${prefix}iac/rogue-rules`);
    expect(rules.found).toBe(true);
    expect((rules.value as unknown[]).length).toBeGreaterThan(0);

    const brief = buildScenarioBrief(ctx);
    expect(brief.scenarioId).toBe(entry.scenarioId);
    expect(brief.kind).toBe("ticket");
    expect(brief.title).toBe(avd.title);
    expect(brief.body).toBe(avd.body);
    expect(brief.extraction?.baseScenarioId).toBe("INC-4092");
    expect(brief.steps.length).toBeGreaterThan(0);
    expect(brief.steps.every((s) => entry.components.includes(s.target))).toBe(true);
    expect(brief.entities.some((e) => e.id.startsWith("diego.siciliani"))).toBe(true);
    for (const e of brief.entities) expect(entry.components).toContain(e.target);

    const layout = buildLayout(ctx, { tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 0, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] });
    expect(layout.ticketId).toBe(entry.scenarioId);
    expect(layout.components.map((c) => c.type)).toEqual(entry.components);
    for (const c of layout.components) for (const ptr of Object.values(c.dataPtrs)) expect(ptr.startsWith(prefix)).toBe(true);
  });

  test("remediation verification on arbitrary ticket text: the inherited bundle, invariants and timeline all hold", async () => {
    const entry = registerCustomTicket(erp);
    const ctx = await gatherContext(entry.scenarioId, { fresh: true });
    const plan = buildRemediationPlan(ctx);
    expect(plan.bundle.powershellScript).toContain("ShouldProcess");
    expect(plan.bundle.powershellScript).toContain("New-MgApplicationFederatedIdentityCredential");
    expect(plan.bundle.title).toContain(entry.scenarioId);
    const formal = verifyFormalInvariants(entry.baseScenarioId);
    expect(formal.passed).toBe(true);
    expect(formal.invariants.length).toBe(4);
    expect(verifyIdempotency(entry.baseScenarioId).passed).toBe(true);
    expect(getTimeline(entry.baseScenarioId)?.slices.length).toBeGreaterThanOrEqual(4);

    const fab = registerCustomTicket(legal);
    const fabCtx = await gatherContext(fab.scenarioId, { fresh: true });
    expect(fabCtx.tenantId).toBe("tenant-fabrikam-02");
    expect(fabCtx.intune?.data.errorCode).toBe("0x87D1FDE8");
    const fabPlan = buildRemediationPlan(fabCtx);
    expect(fabPlan.bundle.powershellScript).toMatch(/Fabrikam-Legacy-BitLocker-DeviceConfig/);
    expect(verifyFormalInvariants(fab.baseScenarioId).passed).toBe(true);
  });

  test("ANOM-APP-401 and custom ERP ticket brief copy ends cleanly with full words & periods", async () => {
    const app401Ctx = await gatherContext("ANOM-APP-401", { fresh: true });
    const app401Brief = buildScenarioBrief(app401Ctx);
    expect(app401Brief.summary.endsWith(".")).toBe(true);
    expect(app401Brief.summary.endsWith("github-actions")).toBe(false);
    expect(app401Brief.summary).toContain("github-actions-erp-sync' expired");
    expect(app401Brief.steps[1]!.detail).toContain("Sites.Selected per 90-day activity.");
    expect(app401Brief.steps.every((s) => s.detail.endsWith("."))).toBe(true);

    const customEntry = registerCustomTicket(erp);
    const customCtx = await gatherContext(customEntry.scenarioId, { fresh: true });
    const customBrief = buildScenarioBrief(customCtx);
    expect(customBrief.summary.endsWith(".")).toBe(true);
    expect(customBrief.summary.endsWith("github-actions")).toBe(false);
    expect(customBrief.summary).toContain("github-actions-erp-sync' expired");
    expect(customBrief.steps[1]!.detail).toContain("Sites.Selected per 90-day activity.");
    expect(customBrief.steps.every((s) => s.detail.endsWith("."))).toBe(true);
  });

  test("ANOM-APP-401 workload identity sign-in and audit history rows are diversified", async () => {
    const ctx = await gatherContext("ANOM-APP-401", { fresh: true });
    const layout = buildLayout(ctx, { tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 0, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] });
    const timeline = layout.components.find((c) => c.type === "EntraSignInTimeline");
    expect(timeline).toBeDefined();

    const props = timeline!.props as { events: Array<{ timestamp: string; displayName: string; appDisplayName: string; errorCodeLabel?: string; failureReason?: string; clientApp: string }> };
    expect(props.events.length).toBeGreaterThanOrEqual(5);

    // Timestamps must be distinct
    const timestamps = new Set(props.events.map((e) => e.timestamp));
    expect(timestamps.size).toBe(props.events.length);

    // Realistic event details
    expect(props.events.some((e) => e.errorCodeLabel === "AADSTS7000222" && e.clientApp === "GitHub Actions")).toBe(true);
    expect(props.events.some((e) => e.errorCodeLabel === "AADSTS7000222" && e.clientApp.includes("retry"))).toBe(true);
    expect(props.events.some((e) => e.errorCodeLabel === "OAuth Grant" || e.appDisplayName.includes("Mail.ReadWrite"))).toBe(true);
    expect(props.events.some((e) => e.errorCodeLabel === "Scope Audit" && e.appDisplayName.includes("Directory.ReadWrite.All"))).toBe(true);
    expect(props.events.some((e) => e.displayName === "Alex Wilber" && /App Owner/.test(e.failureReason ?? ""))).toBe(true);

    // The spec's clock: 02:15:00Z expired secret, 02:10:14Z retry, 01:42:19Z OAuth grant, yesterday 18:05Z scope audit, yesterday 11:20Z owner review.
    const times = (label: string | RegExp) => props.events.filter((e) => (typeof label === "string" ? e.appDisplayName === label : label.test(e.appDisplayName))).map((e) => e.timestamp.slice(11, 19));
    expect(times(/^Microsoft Graph$/)).toEqual(expect.arrayContaining(["02:10:14", "02:15:00"]));
    expect(times(/^Grant:/)).toEqual(["01:42:19"]);
    expect(times(/scope audit/)).toEqual(["18:05:00"]);
    expect(times(/Access review/)).toEqual(["11:20:00"]);
    const day = (e: { timestamp: string }) => e.timestamp.slice(0, 10);
    const today = props.events.find((e) => e.appDisplayName === "Microsoft Graph")!;
    expect(props.events.filter((e) => /scope audit|Access review/.test(e.appDisplayName)).every((e) => day(e) < day(today))).toBe(true);
  });
});
