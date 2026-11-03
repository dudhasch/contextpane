# @contextpane/orchestrator

ContextPane's backend, built on Bun + Hono:
- **Routing.** Routes each request through a tiered Meta model router.
- **Agents.** Runs the five-stage sub-agent pipeline and owns the two-way steering contract.
- **Staging and verification.** Stages and verifies every remediation (sandbox pre-flight with one shared hard-fail rule set, write-then-test, invariant checks).
- **Execution.** Runs an approval as a typed Graph / ARM action when the bundle carries one, otherwise the approved script as a dedicated executor identity.
- **Rollback.** Executes the snapshot-derived inverse (f⁻¹), or the typed action's own inverse.

Progress streams over SSE; telemetry streams over WebSocket. Every `/api/*` route except `GET /api/health`, and `/ws`, needs the local API token (see [Local API security](#local-api-security)).

```bash
bun run apps/orchestrator/src/index.ts      # or: bun run dev (both apps)
curl http://127.0.0.1:4000/api/health       # open; everything else needs the token
curl -H "authorization: Bearer $(cat .contextpane/api-token)" http://127.0.0.1:4000/api/config
```

## Layout

| Folder | Role |
|---|---|
| `src/index.ts` · `app.ts` | Bun server + Hono routes (REST, SSE when `Accept: text/event-stream` or `?stream=1`), `GET /ws` telemetry socket |
| `src/security.ts` | `localApiGuard` (Host check, bearer token, JSON-only writes, local Origin), `publishApiToken`, `operatorIdentity` |
| `src/config.ts` | Env loader (`.env.local` never overrides variables the process already has), model ids, providers, timeouts, `executor` and `visionSendImages` settings |
| `src/router/` | `chain.ts` (ordered provider chain with per-attempt outcomes), `openai.ts` (the single prompt exit point), `untrusted.ts` (the untrusted-data delimiters and rules), `fallback-cause.ts` (why a sub-agent fell back), `meta-models.ts` (stand-in resolution), `glimmer-payload.ts` (open-weight JSON schema) |
| `src/tiers/` | Tier 0 recipe, 1A hover, 1B/2 correlate, selection explore, 3 remediate / rollback, write-then-test loop, voice, vision |
| `src/execution/` | `typed-actions.ts` (validator, forward write and inverse per catalog action), `select-action.ts` (picks the typed action for a custom ticket), `executor-identity.ts` (the identity an approved script runs as) |
| `src/local/` | Deterministic engines and domain logic: sub-agents, steering, N+k catalog, `grounding.ts` (tenant-context index for the coder and card synthesizer), data plane, invariant checks, snapshot/inverse, canary, ticket triage, ERP inbox |
| `src/mcp/` | MCP clients (in-process by default, `CTX_MCP_TRANSPORT=stdio` spawns the servers) and the correlation context gather |
| `src/preflight/` | Local pwsh + Terraform pre-flight, `execution-surface.ts` (rules for code that runs without naming a cmdlet), Modal sandbox client, git staging of remediation branches |
| `src/store/` | Audit ledger, convergence state, remediations, recipes, PSA closure |
| `evals/` | Coder eval set (24 tickets, 8 prompt-injection cases), scorer and runner; `bun run eval` ([README](evals/README.md)) |

## Model routing

All Meta ids are configurable through `CTX_MODEL_*` variables ([`config.ts:152-168`](src/config.ts#L152)).

| Tier | Chain (first answer wins) | Code |
|---|---|---|
| 0 · recipe | none: zero-token hydration of a pinned view | [`tiers/tier0-recipe.ts`](src/tiers/tier0-recipe.ts) |
| 1A · hover | `muse-glimmer-30b` (Modal open weights) → Fireworks / Baseten (optional) → `muse-spark-1.3`, then the deterministic diagnostic | [`tiers/tier1-hover.ts:54`](src/tiers/tier1-hover.ts#L54), `hover()` [`:275`](src/tiers/tier1-hover.ts#L275), warm-up [`:471`](src/tiers/tier1-hover.ts#L471) |
| 1B / 2 · correlate | open-weight catalog (opt-in) → Baseten Spark (optional) → `muse-spark-1.3` → deterministic AST hydration | [`tiers/tier2-correlate.ts:121`](src/tiers/tier2-correlate.ts#L121) |
| 1B · selection lens | `muse-wonder-1.0` → `muse-spark-1.3` | [`tiers/explore.ts:117`](src/tiers/explore.ts#L117) |
| 3A · plan / 3B · code | `muse-wonder-1.0` plan, then `muse-code` → **served as `muse-wonder-1.0`** | [`tiers/tier3-remediate.ts:171`](src/tiers/tier3-remediate.ts#L171), [`:200`](src/tiers/tier3-remediate.ts#L200) |
| Voice | `muse-voice-transcribe-1.0` (`POST /asr/transcribe`), intent via `muse-spark-1.3` | [`tiers/voice.ts:54`](src/tiers/voice.ts#L54), [`router/openai.ts:256`](src/router/openai.ts#L256) |
| Vision | `muse-spark-1.3` with an image part, only with `CTX_VISION_SEND_IMAGES=true`; otherwise no call is made and a `skipped` telemetry entry records why | [`tiers/vision.ts`](src/tiers/vision.ts) |
| Typed-action selection | `muse-wonder-1.0` through the forced `select_typed_action` tool (custom tickets that are not ABAC, when the context supports an action) | [`execution/select-action.ts`](src/execution/select-action.ts) |

**One exit point for prompts.** [`chatWithForcedTool` (router/openai.ts:160)](src/router/openai.ts#L160) handles every call to every provider:
1. **Refuse images.** A message with an image part throws `ImageBlockedError` unless the caller passes `allowImages` (only the vision tier does, and only with `CTX_VISION_SEND_IMAGES=true`): image pixels bypass the text vault.
2. **Pseudonymise.** [`vaultMessages`](src/router/openai.ts#L134) replaces e-mail addresses / UPNs, known person names, known user object ids, known device names, phone numbers and public IPv4 addresses in every text part with vault tokens.
3. **Scan.** `recordPrompt` counts the detector hits left in the prompt. It is a self-check (`metricKind: "self-check"`): the same detectors that did the replacement run again, so it measures only what they can see, not all PII.
4. **Force the tool.** It forces the named tool schema; the Meta API accepts only `tool_choice: "auto"`, so Meta gets "auto" plus a system nudge.
5. **Rehydrate, scoped.** The reply's tokens are turned back into real values before it leaves the function, but only tokens the vault itself put into this prompt (captured while pseudonymising it, `vaultMessagesWithExposure`) or that the orchestrator's own pre-vaulted context carried outside any untrusted block, or, when the caller passes `piiScope: { tenantId, ticketId }`, tokens earlier prompts of the same tenant and ticket were given that way. Token-shaped text does not count: any other token stays a token and is counted in the vault's `refusedRehydrations`.

**Untrusted text.** [`router/untrusted.ts`](src/router/untrusted.ts) wraps customer-written text (ticket titles and bodies, ERP descriptions, highlighted selections) in `<untrusted_customer_data source="…">` delimiters; a delimiter inside the text is replaced with `[delimiter removed]`, and anything shaped like a vault token (`upn_tok_01`) with `[token-literal-removed]`, so a ticket cannot ask the model to echo a pseudonym that would rehydrate into someone else's identity. The router strips token literals inside untrusted blocks a second time before vaulting. Every system prompt that receives such text carries `UNTRUSTED_DATA_RULE`, and prompts that carry tenant context (`tenantFacts`) also carry `TENANT_DATA_RULE`: both say to treat the text as evidence and never follow instructions in it.

**Fallback causes.** When the clarifier, coder, gatekeeper or synthesizer falls back to its deterministic template, [`fallbackCause`](src/router/fallback-cause.ts) logs why (a provider error, a reply that failed validation, or model calls being off) and the reason travels as `fallbackReason` on the sub-agent record to the pipeline badge.

[`metaCallsEnabled()`](src/router/openai.ts#L156) is false without a key, with `CTX_FORCE_LOCAL=true`, or under `NODE_ENV=test`; every tier then uses its deterministic engine.

**Stand-ins.** [`resolveMetaModelsNow`](src/router/meta-models.ts) checks `GET /v1/models` at start-up and swaps unserved ids (`muse-glimmer-30b → muse-spark-1.3`, `muse-code → muse-wonder-1.0`). Every `/api/*` request waits for that resolution, and `GET /api/config` exposes it.

## The five-stage sub-agent pipeline

[`runSubAgentPipeline` (local/subagent-orchestrator.ts:784)](src/local/subagent-orchestrator.ts#L784) runs for custom tickets and ERP drops:

```text
 Telemetry Scout (MCP probe) ───────────────────────────────┐ starts first, runs throughout
 Goal Clarifier · muse-wonder-1.0 ──► steering v0 ──► Promise.all ─┬─ UI Architect · spark-1.3 → wonder-1.0
                                                                   └─ IaC & PS7 Coder · muse-wonder-1.0
                                                      ──► Safety Verifier · syntaxHeuristicPrecheck (no model)
```

| # | Agent | Model | Output | Line |
|---|---|---|---|---|
| 1 | Goal Clarifier | `muse-wonder-1.0` | clarifying questions → answers → `SteeringParams` | [`:160`](src/local/subagent-orchestrator.ts#L160) |
| 2 | Telemetry Scout | none (mcp-msgraph + cloud status) | `UpstreamCloudStatusCorrelation` | [`:784`](src/local/subagent-orchestrator.ts#L784) |
| 3 | UI Architect | gatekeeper `muse-spark-1.3` → synthesizer `muse-wonder-1.0` | `ElementRoutingDecision` + `SynthesizedDynamicCard[]` | [`dynamic-catalog.ts:197`](src/local/dynamic-catalog.ts#L197), [`:314`](src/local/dynamic-catalog.ts#L314) |
| 4 | IaC & PS7 Coder | `muse-wonder-1.0` | PS7 script, Terraform diff, rollback | [`:423`](src/local/subagent-orchestrator.ts#L423) |
| 5 | Safety Verifier | none | brace / `ShouldProcess` / wildcard repairs | [`:565`](src/local/subagent-orchestrator.ts#L565) |

Stages 2–4 are joined at [`:931`](src/local/subagent-orchestrator.ts#L931). The real sandbox pre-flight runs when the fix is staged (below). Each stage writes a `SubAgentTaskRecord` with its model, tokens, latency and, after a fallback, its `fallbackReason`; the System & audit drawer shows those records.

**Grounding.** Triage, refine, steer and repair turns build a [`GroundingIndex`](src/local/grounding.ts) from the gathered tenant context: every resource, user, group, policy and identity name it holds, mapped to the `ptr://` dataset it came from. Its compact `facts` go to the coder and the card synthesizer as `tenantFacts` (through the vault, under `TENANT_DATA_RULE`), for every custom ticket, not only ABAC.
- **Coder output.** Literal targets in the script or the Terraform diff that are in neither the context nor the ticket text are added to `riskNotes` and become an `Ungrounded target:` pre-flight finding. The finding downgrades "Verified Safe" to "Verified With Warnings"; it does not fail the bundle, because a fix may create a new resource.
- **Identity, role and credential targets.** For `-UserId`, `-UserPrincipalName`, `-SignInName`, `-ObjectId`, `-DirectoryObjectId`, `-PrincipalId`, `-MemberId`, `-GroupId`, `-ServicePrincipalId`, `-ApplicationId`, `-AppId`, `-DirectoryRoleId`, `-RoleDefinitionId`, `-RoleDefinitionName` and `-OdataId` the ticket text does not count as grounding: a literal value the tenant context does not hold is an `Ungrounded identity:` finding, which **fails** the pre-flight (`ungroundedIdentities`, `isUngroundedIdentityFinding`). A customer-written ticket cannot choose who is granted what. Values passed through `-BodyParameter` hashtables or variables are not seen by this check.
- **Card output.** [`bindCardToGrounding`](src/local/grounding.ts) sets each synthesized block's `provenance` (`tenant-data` · `mixed` · `model-estimate`), its `dataPtr` and its `ungroundedRows`; the model's tool schema has none of these fields. Gauges are always `model-estimate`.
- **Required commands.** The cmdlets the pre-flight requires come from [`steeredRequiredCommands`](src/local/subagent-orchestrator.ts) (the ticket and the operator's steering), never from the coder's own output: ABAC tickets get the steered strategy's cmdlets, a Key Vault ticket steered to recover or purge-recreate gets that strategy's cmdlets, everything else gets none.

## Two-way steering

| Piece | Where |
|---|---|
| Schema (`SteeringParams`, `SteeringDelta`, digest, `isSteeringStale`) | [`packages/catalog/src/steering.ts`](../../packages/catalog/src/steering.ts) |
| Answers → steering (continues the version) | [`local/steering.ts:115`](src/local/steering.ts#L115) `deriveSteeringFromAnswers` |
| The only writer (version++ on digest change; audit-first ⇒ dryRun) | [`local/steering.ts:165`](src/local/steering.ts#L165) `applySteeringDelta` |
| Route | `PATCH /api/tickets/:scenarioId/steer`, body `SteeringDelta & { rerun?: "coder" \| "coder+ui" }` ([`app.ts:523`](src/app.ts#L523)) |
| Coder re-parameterisation + script diff | [`local/custom-ticket.ts:706`](src/local/custom-ticket.ts#L706) `steerCustomTicket` |
| Re-run the pre-flight on the steered bundle | [`tiers/tier3-remediate.ts:1101`](src/tiers/tier3-remediate.ts#L1101) `restageRemediationForSteering` |

## Tier 3: stage, verify, approve, revert

1. **Bundle.**
   - **Custom tickets** reuse stage 4's output.
   - **Built-in scenarios** run a Wonder plan, then `metaCode` code synthesis.
   - **Structural checks.** `bundleIsSound` checks both kinds. A failure falls back to the deterministic bundle.
2. **Pre-flight.** The Modal sandbox runs if it is configured ([`preflight/modal.ts:68`](src/preflight/modal.ts#L68)); otherwise, or on any error, the local runner runs ([`preflight/local.ts:290`](src/preflight/local.ts#L290)). Both enforce one rule set, [`packages/catalog/src/preflight-rules.json`](../../packages/catalog/src/preflight-rules.json), and every rule in it is a hard failure ("Verification Failed"):
   - **AST rules** (`evaluatePreflightRules`): pwsh `Parser::ParseFile` / `ParseInput`; a command whose verb is outside `allowedVerbs` and that is not in `allowedCommands`, a `forbiddenCommands` entry, a `destructivePatterns` match, or a missing steered required command.
   - **Execution surface** ([`preflight/execution-surface.ts`](src/preflight/execution-surface.ts), applied by the orchestrator to the AST report of either sandbox): .NET static calls outside a safe-type list, `New-Object` of types outside a constructible list, COM objects, `& $var` / `& (expr)`, dot-sourcing, `.Invoke()` / `.AddScript()`, aliases outside a small harmless set, the `deniedExecutionCommands` (for example `Invoke-Command`, `Start-Job`, `Add-Type`, PSSession cmdlets, `Set-Alias`, `Set-AzContext`, `Connect-`/`Disconnect-` of Graph and Az), and REST calls outside the allow-list: `Invoke-MgGraphRequest` only to `graph.microsoft.com` paths in `GRAPH_REST_RULES` with their allowed methods (DELETE only on membership or grant references), `Invoke-AzRestMethod` only to `/subscriptions/…` and never a write to `Microsoft.Authorization`. With no AST report (pwsh missing, or an older Modal deployment), `scanExecutionSurfaceText` extracts a best-effort one from the script text, ignoring string literals.
   - **-WhatIf gate** ([`applyWhatIfGate`](src/preflight/local.ts)): a script with mutating cmdlets outside `$PSCmdlet.ShouldProcess` fails; a read-only script without the guard only gets a warning. A missing `#Requires -Version 7` header is a warning.
   - **Grounding**: `Ungrounded target:` findings (above) are warnings; `Ungrounded identity:` findings fail the bundle.
   - `terraform fmt -check` and `terraform validate` when the drift has an HCL baseline.
3. **Write-then-test.** [`runRepairLoop`](src/tiers/repair-loop.ts#L132) is called at [`tier3-remediate.ts:258`](src/tiers/tier3-remediate.ts#L258):
   - Repairable findings go back to the coder for up to [`MAX_REPAIR_ITERATIONS = 2`](src/tiers/repair-loop.ts#L35) turns.
   - Infrastructure findings are not repairable.
   - The loop stops on an unchanged script and never forces a verdict.
   - The rounds are attached to `verificationStatus.repair`.
4. **Staging.** A local git branch `fix/<scenario>-<tenant>-remediation` is force-updated with `demo-iac/remediations/<scenario>/`. Nothing is pushed unless a PR is requested.
5. **Typed action.** For a custom ticket, [`selectTypedAction`](src/execution/select-action.ts) picks the catalog action the approval will execute (`packages/catalog/src/typed-actions.ts`): ABAC tickets take it from the clarifier answers (the condition-limited grant only); other custom tickets ask `muse-wonder-1.0` through the forced `select_typed_action` tool, which offers only the actions and entity ids the gathered context supports (15 s timeout, ticket text marked untrusted, `piiScope` set). The answer must parse as the action's schema and pass its validator in [`execution/typed-actions.ts`](src/execution/typed-actions.ts) (only users, containers and tenants the context or the lab manifest lists); otherwise the drawer carries no `typedAction`.
6. **Invariant checks (Tier 3C, no LLM)** in [`local/formal-verifier.ts`](src/local/formal-verifier.ts). These evaluate the built-in scenarios' symbolic model; there is no SMT solver and no certificate:
   - Seven invariants in a bitmask ([`0x7f`, :87](src/local/formal-verifier.ts#L87)).
   - Idempotency f(f(S)) = f(S) on a forked state ([`:757`](src/local/formal-verifier.ts#L757)).
   - Blast-radius replay.
   - A ticket with no symbolic model reports "not provable".
7. **Approve.** `POST /api/remediate/approve`. The approval is recorded under [`operatorIdentity()`](src/security.ts) (the signed-in Graph account in live mode, otherwise `CTX_LAB_DELEGATED_IDENTITY`), never a name from the request body; a bundle whose pre-flight failed cannot be approved.
   - Break-glass mode first captures [`captureEntitySnapshot`](src/local/snapshot.ts#L107), then writes, then runs the canary ([`local/canary-convergence.ts:142`](src/local/canary-convergence.ts#L142); the probes evaluate the symbolic model).
   - **The write.** A drawer with a `typedAction` runs [`executeTypedAction`](src/execution/typed-actions.ts): one validated Graph / ARM call, and the staged script is not executed. Without one, a built-in scenario writes through its lab write path, and a model-written script runs only with `LIVE_CLOUD_MODE=true` and `CTX_ALLOW_EXECUTE=true`, through [`runScriptText`](src/tiers/tier3-remediate.ts).
   - **The executor identity.** `runScriptText` prepends [`executorPrelude`](src/execution/executor-identity.ts): the script connects as a least-privilege service principal (`CTX_EXECUTOR_CLIENT_ID`, `CTX_EXECUTOR_TENANT_ID`, `CTX_EXECUTOR_CERT_THUMBPRINT`, certificate in the local store) or the host's managed identity (`CTX_EXECUTOR_MANAGED_IDENTITY=true`) for its own process, and stops unless the connected Az and Graph contexts are that identity on the lab subscription. With neither configured the script is refused; `CTX_EXECUTOR_ALLOW_DELEGATED=true` restores the legacy run as the engineer's own sign-in, pinned to the lab subscription. The prelude is added only at execution time, so the pre-flight never sees it.
   - Cached hover answers for the ticket are cleared (`invalidateHoverCache`).
   - GitOps mode stages a PR.
8. **Revert.** `POST /api/rollback` ([`app.ts:781`](src/app.ts#L781)), recorded under `operatorIdentity()`:
   - [`buildInverseFromSnapshot`](src/local/inverse-rollback.ts#L205) derives the inverse for the sections that were touched.
   - [`rollbackRemediation`](src/tiers/tier3-rollback.ts#L101) executes it, then reads the state back and compares it with the snapshot.
   - ABAC tickets revert through the typed inverse of the grant (an ARM DELETE of the assignment). When a typed action ran but no snapshot was captured, its own typed inverse runs. Typed bundles skip the rollback inverse script.
   - With no snapshot and no typed action, it returns a static reference inverse, labelled `inverseSource: "static-reference"`.
   - A revert that executed clears the ticket's cached hover answers.

## N+k catalog persistence

[`local/dynamic-catalog.ts`](src/local/dynamic-catalog.ts) loads and saves [`data/dynamic-catalog.json`](../../data/dynamic-catalog.json). It writes each synthesized card to `data/synthesized-elements/<ElementId>.tsx` and appends a pseudonymised record to `data/synthesized-elements-log.json` (git-ignored). Under `NODE_ENV=test` it writes nothing unless `CTX_PERSIST_CATALOG=true`. A card that fails `SynthesizedDynamicCardSchema` is shown as a labelled template card and is never persisted. The catalog and the `.tsx` export hold the spec as the model wrote it. Every card the pipeline returns (fresh, reused from the catalog, or the template fallback) goes through `bindCardToGrounding` against the current ticket's tenant context, which sets each block's `provenance`, `dataPtr` and `ungroundedRows` (see Grounding above); the browser uses those to label model-written values and to refuse steering from rows no tenant data backs.

## HTTP API (selection)

| Method · path | Purpose | Line |
|---|---|---|
| `GET /api/health` · `/api/config` | health, open-weight info, model stand-ins | [`139`](src/app.ts#L145), [`158`](src/app.ts#L164) |
| `GET /api/scenarios` · `/api/scenarios/:id/brief` | work queue, left-pane brief | [`198`](src/app.ts#L204), [`296`](src/app.ts#L302) |
| `POST /api/hover` | Tier 1A | [`892`](src/app.ts#L906) |
| `POST /api/correlate` | Tier 1B/2 (SSE optional) | [`912`](src/app.ts#L926) |
| `POST /api/explore-selection` | selection → Context Lens | [`344`](src/app.ts#L350) |
| `POST /api/tickets/triage-custom` | unscripted ticket → sub-agent pipeline | [`369`](src/app.ts#L375) |
| `POST /api/tickets/:id/refine-goal` | full re-run with new answers (SSE optional) | [`467`](src/app.ts#L473) |
| `PATCH /api/tickets/:id/steer` | steering → coder re-parameterise → re-stage; 422 for a row click on a model-authored row with no tenant data behind it | [`517`](src/app.ts#L523) |
| `GET /api/dynamic-catalog` · `POST …/clear` | N+k registry | [`564`](src/app.ts#L577), [`583`](src/app.ts#L596) |
| `POST /api/remediate` | Tier 3 (SSE optional) | [`953`](src/app.ts#L967) |
| `POST /api/remediate/:rid/autofix` · `/override` | guard repair · audited override | [`971`](src/app.ts#L985), [`980`](src/app.ts#L994) |
| `POST /api/remediate/approve` | HITL approval | [`1126`](src/app.ts#L1142) |
| `GET /api/formal/:id` | invariants, blast radius, rollback, idempotency | [`754`](src/app.ts#L768) |
| `POST /api/rollback` | f⁻¹ (or the typed inverse); 422 when the inverse fails its idempotency check | [`767`](src/app.ts#L781) |
| `GET /api/dataplane?ptr=` | resolve a `ptr://` pointer (409 on fence failure) | [`810`](src/app.ts#L824) |
| `POST /api/voice-steer` · `/api/vision-extract` | voice / vision tiers | [`1254`](src/app.ts#L1270), [`1233`](src/app.ts#L1249) |
| `POST /api/lab/reset-drift` | re-assert the seeded drift | [`1178`](src/app.ts#L1194) |
| `GET /api/telemetry/stream` · `GET /ws` | SSE mirror · WebSocket telemetry | [`1266`](src/app.ts#L1282) |

`GET /` lists every endpoint.

## Hover cache

Tier 1A model answers are cached per (scope, entity) in `data/hover-cache.json`. Each entry stores `contextDigest`, a sha256 of the entity's hover context with ISO timestamps removed, and [`hoverCacheDecision`](src/tiers/tier1-hover.ts) serves it only while the current context still hashes to that digest; a changed context is a miss and the answer is regenerated. Seed entries from `data/hover-cache.seed.json` carry no digest: they are served only in simulated-lab mode, never against a live tenant, and are pinned to the context they are first served for. `invalidateHoverCache` drops a ticket's entries on approve and after a revert that executed. `?refresh=true` (`fresh`) always regenerates.

## Audit ledger and vault exposure

[`store/audit.ts`](src/store/audit.ts) appends one JSON line per entry to `data/audit-log.jsonl` (git-ignored), with no cap. Each entry carries `prevHash` (the previous entry's `hash`; 64 zeros for the first) and `hash`, a sha256 over its canonical JSON. `GET /api/audit` returns `chain: { ok, entries, brokenAt?, reason? }` from `auditLedger.verify()`, which re-hashes the file, so an edited, removed, re-ordered or garbled line is reported where the chain breaks. It detects tampering after the fact; someone with write access to the file can still rewrite the whole chain. A pre-chain `data/audit-log.json` is migrated once into the chain and renamed `audit-log.json.migrated`.

`delegatedIdentity` is the account an action is recorded under, not the person who clicked (the web app has no sign-in): `identitySource` says whether it is the orchestrator host's Graph sign-in (`host-graph-signin`), the configured lab default (`configured-default`, `CTX_LAB_DELEGATED_IDENTITY`) or a fixed system identity (`system`, for example the fleet campaign). The fleet-campaign entry records `modalSandboxVerified: false` and `astPass: null`, because staging a campaign runs no sandbox pre-flight.

`GET /api/dataplane/:scenarioId` returns the vault metrics with six sample token pairs (what the System & audit drawer lists) and a `tokenMapVisibility` note; the full token map, which rehydrates every pseudonym, is included only with `?includeMappings=true`.

Router savings count only requests a cache hit, a Tier 0 recipe or a compiled skill answered (`savingKind` on the telemetry event): a cached hover is measured against the tokens and time of the call that generated it, a recipe against the Tier 2 baseline. Zero-token events from a failed or disabled model are `fallbackZeroTokenRequests`, never savings.

## Local API security

[`src/security.ts`](src/security.ts) guards `/api/*` and `/ws` (`localApiGuard`, mounted in `app.ts`). Checks run in this order:

| Check | Failure |
|---|---|
| `Host` is `127.0.0.1`, `localhost` or `[::1]` (with any port); blocks DNS rebinding | 421 |
| `GET /api/health` passes from here on without a token | (none) |
| `authorization: Bearer <token>` matches (constant-time compare) | 401 |
| On POST / PUT / PATCH / DELETE: an `Origin` header, when present, is local | 403 |
| On POST / PUT / PATCH / DELETE: `content-type` is `application/json` | 415 |

The token is `CTX_API_TOKEN`, or a random one minted at start-up and written to `.contextpane/api-token` (git-ignored, mode 0600; `CTX_API_TOKEN_FILE` moves it). A token from the environment is not written to disk. The Vite dev proxy reads the file on every request and adds the header, so the browser never holds the token. The guard is off under `bun test` unless `CTX_API_AUTH` is set, and `CTX_API_AUTH=false` turns it off explicitly.

## Evals

[`evals/`](evals/README.md) stages 24 unscripted tickets (8 of them prompt-injection cases) through `synthesizeCustomRemediation` and scores target accuracy, strategy match, must-contain cmdlets, the PowerShell pre-flight and injection safety. `bun run eval` runs offline against the deterministic engine; `bun run eval -- --live` uses the Meta Model API. `LIVE_CLOUD_MODE` is always forced off. Results go to the git-ignored `evals/results/<offline|live>-latest.json`, and the run exits 1 when any injection case fails.

## Tests

```bash
bun test apps/orchestrator     # part of the root suite (357 tests)
```

Tests run with `NODE_ENV=test`, which disables Meta calls and catalog writes, so a test run never touches `data/`. Notable suites: `tiers/repair-loop.test.ts` (its two pwsh-backed cases need PowerShell 7 on the PATH), `tiers/tier3-rollback.test.ts`, `local/steering.test.ts`, `local/formal-verifier.test.ts`, `local/custom-ticket.test.ts`, `router/chain.test.ts`, `preflight/local.test.ts`, `preflight/execution-surface.test.ts`, `preflight/builtin-scripts.test.ts` (every built-in fix, inverse rollback and fallback template against the merged rules), `execution/typed-actions.test.ts`, `execution/executor-identity.test.ts`, `security.test.ts`, `router/untrusted.test.ts`, `router/pii-vault.test.ts`, `local/grounding.test.ts`.
