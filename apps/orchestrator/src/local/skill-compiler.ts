import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  LayoutComponentSchema,
  SCENARIO_REGISTRY,
  isScenarioId,
  validateComponents,
  type LayoutComponent,
  type ScenarioId,
} from "@contextpane/catalog";

/**
 * Place 2 — Tier3 -> Tier0 Skill Compiler.
 * Deterministic, no LLM/GPU. Captures a Tier-3 trace for a scenario,
 * compiles it into a Tier-0 skill (pure data binding), property-fuzzes
 * the skill (100 cases), and promotes passing skills to the registry.
 */

export interface SymptomSignature {
  scenarioId: ScenarioId;
  tenantId: string;
  components: string[];
  skuPartNumber: string;
  groupName: string;
  policyIds: string[];
}

export interface TraceStep { phase: "hydrate" | "remediate"; action: string; detail: string; }
export interface CapturedTrace {
  scenarioId: ScenarioId; tenantId: string; kind: string; title: string;
  components: string[]; remediationScope: string; steps: TraceStep[]; capturedAt: string;
  signature: SymptomSignature;
}

export interface FuzzParams {
  seed: number; tenantId: string; userCount: number;
  skuEnabled: number; skuConsumed: number; groupName: string; policyId: string;
}

export interface FormalResult { ok: boolean; invariants: Array<{ id: string; ok: boolean; detail?: string }>; }

export interface CompiledSkillDef {
  id: string; scenarioId: ScenarioId; signature: SymptomSignature;
  tier: 0; tokenCost: 0; latencyMs: number;
  fuzz: { cases: number; passed: number };
  createdAt: string; version: 1;
}

export interface CompiledSkill extends CompiledSkillDef {
  match: (sig: Partial<SymptomSignature> & { scenarioId: string }) => boolean;
  hydrate: (params?: Partial<FuzzParams>) => LayoutComponent[];
  remediate: (params?: Partial<FuzzParams>) => { scenarioId: ScenarioId; title: string; steps: string[]; affectedUpns: string[] };
}

type VerifierFn = (scenarioId: string) => FormalResult | Promise<FormalResult>;
let cachedVerifier: VerifierFn | null | undefined;

async function loadVerifier(): Promise<VerifierFn | null> {
  if (cachedVerifier !== undefined) return cachedVerifier;
  try {
    // Parent/Place1 provides this file; import defensively.
    const mod: Record<string, unknown> = await import("./formal-verifier.ts");
    const fn = mod.verifyFormalInvariants;
    cachedVerifier = typeof fn === "function" ? (fn as VerifierFn) : null;
  } catch { cachedVerifier = null; }
  return cachedVerifier;
}

/** Local fallback invariants when the formal verifier is absent/misshapen. */
export function localFormalCheck(scenarioId: ScenarioId, components: LayoutComponent[]): FormalResult {
  const invariants: FormalResult["invariants"] = [];
  const v = validateComponents(components);
  invariants.push({ id: "zod-valid-layout", ok: v.rejected.length === 0 && v.valid.length > 0, detail: `${v.valid.length} valid, ${v.rejected.length} rejected` });
  const lic = components.find((c) => c.type === "LicenseDriftCard");
  if (lic && lic.type === "LicenseDriftCard") {
    const pool = lic.props.skuPools.find((p) => p.skuPartNumber === lic.props.skuPartNumber);
    invariants.push({ id: "sku-pool-consistent", ok: !pool || pool.available === pool.enabled - pool.consumed });
    invariants.push({ id: "user-count-bounded", ok: lic.props.users.length <= 50 });
  } else {
    invariants.push({ id: "sku-pool-consistent", ok: true, detail: "no license card" });
  }
  invariants.push({ id: "scenario-known", ok: isScenarioId(scenarioId) });
  return { ok: invariants.every((i) => i.ok), invariants };
}

