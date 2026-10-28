import { describe, expect, spyOn, test } from "bun:test";
import { emptySteering, isSteeringStale, steeringDigest, type ClarifyingQuestion, type SteeringParams } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { applySteeringDelta, classifyGovernance, classifyScope, classifyStrategy, clarifiedAnswersFromSteering, deriveSteeringFromAnswers, isDrawerStale, scriptDiff, steeringForCoder } = await import("./steering.ts");
const { generateClarifyingQuestionsSync } = await import("./subagent-orchestrator.ts");
const openai = await import("../router/openai.ts");
const modal = await import("../preflight/modal.ts");
const staging = await import("../preflight/staging.ts");
const { registerCustomTicket, clearCustomTickets, getCustomScenario } = await import("./custom-ticket.ts");
const { remediationStore } = await import("../store/remediations.ts");
const { auditLedger } = await import("../store/audit.ts");
const { remediate } = await import("../tiers/tier3-remediate.ts");
const { telemetry } = await import("../telemetry.ts");

const KV_TICKET = {
  title: "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to soft-delete conflict on recreation",
  body: "Lynne Robins (lynne.robins.contoso@c4a8shili.onmicrosoft.com) cannot access a newly created Key Vault kv-contoso-fin-02 due to soft-delete conflict on recreation in Contoso Finance. Purge protection is enabled on the old vault.",
  customerName: "Contoso Finance",
};

const questions: ClarifyingQuestion[] = generateClarifyingQuestionsSync({ title: KV_TICKET.title, body: KV_TICKET.body });
const strategyQ = questions.find((q) => q.id === "remediation-strategy")!;
const scopeQ = questions.find((q) => q.id === "target-scope")!;
const PURGE = strategyQ.options.find((o) => /purge/i.test(o.label))!.label;
const RECOVER = strategyQ.options.find((o) => /recover/i.test(o.label))!.label;

