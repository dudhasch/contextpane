import { config } from "../config.ts";

/**
 * The identity an approved PowerShell script runs as. Free-form scripts no longer inherit the
 * engineer's saved Az / Graph sign-in by default: they connect as a dedicated least-privilege
 * identity first and check that the connected account is that identity before anything else runs.
 *
 *  - service-principal: CTX_EXECUTOR_CLIENT_ID + CTX_EXECUTOR_TENANT_ID + CTX_EXECUTOR_CERT_THUMBPRINT
 *    (certificate in the local store; no secret in the environment).
 *  - managed-identity:  CTX_EXECUTOR_MANAGED_IDENTITY=true on a host that has one.
 *  - delegated:         CTX_EXECUTOR_ALLOW_DELEGATED=true keeps the legacy behaviour (the engineer's context).
 *  - none:              nothing configured; free-form execution is refused.
 */

export type ExecutorMode = "service-principal" | "managed-identity" | "delegated" | "none";

export interface ExecutorSettings {
  clientId: string;
  tenantId: string;
  certificateThumbprint: string;
  managedIdentity: boolean;
  allowDelegated: boolean;
}

export interface ExecutorIdentity {
  mode: ExecutorMode;
  /** Shown in the execution log and the audit entry. */
  label: string;
  /** Why the configured identity is unusable (bad GUID, missing thumbprint); empty when it is usable. */
  issues: string[];
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THUMBPRINT_RE = /^[0-9a-f]{40}$/i;

export const EXECUTOR_REFUSAL =
  "Refusing to execute: no executor identity is configured. Set CTX_EXECUTOR_CLIENT_ID, CTX_EXECUTOR_TENANT_ID and CTX_EXECUTOR_CERT_THUMBPRINT (a least-privilege service principal) or CTX_EXECUTOR_MANAGED_IDENTITY=true, or CTX_EXECUTOR_ALLOW_DELEGATED=true to run as your own signed-in context as before.";

export function resolveExecutorIdentity(settings: ExecutorSettings = config.executor): ExecutorIdentity {
  const anySp = Boolean(settings.clientId || settings.tenantId || settings.certificateThumbprint);
  if (anySp) {
    const issues: string[] = [];
    if (!GUID_RE.test(settings.clientId)) issues.push("CTX_EXECUTOR_CLIENT_ID is not a GUID");
    if (!GUID_RE.test(settings.tenantId)) issues.push("CTX_EXECUTOR_TENANT_ID is not a GUID");
    if (!THUMBPRINT_RE.test(settings.certificateThumbprint)) issues.push("CTX_EXECUTOR_CERT_THUMBPRINT is not a 40-character hex thumbprint");
    return { mode: issues.length ? "none" : "service-principal", label: `service principal ${settings.clientId || "?"}`, issues };
  }
  if (settings.managedIdentity) return { mode: "managed-identity", label: "host managed identity", issues: [] };
  if (settings.allowDelegated) return { mode: "delegated", label: "delegated sign-in (legacy, CTX_EXECUTOR_ALLOW_DELEGATED)", issues: [] };
  return { mode: "none", label: "none", issues: [] };
}

/** The refusal line for an unusable identity, or null when scripts may run. */
export function executorRefusal(identity: ExecutorIdentity): string | null {
  if (identity.mode !== "none") return null;
  return identity.issues.length ? `Refusing to execute: the executor identity is misconfigured (${identity.issues.join("; ")}).` : EXECUTOR_REFUSAL;
}

/**
 * PowerShell that connects as the executor identity for this process only and stops unless the
 * connected Az and Graph contexts are that identity on the lab subscription. Every value it
 * interpolates was validated above (GUIDs, hex thumbprint), so nothing script-shaped reaches it.
 */
export function executorPrelude(identity: ExecutorIdentity, lab: { subscriptionId: string; tenantId: string }, settings: ExecutorSettings = config.executor): string {
  const sub = lab.subscriptionId;
  const pinLab = [
    `if ((Get-AzContext).Subscription.Id -ne '${sub}') { throw 'Refusing to execute outside the lab subscription' }`,
  ];
  switch (identity.mode) {
    case "service-principal":
      return [
        "$ErrorActionPreference = 'Stop'",
        "$null = Disable-AzContextAutosave -Scope Process",
        `$null = Connect-AzAccount -ServicePrincipal -ApplicationId '${settings.clientId}' -Tenant '${settings.tenantId}' -CertificateThumbprint '${settings.certificateThumbprint}' -Subscription '${sub}' -Scope Process`,
        `if ((Get-AzContext).Account.Id -ne '${settings.clientId}') { throw 'Refusing to execute: the Az context is not the executor service principal' }`,
        `Connect-MgGraph -ClientId '${settings.clientId}' -TenantId '${settings.tenantId}' -CertificateThumbprint '${settings.certificateThumbprint}' -NoWelcome`,
        `if ((Get-MgContext).ClientId -ne '${settings.clientId}' -or "$((Get-MgContext).AuthType)" -ne 'AppOnly') { throw 'Refusing to execute: the Graph context is not the executor service principal' }`,
        ...pinLab,
      ].join("\n");
    case "managed-identity":
      return [
        "$ErrorActionPreference = 'Stop'",
        "$null = Disable-AzContextAutosave -Scope Process",
        `$null = Connect-AzAccount -Identity -Subscription '${sub}' -Scope Process`,
        `if ("$((Get-AzContext).Account.Type)" -ne 'ManagedService') { throw 'Refusing to execute: the Az context is not the managed identity' }`,
        "Connect-MgGraph -Identity -NoWelcome",
        `if ("$((Get-MgContext).AuthType)" -ne 'ManagedIdentity') { throw 'Refusing to execute: the Graph context is not the managed identity' }`,
        ...pinLab,
      ].join("\n");
    case "delegated":
      // Legacy: select the lab subscription from the engineer's saved contexts for this process.
      return [
        `$__ctxLab = Get-AzContext -ListAvailable | Where-Object { $_.Subscription -and $_.Subscription.Id -eq '${sub}' -and $_.Tenant.Id -eq '${lab.tenantId}' } | Select-Object -First 1`,
        `if (-not $__ctxLab) { throw 'Refusing to execute: the lab subscription ${sub} is not signed in' }`,
        "$null = Set-AzContext -Context $__ctxLab -Scope Process",
        ...pinLab,
      ].join("\n");
    case "none":
      return "throw 'Refusing to execute: no executor identity is configured'";
  }
}