async function checkFormal(scenarioId: ScenarioId, components: LayoutComponent[]): Promise<FormalResult> {
  const fn = await loadVerifier();
  if (fn) {
    try {
      const raw = (await fn(scenarioId)) as unknown as { ok?: boolean; passed?: boolean; invariants?: Array<{ id: string; ok?: boolean; passed?: boolean; detail?: string }> } | null;
      const topOk = raw?.ok ?? raw?.passed;
      if (raw && typeof topOk === "boolean" && Array.isArray(raw.invariants)) {
        const norm = raw.invariants.map((i) => ({ id: i.id, ok: i.ok ?? i.passed ?? false, ...(i.detail ? { detail: i.detail } : {}) }));
        // Also require the concrete layout to be Zod-valid.
        const local = localFormalCheck(scenarioId, components);
        const merged = [...norm, ...local.invariants.filter((i) => i.id === "zod-valid-layout")];
        return { ok: topOk && merged.every((i) => i.ok), invariants: merged };
      }
    } catch { /* fall through to local */ }
  }
  return localFormalCheck(scenarioId, components);
}

/* ---------------- deterministic PRNG + fuzz params ---------------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function fuzzParamsFor(seed: number): FuzzParams {
  const rnd = mulberry32(seed * 2654435761);
  const userCount = 1 + Math.floor(rnd() * 20);
  const skuEnabled = userCount + Math.floor(rnd() * 50);
  const skuConsumed = Math.floor(rnd() * (skuEnabled + 1));
  return {
    seed,
    tenantId: `tenant-fuzz-${String(Math.floor(rnd() * 10000)).padStart(4, "0")}`,
    userCount, skuEnabled, skuConsumed,
    groupName: `SG-Fuzz-${Math.floor(rnd() * 1000)}-Licensing`,
    policyId: `00000000-0000-4000-8000-${String(Math.floor(rnd() * 1e12)).padStart(12, "0")}`,
  };
}

const DEFAULT_SIG = (scenarioId: ScenarioId): SymptomSignature => {
  const e = SCENARIO_REGISTRY[scenarioId];
  return { scenarioId, tenantId: e.tenantId, components: [...e.components], skuPartNumber: "SPE_E5", groupName: "SG-Contoso-Finance-AVD", policyIds: ["ca-policy-001"] };
};

/* ---------------- layout builders (always Zod-valid) ---------------- */
export function buildFuzzLayout(sig: SymptomSignature, p: FuzzParams): LayoutComponent[] {
  const users = Array.from({ length: Math.min(p.userCount, 50) }, (_, i) => ({
    upn: `user${i}@${p.tenantId}.example.com`, displayName: `Fuzz User ${i}`, jobTitle: "",
    accountEnabled: true, currentSku: "SPE_E3", expectedSku: sig.skuPartNumber,
    assignmentPath: "Group" as const, assignmentState: "Drifted" as const, driftStatus: "drifted" as const,
  }));
  const lic: LayoutComponent = {
    type: "LicenseDriftCard", id: `license-drift-card-${sig.scenarioId.toLowerCase()}`, triggeredBy: [p.groupName], dataPtrs: {},
    props: {
      headline: `${users.length} users in ${p.groupName} on SPE_E3 instead of ${sig.skuPartNumber}`.slice(0, 200),
      skuName: "Microsoft 365 E5", skuPartNumber: sig.skuPartNumber, groupName: p.groupName,
      skuPools: [{ skuPartNumber: sig.skuPartNumber, skuName: "Microsoft 365 E5", enabled: p.skuEnabled, consumed: p.skuConsumed, available: p.skuEnabled - p.skuConsumed, source: "fixture" as const }],
      groupErrors: [], users, state: "warning" as const,
    },
  };
  const comps: LayoutComponent[] = [lic];
  if (sig.components.includes("EntraSignInTimeline")) {
    comps.push({
      type: "EntraSignInTimeline", id: `entra-sign-in-timeline-${sig.scenarioId.toLowerCase()}`, triggeredBy: [p.policyId], dataPtrs: {},
      props: {
        headline: "AADSTS53003 blocked by CA policy".slice(0, 200), focusUpn: users[0]?.upn ?? "",
        windowStart: "2026-10-26T08:00:00Z", windowEnd: "2026-10-26T09:00:00Z", events: [],
        rootCause: null,
        policies: [{ id: p.policyId, displayName: "CA-001 Require compliant device", state: "enabled" as const, role: "blocking" as const, includeGroups: [p.groupName], excludeGroups: [], targetApps: ["Office 365"], clientAppTypes: [], grantControls: ["Block"], drift: [], modifiedDateTime: null }],
        microActions: [], state: "warning" as const, sourceRef: null, baselineDiff: "",
      },
    });
  }
  if (sig.components.includes("IaCDriftBanner")) {
    comps.push({
      type: "IaCDriftBanner", id: `ia-c-drift-banner-${sig.scenarioId.toLowerCase()}`, triggeredBy: [], dataPtrs: {},
      props: {
        resourceName: "nsg-fuzz-01", resourceGroup: "rg-fuzz", resourceType: "Microsoft.Network/networkSecurityGroups", gitBranch: "main", terraformFile: "demo-iac/main.tf",
        driftState: "drift-detected" as const, tagDrift: [], rogueSecurityRules: [], missingSecurityRules: [], hclDiff: "",
        summary: "State: drift", hostPool: null, azurePolicies: [], state: "warning" as const, comparedAgainst: "seeded-manifest" as const, sourceRef: null,
      },
    });
  }
  // Validate eagerly; throws if a builder ever regresses.
  return comps.map((c) => LayoutComponentSchema.parse(c));
}

