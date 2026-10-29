import { describe, expect, test } from "bun:test";
import { AbacGuardError, abacCondition, abacExpression, assertAbacLabSubscription } from "@contextpane/mcp-azure-iac";
import { checkPowerShellAst, checkWhatIfSafety } from "../preflight/local.ts";
import { ABAC_CONTAINER_QID, ABAC_STRATEGY, ABAC_STRATEGY_QID, abacChoiceFromAnswers, abacClarifyingQuestions, abacScriptExpectations, buildAbacRemediationSync, isAbacTicketText } from "./abac.ts";
import { LAB_INCIDENT_TICKETS } from "./erp-drop-generator.ts";

const abacTickets = LAB_INCIDENT_TICKETS.filter((t) => isAbacTicketText(`${t.subject}\n${t.description}`));

describe("ABAC scenario", () => {
  test("exactly the two Act II tickets are ABAC tickets, and the first names no resource", () => {
    expect(abacTickets.map((t) => t.incidentId)).toEqual(["INC-2026-88564", "INC-2026-88571"]);
    expect(abacTickets[0]!.description).toContain("ABAC RBAC condition");
    expect(abacTickets[0]!.description).not.toMatch(/stcontoso|payroll-drop|20505597|rg-contoso/);
  });

  test("the guard refuses every subscription but the lab", () => {
    expect(() => assertAbacLabSubscription("f57476fa-4c76-4d49-b4a7-43f9d07be63d")).toThrow(AbacGuardError);
    expect(() => assertAbacLabSubscription("20505597-043c-4742-a884-42dc3f621aef")).not.toThrow();
  });

  test("the condition carries the container expression in the canonical ActionMatches form", () => {
    const c = abacCondition("payroll-drop");
    expect(c).toContain(abacExpression("payroll-drop"));
    expect(c).toContain("@Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringEqualsIgnoreCase 'payroll-drop'");
    expect(c.startsWith("((!(ActionMatches{")).toBe(true);
    expect((c.match(/\(/g) ?? []).length).toBe((c.match(/\)/g) ?? []).length);
  });

  test("the clarifier defaults to the requester's ask and the pills steer to a conditioned grant", () => {
    const qs = abacClarifyingQuestions();
    expect(qs.map((q) => q.id)).toEqual([ABAC_STRATEGY_QID, ABAC_CONTAINER_QID]);
    expect(abacChoiceFromAnswers({ [ABAC_STRATEGY_QID]: qs[0]!.selectedValue!, [ABAC_CONTAINER_QID]: qs[1]!.selectedValue! })).toEqual({ strategy: "exemption", container: null });
    expect(abacChoiceFromAnswers({ [ABAC_STRATEGY_QID]: "Inject ABAC condition", [ABAC_CONTAINER_QID]: "payroll-drop" })).toEqual({ strategy: "condition", container: "payroll-drop" });
    // What the UI actually sends: the option label, or a title-cased display form of it.
    for (const sent of ["payroll-drop container", "Payroll Drop", "opt-container-payroll-drop"]) {
      expect(abacChoiceFromAnswers({ [ABAC_STRATEGY_QID]: "Inject ABAC condition", [ABAC_CONTAINER_QID]: sent }).container).toBe("payroll-drop");
    }
  });

  test("the conditioned bundle passes the AST allow-list and the -WhatIf proof", async () => {
    const bundle = buildAbacRemediationSync({ scenarioId: "ERP-202688564", clarifiedAnswers: { [ABAC_STRATEGY_QID]: ABAC_STRATEGY.condition, [ABAC_CONTAINER_QID]: "payroll-drop" } });
    for (const token of abacScriptExpectations({ strategy: "condition", container: "payroll-drop" })) expect(bundle.powershellScript).toContain(token);
    expect(bundle.terraformDiff).toContain('condition_version    = "2.0"');
    expect(checkWhatIfSafety(bundle.powershellScript).safe).toBe(true);
    const ast = await checkPowerShellAst(bundle.powershellScript, 30_000, bundle.requiredCommands);
    if (ast.passed !== null) expect(ast.findings.filter((f) => !/Empty target/.test(f))).toEqual([]);
  });

  test("the exemption bundle is what the ticket asked for", () => {
    const bundle = buildAbacRemediationSync({ scenarioId: "ERP-202688564", clarifiedAnswers: {} });
    expect(bundle.powershellScript).toContain("New-AzPolicyExemption");
    expect(bundle.powershellScript).not.toContain("-Condition");
  });
});
