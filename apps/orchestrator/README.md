# @contextpane/orchestrator

ContextPane's backend, built on Bun + Hono:
- **Routing.** Routes each request through a tiered Meta model router.
- **Agents.** Runs the five-stage sub-agent pipeline and owns the two-way steering contract.
- **Staging and verification.** Stages and verifies every remediation (sandbox pre-flight, write-then-test, symbolic prover).
- **Rollback.** Executes the snapshot-derived inverse (f⁻¹).

Progress streams over SSE; telemetry streams over WebSocket.

```bash
bun run apps/orchestrator/src/index.ts      # or: bun run dev (both apps)
curl http://127.0.0.1:4000/api/health
```

## Layout

| Folder | Role |
|---|---|
| `src/index.ts` · `app.ts` | Bun server + Hono routes (REST, SSE when `Accept: text/event-stream` or `?stream=1`), `GET /ws` telemetry socket |
| `src/config.ts` | Env loader (`.env.local` never overrides variables the process already has), model ids, providers, timeouts |
| `src/router/` | `chain.ts` (ordered provider chain with per-attempt outcomes), `openai.ts` (the single prompt exit point), `meta-models.ts` (stand-in resolution), `glimmer-payload.ts` (open-weight JSON schema) |
| `src/tiers/` | Tier 0 recipe, 1A hover, 1B/2 correlate, selection explore, 3 remediate / rollback, write-then-test loop, voice, vision |
| `src/local/` | Deterministic engines and domain logic: sub-agents, steering, N+k catalog, data plane, prover, snapshot/inverse, canary, ticket triage, ERP inbox |
| `src/mcp/` | MCP clients (in-process by default, `CTX_MCP_TRANSPORT=stdio` spawns the servers) and the correlation context gather |
| `src/preflight/` | Local pwsh + Terraform pre-flight, Modal sandbox client, git staging of remediation branches |
| `src/store/` | Audit ledger, convergence state, remediations, recipes, PSA closure |

## Model routing

