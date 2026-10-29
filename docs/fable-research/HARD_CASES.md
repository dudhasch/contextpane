# Hard cases: status after the Fable 5.1 pass

Rewritten 2026-10-28 at the end of the Fable 5.1 session (branch `claude/hungry-montalcini-6e4ba5`, base `main` @ `a1b24ef`, commits `04776f6`..`e0fece2`). The numbering is the one the P0, P1 and P2 sessions used; the original prose for each item is in the git history of this file (`a1b24ef`). "Verified how" names the test or the browser check; "needs the user" means the live tenant, a paid model or a repository decision that this session must not touch.

Branch commits:

| Commit | What |
|---|---|
| `04776f6` | HARD_CASES 4/5/6/10/29: canary keyed on execution, null idempotency without a symbolic model, token split, FREE-* inverse |
| `2754f81` | HARD_CASES 1/30/31: Graph service-health probe, in-memory template cards, G-13 coder tool text, R-7 Undo exposure note |
| `2c88dc3` | U-1 server: `SteeringParams` contract, `local/steering.ts`, coder re-parameterisation, `PATCH /api/tickets/:id/steer` |
| `15c239d` | U-1 web: optimistic pills, shimmer, "What changed" diff, stale-steering Regenerate, lens row clicks |
| `f4de78a` | U-2: `tiers/repair-loop.ts`, up to two coder repair turns before the drawer, `syntax-heuristic` label, iterations and tokens in the HUD |
| `e0fece2` | U-5: pre-change snapshot at approve, `local/inverse-rollback.ts`, `tiers/tier3-rollback.ts`, read-back canary, "Revert Change Now" only when the inverse can execute |

Every commit passed `bun run typecheck && bun test` (249 tests at `e0fece2`). Unit tests mock the model layer (`metaCallsEnabled`, `chatWithForcedTool`), spy on `modalConfigured` / `stageRemediationBranch` / `auditLedger.append`, and save drawers directly; no test approves anything against a tenant. The browser check used this worktree's own servers (web :5180 against orchestrator :4010, `LIVE_CLOUD_MODE=false`, simulated lab, no model keys) and never approved, executed or rolled back a remediation.

## Design decisions (items the brief asked this session to decide)

