# Hard cases left after the P0 pass

Written 2026-10-28 at the end of the P0 session (commits `6cd67ca`..`7de777d` on `main`), for the Fable 5.1 session (U-1 steering contract, U-2 write-then-test, U-5 real rollback) and the P1/P2 sessions. Each entry names the file and line as of `7de777d`, what the P0 pass did, and what is still open.

## Needs a design decision

1. **Template cards are never persisted (deviation from the P0-4 spec).**
   `apps/orchestrator/src/local/dynamic-catalog.ts` (`buildTemplateCards`, the `if (!card)` branch of `synthesizeAndPersistMissingElements`).
   The spec asked for template cards to be upserted into `data/dynamic-catalog.json` and labelled. I did that first (`8b554bb`). Then the dev server (`bun run --watch`) rewrote the tracked catalog and wrote a `.tsx` stub for every ERP drop on each reload, so I stopped persisting templates at all (`4a3d6a8`). The catalog now holds only real `muse-wonder-1.0` syntheses (4 entries), and a template card has `tsxStubPath: ""` and `sourceRef: null`. If the N+k story needs templates in the HUD, list them from `custom-scenarios.json` instead of writing them to the tracked file.

2. **Custom-ticket execution with `CTX_ALLOW_EXECUTE`.**
   `apps/orchestrator/src/tiers/tier3-remediate.ts`, custom branch of `approve()` (search for `custom bundles are staged, not executed`).
   By default a CUSTOM-/ERP- approval is now `state: "simulated"`, `execution: "simulated"`, and no convergence is set, so the ticket stays open. Only when `LIVE_CLOUD_MODE` and `CTX_ALLOW_EXECUTE` are both on does it run `runApprovedScript(drawer)`. Exit code 0 then counts as `executed`. That path was already used for built-in scenarios. It has no pre-snapshot, no per-object results (`results: []`), and no read-back. That work belongs to U-2 (write-then-test) and U-5 (inverse from snapshot). Decide whether exit code 0 is enough to call a custom ticket executed, or whether it needs a read-back probe first.

3. **S3 and S4 still run side by side after S1.**
   `apps/orchestrator/src/local/subagent-orchestrator.ts`, `runSubAgentPipeline`.
   Order: S1 clarifier → (S2 telemetry ∥ [Spark gatekeeper → Wonder card synthesizer] ∥ S4 coder) → S5. S3 and S4 get the same `effectiveAnswers`, so they agree on strategy. The coder still does not see the gatekeeper's `customBrief` or the card diff, so the two artefacts can still differ in detail. A full S3 → S4 handoff (the coder consumes the card) is the U-1 steering contract. It would add the card synthesis latency (~15 s) to the critical path.

## Still demo theater (P1 scope, found while fixing P0)

