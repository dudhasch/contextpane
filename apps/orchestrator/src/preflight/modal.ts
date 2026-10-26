import type { VerificationStatus } from "@contextpane/catalog";
import { config } from "../config.ts";
import type { PreflightInput } from "./local.ts";

/**
 * Modal sandbox client. POSTs the bundle to the deployed web endpoint in
 * modal-sandbox/contextpane_sandbox.py, which runs the same AST + terraform
 * checks inside an isolated container and returns a VerificationStatus-shaped
 * JSON document.
 */

interface ModalResponse {
  astCheckPassed: boolean | null;
  terraformFmtPassed: boolean | null;
  terraformValidatePassed: boolean | null;
  findings?: string[];
  sandboxLatencyMs?: number;
}

export function modalConfigured(): boolean {
  return config.modal.enabled && config.modal.url !== "";
}

export async function runModalPreflight(input: PreflightInput, timeoutMs = 60_000): Promise<VerificationStatus> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(config.modal.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.modal.token ? { authorization: `Bearer ${config.modal.token}` } : {}),
      },
      body: JSON.stringify({
        powershellScript: input.powershellScript,
        terraformDiff: input.terraformDiff,
        actualHcl: input.actualHcl,
        expectedHcl: input.expectedHcl,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Modal sandbox HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const json = (await response.json()) as ModalResponse;
    const findings = json.findings ?? [];
    const hardFail = json.astCheckPassed === false || json.terraformFmtPassed === false || json.terraformValidatePassed === false;
    const skipped = json.astCheckPassed === null || json.terraformFmtPassed === null || json.terraformValidatePassed === null;
    return {
      verdict: hardFail ? "Verification Failed" : skipped || findings.length ? "Verified With Warnings" : "Verified Safe",
      astCheckPassed: json.astCheckPassed,
      terraformFmtPassed: json.terraformFmtPassed,
      terraformValidatePassed: json.terraformValidatePassed,
      sandboxProvider: "modal",
      validationLatencyMs: Math.round(performance.now() - started),
      findings,
    };
  } finally {
    clearTimeout(timer);
  }
}