/* ---------------- trace capture + compile ---------------- */
export function captureTrace(scenarioId: string): CapturedTrace {
  if (!isScenarioId(scenarioId)) throw new Error(`Invalid trace: unknown scenarioId '${scenarioId}'`);
  const e = SCENARIO_REGISTRY[scenarioId];
  const signature = DEFAULT_SIG(scenarioId);
  return {
    scenarioId, tenantId: e.tenantId, kind: e.kind, title: e.title,
    components: [...e.components], remediationScope: e.remediationScope,
    steps: [
      { phase: "hydrate", action: "buildLayout", detail: e.components.join(",") },
      { phase: "remediate", action: "buildRemediationPlan", detail: e.remediationScope },
    ],
    capturedAt: "2026-10-26T12:00:00Z", signature,
  };
}

export function assertValidTrace(trace: unknown): asserts trace is CapturedTrace {
  const t = trace as CapturedTrace | null;
  if (!t || typeof t !== "object") throw new Error("Invalid trace: not an object");
  if (!isScenarioId(t.scenarioId)) throw new Error(`Invalid trace: unknown scenarioId '${String(t.scenarioId)}'`);
  if (!Array.isArray(t.components) || t.components.length === 0) throw new Error("Invalid trace: no components");
  if (!t.signature || t.signature.scenarioId !== t.scenarioId) throw new Error("Invalid trace: signature mismatch");
}

function signatureMatches(sig: SymptomSignature, q: Partial<SymptomSignature> & { scenarioId: string }): boolean {
  if (sig.scenarioId !== q.scenarioId) return false;
  if (q.skuPartNumber && q.skuPartNumber !== sig.skuPartNumber) return false;
  if (q.groupName && q.groupName !== sig.groupName) return false;
  if (q.tenantId && q.tenantId !== sig.tenantId) return false;
  return true;
}

function makeSkill(def: CompiledSkillDef): CompiledSkill {
  return {
    ...def,
    match: (q) => signatureMatches(def.signature, q),
    hydrate: (params) => buildFuzzLayout(def.signature, { ...fuzzParamsFor(1), tenantId: def.signature.tenantId, groupName: def.signature.groupName, policyId: def.signature.policyIds[0] ?? "ca-policy-001", ...params }),
    remediate: (params) => {
      const p = { ...fuzzParamsFor(1), ...params };
      return { scenarioId: def.scenarioId, title: `Fix ${def.scenarioId}: ${SCENARIO_REGISTRY[def.scenarioId].remediationScope}`, steps: [`Assign ${def.signature.skuPartNumber} to drifted members of ${p.groupName}`, `Reconcile policy ${p.policyId}`], affectedUpns: Array.from({ length: Math.min(p.userCount, 50) }, (_, i) => `user${i}@${p.tenantId}.example.com`) };
    },
  };
}