| # | Item | Decision | Commit | Verified how |
|---|---|---|---|---|
| 1 | Template cards never persisted | Keep the tracked catalog for real `muse-wonder-1.0` syntheses only. Template cards are built in memory from `custom-scenarios.json` and returned by `GET /api/dynamic-catalog` as `templateCards` / `templateCount`; the HUD lists them under a "template" label. Nothing is written to `data/dynamic-catalog.json` for a template. | `2754f81` | `dynamic-catalog` tests; `git status` clean after `bun test` |
| 2 | Custom-ticket execution with `CTX_ALLOW_EXECUTE` | Exit code 0 is not enough. `approve()` captures a pre-change snapshot first; after the script exits 0 it reads the entities back, and only a read-back that differs from the snapshot counts as `executed`. Otherwise `state: "approved"`, `execution: "simulated"`, and the log says why. | `e0fece2` | `tier3-rollback.test.ts`, `tier3-remediate.test.ts` |
| 3 | S3 and S4 side by side after S1 | Kept at triage: S3 (card) and S4 (coder) stay parallel on the same `effectiveAnswers`, so the critical path does not grow by the ~15 s card synthesis. On a steer only the coder re-runs (one call, previous script as diff base) and the card's config-diff block is rewritten from the real script diff, so the two artefacts cannot drift after a steer. `rerun: "coder+ui"` on the PATCH re-synthesises the card too, on request. | `2c88dc3` | `steering.test.ts` (PATCH Purge → Recover with Wonder mocked: one coder call, `Undo-AzKeyVaultRemoval`, no `-InRemovedState`, card diff equals the script diff); browser: pill → steering v1/v2, drawer "What changed · v1 → v2" |
| 4 | Canary probes on custom tickets | No canary for a non-executed approval. The canary runs only for an executed approval or an explicit rollback drill; the result carries `execution` and `probeSource` (`symbolic` or `none`), and the SYNTHETIC_PROBED / CONVERGED stages say only what was probed. | `04776f6` | `canary-convergence` tests, `custom-ticket.test.ts` |
| 5 | `verifyIdempotency` for custom ids | Returns `null` for ids without a symbolic model; `/api/rollback`, `/api/formal`, the PSA note and the Safety tab render "not provable". | `04776f6` | `formal-verifier.test.ts`, `ticket-closure.test.ts` |
| 6 | Canary drill rollback wording | Server log, drawer banner and toast are keyed on what executed: drill (canvas only), staged inverse, landed inverse. A drill after a live write reverts through the snapshot inverse first and reports whether it landed. "PREVIOUS STATE RESTORED" appears only when the read-back matches the snapshot. | `04776f6`, `e0fece2` | `tier3-rollback.test.ts` asserts the simulated log never says "tenant restored" |
| 10 | Telemetry token split | `SubAgentTaskRecord` stores `tokensPrompt` / `tokensCompletion`; the pipeline telemetry and System Audit sum the split. | `04776f6`, `f4de78a` | `subagent-orchestrator` tests; System Audit rows in the browser |
| 11 | Test hygiene (`custom-ticket.test.ts` warming Modal, creating `fix/*` branches) | Done: the old tests spy on `modalConfigured` and `stageRemediationBranch` and save drawers directly, like `tier3-remediate.test.ts`. | `04776f6`, `e0fece2` | `bun test` with `.env.local` absent in the worktree; `git branch` shows no new `fix/*` |
| 23 | Seeded tickets pinned first when the chip is on | Kept. The queue order in Simulated Lab is the recording order; the chip can be turned off. | — | — |
| 24 | PowerShell smoke test not run | Kept not run: it approves a break-glass remediation. `remediate.test.ts` parses every generated script with the pwsh 7 parser and the pre-flight allow-list. | — | — |
| 29 | Rollback of a Free-Roam action | `buildInverseRollback` returns an empty bundle with a note for `FREE-<hash>`; `/api/rollback` answers `execution: "none"`, `reason: "staged action, nothing to revert"` instead of throwing. | `04776f6`, `e0fece2` | `tier3-rollback.test.ts` |
| 30 | Entra / Intune upstream status "Not probed" | Probe added: Graph `GET /admin/serviceAnnouncement/healthOverviews`, live mode only, mapped per service. A 403 renders "ServiceHealth.Read.All is not granted to the delegated identity" rather than "not probed"; simulated mode keeps "not probed". Granting the scope is the user's call. | `2754f81` | `cloud-status-correlator.test.ts` (3 tests, fetch mocked: operational, 403, simulated) |
| 31 | Dim 4 rows outside P1-6 | G-13 (coder tool description now describes the group-based licensing path) and R-7 (the Undo UI states that re-opening the rule exposes 3389 to `*`) fixed. G-7, G-8, G-9, G-10, G-11, G-14, I-7, I-12, I-13 are unchanged: each needs a live object id or a seed decision from the user's tenant. | `2754f81` | `tools` schema test; drawer R-7 note in the browser |
| 32 | Runbook forward scripts use slug ids | Kept as illustrative runbook text; the executed bundle resolves by display name. Resolve them too if the runbook is shown in the demo. | — | — |

## Fable 5.1 upgrades (audit §4)