4. **Canary probes on custom tickets.** In `apps/orchestrator/src/local/canary-convergence.ts:L91-L118` the identity probe reads the formal invariants. Since P0-8 those are empty for custom tickets, so the probe reports `passed: false`. The SYNTHETIC_PROBED stage still says "Synthetic probes passed" (`L180-L188`). `app.ts` runs the canary on every approval (`approveHandler`), including staged custom ones. Fix: no canary for a non-executed approval; `probeSource: "symbolic"` otherwise (M-15).
5. **`verifyIdempotency` for custom ids** (`apps/orchestrator/src/local/formal-verifier.ts`, `verifyIdempotency`) still runs the fixture transform and returns `passed: true`. `/api/rollback` and the PSA note use it. It should return `null` for ids without a symbolic model, like `verifyFormalInvariants` now does.
6. **Canary drill rollback wording.** `app.ts` `approveHandler`, `AUTO_ROLLED_BACK` branch: "Inverse rollback f⁻¹ executed: in-memory state reverted to pre-change baseline". `ActionApprovalDrawer.tsx` `CanaryTraceBanner`: "ROLLED_BACK (PREVIOUS STATE RESTORED)". Both are still shown for a simulated drill. They are honest about the canvas, not about a tenant. Fold into U-5.
7. **Template card content** (`dynamic-catalog.ts`, `buildMinimalFallbackCard`) still uses the PascalCase slug as gauge label, table cell and event operation, and repeats the 80-char title in every block (audit §3.3/§3.4). The label is now honest; the content is still ugly.
8. **Triage strip leftovers (H-21).** ~~`ScenarioPane.tsx`: "Cloud Status: Azure, Entra, Intune, GitHub OK" is still a literal instead of `correlation.services`.~~ Fixed in P1-7: the bar names only services a probe reported operational and counts the "not probed" ones. Built-in scenarios now report no pipeline, so the strip prints "Triage pipeline not run".
9. **Boot-time Wonder lens.** Opening http://localhost:5173 still auto-spawns the "Live Tenant Identity, Licensing, Conditional Access & Infrastructure Posture Overview" lens (`store.ts`, boot path, audit §3.2). That spends a Wonder call on every page load.
10. **Telemetry token split.** `telemetryFromSubAgentTasks` (`subagent-orchestrator.ts`) reports `prompt: 0, completion: 0` and a real `total`, because `SubAgentTaskRecord` stores only the total. Store the split in the records if the Router Savings HUD needs it.

## Test hygiene (pre-existing, not changed)

11. `apps/orchestrator/src/local/custom-ticket.test.ts` calls `remediate()`. With `.env.local` present, Bun loads it, so the test warms the real Modal sandbox and calls `stageRemediationBranch`, which creates `fix/*` branches in this repo through `git worktree`. The new tests in `tier3-remediate.test.ts` avoid both: they spy on `modalConfigured` and save drawers directly instead of calling `remediate()`. The old tests should do the same.
12. The literal P0-9 done-check (`grep -rni "dashboard" … | grep -v "testid\|Mini\|freeRoam\|import\|interface\|type "`) still lists lines, because `-i` makes the first grep case-insensitive while `-v Mini` is case-sensitive, so identifiers like `miniDashboards`, `spawnDashboard` and the mode id `"dashboard"` match. Every remaining hit is an identifier, a mode id or a code comment. No user-visible string is left.

# Left after the P1 pass

Written 2026-10-28 at the end of the P1 session (branch `claude/agitated-wiles-38db99`, commits `dd4dc6b`..`1907239`, rebased on `83191f5`). Line numbers are as of `1907239`. The running dev servers on :4000 / :5173 serve the main checkout, so none of this is live until the branch is merged and the orchestrator restarted. Browser checks in this pass used this branch's web build on :5174 against the main orchestrator.

## Deviations from the brief (decide whether to keep)

13. **Hotkey `7` and the clarifier key.** `apps/web/src/hooks/useDemoHotkeys.ts`. The brief asked for a `7` case in the 1-9 queue switch, but `7` is the Vision beat ("Extract the ticket screenshot", `lib/demo.ts`); a queue case shadowed it. Kept `7` = Vision globally; inside the open queue every digit 1-9 opens its row (`WorkQueue.tsx` `onKey`), which covers `Ctrl+K` → `7`. The clarifier toggle is `c`, not `n` (`n` opens the ticket composer). The recording-day beat "toggle a clarifier pill (`n`)" should read `c`.
14. **Seeded tickets are pinned first when the chip is on** (`lib/workitem.ts` `orderWorkItems`). That is what makes `Ctrl+K` → `1` open INC-4092 regardless of newer ERP drops, but it also changes the queue order in Simulated Lab, where the chip defaults to on.
15. **PowerShell smoke test.** `scripts/Test-ContextPaneSmoke.ps1` was not run: it approves a break-glass remediation and calls `/api/lab/reset-drift` against the running orchestrator, which this session must not do. `apps/orchestrator/src/local/remediate.test.ts` parses every forward / inverse / Detect / Remediate script with the pwsh 7 parser and the pre-flight verb allow-list instead. Run the smoke test with `-Mode gitops -SkipRemediate` on a lab you own if you want the end-to-end check.