describe("SteeringParams: clarifier answers, row clicks and typed values become one typed contract (U-1)", () => {
  test("the three clarifier questions classify onto strategy / scope / governance", () => {
    expect(classifyStrategy(RECOVER)).toBe("recover");
    expect(classifyStrategy(PURGE)).toBe("purge-recreate");
    expect(classifyStrategy("Stage Declarative Terraform & PowerShell Bundle")).toBe("gitops-bundle");
    expect(classifyScope("Production Scoped Target (Phased Rollout)")).toBe("production-scoped");
    expect(classifyScope("Staging / Validation Environment First")).toBe("staging-first");
    expect(classifyScope("Full Tenant / Subscription Scope")).toBe("tenant-wide");
    expect(classifyGovernance("Audit / What-If Verification First")).toBe("audit-first");
    expect(classifyGovernance("Scoped Break-Glass Exception")).toBe("break-glass");
  });

  test("derive: version 0 with clarifier provenance; a changed answer bumps the version, an unchanged one keeps its provenance", () => {
    const base = deriveSteeringFromAnswers(questions, undefined, { now: "2026-10-28T10:00:00Z" });
    expect(base.version).toBe(0);
    expect(base.remediationStrategy?.value).toBe("recover");
    expect(base.remediationStrategy?.source).toBe("clarifier");
    expect(base.dryRun).toBeUndefined();
    expect(Object.keys(base.answers).sort()).toEqual(questions.map((q) => q.id).sort());
    const same = deriveSteeringFromAnswers(questions, clarifiedAnswersFromSteering(base), { previous: base, now: "2026-10-28T11:00:00Z" });
    expect(same.version).toBe(0);
    expect(same.digest).toBe(base.digest);
    expect(same.remediationStrategy?.setAt).toBe("2026-10-28T10:00:00Z");
    const changed = deriveSteeringFromAnswers(questions, { ...clarifiedAnswersFromSteering(base), [strategyQ.id]: PURGE }, { previous: base, now: "2026-10-28T11:00:00Z" });
    expect(changed.version).toBe(1);
    expect(changed.remediationStrategy?.value).toBe("purge-recreate");
    expect(changed.digest).not.toBe(base.digest);
  });

  test("apply: a pill toggle, a row click and a typed value each carry their own source; the digest ignores time and source", () => {
    const base = deriveSteeringFromAnswers(questions, undefined, { now: "2026-10-28T10:00:00Z" });
    const pill = applySteeringDelta(base, { clarifier: { [strategyQ.id]: PURGE } }, questions, "2026-10-28T10:01:00Z");
    expect(pill.version).toBe(1);
    expect(pill.remediationStrategy).toMatchObject({ value: "purge-recreate", label: PURGE, source: "clarifier" });
    expect(clarifiedAnswersFromSteering(pill)[strategyQ.id]).toBe(PURGE);
    const row = applySteeringDelta(pill, { rowClick: { key: "targetResource", value: "kv-contoso-fin-02", label: "kv-contoso-fin-02 · Soft-deleted" } }, questions, "2026-10-28T10:02:00Z");
    expect(row.version).toBe(2);
    expect(row.targetResource).toMatchObject({ value: "kv-contoso-fin-02", source: "row-click" });
    const typed = applySteeringDelta(row, { params: { dryRun: true, targetIds: "lynne@x,diego@x" }, source: "operator" }, questions, "2026-10-28T10:03:00Z");
    expect(typed.dryRun).toMatchObject({ value: true, source: "operator" });
    expect(typed.targetIds?.value).toEqual(["lynne@x", "diego@x"]);
    // No-op delta: same digest, same version.
    const noop = applySteeringDelta(typed, { clarifier: { [strategyQ.id]: PURGE } }, questions, "2026-10-28T10:04:00Z");
    expect(noop.version).toBe(typed.version);
    expect(noop.digest).toBe(typed.digest);
    // A custom-typed scope answer that names a resource becomes targetResource.
    const named = applySteeringDelta(base, { clarifier: { [scopeQ.id]: "nsg-contoso-avd-hostpool-01" } }, questions);
    expect(named.targetResource?.value).toBe("nsg-contoso-avd-hostpool-01");
    const forCoder = steeringForCoder(typed);
    expect(forCoder.remediationStrategy).toMatchObject({ value: "purge-recreate", source: "clarifier" });
    expect((forCoder.clarifierAnswers as Record<string, string>)[strategyQ.id]).toBe(PURGE);
  });

  test("stale: a drawer built for an older digest is stale; one without a stamp is stale only after a steer", () => {
    const v0 = deriveSteeringFromAnswers(questions, undefined);
    const v1 = applySteeringDelta(v0, { clarifier: { [strategyQ.id]: PURGE } }, questions);
    expect(isDrawerStale({ steering: { version: 0, digest: v0.digest } }, v0)).toBe(false);
    expect(isDrawerStale({ steering: { version: 0, digest: v0.digest } }, v1)).toBe(true);
    expect(isDrawerStale({}, v0)).toBe(false);
    expect(isDrawerStale({}, v1)).toBe(true);
    expect(isSteeringStale(null, emptySteering())).toBe(false);
    expect(steeringDigest(v1)).toBe(v1.digest);
    const sp: SteeringParams = { ...v1, updatedAt: "2000-01-01T00:00:00Z" };
    expect(steeringDigest(sp)).toBe(v1.digest);
  });

  test("scriptDiff names the steering versions and is empty for identical scripts", () => {
    expect(scriptDiff("a\n", "a\n", 1, 2)).toBe("");
    const d = scriptDiff("Remove-AzKeyVault -InRemovedState\n", "Undo-AzKeyVaultRemoval\n", 1, 2);
    expect(d).toContain("steering v1");
    expect(d).toContain("steering v2");
    expect(d).toContain("-Remove-AzKeyVault -InRemovedState");
    expect(d).toContain("+Undo-AzKeyVaultRemoval");
  });
});