| Upgrade | Decision | Commit | Verified how | Still needs the user |
|---|---|---|---|---|
| U-1 steering that moves code | Typed `SteeringParams` with provenance (`clarifier`, `row-click`, `operator`), version + digest, answers by question id as source of truth; `applySteeringDelta` is the only writer; drawers carry a `steering` stamp and go stale when the digest moves; `store.steer()` flips the pill first and reconciles with the server. | `2c88dc3`, `15c239d` | `steering.test.ts` (8 tests); browser steering v0 → v1 → v2 on a pasted Key Vault ticket with the deterministic coder, drawer "What changed" diff, `/api/tickets/steer` telemetry row | A steer with Wonder configured (the coder call with the previous script as diff base) |
| U-2 write-then-test | Sandbox findings feed up to two coder repair turns before the drawer opens; unrepairable findings (policy, permission, unknown cmdlet) stop the loop; the verdict is never forced; the regex check is labelled `syntax-heuristic`. | `f4de78a` | `repair-loop.test.ts` (4 tests): unguarded script → `Verified Safe`, `iterations: 2`; exhausted → `Verification Failed` | A run against the Modal sandbox (`MODAL_*` set) to see real sandbox findings drive a repair |
| U-5 real f⁻¹ | Pre-change `EntitySnapshot` at approve; inverse derived from snapshot minus executed bundle; executed through `applySnapshotState` → msgraph / azure-iac services → `live.ts` (script only under `CTX_ALLOW_EXECUTE`); read-back compared with the snapshot; `store.ts` prints only server lines. | `e0fece2` | `tier3-rollback.test.ts` (4 tests): approve → rollback against the in-process MCP, post-rollback snapshot deep-equals the pre-snapshot; H-19 inverse by looked-up FIC id | The live break-glass + Revert beat (`LIVE_CLOUD_MODE=true`, `CTX_ALLOW_EXECUTE=1`) on the lab tenant |

## Closed earlier (unchanged here)

| # | Item | Closed by |
|---|---|---|
| 7 | Template card content (labels, titles) | P2-1 `613ff5e` |
| 8 | Triage strip leftovers (H-21) | P1-7 `4382866`, P2-1 `613ff5e` / `0e52992` |
| 9 | Boot-time Wonder lens | P2-1 `613ff5e` |
| 12 | P0-9 done-check grep | Identifiers only; no user-visible string left |
| 15 | P1 / P2 merge conflicts and the P2-7 re-capture | Merged in `main` @ `a1b24ef`; re-captured here (`docs/ui-ux-loop/iter-4-1440x900/geometry-audit.json`, section `p1p3Build_5180`): ERP-2026323 `ticketCard.fullyAboveFold: true`, `canvas.horizontalOverflowPx: 0` |
| 22 | Hotkey `7` = Vision, clarifier key `c` | Kept; the recording-day beat in the audit now reads `c` |

## Still needs the user

| # | Item | Why this session could not do it |
|---|---|---|
| 13 | Untrack and scrub `data/synthesized-elements-log.json` | `git rm --cached` plus a history rewrite is the user's repository decision |
| 14 | P2-6 Muse Image after-fix tile | No confirmation that Meta credits remain |
| 25 | Glimmer selection pre-fetch | Needs `CTX_OPEN_WEIGHT_TIERS=hover,selection-prefetch` and wakes the L40S |
| 26 | Hover generation time on the lens header | Needs the orchestrator from this branch on :4000 (restart after merge) |
| 27 | ProgressRail ticking counter on a 30 s live correlate | Every load in this session came from the server cache |
| 28 | `muse-voice-transcribe-1.0` in `router-debug.jsonl` | One voice command with `CTX_ROUTER_DEBUG=1` |
| 30 | Graph service-health probe | Grant `ServiceHealth.Read.All` to the delegated identity, or keep the 403 wording |
| 31 | G-7, G-8, G-9, G-10, G-11, G-14, I-7, I-12, I-13 | Live object ids / seed decisions on the lab tenant |
| U-1 | Steer with Wonder configured | Meta API key on the running orchestrator |
| U-2 | Repair loop with the Modal sandbox | `MODAL_*` configured; the local pwsh pre-flight stood in for the sandbox in tests |
| U-5 | Live break-glass approve → canary → Revert Change Now | `LIVE_CLOUD_MODE=true` + `CTX_ALLOW_EXECUTE=1`; this session never approves against the tenant |

## Open edges (unchanged, P2 scope)

16 PII vault blind spots, 17 Free-Roam pseudonymisation reading, 18 popover pinning browser check, 19 accessibility items, 20 raw operator slugs, 21 `ProgressRail` "No layout" wording, 33 region hover heuristic: as written at `a1b24ef`.

## Operational notes

- The running dev servers on :4000 / :5173 serve the main checkout; none of this branch is live there until it is merged and the orchestrator restarted.
- A worktree needs its own `bun install --frozen-lockfile` (hoisted linker); without it `@contextpane/*` resolve to the main checkout and typecheck reports schema changes as missing.
- `docs/fable-research/evidence/` is still untracked.
