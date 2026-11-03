import { evaluatePreflightRules, isHardPreflightFinding, type VerificationStatus } from "@contextpane/catalog";
import { config } from "../config.ts";
import { PREFLIGHT_NOT_RUN_FINDING, executionSurfaceCheck, textScanFindings, type PreflightInput } from "./local.ts";

/**
 * Modal sandbox client (Tier 3B). POSTs the bundle to the validate_remediation
 * web endpoint in modal-sandbox/contextpane_sandbox.py, which runs the same AST +
 * terraform checks inside an isolated container and returns a
 * VerificationStatus-shaped JSON document.
 */

interface ModalResponse {
  VerifiedSafe?: boolean;
  astCheckPassed: boolean | null;
  terraformFmtPassed: boolean | null;
  terraformValidatePassed: boolean | null;
  sandboxProvider?: string;
  validationLatencyMs?: number;
  findings?: string[];
  checkLatencyMs?: { powershellAst?: number; terraformFmt?: number; terraformValidate?: number };
  /** AST command names and execution surface; an older deployment sends neither and the text scan applies. */
  commands?: string[];
  functions?: string[];
  surface?: unknown;
}

export function modalConfigured(): boolean {
  return config.modal.enabled && config.modal.url !== "";
}

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(config.modal.token ? { authorization: `Bearer ${config.modal.token}` } : {}),
  };
}

/** The container scales down after 300 idle s; re-ping well inside that window. */
const WARM_INTERVAL_MS = 60_000;
let warmInFlight: Promise<void> | null = null;
let lastWarmAt = 0;

/**
 * Fire-and-forget `{ warmup: true }`: Modal boots a container (persistent pwsh, hot
 * terraform) before the operator clicks Generate Fix, so the pre-flight runs warm.
 * Concurrent and recent calls collapse into one ping.
 */
export function warmModalSandbox(reason: string): void {
  if (!modalConfigured() || warmInFlight || Date.now() - lastWarmAt < WARM_INTERVAL_MS) return;
  const started = performance.now();
  warmInFlight = fetch(config.modal.url, { method: "POST", headers: authHeaders(), body: JSON.stringify({ warmup: true }), signal: AbortSignal.timeout(120_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { bootMs?: number };
      lastWarmAt = Date.now();
      console.log(`  [modal] sandbox warm (${reason}) in ${Math.round(performance.now() - started)} ms${json.bootMs ? `, container boot ${json.bootMs} ms` : ""}`);
    })
    .catch((error) => console.warn(`  [modal] warm-up ping failed (${reason}): ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      warmInFlight = null;
    });
}

/** Resolves once an in-flight warm-up ping has finished (immediately when none is running). */
export async function modalWarm(): Promise<void> {
  await warmInFlight;
}

export async function runModalPreflight(input: PreflightInput, timeoutMs = 60_000): Promise<VerificationStatus> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(config.modal.url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        powershellScript: input.powershellScript,
        terraformDiff: input.terraformDiff,
        actualHcl: input.actualHcl,
        expectedHcl: input.expectedHcl,
        ...(input.requiredCommands ? { requiredCommands: input.requiredCommands } : {}),
        ...(input.allowedCommands?.length ? { allowedCommands: input.allowedCommands } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Modal sandbox HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const json = (await response.json()) as ModalResponse;
    lastWarmAt = Date.now();
    console.log(`  [modal] pre-flight round trip ${Math.round(performance.now() - started)} ms (sandbox ${json.validationLatencyMs ?? "?"} ms)`);
    const required = input.requiredCommands ?? [];
    const findings = [...(json.findings ?? [])];
    const astRan = json.astCheckPassed !== null && Array.isArray(json.commands);
    if (astRan) {
      // The shared rules and the execution-surface rules run here too, on the sandbox's AST report, so an older
      // deployment with older lists cannot pass what the orchestrator's rule file refuses.
      const ruleFindings = evaluatePreflightRules(json.commands!, input.powershellScript, required, { allow: input.allowedCommands ?? [], definedFunctions: json.functions ?? [] });
      const surfaceFindings = executionSurfaceCheck(input.powershellScript, { commands: json.commands!, surface: json.surface });
      for (const f of [...ruleFindings, ...surfaceFindings]) if (!findings.includes(f)) findings.push(f);
      if (findings.some(isHardPreflightFinding)) json.astCheckPassed = false;
    } else {
      // The sandbox's AST did not run (timeout, older deployment without a report): the bundle fails, and the
      // text scan still says what the rules see.
      findings.unshift(PREFLIGHT_NOT_RUN_FINDING);
      for (const f of textScanFindings(input.powershellScript, required, input.allowedCommands ?? [])) findings.push(`${f} (text scan)`);
      if (json.astCheckPassed !== false) json.astCheckPassed = null;
    }
    const hardFail = !astRan || json.astCheckPassed !== true || json.terraformFmtPassed === false || json.terraformValidatePassed === false;
    const hasIac = input.terraformDiff.trim() !== "";
    const skipped = json.astCheckPassed === null || (hasIac && (json.terraformFmtPassed === null || json.terraformValidatePassed === null));
    return {
      verdict: hardFail ? "Verification Failed" : skipped || findings.length ? "Verified With Warnings" : "Verified Safe",
      astCheckPassed: json.astCheckPassed,
      terraformFmtPassed: json.terraformFmtPassed,
      terraformValidatePassed: json.terraformValidatePassed,
      sandboxProvider: "modal-cloud-sandbox",
      whatIfSafe: null,
      validationLatencyMs: Math.round(performance.now() - started),
      findings,
      ...(typeof json.validationLatencyMs === "number" ? { sandboxLatencyMs: Math.round(json.validationLatencyMs) } : {}),
      ...(json.checkLatencyMs ? { checkLatencyMs: json.checkLatencyMs } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
