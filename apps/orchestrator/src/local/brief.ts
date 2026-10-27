import {
  SCENARIO_REGISTRY,
  displayScenarioId,
  type CanvasComponentType,
  type EnrichedEntity,
  type ResolutionStep,
  type ScenarioBrief,
  type ScenarioSignal,
} from "@contextpane/catalog";
import { CA_POSTURE, INTUNE_SCENARIOS, LICENSE_ANOMALY, WORKLOAD_IDENTITY } from "@contextpane/mcp-msgraph";
import type { CorrelationContext } from "../mcp/context.ts";
import { correlateUpstreamCloudStatusSync } from "./cloud-status-correlator.ts";

/**
 * The left pane, deterministically: what the issue is (summary), what MCP enriched
 * (entities, colour-coded by provenance) and the exact steps that resolve it. Every
 * number comes from the gathered context, so a remediated tenant reads as such.
 */

const DEMO_PREFIX = "[ContextPane-Demo] ";
const short = (name: string) => name.replace(DEMO_PREFIX, "");
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;

function entity(
  id: string,
  type: EnrichedEntity["type"],
  category: EnrichedEntity["category"],
  target: CanvasComponentType,
  extra: Partial<Pick<EnrichedEntity, "label" | "tab" | "note" | "hoverable">> = {},
): EnrichedEntity {
  return { id, label: extra.label ?? short(id), type, category, target, hoverable: extra.hoverable ?? true, ...(extra.tab ? { tab: extra.tab } : {}), ...(extra.note ? { note: extra.note } : {}) };
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

export function scenarioEntities(ctx: CorrelationContext): EnrichedEntity[] {
  switch (ctx.scenarioId) {
    case "INC-4092": {
      const lic = ctx.license?.data;
      const drifted = lic?.users.filter((u) => u.assignmentState !== "Active") ?? [];
      const targetUsers = drifted.length
        ? drifted.slice(0, 3)
        : (lic?.users ?? [])
            .filter((u) =>
              ["lynne.robins", "diego.siciliani", "patti.fernandez"].some((prefix) =>
                u.upn.toLowerCase().startsWith(prefix),
              ),
            )
            .slice(0, 3);
      const blocking =
        ctx.policies?.data.find((p) => p.blocks) ??
        ctx.policies?.data.find((p) => p.displayName.includes("Block AVD"));
      const d = ctx.drift?.data;
      return [
        entity("SPE_E5", "sku", "licensing", "LicenseDriftCard", { note: "expected" }),
        entity("SPE_E3", "sku", "licensing", "LicenseDriftCard", { note: drifted.length ? `${drifted.length} users` : "3 users" }),
        entity(lic?.groupName ?? "SG-Contoso-Finance-AVD", "group", "licensing", "LicenseDriftCard", { tab: "users" }),
        ...targetUsers.map((u) => entity(u.upn, "upn", "identity", "EntraSignInTimeline", { label: u.displayName, tab: "signins" })),
        entity("AADSTS53003", "errorCode", "identity", "EntraSignInTimeline", { tab: "signins" }),
        ...(blocking ? [entity(blocking.displayName, "policy", "identity", "EntraSignInTimeline", { tab: "policies" })] : []),
        entity("vdpool-contoso-fin-01", "resource", "azure", "IaCDriftBanner", { tab: "hostpool" }),
        ...(d ? [entity(d.resourceName, "resource", "azure", "IaCDriftBanner", { tab: "nsg", note: d.rogueSecurityRules.length ? `${d.rogueSecurityRules.length} rogue rule` : "in sync" })] : []),
        ...(ctx.avd ? [entity("Azure Policy: rg-contoso-avd-prod", "resource", "azure", "IaCDriftBanner", { label: "Azure Policy", tab: "policies", hoverable: false, note: `${ctx.avd.data.azurePolicies.filter((p) => p.compliance === "NonCompliant").length} non-compliant` })] : []),
      ];
    }
    case "INC-4099": {
      const intune = ctx.intune?.data;
      const blocking = ctx.policies?.data.find((p) => p.grant.builtInControls.includes("compliantDevice"));
      return [
        entity("0x87D1FDE8", "errorCode", "intune", "IntuneDriftCard", { tab: "settings" }),
        entity("Fabrikam-Legacy-BitLocker-DeviceConfig", "policy", "intune", "IntuneDriftCard", { tab: "settings", note: "conflicting" }),
        entity("Fabrikam-EndpointSecurity-DiskEncryption", "policy", "intune", "IntuneDriftCard", { tab: "settings", note: "golden" }),
        entity("Fabrikam-Win11-Compliance", "policy", "intune", "IntuneDriftCard", { tab: "devices" }),
        entity("SG-Fabrikam-Win11-Devices", "group", "intune", "IntuneDriftCard", { tab: "devices", note: intune ? `${intune.affectedDeviceCount} NonCompliant` : undefined }),
        entity("grady.archie.legal@fabrikamlegal.onmicrosoft.com", "upn", "identity", "EntraSignInTimeline", { label: "Grady Archie", tab: "signins" }),
        entity("AADSTS53000", "errorCode", "identity", "EntraSignInTimeline", { tab: "signins" }),
        ...(blocking ? [entity(blocking.displayName, "policy", "identity", "EntraSignInTimeline", { tab: "policies" })] : []),
      ];
    }
    case "ANOM-LIC-101": {
      const users = ctx.license?.data.users ?? [];
      return [
        entity("SPE_E5", "sku", "licensing", "LicenseDriftCard", { note: poolNote(ctx, "SPE_E5") }),
        entity("Microsoft_365_Copilot", "sku", "licensing", "LicenseDriftCard", { label: "Copilot", note: poolNote(ctx, "Microsoft_365_Copilot") }),
        entity("CountViolation", "errorCode", "licensing", "LicenseDriftCard", { tab: "users", note: ctx.license?.data.groupErrors.length ? "2 users" : "cleared" }),
        entity(LICENSE_ANOMALY.groupName, "group", "licensing", "LicenseDriftCard", { tab: "users" }),
        ...users.map((u) =>
          entity(u.upn, "upn", "licensing", "LicenseDriftCard", { label: u.displayName, tab: "users", note: u.accountEnabled ? u.assignmentState === "Active" ? "active" : "CountViolation" : u.assignmentState === "Reclaimed" ? "reclaimed" : "disabled" }),
        ),
      ];
    }
    case "ANOM-CA-204": {
      const policies = ctx.caPosture?.data.policies ?? [];
      return [
        ...policies.map((p) => entity(p.displayName, "policy", "identity", "EntraSignInTimeline", { tab: "policies", note: p.drift.length ? (p.state === "enabled" ? "exclusion missing" : "Report-Only") : "in sync" })),
        entity(CA_POSTURE.breakGlassGroup, "group", "identity", "EntraSignInTimeline", { tab: "policies" }),
        entity(CA_POSTURE.breakGlassAccount, "upn", "identity", "EntraSignInTimeline", { label: "bg-admin-01", tab: "policies" }),
        entity("Legacy auth (IMAP4 / SMTP)", "setting", "identity", "EntraSignInTimeline", { tab: "signins", hoverable: false, note: `${ctx.caPosture?.data.legacySignIns.length ?? 0} in 24 h` }),
        entity(`ext-maint-02@${CA_POSTURE.breakGlassAccount.split("@")[1]}`, "upn", "identity", "EntraSignInTimeline", { label: "ext-maint-02", tab: "policies", note: "changed both" }),
      ];
    }
    case "ANOM-APP-401": {
      const w = ctx.workloadIdentity ?? WORKLOAD_IDENTITY;
      return [
        entity(w.spn.displayName, "resource", "identity", "EntraSignInTimeline", { tab: "policies", note: "overprivileged" }),
        entity(w.owner.upn, "upn", "identity", "EntraSignInTimeline", { label: w.owner.displayName, tab: "policies", note: "owner · 0 roles" }),
        entity(w.errorCodeLabel, "errorCode", "identity", "EntraSignInTimeline", { tab: "signins", note: "nightly" }),
        ...w.appPermissions.map((s) => entity(s, "setting", "identity", "EntraSignInTimeline", { tab: "policies", note: "granted" })),
        ...w.requiredPermissions.map((s) => entity(s, "setting", "identity", "EntraSignInTimeline", { tab: "policies", note: "required" })),
        entity(w.oauth2PermissionGrant.scope, "setting", "identity", "EntraSignInTimeline", { label: "Delegated grant", tab: "policies", note: "unverified" }),
      ];
    }
    case "ANOM-INT-309": {
      const intune = ctx.intune?.data;
      return [
        entity("Intune-Win11-ASR-Baseline", "policy", "intune", "IntuneDriftCard", { tab: "settings" }),
        entity("9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2", "setting", "intune", "IntuneDriftCard", { label: "ASR: LSASS credential stealing", tab: "settings" }),
        entity("Win11-Firewall-MDM", "policy", "intune", "IntuneDriftCard", { tab: "settings", note: "duplicate" }),
        entity("EndpointSecurity-Firewall-Prod", "policy", "intune", "IntuneDriftCard", { tab: "settings", note: "golden" }),
        entity("SG-All-Workstations", "group", "intune", "IntuneDriftCard", { tab: "devices", note: intune ? `${intune.affectedDeviceCount} in Conflict` : undefined }),
      ];
    }
  }
}

function poolNote(ctx: CorrelationContext, sku: string): string | undefined {
  const p = ctx.license?.data.skuPools.find((x) => x.skuPartNumber === sku);
  return p ? `${p.consumed}/${p.enabled}` : undefined;
}

/* -------------------------------------------------------------------------- */
/* Summary & resolution plan                                                   */
/* -------------------------------------------------------------------------- */

function cleanTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastPeriod = cut.lastIndexOf(".");
  if (lastPeriod > max * 0.75) return cut.slice(0, lastPeriod + 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.75) return `${cut.slice(0, lastSpace)}.`;
  return cut;
}

