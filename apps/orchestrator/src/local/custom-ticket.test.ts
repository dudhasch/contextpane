import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { findRolePermissionsInText, getScenarioEntry, isAnyScenarioId, isCustomScenarioId, lookupRoleOrPermission } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { SAMPLE_UNSCRIPTED_TICKETS, extractTicket, registerCustomTicket, refineCustomTicketGoal } = await import("./custom-ticket.ts");
const { loadDynamicCatalog } = await import("./dynamic-catalog.ts");
const { extractIncidentTimestampWindow } = await import("./cloud-status-correlator.ts");
const { gatherContext, invalidateContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("./brief.ts");
const { publishDataPlane, resolveDataPtr } = await import("./dataplane.ts");
const { buildLayout } = await import("./hydrate.ts");
const { verifyFormalInvariants, verifyIdempotency } = await import("./formal-verifier.ts");
const { buildRemediationPlan } = await import("./remediate.ts");
const { remediate, approve } = await import("../tiers/tier3-remediate.ts");
const { getTimeline } = await import("./timeline.ts");

const [avd, legal, erp] = SAMPLE_UNSCRIPTED_TICKETS as [typeof SAMPLE_UNSCRIPTED_TICKETS[0], typeof SAMPLE_UNSCRIPTED_TICKETS[0], typeof SAMPLE_UNSCRIPTED_TICKETS[0]];

describe("dynamic entity & intent extraction", () => {
  test("Finance user Diego + AVD + port 3389 → Contoso tenant, baseScenarioId null, Diego resolved live, NSG and sign-in extraction components", () => {
    const x = extractTicket(avd);
    expect(x.tenantId).toBe("tenant-contoso-01");
    expect(x.baseScenarioId).toBeNull();
    expect(x.intents).toEqual(expect.arrayContaining(["avd", "nsg", "license"]));
    expect(x.entities.find((e) => e.type === "upn" && e.resolvedTo?.startsWith("diego.siciliani"))).toBeDefined();
    expect(x.entities.find((e) => e.id === "AADSTS53003")).toBeDefined();
    expect(x.entities.find((e) => e.id === "SPE_E5")).toBeDefined();
    expect(x.entities.find((e) => e.id === "nsg-contoso-avd-hostpool-01")).toBeDefined();
    expect(x.components).toEqual(["LicenseDriftCard", "EntraSignInTimeline", "IaCDriftBanner"]);
  });

  test("Legal laptops + BitLocker conflict → Fabrikam tenant, baseScenarioId null, 0x87D1FDE8 and Grady resolved", () => {
    const x = extractTicket(legal);
    expect(x.tenantId).toBe("tenant-fabrikam-02");
    expect(x.baseScenarioId).toBeNull();
    expect(x.intents).toEqual(expect.arrayContaining(["bitlocker", "intune-compliance"]));
    expect(x.entities.find((e) => e.id === "0x87D1FDE8")).toBeDefined();
    expect(x.entities.find((e) => e.id === "Fabrikam-Legacy-BitLocker-DeviceConfig")).toBeDefined();
    expect(x.entities.find((e) => e.type === "upn" && e.resolvedTo?.startsWith("grady.archie"))).toBeDefined();
    expect(x.components).toContain("IntuneDriftCard");
    expect(x.components).not.toContain("IaCDriftBanner");
  });

  test("ERP sync app + AADSTS7000222 + contractor owner → workload-identity intents with baseScenarioId null", () => {
    const x = extractTicket(erp);
    expect(x.baseScenarioId).toBeNull();
    expect(x.intents).toEqual(expect.arrayContaining(["workload-identity", "secret", "oauth"]));
    expect(x.entities.find((e) => e.id === "AADSTS7000222")).toBeDefined();
    expect(x.entities.find((e) => e.id === "spn-contoso-erp-sync")).toBeDefined();
    expect(x.entities.find((e) => e.type === "upn" && e.resolvedTo?.startsWith("alex.wilber"))).toBeDefined();
    expect(x.components).toEqual(["EntraSignInTimeline"]);
  });

  test("the ERP sync ticket names Alex Wilber once, as the app owner, and extracts every Graph scope it mentions", () => {
    const x = extractTicket(erp);
    const alex = x.entities.filter((e) => e.type === "upn" && e.label === "Alex Wilber");
    expect(alex.map((e) => e.id)).toEqual(["alex.wilber@c4a8shili.onmicrosoft.com"]);
    const scopes = x.entities.filter((e) => e.type === "permission").map((e) => e.id);
    expect(scopes).toEqual(expect.arrayContaining(["Directory.ReadWrite.All", "Sites.FullControl.All", "Mail.ReadWrite"]));
    expect(x.entities.filter((e) => e.type === "permission").every((e) => e.resolvedTo === e.id && e.category === "identity")).toBe(true);
    const more = extractTicket({ title: "Right-size the sync app", body: "Replace RoleManagement.ReadWrite.Directory with User.Read.All and Sites.Selected, drop offline_access. Microsoft.Network stays." });
    expect(more.entities.filter((e) => e.type === "permission").map((e) => e.id)).toEqual(["RoleManagement.ReadWrite.Directory", "User.Read.All", "Sites.Selected", "offline_access"]);
  });

  test("an AVD ticket that names Alex Wilber keeps the tenant user, not the app owner", () => {
    const x = extractTicket({ title: "AVD down", body: "Alex Wilber cannot reach the AVD host pool, AADSTS53003 since this morning." });
    expect(x.baseScenarioId).toBeNull();
    expect(x.entities.filter((e) => e.type === "upn" && e.label === "Alex Wilber").map((e) => e.id)).toEqual(["alex.wilber.contoso@c4a8shili.onmicrosoft.com"]);
  });

  test("a break-glass / legacy-auth ticket and an ASR ticket extract their respective intents with baseScenarioId null", () => {
    const caTicket = extractTicket({ title: "CA policy edited", body: "CA-001 lost the SG-BreakGlass-Accounts exclusion and CA-004 is report-only, IMAP sign-ins keep coming." });
    expect(caTicket.baseScenarioId).toBeNull();
    expect(caTicket.intents).toEqual(expect.arrayContaining(["break-glass", "legacy-auth"]));

    const asrTicket = extractTicket({ title: "ASR rule weakened", body: "The LSASS credential stealing ASR rule is Audit on SG-All-Workstations and the firewall profile conflicts." });
    expect(asrTicket.baseScenarioId).toBeNull();
    expect(asrTicket.intents).toContain("asr");

    const licTicket = extractTicket({ title: "Seats", body: "Group licensing shows CountViolation for SPE_E5 while three disabled leavers still hold Copilot." });
    expect(licTicket.baseScenarioId).toBeNull();
    expect(licTicket.intents).toEqual(expect.arrayContaining(["license", "copilot"]));
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
    expect(ctx.scenarioId).toBeNull();
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
    expect(brief.extraction?.baseScenarioId).toBeNull();
    expect(brief.steps.length).toBeGreaterThan(0);
    expect(brief.steps.every((s) => entry.components.includes(s.target))).toBe(true);
    expect(brief.entities.some((e) => e.id.startsWith("diego.siciliani"))).toBe(true);
    for (const e of brief.entities) expect(entry.components).toContain(e.target);

    const layout = buildLayout(ctx, { tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 0, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] });
    expect(layout.ticketId).toBe(entry.scenarioId);
    expect(layout.components.map((c) => c.type)).toEqual(entry.components);
    for (const c of layout.components) for (const ptr of Object.values(c.dataPtrs)) expect(ptr.startsWith(prefix)).toBe(true);
  });

  test("remediation verification on arbitrary ticket text: custom bundle, invariants and timeline all hold without baseScenarioId fallback", async () => {
    const entry = registerCustomTicket(erp);
    const ctx = await gatherContext(entry.scenarioId, { fresh: true });
    const plan = buildRemediationPlan(ctx);
    expect(plan.bundle.powershellScript).toContain("ShouldProcess");
    expect(plan.bundle.title).toContain(entry.scenarioId);
    const formal = verifyFormalInvariants(entry.scenarioId);
    expect(formal.passed).toBe(true);
    expect(formal.invariants.length).toBe(3);
    expect(verifyIdempotency(entry.scenarioId).passed).toBe(true);
    expect(getTimeline(entry.scenarioId)?.slices.length).toBeGreaterThanOrEqual(4);

    const fab = registerCustomTicket(legal);
    const fabCtx = await gatherContext(fab.scenarioId, { fresh: true });
    expect(fabCtx.tenantId).toBe("tenant-fabrikam-02");
    expect(fabCtx.intune?.data.errorCode).toBe("0x87D1FDE8");
    const fabPlan = buildRemediationPlan(fabCtx);
    expect(fabPlan.bundle.powershellScript).toContain("ShouldProcess");
    expect(verifyFormalInvariants(fab.scenarioId).passed).toBe(true);
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

  test("N+k Generative UI Engine: unscripted Azure VM westeurope deployment failure synthesizes a dynamic card, labels it a template, correlates cloud status, and never leaks INC-4092 Finance E5 text", async () => {
    const vmTicket = {
      title: "Azure VM deployment failed in westeurope",
      body: "help my azure subscription wont let me deploy azure vm in westeurope. it says deployment failed since 08:00 UTC.",
      customerName: "Contoso Finance",
    };

    const entry = registerCustomTicket(vmTicket);
    expect(entry.components).toContain("SynthesizedDynamicCard");
    expect(entry.elementRouting).toBeDefined();
    expect(entry.elementRouting?.matchedExistingElements).toEqual([]);
    expect(entry.elementRouting?.missingElements[0]?.status).toBe("element_not_existent");
    const elementId = entry.elementRouting?.missingElements[0]?.elementId ?? "";
    expect(elementId.length).toBeGreaterThan(3);

    // The offline card is the deterministic template, labelled as such; tests never write the tracked catalog (L-03).
    const card = entry.synthesizedElements?.[0];
    expect(card?.elementId).toBe(elementId);
    expect(card?.synthesisMeta.synthesizerModel).toBe("deterministic-template");
    expect(card?.synthesisMeta.tsxStubPath).toBe("");
    expect(loadDynamicCatalog().dynamicElements.some((e) => e.elementId === elementId && e.synthesizerModel !== "deterministic-template")).toBe(false);

    // Verify brief & layout have zero INC-4092 Finance leakage and include Upstream Cloud Status correlation
    const ctx = await gatherContext(entry.scenarioId, { fresh: true });
    const brief = buildScenarioBrief(ctx);
    expect(brief.summary).toContain("westeurope");
    expect(brief.summary).not.toContain("SPE_E3");
    expect(brief.summary).not.toContain("SG-Contoso-Finance-AVD");
    expect(brief.summary).not.toContain("inheriting the INC-4092 pattern");
    expect(brief.cloudStatusCorrelation).not.toBeNull();
    expect(brief.cloudStatusCorrelation?.primaryRegion).toBe("westeurope");
    expect(brief.cloudStatusCorrelation?.advisories.some((a) => a.id === "AZ-WEU-CAP-409")).toBe(true);
    expect(brief.cloudStatusCorrelation?.webSearchCitations.length).toBeGreaterThan(0);

    const layout = buildLayout(ctx, { tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 0, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] });
    const synthCard = layout.components.find((c) => c.type === "SynthesizedDynamicCard");
    expect(synthCard).toBeDefined();
    if (synthCard?.type === "SynthesizedDynamicCard") {
      expect(synthCard.props.elementId).toBe(elementId);
      expect(synthCard.props.blocks.map((b) => b.kind)).toEqual(
        expect.arrayContaining(["quota-gauges", "policy-chain", "config-diff", "event-stream"]),
      );
    }

    // Verify remediation plan has zero INC-4092 Finance scripts
    const plan = buildRemediationPlan(ctx);
    expect(plan.bundle.powershellScript).not.toContain("SG-Contoso-Finance-AVD");
    expect(plan.bundle.powershellScript).not.toContain("SPE_E3");
  });

  test("extractIncidentTimestampWindow parses explicit UTC times, relative expressions, and defaults cleanly", () => {
    const w1 = extractIncidentTimestampWindow("Deployment failed at 14:20 UTC in westeurope", "2026-10-27T16:00:00Z");
    expect(w1.extractedTimeExpression).toContain("14:20");
    expect(w1.correlatedAtLabel).toContain("14:20");

    const w2 = extractIncidentTimestampWindow("Users blocked since 2 hours ago", "2026-10-27T16:00:00Z");
    expect(w2.extractedTimeExpression).toContain("2 hours ago");
  });

  test("Role & Permission Hover Dictionary resolves Graph scopes, Entra ID roles, and Azure RBAC roles with GUIDs and reference URLs", () => {
    const dirRw = lookupRoleOrPermission("Directory.ReadWrite.All");
    expect(dirRw).not.toBeNull();
    expect(dirRw?.guid).toBe("19dbc75e-c2e2-444c-a770-ec69d8559fc7");
    expect(dirRw?.riskTier).toBe("Critical Tier-0");
    expect(dirRw?.referenceUrl).toContain("graphpermissions.merill.net");

    const globalAdmin = lookupRoleOrPermission("Global & Security Admins (Role)");
    expect(globalAdmin).not.toBeNull();
    expect(globalAdmin?.guid).toBe("62e90394-69f5-4237-9190-012177145e10");
    expect(globalAdmin?.referenceUrl).toContain("azadvertizer.net");

    const vmContrib = lookupRoleOrPermission("Virtual Machine Contributor");
    expect(vmContrib).not.toBeNull();
    expect(vmContrib?.guid).toBe("9980e02c-c2be-4d73-94e8-173b1dc7cf3c");

    const inText = findRolePermissionsInText("Replace Directory.ReadWrite.All and Sites.FullControl.All with Sites.Selected");
    expect(inText.map((m) => m.id)).toEqual(
      expect.arrayContaining(["Directory.ReadWrite.All", "Sites.FullControl.All", "Sites.Selected"]),
    );
  });

  test("Goal Clarifier & 5-Stage Sub-Agent Pipeline: custom ticket generates 3 clarifying questions, 5 sub-agent task records, and zero westeurope/alex.wilber contamination", async () => {
    const oidcTicket = {
      title: "Federated Credentials on my spn stopped working",
      body: "Federated Credentials on my spn stopped working. github repo stayed the same, but it says subject identifier did not match",
      customerName: "Contoso Finance",
    };

    const entry = registerCustomTicket(oidcTicket);
    expect(entry.clarifyingQuestions).toHaveLength(3);
    expect(entry.subAgentTasks).toHaveLength(5);
    expect(entry.subAgentTasks?.map((t) => t.task)).toEqual([
      "scope-and-questions",
      "telemetry-and-status",
      "ui-element-synthesis",
      "script-and-iac-synthesis",
      "preflight-and-undo",
    ]);

    const ctx = await gatherContext(entry.scenarioId, { fresh: true });
    const brief = buildScenarioBrief(ctx);
    expect(brief.clarifyingQuestions).toHaveLength(3);
    expect(brief.subAgentTasks).toHaveLength(5);
    expect(brief.summary).toContain("Federated Credentials");
    expect(brief.summary).not.toContain("westeurope");
    expect(brief.summary).not.toContain("Standard_D4s_v5");
    expect(brief.cloudStatusCorrelation?.primaryRegion).toBe("Global");

    const layout = buildLayout(ctx, { tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 0, tokensUsed: 0, fallbackChain: [], validated: true, repaired: [] });
    const synthCard = layout.components.find((c) => c.type === "SynthesizedDynamicCard");
    expect(synthCard).toBeDefined();
    if (synthCard?.type === "SynthesizedDynamicCard") {
      const cardJson = JSON.stringify(synthCard.props);
      expect(cardJson).not.toContain("westeurope");
      expect(cardJson).not.toContain("Standard_D4s_v5");
      expect(cardJson).not.toContain("alex.wilber");
    }

    // Verify remediation bundle and pre-flight verification pass with zero westeurope or alex.wilber contamination
    const remResult = await remediate({ scenarioId: entry.scenarioId });
    expect(["Verified Safe", "Verified With Warnings"]).toContain(remResult.drawer.verificationStatus.verdict);
    expect(remResult.drawer.powershellScript).not.toContain("westeurope");
    expect(remResult.drawer.powershellScript).not.toContain("Standard_D4s_v5");
    expect(remResult.drawer.powershellScript).not.toContain("alex.wilber");

    // Verify approval execution console logs custom steps and never logs removing alex.wilber
    const approved = await approve({
      remediationId: remResult.drawer.remediationId,
      approvedBy: "timur@contextpane.dev",
      decision: "approve",
      mode: "break-glass",
      openPullRequest: false,
    });
    const logJoined = approved.executionLog.join("\n");
    expect(logJoined).not.toContain("alex.wilber");
    expect(logJoined).not.toContain("westeurope");

    // Verify refineCustomTicketGoal dynamically updates the brief, synthesized card, and remediation script
    const qIds = entry.clarifyingQuestions!.map((q) => q.id);
    const refined = await refineCustomTicketGoal(entry.scenarioId, {
      [qIds[0]!]: "repo:contoso/erp-sync:pull_request",
      [qIds[1]!]: "update-existing-subject",
      [qIds[2]!]: "only-fix-oidc",
    });
    expect(refined).not.toBeNull();
    invalidateContext(entry.scenarioId);
    const refinedCtx = await gatherContext(entry.scenarioId, { fresh: true });
    const refinedBrief = buildScenarioBrief(refinedCtx);
    expect(refinedBrief.summary).toContain("repo:contoso/erp-sync:pull_request");
    expect(refinedBrief.clarifiedAnswers?.[qIds[0]!]).toBe("repo:contoso/erp-sync:pull_request");
    const refinedPlan = buildRemediationPlan(refinedCtx);
    expect(refinedPlan.bundle.powershellScript).toContain("repo:contoso/erp-sync:pull_request");
    expect(refinedPlan.bundle.powershellScript).not.toContain("alex.wilber");
  }, 15000);

  test("#ERP-* and #CUSTOM-* formal verification passes all pre-flight checks", () => {
    const erpProof = verifyFormalInvariants("ERP-202688511" as any);
    expect(erpProof.passed).toBe(true);
    expect(verifyIdempotency("ERP-202688511" as any).passed).toBe(true);

    const customProof = verifyFormalInvariants("CUSTOM-14KX82" as any);
    expect(customProof.passed).toBe(true);
    expect(verifyIdempotency("CUSTOM-14KX82" as any).passed).toBe(true);
  });

  test("Custom ticket mentioning a seeded entity (Lynne Robins + Key Vault soft-delete) mounts SynthesizedDynamicCard instead of LicenseDriftCard and records real sub-agent latencies", async () => {
    const kvTicket = {
      title: "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to soft-delete conflict on recreation",
      body: "Lynne Robins (lynne.robins.contoso@c4a8shili.onmicrosoft.com) cannot access a newly created Key Vault kv-contoso-fin-02 due to soft-delete conflict on recreation in Contoso Finance.",
      customerName: "Contoso Finance",
    };
    const entry = registerCustomTicket(kvTicket);
    expect(entry.baseScenarioId).toBeNull();
    expect(entry.components).toEqual(["SynthesizedDynamicCard"]);
    expect(entry.components).not.toContain("LicenseDriftCard");
    expect(entry.subAgentTasks).toHaveLength(5);
    expect(entry.subAgentTasks?.map((t) => t.latencyMs)).not.toEqual([42, 34, 65, 58, 12]);
  });
});

describe("sub-agent pipeline sequencing (L-05, L-07)", () => {
  test("Key Vault ticket: clarifier answers reach the coder and the gatekeeper's decision reaches the synthesizer", async () => {
    const { spyOn } = await import("bun:test");
    const openai = await import("../router/openai.ts");
    const correlator = await import("./cloud-status-correlator.ts");
    const { config, providers } = await import("../config.ts");
    const { buildDeterministicRoutingDecision } = await import("./dynamic-catalog.ts");
    const { triageCustomTicketAsync, removeCustomTicket } = await import("./custom-ticket.ts");

    // The persisted CUSTOM-13E7NK proof. No answers are passed: the clarifier preselects
    // "Purge protection is enabled…" and "Recover the old vault", and those must reach the coder.
    const ticket = {
      title: "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to soft-delete conflict on recreation",
      body: "Lynne Robins (lynne.robins.contoso@c4a8shili.onmicrosoft.com) cannot access a newly created Key Vault kv-contoso-fin-02 due to soft-delete conflict on recreation in Contoso Finance.",
      customerName: "Contoso Finance",
    };
    const option = (value: string, i: number) => ({ id: `opt-${i}`, label: value, value, description: value });
    const questions = [
      { id: "question-1", question: "What is the root cause and scope?", category: "scope", options: ["The original vault was deleted and is in soft-delete state", "A new vault was created but Lynne lacks access permissions", "The name conflicts with a soft-deleted vault elsewhere"].map(option) },
      { id: "question-2", question: "What is the purge protection state?", category: "security", options: ["Purge protection is enabled and retention has not expired", "Purge protection is disabled and the vault can be purged", "Retention and purge protection status are unknown"].map(option) },
      { id: "question-3", question: "Preferred resolution strategy?", category: "remediation", options: ["Recover the old vault", "Permanently purge then recreate", "Keep the new vault and fix access for Lynne"].map(option) },
    ];
    const gatekeeperDecision = buildDeterministicRoutingDecision({ title: ticket.title, body: ticket.body, matchedSeededComponents: [] });
    gatekeeperDecision.missingElements[0]!.elementId = "KeyVaultSoftDeleteRecoveryCard";
    gatekeeperDecision.missingElements[0]!.domain = "identity";

    const calls: Array<{ tool: string; user: string }> = [];
    const usage = { prompt: 10, completion: 10, total: 20 };
    const chatSpy = spyOn(openai, "chatWithForcedTool").mockImplementation((async (_provider: unknown, _model: string, messages: Array<{ role: string; content: string }>, tool: { function: { name: string } }) => {
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      calls.push({ tool: tool.function.name, user });
      const respond = (args: unknown) => ({ toolName: tool.function.name, argumentsRaw: JSON.stringify(args), usage, latencyMs: 5, finishReason: "stop" });
      switch (tool.function.name) {
        case "emit_clarifying_questions":
          return respond({ questions });
        case "emit_element_routing_decision":
          return respond(gatekeeperDecision);
        case "emit_synthesized_dynamic_card":
          return respond({
            title: "Key Vault soft-delete recovery",
            headline: "kv-contoso-fin-02 is soft-deleted with purge protection",
            domain: "identity",
            state: "warning",
            gauges: [{ id: "g1", label: "Retention days left", used: 83, limit: 90, unit: "days", status: "warning" }],
            diff: "- # vault soft-deleted\n+ Undo-AzKeyVaultRemoval -VaultName kv-contoso-fin-02 -ResourceGroupName rg-contoso-fin -Location westeurope",
            recommendedActions: [{ id: "a1", label: "Recover vault", description: "Recover in place", command: "Undo-AzKeyVaultRemoval -VaultName kv-contoso-fin-02", kind: "stage-fix" }],
          });
        case "emit_custom_remediation_template": {
          const recover = user.includes("Recover the old vault");
          return respond({
            title: recover ? "Recover soft-deleted kv-contoso-fin-02" : "Purge and recreate kv-contoso-fin-02",
            summary: "Key Vault remediation",
            powershellScript: recover
              ? "[CmdletBinding(SupportsShouldProcess = $true)]\nparam([string]$VaultName = 'kv-contoso-fin-02')\nif ($PSCmdlet.ShouldProcess($VaultName, 'Recover')) {\n  Undo-AzKeyVaultRemoval -VaultName $VaultName -ResourceGroupName rg-contoso-fin -Location westeurope\n}\n"
              : "[CmdletBinding(SupportsShouldProcess = $true)]\nparam([string]$VaultName = 'kv-contoso-fin-02')\nif ($PSCmdlet.ShouldProcess($VaultName, 'Purge')) {\n  Remove-AzKeyVault -VaultName $VaultName -InRemovedState -Force\n}\n",
            terraformDiff: "",
            graphPatch: "{}",
            rollbackScript: "",
            executionSteps: ["Recover the vault"],
          });
        }
        default:
          throw new Error(`unexpected tool ${tool.function.name}`);
      }
    }) as never);
    const statusSpy = spyOn(correlator, "correlateUpstreamCloudStatus").mockImplementation((async (input: { ticketText: string; createdAt?: string }) => correlator.correlateUpstreamCloudStatusSync(input)) as never);
    const mutableConfig = config as { forceLocal: boolean };
    const mutableMeta = providers.meta as { hasKey: boolean };
    const previous = { nodeEnv: process.env.NODE_ENV, forceLocal: mutableConfig.forceLocal, hasKey: mutableMeta.hasKey };
    // The sub-agents only call models outside the test env with a key; the spy above is the model.
    process.env.NODE_ENV = "development";
    mutableConfig.forceLocal = false;
    mutableMeta.hasKey = true;
    let scenarioId: string | null = null;
    try {
      const entry = await triageCustomTicketAsync(ticket);
      scenarioId = entry.scenarioId;
      const script = entry.customRemediation?.powershellScript ?? "";
      expect(script).toContain("Undo-AzKeyVaultRemoval");
      expect(script).not.toContain("-InRemovedState");
      expect(entry.clarifiedAnswers?.["question-2"]).toBe("Purge protection is enabled and retention has not expired");
      expect(entry.clarifiedAnswers?.["question-3"]).toBe("Recover the old vault");

      const order = calls.map((c) => c.tool);
      expect(order.indexOf("emit_clarifying_questions")).toBe(0);
      expect(order.indexOf("emit_element_routing_decision")).toBeLessThan(order.indexOf("emit_synthesized_dynamic_card"));
      const synthCall = calls.find((c) => c.tool === "emit_synthesized_dynamic_card")!;
      expect(JSON.parse(synthCall.user).missingElement.elementId).toBe("KeyVaultSoftDeleteRecoveryCard");
      expect(JSON.parse(synthCall.user).clarifiedAnswers["question-3"]).toBe("Recover the old vault");
      expect(entry.synthesizedElements?.[0]?.elementId).toBe("KeyVaultSoftDeleteRecoveryCard");
      expect(entry.synthesizedElements?.[0]?.synthesisMeta.source).toBe("llm");
      const steps = Object.fromEntries((entry.subAgentTasks ?? []).map((t) => [t.stepIndex, t]));
      expect(steps[1]?.source).toBe("llm");
      expect(steps[3]?.source).toBe("llm");
      expect(steps[4]?.source).toBe("llm");
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      mutableConfig.forceLocal = previous.forceLocal;
      mutableMeta.hasKey = previous.hasKey;
      chatSpy.mockRestore();
      statusSpy.mockRestore();
      if (scenarioId) removeCustomTicket(scenarioId);
    }
  });
});

describe("dynamic catalog honesty (L-03)", () => {
  test("the deterministic path labels its card a template and never persists it", async () => {
    const { buildDeterministicRoutingDecision, synthesizeAndPersistMissingElements, TEMPLATE_SYNTHESIZER } = await import("./dynamic-catalog.ts");
    const before = loadDynamicCatalog().dynamicElements.length;
    const decision = buildDeterministicRoutingDecision({ title: "Template provenance probe", body: "probe", matchedSeededComponents: [] });
    // Offline the async synthesizer makes no model call and falls back to the template.
    const [card] = await synthesizeAndPersistMissingElements({ ticketId: "CUSTOM-PROBE1", ticketPrompt: "probe", decision, gatekeeperModel: "deterministic-router" });
    expect(card?.synthesisMeta.synthesizerModel).toBe(TEMPLATE_SYNTHESIZER);
    expect(card?.synthesisMeta.gatekeeperModel).toBe("deterministic-router");
    expect(card?.synthesisMeta.source).toBe("fallback");
    expect(card?.synthesisMeta.tsxStubPath).toBe("");
    expect(loadDynamicCatalog().dynamicElements.length).toBe(before);
    expect(existsSync("../../data/synthesized-elements/TemplateProvenanceProbeCard.tsx")).toBe(false);
  });
});
