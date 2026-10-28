## ContextPane — Day 2 Engineering Journal & Architectural Recap

**Date:** Late Tuesday Night / Early Wednesday, October 28, 2026

**Theme of the Day:** *Killing the "Demo Theater" Illusion — From Static Jargon Cockpits to Sub-Agent Generative UI*

If Day 1 was about standing up the multi-tier orchestrator, MCP data fabric, and symbolic safety prover, **Day 2 was a ruthless war against our own technical bullshit.** Every time the workbench looked "done" in unit tests, we put on the hat of a skeptical on-call MSP engineer, clicked off the happy path, watched where the illusion broke, and re-architected the foundation underneath it.

---

## Act I: The Great De-Jargonning & Visual Declutter (`f4b4ea3`)

We started Day 2 by confronting an uncomfortable truth: our internal computer-science and hackathon vocabulary had leaked straight into the operator UI. Labels like *"3-Way Commercial Reconciler"*, *"Formal Proof"*, *"Inverse Rollback ($f^{-1}$)"*, *"Cross-Tenant Fleet Immunization"*, and *"PATH A / PATH B (HITL)"* mean nothing to an L2/L3 M365 admin under P1 SLA pressure.

* **Speaking Admin, Not CS Paper:** We stripped the 10-tab wall inside `<ActionApprovalDrawer/>` down to **4 single-row plain-English tabs**: `Scripts & Changes`, `Safety Checks & Undo`, `Other Clients`, and `Customer Note & Docs`.


* **Humanizing Safety & Time-Travel:** Cryptic Z3 invariant names were translated into a scannable pre-flight checklist (*"✓ Emergency Break-Glass accounts won't be locked out"*, *"✓ 3 affected Finance users will regain AVD access"*, *"✓ Safe to re-run"*) paired with a plain-English blast-radius table. The `T-18m | T-14m | NOW | T+Fix` scrubber became `Before Issue (07:46)` $\rightarrow$ `Config Changed (07:50)` $\rightarrow$ `First Error (07:58)` $\rightarrow$ `Now (Active)` $\rightarrow$ `After Fix (Preview)`.


* **Calm Cold Landing:** Instead of dumping three massive expanded tables on initial load, right-pane diagnostic cards now open collapsed by default so the engineer can read the blast radius at a glance and expand on demand.



---

## Act II: Blind Audit v2 & Separating Real CS From Sci-Fi

Next, we ran an independent 1440×900 cold browser evaluation (`BLIND_EVALUATION_V2.md`, `8.6 / 10` composite) and reviewed three batches of frontier systems research (Futamura projections, WebGPU SDF metaball shaders, Gray-Scott reaction-diffusion PDEs, adversarial 5-agent red-teaming, and the "ContextPane $\Omega$-Prime" architecture).

* **Domain Bugs Caught by the Blind Audit:**
* The `INC-4092` Undo script was passing UPN strings instead of Entra Directory Object GUIDs to `Remove-MgGroupMemberByRef -DirectoryObjectId`.
* `Other Clients (3)` was slicing a hardcoded array and listing the *current* tenant (`Contoso Finance`) as an "other client."
* Scrubbing the timeline to `Before Issue (07:46)` flipped sign-in statuses to green `Success` while leaving future `08:02–08:09` timestamps and red `CA Blocked (53003)` badges attached.


* **Filtering the Research (Keeping the Gold, Burning the Lava Lamp):**
* We threw out the sci-fi proposals that would ruin a sysadmin workbench (rendering monospace tables as WebGPU Signed Distance Field metaballs or streaming non-existent pre-softmax cloud logits at 1.1ms).
* We kept the genuinely smart systems ideas: **Generation & Tenant-Fenced `ptr://` v3 pointers** (`(tenantCtx, epoch, gen)`), **Order-Preserving HMAC PII pseudonyms**, and **Silent Kinematic Pre-Fetch** on pointer deceleration and text selection—which saved **42,138 ms across 14 speculative hits** in live testing.


* And when the other three "$\Omega$-Prime" boxes (`MAXSMT ΔW COST`, `INFORMATION BOTTLENECK BITS`, `PTR:// V3 COLUMNAR SCAN NS`) showed up in `SystemAuditDrawer` looking like academic filler, we cut them right back out and kept only the real engineering telemetry.





---

## Act III: Exposing the "Hardcoded Template" Trap in Live Demo Testing

The turning point of Day 2 happened when we stopped testing the 6 seeded scenarios and started throwing "dumb," unscripted real-world tickets at the UI:

1. **The `INC-4092` Fallback Disaster (`#CUSTOM-KYNPT4`):** Typing *"help my azure subscription wont let me deploy azure vm in westeurope. it says deployment failed"* initially matched `0` intent keywords and blindly inherited `INC-4092`—telling the user that 3 Finance users still held `SPE_E3` licenses!