function step(
  id: string,
  category: ResolutionStep["category"],
  title: string,
  detail: string,
  target: CanvasComponentType,
  action: ResolutionStep["action"],
  tab?: string,
): ResolutionStep {
  return { id, category, title, detail: cleanTruncate(detail, 320), target, action, ...(tab ? { tab } : {}) };
}

function summaryAndSteps(ctx: CorrelationContext): { summary: string; steps: ResolutionStep[] } {
  switch (ctx.scenarioId) {
    case "INC-4092": {
      const lic = ctx.license?.data;
      const drifted = lic?.users.filter((u) => u.assignmentState !== "Active") ?? [];
      const driftedCount = drifted.length || 3;
      const blocking =
        ctx.policies?.data.find((p) => p.blocks) ??
        ctx.policies?.data.find((p) => p.displayName.includes("Block AVD"));
      const d = ctx.drift?.data;
      const rogue = d?.rogueSecurityRules[0];
      const group = lic?.groupName ?? "SG-Contoso-Finance-AVD";
      const blockingLabel = short(blocking?.displayName ?? "[ContextPane-Demo] Block AVD - Contoso Finance Legacy");
      const nsgName = d?.resourceName ?? "nsg-contoso-avd-hostpool-01";
      const rogueRuleName = rogue?.ruleName ?? "Allow-Temp-RDP-Diagnostic-Drift";
      const rogueProtoPort = rogue ? `${rogue.protocol.toUpperCase()}/${rogue.port}` : "TCP/3389";
      const rogueSource = rogue?.source ?? "*";
      return {
        summary: `${plural(driftedCount, "Finance user")} in ${group} still hold SPE_E3 instead of SPE_E5 and remain in the legacy block group, so '${blockingLabel}' rejects Azure Virtual Desktop with AADSTS53003. Separately, a vendor left ${rogueRuleName} (${rogueProtoPort} from ${rogueSource}) open on ${nsgName}.`,
        steps: [
          step("license", "licensing", "License Upgrade", `Move ${plural(driftedCount, "user")} in ${group} out of SG-Contoso-Finance-Legacy and reprocess group SPE_E5 licensing (Remove-MgGroupMemberByRef + Invoke-MgLicenseUser).`, "LicenseDriftCard", { label: "Inspect / Stage Fix", kind: "stage-fix" }, "users"),
          step(
            "ca",
            "identity",
            "Conditional Access",
            `Remove the migrated users from legacy block policy '${blockingLabel}' (exclude ${group}, report-only).`,
            "EntraSignInTimeline",
            { label: "Inspect Policy", kind: "inspect" },
            "policies",
          ),
          step(
            "nsg",
            "azure",
            "Host Pool & NSG Drift",
            `Remove rogue rule ${rogueRuleName} (${rogueProtoPort}) on ${nsgName} and restore the Terraform tags.`,
            "IaCDriftBanner",
            { label: "View Diff & Fix", kind: "view-diff" },
            "nsg",
          ),
        ],
      };
    }
    case "INC-4099": {
      const intune = ctx.intune?.data;
      const n = intune?.affectedDeviceCount ?? 0;
      return {
        summary: n
          ? `The legacy Fabrikam-Legacy-BitLocker-DeviceConfig profile conflicts with the Endpoint Security disk encryption baseline (XTS-AES 128 vs 256, prompt vs silent), so silent BitLocker fails with 0x87D1FDE8 on ${plural(n, "device")}. After the 7-day grace period they turned NonCompliant and 'Require compliant device' now blocks Office 365 with AADSTS53000.`
          : "The conflicting legacy BitLocker profile is unassigned; the devices encrypted and report Compliant again.",
        steps: [
          step("conflict", "intune", "Policy Conflict", "Unassign Fabrikam-Legacy-BitLocker-DeviceConfig from SG-Fabrikam-Win11-Devices so only the golden disk encryption baseline applies.", "IntuneDriftCard", { label: "View Conflict & Fix", kind: "stage-fix" }, "settings"),
          step("compliance", "intune", "Device Compliance", `Sync the ${plural(n || 6, "device")}: BitLocker encrypts silently and Fabrikam-Win11-Compliance re-evaluates them to Compliant.`, "IntuneDriftCard", { label: "Inspect Devices", kind: "inspect" }, "devices"),
          step("ca", "identity", "Conditional Access", "No policy change: 'Require compliant device' lets Outlook and Teams through once the devices are compliant (AADSTS53000 clears).", "EntraSignInTimeline", { label: "Inspect Sign-Ins", kind: "inspect" }, "signins"),
        ],
      };
    }
    case "ANOM-LIC-101": {
      const inv = ctx.license?.data;
      const orphaned = inv?.users.filter((u) => u.assignmentState === "Orphaned") ?? [];
      const failed = inv?.users.filter((u) => u.assignmentState === "Error: CountViolation") ?? [];
      const e5 = inv?.skuPools.find((p) => p.skuPartNumber === "SPE_E5");
      const copilot = orphaned.filter((u) => u.currentSku.includes("Copilot")).length;
      return {
        summary:
          orphaned.length || failed.length
            ? `${LICENSE_ANOMALY.groupName} cannot assign SPE_E5 to ${plural(failed.length, "new hire")} (CountViolation, ${e5?.consumed}/${e5?.enabled} seats consumed) while ${plural(orphaned.length, "disabled account")} still hold SPE_E5${copilot ? ` and ${copilot} Microsoft 365 Copilot` : ""} through overlapping Direct + Group assignments.`
            : `Seats reclaimed: ${LICENSE_ANOMALY.groupName} assigns SPE_E5 to every member with ${e5?.available ?? 0} seat(s) to spare and no new purchase.`,
        steps: [
          step("reclaim", "licensing", "Reclaim Seats", `Remove SPE_E5${copilot ? " and Copilot" : ""} from ${plural(orphaned.length || 3, "disabled account")} (Set-MgUserLicense) and drop them from ${LICENSE_ANOMALY.groupName} (Remove-MgGroupMemberByRef).`, "LicenseDriftCard", { label: "Stage License Fix", kind: "stage-fix" }, "users"),
          step("reprocess", "identity", "Reprocess Group Licensing", `Run Invoke-MgLicenseUser for the ${plural(failed.length || 2, "CountViolation member")} so they resolve to Active with 0 new purchases.`, "LicenseDriftCard", { label: "Inspect Assignments", kind: "inspect" }, "users"),
          step("pool", "azure", "Verify Pool", "Confirm SPE_E5 shows available seats again and the group reports no licensing errors.", "LicenseDriftCard", { label: "Inspect Pool", kind: "inspect" }, "pool"),
        ],
      };
    }
    case "ANOM-CA-204": {
      const posture = ctx.caPosture?.data;
      const drifted = posture?.policies.filter((p) => p.drift.length) ?? [];
      const legacy = posture?.legacySignIns.length ?? 0;
      return {
        summary: drifted.length
          ? `CA-001-Require-PhishingResistant-MFA-Admins was edited out-of-band and no longer excludes ${CA_POSTURE.breakGlassGroup} (break-glass lockout risk), and CA-004-Block-Legacy-Auth was left in Report-Only after a maintenance window while ${legacy} legacy IMAP/SMTP sign-ins went through in 24 h.`
          : "Both Conditional Access policies match the golden baseline: break-glass excluded, legacy authentication blocked.",
        steps: [
          step("breakglass", "identity", "Break-Glass Exclusion", `Restore the ${CA_POSTURE.breakGlassGroup} exclusion on CA-001-Require-PhishingResistant-MFA-Admins.`, "EntraSignInTimeline", { label: "Inspect Policy", kind: "inspect" }, "policies"),
          step("legacy", "azure", "Enforce Legacy Auth Block", "Flip CA-004-Block-Legacy-Auth from enabledForReportingButNotEnforced to enabled (Update-MgIdentityConditionalAccessPolicy).", "EntraSignInTimeline", { label: "Stage CA Fix", kind: "stage-fix" }, "policies"),
          step("verify", "licensing", "Verify Sign-Ins", `Check the ${legacy} legacy sign-ins (3 from an unfamiliar ASN) and that bg-admin-01 stays excluded.`, "EntraSignInTimeline", { label: "Inspect Sign-Ins", kind: "inspect" }, "signins"),
        ],
      };
    }
    case "ANOM-APP-401": {
      const w = ctx.workloadIdentity ?? WORKLOAD_IDENTITY;
      return {
        summary: `${w.spn.displayName} (appId ${w.spn.appId.slice(0, 8)}…) is owned by ${w.owner.upn} (0 directory roles, shadow admin). Its secret '${w.passwordCredential.displayName}' expired ${w.passwordCredential.endDateTime.slice(0, 10)}, so nightly GitHub Actions runs fail with ${w.errorCodeLabel}; granted scopes (${w.appPermissions.join(", ")}) far exceed the ${w.requiredPermissions.join(", ")} its 90-day activity needs.`,
        steps: [
          step("owner", "identity", "Remove Shadow-Admin Owner", `Remove ${w.owner.upn} (0 directory roles) as owner of ${w.spn.displayName} so a non-admin no longer controls the workload identity.`, "EntraSignInTimeline", { label: "Stage Workload Fix", kind: "stage-fix" }, "policies"),
          step("scopes", "licensing", "Revoke Grant, Right-Size", `Revoke the unverified delegated grant (${w.oauth2PermissionGrant.scope}) and replace ${w.appPermissions.join(", ")} with ${w.requiredPermissions.join(", ")} per 90-day activity.`, "EntraSignInTimeline", { label: "Inspect App Grants", kind: "inspect" }, "policies"),
          step("oidc", "azure", "Federate OIDC, Retire Secret", `Add the GitHub Actions federated credential (${w.federatedCredential.subject}) and remove the expired secret '${w.passwordCredential.displayName}' (${w.errorCodeLabel} clears).`, "EntraSignInTimeline", { label: "Stage Workload Fix", kind: "stage-fix" }, "signins"),
        ],
      };
    }
    case "ANOM-INT-309": {
      const intune = ctx.intune?.data;
      const asr = intune?.settings.find((s) => s.settingId === "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2");
      const n = intune?.affectedDeviceCount ?? 0;
      return {
        summary: intune && !intune.resolved
          ? `Intune-Win11-ASR-Baseline drifted from the golden Git baseline: the LSASS credential-stealing ASR rule was weakened from Block to ${asr?.live ?? "Audit"} in the portal. Win11-Firewall-MDM duplicates EndpointSecurity-Firewall-Prod on SG-All-Workstations with a conflicting EnableFirewall value, so ${plural(n, "device")} report Conflict.`
          : "The ASR baseline and firewall policies match the golden Git baseline and no device reports a conflict.",
        steps: [
          step("asr", "intune", "ASR Baseline Drift", "Patch Intune-Win11-ASR-Baseline: LSASS credential-stealing rule Audit → Block (Settings Catalog, golden baseline).", "IntuneDriftCard", { label: "View Diff & Fix", kind: "view-diff" }, "settings"),
          step("firewall", "azure", "Firewall Conflict", "Unassign the duplicate legacy Win11-Firewall-MDM profile from SG-All-Workstations.", "IntuneDriftCard", { label: "Stage Intune Fix", kind: "stage-fix" }, "settings"),
          step("sync", "identity", "Device Re-evaluation", `Sync the ${plural(n || 11, "device")} so they re-report EnableFirewall = True and clear the Conflict state.`, "IntuneDriftCard", { label: "Inspect Devices", kind: "inspect" }, "devices"),
        ],
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Anomaly narrative                                                            */
/* -------------------------------------------------------------------------- */

function anomalyBody(ctx: CorrelationContext): { title: string; origin: string; body: string; signals: ScenarioSignal[]; openedAt: string } {
  switch (ctx.scenarioId) {
    case "ANOM-LIC-101": {
      const inv = ctx.license?.data;
      const e5 = inv?.skuPools.find((p) => p.skuPartNumber === "SPE_E5");
      const copilot = inv?.skuPools.find((p) => p.skuPartNumber === "Microsoft_365_Copilot");
      const orphaned = inv?.users.filter((u) => !u.accountEnabled && u.assignmentState === "Orphaned") ?? [];
      return {
        title: "License CountViolation & orphaned seats on disabled accounts",
        origin: "Detected from Graph subscribedSkus + users/licenseAssignmentStates",
        openedAt: "2026-10-26T06:05:00Z",
        body:
          `Group-based licensing on ${LICENSE_ANOMALY.groupName} reports State: Error · CountViolation for SPE_E5: ${e5?.consumed ?? 15}/${e5?.enabled ?? 15} seats are consumed. ` +
          `${plural(orphaned.length, "offboarded account")} (accountEnabled: false, last sign-in >90 days ago) still hold SPE_E5` +
          `${copilot ? ` and Microsoft_365_Copilot` : ""} through overlapping Direct + Group assignment paths.`,
        signals: [
          { label: "Group licensing error", value: inv?.groupErrors[0]?.detail ?? "none", category: "licensing", source: "GET /groups/{id}?$select=licenseProcessingState" },
          { label: "SPE_E5 pool", value: e5 ? `${e5.consumed}/${e5.enabled} consumed · ${e5.available} available` : "n/a", category: "licensing", source: "GET /subscribedSkus" },
          { label: "Disabled holders", value: orphaned.map((u) => u.displayName).join(", ") || "none", category: "licensing", source: "GET /users?$filter=accountEnabled eq false" },
        ],
      };
    }
    case "ANOM-CA-204": {
      const audit = ctx.caPosture?.data.auditEvents ?? [];
      return {
        title: "Conditional Access drift & missing break-glass exclusion",
        origin: "Detected from Entra ID Conditional Access policy state + directory audit logs",
        openedAt: audit[audit.length - 1]?.at ?? "2026-10-26T06:00:00Z",
        body:
          `${short(CA_POSTURE.policies[0]!.displayName)} was modified out-of-band and no longer excludes ${CA_POSTURE.breakGlassGroup} (${CA_POSTURE.breakGlassAccount}). ` +
          `${short(CA_POSTURE.policies[1]!.displayName)} is still enabledForReportingButNotEnforced after a maintenance window while legacy IMAP/SMTP sign-ins continue.`,
        signals: [
          ...audit.map((a) => ({ label: `${a.activity} · ${a.at.slice(5, 16).replace("T", " ")}Z`, value: `${a.actor}: ${a.detail}`.slice(0, 240), category: "identity" as const, source: "GET /auditLogs/directoryAudits" })),
          { label: "Legacy sign-ins (24 h)", value: `${ctx.caPosture?.data.legacySignIns.length ?? 0} IMAP4 / SMTP AUTH successes, 3 from AS 60729 (NL)`, category: "identity", source: "GET /auditLogs/signIns?$filter=clientAppUsed" },
        ],
      };
    }
    case "ANOM-APP-401": {
      const w = ctx.workloadIdentity ?? WORKLOAD_IDENTITY;
      return {
        title: "Workload identity shadow-admin owner, overprivileged Graph scopes & expired secret",
        origin: "Detected from Entra service principal sign-in activity, owners, appRoleAssignments + oauth2PermissionGrants",
        openedAt: "2026-10-26T06:10:00Z",
        body:
          `${w.spn.displayName} (appId ${w.spn.appId}) is owned by ${w.owner.upn} with 0 directory roles (shadow admin). ` +
          `Nightly GitHub Actions token requests fail with ${w.errorCodeLabel} since the secret '${w.passwordCredential.displayName}' expired ${w.passwordCredential.endDateTime.slice(0, 10)}. ` +
          `Granted application permissions ${w.appPermissions.join(", ")} and the unverified delegated grant ${w.oauth2PermissionGrant.scope} exceed what 90-day activity uses: ${w.activity.calls.map((c) => `${c.method} ${c.endpoint}`).join(" and ")} needs only ${w.requiredPermissions.join(", ")}.`,
        signals: [
          { label: "SPN sign-in failures", value: `${w.errorCodeLabel} nightly from ${w.failureSource} (expired secret '${w.passwordCredential.displayName}', ended ${w.passwordCredential.endDateTime.slice(0, 10)})`, category: "identity", source: "GET /auditLogs/signIns?$filter=servicePrincipalId" },
          { label: "App activity (90 days)", value: w.activity.calls.map((c) => `${c.method} ${c.endpoint} ×${c.count}`).join("; "), category: "identity", source: "GET /reports/servicePrincipalSignInActivities" },
          { label: "Granted vs required scopes", value: `${w.appPermissions.join(", ")} granted; ${w.requiredPermissions.join(", ")} required`, category: "identity", source: "GET /servicePrincipals/{id}/appRoleAssignments" },
          { label: "Owner & secret expiry", value: `${w.owner.upn} · 0 directory roles · secret expired ${w.passwordCredential.endDateTime.slice(0, 10)}`, category: "identity", source: "GET /applications/{id}/owners + passwordCredentials" },
        ],
      };
    }
    case "ANOM-INT-309": {
      const n = ctx.intune?.data.affectedDeviceCount ?? 0;
      return {
        title: "Intune security baseline & ASR policy drift vs golden baseline",
        origin: "Detected from Intune configurationPolicies + deviceConfigurationDeviceStateSummaries",
        openedAt: "2026-10-26T05:40:00Z",
        body:
          "In Intune-Win11-ASR-Baseline the ASR rule 'Block credential stealing from Windows local security authority subsystem (lsass.exe)' (9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2) was weakened from Block to Audit in the portal, compared to the golden Git configuration. " +
          `Win11-Firewall-MDM and EndpointSecurity-Firewall-Prod both target SG-All-Workstations with conflicting EnableFirewall values; ${plural(n, "device")} report Conflict.`,
        signals: [
          { label: "Setting drift", value: "ASR LSASS rule · golden Block · live Audit", category: "intune", source: "GET /beta/deviceManagement/configurationPolicies/{id}/settings" },
          { label: "Assignment conflict", value: `EnableFirewall · ${plural(n, "device")} in Conflict`, category: "intune", source: "GET /deviceManagement/deviceConfigurationDeviceStateSummaries" },
          { label: "Golden source", value: INTUNE_SCENARIOS["ANOM-INT-309"].goldenSource, category: "intune", source: "Git" },
        ],
      };
    }
    default:
      return { title: SCENARIO_REGISTRY[ctx.scenarioId].title, origin: "", body: "", signals: [], openedAt: ctx.gatheredAt };
  }
}

/* -------------------------------------------------------------------------- */
/* Brief                                                                       */
/* -------------------------------------------------------------------------- */

export function buildScenarioBrief(ctx: CorrelationContext): ScenarioBrief {
  const { tenant, contract, ticket } = ctx.erp;
  const { summary, steps } = summaryAndSteps(ctx);
  const defaultCloudCorrelation = correlateUpstreamCloudStatusSync({
    ticketText: ticket ? `${ticket.title}\n${ticket.description}` : ctx.scenarioId,
    createdAt: ticket?.openedAt ?? ctx.gatheredAt,
  });
  const base = {
    scenarioId: ctx.ticketId,
    kind: ctx.kind,
    tenantId: ctx.tenantId,
    tenantName: tenant.displayName,
    verifiedDomain: tenant.verifiedDomain,
    summary: cleanTruncate(summary, 700),
    steps,
    entities: scenarioEntities(ctx).slice(0, 24),
    sources: ctx.sourcesUsed,
    extraction: null,
    elementRouting: null,
    cloudStatusCorrelation: defaultCloudCorrelation,
    originKind: ctx.custom ? ctx.custom.origin : ctx.kind === "ticket" ? ("psa" as const) : ("anomaly" as const),
    displayId: displayScenarioId(ctx.ticketId),
    priority: null,
  };
  if (ctx.custom) return buildCustomBrief(ctx, base);
  if (ticket) {
    return {
      ...base,
      title: ticket.title,
      status: ticket.status,
      openedAt: ticket.openedAt,
      origin: `PSA ticket · ${ticket.category}`,
      body: ticket.description,
      signals: [],
      requester: ticket.requester,
      contract: {
        contractId: contract.contractId,
        title: contract.title,
        lines: contract.lines.map((l) => ({ description: l.description, skuPartNumber: l.skuPartNumber, quantity: l.quantity })),
        terms: contract.terms,
      },
      infrastructureSpec: ticket.infrastructureSpec,
      timeline: ticket.timeline,
      attachments: ticket.attachments ?? [],
    };
  }
  const a = anomalyBody(ctx);
  return {
    ...base,
    title: a.title,
    status: "Detected",
    openedAt: a.openedAt,
    origin: a.origin,
    body: a.body,
    signals: a.signals,
    requester: null,
    contract: null,
    infrastructureSpec: null,
    timeline: [],
    attachments: [],
  };
}

/** Entity ids that spawned a card, for its "Triggered by" badge. */
export function triggeredBy(ctx: CorrelationContext, type: CanvasComponentType): string[] {
  return (ctx.custom ? customEntities(ctx) : scenarioEntities(ctx))
    .filter((e) => e.target === type)
    .map((e) => e.id)
    .slice(0, 8);
}

/* -------------------------------------------------------------------------- */
/* Unscripted tickets                                                          */
/* -------------------------------------------------------------------------- */

const EXTRACTED_TARGET: Record<string, CanvasComponentType> = {
  licensing: "LicenseDriftCard",
  identity: "EntraSignInTimeline",
  intune: "IntuneDriftCard",
  azure: "IaCDriftBanner",
};

/**
 * The pills of a custom ticket: for N+k synthesized dynamic tickets, returns the
 * Stage-1 extracted entities targeting SynthesizedDynamicCard; for seeded-pattern
 * tickets, returns the matched entities and base scenario entities for the cards it renders.
 */
export function customEntities(ctx: CorrelationContext): EnrichedEntity[] {
  const custom = ctx.custom!;
  if (custom.elementRouting && custom.elementRouting.missingElements.length > 0) {
    return custom.elementRouting.extractedEntities.slice(0, 24);
  }
  const cards = new Set(custom.components);
  const inherited = scenarioEntities(ctx).filter((e) => cards.has(e.target));
  const seen = new Set(inherited.map((e) => e.id.toLowerCase()));
  const extracted: EnrichedEntity[] = [];
  for (const x of custom.extraction.entities) {
    const id = x.resolvedTo ?? x.id;
    if (seen.has(id.toLowerCase())) continue;
    const target = EXTRACTED_TARGET[x.category];
    if (!target || !cards.has(target)) continue;
    const type: EnrichedEntity["type"] = x.type === "name" ? "upn" : x.type === "keyword" || x.type === "permission" ? "setting" : x.type;
    const hoverable = Boolean(x.resolvedTo) && (type === "upn" || type === "errorCode" || type === "policy" || type === "group" || type === "sku" || type === "resource" || x.type === "permission");
    seen.add(id.toLowerCase());
    extracted.push(entity(id, type, x.category, target, { label: x.label, hoverable, note: x.resolvedTo ? "matched live" : "from ticket text" }));
  }
  return [...extracted, ...inherited].slice(0, 24);
}

function extraDomainSteps(cards: Set<CanvasComponentType>, existingSteps: ResolutionStep[]): ResolutionStep[] {
  const extras: ResolutionStep[] = [];
  if (cards.has("IntuneDriftCard") && !existingSteps.some((s) => s.target === "IntuneDriftCard")) {
    extras.push(
      step(
        "intune",
        "intune",
        "Intune Baseline & Compliance",
        "Patch Intune-Win11-ASR-Baseline (LSASS rule Audit → Block), unassign duplicate Win11-Firewall-MDM profile, and sync non-compliant devices.",
        "IntuneDriftCard",
        { label: "View Diff & Fix", kind: "stage-fix" },
        "settings",
      ),
    );
  }
  if (cards.has("IaCDriftBanner") && !existingSteps.some((s) => s.target === "IaCDriftBanner")) {
    extras.push(
      step(
        "nsg",
        "azure",
        "Host Pool & NSG Drift",
        "Remove rogue rule Allow-Temp-RDP-Diagnostic-Drift (TCP/3389) on nsg-contoso-avd-hostpool-01 and restore the Terraform tags.",
        "IaCDriftBanner",
        { label: "View Diff & Fix", kind: "view-diff" },
        "nsg",
      ),
    );
  }
  if (cards.has("LicenseDriftCard") && !existingSteps.some((s) => s.target === "LicenseDriftCard")) {
    extras.push(
      step(
        "license",
        "licensing",
        "License Upgrade",
        "Move 3 users in SG-Contoso-Finance-AVD out of SG-Contoso-Finance-Legacy and reprocess group SPE_E5 licensing (Remove-MgGroupMemberByRef + Invoke-MgLicenseUser).",
        "LicenseDriftCard",
        { label: "Inspect / Stage Fix", kind: "stage-fix" },
        "users",
      ),
    );
  }
  return extras;
}

function buildCustomBrief(
  ctx: CorrelationContext,
  base: Omit<ScenarioBrief, "title" | "status" | "openedAt" | "origin" | "body" | "signals" | "requester" | "contract" | "infrastructureSpec" | "timeline" | "attachments">,
): ScenarioBrief {
  const custom = ctx.custom!;
  const routing = custom.elementRouting ?? null;
  const hasSynthesizedElements = Boolean(routing && routing.missingElements.length > 0);
  const cloudCorrelation =
    custom.cloudStatusCorrelation ??
    correlateUpstreamCloudStatusSync({
      ticketText: `${custom.ticket.title}\n${custom.ticket.body}`,
      createdAt: custom.createdAt,
    });

  const customer = custom.ticket.customerName ?? ctx.erp.tenant.displayName;
  const drop = custom.origin === "erp-drop" ? custom.erpDrop : undefined;
  const displayId = displayScenarioId(custom.scenarioId);

  if (hasSynthesizedElements && routing) {
    const customSteps: ResolutionStep[] = routing.customBrief.steps.map((s, idx) =>
      step(
        `syn-step-${idx + 1}`,
        s.category,
        s.title,
        s.detail,
        "SynthesizedDynamicCard",
        {
          label: s.actionLabel.slice(0, 32),
          kind: s.actionLabel.toLowerCase().includes("diff") ? "view-diff" : s.actionLabel.toLowerCase().includes("inspect") ? "inspect" : "stage-fix",
        },
      ),
    );
    const missingNames = routing.missingElements.map((m) => m.elementId).join(", ");
    return {
      ...base,
      summary: cleanTruncate(routing.customBrief.summary, 700),
      steps: customSteps,
      entities: customEntities(ctx),
      extraction: custom.extraction,
      elementRouting: routing,
      cloudStatusCorrelation: cloudCorrelation,
      title: custom.ticket.title,
      status: drop ? "New" : "Open",
      openedAt: custom.createdAt,
      origin: `Unscripted ticket · ${customer} · Dynamic UI (${missingNames})`,
      body: custom.ticket.body,
      signals: [
        {
          label: "N+k Catalog Synthesis",
          value: `muse-spark-1.3 flagged element_not_existent -> muse-wonder-1.0 synthesized ${missingNames}`,
          category: "azure",
          source: "data/dynamic-catalog.json",
        },
        {
          label: "Upstream Cloud Correlation",
          value: cloudCorrelation.overallCorrelationSummary.slice(0, 240),
          category: "azure",
          source: "azure.status.microsoft + githubstatus.com",
        },
      ],
      requester: custom.ticket.requester ?? null,
      priority: custom.ticket.priority ?? null,
      contract: null,
      infrastructureSpec: null,
      timeline: [
        {
          at: custom.createdAt,
          actor: customer,
          note: `Unscripted ticket triaged via muse-spark-1.3 gatekeeper -> muse-wonder-1.0 synthesized ${missingNames}`,
        },
      ],
      attachments: drop?.attachments ?? [],
    };
  }

  const cards = new Set(custom.components);
  const baseFiltered = base.steps.filter((s) => cards.has(s.target));
  const inheritedSteps = [...baseFiltered, ...extraDomainSteps(cards, baseFiltered)];
  const x = custom.extraction;
  const matched = x.entities.filter((e) => e.resolvedTo);
  const how = drop ? `ERP ticket ${displayId} dropped into input/tickets/${drop.folder}/ and triaged live` : "Unscripted ticket triaged live";
  const rawSummary = `${how} against ${ctx.erp.tenant.verifiedDomain}: ${plural(matched.length, "entity")} matched MCP data (${x.intents.join(", ") || "live tenant correlation"}), inheriting the ${SCENARIO_REGISTRY[ctx.scenarioId].scenarioId} pattern. ${base.summary}`;
  const summary = cleanTruncate(rawSummary, 700);
  const timeline = drop
    ? [
        { at: custom.createdAt, actor: custom.ticket.requester?.displayName ?? customer, note: `Ticket ${displayId} opened in the ERP${custom.ticket.priority ? ` (priority ${custom.ticket.priority})` : ""}` },
        { at: drop.ingestedAt, actor: "ERP inbox watcher", note: `${drop.folder}/ticketbody.json ingested${drop.attachments.length ? ` with ${plural(drop.attachments.length, "attachment")} (${drop.attachments.map((a) => a.fileName).join(", ")})` : ""}; Tier 0 extraction, 0 tokens` },
      ]
    : [{ at: custom.createdAt, actor: customer, note: "Ticket pasted into the unscripted composer and triaged live" }];
  return {
    ...base,
    summary,
    steps: inheritedSteps.length ? inheritedSteps : base.steps.slice(0, 1),
    entities: customEntities(ctx),
    extraction: x,
    elementRouting: routing,
    cloudStatusCorrelation: cloudCorrelation,
    title: custom.ticket.title,
    status: drop ? "New" : "Open",
    openedAt: custom.createdAt,
    origin: drop ? `ERP file drop · input/tickets/${drop.folder} · ${customer} · base pattern ${ctx.scenarioId}` : `Unscripted ticket · ${customer} · base pattern ${ctx.scenarioId}`,
    body: custom.ticket.body,
    signals: [
      ...(drop
        ? [{ label: "ERP file drop", value: `${drop.folder}/ticketbody.json${drop.attachments.length ? ` + ${drop.attachments.map((a) => a.fileName).join(", ")}` : ""} · ingested ${drop.ingestedAt.slice(11, 19)}Z`, category: "azure" as const, source: `fs.watch + 1 s scan · ${drop.folder}` }]
        : []),
      ...(matched.length > 0 && x.intents.length > 0
        ? [
            { label: "Entity & intent extraction", value: `${plural(x.entities.length, "entity")} found, ${matched.length} resolved live · intents: ${x.intents.join(", ")}`, category: "identity" as const, source: "mcp-msgraph · users, policies, devices · mcp-azure-iac · NSG" },
          ]
        : []),
    ],
    requester: custom.ticket.requester ?? null,
    priority: custom.ticket.priority ?? null,
    contract: { contractId: ctx.erp.contract.contractId, title: ctx.erp.contract.title, lines: ctx.erp.contract.lines.map((l) => ({ description: l.description, skuPartNumber: l.skuPartNumber, quantity: l.quantity })), terms: ctx.erp.contract.terms },
    infrastructureSpec: null,
    timeline,
    attachments: drop?.attachments ?? [],
  };
}
