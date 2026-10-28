import { describe, expect, test } from "bun:test";
import type { ScenarioBrief } from "@contextpane/catalog";
import { cleanBriefCopy } from "./brief.ts";
import { buildDeterministicRoutingDecision, cleanRoutingCopy } from "./dynamic-catalog.ts";

/** WP8: slug cleanup runs once at the orchestrator boundary instead of per component in the web app. */
describe("slug cleanup at the orchestrator boundary", () => {
  test("cleanBriefCopy cleans summary, steps, signals, rationale, sub-agent summaries and questions", () => {
    const brief = {
      summary: "Gatekeeper flagged element_not_existent; see data/dynamic-catalog.json",
      steps: [{ id: "s1", category: "azure", title: "Fix vm_quota_exceeded", detail: "Answered by muse-wonder-1.0 for repo:contoso/app:pull_request.", target: "SynthesizedDynamicCard" }],
      signals: [{ label: "license_pool_exhausted", value: "SPE_E5 · 0 seats", category: "licensing", source: "mcp-msgraph" }],
      extraction: { rationale: "intent nsg_rule_drift", intents: [], entities: [], components: [], tenantId: "t", baseScenarioId: null },
      subAgentTasks: [{ inputSummary: "ticket_body", outputSummary: "3 plan_steps" }],
      clarifyingQuestions: [{ id: "q1", question: "Which target_environment?", options: [] }],
      body: "raw customer text keeps element_not_existent as typed",
    } as unknown as ScenarioBrief;
    const out = cleanBriefCopy(brief);
    expect(out.summary).toBe("Gatekeeper flagged custom diagnostic view; see custom view catalog");
    expect(out.steps[0]!.title).toBe("Fix VM Quota Exceeded");
    expect(out.steps[0]!.detail).toBe("Answered by live analyzer for repo:contoso/app:pull_request.");
    expect(out.signals[0]!.label).toBe("License Pool Exhausted");
    expect(out.signals[0]!.value).toBe("SPE_E5 · 0 seats");
    expect(out.extraction!.rationale).toBe("intent NSG Rule Drift");
    expect(out.subAgentTasks![0]!.inputSummary).toBe("Ticket Body");
    expect(out.clarifyingQuestions![0]!.question).toBe("Which Target Environment?");
    expect(out.body).toBe(brief.body);
    // Idempotent: a second pass (or the web re-export) changes nothing.
    expect(cleanBriefCopy(out)).toEqual(out);
  });

  test("cleanRoutingCopy cleans the synthesized plan copy", () => {
    const decision = buildDeterministicRoutingDecision({ title: "Key vault soft_delete blocks recreate", body: "kv purge_protection on", matchedSeededComponents: [] });
    const cleaned = cleanRoutingCopy(decision);
    expect(cleaned.customBrief.summary).toContain("Soft Delete");
    expect(cleaned.customBrief.summary).not.toContain("purge_protection");
    expect(cleaned.missingElements).toEqual(decision.missingElements);
  });
});