## Not verified live

16. **Glimmer selection pre-fetch** (`tiers/explore.ts` `chainSteps`, `store.ts` `prewarmSelectionExplore`). Only runs with `CTX_OPEN_WEIGHT_TIERS=hover,selection-prefetch` and an open-weight URL; the running server has `hover` only. Not exercised (it wakes the L40S). A click waits at most 4 s on an in-flight pre-fetch, then calls the hosted chain.
17. **Hover generation time** ("… · 22.8 s · cached") needs the orchestrator from this branch (`providerTelemetry.generatedLatencyMs`); the main server showed "Muse Glimmer 30B · Modal L40S · cached" without the seconds.
18. **ProgressRail ticking counter** (`components/canvas/ProgressRail.tsx`). Every load in this session came back from the server cache in < 0.5 s, so the 30 s live-correlate case was not observed. The skeleton with the ERP ticket body did render at t = 0.
19. **`muse-voice-transcribe-1.0` in `data/router-debug.jsonl`.** The ASR path never logged; `router/openai.ts` `transcribeAudio` now does (model, latency, transcript length). One voice command with `CTX_ROUTER_DEBUG=1` closes the P1-8 done-check.

## Still open (found while fixing P1)

20. **Rollback of a Free-Roam action.** `formal-verifier.ts` `buildInverseRollback` → `postState` throws `unknown scenarioId` for `FREE-<hash>` ids (P1-7 H-05), so `/api/rollback` for a Free-Roam drawer returns an error instead of "staged action, nothing to revert". Belongs with U-5.
21. **Entra / Intune upstream status is "Not probed"** (`local/cloud-status-correlator.ts` `notProbed`). There is no public feed; the honest source is Graph `GET /admin/serviceAnnouncement/healthOverviews` (needs `ServiceHealth.Read.All` on the delegated identity). Design decision: add the scope, or keep "not probed".
22. **Dim 4 rows outside the P1-6 list**, still as in the audit's cloud-script ledger: G-7 (`remediate.ts` `caAnomaly`, CA-001 PATCH replaces `conditions.users` wholesale), G-8 (`workloadIdentityFix` hard-coded GUID `$GrantId`, should be looked up by `clientId`), G-9 (graphPatch app-role assignment ids), G-10 (FIC subject `ref:refs/heads/main` vs presented `environment:prod`), G-11 (golden-tenant app-role ids), G-13 (`packages/catalog/src/tools.ts` coder tool description contradicts the group-based path), G-14 (seed script comment), I-7 (firewall settings marked `tattooedOnUnassign: true` in `mcp-msgraph/src/fixtures.ts`), I-12 (`selection.ts` invented `MDM_BITLOCKER_POLICY_CONFLICT`), I-13 (INC-4099 tenant guard vs where the Intune objects are seeded), R-7 (Undo re-opens RDP to `*`; surface the exposure in the Undo UI).
23. **Runbook forward scripts** (`local/runbook.ts` `forwardScript`) for INC-4099 and every ANOM-* still use slug ids (`intune-cfg-fabrikam-legacy-bitlocker`, `ca-policy-001`, `md-fabrikam-lt-1107`, `44444444-…`). They are illustrative runbook text, not the executed bundle; resolve by display name like `remediate.ts` if the runbook is shown in the demo.
24. **Region hover heuristic** (`local/hover.ts` `regionHover`): a token is treated as an Azure region when it looks like one (`westeurope`, `eastus2`, …) and the answer comes only from `ctx.regionalQuotas` / `ctx.azurePolicies`. A region the quota gather did not cover shows "no quota data", which is honest but sparse; the live gather reads `westeurope` only (`mcp-azure-iac/src/service.ts` `getRegionalQuotas`).