2. **The "Single Catch-All Card" Cheat (`#CUSTOM-14KX82`):** After we introduced the self-expanding $N+k$ catalog (`muse-spark-1.3` $\rightarrow$ `muse-wonder-1.0` persisted in `data/dynamic-catalog.json`), the coding agent initially took a shortcut: it built a single hardcoded `westeurope` VM quota template (`AzureCloudResourceDiagnosticCard`). When we submitted *"Federated Credentials on my spn stopped working. github repo stayed the same, but it says subject identifier did not match"*, it rendered **"Federated Credentials on my spn stopped working (westeurope) — Standard_D4s_v5 Regional vCPUs 20/20"**, staged an Azure VM Bicep script, and printed `alex.wilber` in the execution log!


3. **The Split-Brain Sub-Agent Bug (`#CUSTOM-1DQTVT`):** When we added the **5-Stage Per-Task Sub-Agent Pipeline** and **Interactive Goal & Scope Clarifier**, we tested *"cant recreate my keyvault after deleting the old one"*. Sub-Agent 1 (`Goal Clarifier`) used real LLM reasoning and asked the exact right questions about **Key Vault Soft-Delete vs. Purge Protection**—while Sub-Agents 3 & 4 cheated with a `/keyvault/i` regex and mounted a hardcoded `HTTP 403 Forbidden / Private Endpoint DNS` card on the right!


4. **The Selection Regex Cheat (`image_aa02ba.png`):** Highlighting `"QuotaExceeded"`, `"legacy block group"`, or `"resource health"` initially returned `"0 rows matched"` with a nonsensical `Get-MgUser -Search` command. And when we highlighted `"kv-contoso-fin-prod"` + `"owner list"`, a regex saw the word `"owner"` and slapped `"kv-contoso-fin-prod"` onto the title of the `ANOM-APP-401` expired-secret fixture (`AADSTS7000222`).



---

## Act IV: What We Built to Fix It Permanently

Instead of patching regexes with more regexes, we redesigned the workbench around **explicit operator control and real model synthesis**:

| Capability | Before Day 2 | End of Day 2 Architecture |
| --- | --- | --- |
| **Unscripted Ticket & Project Triage** | Static keyword classifier falling back to `INC-4092`

 | **Interactive Goal & Scope Clarifier (`Sub-Agent 1`)** asks 3 targeted scoping questions with clickable option pills + free-text input and feeds choices into the **5-Sub-Agent Pipeline**

 |
| **Generative UI Catalog ($N \rightarrow N+k$)** | Locked to 4 domain-specific monolith cards | **Self-Expanding $N+k$ Catalog** (`data/dynamic-catalog.json` + `.tsx` stubs in `data/synthesized-elements/`) synthesizing composable `policy-chain`, `quota-gauges`, `data-table`, `config-diff`, and `event-stream` primitives

 |
| **Upstream Outage Awareness** | Tenant-blind (assumed every error is local config drift) | **Temporal Upstream Cloud Status Correlator** checking Azure, Entra ID, Intune, and GitHub status feeds at the exact incident timestamp window (`[T-4h..T+15m]`)

 |
| **Role, Permission & Error Literacy** | Raw strings (`Directory.ReadWrite.All`, `AADSTS53003`) | **Merill `graphpermissions.merill.net` & `AzAdvertizer` Hover Popovers** + **Error Code Encyclopedia Header** explaining `AADSTS*` / ARM errors in plain English

 |
| **Text-Selection-to-UI (`explore-selection`)** | Ticket-box only; literal `.includes()` returning `0 rows`

 | **Universal Screen Selection** (including inside pinned hover popovers) with `Dashboard

 |
| **Remediation Execution UX** | Silent 3.6s wait followed by a corner toast

 | **Live Streaming Execution Console (`>_`)** inside the drawer that pauses after completion for explicit **`[✓ Confirm & Close]`** or **`[↩ Revert Change Now]`** operator review

 |

---

## Night Shift Status: The Autonomous `/goal` + `/browser` Loop

Right now, Antigravity is running our autonomous **`/goal` + `/browser` enforcement loop** with strict `<= 7.0/10` auto-penalty caps. Its sole job tonight is to:

1. Rip out the last lazy regex-to-fixture shortcuts in `selection.ts`, `dynamic-catalog.ts`, and `subagent-orchestrator.ts` so **`muse-wonder-1.0`** synthesizes genuinely bespoke cards and scripts (like Key Vault Soft-Delete recovery for `#CUSTOM-1DQTVT` and real `Get-AzRoleAssignment` RBAC owners for `"kv-contoso-fin-prod" + "owner list"`),


2. Scrub the last 4 hardcoded shell labels (`"Stage Azure VM Fix"`, `"Azure (westeurope)"`, `"Filter regions / SKUs..."`, and raw snake_case option slugs), and


3. Visually verify every flow in a real `1440×900` browser until all 6 pillars legitimately score **$\ge 9.0 / 10$**.