describe("PATCH /api/tickets/:id/steer re-parameterises the script within one coder call (U-1 done criterion)", () => {
  /** The remediation tier never touches git or Modal from the tests (HARD_CASES 11). */
  async function quiet<T>(run: () => Promise<T>): Promise<T> {
    const auditSpy = spyOn(auditLedger, "append").mockImplementation(((input: unknown) => input) as never);
    const modalSpy = spyOn(modal, "modalConfigured").mockReturnValue(false);
    const stageSpy = spyOn(staging, "stageRemediationBranch").mockRejectedValue(new Error("git staging disabled in tests"));
    try {
      return await run();
    } finally {
      auditSpy.mockRestore();
      modalSpy.mockRestore();
      stageSpy.mockRestore();
    }
  }

  test("Key Vault ticket: Purge -> Recover flips the PowerShell tab, the card's config-diff block and the drawer's steering stamp; the coder saw the typed params and the previous script", async () => {
    const { app } = await import("../app.ts");
    await quiet(async () => {
      const entry = registerCustomTicket(KV_TICKET);
      try {
        // Step 1: steer to Purge offline. The deterministic coder reads the typed strategy.
        const purgeRes = await app.request(`/api/tickets/${entry.scenarioId}/steer`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clarifier: { [strategyQ.id]: PURGE } }),
        });
        expect(purgeRes.status).toBe(200);
        const purged = (await purgeRes.json()) as { steering: SteeringParams; customRemediation: { powershellScript: string }; drawer: null; coder: { source: string } };
        expect(purged.steering.version).toBe(1);
        expect(purged.steering.remediationStrategy?.value).toBe("purge-recreate");
        expect(purged.customRemediation.powershellScript).toContain("Remove-AzKeyVault");
        expect(purged.customRemediation.powershellScript).toContain("-InRemovedState");
        expect(purged.customRemediation.powershellScript).not.toContain("Undo-AzKeyVaultRemoval");
        expect(purged.drawer).toBeNull();
        expect(purged.coder.source).toBe("fallback-on-error");

        // Open the drawer on the purge script: this is the state the operator steers from.
        const { drawer: staged } = await remediate({ scenarioId: entry.scenarioId, fresh: true });
        expect(staged.powershellScript).toContain("-InRemovedState");
        expect(staged.steering?.digest).toBe(purged.steering.digest);

        // Step 2: Recover, with Wonder mocked: one call, fed the typed steering and the previous script as diff base.
        const seen: Array<Record<string, unknown>> = [];
        const RECOVERED_SCRIPT = [
          "#Requires -Version 7.0",
          "[CmdletBinding(SupportsShouldProcess = $true)]",
          'param([string]$Target = "kv-contoso-fin-02", [string]$ResourceGroupName = "", [string]$Location = "westeurope")',
          "$ErrorActionPreference = 'Stop'",
          'if ($PSCmdlet.ShouldProcess($Target, "Recover soft-deleted Key Vault kv-contoso-fin-02 in place")) {',
          "  $deleted = Get-AzKeyVault -VaultName $Target -Location $Location -InRemovedState",
          "  Undo-AzKeyVaultRemoval -VaultName $Target -ResourceGroupName $deleted.ResourceGroupName -Location $Location | Out-Null",
          "}",
          "",
        ].join("\n");
        const enabledSpy = spyOn(openai, "metaCallsEnabled").mockReturnValue(true);
        const chatSpy = spyOn(openai, "chatWithForcedTool").mockImplementation((async (_provider: unknown, _model: string, messages: Array<{ role: string; content: string }>) => {
          seen.push(JSON.parse(messages.find((m) => m.role === "user")!.content) as Record<string, unknown>);
          return {
            toolName: "emit_custom_remediation_template",
            argumentsRaw: JSON.stringify({
              title: "Recover Key Vault kv-contoso-fin-02",
              summary: "Recovers the soft-deleted vault in place.",
              powershellScript: RECOVERED_SCRIPT,
              terraformDiff: "",
              graphPatch: "{}",
              rollbackScript: "Remove-AzKeyVault -VaultName kv-contoso-fin-02 -Force",
              affectedEntities: [{ type: "resource", id: "kv-contoso-fin-02", change: "soft-deleted -> recovered" }],
              requiredCommands: ["Undo-AzKeyVaultRemoval"],
              executionSteps: ["[Step 1/2] Confirm the vault is soft-deleted", "[Step 2/2] Undo-AzKeyVaultRemoval"],
            }),
            usage: { prompt: 1234, completion: 321, total: 1555 },
            latencyMs: 42,
            finishReason: "tool_calls",
          };
        }) as never);
        const before = telemetry.recent(5).length;
        let recovered: {
          steering: SteeringParams;
          previousVersion: number;
          customRemediation: { powershellScript: string };
          scriptDiff: string;
          synthesizedElements: Array<{ blocks: Array<{ kind: string; diff?: string; title?: string }> }>;
          subAgentTasks: Array<{ stepIndex: number; tokensUsed?: number; tokensPrompt?: number; tokensCompletion?: number; source?: string; modelId: string }>;
          drawer: { powershellScript: string; steering?: { digest: string; version: number }; verificationStatus: { verdict: string } } | null;
          coder: { tokensUsed: number; source: string };
          telemetry: { tokensUsed: { prompt: number; completion: number; total: number }; endpoint: string; provider: string };
        };
        try {
          const res = await app.request(`/api/tickets/${entry.scenarioId}/steer`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clarifier: { [strategyQ.id]: RECOVER } }),
          });
          expect(res.status).toBe(200);
          recovered = (await res.json()) as typeof recovered;
        } finally {
          enabledSpy.mockRestore();
          chatSpy.mockRestore();
        }
        // Exactly one Wonder call, fed the typed contract and the diff base.
        expect(seen).toHaveLength(1);
        const prompt = seen[0]!;
        expect((prompt.steering as { remediationStrategy: { value: string } }).remediationStrategy.value).toBe("recover");
        expect(String(prompt.previousScript)).toContain("-InRemovedState");

        // The script, the diff, the card and the drawer agree.
        expect(recovered.steering.version).toBe(2);
        expect(recovered.previousVersion).toBe(1);
        expect(recovered.customRemediation.powershellScript).toContain("Undo-AzKeyVaultRemoval");
        expect(recovered.customRemediation.powershellScript).not.toContain("Remove-AzKeyVault -VaultName $Target -Location $Location -InRemovedState");
        expect(recovered.scriptDiff).toContain("+  Undo-AzKeyVaultRemoval");
        expect(recovered.scriptDiff).toContain("-  Remove-AzKeyVault");
        const diffBlock = recovered.synthesizedElements[0]!.blocks.find((b) => b.kind === "config-diff")!;
        expect(diffBlock.title).toBe("Remediation Script · steering v2");
        expect(diffBlock.diff).toBe(recovered.scriptDiff);
        expect(recovered.drawer).not.toBeNull();
        expect(recovered.drawer!.powershellScript).toContain("Undo-AzKeyVaultRemoval");
        expect(recovered.drawer!.powershellScript).not.toContain("Remove-AzKeyVault -VaultName $Target -Location $deleted.Location -InRemovedState -Force");
        expect(recovered.drawer!.steering).toEqual({ version: 2, digest: recovered.steering.digest });
        expect(recovered.drawer!.verificationStatus.verdict).not.toBe("Pending");
        expect(remediationStore.get(staged.remediationId)?.powershellScript).toContain("Undo-AzKeyVaultRemoval");

        // Telemetry: the steer call shows up with the real token split, on the S4 record and on the bus.
        const s4 = recovered.subAgentTasks.find((t) => t.stepIndex === 4)!;
        expect(s4).toMatchObject({ source: "llm", tokensUsed: 1555, tokensPrompt: 1234, tokensCompletion: 321 });
        expect(recovered.coder).toMatchObject({ tokensUsed: 1555, source: "llm" });
        expect(recovered.telemetry).toMatchObject({ endpoint: "/api/tickets/steer", provider: "meta", tokensUsed: { prompt: 1234, completion: 321, total: 1555 } });
        expect(telemetry.recent(5).some((e) => e.endpoint === "/api/tickets/steer")).toBe(true);
        expect(telemetry.recent(50).length).toBeGreaterThanOrEqual(before);
        expect(getCustomScenario(entry.scenarioId)?.steering?.version).toBe(2);
      } finally {
        remediationStore.clear(entry.scenarioId);
        clearCustomTickets("unscripted");
      }
    });
  }, 40000);

  test("a lens row click narrows the fix to that resource and is recorded as row-click steering", async () => {
    const { app } = await import("../app.ts");
    await quiet(async () => {
      const entry = registerCustomTicket({ ...KV_TICKET, title: "Row click steering sample: a Key Vault soft-delete conflict", body: KV_TICKET.body.replace("kv-contoso-fin-02", "kv-contoso-fin-07") });
      try {
        const res = await app.request(`/api/tickets/${entry.scenarioId}/steer`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rowClick: { key: "targetResource", value: "kv-contoso-fin-07", label: "kv-contoso-fin-07 · soft-deleted" } }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { steering: SteeringParams; customRemediation: { powershellScript: string; affectedEntities: Array<{ id: string }> } };
        expect(body.steering.targetResource).toMatchObject({ value: "kv-contoso-fin-07", source: "row-click" });
        expect(body.customRemediation.powershellScript).toContain('$Target = "kv-contoso-fin-07"');
        expect(body.customRemediation.affectedEntities[0]?.id).toBe("kv-contoso-fin-07");
      } finally {
        clearCustomTickets("unscripted");
      }
    });
  });

  test("a built-in scenario cannot be steered (404), an unknown id is rejected", async () => {
    const { app } = await import("../app.ts");
    const res = await app.request("/api/tickets/INC-4092/steer", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { dryRun: true } }) });
    expect(res.status).toBe(404);
  });
});
