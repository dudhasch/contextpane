import { lookupAadsts, type EntityType, type Fact, type HoverDiagnosticArgs, type QuickAction } from "@contextpane/catalog";
import type { CorrelationContext } from "../mcp/context.ts";

/**
 * Deterministic hover diagnostics. Used as the Tier 1A fallback, as the factual
 * seed inside the muse-glimmer prompt, and always for the facts and quick
 * actions of a popover: the model only ever contributes the headline.
 */

export interface HoverTarget {
  entityId: string;
  entityType: EntityType;
}

const fact = (label: string, value: string, mono = false, tone?: Fact["tone"]): Fact => ({ label, value: value.slice(0, 200), mono, ...(tone ? { tone } : {}) });
const short = (name: string) => name.replace("[ContextPane-Demo] ", "");
const utcTime = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC`;

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
  if (/^AADSTS\d+$/i.test(id) || /^0x[0-9a-f]{8}$/i.test(id) || id === "CountViolation") return "errorCode";
  if (id.includes("@")) return "upn";
  if (/^SG-/i.test(id)) return "group";
  if (/^(nsg|rg|vdpool|vm|snet|vnet)-/i.test(id) || id.startsWith("/subscriptions/")) return "resource";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return "setting";
  if (/^(CONTOSO|FABRIKAM)-(WS|LT|SP)-/i.test(id)) return "device";
  if (/^\[.*\]/.test(id) || /policy|baseline|compliance|firewall|bitlocker|deviceconfig/i.test(id)) return "policy";
  if (/^(INC|TKT|ANOM)-/i.test(id)) return "ticket";
  if (/^CNT-/i.test(id)) return "contract";
  if (/^[A-Za-z0-9_]{4,}$/.test(id)) return "sku";
  return "upn";
}

function hoverWorkloadSpn(ctx: CorrelationContext, entityType: EntityType): HoverDiagnosticArgs {
  const w = ctx.workloadIdentity!;
  return {
    entityId: w.spn.displayName,
    entityType,
    status: "critical",
    headline: `${w.spn.displayName}: expired secret (${w.errorCodeLabel} nightly), shadow-admin owner, overprivileged Graph scopes`.slice(0, 120),
    errorCodeTranslation: null,
    facts: [
      fact("App ID", w.spn.appId, true, "critical"),
      fact("Owner", `${w.owner.upn} · 0 directory roles`, true, "critical"),
      fact("Granted scopes", w.appPermissions.join(", "), true, "critical"),
      fact("Required (90 d)", w.requiredPermissions.join(", "), true, "healthy"),
      fact("Activity (90 d)", w.activity.calls.map((c) => `${c.method} ${c.endpoint}`).join("; "), true),
      fact("Delegated grant", `${w.oauth2PermissionGrant.scope} · unverified`, true, "warning"),
      fact("Secret", `'${w.passwordCredential.displayName}' expired ${w.passwordCredential.endDateTime.slice(0, 10)}`, true, "critical"),
    ].slice(0, 8),
    quickActions: [{ id: "generate-fix", label: "Stage Workload Fix", kind: "generate-fix", targetEntityId: w.spn.servicePrincipalId, destructive: false }],
  };
}

export function buildHoverDiagnostic(ctx: CorrelationContext, target: HoverTarget): HoverDiagnosticArgs {
  const w = ctx.workloadIdentity;
  if (w && (target.entityId === w.spn.displayName || target.entityId === w.spn.appId || target.entityId === w.spn.servicePrincipalId)) {
    return hoverWorkloadSpn(ctx, target.entityType);
  }
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
    case "setting":
    case "device":
      return hoverIntuneItem(ctx, target);
    default:
      return hoverGeneric(ctx, target);
  }
}

/** Every Conditional Access policy the scenario knows, ticket and posture alike, as (id, name, blocks). */
function knownPolicies(ctx: CorrelationContext): Array<{ id: string; displayName: string; state: string; includeGroups: string[]; excludeGroups: string[]; grant: string[] }> {
  return [
    ...(ctx.policies?.data ?? []).map((p) => ({ id: p.id, displayName: p.displayName, state: p.state, includeGroups: p.includeGroupNames, excludeGroups: p.excludeGroupNames, grant: p.grant.builtInControls })),
    ...(ctx.caPosture?.data.policies ?? []).map((p) => ({ id: p.id, displayName: p.displayName, state: p.state, includeGroups: p.includeGroups, excludeGroups: p.excludeGroups, grant: p.grantControls })),
  ];
}

/**
 * User popover: assigned vs expected SKU, assignment state, Entra group memberships and
 * the last blocking sign-in, with [Inspect Blocking CA Policy] and [Stage License Fix].
 */
function hoverUser(ctx: CorrelationContext, upn: string): HoverDiagnosticArgs {
  const w = ctx.workloadIdentity;
  if (w && upn.toLowerCase() === w.owner.upn.toLowerCase()) {
    return {
      entityId: upn,
      entityType: "upn",
      status: "critical",
      headline: `${w.owner.displayName}: shadow-admin owner of ${w.spn.displayName} with 0 directory roles`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [
        fact("App owner of", `${w.spn.displayName} (${w.spn.appId})`, true, "critical"),
        fact("Directory roles", "0 (no Entra role assignment)", true, "critical"),
        fact("Granted scopes", w.appPermissions.join(", "), true, "critical"),
        fact("Risk", "Owner can rotate credentials and consent scopes without any directory role", false, "critical"),
      ],
      quickActions: [{ id: "generate-fix", label: "Stage Workload Fix", kind: "generate-fix", targetEntityId: w.spn.servicePrincipalId, destructive: false }],
    };
  }
  const key = upn.toLowerCase();
  const user = ctx.license?.data.users.find((u) => u.upn.toLowerCase() === key);
  const groups = ctx.groupsByUpn.get(key) ?? [];
  const signIns = (ctx.signIns?.data ?? []).filter((e) => e.upn.toLowerCase() === key);
  const lastBlock = [...signIns].reverse().find((e) => e.status === "failure");
  const translation = lastBlock ? lookupAadsts(lastBlock.errorCode) : null;
  const policies = knownPolicies(ctx);
  const blocking = lastBlock?.blockingPolicyName ? policies.find((p) => p.id === lastBlock.blockingPolicyId || p.displayName === lastBlock.blockingPolicyName) : undefined;
  // ANOM-CA-204: the break-glass account is in scope of CA-001 but not excluded.
  const exposed = ctx.caPosture?.data.policies.find((p) => p.includeGroups.some((g) => groups.includes(g)) && !p.excludeGroups.some((g) => groups.includes(g)) && p.drift.length);
  const licenseOk = !user || user.assignmentState === "Active" || user.assignmentState === "Reclaimed";

  const facts: Fact[] = [];
  if (user) {
    facts.push(fact("Assigned SKU", `${user.currentSku} · expected ${user.expectedSku}`, true, licenseOk ? "healthy" : "warning"));
    facts.push(fact("Assignment", `${user.assignmentState} · ${user.assignmentPath}`, true, user.assignmentState === "Active" ? "healthy" : user.assignmentState === "Reclaimed" ? "healthy" : user.assignmentState === "Error: CountViolation" || user.assignmentState === "Orphaned" ? "critical" : "warning"));
    if (!user.accountEnabled) facts.push(fact("Account", `Disabled · last sign-in ${user.lastSignIn?.slice(0, 10) ?? "> 90 days"}`, false, "warning"));
  }
  facts.push(fact("Groups", groups.join(", ") || "none", true));
  if (lastBlock) {
    facts.push(fact("Last block", `${lastBlock.errorCodeLabel ?? lastBlock.errorCode} · ${lastBlock.appDisplayName} · ${utcTime(lastBlock.timestamp)}`, true, "critical"));
    if (lastBlock.blockingPolicyName) facts.push(fact("Blocked by", short(lastBlock.blockingPolicyName), true, "critical"));
    if (lastBlock.deviceName) facts.push(fact("Device", `${lastBlock.deviceName} · ${lastBlock.deviceCompliant === false ? "NonCompliant" : "compliant"}`, true, lastBlock.deviceCompliant === false ? "warning" : undefined));
  } else if (exposed) {
    facts.push(fact("Exposure", `In scope of ${short(exposed.displayName)} with no exclusion`, true, "critical"));
  } else if (signIns.length) {
    facts.push(fact("Last sign-in", `${signIns.at(-1)!.appDisplayName} · success`, false, "healthy"));
  }

  const quickActions: QuickAction[] = [];
  const inspectTarget = blocking ?? exposed;
  if (inspectTarget) quickActions.push({ id: "inspect-policy", label: "Inspect Blocking CA Policy", kind: "inspect-policy", targetEntityId: inspectTarget.id, destructive: false });
  if (user && !licenseOk) quickActions.push({ id: "stage-license-fix", label: "Stage License Fix", kind: "stage-license-fix", targetEntityId: upn, destructive: false });
  else if (ctx.intune && !ctx.intune.data.resolved) quickActions.push({ id: "stage-intune-fix", label: "Stage Intune Fix", kind: "stage-intune-fix", targetEntityId: upn, destructive: false });

  const name = user?.displayName ?? signIns[0]?.displayName ?? upn.split("@")[0]!;
  let headline: string;
  if (lastBlock) {
    headline = fitHeadline(`${name} blocked from ${lastBlock.appDisplayName} (${lastBlock.errorCodeLabel ?? lastBlock.errorCode})`, [
      user && user.currentSku !== user.expectedSku ? `${user.currentSku} ≠ ${user.expectedSku}` : "",
      blocking ? `by ${short(blocking.displayName)}` : "",
    ]);
  } else if (user && !user.accountEnabled && user.assignmentState === "Orphaned") {
    headline = `${name}: disabled account still holds ${user.currentSku} (${user.assignmentPath})`;
  } else if (user && user.assignmentState === "Error: CountViolation") {
    headline = `${name}: group licensing failed (CountViolation), no ${user.expectedSku} assigned`;
  } else if (exposed) {
    headline = `${name}: break-glass account not excluded from ${short(exposed.displayName).split("-Require")[0]}`;
  } else if (user) {
    headline = `${name} · ${user.currentSku} · ${user.assignmentState}`;
  } else {
    headline = `${name} · no license or sign-in data in this scenario`;
  }
  return {
    entityId: upn,
    entityType: "upn",
    status: lastBlock?.blockingPolicyName || exposed || user?.assignmentState === "Orphaned" || user?.assignmentState === "Error: CountViolation" ? "critical" : !licenseOk ? "warning" : user || signIns.length ? "healthy" : "unknown",
    headline: headline.slice(0, 120),
    errorCodeTranslation: translation ? { code: translation.code, meaning: translation.meaning, likelyCause: translation.likelyCause, docsUrl: translation.docsUrl } : null,
    facts: facts.slice(0, 8),
    quickActions: quickActions.slice(0, 2),
  };
}

function hoverGroup(ctx: CorrelationContext, groupName: string): HoverDiagnosticArgs {
  const needle = groupName.toLowerCase();
  const members = [...ctx.groupsByUpn].filter(([, groups]) => groups.some((g) => g.toLowerCase() === needle)).map(([upn]) => upn);
  const inv = ctx.license?.data;
  const licensed = inv && inv.groupName.toLowerCase() === needle ? inv.users : [];
  const open = licensed.filter((u) => u.assignmentState !== "Active" && u.assignmentState !== "Reclaimed");
  const policies = knownPolicies(ctx);
  const included = policies.filter((p) => p.includeGroups.some((g) => g.toLowerCase() === needle));
  const excluded = policies.filter((p) => p.excludeGroups.some((g) => g.toLowerCase() === needle));
  const intunePolicies = (ctx.intune?.data.policies ?? []).filter((p) => p.assignedTo.some((g) => g.toLowerCase() === needle));
  const groupError = inv?.groupErrors.find((e) => e.groupName.toLowerCase() === needle);
  const facts: Fact[] = [
    fact("Members", String(Math.max(members.length, licensed.length) || (ctx.intune ? ctx.intune.data.devices.length : 0)), true),
    ...(groupError ? [fact("Licensing", `Error · ${groupError.state} · ${groupError.affectedUsers} users`, true, "critical")] : []),
    ...(open.length ? [fact("Assignments", `${open.length} not active (${[...new Set(open.map((u) => u.assignmentState))].join(", ")})`, false, "warning")] : []),
    ...included.map((p) => fact(p.grant.includes("block") || p.grant.includes("Block") ? "Blocked by" : "Targeted by", short(p.displayName), true, p.grant.some((g) => /block/i.test(g)) ? "critical" : "warning")),
    ...excluded.map((p) => fact("Excluded from", short(p.displayName), true, "healthy")),
    ...intunePolicies.map((p) => fact(p.kind, `${p.name}${p.role === "duplicate" || p.role === "conflicting" ? ` (${p.role})` : ""}`, true, p.role === "duplicate" || p.role === "conflicting" ? "warning" : undefined)),
  ];
  const status = groupError || included.some((p) => p.grant.some((g) => /block/i.test(g))) ? "critical" : open.length || intunePolicies.some((p) => p.role === "duplicate" || p.role === "conflicting") ? "warning" : "healthy";
  return {
    entityId: groupName,
    entityType: "group",
    status,
    headline: (groupError
      ? `${groupName}: ${groupError.state}, ${groupError.affectedUsers} members without ${groupError.skuPartNumber}`
      : open.length
        ? `${groupName}: ${open.length} of ${licensed.length} members not on ${inv?.sku.skuPartNumber}`
        : intunePolicies.length
          ? `${groupName}: ${intunePolicies.length} Intune policies assigned${intunePolicies.some((p) => p.role === "duplicate" || p.role === "conflicting") ? ", one conflicting" : ""}`
          : `${groupName}: ${included.length + excluded.length} Conditional Access policies reference it`
    ).slice(0, 120),
    errorCodeTranslation: null,
    facts: facts.slice(0, 8),
    quickActions: [
      ...(included[0] ? [{ id: "inspect-policy", label: "Inspect CA Policy", kind: "inspect-policy" as const, targetEntityId: included[0].id, destructive: false }] : []),
      ...(open.length || groupError ? [{ id: "stage-license-fix", label: "Stage License Fix", kind: "stage-license-fix" as const, targetEntityId: groupName, destructive: false }] : []),
      ...(intunePolicies.length && ctx.intune && !ctx.intune.data.resolved ? [{ id: "stage-intune-fix", label: "Stage Intune Fix", kind: "stage-intune-fix" as const, targetEntityId: groupName, destructive: false }] : []),
    ].slice(0, 2),
  };
}

const INTUNE_ERRORS: Record<string, { meaning: string; likelyCause: string; docsUrl: string }> = {
  "0X87D1FDE8": {
    meaning: "Intune remediation failed: the setting could not be applied on the device.",
    likelyCause: "For BitLocker this is typically two assigned profiles configuring encryption differently (method, or silent vs prompted), so silent encryption never starts.",
    docsUrl: "https://learn.microsoft.com/troubleshoot/mem/intune/device-protection/troubleshoot-bitlocker-policies",
  },
  COUNTVIOLATION: {
    meaning: "Group-based licensing could not assign the license: the tenant has no available seats of the SKU.",
    likelyCause: "Seats are consumed, often by disabled or offboarded accounts that still hold the license directly or through a group.",
    docsUrl: "https://learn.microsoft.com/entra/identity/users/licensing-groups-resolve-problems",
  },
};

function hoverErrorCode(ctx: CorrelationContext, code: string): HoverDiagnosticArgs {
  const upper = code.toUpperCase();
  const intune = INTUNE_ERRORS[upper];
  if (intune) {
    const devices = ctx.intune?.data.devices.filter((d) => d.detail.toUpperCase().includes(upper)) ?? [];
    const errors = ctx.license?.data.groupErrors.filter((e) => e.state.toUpperCase() === upper) ?? [];
    return {
      entityId: code,
      entityType: "errorCode",
      status: devices.length || errors.length ? "critical" : "healthy",
      headline: intune.meaning.slice(0, 120),
      errorCodeTranslation: { code, meaning: intune.meaning, likelyCause: intune.likelyCause, docsUrl: intune.docsUrl },
      facts: [
        ...(devices.length ? [fact("Devices", `${devices.length}: ${devices.map((d) => d.deviceName).join(", ")}`, true, "critical")] : []),
        ...errors.map((e) => fact("Group", `${e.groupName} · ${e.affectedUsers} users`, true, "critical")),
      ],
      quickActions: devices.length
        ? [{ id: "stage-intune-fix", label: "Stage Intune Fix", kind: "stage-intune-fix", destructive: false }]
        : errors.length
          ? [{ id: "stage-license-fix", label: "Stage License Fix", kind: "stage-license-fix", destructive: false }]
          : [],
    };
  }
  const entry = lookupAadsts(code);
  const w = ctx.workloadIdentity;
  if (w && upper === w.errorCodeLabel) {
    return {
      entityId: upper,
      entityType: "errorCode",
      status: "critical",
      headline: `${upper}: nightly GitHub Actions failures of ${w.spn.displayName} since its secret expired`.slice(0, 120),
      errorCodeTranslation: entry ? { code: entry.code, meaning: entry.meaning, likelyCause: entry.likelyCause, docsUrl: entry.docsUrl } : null,
      facts: [
        fact("App", `${w.spn.displayName} (${w.spn.appId})`, true, "critical"),
        fact("Secret", `'${w.passwordCredential.displayName}' expired ${w.passwordCredential.endDateTime.slice(0, 10)}`, true, "critical"),
        fact("Source", w.failureSource, false, "warning"),
        fact("Owner", `${w.owner.upn} · 0 directory roles`, true, "critical"),
      ],
      quickActions: [{ id: "generate-fix", label: "Stage Workload Fix", kind: "generate-fix", targetEntityId: w.spn.servicePrincipalId, destructive: false }],
    };
  }
  const occurrences = (ctx.signIns?.data ?? []).filter((e) => (e.errorCodeLabel ?? "").toUpperCase() === upper);
  const policies = [...new Set(occurrences.map((e) => e.blockingPolicyName).filter((p): p is string => Boolean(p)))];
  const policyIds = [...new Set(occurrences.map((e) => e.blockingPolicyId).filter((p): p is string => Boolean(p)))];
  const upns = [...new Set(occurrences.map((e) => e.upn))];
  return {
    entityId: upper,
    entityType: "errorCode",
    status: occurrences.length ? (entry?.severity === "critical" ? "critical" : "warning") : "unknown",
    headline: entry ? entry.meaning.slice(0, 120) : `${upper}: unknown AADSTS code`,
    errorCodeTranslation: entry ? { code: entry.code, meaning: entry.meaning, likelyCause: entry.likelyCause, docsUrl: entry.docsUrl } : null,
    facts: [
      fact("Occurrences", `${occurrences.length} in current window`, true, occurrences.length ? "critical" : "healthy"),
      ...(upns.length ? [fact("Affected", upns.map((u) => u.split("@")[0]).join(", "), true)] : []),
      ...policies.map((p) => fact("Policy", short(p), true, "critical")),
    ].slice(0, 8),
    quickActions: [
      ...(policyIds[0] ? [{ id: "inspect-policy", label: "Inspect Blocking CA Policy", kind: "inspect-policy" as const, targetEntityId: policyIds[0], destructive: false }] : []),
      { id: "open-sign-in-logs", label: "Open sign-in logs", kind: "open-sign-in-logs" as const, destructive: false },
    ],
  };
}

function hoverPolicy(ctx: CorrelationContext, nameOrId: string): HoverDiagnosticArgs {
  const needle = short(nameOrId).toLowerCase();
  const posture = ctx.caPosture?.data.policies.find((p) => p.id.toLowerCase() === needle || short(p.displayName).toLowerCase() === needle);
  if (posture) {
    return {
      entityId: posture.id,
      entityType: "policy",
      status: posture.drift.some((d) => d.severity === "critical") ? "critical" : posture.drift.length ? "warning" : "healthy",
      headline: `${short(posture.displayName)} · ${posture.state}${posture.drift.length ? ` · ${posture.drift.length} drift` : " · in sync"}`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [
        fact("Include", posture.includeGroups.join(", ") || "—", true),
        fact("Exclude", posture.excludeGroups.join(", ") || "none", true, posture.excludeGroups.length ? undefined : "critical"),
        fact("Grant", posture.grantControls.join(", "), false),
        ...posture.drift.map((d) => fact(`Drift: ${d.field.split(".").at(-1)}`, `${d.actual} → golden ${d.expected}`, true, d.severity === "critical" ? "critical" : "warning")),
      ].slice(0, 8),
      quickActions: [
        { id: "inspect-policy", label: "Inspect Policy", kind: "inspect-policy", targetEntityId: posture.id, destructive: false },
        ...(posture.drift.length ? [{ id: "generate-fix", label: "Stage CA Fix", kind: "generate-fix" as const, destructive: false }] : []),
      ],
    };
  }
  const policy = (ctx.policies?.data ?? []).find((p) => p.id.toLowerCase() === needle || short(p.displayName).toLowerCase() === needle);
  if (policy) {
    const blocked = (ctx.signIns?.data ?? []).filter((e) => e.blockingPolicyId === policy.id || e.blockingPolicyName === policy.displayName);
    return {
      entityId: policy.id,
      entityType: "policy",
      status: blocked.length ? "critical" : "warning",
      headline: `${short(policy.displayName)} · ${policy.state} · ${policy.grant.builtInControls.join("+") || "no grant"}`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [
        fact("Include", policy.includeGroupNames.join(", ") || "—", true),
        fact("Exclude", policy.excludeGroupNames.join(", ") || "none", true),
        fact("Apps", policy.targetApps.map((a) => a.displayName).join(", "), false),
        fact("Blocked sign-ins", String(blocked.length), true, blocked.length ? "critical" : "healthy"),
      ],
      quickActions: [{ id: "inspect-policy", label: "Inspect Policy", kind: "inspect-policy", targetEntityId: policy.id, destructive: false }],
    };
  }
  const intune = ctx.intune?.data.policies.find((p) => p.name.toLowerCase() === needle);
  if (intune) {
    const settings = ctx.intune!.data.settings.filter((s) => s.policyName.toLowerCase().includes(needle) || (intune.role !== "compliance" && s.status === "conflict" && s.policyName.toLowerCase().includes(needle.split("-").slice(-1)[0] ?? "")));
    const bad = settings.filter((s) => s.status !== "in-sync");
    return {
      entityId: intune.name,
      entityType: "policy",
      status: intune.role === "duplicate" || intune.role === "conflicting" ? (intune.assignedTo.length ? "critical" : "healthy") : bad.length ? "warning" : "healthy",
      headline: `${intune.name} · ${intune.kind} · ${intune.role === "duplicate" || intune.role === "conflicting" ? (intune.assignedTo.length ? `${intune.role}, still assigned` : "unassigned") : intune.role}`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [
        fact("Assigned to", intune.assignedTo.join(", ") || "nobody", true),
        fact("Source", intune.source === "live-graph" ? "live Intune (lab tenant)" : "fixture", false),
        ...bad.map((s) => fact(s.settingName.split(" · ").at(-1)!.slice(0, 40), `${s.live} → golden ${s.golden}`, true, s.status === "conflict" ? "critical" : "warning")),
      ].slice(0, 8),
      quickActions: ctx.intune && !ctx.intune.data.resolved ? [{ id: "stage-intune-fix", label: "Stage Intune Fix", kind: "stage-intune-fix", destructive: false }] : [],
    };
  }
  return { entityId: nameOrId, entityType: "policy", status: "unknown", headline: "Policy not found in this scenario's tenant data", errorCodeTranslation: null, facts: [], quickActions: [] };
}

function hoverResource(ctx: CorrelationContext, resourceName: string): HoverDiagnosticArgs {
  const d = ctx.drift?.data;
  const pool = ctx.avd?.data.hostPool;
  if (pool && pool.name.toLowerCase() === resourceName.toLowerCase()) {
    return {
      entityId: pool.name,
      entityType: "resource",
      status: d?.driftState === "drift-detected" ? "warning" : "healthy",
      headline: `${pool.name} · ${pool.poolType} · ${pool.loadBalancer} · ${pool.sessionHosts.length}x ${pool.vmSize}`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [
        fact("Region", pool.location, true),
        fact("Join", pool.joinType, false),
        fact("FSLogix", `${pool.fslogix.status} · ${pool.fslogix.share}`, true),
        fact("Session hosts", pool.sessionHosts.map((h) => `${h.name} ${h.status}`).join(", "), true),
        ...(d ? [fact("Host pool NSG", `${d.resourceName} · ${d.summary}`, true, d.severity === "critical" ? "critical" : d.driftState === "drift-detected" ? "warning" : "healthy")] : []),
      ],
      quickActions: d?.driftState === "drift-detected" ? [{ id: "view-diff", label: "View Diff", kind: "view-diff", targetEntityId: d.resourceName, destructive: false }] : [],
    };
  }
  if (!d || d.resourceName.toLowerCase() !== resourceName.toLowerCase()) {
    return {
      entityId: resourceName,
      entityType: "resource",
      status: "unknown",
      headline: `${resourceName} · no drift tracked in this scenario`,
      errorCodeTranslation: null,
      facts: d ? [fact("Resource group", d.resourceGroup, true)] : [],
      quickActions: [],
    };
  }
  return {
    entityId: d.resourceName,
    entityType: "resource",
    status: d.severity === "critical" ? "critical" : d.driftState === "drift-detected" ? "warning" : "healthy",
    headline: `${d.resourceName}: ${d.summary}`.slice(0, 120),
    errorCodeTranslation: null,
    facts: [
      fact("Resource group", d.resourceGroup, true),
      fact("Baseline", `${d.terraformFile} @ ${d.gitBranch}`, true),
      ...d.rogueSecurityRules.map((r) => fact("Rogue rule", `${r.ruleName} · ${r.protocol.toUpperCase()} ${r.port} from ${r.source} (p${r.priority})`, true, r.severity === "critical" ? "critical" : "warning")),
      ...d.tagDrift.map((t) => fact(`Tag ${t.key}`, `${t.actualInAzure ?? "∅"} → ${t.expectedInTf ?? "∅"}`, true, "warning")),
      fact("Compared against", ctx.drift?.source === "live-azure" ? "live Azure" : "seeded manifest", false),
    ].slice(0, 8),
    quickActions: [
      { id: "view-diff", label: "View Diff", kind: "view-diff", targetEntityId: d.resourceName, destructive: false },
      { id: "generate-fix", label: "Generate Fix & Stage PR", kind: "generate-fix", targetEntityId: d.resourceName, destructive: false },
    ],
  };
}

function hoverSku(ctx: CorrelationContext, sku: string): HoverDiagnosticArgs {
  const inv = ctx.license?.data;
  const pool = inv?.skuPools.find((p) => p.skuPartNumber.toLowerCase() === sku.toLowerCase());
  const holders = inv?.users.filter((u) => u.currentSku.toLowerCase().includes(sku.toLowerCase())) ?? [];
  const waiting = inv?.users.filter((u) => u.expectedSku.toLowerCase() === sku.toLowerCase() && u.assignmentState !== "Active") ?? [];
  const disabled = holders.filter((u) => !u.accountEnabled);
  return {
    entityId: sku,
    entityType: "sku",
    status: pool && pool.available <= 0 && waiting.length ? "critical" : waiting.length || disabled.length ? "warning" : "healthy",
    headline: (pool ? `${pool.skuName}: ${pool.consumed}/${pool.enabled} assigned · ${pool.available} available` : `${sku} is not in this tenant's pools`).slice(0, 120),
    errorCodeTranslation: null,
    facts: [
      ...(pool ? [fact("Pool", `${pool.consumed}/${pool.enabled} · ${pool.source === "live-graph" ? "live subscribedSkus" : "fixture"}`, true, pool.available <= 0 ? "critical" : undefined)] : []),
      ...(waiting.length ? [fact("Waiting", waiting.map((u) => u.displayName).join(", "), false, "warning")] : []),
      ...(disabled.length ? [fact("Disabled holders", disabled.map((u) => u.displayName).join(", "), false, "warning")] : []),
      ...(holders.length && !disabled.length ? [fact("Held by", `${holders.length} users in this scenario`, false)] : []),
    ],
    quickActions: waiting.length || disabled.length ? [{ id: "stage-license-fix", label: "Stage License Fix", kind: "stage-license-fix", destructive: false }] : [],
  };
}