All Meta ids are configurable through `CTX_MODEL_*` variables ([`config.ts:152-168`](src/config.ts#L152)).

| Tier | Chain (first answer wins) | Code |
|---|---|---|
| 0 · recipe | none: zero-token hydration of a pinned view | [`tiers/tier0-recipe.ts`](src/tiers/tier0-recipe.ts) |
| 1A · hover | `muse-glimmer-30b` (Modal open weights) → Fireworks / Baseten (optional) → `muse-spark-1.3`, then the deterministic diagnostic | [`tiers/tier1-hover.ts:52`](src/tiers/tier1-hover.ts#L52), `hover()` [`:218`](src/tiers/tier1-hover.ts#L218), warm-up [`:412`](src/tiers/tier1-hover.ts#L412) |
| 1B / 2 · correlate | open-weight catalog (opt-in) → Baseten Spark (optional) → `muse-spark-1.3` → deterministic AST hydration | [`tiers/tier2-correlate.ts:120`](src/tiers/tier2-correlate.ts#L120) |
| 1B · selection lens | `muse-wonder-1.0` → `muse-spark-1.3` | [`tiers/explore.ts:116`](src/tiers/explore.ts#L116) |
| 3A · plan / 3B · code | `muse-wonder-1.0` plan, then `muse-code` → **served as `muse-wonder-1.0`** | [`tiers/tier3-remediate.ts:164`](src/tiers/tier3-remediate.ts#L164), [`:193`](src/tiers/tier3-remediate.ts#L193) |
| Voice | `muse-voice-transcribe-1.0` (`POST /asr/transcribe`), intent via `muse-spark-1.3` | [`tiers/voice.ts:54`](src/tiers/voice.ts#L54), [`router/openai.ts:235`](src/router/openai.ts#L235) |
| Vision | `muse-spark-1.3` with an image part | [`tiers/vision.ts`](src/tiers/vision.ts) |

**One exit point for prompts.** [`chatWithForcedTool` (router/openai.ts:142)](src/router/openai.ts#L142) handles every call to every provider:
1. **Pseudonymise.** [`vaultMessages`](src/router/openai.ts#L116) replaces identities with vault tokens.
2. **Scan.** `recordPrompt` counts any raw PII left in the prompt.
3. **Force the tool.** It forces the named tool schema; the Meta API accepts only `tool_choice: "auto"`, so Meta gets "auto" plus a system nudge.
4. **Rehydrate.** The reply is rehydrated before it leaves the function ([`:207`](src/router/openai.ts#L207)).

[`metaCallsEnabled()`](src/router/openai.ts#L138) is false without a key, with `CTX_FORCE_LOCAL=true`, or under `NODE_ENV=test`; every tier then uses its deterministic engine.

**Stand-ins.** [`resolveMetaModelsNow`](src/router/meta-models.ts) checks `GET /v1/models` at start-up and swaps unserved ids (`muse-glimmer-30b → muse-spark-1.3`, `muse-code → muse-wonder-1.0`). Every `/api/*` request waits for that resolution, and `GET /api/config` exposes it.

## The five-stage sub-agent pipeline

[`runSubAgentPipeline` (local/subagent-orchestrator.ts:710)](src/local/subagent-orchestrator.ts#L710) runs for custom tickets and ERP drops:

```text
 Telemetry Scout (MCP probe) ───────────────────────────────┐ starts first, runs throughout
 Goal Clarifier · muse-wonder-1.0 ──► steering v0 ──► Promise.all ─┬─ UI Architect · spark-1.3 → wonder-1.0
                                                                   └─ IaC & PS7 Coder · muse-wonder-1.0
                                                      ──► Safety Verifier · syntaxHeuristicPrecheck (no model)
```

| # | Agent | Model | Output | Line |
|---|---|---|---|---|
| 1 | Goal Clarifier | `muse-wonder-1.0` | clarifying questions → answers → `SteeringParams` | [`:161`](src/local/subagent-orchestrator.ts#L161) |
| 2 | Telemetry Scout | none (mcp-msgraph + cloud status) | `UpstreamCloudStatusCorrelation` | [`:710`](src/local/subagent-orchestrator.ts#L710) |
| 3 | UI Architect | gatekeeper `muse-spark-1.3` → synthesizer `muse-wonder-1.0` | `ElementRoutingDecision` + `SynthesizedDynamicCard[]` | [`dynamic-catalog.ts:188`](src/local/dynamic-catalog.ts#L188), [`:301`](src/local/dynamic-catalog.ts#L301) |
| 4 | IaC & PS7 Coder | `muse-wonder-1.0` | PS7 script, Terraform diff, rollback | [`:374`](src/local/subagent-orchestrator.ts#L374) |
| 5 | Safety Verifier | none | brace / `ShouldProcess` / wildcard repairs | [`:498`](src/local/subagent-orchestrator.ts#L498) |

Stages 2–4 are joined at [`:839`](src/local/subagent-orchestrator.ts#L839). The real sandbox pre-flight runs when the fix is staged (below). Each stage writes a `SubAgentTaskRecord` with its model, tokens and latency, and the System & audit drawer shows those records.

## Two-way steering

| Piece | Where |
|---|---|
| Schema (`SteeringParams`, `SteeringDelta`, digest, `isSteeringStale`) | [`packages/catalog/src/steering.ts`](../../packages/catalog/src/steering.ts) |
| Answers → steering (continues the version) | [`local/steering.ts:115`](src/local/steering.ts#L115) `deriveSteeringFromAnswers` |
| The only writer (version++ on digest change; audit-first ⇒ dryRun) | [`local/steering.ts:165`](src/local/steering.ts#L165) `applySteeringDelta` |
| Route | `PATCH /api/tickets/:scenarioId/steer`, body `SteeringDelta & { rerun?: "coder" \| "coder+ui" }` ([`app.ts:517`](src/app.ts#L517)) |
| Coder re-parameterisation + script diff | [`local/custom-ticket.ts:701`](src/local/custom-ticket.ts#L701) `steerCustomTicket` |
| Re-run the pre-flight on the steered bundle | [`tiers/tier3-remediate.ts:1092`](src/tiers/tier3-remediate.ts#L1092) `restageRemediationForSteering` |

## Tier 3: stage, verify, approve, revert

1. **Bundle.**
   - **Custom tickets** reuse stage 4's output.
   - **Built-in scenarios** run a Wonder plan, then `metaCode` code synthesis.
   - **Structural checks.** `bundleIsSound` checks both kinds. A failure falls back to the deterministic bundle.
2. **Pre-flight.** The Modal sandbox runs if it is configured ([`preflight/modal.ts:65`](src/preflight/modal.ts#L65)); otherwise, or on any error, the local runner runs ([`preflight/local.ts:293`](src/preflight/local.ts#L293)):
   - pwsh `Parser::ParseFile` plus a cmdlet allow-list.
   - `terraform fmt -check` and `terraform validate` when the drift has an HCL baseline.
   - After either runner, [`checkWhatIfSafety`](src/preflight/local.ts#L132) statically requires every mutating cmdlet to sit inside `ShouldProcess`.
3. **Write-then-test.** [`runRepairLoop`](src/tiers/repair-loop.ts#L129) is called at [`tier3-remediate.ts:251`](src/tiers/tier3-remediate.ts#L251):
   - Repairable findings go back to the coder for up to [`MAX_REPAIR_ITERATIONS = 2`](src/tiers/repair-loop.ts#L34) turns.
   - Infrastructure findings are not repairable.
   - The loop stops on an unchanged script and never forces a verdict.
   - The rounds are attached to `verificationStatus.repair`.
4. **Staging.** A local git branch `fix/<scenario>-<tenant>-remediation` is force-updated with `demo-iac/remediations/<scenario>/`. Nothing is pushed unless a PR is requested.
5. **Prover (Tier 3C, no LLM)** in [`local/formal-verifier.ts`](src/local/formal-verifier.ts):
   - Seven invariants in a PCC bitmask ([`0x7f`, :84](src/local/formal-verifier.ts#L84)).
   - Idempotency f(f(S)) = f(S) on a forked state ([`:754`](src/local/formal-verifier.ts#L754)).
   - Blast-radius replay.
   - A ticket with no symbolic model reports "not provable".
6. **Approve.** `POST /api/remediate/approve`:
   - Break-glass mode first captures [`captureEntitySnapshot`](src/local/snapshot.ts#L107), then writes through the lab write path, then runs the canary ([`local/canary-convergence.ts:142`](src/local/canary-convergence.ts#L142); the probes evaluate the symbolic model).
   - GitOps mode stages a PR.
7. **Revert.** `POST /api/rollback` ([`app.ts:767`](src/app.ts#L767)):
   - [`buildInverseFromSnapshot`](src/local/inverse-rollback.ts#L205) derives the inverse for the sections that were touched.
   - [`rollbackRemediation`](src/tiers/tier3-rollback.ts#L98) executes it, then reads the state back and compares it with the snapshot.
   - With no snapshot, it returns a static reference inverse, labelled `inverseSource: "static-reference"`.

## N+k catalog persistence

[`local/dynamic-catalog.ts`](src/local/dynamic-catalog.ts) loads and saves [`data/dynamic-catalog.json`](../../data/dynamic-catalog.json). It writes each synthesized card to `data/synthesized-elements/<ElementId>.tsx` and appends a pseudonymised record to `data/synthesized-elements-log.json` (git-ignored). Under `NODE_ENV=test` it writes nothing unless `CTX_PERSIST_CATALOG=true`. A card that fails `SynthesizedDynamicCardSchema` is shown as a labelled template card and is never persisted.

## HTTP API (selection)

| Method · path | Purpose | Line |
|---|---|---|
| `GET /api/health` · `/api/config` | health, open-weight info, model stand-ins | [`139`](src/app.ts#L139), [`158`](src/app.ts#L158) |
| `GET /api/scenarios` · `/api/scenarios/:id/brief` | work queue, left-pane brief | [`198`](src/app.ts#L198), [`296`](src/app.ts#L296) |
| `POST /api/hover` | Tier 1A | [`892`](src/app.ts#L892) |
| `POST /api/correlate` | Tier 1B/2 (SSE optional) | [`912`](src/app.ts#L912) |
| `POST /api/explore-selection` | selection → Context Lens | [`344`](src/app.ts#L344) |
| `POST /api/tickets/triage-custom` | unscripted ticket → sub-agent pipeline | [`369`](src/app.ts#L369) |
| `POST /api/tickets/:id/refine-goal` | full re-run with new answers (SSE optional) | [`467`](src/app.ts#L467) |
| `PATCH /api/tickets/:id/steer` | steering → coder re-parameterise → re-stage | [`517`](src/app.ts#L517) |
| `GET /api/dynamic-catalog` · `POST …/clear` | N+k registry | [`564`](src/app.ts#L564), [`583`](src/app.ts#L583) |
| `POST /api/remediate` | Tier 3 (SSE optional) | [`953`](src/app.ts#L953) |
| `POST /api/remediate/:rid/autofix` · `/override` | guard repair · audited override | [`971`](src/app.ts#L971), [`980`](src/app.ts#L980) |
| `POST /api/remediate/approve` | HITL approval | [`1126`](src/app.ts#L1126) |
| `GET /api/formal/:id` | invariants, blast radius, rollback, idempotency | [`754`](src/app.ts#L754) |
| `POST /api/rollback` | f⁻¹ | [`767`](src/app.ts#L767) |
| `GET /api/dataplane?ptr=` | resolve a `ptr://` pointer (409 on fence failure) | [`810`](src/app.ts#L810) |
| `POST /api/voice-steer` · `/api/vision-extract` | voice / vision tiers | [`1254`](src/app.ts#L1254), [`1233`](src/app.ts#L1233) |
| `POST /api/lab/reset-drift` | re-assert the seeded drift | [`1178`](src/app.ts#L1178) |
| `GET /api/telemetry/stream` · `GET /ws` | SSE mirror · WebSocket telemetry | [`1266`](src/app.ts#L1266) |

`GET /` lists every endpoint.

## Tests

```bash
bun test apps/orchestrator     # part of the 278-test suite
```

Tests run with `NODE_ENV=test`, which disables Meta calls and catalog writes, so a test run never touches `data/`. Notable suites: `tiers/repair-loop.test.ts`, `tiers/tier3-rollback.test.ts`, `local/steering.test.ts`, `local/formal-verifier.test.ts`, `local/custom-ticket.test.ts`, `router/chain.test.ts`.