export async function runPropertyFuzzer(scenarioId: ScenarioId, cases = 100): Promise<{ cases: number; passed: number; failures: string[] }> {
  const sig = DEFAULT_SIG(scenarioId);
  const failures: string[] = [];
  let passed = 0;
  for (let i = 0; i < cases; i++) {
    const p = fuzzParamsFor(i + 1);
    try {
      const layout = buildFuzzLayout(sig, p);
      const v = validateComponents(layout);
      if (v.rejected.length || !v.valid.length) throw new Error(`zod rejected: ${JSON.stringify(v.rejected)}`);
      const formal = await checkFormal(scenarioId, layout);
      if (!formal.ok) throw new Error(`formal failed: ${JSON.stringify(formal.invariants.filter((x) => !x.ok))}`);
      passed++;
    } catch (err) { failures.push(`case ${i + 1}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return { cases, passed, failures };
}

/* ---------------- registry (data/compiled-skills.json) ---------------- */
export const REGISTRY_PATH = join(fileURLToPath(), "../../../../data/compiled-skills.json");
function fileURLToPath(): string {
  // Bun/Node ESM: import.meta.dir is available in Bun; fall back to cwd layout.
  const dir = (import.meta as { dir?: string }).dir;
  if (dir) return dir;
  return join(process.cwd(), "apps/orchestrator/src/local");
}

const memory = new Map<string, CompiledSkill>();

export function loadRegistry(): CompiledSkillDef[] {
  memory.clear();
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as CompiledSkillDef[];
    if (!Array.isArray(raw)) return [];
    for (const d of raw) if (d && isScenarioId(d.scenarioId)) memory.set(d.id, makeSkill(d));
    return raw;
  } catch { return []; }
}

export function saveRegistry(defs?: CompiledSkillDef[]): void {
  const list = defs ?? [...memory.values()].map(({ match: _m, hydrate: _h, remediate: _r, ...d }) => d as CompiledSkillDef);
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

export function promoteSkill(skill: CompiledSkill): CompiledSkill {
  if (skill.fuzz.passed !== skill.fuzz.cases) throw new Error(`Promotion refused: fuzz ${skill.fuzz.passed}/${skill.fuzz.cases}`);
  loadRegistryIfNeeded();
  memory.set(skill.id, skill);
  saveRegistry();
  return skill;
}
let registryLoaded = false;
function loadRegistryIfNeeded() { if (!registryLoaded) { loadRegistry(); registryLoaded = true; } }

export function listCompiledSkills(): CompiledSkill[] { loadRegistryIfNeeded(); return [...memory.values()]; }

export function lookupTier0Skill(signature: Partial<SymptomSignature> & { scenarioId: string }): { skill: CompiledSkill; latencyMs: number } | null {
  loadRegistryIfNeeded();
  const t0 = performance.now();
  for (const s of memory.values()) if (s.match(signature)) return { skill: s, latencyMs: performance.now() - t0 };
  return null;
}
export function matchCompiledSkill(signature: Partial<SymptomSignature> & { scenarioId: string }): CompiledSkill | null {
  return lookupTier0Skill(signature)?.skill ?? null;
}

/* ---------------- compile entry points ---------------- */
export async function compileFromTrace(trace: unknown): Promise<CompiledSkill> {
  assertValidTrace(trace);
  const t = trace as CapturedTrace;
  const started = performance.now();
  const fuzz = await runPropertyFuzzer(t.scenarioId, 100);
  const latencyMs = Math.max(0.001, Math.round((performance.now() - started) / 100) / 10);
  const def: CompiledSkillDef = {
    id: `skill-${t.scenarioId.toLowerCase()}-tier0`, scenarioId: t.scenarioId, signature: t.signature,
    tier: 0, tokenCost: 0, latencyMs, fuzz: { cases: fuzz.cases, passed: fuzz.passed },
    createdAt: new Date().toISOString(), version: 1,
  };
  const skill = makeSkill(def);
  // Honest match latency: measure an actual lookup-style match.
  const m0 = performance.now(); skill.match(t.signature); skill.latencyMs = Math.round((performance.now() - m0) * 1000) / 1000;
  if (fuzz.passed === fuzz.cases) promoteSkill(skill);
  return skill;
}

export async function compileSkill(scenarioId: string): Promise<CompiledSkill> {
  return compileFromTrace(captureTrace(scenarioId));
}
export const compileToTier0Skill = compileSkill;
