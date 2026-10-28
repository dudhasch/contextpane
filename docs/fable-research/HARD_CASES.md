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
8. **Triage strip leftovers (H-21).** `ScenarioPane.tsx`: "Cloud Status: Azure, Entra, Intune, GitHub OK" is still a literal instead of `correlation.services`. Built-in scenarios now report no pipeline, so the strip prints "Triage pipeline not run".
9. **Boot-time Wonder lens.** Opening http://localhost:5173 still auto-spawns the "Live Tenant Identity, Licensing, Conditional Access & Infrastructure Posture Overview" lens (`store.ts`, boot path, audit §3.2). That spends a Wonder call on every page load.
10. **Telemetry token split.** `telemetryFromSubAgentTasks` (`subagent-orchestrator.ts`) reports `prompt: 0, completion: 0` and a real `total`, because `SubAgentTaskRecord` stores only the total. Store the split in the records if the Router Savings HUD needs it.

## Test hygiene (pre-existing, not changed)

11. `apps/orchestrator/src/local/custom-ticket.test.ts` calls `remediate()`. With `.env.local` present, Bun loads it, so the test warms the real Modal sandbox and calls `stageRemediationBranch`, which creates `fix/*` branches in this repo through `git worktree`. The new tests in `tier3-remediate.test.ts` avoid both: they spy on `modalConfigured` and save drawers directly instead of calling `remediate()`. The old tests should do the same.
12. The literal P0-9 done-check (`grep -rni "dashboard" … | grep -v "testid\|Mini\|freeRoam\|import\|interface\|type "`) still lists lines, because `-i` makes the first grep case-insensitive while `-v Mini` is case-sensitive, so identifiers like `miniDashboards`, `spawnDashboard` and the mode id `"dashboard"` match. Every remaining hit is an identifier, a mode id or a code comment. No user-visible string is left.
