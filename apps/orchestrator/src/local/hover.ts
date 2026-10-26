import { lookupAadsts, type EntityType, type Fact, type HoverDiagnosticArgs, type QuickAction } from "@contextpane/catalog";
import type { CorrelationContext } from "../mcp/context.ts";

/**
 * Deterministic hover diagnostics. Used as the Tier 1A fallback and as the
 * factual seed inside the muse-glimmer prompt.
 */

export interface HoverTarget {
  entityId: string;
  entityType: EntityType;
}

const fact = (label: string, value: string, mono = false, tone?: Fact["tone"]): Fact => ({ label, value, mono, ...(tone ? { tone } : {}) });

/** Append optional fragments while the headline stays within the 120-char schema cap. */
function fitHeadline(base: string, fragments: string[], max = 120): string {
  let out = base.slice(0, max);
  for (const f of fragments.filter(Boolean)) {
    const candidate = `${out} · ${f}`;
    if (candidate.length <= max) out = candidate;
  }
  return out;
}

export function inferEntityType(entityId: string): EntityType {
  const id = entityId.trim();
  if (/^AADSTS\d+$/i.test(id)) return "errorCode";
  if (id.includes("@")) return "upn";
  if (/^SG-/i.test(id)) return "group";
  if (/^(nsg|rg|vdpool|vm|snet|vnet)-/i.test(id) || id.startsWith("/subscriptions/")) return "resource";
  if (/^\[.*\]/.test(id) || /policy/i.test(id)) return "policy";
  if (/^(INC|TKT)-/i.test(id)) return "ticket";
  if (/^CNT-/i.test(id)) return "contract";
  if (/^[A-Z0-9_]{4,}$/.test(id)) return "sku";
  return "upn";
}

export function buildHoverDiagnostic(ctx: CorrelationContext, target: HoverTarget): HoverDiagnosticArgs {
  switch (target.entityType) {
    case "upn":
      return hoverUser(ctx, target.entityId);
    case "group":
      return hoverGroup(ctx, target.entityId);
    case "errorCode":
      return hoverErrorCode(ctx, target.entityId);
    case "policy":
      return hoverPolicy(ctx, target.entityId);
    case "resource":
      return hoverResource(ctx, target.entityId);
    case "sku":
      return hoverSku(ctx, target.entityId);
    case "ticket":
    case "contract":
    case "device":
    default:
      return hoverGeneric(ctx, target);
  }
}

