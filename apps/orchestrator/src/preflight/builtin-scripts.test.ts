import { describe, expect, test } from "bun:test";
import { PREFLIGHT_RULES, SCENARIO_IDS, SteeringParamsSchema, isHardPreflightFinding } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext } = await import("../mcp/context.ts");
const { buildRemediationPlan } = await import("../local/remediate.ts");
const { buildInverseRollback } = await import("../local/formal-verifier.ts");
const { buildCustomTicketRemediationSync, steeredAllowedCommands } = await import("../local/subagent-orchestrator.ts");
const { SAMPLE_UNSCRIPTED_TICKETS } = await import("../local/custom-ticket.ts");
const { executionSurfaceCheck, textScanFindings } = await import("./local.ts");
const { EVAL_CASES } = await import("../../evals/cases.ts");

/**
 * Every script the deterministic engine stages (built-in scenario fixes, their inverses and the
 * custom-ticket fallback templates) must pass the execution-surface denials the merged rule set adds
 * (Set-AzContext, Invoke-Command, aliases, .NET calls, REST targets). This is the no-pwsh path the
 * pre-flight takes, so it runs everywhere; the allow-list half needs a real AST parse and is covered by
 * the pwsh-gated tests in local/remediate.test.ts. The executor preamble runScriptText prepends is not
 * part of any of these scripts and is never pre-flighted.
 */
function hardFindings(script: string): string[] {
  return executionSurfaceCheck(script).filter(isHardPreflightFinding);
}

describe("built-in scripts pass the merged pre-flight rules", () => {
  test("scenario fixes and their inverse rollbacks", async () => {
    const failures: string[] = [];
    for (const id of SCENARIO_IDS) {
      const plan = buildRemediationPlan(await gatherContext(id, { fresh: true }));
      for (const [label, script] of [
        [`${id} forward`, plan.bundle.powershellScript],
        [`${id} inverse`, buildInverseRollback(id).powershellScript],
      ] as const) {
        if (!script.trim()) continue;
        for (const f of hardFindings(script)) failures.push(`${label}: ${f}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("custom-ticket fallback templates, with and without a steered strategy", () => {
    const failures: string[] = [];
    for (const ticket of SAMPLE_UNSCRIPTED_TICKETS) {
      for (const answers of [{}, { q3: "Recover the old vault" }, { q3: "Permanently purge then recreate" }] as Array<Record<string, string>>) {
        const t = buildCustomTicketRemediationSync({ scenarioId: "CUSTOM-TEST01", ticketTitle: ticket.title, ticketBody: ticket.body, clarifiedAnswers: answers });
        for (const [label, script] of [
          [`${ticket.id} fix`, t.powershellScript],
          [`${ticket.id} rollback`, t.rollbackScript],
        ] as const) {
          for (const f of hardFindings(script)) failures.push(`${label}: ${f}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

/**
 * The command allow-list (review C1): every script the repository stages passes it with its own contract
 * only. A forward fix gets its scenario's or strategy's steered commands, an inverse rollback gets the
 * inverse contract, and nothing gets the privileged commands for free. Checked on the text scan here (no
 * pwsh needed); the pwsh-gated test in local/remediate.test.ts runs the same contracts through the AST.
 */
describe("built-in scripts pass the command allow-list with their own contract", () => {
  const now = new Date().toISOString();
  const steering = (strategy?: string) =>
    SteeringParamsSchema.parse({ version: 1, digest: "t", updatedAt: now, ...(strategy ? { remediationStrategy: { value: strategy, source: "operator", setAt: now } } : {}), answers: {} });

  test("scenario fixes with their steered commands, inverses with the inverse contract", async () => {
    const failures: string[] = [];
    for (const id of SCENARIO_IDS) {
      const plan = buildRemediationPlan(await gatherContext(id, { fresh: true }));
      for (const f of textScanFindings(plan.bundle.powershellScript, plan.requiredCommands, plan.allowedCommands ?? []).filter(isHardPreflightFinding)) failures.push(`${id} forward: ${f}`);
      const inverse = buildInverseRollback(id).powershellScript;
      if (inverse.trim()) for (const f of textScanFindings(inverse, [], PREFLIGHT_RULES.inverseCommands).filter(isHardPreflightFinding)) failures.push(`${id} inverse: ${f}`);
    }
    expect(failures).toEqual([]);
  });

  test("custom-ticket templates under every strategy, with the steered contract", () => {
    const failures: string[] = [];
    for (const ticket of [...SAMPLE_UNSCRIPTED_TICKETS, ...EVAL_CASES]) {
      for (const strategy of [undefined, "recover", "purge-recreate", "in-place", "gitops-bundle"]) {
        const input = { ticketTitle: ticket.title, ticketBody: ticket.body, clarifiedAnswers: ("answers" in ticket ? ticket.answers : undefined) ?? {}, steering: steering(strategy) };
        const t = buildCustomTicketRemediationSync({ scenarioId: "CUSTOM-TEST01", ...input });
        for (const f of textScanFindings(t.powershellScript, t.requiredCommands ?? [], steeredAllowedCommands(input)).filter(isHardPreflightFinding)) failures.push(`${ticket.id} ${strategy ?? "-"} fix: ${f}`);
        for (const f of textScanFindings(t.rollbackScript, [], PREFLIGHT_RULES.inverseCommands).filter(isHardPreflightFinding)) failures.push(`${ticket.id} ${strategy ?? "-"} rollback: ${f}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("without its steered contract a privileged fix fails: the allow-list alone grants nothing privileged", async () => {
    const plan = buildRemediationPlan(await gatherContext("ANOM-APP-401", { fresh: true }));
    const findings = textScanFindings(plan.bundle.powershellScript, [], []).filter(isHardPreflightFinding);
    expect(findings.some((f) => f.startsWith("Privileged command outside the steered contract"))).toBe(true);
  });
});
