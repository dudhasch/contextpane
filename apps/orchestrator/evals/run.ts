/**
 * ContextPane coder eval: `bun run eval` (offline, deterministic engine) or
 * `bun run eval -- --live` (Meta Model API; needs META_API_KEY). Never touches a tenant:
 * LIVE_CLOUD_MODE is forced off, so ABAC facts come from the labelled fixture.
 *
 * For every case it stages the coder's bundle (synthesizeCustomRemediation, the same call the custom
 * ticket pipeline makes), runs the PowerShell AST pre-flight and scores target accuracy, strategy
 * match, pre-flight pass rate and injection safety. Results go to evals/results/<mode>-latest.json.
 * Exit code 1 when any injection case fails, so it can gate a CI job.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const live = process.argv.includes("--live") || /^(1|true)$/i.test(process.env.EVAL_LIVE ?? "");
const only = process.argv.find((a) => a.startsWith("--case="))?.slice("--case=".length);
process.env.LIVE_CLOUD_MODE = "false";
if (!live) process.env.CTX_FORCE_LOCAL = "true";

const { SteeringParamsSchema } = await import("@contextpane/catalog");
const { providers } = await import("../src/config.ts");
const { metaCallsEnabled } = await import("../src/router/openai.ts");
const { synthesizeCustomRemediation } = await import("../src/local/subagent-orchestrator.ts");
const { checkPowerShellAst, checkWhatIfSafety } = await import("../src/preflight/local.ts");
const { EVAL_CASES } = await import("./cases.ts");
const { scoreCase, summarize } = await import("./score.ts");
type EvalCase = (typeof EVAL_CASES)[number];

if (live && !providers.meta.hasKey) {
  console.error("--live needs META_API_KEY (or MODEL_API_KEY) in the environment or .env.local");
  process.exit(2);
}
if (live && !metaCallsEnabled()) {
  console.error("--live was requested but model calls are disabled (CTX_FORCE_LOCAL or NODE_ENV=test)");
  process.exit(2);
}

function steeringFor(c: EvalCase) {
  const now = new Date().toISOString();
  const param = <T>(value: T) => ({ value, source: "operator" as const, setAt: now });
  return SteeringParamsSchema.parse({
    version: 1,
    digest: `eval-${c.id}`,
    updatedAt: now,
    ...(c.strategy ? { remediationStrategy: param(c.strategy) } : {}),
    ...(c.targetResource ? { targetResource: param(c.targetResource) } : {}),
    answers: {},
  });
}

const cases = EVAL_CASES.filter((c) => !only || c.id === only);
const started = performance.now();
const rows = [];
for (const c of cases) {
  const caseStarted = performance.now();
  const bundle = await synthesizeCustomRemediation({
    scenarioId: `EVAL-${c.id}`,
    ticketTitle: c.title,
    ticketBody: c.body,
    clarifiedAnswers: c.answers ?? {},
    steering: steeringFor(c),
  });
  const ast = await checkPowerShellAst(bundle.powershellScript, 20_000, bundle.requiredCommands ?? []);
  const whatIf = checkWhatIfSafety(bundle.powershellScript);
  const findings = [...ast.findings, ...(whatIf.safe ? [] : [`-WhatIf not a full dry run: ${whatIf.unguarded.join(", ")}`])];
  const passed = ast.passed === null ? null : ast.passed && whatIf.safe;
  const score = scoreCase(c, bundle, { passed, findings });
  rows.push({ ...score, source: bundle._meta?.source ?? "fallback-on-error", model: bundle._meta?.modelUsed ?? "deterministic", latencyMs: Math.round(performance.now() - caseStarted) });
  const mark = (v: boolean | null) => (v === null ? "·" : v ? "✓" : "✗");
  console.log(`${c.id.padEnd(22)} target ${mark(score.targetHit)}  strategy ${mark(score.strategyMatch)}  must ${mark(score.mustContainHit)}  preflight ${mark(score.preflightPassed)}  injection ${mark(score.injectionSafe)}  ${bundle._meta?.source ?? ""}`);
}

const summary = summarize(rows);
const out = { mode: live ? "live" : "offline", generatedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), summary, cases: rows };
const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${out.mode}-latest.json`);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, "utf8");

const pct = (r: { passed: number; scored: number; rate: number | null }) => (r.rate === null ? "n/a" : `${r.passed}/${r.scored} (${Math.round(r.rate * 100)}%)`);
console.log(`\n${out.mode} · ${summary.cases} cases · target ${pct(summary.targetAccuracy)} · strategy ${pct(summary.strategyMatch)} · must-contain ${pct(summary.mustContain)} · pre-flight ${pct(summary.preflightPass)} · injection-safe ${pct(summary.injectionSafe)}`);
console.log(`results: ${file}`);
if (summary.preflightPass.scored === 0) console.log("pre-flight not scored: pwsh is not installed");
process.exit(summary.injectionSafe.rate !== null && summary.injectionSafe.rate < 1 ? 1 : 0);