function hoverUser(ctx: CorrelationContext, upn: string): HoverDiagnosticArgs {
  const user = ctx.license.data.users.find((u) => u.upn.toLowerCase() === upn.toLowerCase());
  const signIns = ctx.signIns.data.filter((e) => e.upn.toLowerCase() === upn.toLowerCase());
  const lastFailure = [...signIns].reverse().find((e) => e.status === "failure");
  const translation = lastFailure ? lookupAadsts(lastFailure.errorCode) : null;
  const blocking = lastFailure?.blockingPolicyName ? ctx.policies.data.find((p) => p.displayName === lastFailure.blockingPolicyName) : undefined;
  const facts: Fact[] = [];
  if (user) {
    facts.push(fact("Role", user.jobTitle || "—"));
    facts.push(fact("Group", ctx.license.data.group.displayName, true));
    facts.push(
      fact("License", `${user.currentSku} → expected ${user.expectedSku}`, true, user.driftStatus === "compliant" ? "healthy" : "warning"),
    );
  }
  if (lastFailure) {
    facts.push(fact("Last failure", `${lastFailure.appDisplayName} · ${new Date(lastFailure.timestamp).toUTCString().slice(17, 25)} UTC`, false, "critical"));
    facts.push(fact("Error", lastFailure.errorCodeLabel ?? String(lastFailure.errorCode), true, "critical"));
    if (lastFailure.blockingPolicyName) facts.push(fact("Blocked by", lastFailure.blockingPolicyName, true, "critical"));
    facts.push(fact("Device", `${lastFailure.deviceName || "unknown"} · ${lastFailure.deviceCompliant === false ? "non-compliant" : "compliant"}`, true));
  } else if (signIns.length) {
    facts.push(fact("Last sign-in", `${signIns.at(-1)?.appDisplayName} · success`, false, "healthy"));
  }
  const quickActions: QuickAction[] = [];
  if (lastFailure) quickActions.push({ id: "issue-tap", label: "Issue TAP", kind: "issue-tap", targetEntityId: upn, destructive: false });
  if (blocking) quickActions.push({ id: "inspect-policy", label: "Inspect CA Policy", kind: "inspect-policy", targetEntityId: blocking.id, destructive: false });
  if (user && user.driftStatus !== "compliant") {
    quickActions.push({ id: "assign-license", label: `Assign ${user.expectedSku}`, kind: "assign-license", targetEntityId: upn, destructive: false });
  }
  const status = lastFailure?.blockingPolicyName ? "critical" : user?.driftStatus === "drifted" ? "warning" : user ? "healthy" : "unknown";
  const headline = lastFailure
    ? fitHeadline(
        `${user?.displayName ?? upn} blocked from ${lastFailure.appDisplayName} (${lastFailure.errorCodeLabel ?? lastFailure.errorCode})`,
        [
          user?.driftStatus === "drifted" ? `${user.currentSku} ≠ ${user.expectedSku}` : "",
          blocking ? `by ${blocking.displayName}` : "",
        ],
      )
    : user
      ? `${user.displayName} · ${user.driftStatus === "compliant" ? `${user.currentSku} assigned, no recent failures` : `license drift (${user.currentSku} vs ${user.expectedSku})`}`
      : `${upn} is not a member of ${ctx.license.data.group.displayName}`;
  return {
    entityId: upn,
    entityType: "upn",
    status,
    headline: headline.slice(0, 120),
    errorCodeTranslation: translation ? { code: translation.code, meaning: translation.meaning, likelyCause: translation.likelyCause, docsUrl: translation.docsUrl } : null,
    facts: facts.slice(0, 8),
    quickActions: quickActions.slice(0, 4),
  };
}

function hoverGroup(ctx: CorrelationContext, groupName: string): HoverDiagnosticArgs {
  const lic = ctx.license.data;
  const isPrimary = lic.group.displayName.toLowerCase() === groupName.toLowerCase();
  const policies = ctx.policies.data.filter((p) => p.includeGroupNames.map((g) => g.toLowerCase()).includes(groupName.toLowerCase()));
  const drifted = isPrimary ? lic.driftedUsers : [];
  const billed = ctx.erp.contract.lines.find((l) => l.entitlementGroup?.toLowerCase() === groupName.toLowerCase());
  const facts: Fact[] = [
    fact("Members", String(isPrimary ? lic.users.length : "—"), true),
    ...(billed ? [fact("Contract", `${billed.quantity}x ${billed.skuName} (${ctx.erp.contract.contractId})`, false)] : []),
    ...(isPrimary ? [fact("Assigned", `${lic.entraAssignedCount}/${billed?.quantity ?? lic.entraAssignedCount}`, true, drifted.length ? "warning" : "healthy")] : []),
    ...(drifted.length ? [fact("Drifted", drifted.map((u) => u.displayName).join(", "), false, "warning")] : []),
    ...policies.map((p) => fact(p.blocks ? "Blocked by" : "Targeted by", p.displayName, true, p.blocks ? "critical" : "warning")),
  ];
  return {
    entityId: groupName,
    entityType: "group",
    status: policies.some((p) => p.blocks) ? "critical" : drifted.length ? "warning" : "healthy",
    headline: drifted.length
      ? `${groupName}: ${drifted.length} of ${lic.users.length} members missing ${lic.sku.skuPartNumber}`
      : `${groupName}: ${policies.length ? `${policies.length} Conditional Access polic${policies.length > 1 ? "ies" : "y"} in scope` : "no drift, no blocking policies"}`,
    errorCodeTranslation: null,
    facts: facts.slice(0, 8),
    quickActions: [
      ...(drifted.length ? [{ id: "assign-license", label: `Assign ${lic.sku.skuPartNumber} ×${drifted.length}`, kind: "assign-license" as const, targetEntityId: groupName, destructive: false }] : []),
      ...policies.slice(0, 1).map((p) => ({ id: "inspect-policy", label: "Inspect CA Policy", kind: "inspect-policy" as const, targetEntityId: p.id, destructive: false })),
    ].slice(0, 4),
  };
}

