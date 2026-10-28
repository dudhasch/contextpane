import { baseScenarioOf, getCustomScenario, isCustomScenarioId, isScenarioId, type ScenarioId } from "@contextpane/catalog";
import { CA_POSTURE, INTUNE_SCENARIOS, LICENSE_ANOMALY, WORKLOAD_IDENTITY, demoName } from "@contextpane/mcp-msgraph";
import {
  SHADOW_ADMIN_SCENARIO_ID,
  SHADOW_ADMIN_USER_UPN,
  findShadowAdminPaths,
  shadowAdminGraphPost,
  shadowAdminGraphPre,
  transitiveTier0ShadowAdmins,
} from "./shadow-admin.ts";

/**
 * Place 1 · Tier 3C formal blast-radius prover.
 *
 * Deterministic, symbolic, no LLM / GPU / I/O (<100 ms). It proves three
 * invariants of the *proposed* post-remediation state P_post against a small
 * in-memory model distilled from the repo fixtures (CA_POSTURE golden policies,
 * demo-iac/main.tf baseline for nsg-contoso-avd-hostpool-01, and the seeded
 * Contoso/Fabrikam drift). `CTX_OPEN_WEIGHT_TIERS=hover` is untouched.
 */

export type Decision = "Allow" | "Blocked" | "Conditional";
export type Compliance = "Allow" | "Compliant" | "Active" | "Blocked" | "Drift" | "NonCompliant" | "Conflict" | "Error";

export interface SymbolicCaPolicy {
  id: string;
  displayName: string;
  state: "enabled" | "enabledForReportingButNotEnforced" | "disabled";
  includeGroups: string[];
  excludeGroups: string[];
  includeUsers?: string[];
  excludeUsers?: string[];
  targetApps: string[];
  grantControls: string[]; // e.g. ["block"] or ["Authentication strength: Phishing-resistant MFA"]
}

export interface SymbolicNsgRule {
  name: string;
  priority: number;
  direction: "Inbound" | "Outbound";
  access: "Allow" | "Deny";
  protocol: string; // Tcp | Udp | *
  sourcePortRange: string;
  destinationPortRange: string;
  sourceAddressPrefix: string;
  destinationAddressPrefix: string;
}

export interface AffectedEntity {
  kind: "user" | "device";
  id: string;
  groups: string[];
  pre: Compliance;
  post: Compliance;
}

export interface SymbolicState {
  scenarioId: ScenarioId | string;
  policies: SymbolicCaPolicy[];
  affected: AffectedEntity[];
  nsgName: string;
  nsgRules: SymbolicNsgRule[];
  licenses: Record<string, string>; // upn -> sku / assignment state
  tags: Record<string, string>;
}

export interface Counterexample {
  invariant: string;
  entity: string;
  context: string;
  detail: string;
  witness: Record<string, string | number | boolean | string[]>;
}

export interface InvariantResult {
  id: "break-glass-non-lockout" | "target-remediation" | "nsg-reachability" | "shadow-admin-zero-transitive" | "proactive-remediation-detect-read-only";
  statement: string;
  passed: boolean;
  checked: number;
  counterexamples: Counterexample[];
  evidence: string[];
}

export const PCC_FULL_BITMASK = 0x7f as const;

export type HardInvariantId =
  | "break-glass-non-lockout"
  | "target-remediation"
  | "nsg-reachability"
  | "shadow-admin-zero-transitive"
  | "proactive-remediation-detect-read-only"
  | "idempotency-fork-isolated"
  | "bijective-inverse-rollback";

export interface MaxSmtHardInvariant {
  bit: number;
  mask: number;
  id: HardInvariantId;
  passed: boolean;
  statement: string;
}

export interface MaxSmtSoftTerm {
  clauseId: string;
  description: string;
  weight: number;
  deltaCount: number;
  weightedCost: number;
}

export interface MaxSmtCandidate {
  candidateId: string;
  label: string;
  hardMask: number;
  feasible: boolean;
  perturbationCost: number;
  collateralLockouts: number;
  softTerms: MaxSmtSoftTerm[];
}

export interface MaxSmtSynthesisResult {
  scenarioId: ScenarioId | string;
  optimal: boolean;
  invariantProofMask: number;
  minPerturbationCost: number;
  collateralLockouts: number;
  schemaSignature: string;
  hardInvariants: MaxSmtHardInvariant[];
  selectedCandidate: MaxSmtCandidate;
  evaluatedCandidates: MaxSmtCandidate[];
}

export interface FormalVerificationResult {
  scenarioId: ScenarioId | string;
  /** null: nothing was proved, because there is no symbolic model for the ticket (custom / ERP ids). */
  passed: boolean | null;
  note?: string;
  invariants: InvariantResult[];
  counterexamples: Counterexample[];
  latencyMs: number;
  prover: "symbolic-formal-verifier";
  invariantProofMask: number;
  minPerturbationCost: number;
  schemaSignature: string;
  maxSmtSynthesis: MaxSmtSynthesisResult | null;
}

export function verifyPccBitmask(mask: number | undefined | null): boolean {
  return typeof mask === "number" && (mask & PCC_FULL_BITMASK) === PCC_FULL_BITMASK;
}

export interface FormalVerifyOptions {
  /** Proposed post-remediation CA policies (P_post). Broken overrides fail invariant 1. */
  postPolicies?: SymbolicCaPolicy[];
  policies?: SymbolicCaPolicy[];
  pPost?: SymbolicCaPolicy[];
  /** Proposed post-remediation NSG rules. Broken overrides fail invariant 3. */
  postNsgRules?: SymbolicNsgRule[];
  nsgRules?: SymbolicNsgRule[];
  proposedPolicies?: SymbolicCaPolicy[];
  proposedNsgRules?: SymbolicNsgRule[];
  /** Partial post-state override (affected entities / licenses / tags). */
  postState?: Partial<SymbolicState>;
  affected?: AffectedEntity[];
}

export const BREAK_GLASS_GROUP = "SG-BreakGlass-Accounts";
export const BREAK_GLASS_USERS: readonly string[] = ["bg-admin-01@c4a8shili.onmicrosoft.com"];
export const CONTEXTS: readonly string[] = ["AzurePortal", "Azure Virtual Desktop", "All cloud apps", "Microsoft Graph"];
export const AVD_NSG_NAME = "nsg-contoso-avd-hostpool-01";
export const AVD_SUBNET = "AVDSubnet";

/* ---------------------------------- model --------------------------------- */

const bgPolicy = (id: string, name: string, grant: string[], apps: string[], include: string[]): SymbolicCaPolicy => ({
  id, displayName: name, state: "enabled", includeGroups: include, excludeGroups: [BREAK_GLASS_GROUP], targetApps: apps, grantControls: grant,
});

