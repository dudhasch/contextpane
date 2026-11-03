import { describe, expect, test } from "bun:test";
import { SCENARIO_IDS, isHardPreflightFinding } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext } = await import("../mcp/context.ts");
const { buildRemediationPlan } = await import("../local/remediate.ts");
const { buildInverseRollback } = await import("../local/formal-verifier.ts");
const { buildCustomTicketRemediationSync } = await import("../local/subagent-orchestrator.ts");
const { SAMPLE_UNSCRIPTED_TICKETS } = await import("../local/custom-ticket.ts");
const { executionSurfaceCheck } = await import("./local.ts");

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