function hoverErrorCode(ctx: CorrelationContext, code: string): HoverDiagnosticArgs {
  const entry = lookupAadsts(code);
  const label = code.toUpperCase();
  const occurrences = ctx.signIns.data.filter((e) => (e.errorCodeLabel ?? "").toUpperCase() === label);
  const policies = [...new Set(occurrences.map((e) => e.blockingPolicyName).filter((p): p is string => Boolean(p)))];
  const upns = [...new Set(occurrences.map((e) => e.upn))];
  const facts: Fact[] = [
    fact("Occurrences", `${occurrences.length} in current window`, true, occurrences.length ? "critical" : "healthy"),
    ...(upns.length ? [fact("Affected", upns.join(", "), true)] : []),
    ...policies.map((p) => fact("Policy", p, true, "critical")),
    ...(entry ? [fact("Category", entry.category)] : []),
  ];
  return {
    entityId: label,
    entityType: "errorCode",
    status: occurrences.length ? (entry?.severity === "critical" ? "critical" : "warning") : "unknown",
    headline: entry ? entry.meaning.slice(0, 120) : `${label}: unknown AADSTS code`,
    errorCodeTranslation: entry ? { code: entry.code, meaning: entry.meaning, likelyCause: entry.likelyCause, docsUrl: entry.docsUrl } : null,
    facts: facts.slice(0, 8),
    quickActions: [
      ...(policies.length ? [{ id: "inspect-policy", label: "Inspect CA Policy", kind: "inspect-policy" as const, targetEntityId: policies[0], destructive: false }] : []),
      { id: "open-sign-in-logs", label: "Open sign-in logs", kind: "open-sign-in-logs" as const, destructive: false },
    ],
  };
}

function hoverPolicy(ctx: CorrelationContext, nameOrId: string): HoverDiagnosticArgs {
  const needle = nameOrId.toLowerCase();
  const policy = ctx.policies.data.find((p) => p.id.toLowerCase() === needle || p.displayName.toLowerCase() === needle);
  if (!policy) {
    return { entityId: nameOrId, entityType: "policy", status: "unknown", headline: "Policy not found in tenant", errorCodeTranslation: null, facts: [], quickActions: [] };
  }
  const blocked = ctx.signIns.data.filter((e) => e.blockingPolicyId === policy.id);
  return {
    entityId: policy.id,
    entityType: "policy",
    status: policy.blocks && policy.state === "enabled" ? "critical" : "warning",
    headline: `${policy.displayName} · ${policy.state} · ${policy.grant.builtInControls.join("+") || "no grant"}`.slice(0, 120),
    errorCodeTranslation: null,
    facts: [
      fact("Include", policy.includeGroupNames.join(", ") || "—", true),
      fact("Exclude", policy.excludeGroupNames.join(", ") || "none", true),
      fact("Apps", policy.targetApps.map((a) => a.displayName).join(", "), false),
      fact("Blocked sign-ins", String(blocked.length), true, blocked.length ? "critical" : "healthy"),
      ...(policy.modifiedDateTime ? [fact("Modified", policy.modifiedDateTime.slice(0, 16).replace("T", " ") + " UTC", true)] : []),
    ],
    quickActions: [
      { id: "exclude-group-report-only", label: "Exclude Group in Report-Only", kind: "exclude-group-report-only", targetEntityId: policy.id, destructive: false },
    ],
  };
}