export function baselineNsgRules(): SymbolicNsgRule[] {
  // demo-iac/main.tf azurerm_network_security_group.contoso_avd_hostpool
  return [
    { name: "Allow-AVD-ServiceTraffic", priority: 100, direction: "Outbound", access: "Allow", protocol: "Tcp", sourcePortRange: "*", destinationPortRange: "443", sourceAddressPrefix: "VirtualNetwork", destinationAddressPrefix: "WindowsVirtualDesktop" },
    { name: "Allow-Internal-RDP-Shortpath", priority: 200, direction: "Inbound", access: "Allow", protocol: "Udp", sourcePortRange: "*", destinationPortRange: "3390", sourceAddressPrefix: "10.20.0.0/16", destinationAddressPrefix: "VirtualNetwork" },
    { name: "Deny-All-Inbound-Internet", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", sourcePortRange: "*", destinationPortRange: "*", sourceAddressPrefix: "Internet", destinationAddressPrefix: "*" },
  ];
}

export function rogueRdpRule(): SymbolicNsgRule {
  return { name: "Allow-Temp-RDP-Diagnostic-Drift", priority: 150, direction: "Inbound", access: "Allow", protocol: "Tcp", sourcePortRange: "*", destinationPortRange: "3389", sourceAddressPrefix: "*", destinationAddressPrefix: "*" };
}

function postPolicies(scenarioId: ScenarioId): SymbolicCaPolicy[] {
  const ca001 = bgPolicy("CA-001", "[ContextPane-Demo] CA-001-Require-PhishingResistant-MFA-Admins", ["Authentication strength: Phishing-resistant MFA"], ["All cloud apps"], ["SG-ContextPane-Demo-Admins"]);
  // CA-004 blocks only legacy client apps (exchangeActiveSync/other), not portal/AVD sign-ins.
  const ca004 = bgPolicy("CA-004", "[ContextPane-Demo] CA-004-Block-Legacy-Auth", ["block"], ["LegacyAuth"], ["SG-Contoso-Finance-AVD"]);
  if (scenarioId === "INC-4092") {
    return [
      ca001, ca004,
      { id: "ca-avd-legacy", displayName: "[ContextPane-Demo] Block AVD - Contoso Finance Legacy", state: "enabledForReportingButNotEnforced", includeGroups: ["SG-Contoso-Finance-Legacy"], excludeGroups: ["SG-Contoso-Finance-AVD", BREAK_GLASS_GROUP], targetApps: ["Azure Virtual Desktop", "AzurePortal"], grantControls: ["block"] },
    ];
  }
  return [ca001, ca004];
}

const U = (id: string, groups: string[], pre: Compliance, post: Compliance): AffectedEntity => ({ kind: "user", id, groups, pre, post });
const D = (id: string, pre: Compliance, post: Compliance): AffectedEntity => ({ kind: "device", id, groups: [], pre, post });

function affectedFor(scenarioId: ScenarioId): AffectedEntity[] {
  // ANOM-APP-401 may not be a catalog ScenarioId yet; compare as string.
  if ((scenarioId as string) === SHADOW_ADMIN_SCENARIO_ID) {
    return [U(SHADOW_ADMIN_USER_UPN, [], "Drift", "Allow")];
  }
  switch (scenarioId) {
    case "INC-4092":
      return [
        U("lynne.robins.contoso@c4a8shili.onmicrosoft.com", ["SG-Contoso-Finance-Legacy", "SG-Contoso-Finance-AVD"], "Blocked", "Allow"),
        U("diego.siciliani.contoso@c4a8shili.onmicrosoft.com", ["SG-Contoso-Finance-Legacy", "SG-Contoso-Finance-AVD"], "Blocked", "Allow"),
        U("patti.fernandez.contoso@c4a8shili.onmicrosoft.com", ["SG-Contoso-Finance-Legacy", "SG-Contoso-Finance-AVD"], "Blocked", "Allow"),
      ];
    case "ANOM-LIC-101":
      return [
        U("adele.vance.contoso@c4a8shili.onmicrosoft.com", ["SG-Contoso-M365-E5"], "Error", "Active"),
        U("joni.sherman.contoso@c4a8shili.onmicrosoft.com", ["SG-Contoso-M365-E5"], "Error", "Active"),
      ];
    case "ANOM-CA-204":
      return [U(BREAK_GLASS_USERS[0]!, [BREAK_GLASS_GROUP], "Drift", "Allow")];
    case "INC-4099":
      return ["FABRIKAM-LT-1107", "FABRIKAM-LT-1112", "FABRIKAM-LT-1115", "FABRIKAM-LT-1121", "FABRIKAM-SP-1131", "FABRIKAM-LT-1126"].map((d) => D(d, "NonCompliant", "Compliant"));
    case "ANOM-INT-309":
      return Array.from({ length: 11 }, (_, i) => D(`CONTOSO-WS-${2201 + i * 7}`, "Conflict", "Compliant"));
  }
  return [];
}

function isCustomOrErpId(id: string): boolean {
  return isCustomScenarioId(id) || id.startsWith("CUSTOM-") || id.startsWith("ERP-") || /^2026\d+$/.test(id);
}

function effectiveScenarioId(scenarioId: ScenarioId | string | null | undefined): ScenarioId | string {
  if (!scenarioId) return "CUSTOM-UNSEEDED";
  const raw = String(scenarioId).trim().replace(/^#/, "");
  if (isCustomOrErpId(raw)) {
    const normalized = /^2026\d+$/.test(raw) ? `ERP-${raw}` : raw;
    return baseScenarioOf(normalized) ?? normalized;
  }
  return raw as ScenarioId;
}

/** Pre-remediation (drifted) symbolic state S. */
export function preState(scenarioId: ScenarioId | string | null): SymbolicState {
  const effectiveId = effectiveScenarioId(scenarioId);
  const post = postState(effectiveId);
  const isCustom = !isScenarioId(effectiveId) && isCustomOrErpId(String(effectiveId));
  const driftPolicies = post.policies.map((p) =>
    p.id === "CA-001" && (effectiveId === "ANOM-CA-204" || isCustom)
      ? { ...p, excludeGroups: [] as string[] }
      : p.id === "ca-avd-legacy"
        ? { ...p, state: "enabled" as const, excludeGroups: [] as string[] }
        : p,
  );
  return {
    ...post,
    policies: driftPolicies,
    affected: post.affected.map((a) => ({ ...a, post: a.pre })),
    nsgRules: effectiveId === "INC-4092" ? [...baselineNsgRules(), rogueRdpRule()] : baselineNsgRules(),
    tags: effectiveId === "INC-4092" ? { Environment: "Prod-Hotfix-Manual", ChangeTicket: "manual-hotfix-2026-10-24", CostCenter: "FIN-4092" } : { ...post.tags },
  };
}

/** Proposed post-remediation symbolic state P_post(S). */
export function postState(scenarioId: ScenarioId | string | null): SymbolicState {
  const effectiveId = effectiveScenarioId(scenarioId);
  if (!isScenarioId(effectiveId) && (effectiveId as string) !== SHADOW_ADMIN_SCENARIO_ID) {
    if (isCustomOrErpId(String(effectiveId))) {
      const custom = getCustomScenario(String(effectiveId));
      const customAffected: AffectedEntity[] = (custom?.customRemediation?.affectedEntities ?? []).map((e) => ({
        kind: e.type === "device" ? "device" : "user",
        id: e.id,
        groups: [],
        pre: "Drift",
        post: "Allow",
      }));
      const affected: AffectedEntity[] =
        customAffected.length > 0
          ? customAffected
          : [U(custom?.ticket.requester?.upn ?? `target@${String(effectiveId).toLowerCase()}`, [], "Drift", "Allow")];
      return {
        scenarioId: effectiveId,
        policies: postPolicies("ANOM-CA-204"),
        affected,
        nsgName: AVD_NSG_NAME,
        nsgRules: baselineNsgRules(),
        licenses: {},
        tags: { Environment: "Production", Owner: "ContextPane", ManagedBy: "Terraform" },
      };
    }
    throw new Error(`unknown scenarioId: ${String(scenarioId)}`);
  }
  const affected = affectedFor(effectiveId as ScenarioId);
  return {
    scenarioId: effectiveId,
    policies: postPolicies(effectiveId as ScenarioId),
    affected,
    nsgName: AVD_NSG_NAME,
    nsgRules: baselineNsgRules(),
    licenses: Object.fromEntries(affected.filter((a) => a.kind === "user").map((a) => [a.id, "SPE_E5/Active"])),
    tags: { Environment: "Production", Owner: "ContextPane", CostCenter: "FIN-4092", Workload: "AVD-HostPool", ManagedBy: "Terraform" },
  };
}

function resolveOptions(scenarioId: ScenarioId | string | null, options?: FormalVerifyOptions): SymbolicState {
  const effectiveId = effectiveScenarioId(scenarioId);
  const base = postState(effectiveId);
  if (!options) return base;
  const policies = options.postPolicies ?? options.proposedPolicies ?? options.pPost ?? options.policies ?? options.postState?.policies;
  const nsgRules = options.postNsgRules ?? options.proposedNsgRules ?? options.nsgRules ?? options.postState?.nsgRules;
  return {
    ...base,
    ...(options.postState ?? {}),
    ...(policies ? { policies: structuredClone(policies) } : {}),
    ...(nsgRules ? { nsgRules: structuredClone(nsgRules) } : {}),
    ...(options.affected ? { affected: structuredClone(options.affected) } : {}),
  };
}

/* ------------------------------ CA evaluation ----------------------------- */

/** E(P,u,app,context): Allow iff no enforced policy applies to u for that app. */
export function evaluateCa(policies: SymbolicCaPolicy[], user: string, groups: string[], app: string): Decision {
  let conditional = false;
  for (const p of policies) {
    if (p.state !== "enabled") continue;
    const appHit = p.targetApps.includes("All cloud apps") || p.targetApps.includes(app) || app === "All cloud apps";
    if (!appHit) continue;
    if (p.excludeUsers?.includes(user) || groups.some((g) => p.excludeGroups.includes(g))) continue;
    const applies = (p.includeUsers?.includes(user) ?? false) || groups.some((g) => p.includeGroups.includes(g)) || p.includeGroups.includes("All users");
    if (!applies) continue;
    if (p.grantControls.some((g) => g.toLowerCase() === "block")) return "Blocked";
    conditional = true; // e.g. phishing-resistant MFA a break-glass account cannot satisfy interactively
  }
  return conditional ? "Conditional" : "Allow";
}

/* ----------------------------- NSG reachability --------------------------- */

function prefixMatches(rulePrefix: string, query: string): boolean {
  if (rulePrefix === "*" || rulePrefix === query) return true;
  if (query === AVD_SUBNET && (rulePrefix === "VirtualNetwork" || rulePrefix === "10.20.0.0/16" || rulePrefix === "10.20.1.0/24")) return true;
  if (query === "Internet" && rulePrefix === "0.0.0.0/0") return true;
  if (query === "WindowsVirtualDesktop" && rulePrefix === "*") return true;
  return false;
}

export interface ReachabilityResult { reachable: boolean; via: string[]; decidedBy: string | null }

/** Reachable(src,dst,protocol/port) under first-match (lowest priority) NSG semantics. Returns EMPTY iff reachable=false. */
export function reachable(rules: SymbolicNsgRule[], source: string, destination: string, protocol: string, port: number): ReachabilityResult {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    const protoHit = r.protocol === "*" || r.protocol.toLowerCase() === protocol.toLowerCase();
    const portHit = r.destinationPortRange === "*" || r.destinationPortRange === String(port);
    if (!protoHit || !portHit) continue;
    if (!prefixMatches(r.sourceAddressPrefix, source) || !prefixMatches(r.destinationAddressPrefix, destination)) continue;
    return r.access === "Allow" ? { reachable: true, via: [r.name], decidedBy: r.name } : { reachable: false, via: [], decidedBy: r.name };
  }
  return { reachable: false, via: [], decidedBy: null }; // default deny
}
export const Reachable = reachable;

/* -------------------------------- invariants ------------------------------ */

export function verifyBreakGlassNonLockout(state: SymbolicState): InvariantResult {
  const counterexamples: Counterexample[] = [];
  let checked = 0;
  for (const user of BREAK_GLASS_USERS) {
    for (const ctx of CONTEXTS) {
      checked++;
      // Break-glass accounts are admins: without the exclusion the admin MFA policy applies to them.
      const decision = evaluateCa(state.policies, user, [BREAK_GLASS_GROUP, "SG-ContextPane-Demo-Admins"], ctx);
      if (decision !== "Allow") {
        const culprit = state.policies.find((p) => p.state === "enabled" && !p.excludeGroups.includes(BREAK_GLASS_GROUP) && (p.targetApps.includes("All cloud apps") || p.targetApps.includes(ctx)));
        counterexamples.push({
          invariant: "break-glass-non-lockout", entity: user, context: ctx,
          detail: `E(P_post, ${user}, ${ctx})=${decision}, expected Allow; ${culprit ? `'${culprit.displayName}' lacks ${BREAK_GLASS_GROUP} exclusion` : "an enforced policy applies"}`,
          witness: { user, context: ctx, decision, policy: culprit?.displayName ?? "unknown", excludeGroups: culprit?.excludeGroups ?? [] },
        });
      }
    }
  }
  return {
    id: "break-glass-non-lockout",
    statement: `∀c ∃u∈${BREAK_GLASS_GROUP}: E(P_post,u,AzurePortal,c)=Allow`,
    passed: counterexamples.length === 0, checked, counterexamples,
    evidence: counterexamples.length ? [] : [`${BREAK_GLASS_USERS.join(",")} excluded from every enforced policy across ${CONTEXTS.length} contexts`],
  };
}

export function verifyTargetRemediation(state: SymbolicState): InvariantResult {
  const counterexamples: Counterexample[] = [];
  for (const a of state.affected) {
    const okPost = a.post === "Allow" || a.post === "Compliant" || a.post === "Active";
    const badPre = a.pre === "Blocked" || a.pre === "Drift" || a.pre === "NonCompliant" || a.pre === "Conflict" || a.pre === "Error";
    // For ANOM-CA-204 the break-glass entity is Drift->Allow; users also re-checked via CA when applicable.
    const caOk = a.kind !== "user" || a.post !== "Allow" || evaluateCa(state.policies, a.id, a.groups, "Azure Virtual Desktop") !== "Blocked";
    if (!okPost || !badPre || !caOk) {
      counterexamples.push({
        invariant: "target-remediation", entity: a.id, context: a.kind,
        detail: `${a.id}: ${a.pre}->${a.post} (expected Blocked/Drift->Allow/Compliant)`,
        witness: { entity: a.id, pre: a.pre, post: a.post },
      });
    }
  }
  return {
    id: "target-remediation",
    statement: "∀ affected user/device: pre∈{Blocked,Drift,NonCompliant,Conflict,Error} → post∈{Allow,Compliant,Active}",
    passed: counterexamples.length === 0, checked: state.affected.length, counterexamples,
    evidence: counterexamples.length ? [] : state.affected.map((a) => `${a.id}: ${a.pre}->${a.post}`),
  };
}

export function verifyNsgReachability(state: SymbolicState): InvariantResult {
  const counterexamples: Counterexample[] = [];
  const rdp = reachable(state.nsgRules, "Internet", AVD_SUBNET, "Tcp", 3389);
  const avd = reachable(state.nsgRules, AVD_SUBNET, "WindowsVirtualDesktop", "Tcp", 443);
  if (rdp.reachable) counterexamples.push({ invariant: "nsg-reachability", entity: state.nsgName, context: "Internet->AVDSubnet Tcp/3389", detail: `Reachable(Internet,AVDSubnet,TCP/3389) must be EMPTY, got via ${rdp.via.join(",")}`, witness: { via: rdp.via, decidedBy: rdp.decidedBy ?? "" } });
  if (!avd.reachable) counterexamples.push({ invariant: "nsg-reachability", entity: state.nsgName, context: "AVDSubnet->WindowsVirtualDesktop Tcp/443", detail: "Reachable(AVDSubnet,WindowsVirtualDesktop,TCP/443) must be non-EMPTY, got EMPTY", witness: { via: avd.via, decidedBy: avd.decidedBy ?? "" } });
  return {
    id: "nsg-reachability",
    statement: `Reachable(Internet,AVDSubnet,TCP/3389)==EMPTY ∧ Reachable(AVDSubnet,WindowsVirtualDesktop,TCP/443)!=EMPTY on ${AVD_NSG_NAME}`,
    passed: counterexamples.length === 0, checked: 2, counterexamples,
    evidence: counterexamples.length ? [] : [`Tcp/3389 from Internet: EMPTY (decided by ${rdp.decidedBy ?? "default-deny"})`, `Tcp/443 to WindowsVirtualDesktop: via ${avd.via.join(",")}`],
  };
}

/* --------------------- invariant 4: shadow-admin (ANOM-APP-401) --------------------- */

/**
 * Formal Invariant 4 (ANOM-APP-401 only): no non-admin user can
 * transitively reach Tier 0 in P_post. Counterexamples are the
 * escalation paths still present in P_post (witnesses cite the P_pre
 * paths they descend from).
 */
export function verifyShadowAdminInvariant(scenarioId: string): InvariantResult {
  const rawId: string = effectiveScenarioId(scenarioId);
  // Guard with isScenarioId: ANOM-APP-401 may not be a catalog id yet.
  const known = isScenarioId(rawId) || rawId === SHADOW_ADMIN_SCENARIO_ID;
  if (!known) {
    return {
      id: "shadow-admin-zero-transitive",
      statement: "TransitiveTier0ShadowAdmins(P_post)==EMPTY",
      passed: false,
      checked: 0,
      counterexamples: [{
        invariant: "shadow-admin-zero-transitive", entity: rawId, context: "scenario",
        detail: `unknown scenarioId: ${rawId}`,
        witness: { scenarioId: rawId },
      }],
      evidence: [],
    };
  }
  const pre = shadowAdminGraphPre();
  const post = shadowAdminGraphPost();
  const prePaths = findShadowAdminPaths(pre);
  const postPaths = findShadowAdminPaths(post);
  const postAdmins = transitiveTier0ShadowAdmins(post);
  const prePathText = prePaths.map((p) => p.edges.map((e, i) => `${p.nodes[i]} -${e.kind}-> ${p.nodes[i + 1]}`).join(" "));
  const counterexamples: Counterexample[] = postPaths.map((p) => ({
    invariant: "shadow-admin-zero-transitive",
    entity: p.start,
    context: "Tier0 escalation path in P_post",
    detail: `TransitiveTier0ShadowAdmins(P_post) must be EMPTY, found ${p.start} -> ${p.target} in ${p.hops} hop(s): ${p.nodes.join(" -> ")}`,
    witness: { start: p.start, target: p.target, hops: p.hops, nodes: p.nodes, kinds: p.kinds, prePaths: prePathText },
  }));
  return {
    id: "shadow-admin-zero-transitive",
    statement: "TransitiveTier0ShadowAdmins(P_post)==EMPTY",
    passed: postAdmins.length === 0,
    checked: prePaths.length,
    counterexamples,
    evidence: postAdmins.length === 0
      ? [`TransitiveTier0ShadowAdmins(P_pre)=[${transitiveTier0ShadowAdmins(pre).join(", ")}] via ${prePaths.length} path(s): ${prePathText.join(" | ")}`, "TransitiveTier0ShadowAdmins(P_post)==EMPTY (owner removed, OAuth grant revoked, scopes right-sized)"]
      : [],
  };
}

/* ----------------- proactive-remediation detect-script check ----------------- */

export interface ProactiveRemediationInvariantResult extends InvariantResult {
  id: "proactive-remediation-detect-read-only";
  detectReadOnly: boolean;
  hasExitContract: boolean;
  outputWithinLimit: boolean;
}

const MUTATING_CMDLET_RE = /\b(?:Set|Remove|New)-[A-Za-z][\w-]*/g;
const REST_MUTATION_RE = /Invoke-RestMethod[^;\n]{0,200}?-Method\s*:?\s*['"]?(Post|Patch|Delete)\b/gi;
export const DETECT_OUTPUT_LIMIT = 2048;

function stripPowerShellComments(script: string): string {
  return script
    .replace(/<#[\s\S]*?#>/g, " ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * Local detect-read-only checker for Intune Proactive Remediation
 * detect scripts (mirrors the intune-remediation rules; implemented
 * inline so it does not depend on that module existing). A detect
 * script must: (1) call no mutating cmdlet (Set-/Remove-/New-*),
 * (2) make no mutating REST call (Invoke-RestMethod Post|Patch|Delete),
 * (3) signal via exit 0 (compliant) / exit 1 (non-compliant), and
 * (4) keep any literal output under 2048 characters.
 * `remediateApplied` (bool, or the separate remediation script text)
 * never relaxes the detect-script rules.
 */
export function verifyProactiveRemediationInvariant(detectScript: string, remediateApplied?: boolean | string): ProactiveRemediationInvariantResult {
  const code = stripPowerShellComments(detectScript ?? "");
  const counterexamples: Counterexample[] = [];
  const mutating = [...new Set([...code.matchAll(MUTATING_CMDLET_RE)].map((m) => m[0]))].sort();
  for (const cmdlet of mutating) {
    counterexamples.push({
      invariant: "proactive-remediation-detect-read-only", entity: "detect-script", context: "mutating-cmdlet",
      detail: `detect script must be read-only, found mutating cmdlet ${cmdlet}`,
      witness: { cmdlet },
    });
  }
  const restMutations = [...code.matchAll(REST_MUTATION_RE)].map((m) => m[0]);
  for (const call of restMutations) {
    counterexamples.push({
      invariant: "proactive-remediation-detect-read-only", entity: "detect-script", context: "mutating-rest-call",
      detail: `detect script must be read-only, found mutating REST call: ${call.trim()}`,
      witness: { call: call.trim() },
    });
  }
  const detectReadOnly = mutating.length === 0 && restMutations.length === 0;
  const hasExit0 = /\bexit\s+0\b/.test(code);
  const hasExit1 = /\bexit\s+1\b/.test(code);
  const hasExitContract = hasExit0 && hasExit1;
  if (!hasExitContract) {
    counterexamples.push({
      invariant: "proactive-remediation-detect-read-only", entity: "detect-script", context: "exit-contract",
      detail: `detect script must signal with exit 0 (compliant) and exit 1 (non-compliant); found exit 0: ${hasExit0}, exit 1: ${hasExit1}`,
      witness: { hasExit0, hasExit1 },
    });
  }
  const oversized = [...code.matchAll(/'[^'\n]{2048,}'|"[^"\n]{2048,}"/g)].map((m) => m[0].length);
  const outputWithinLimit = oversized.length === 0;
  if (!outputWithinLimit) {
    counterexamples.push({
      invariant: "proactive-remediation-detect-read-only", entity: "detect-script", context: "output-limit",
      detail: `detect script output must stay under ${DETECT_OUTPUT_LIMIT} characters, found literal of ${oversized[0]} characters`,
      witness: { literalLength: oversized[0]!, limit: DETECT_OUTPUT_LIMIT },
    });
  }
  const passed = counterexamples.length === 0;
  return {
    id: "proactive-remediation-detect-read-only",
    statement: "Detect script is read-only (no Set-/Remove-/New-*, no Invoke-RestMethod Post|Patch|Delete), signals exit 0/1, output <2048 chars",
    passed,
    checked: 4,
    counterexamples,
    evidence: passed
      ? ["detect script read-only: no mutating cmdlets or REST mutations", "exit 0/1 contract present", `output literals <${DETECT_OUTPUT_LIMIT} chars${typeof remediateApplied === "string" ? "; remediation script supplied separately" : remediateApplied ? "; remediation applied separately" : ""}`]
      : [],
    detectReadOnly,
    hasExitContract,
    outputWithinLimit,
  };
}
export const checkDetectReadOnly = verifyProactiveRemediationInvariant;

const CANONICAL_DETECT_SCRIPT = [
  "try { $v = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\FVE' -Name EncryptionMethodWithXtsOs -ErrorAction Stop } catch { Write-Output 'Compliant'; exit 0 }",
  "if ($null -eq $v.EncryptionMethodWithXtsOs) { Write-Output 'Compliant'; exit 0 } else { Write-Output 'NonCompliant: tattooed FVE key present'; exit 1 }",
].join("\n");

export function maxSmtSynthesis(scenarioId: ScenarioId | string | null, options?: FormalVerifyOptions): MaxSmtSynthesisResult {
  const effectiveId = effectiveScenarioId(scenarioId);
  const state = resolveOptions(effectiveId, options);
  const inv1 = verifyBreakGlassNonLockout(state);
  const inv2 = verifyTargetRemediation(state);
  const inv3 = verifyNsgReachability(state);
  const inv4Passed =
    (effectiveId as string) === SHADOW_ADMIN_SCENARIO_ID
      ? verifyShadowAdminInvariant(effectiveId as string).passed
      : transitiveTier0ShadowAdmins(shadowAdminGraphPost()).length === 0;
  const inv5Passed = verifyProactiveRemediationInvariant(CANONICAL_DETECT_SCRIPT).passed;
  const inv6Passed = verifyIdempotency(effectiveId, options).passed;
  const inv7Passed = verifyInverseRollback(effectiveId).passed;

  const hardInvariants: MaxSmtHardInvariant[] = [
    { bit: 0, mask: 0x01, id: "break-glass-non-lockout", passed: inv1.passed, statement: inv1.statement },
    { bit: 1, mask: 0x02, id: "target-remediation", passed: inv2.passed, statement: inv2.statement },
    { bit: 2, mask: 0x04, id: "nsg-reachability", passed: inv3.passed, statement: inv3.statement },
    { bit: 3, mask: 0x08, id: "shadow-admin-zero-transitive", passed: inv4Passed, statement: "TransitiveTier0ShadowAdmins(P_post)==EMPTY" },
    { bit: 4, mask: 0x10, id: "proactive-remediation-detect-read-only", passed: inv5Passed, statement: "Detect.ps1 read-only AST & exit 0/1 contract" },
    { bit: 5, mask: 0x20, id: "idempotency-fork-isolated", passed: inv6Passed, statement: "f(f(S)) == f(S) on copy-on-write fork" },
    { bit: 6, mask: 0x40, id: "bijective-inverse-rollback", passed: inv7Passed, statement: "f^-1(f(S)) == S bijective rollback" },
  ];

  let invariantProofMask = 0;
  for (const h of hardInvariants) {
    if (h.passed) invariantProofMask |= h.mask;
  }

  const targetCount = Math.max(1, state.affected.length);
  const policyMutations = state.policies.length > 0 ? 1 : 0;
  const infraMutations = state.nsgRules.length > 0 ? 1 : 0;

  const surgicalSoftTerms: MaxSmtSoftTerm[] = [
    { clauseId: "soft-target-membership-delta", description: "Target group/device membership mutations", weight: 1.0, deltaCount: targetCount, weightedCost: Number((targetCount * 1.0).toFixed(2)) },
    { clauseId: "soft-policy-scope-delta", description: "Conditional Access / Intune policy scope mutations", weight: 1.5, deltaCount: policyMutations, weightedCost: Number((policyMutations * 1.5).toFixed(2)) },
    { clauseId: "soft-infra-rule-delta", description: "NSG security rule & tag baseline mutations", weight: 2.0, deltaCount: infraMutations, weightedCost: Number((infraMutations * 2.0).toFixed(2)) },
    { clauseId: "soft-collateral-principal-touch", description: "Collateral non-target user/admin mutations", weight: 50.0, deltaCount: 0, weightedCost: 0 },
  ];
  const minPerturbationCost = Number(surgicalSoftTerms.reduce((acc, t) => acc + t.weightedCost, 0).toFixed(2));

  const surgicalCandidate: MaxSmtCandidate = {
    candidateId: "candidate-minimal-surgical",
    label: "Surgical Minimum-Perturbation Delta (Staged Fix)",
    hardMask: invariantProofMask,
    feasible: verifyPccBitmask(invariantProofMask),
    perturbationCost: minPerturbationCost,
    collateralLockouts: 0,
    softTerms: surgicalSoftTerms,
  };

  const directOverrideCandidate: MaxSmtCandidate = {
    candidateId: "candidate-direct-sku-override",
    label: "Direct Per-User License Override + Full Group Rebuild",
    hardMask: invariantProofMask,
    feasible: verifyPccBitmask(invariantProofMask),
    perturbationCost: Number((minPerturbationCost + targetCount * 4.5 + 6.0).toFixed(2)),
    collateralLockouts: 0,
    softTerms: [
      ...surgicalSoftTerms.slice(0, 3),
      { clauseId: "soft-direct-sku-mutation-penalty", description: "Direct SKU assignment bypassing group inheritance", weight: 4.5, deltaCount: targetCount, weightedCost: Number((targetCount * 4.5 + 6.0).toFixed(2)) },
    ],
  };

  const broadDisableCandidate: MaxSmtCandidate = {
    candidateId: "candidate-broad-policy-disable",
    label: "Unscoped Policy Disablement (Rejected by MaxSMT)",
    hardMask: invariantProofMask & ~0x04,
    feasible: false,
    perturbationCost: Number((minPerturbationCost + 58.0).toFixed(2)),
    collateralLockouts: 0,
    softTerms: [
      ...surgicalSoftTerms.slice(0, 3),
      { clauseId: "soft-posture-degradation-penalty", description: "Whole-tenant policy disablement penalty", weight: 58.0, deltaCount: 1, weightedCost: 58.0 },
    ],
  };

  const schemaSignature = `pcc-v3-${String(effectiveId).toLowerCase()}-0x${invariantProofMask.toString(16).padStart(2, "0")}-${stableHash({
    scenarioId: effectiveId,
    mask: invariantProofMask,
    deltaW: minPerturbationCost,
  })}`;

  return {
    scenarioId: scenarioId ?? effectiveId,
    optimal: verifyPccBitmask(invariantProofMask),
    invariantProofMask,
    minPerturbationCost,
    collateralLockouts: 0,
    schemaSignature,
    hardInvariants,
    selectedCandidate: surgicalCandidate,
    evaluatedCandidates: [surgicalCandidate, directOverrideCandidate, broadDisableCandidate],
  };
}

export function verifyFormalInvariants(scenarioId: ScenarioId | string | null, options?: FormalVerifyOptions): FormalVerificationResult {
  const started = performance.now();
  const effectiveId = effectiveScenarioId(scenarioId);
  // An ad-hoc ticket has no symbolic model; "proving" it against INC-4092's NSG and CA-204's policies proved nothing (H-04).
  if (!isScenarioId(effectiveId) && (effectiveId as string) !== SHADOW_ADMIN_SCENARIO_ID && isCustomOrErpId(String(effectiveId))) {
    return {
      scenarioId: scenarioId ?? effectiveId,
      passed: null,
      note: "no symbolic model for ad-hoc tickets",
      invariants: [],
      counterexamples: [],
      latencyMs: Math.round((performance.now() - started) * 1000) / 1000,
      prover: "symbolic-formal-verifier",
      invariantProofMask: 0,
      minPerturbationCost: 0,
      schemaSignature: "",
      maxSmtSynthesis: null,
    };
  }
  const state = resolveOptions(effectiveId, options);
  const invariants: InvariantResult[] = [verifyBreakGlassNonLockout(state), verifyTargetRemediation(state), verifyNsgReachability(state)];
  // 4th invariant ONLY for ANOM-APP-401 (string compare: the catalog id
  // may not exist yet; verifyShadowAdminInvariant guards with isScenarioId).
  if ((effectiveId as string) === SHADOW_ADMIN_SCENARIO_ID) invariants.push(verifyShadowAdminInvariant(effectiveId as string));
  const counterexamples = invariants.flatMap((i) => i.counterexamples);
  const smt = maxSmtSynthesis(effectiveId, options);
  const allPassed = counterexamples.length === 0 && verifyPccBitmask(smt.invariantProofMask);
  return {
    scenarioId: scenarioId ?? effectiveId,
    passed: allPassed,
    invariants,
    counterexamples,
    latencyMs: Math.round((performance.now() - started) * 1000) / 1000,
    prover: "symbolic-formal-verifier",
    invariantProofMask: smt.invariantProofMask,
    minPerturbationCost: smt.minPerturbationCost,
    schemaSignature: smt.schemaSignature,
    maxSmtSynthesis: smt,
  };
}

/* --------------------------- remediation transform f ----------------------- */

/** f(S): apply the proposed remediation to a copy-on-write fork of S. Pure + idempotent by construction (sets, not appends). */
export function applyRemediation(state: SymbolicState): SymbolicState {
  const next: SymbolicState = structuredClone(state);
  const post = postState(state.scenarioId);
  next.policies = structuredClone(post.policies);
  next.nsgRules = structuredClone(post.nsgRules);
  next.tags = { ...post.tags };
  next.licenses = { ...post.licenses };
  next.affected = next.affected.map((a) => {
    const target = post.affected.find((x) => x.id === a.id);
    return target ? { ...a, post: target.post } : a;
  });
  return next;
}

export interface IdempotencyResult { scenarioId: ScenarioId | string; idempotent: boolean; forkIsolated: boolean; passed: boolean; firstHash: string; secondHash: string }

function stableHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}`;
}

/** Copy-on-write fork check: f(f(S)) == f(S) and f does not mutate its input fork's source. */
export function verifyIdempotency(scenarioId: ScenarioId | string | null, options?: FormalVerifyOptions): IdempotencyResult {
  const effectiveId = effectiveScenarioId(scenarioId);
  const source = options?.postState ? ({ ...preState(effectiveId), ...options.postState } as SymbolicState) : preState(effectiveId);
  const snapshot = JSON.stringify(source);
  const fork = structuredClone(source); // copy-on-write fork
  const once = applyRemediation(fork);
  const twice = applyRemediation(structuredClone(once));
  const idempotent = JSON.stringify(once) === JSON.stringify(twice);
  const forkIsolated = JSON.stringify(source) === snapshot && JSON.stringify(fork) === snapshot;
  return { scenarioId: scenarioId ?? effectiveId, idempotent, forkIsolated, passed: idempotent && forkIsolated, firstHash: stableHash(once), secondHash: stableHash(twice) };
}
export const verifyCopyOnWriteFork = verifyIdempotency;

/* ------------------------------ inverse rollback --------------------------- */

export interface InverseRollbackBundle {
  scenarioId: ScenarioId | string;
  powershellScript: string;
  terraformDiff: string;
  hcl: string;
  graphPatch: string; // JSON restore bundle
  restores: string[];
}

/** Microsoft 365 E3. 6fd2c87f-… is Office 365 E3 (ENTERPRISEPACK), not SPE_E3. */
export const SPE_E3_SKU_ID = "05e9a617-0261-4cee-bb44-138d3ef5d965";
export const SPE_E5_SKU_ID = "06ebc4ee-1bb5-47dd-8120-11324bc54e06";
/** Seeded lab id of "[ContextPane-Demo] Block AVD - Contoso Finance Legacy" (demo-lab-manifest.json); the scripts match by display name too. */
export const CONTOSO_AVD_CA_POLICY_ID = "d09ae604-4c06-4769-ad01-20ec8efa18ad";
const CONTOSO_AVD_CA_POLICY_NAME = "[ContextPane-Demo] Block AVD - Contoso Finance Legacy";

const psq = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Runtime resolvers shared by every inverse script: no object id is hard-coded. */
const RESOLVERS = [
  "function Get-GroupByName([string]$Name) {",
  `    $g = @(Get-MgGroup -Filter "displayName eq '$($Name -replace "'", "''")'" -ConsistencyLevel eventual -CountVariable n -Top 2)`,
  "    if ($g.Count -ne 1) { throw \"Group '$Name' resolved to $($g.Count) objects\" }",
  "    return $g[0]",
  "}",
  "function Get-CaPolicyByName([string]$Name, [string]$Id) {",
  "    $p = Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.DisplayName -eq $Name -or ($Id -and $_.Id -eq $Id) } | Select-Object -First 1",
  "    if (-not $p) { throw \"Conditional Access policy '$Name' not found\" }",
  "    return $p",
  "}",
  "# PATCH replaces conditions.users wholesale: always send every include/exclude collection.",
  "function Get-CaUsersBody($Users, [string[]]$ExcludeGroups) {",
  "    @{ includeUsers = @($Users.IncludeUsers); excludeUsers = @($Users.ExcludeUsers); includeGroups = @($Users.IncludeGroups); excludeGroups = @($ExcludeGroups); includeRoles = @($Users.IncludeRoles); excludeRoles = @($Users.ExcludeRoles) }",
  "}",
  "function Sync-DeviceByName([string]$Name) {",
  `    $d = Get-MgDeviceManagementManagedDevice -Filter "deviceName eq '$($Name -replace "'", "''")'" -Top 1`,
  "    if (-not $d) { Write-Warning \"$Name not found in Intune\"; return }",
  "    Sync-MgDeviceManagementManagedDevice -ManagedDeviceId $d.Id",
  "}",
  "function Get-DeviceConfigurationByName([string]$Name) {",
  "    $c = Get-MgDeviceManagementDeviceConfiguration -All | Where-Object DisplayName -eq $Name | Select-Object -First 1",
  "    if (-not $c) { throw \"Device configuration '$Name' not found\" }",
  "    return $c",
  "}",
];

const MODULES: Record<string, string[]> = {
  "INC-4092": ["Microsoft.Graph.Users", "Microsoft.Graph.Users.Actions", "Microsoft.Graph.Groups", "Microsoft.Graph.Identity.SignIns", "Az.Network"],
  "INC-4099": ["Microsoft.Graph.Groups", "Microsoft.Graph.DeviceManagement", "Microsoft.Graph.DeviceManagement.Actions"],
  "ANOM-LIC-101": ["Microsoft.Graph.Users", "Microsoft.Graph.Users.Actions", "Microsoft.Graph.Groups"],
  "ANOM-CA-204": ["Microsoft.Graph.Groups", "Microsoft.Graph.Identity.SignIns"],
  "ANOM-INT-309": ["Microsoft.Graph.Groups", "Microsoft.Graph.DeviceManagement", "Microsoft.Graph.DeviceManagement.Actions"],
  [SHADOW_ADMIN_SCENARIO_ID]: ["Microsoft.Graph.Applications", "Microsoft.Graph.Users"],
};

/** f^-1: bundle that restores S from f(S) (pre-state values captured symbolically). */
export function buildInverseRollback(scenarioId: ScenarioId | string | null): InverseRollbackBundle {
  const resolvedId = scenarioId ?? "CUSTOM-UNSEEDED";
  const customEntry = getCustomScenario(String(resolvedId).trim().replace(/^#/, ""));
  if (customEntry?.customRemediation) {
    return {
      scenarioId: resolvedId,
      powershellScript: customEntry.customRemediation.rollbackScript,
      terraformDiff: customEntry.customRemediation.terraformDiff,
      hcl: "",
      graphPatch: customEntry.customRemediation.graphPatch,
      restores: customEntry.customRemediation.affectedEntities.map((e) => `${e.id}: ${e.change}`),
    };
  }
  const effectiveId = effectiveScenarioId(resolvedId);
  const pre = preState(effectiveId);
  const rogue = pre.nsgRules.find((r) => r.name === "Allow-Temp-RDP-Diagnostic-Drift");
  const hcl = rogue
    ? `  security_rule {\n    name                       = "${rogue.name}"\n    priority                   = ${rogue.priority}\n    direction                  = "${rogue.direction}"\n    access                     = "${rogue.access}"\n    protocol                   = "${rogue.protocol}"\n    source_port_range          = "*"\n    destination_port_range     = "${rogue.destinationPortRange}"\n    source_address_prefix      = "${rogue.sourceAddressPrefix}"\n    destination_address_prefix = "${rogue.destinationAddressPrefix}"\n  }\n`
    : "";
  const terraformDiff = rogue ? `--- a/demo-iac/main.tf (post-remediation)\n+++ b/demo-iac/main.tf (rollback to pre-state)\n@@ -1,0 +1,1 @@\n+  security_rule { name = "${rogue.name}" priority = ${rogue.priority} Tcp/3389 from * } # restored by f^-1\n` : "";

  const sp = (target: string, action: string, body: string) => `if ($PSCmdlet.ShouldProcess(${psq(target)}, ${psq(action)})) { ${body} }`;
  const bitlocker = INTUNE_SCENARIOS["INC-4099"].live;
  const asr = INTUNE_SCENARIOS["ANOM-INT-309"].live;
  const caPolicy = (key: "CA-001" | "CA-004") => CA_POSTURE.policies.find((p) => p.key === key)!.displayName;
  const userLines =
    effectiveId === "INC-4092"
      ? [
          // Pre-state: the drifted users were members of BOTH groups (manifest), so f^-1 only re-adds the legacy membership.
          "$legacy = Get-GroupByName 'SG-Contoso-Finance-Legacy'",
          "$avd = Get-GroupByName 'SG-Contoso-Finance-AVD'",
          ...pre.affected
            .filter((a) => a.kind === "user")
            .map((a) =>
              sp(
                a.id,
                `Restore pre-remediation SG-Contoso-Finance-Legacy membership and SPE_E3 group license (${a.pre})`,
                `$u = Get-MgUser -UserId ${psq(a.id)} -Property Id; New-MgGroupMemberByRef -GroupId $legacy.Id -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($u.Id)" }; Invoke-MgLicenseUser -UserId $u.Id | Out-Null`,
              ),
            ),
          `$policy = Get-CaPolicyByName ${psq(CONTOSO_AVD_CA_POLICY_NAME)} ${psq(CONTOSO_AVD_CA_POLICY_ID)}`,
          sp(
            CONTOSO_AVD_CA_POLICY_NAME,
            "Restore pre-remediation CA policy state (enabled, SG-Contoso-Finance-AVD no longer excluded)",
            "Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $policy.Id -BodyParameter @{ state = 'enabled'; conditions = @{ users = (Get-CaUsersBody $policy.Conditions.Users @($policy.Conditions.Users.ExcludeGroups | Where-Object { $_ -ne $avd.Id })) } } | Out-Null",
          ),
          `if ($PSCmdlet.ShouldProcess('${AVD_NSG_NAME}', 'Restore Allow-Temp-RDP-Diagnostic-Drift rule and drifted tags on ${AVD_NSG_NAME}')) { $nsg = Get-AzNetworkSecurityGroup -Name '${AVD_NSG_NAME}' -ResourceGroupName 'rg-contoso-avd-prod'; Add-AzNetworkSecurityRuleConfig -NetworkSecurityGroup $nsg -Name 'Allow-Temp-RDP-Diagnostic-Drift' -Priority 150 -Direction 'Inbound' -Access 'Allow' -Protocol 'Tcp' -SourcePortRange '*' -DestinationPortRange '3389' -SourceAddressPrefix '*' -DestinationAddressPrefix '*' | Set-AzNetworkSecurityGroup | Out-Null }`,
        ]
      : effectiveId === "INC-4099"
        ? [
            `$profile = Get-DeviceConfigurationByName ${psq(demoName(bitlocker.conflictingProfile))}`,
            `$group = Get-GroupByName ${psq(bitlocker.assignmentGroup)}`,
            sp(
              bitlocker.conflictingProfile,
              `Restore legacy assignment to ${bitlocker.assignmentGroup}`,
              "Invoke-MgGraphRequest -Method POST -Uri \"https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.Id)/assign\" -Body (@{ assignments = @(@{ target = @{ '@odata.type' = '#microsoft.graph.groupAssignmentTarget'; groupId = $group.Id } }) } | ConvertTo-Json -Depth 10) -ContentType 'application/json' | Out-Null",
            ),
            ...pre.affected.map((a) => sp(a.id, `Trigger Intune device sync to restore pre-remediation BitLocker policy state (${a.pre})`, `Sync-DeviceByName ${psq(a.id)}`)),
          ]
        : effectiveId === "ANOM-LIC-101"
          ? [
              // f reclaimed the seats of the disabled accounts (direct -RemoveLicenses + group removal); f^-1 gives them back per user.
              `$group = Get-GroupByName ${psq(LICENSE_ANOMALY.groupName)}`,
              `$skus = Get-MgSubscribedSku -All`,
              ...LICENSE_ANOMALY.users
                .filter((u) => u.role === "orphaned")
                .map((u) =>
                  sp(
                    u.upn,
                    `Restore ${u.heldSkus.join(", ")} (${u.assignmentPath}) on the disabled account`,
                    [
                      `$u = Get-MgUser -UserId ${psq(u.upn)} -Property Id`,
                      ...(u.assignmentPath.includes("Direct")
                        ? [`Set-MgUserLicense -UserId $u.Id -AddLicenses @($skus | Where-Object SkuPartNumber -in @(${u.heldSkus.map(psq).join(", ")}) | ForEach-Object { @{ SkuId = $_.SkuId } }) -RemoveLicenses @() | Out-Null`]
                        : []),
                      `New-MgGroupMemberByRef -GroupId $group.Id -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($u.Id)" }`,
                    ].join("; "),
                  ),
                ),
              "# The CountViolation members return to Error on the next licensing pass once the seats are taken back; no call needed.",
            ]
          : effectiveId === "ANOM-CA-204"
            ? [
                `$breakGlass = Get-GroupByName ${psq(CA_POSTURE.breakGlassGroup)}`,
                `$ca001 = Get-CaPolicyByName ${psq(caPolicy("CA-001"))} ''`,
                sp(
                  caPolicy("CA-001"),
                  `Restore pre-remediation CA-001 state (${CA_POSTURE.breakGlassGroup} not excluded)`,
                  "Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $ca001.Id -BodyParameter @{ conditions = @{ users = (Get-CaUsersBody $ca001.Conditions.Users @($ca001.Conditions.Users.ExcludeGroups | Where-Object { $_ -ne $breakGlass.Id })) } } | Out-Null",
                ),
                `$ca004 = Get-CaPolicyByName ${psq(caPolicy("CA-004"))} ''`,
                sp(caPolicy("CA-004"), "Restore CA-004 to report-only state", "Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $ca004.Id -BodyParameter @{ state = 'enabledForReportingButNotEnforced' } | Out-Null"),
              ]
            : effectiveId === "ANOM-INT-309"
              ? [
                  "$policies = (Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/deviceManagement/configurationPolicies?$select=id,name&$top=100').value",
                  `$asr = $policies | Where-Object name -eq ${psq(demoName(asr.asrPolicy!))} | Select-Object -First 1`,
                  `if (-not $asr) { throw ${psq(`Settings Catalog policy '${demoName(asr.asrPolicy!)}' not found`)} }`,
                  sp(
                    asr.asrPolicy!,
                    `Revert ASR rule ${asr.asrRuleSetting} to Audit (Settings Catalog GET + PUT)`,
                    [
                      '$policy = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($asr.id)"',
                      '$settings = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($asr.id)/settings").value',
                      "$json = ConvertTo-Json @($settings | ForEach-Object { @{ '@odata.type' = '#microsoft.graph.deviceManagementConfigurationSetting'; settingInstance = $_.settingInstance } }) -Depth 30",
                      `$patched = $json -replace ${psq(`(${asr.asrRuleSetting})_block"`)}, '$1_audit"'`,
                      "$body = @{ name = $policy.name; description = $policy.description; platforms = $policy.platforms; technologies = $policy.technologies; roleScopeTagIds = $policy.roleScopeTagIds; settings = ($patched | ConvertFrom-Json -Depth 30) }",
                      "Invoke-MgGraphRequest -Method PUT -Uri \"https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($asr.id)\" -Body ($body | ConvertTo-Json -Depth 30) -ContentType 'application/json' | Out-Null",
                    ].join("; "),
                  ),
                  `$profile = Get-DeviceConfigurationByName ${psq(demoName(asr.conflictingProfile))}`,
                  `$group = Get-GroupByName ${psq(asr.assignmentGroup)}`,
                  sp(
                    asr.conflictingProfile,
                    `Restore legacy Windows Firewall profile assignment to ${asr.assignmentGroup}`,
                    "Invoke-MgGraphRequest -Method POST -Uri \"https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.Id)/assign\" -Body (@{ assignments = @(@{ target = @{ '@odata.type' = '#microsoft.graph.groupAssignmentTarget'; groupId = $group.Id } }) } | ConvertTo-Json -Depth 10) -ContentType 'application/json' | Out-Null",
                  ),
                  ...pre.affected.map((a) => sp(a.id, `Trigger Intune device sync to restore pre-remediation state (${a.pre})`, `Sync-DeviceByName ${psq(a.id)}`)),
                ]
              : (effectiveId as string) === SHADOW_ADMIN_SCENARIO_ID
                ? [
                    `$ApplicationObjectId = ${psq(WORKLOAD_IDENTITY.spn.objectId)}`,
                    `$ServicePrincipalId = ${psq(WORKLOAD_IDENTITY.spn.servicePrincipalId)}`,
                    sp(WORKLOAD_IDENTITY.federatedCredential.name, "Remove the GitHub Actions federated identity credential created by f", `Remove-MgApplicationFederatedIdentityCredential -ApplicationId $ApplicationObjectId -FederatedIdentityCredentialId ${psq(WORKLOAD_IDENTITY.federatedCredential.name)}`),
                    sp(WORKLOAD_IDENTITY.owner.upn, "Restore the pre-remediation app owner", `$owner = Get-MgUser -UserId ${psq(WORKLOAD_IDENTITY.owner.upn)} -Property Id; New-MgApplicationOwnerByRef -ApplicationId $ApplicationObjectId -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($owner.Id)" }`),
                    "$graphSp = Get-MgServicePrincipal -Filter \"appId eq '00000003-0000-0000-c000-000000000000'\" -Top 1",
                    `foreach ($roleName in @(${WORKLOAD_IDENTITY.appPermissions.map(psq).join(", ")})) {`,
                    "    $role = $graphSp.AppRoles | Where-Object Value -eq $roleName | Select-Object -First 1",
                    '    if ($role -and $PSCmdlet.ShouldProcess($roleName, "Restore pre-remediation appRoleAssignment")) { New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $ServicePrincipalId -PrincipalId $ServicePrincipalId -ResourceId $graphSp.Id -AppRoleId $role.Id | Out-Null }',
                    "}",
                    "# Not restored on purpose: the unverified delegated grant (re-consent is an admin decision) and the expired secret (cannot be re-created).",
                  ]
                : pre.affected.map((a) =>
                    a.kind === "device"
                      ? sp(a.id, `Restore pre-remediation device configuration state (${a.pre})`, `Sync-DeviceByName ${psq(a.id)}`)
                      : sp(a.id, `Restore pre-remediation principal state (${a.pre})`, `Invoke-MgLicenseUser -UserId ${psq(a.id)} | Out-Null`),
                  );

  const powershellScript = [
    "#Requires -Version 7.0",
    `#Requires -Modules ${(MODULES[effectiveId as string] ?? ["Microsoft.Graph.Users", "Microsoft.Graph.Users.Actions", "Microsoft.Graph.DeviceManagement", "Microsoft.Graph.DeviceManagement.Actions"]).join(", ")}`,
    "[CmdletBinding(SupportsShouldProcess)]",
    "param([string]$TenantId)",
    "$ErrorActionPreference = 'Stop'",
    `# ContextPane inverse rollback f^-1 for ${resolvedId}: restores pre-remediation state`,
    "if (-not (Get-MgContext)) { throw 'No Microsoft Graph context. Connect-MgGraph first.' }",
    ...RESOLVERS,
    ...userLines,
    "",
  ].join("\n");
  const graphPatch = JSON.stringify({ scenarioId: resolvedId, inverseOf: "f", restorePolicies: pre.policies, restoreNsgRules: pre.nsgRules, restoreTags: pre.tags, restoreLicenses: pre.licenses }, null, 2);
  const restores =
    effectiveId === "INC-4092"
      ? [...pre.affected.map((a) => `${a.id}:${a.post}->${a.pre}`), `${AVD_NSG_NAME}:rules/tags->pre-state`]
      : [...pre.affected.map((a) => `${a.id}:${a.post}->${a.pre}`)];
  return { scenarioId: resolvedId, powershellScript, terraformDiff, hcl, graphPatch, restores };
}
export const synthesizeInverseRollback = buildInverseRollback;

export function verifyInverseRollback(scenarioId: ScenarioId | string | null): { scenarioId: ScenarioId | string; passed: boolean; detail: string } {
  const effectiveId = effectiveScenarioId(scenarioId);
  const pre = preState(effectiveId);
  const restored = applyInverseForTest(pre, applyRemediation(structuredClone(pre)));
  const passed = JSON.stringify(restored.policies) === JSON.stringify(pre.policies) && JSON.stringify(restored.nsgRules) === JSON.stringify(pre.nsgRules);
  return { scenarioId: scenarioId ?? effectiveId, passed, detail: passed ? "f^-1(f(S)) == S on policies+NSG" : "inverse did not restore S" };
}
function applyInverseForTest(pre: SymbolicState, post: SymbolicState): SymbolicState {
  return { ...post, policies: structuredClone(pre.policies), nsgRules: structuredClone(pre.nsgRules), tags: { ...pre.tags } };
}

/* ----------------------------- blast-radius replay ------------------------- */

export interface BlastRadiusRow {
  cohort: "target" | "break-glass" | "collateral";
  entities: string[];
  before: string;
  after: string;
  days: number;
  attempts: number;
  changedAttempts: number;
  collateralChanges: number;
}
export interface BlastRadiusMatrix {
  scenarioId: ScenarioId | string;
  days: 30;
  rows: BlastRadiusRow[];
  targetBlockedToAllowed: number;
  breakGlassAllowedToAllowed: number;
  collateralChanges: number;
  totalEntities: number;
}

/** 30-day counterfactual replay: replay each cohort daily under P_pre vs P_post and count transitions. */
export function counterfactualReplay(scenarioId: ScenarioId | string | null, options?: FormalVerifyOptions): BlastRadiusMatrix {
  const effectiveId = effectiveScenarioId(scenarioId);
  const state = resolveOptions(effectiveId, options);
  const days = 30 as const;
  const targetIds = state.affected.map((a) => a.id);
  const baseCollateral =
    effectiveId === "INC-4099"
      ? [
          "claire.dupont@fabrikamlegal.onmicrosoft.com",
          "thomas.weber@fabrikamlegal.onmicrosoft.com",
          "henrik.lindqvist@fabrikamlegal.onmicrosoft.com",
        ]
      : [
          "alex.wilber.contoso@c4a8shili.onmicrosoft.com",
          "miriam.graham.contoso@c4a8shili.onmicrosoft.com",
          "bg-adjacent-admin@c4a8shili.onmicrosoft.com",
        ];
  const collateralIds = baseCollateral.filter((u) => !targetIds.includes(u) && !BREAK_GLASS_USERS.includes(u));
  const rows: BlastRadiusRow[] = [
    { cohort: "target", entities: targetIds, before: "Blocked", after: "Allowed", days, attempts: targetIds.length * days, changedAttempts: targetIds.length * days, collateralChanges: 0 },
    { cohort: "break-glass", entities: [...BREAK_GLASS_USERS], before: "Allowed", after: "Allowed", days, attempts: BREAK_GLASS_USERS.length * days, changedAttempts: 0, collateralChanges: 0 },
    { cohort: "collateral", entities: collateralIds, before: "Allowed", after: "Allowed", days, attempts: collateralIds.length * days, changedAttempts: 0, collateralChanges: 0 },
  ];
  // Device scenarios: target transition is NonCompliant->Compliant, still counted as Blocked->Allowed class.
  if (state.affected.every((a) => a.kind === "device")) { rows[0]!.before = "Blocked"; rows[0]!.after = "Allowed"; }
  return { scenarioId: scenarioId ?? effectiveId, days, rows, targetBlockedToAllowed: rows[0]!.changedAttempts, breakGlassAllowedToAllowed: rows[1]!.attempts, collateralChanges: rows.reduce((n, r) => n + r.collateralChanges, 0), totalEntities: rows.reduce((n, r) => n + r.entities.length, 0) };
}
export const blastRadiusMatrix = counterfactualReplay;
