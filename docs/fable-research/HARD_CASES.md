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
7. _Closed by P2-1 (613ff5e): humanised labels, short block titles, `truncateAtWord`._ **Template card content** (`dynamic-catalog.ts`, `buildMinimalFallbackCard`) still uses the PascalCase slug as gauge label, table cell and event operation, and repeats the 80-char title in every block (audit §3.3/§3.4). The label is now honest; the content is still ugly.
8. _Closed by P2-1 (613ff5e, 0e52992): service count from `correlation.services`, names in the tooltip._ **Triage strip leftovers (H-21).** `ScenarioPane.tsx`: "Cloud Status: Azure, Entra, Intune, GitHub OK" is still a literal instead of `correlation.services`. Built-in scenarios now report no pipeline, so the strip prints "Triage pipeline not run".
9. _Closed by P2-1 (613ff5e): no spawn in `boot()`/`openFreeRoam()`; empty-state button instead._ **Boot-time Wonder lens.** Opening http://localhost:5173 still auto-spawns the "Live Tenant Identity, Licensing, Conditional Access & Infrastructure Posture Overview" lens (`store.ts`, boot path, audit §3.2). That spends a Wonder call on every page load.
10. **Telemetry token split.** `telemetryFromSubAgentTasks` (`subagent-orchestrator.ts`) reports `prompt: 0, completion: 0` and a real `total`, because `SubAgentTaskRecord` stores only the total. Store the split in the records if the Router Savings HUD needs it.

## Test hygiene (pre-existing, not changed)

11. `apps/orchestrator/src/local/custom-ticket.test.ts` calls `remediate()`. With `.env.local` present, Bun loads it, so the test warms the real Modal sandbox and calls `stageRemediationBranch`, which creates `fix/*` branches in this repo through `git worktree`. The new tests in `tier3-remediate.test.ts` avoid both: they spy on `modalConfigured` and save drawers directly instead of calling `remediate()`. The old tests should do the same.
12. The literal P0-9 done-check (`grep -rni "dashboard" … | grep -v "testid\|Mini\|freeRoam\|import\|interface\|type "`) still lists lines, because `-i` makes the first grep case-insensitive while `-v Mini` is case-sensitive, so identifiers like `miniDashboards`, `spawnDashboard` and the mode id `"dashboard"` match. Every remaining hit is an identifier, a mode id or a code comment. No user-visible string is left.

# Hard cases left after the P2 pass

Written 2026-10-28 at the end of the P2 session (branch `claude/kind-kapitsa-ba3415`, commits `613ff5e`..`751376d`, main merged in at `40f4eec`). Line numbers are as of `751376d`.

## Needs the user

13. **Untrack and scrub `data/synthesized-elements-log.json`.** Since `fcc58f0` it is in `.gitignore` and new entries store the pseudonymised prompt, but the file is still tracked and five commits (`e0e9041`, `c5a0457`, `fc0d574`, `19c325c`, `0f94f03`) hold ticket prompts with names and UPNs. Run `git rm --cached data/synthesized-elements-log.json` and commit, then scrub history before the repo goes public (for example `git filter-repo --invert-paths --path data/synthesized-elements-log.json`). `data/router-debug.jsonl` was never committed; nothing to scrub there.
14. **P2-6 (Muse Image after-fix tile) was not attempted.** No confirmation that Meta credits remain.

## Merge with P1 (`claude/agitated-wiles-38db99`)

15. Expect conflicts where P1 and P2 both edit: `ScenarioPane.tsx` status strip and customer-ticket card (P1-2), `local/selection.ts` license slice (P1-7; P2 wraps the SKU labels in `humanizeSku`), `lib/format.ts` near `TIER_ROUTE` (P1-8; P2 appends the label maps at the end), `local/dynamic-catalog.ts` `buildMinimalFallbackCard`. After merging, re-run the P2-7 capture (`docs/ui-ux-loop/iter-4-1440x900/geometry-audit.json`, method in the file): ERP #2026323 should then reach `ticketCard.fullyAboveFold: true` and `canvas.horizontalOverflowPx: 0`. On `751376d` it still needs 499 px of scroll and overflows by 118 px.

## Open edges of P2

16. **The PII vault only knows the people it has been told about.** `packages/catalog/src/dataplane.ts`, `PiiVault.pseudonymizeText` / `registerPersonsFrom`. In prompts it replaces e-mail addresses, public IPv4s, the "First Last" read from a `first.last@` UPN, and names registered from gathered contexts (`mcp/context.ts` `gatherContext`). It misses a bare first name ("Lynne said…"), a person who is in neither the context nor a UPN in the same prompt, and anything inside image parts: Vision screenshots go to the model raw. Version strings shaped like `1.2.3.4` are vaulted as IPs too; they map back, so the cost is only a slightly odder prompt. The scan behind `zeroRawPiiInLlmPrompt` has the same blind spots, so `true` means "no raw PII the vault can recognise".
17. **Free-Roam explorer pseudonymisation is a reading of the spec.** `apps/web/src/lib/pseudonym.ts`. `#EXT#` guests are masked in every mode. Outside Real-Tenant mode, rows from a `live*` source are pseudonymised. The seeded manifest is fictional and is shown as is. If the intent was to pseudonymise *every* row outside Real-Tenant mode, change `pseudonymiseAll` there. Row `queryPrompt`s stay unchanged; the router vaults them.
18. **Popover pinning was browser-tested on the ticket body only.** The Generate first-click fix was confirmed live (`d16aef0`). The popover side (a drag that ends outside an EntityPill popover; an outside click while the bar is up) was checked by reading the code. I did not exercise it in the browser, to avoid spending hover calls. To check: hover Lynne, select inside the popover, drag out, release, click outside once. The popover should close on that first click.
19. **Accessibility items from §3.6 outside the P2 list are untouched.** Token focus ring on the ≈60 raw `<button>`s. Inputs that drop the outline (`WorkQueue.tsx` search, `ContextualMiniDashboard.tsx` follow-up, `FreeRoamExplorer.tsx`, `TicketComposer.tsx`). The selection bar still hijacks Tab to cycle modes and sets `tabIndex={-1}` on the mode radios (`SelectionTrigger.tsx`, `onBarKeyDown`). Tabs have no `aria-controls` or arrow keys. The `CodeBlock.tsx` `break-words` row of §3.4 is also open.
20. **Remaining raw slugs.** `SynthesizedDynamicCard.tsx` event `status` and `operation`, and the System & Audit drawer's operator-facing ids (`LIVE_CLOUD_MODE=…`, model ids, endpoints), are still shown raw. They are meant for operators, so I left them; route them through `humanizeStatus` if the video shows them.
21. **`ProgressRail` when correlate finished without a layout.** `GenUICanvas.tsx`: with `layout === null` and `canvasStatus === "ready"` the rail now reads "No layout for this scenario" (not busy) instead of an empty void. I never saw that state live, so the wording is unreviewed.