function hoverIntuneItem(ctx: CorrelationContext, target: HoverTarget): HoverDiagnosticArgs {
  const intune = ctx.intune?.data;
  const id = target.entityId.toLowerCase();
  const setting = intune?.settings.find((s) => s.settingId?.toLowerCase() === id || s.settingName.toLowerCase() === id);
  if (setting) {
    return {
      entityId: target.entityId,
      entityType: "setting",
      status: setting.status === "in-sync" ? "healthy" : setting.severity === "critical" || setting.severity === "high" ? "critical" : "warning",
      headline: `${setting.settingName}`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [fact("Policy", setting.policyName, true), fact("Golden", setting.golden, true, "healthy"), fact("Live", setting.live, true, setting.status === "in-sync" ? "healthy" : "critical"), fact("Golden source", intune!.goldenSource, true)],
      quickActions: setting.status !== "in-sync" ? [{ id: "stage-intune-fix", label: "Stage Intune Fix", kind: "stage-intune-fix", destructive: false }] : [],
    };
  }
  const device = intune?.devices.find((d) => d.deviceName.toLowerCase() === id);
  if (device) {
    return {
      entityId: device.deviceName,
      entityType: "device",
      status: device.complianceState === "Compliant" ? "healthy" : "critical",
      headline: `${device.deviceName} · ${device.complianceState}`.slice(0, 120),
      errorCodeTranslation: null,
      facts: [fact("User", device.upn, true), fact("OS", device.os, false), fact("Last check-in", utcTime(device.lastCheckIn), true), fact("Detail", device.detail, false, device.complianceState === "Compliant" ? "healthy" : "warning")],
      quickActions: device.complianceState !== "Compliant" ? [{ id: "stage-intune-fix", label: "Stage Intune Fix", kind: "stage-intune-fix", destructive: false }] : [],
    };
  }
  return hoverGeneric(ctx, target);
}

function hoverGeneric(ctx: CorrelationContext, target: HoverTarget): HoverDiagnosticArgs {
  return {
    entityId: target.entityId,
    entityType: target.entityType,
    status: "unknown",
    headline: `${target.entityId} · ${ctx.erp.tenant.displayName}`.slice(0, 120),
    errorCodeTranslation: null,
    facts: [fact("Scenario", ctx.scenarioId, true), fact("Tenant", ctx.erp.tenant.verifiedDomain, true)],
    quickActions: [],
  };
}