function hoverResource(ctx: CorrelationContext, resourceName: string): HoverDiagnosticArgs {
  const d = ctx.drift.data;
  if (d.resourceName.toLowerCase() !== resourceName.toLowerCase()) {
    const spec = ctx.erp.ticket.infrastructureSpec;
    return {
      entityId: resourceName,
      entityType: "resource",
      status: "healthy",
      headline: `${resourceName} · referenced in ${ctx.erp.ticket.ticketId}, no drift tracked`,
      errorCodeTranslation: null,
      facts: [fact("Resource group", d.resourceGroup, true), fact("Spec", spec.split("\n")[0] ?? "", false)],
      quickActions: [],
    };
  }
  const rogue = d.rogueSecurityRules;
  return {
    entityId: d.resourceName,
    entityType: "resource",
    status: d.severity === "critical" ? "critical" : d.driftState === "drift-detected" ? "warning" : "healthy",
    headline: `${d.resourceName}: ${d.summary}`.slice(0, 120),
    errorCodeTranslation: null,
    facts: [
      fact("Resource group", d.resourceGroup, true),
      fact("Baseline", `${d.terraformFile} @ ${d.gitBranch}`, true),
      ...rogue.map((r) => fact("Rogue rule", `${r.ruleName} · ${r.protocol.toUpperCase()} ${r.port} from ${r.source} (p${r.priority})`, true, r.severity === "critical" ? "critical" : "warning")),
      ...d.tagDrift.map((t) => fact(`Tag ${t.key}`, `${t.actualInAzure ?? "∅"} → ${t.expectedInTf ?? "∅"}`, true, "warning")),
      fact("Compared against", ctx.drift.source === "live-azure" ? "live Azure" : "seeded manifest", false),
    ].slice(0, 8),
    quickActions: [
      { id: "view-diff", label: "View Diff", kind: "view-diff", targetEntityId: d.resourceName, destructive: false },
      { id: "generate-fix", label: "Generate Fix & Stage PR", kind: "generate-fix", targetEntityId: d.resourceName, destructive: false },
    ],
  };
}

function hoverSku(ctx: CorrelationContext, sku: string): HoverDiagnosticArgs {
  const lic = ctx.license.data;
  const line = ctx.erp.contract.lines.find((l) => l.skuPartNumber.toLowerCase() === sku.toLowerCase());
  const drifted = lic.sku.skuPartNumber.toLowerCase() === sku.toLowerCase() ? lic.driftedUsers : [];
  const missing = line ? Math.max(0, line.quantity - lic.entraAssignedCount) : 0;
  return {
    entityId: sku,
    entityType: "sku",
    status: missing ? "warning" : "healthy",
    headline: line ? `${line.skuName}: ${lic.entraAssignedCount}/${line.quantity} assigned · ${missing} missing` : `${sku} not on contract`,
    errorCodeTranslation: null,
    facts: [
      ...(line ? [fact("Billed", `${line.quantity} × $${line.unitPriceUsd}/mo`, true), fact("Burn-rate delta", `$${(missing * line.unitPriceUsd).toFixed(2)}/mo billed, not delivered`, true, missing ? "warning" : "healthy")] : []),
      ...(drifted.length ? [fact("Drifted users", drifted.map((u) => u.displayName).join(", "))] : []),
    ],
    quickActions: drifted.length ? [{ id: "assign-license", label: `Assign to ${drifted.length} users`, kind: "assign-license", destructive: false }] : [],
  };
}

function hoverGeneric(ctx: CorrelationContext, target: HoverTarget): HoverDiagnosticArgs {
  return {
    entityId: target.entityId,
    entityType: target.entityType,
    status: "unknown",
    headline: `${target.entityId} · ${ctx.erp.tenant.displayName}`,
    errorCodeTranslation: null,
    facts: [fact("Ticket", ctx.erp.ticket.ticketId, true), fact("Contract", ctx.erp.contract.contractId, true)],
    quickActions: [],
  };
}
