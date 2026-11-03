<div align="center">

# ContextPane

**An operator-steered remediation workbench for MSP engineers on Microsoft Entra ID, Intune and Azure.**

<sub>Built on Meta Muse: <b>Glimmer 30B</b> (open weights, on our own GPU) explains whatever you hover · <b>Spark 1.3</b> routes the ticket and lays out the views · <b>Wonder 1.0</b> asks the scoping questions, builds missing views, composes selection lenses and writes the fix · <b>Voice Transcribe 1.0</b> turns spoken steering into commands</sub>

[![Track](https://img.shields.io/badge/Meta_Hackathon-Indie_Developer_Track-6cb4ff?style=flat-square)](HACKATHON_ATTRIBUTION.md)
[![Models](https://img.shields.io/badge/Meta_Muse-Glimmer_30B_·_Spark_1.3_·_Wonder_1.0_·_Voice_Transcribe-b69cff?style=flat-square)](#4-meta-muse-models-in-execution-order)
[![Open weights](https://img.shields.io/badge/Open_weights-Muse_Glimmer_30B_on_Modal_L40S-58d39a?style=flat-square)](modal-sandbox/README.md)
[![CI](https://github.com/dudhasch/contextpane/actions/workflows/ci.yml/badge.svg)](https://github.com/dudhasch/contextpane/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-9aa3b1?style=flat-square)](LICENSE)

</div>

> **ContextPane** correlates tenant state (a seeded lab by default, a live tenant with `LIVE_CLOUD_MODE=true`) with a vague support ticket. It traces the incident across Microsoft Entra ID, Intune and Azure ARM, composes any missing diagnostic UI on the fly with **Muse Wonder**, and stages sandbox-checked PowerShell 7 and Terraform fixes. Every fix comes with a 1-click inverse (f⁻¹). Nothing is written to a tenant unless both `LIVE_CLOUD_MODE=true` and `CTX_ALLOW_EXECUTE=true` are set, and then only from an explicit operator action.

<p align="center">
  <img src="docs/assets/hero-flight-deck.webp" alt="ContextPane flight deck loop: hover a pill to get a Muse Glimmer 30B diagnostic, highlight text to get a Muse Wonder lens, flip a scope chip and the Muse Code rail re-parameterises the script" width="100%">
  <br><sub>11.8 s loop, captured live from the running stack: ① Glimmer hover popover ② selection → Muse Wonder lens ③ scope chip → steering v1 → script diff in the Muse Code rail. A <a href="docs/assets/hero-flight-deck.gif">GIF fallback</a> is also included.</sub>
</p>

<p align="center"><img src="docs/assets/01-flight-deck-3zone.png" alt="The three-zone flight deck at 1440×900: ticket and plan, diagnostic lens canvas, Muse Code rail" width="100%"></p>

---

## Highlight anything: the selection lens

**Select any phrase in the ticket, on a card or in a hover popover, and ContextPane builds a live view of it.** Highlight 3–120 characters, even in an unscripted ticket nobody has seen before, optionally add context ("other apps with the same owner"), press Enter, and `muse-wonder-1.0` composes a lens over the tenant data behind that phrase. No query to write, no dashboard to pick.

<p align="center"><img src="docs/assets/06-universal-selection-lenses.png" alt="A highlighted ticket phrase becomes Selection #1; Muse Wonder composes a Triage lens and the same selection in Blast radius mode" width="100%"></p>

- **Any text.** A user name, an error code, a policy, a half-sentence from a customer's ticket: the selection is the query, and the phrase stays marked in the ticket as `Selection #n`.
- **Four views of one selection.** The same lens switches between **Triage lens**, **Inspector**, **State diff** and **Blast radius**, so you go from "what is this" to "what else does it hit" without leaving the ticket.
- **Feels instant.** Selecting a literal UPN or GUID pre-warms the lens before you press Enter; one hit in the capture saved 4.4 s. Other selections take 4.4–4.8 s.
- **Ends in an action.** Every lens carries a targeted fix to stage in the Muse Code rail, plus the command and the Graph / PowerShell query behind it to copy, and a follow-up box to refine it.

How it works: [§5.5](#55-zero-context-correlation-and-universal-selection-lenses).

---

## Contents

1. [Quickstart and verification](#1-quickstart-and-verification)
2. [Hackathon compliance matrix](#2-hackathon-compliance-matrix)
3. [What ContextPane is not](#3-what-contextpane-is-not)
4. [Meta Muse models in execution order](#4-meta-muse-models-in-execution-order)
5. [Five systems deep dives](#5-five-systems-deep-dives)
6. [What is live, what is simulated](#6-what-is-live-what-is-simulated)
7. [Monorepo map](#7-monorepo-map)

---

## 1. Quickstart and verification

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.2 and PowerShell 7 (without pwsh the pre-flight cannot run, so every fix reads "Verification Failed" and can only be approved through Override with a justification); Terraform is optional (`winget install Oven-sh.Bun Hashicorp.Terraform`).

```bash
bun install
bun run dev
```

The orchestrator listens on http://127.0.0.1:4000 (`GET /api/health`) and the workbench on http://localhost:5173. Vite proxies `/api` and `/ws`. Everything but `GET /api/health` needs a bearer token, a `127.0.0.1` / `localhost` Host header and `application/json` writes; the orchestrator mints the token into the git-ignored `.contextpane/api-token` at start-up (or reads `CTX_API_TOKEN`) and the Vite proxy adds it, so `bun run dev` needs no setup. Approvals, overrides, rollbacks and closures record the host's signed-in Graph account (or the configured lab default), never a name from the request body. The web app has no sign-in of its own, so this identifies the machine's operator account, not the person who clicked; every audit entry says which (`identitySource`).

| Mode | How | What you get |
|---|---|---|
| **Lab fixtures (no keys)** | nothing to configure | Every tier answers from the deterministic engine over `demo-iac/demo-lab-manifest.json` and the labelled fixtures |
| **Meta models** | `pwsh -NoProfile -File ./scripts/Set-ContextPaneRouterConfig.ps1` (writes git-ignored `.env.local`) or copy `.env.example` | `META_API_KEY`, optional `MODAL_INFERENCE_BASE_URL` (Glimmer) and `CTX_MODAL_SANDBOX_URL` (pre-flight) |
| **Live Entra / Azure tenant** | `Install-ContextPaneModules.ps1`, `Connect-AzAccount`, `Connect-ContextPaneGraph.ps1` (delegated CA/Intune write scopes), review and run `Invoke-SeedContextPaneLab.ps1`, then start with `LIVE_CLOUD_MODE=true` (reads) and `CTX_ALLOW_EXECUTE=true` (writes); the in-app data-mode toggle cannot turn live mode on by itself | Live reads; writes only from an explicit operator action, checked against the lab tenant id; `Remove-ContextPaneLab.ps1` tears it down |

```bash
bun run typecheck   # 6 workspaces, tsc --noEmit
bun test            # 414 tests across 64 files: all pass in CI (pwsh 7.6, Terraform 1.9.8); without pwsh, 1 repair-loop test fails and 2 are skipped
bun run smoke       # pwsh smoke test of every tier endpoint and its Zod schema (reads the API token from .contextpane/api-token)
bun run eval        # coder eval: 28 tickets incl. 12 prompt-injection cases (--live for the Meta API), see apps/orchestrator/evals
```

Without PowerShell 7 on the PATH the pre-flight cannot run, so the repair-loop case that expects a Verified Safe bundle fails and two pwsh-only cases are skipped. [CI](.github/workflows/ci.yml) runs everything on pushes to `main` and on pull requests with pwsh 7 and Terraform 1.9.8 on the deterministic engine (no model, tenant or Modal calls): 414/414 tests pass, and the eval scores pre-flight 28/28 and injection safety 12/12 (2026-11-03). Offline, the eval scores the deterministic template, not a model; run it with `--live` to measure the model.

**Hotkeys** (press `?` in the app): `Ctrl+K` work queue · `h` hover hero entity · `e` run step 1 · `d` diff · `f` open remediation · `x` approve (only when the Approve button would allow it) · `u` explore selection · `c` clarifier · `t` router savings · `a` audit · `0` reset drift and `g` ERP drop (both ask first; `Shift` acts at once). The full list is in [`apps/web/README.md`](apps/web/README.md#hotkeys).

---

## 2. Hackathon compliance matrix

| Field | Value |
|---|---|
| **Event** | Meta Global AI Developer Hackathon, 2026-10-26 → 2026-11-04 |
| **Track** | Indie Developer Track (solo entry: Timur Dudhasch, GitHub `dudhasch`) |
| **Theme** | *Build for Your World*: the author's own MSP operations work |
| **Meta models called** | `muse-glimmer-30b` (open weights, Modal L40S) · `muse-spark-1.3` · `muse-wonder-1.0` · `muse-voice-transcribe-1.0`. `muse-code` is configured but not served by the Meta Model API, so the router sends those calls to `muse-wonder-1.0` and reports the swap ([details](#model-stand-ins)) |
| **Provenance** | Built inside the hackathon window. See [HACKATHON_ATTRIBUTION.md](HACKATHON_ATTRIBUTION.md) |
| **License** | MIT |
| **Media** | Animated WebP/GIF loops and annotated PNGs in [`docs/assets/`](docs/assets). No video files in the repository |

---

## 3. What ContextPane is not

| Common category | Why ContextPane is different |
|---|---|
| **A dashboard** | Dashboards display state. In ContextPane every view ends in an action. Each lens and plan step leads to a staged PowerShell 7 / Graph / Terraform change in the permanent 440 px **Muse Code rail**. The change carries a pre-flight verdict, a blast radius, an undo script and a human approve button |
| **A chatbot or RAG app** | There is no chat box. Models are called through forced tool schemas (Zod → JSON schema), and their output is validated before anything renders. Prompts carry pseudonyms for the identities the vault detects, and customer-written text reaches a model only as delimited untrusted data (§5.1). Cards bind to live MCP rows through `ptr://` pointers instead of prose; in synthesized cards only the rows backed by tenant data do, and model-written values are labelled as estimates (§5.3) |
| **An autonomous agent** | The agent proposes, checks and repairs; the operator steers and approves. Scope chips and lens-row clicks travel back into the coder (`PATCH /api/tickets/:id/steer`), and writes happen only from an explicit click |
| **A static demo** | Cards that do not exist are composed at triage time (see [§5.3](#53-self-expanding-nk-generative-ui)). The registry grew from k=4 to k=5 while these screenshots were being captured |

---

## 4. Meta Muse models in execution order

<p align="center"><img src="docs/assets/arch-muse-execution-pipeline.svg" alt="Execution order: Stage 0 Glimmer hover; stages 1-5 sub-agent pipeline; steering; Tier 3 sandbox pre-flight, write-then-test, prover, human approve; provider boundary with the PII vault" width="100%"></p>

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant Web as Web (React 19)
    participant Orc as Orchestrator (Bun + Hono)
    participant MCP as MCP servers
    participant Gl as muse-glimmer-30b (Modal L40S)
    participant Meta as Meta Model API
    participant Box as Modal sandbox

    Note over Orc,Meta: start-up: warmHoverCache answers every pill once (hosted chain) and persists it
    Op->>Web: hover a pill (60 ms dwell → speculative pre-fetch)
    Web->>Orc: POST /api/hover
    Orc-->>Web: persisted Glimmer answer (2 ms, while its context is unchanged) or live chain
    Op->>Web: paste an unscripted ticket
    Web->>Orc: POST /api/tickets/triage-custom
    Orc->>MCP: Telemetry Scout probe (stage 2, runs throughout)
    Orc->>Meta: Goal Clarifier · muse-wonder-1.0 (stage 1)
    par stages 2-4
        Orc->>Meta: Gatekeeper · muse-spark-1.3 → Synthesizer · muse-wonder-1.0
        Orc->>Meta: Coder · muse-code (served as muse-wonder-1.0)
    end
    Orc->>Orc: Safety Verifier · static precheck (stage 5)
    Orc->>Box: pre-flight: pwsh AST + command allow-list, terraform fmt/validate
    Box-->>Orc: findings
    loop write-then-test, ≤ 2 turns while repairable findings remain
        Orc->>Meta: coder repair turn
        Orc->>Box: pre-flight again
    end
    Orc-->>Web: SSE: card, script, verdict, proof
    Op->>Web: flip a scope chip
    Web->>Orc: PATCH /api/tickets/:id/steer
    Orc->>Meta: coder re-parameterises the staged script
    Orc-->>Web: steering v1 + script diff
    Op->>Web: approve (break-glass or GitOps PR)
    Orc->>MCP: pre-change snapshot → write → canary
    Op->>Web: 1-click undo → POST /api/rollback (inverse from snapshot)
```

| Stage | Model id (configured → answering) | Contract | Measured | Why this model here | Code |
|---|---|---|---|---|---|
| **0 · Hover (Tier 1A)** | `muse-glimmer-30b` on Modal for every `?refresh=true` (it produced the 21 seeded answers); the start-up warm-up and ordinary cache misses are answered by `muse-spark-1.3`, so nothing waits for the scale-to-zero GPU (the popover badge names the model that answered) | entity id → `HoverDiagnosticPopover` JSON (strict schema, GBNF) | 22.8 s to generate once; 2 ms from the persisted cache, served only while the entity's context digest is unchanged (cleared on approve and rollback) | Hover is the hottest path and the most repetitive. An open-weight model on our own GPU answers every pill ahead of time at no per-call cost | [`tier1-hover.ts:275`](apps/orchestrator/src/tiers/tier1-hover.ts#L275) · warm-up [`:474`](apps/orchestrator/src/tiers/tier1-hover.ts#L474) |
| **1 · Goal Clarifier** | `muse-wonder-1.0` | ticket → clarifying questions → `SteeringParams` v0 | 9.7 s · 2,452 tok | Needs judgment over vague prose; its answers become the typed contract every later stage reads | [`subagent-orchestrator.ts:160`](apps/orchestrator/src/local/subagent-orchestrator.ts#L160) |
| **2 · Telemetry Scout** | none (MCP probe) | ticket + time → `UpstreamCloudStatusCorrelation` | 852 ms | Facts come from tools, not from a model | [`subagent-orchestrator.ts:805`](apps/orchestrator/src/local/subagent-orchestrator.ts#L805) |
| **3 · UI Architect** | gatekeeper `muse-spark-1.3` → synthesizer `muse-wonder-1.0` | ticket → `ElementRoutingDecision` → `SynthesizedDynamicCard` | 19.8 s · 2,875 tok | Spark is fast at classifying "which element is missing". Wonder writes the dense, domain-accurate card | [`dynamic-catalog.ts:197`](apps/orchestrator/src/local/dynamic-catalog.ts#L197) · [`:314`](apps/orchestrator/src/local/dynamic-catalog.ts#L314) |
| **4 · IaC & PS7 Coder** | `muse-wonder-1.0` (custom tickets); `muse-code` → `muse-wonder-1.0` in Tier 3B | ticket + typed steering → PS7 script, Terraform diff, rollback | 16.9 s · 4,657 tok (a steer turn) | The longest structured output; it re-parameterises an existing script rather than rewriting it | [`subagent-orchestrator.ts:444`](apps/orchestrator/src/local/subagent-orchestrator.ts#L444) · [`tier3-remediate.ts:255`](apps/orchestrator/src/tiers/tier3-remediate.ts#L255) |
| **5 · Safety Verifier** | none | script → repaired script + warnings | ≈1 ms | Deterministic: braces, `ShouldProcess` guard, wildcards | [`subagent-orchestrator.ts:586`](apps/orchestrator/src/local/subagent-orchestrator.ts#L586) |
| **Sandbox pre-flight** | none (Modal warm container, falls back to local pwsh; with neither, the verdict is "Verification Failed") | bundle → verdict + findings | warm pre-flight ~0.7 s | Verifies what the coder wrote before an operator sees it | [`preflight/modal.ts:69`](apps/orchestrator/src/preflight/modal.ts#L69) · [`preflight/local.ts:345`](apps/orchestrator/src/preflight/local.ts#L345) |
| **Correlate (Tier 1B/2)** | `muse-spark-1.3` | 3 MCP sources → forced `hydrate_contextpane_layout` | avg 4.0 s (1B) / 5.8 s (2) | Layout selection over a fixed catalog: a classification task | [`tier2-correlate.ts:121`](apps/orchestrator/src/tiers/tier2-correlate.ts#L121) |
| **Selection lens** | `muse-wonder-1.0` → `muse-spark-1.3` | highlighted text → mini-dashboard spec | 4.4–4.8 s | Composes a new 4-mode lens from free text | [`explore.ts:117`](apps/orchestrator/src/tiers/explore.ts#L117) |
| **Voice steer** | `muse-voice-transcribe-1.0`, intent via `muse-spark-1.3` | 16-bit mono WAV → transcript → layout intent | n/a | Hands-free steering; ASR is `POST /asr/transcribe` | [`router/openai.ts:273`](apps/orchestrator/src/router/openai.ts#L273) · [`tiers/voice.ts:54`](apps/orchestrator/src/tiers/voice.ts#L54) |

Measured values come from the `CUSTOM-K8ECJ6` run and the router ledger captured on 2026-10-29 (see the [telemetry board](docs/assets/03-kinematic-prewarm-telemetry.png)).

#### Model stand-ins

At start-up [`router/meta-models.ts:11`](apps/orchestrator/src/router/meta-models.ts#L11) checks `GET /v1/models`. Any configured id the Meta Model API does not serve is swapped for its stand-in: `muse-glimmer-30b → muse-spark-1.3` on the Meta API, and `muse-code → muse-wonder-1.0`. The startup log and `GET /api/config` (`metaModelResolution`) report each swap. Glimmer therefore only ever runs as our Modal open-weight deployment, and every "Muse Code" label in the UI is served by `muse-wonder-1.0`.

---

## 5. Five systems deep dives

### 5.1 `ptr://` data plane and the PII pseudonym vault

<p align="center"><img src="docs/assets/arch-pii-pointer-vault.svg" alt="MCP rows stay in the orchestrator data plane; layouts carry fenced ptr:// pointers; prompts pass the session PII vault; replies are rehydrated in the orchestrator; the browser resolves pointers with a fence check" width="100%"></p>

**Pointers.** Correlated rows never travel inside a model prompt or a layout. Cards reference them by pointer ([`packages/catalog/src/dataplane.ts`](packages/catalog/src/dataplane.ts)):

| Version | Shape | Purpose |
|---|---|---|
| v1 | `ptr://inc-4092/entra/users` | dataset address (plane + dataset) |
| v2 | `…/entra/users?where=state:Drifted&select=upn` | relational filter. Equality only; anything else fails closed ([`parsePtrQuery`, :392](packages/catalog/src/dataplane.ts#L392)) |
| v3 | `…#tenant-contoso-01:<epoch>:<generation>` | fence ([`fencedDataPtr`, :264](packages/catalog/src/dataplane.ts#L264)). [`verifyPointerFence` (:285)](packages/catalog/src/dataplane.ts#L285) returns `valid · stale-epoch · cross-tenant · aba-generation-mismatch · unregistered-or-invalid`, and `GET /api/dataplane` answers 409 on any failure |

**Vault.** Every prompt to every provider goes through one function, [`chatWithForcedTool` (router/openai.ts)](apps/orchestrator/src/router/openai.ts). It first runs [`vaultMessages`](apps/orchestrator/src/router/openai.ts), which replaces e-mail addresses / UPNs, the display names of people it knows from tenant context, known user object ids, known device names, phone numbers and public IPv4 addresses in prompt text with session tokens (`upn_tok_03`, `displayName_tok_01`, …) from the [`PiiVault`](packages/catalog/src/dataplane.ts). Free text does not catch IPv6, unknown GUIDs or names the vault has not seen. Image parts are refused: the vision tier sends a ticket screenshot only with `CTX_VISION_SEND_IMAGES=true`, because a screenshot bypasses the text vault. `recordPrompt` re-runs the same detectors over each outgoing prompt and counts their **detector hits**. That is a self-check (it can only find what those detectors already know how to find), not an independent PII audit, and the API reports it as `metricKind: "self-check"`. In the capture: **19 fields vaulted, 0 detector hits in 76 prompts**. Model replies are rehydrated **in the orchestrator**, so the browser shows real names and the provider never sees them. A reply can only turn back into real values the tokens the vault itself placed into this prompt, or into earlier prompts of the same tenant and ticket. A token that merely appears as text widens nothing, and any other token stays a token and is counted as a refused rehydration in the drawer. `GET /api/dataplane/:id` returns six sample pairs; the full token map only with `?includeMappings=true`.

**Untrusted text.** Ticket titles and bodies, ERP descriptions and highlighted selections reach a model only inside `<untrusted_customer_data>` delimiters, with any vault-token literal (`upn_tok_07`, …) in them replaced by a marker so customer text cannot ask for someone else's identity ([`router/untrusted.ts`](apps/orchestrator/src/router/untrusted.ts)), and every system prompt that receives them says to treat that text as evidence and never follow instructions in it. Tenant context passed to the coder and the card synthesizer (`tenantFacts`) is declared data in the same way, since tenant users can write names and descriptions. The eval set (§1) includes prompt-injection tickets.

**The 3-step MCP vault boundary** ([full trace on INC-4092](docs/traces/mcp-vault-boundary.md)):

| Step | Where | What crosses |
|---|---|---|
| 1 · Gather | [`gatherContext`](apps/orchestrator/src/mcp/context.ts#L119) → msgraph · azure-iac · erp | The orchestrator calls MCP itself, with real UPNs and GUIDs; no model picks the calls. Rows are published under fenced `ptr://` pointers |
| 2 · Outbound | [`contextForCorrelation`](apps/orchestrator/src/mcp/context.ts#L496) + [`vaultMessages`](apps/orchestrator/src/router/openai.ts#L135) | Descriptors without rows; identities as `upn_tok_NN`. In the trace (run with `CTX_FORCE_LOCAL=true`, so no provider was called): "Ticket from upn_tok_01", 8,155 characters, 0 detector hits |
| 3 · Inbound | [`depseudonymizeJsonText`](apps/orchestrator/src/router/openai.ts#L245) + [`resolveDataPtr`](apps/orchestrator/src/local/dataplane.ts#L322) | Tool args `{"targetEntityId":"upn_tok_01","dataPtr":"ptr://inc-4092/entra/users"}` become the real UPN in memory; the pointer resolves only through the fence (a cross-tenant check fails); rows sent back to a model are pseudonymised again ([explore.ts:174](apps/orchestrator/src/tiers/explore.ts#L174)) |

Models never issue MCP tool calls, and no service principal is involved in these reads. The one Activity Log hop is the orchestrator's own, for the ABAC tickets in real-tenant mode: [`readAbacLabLive`](packages/mcp-azure-iac/src/abac.ts#L284) reads the storage account, its containers, the payroll identity, the policy assignment, the identity's role assignments and the last 24 h of failed `roleAssignments/write` events with `RequestDisallowedByPolicy` ([`readActivityLog`, :241](packages/mcp-azure-iac/src/abac.ts#L241), 2.5 s budget). It uses the engineer's Az token, and its [`arm`](packages/mcp-azure-iac/src/abac.ts#L70) helper refuses any path outside the lab subscription. Activity Log ingestion lags by up to 15 minutes, so the denial the ticket reports is added as a deterministic entry stamped at the ticket's time ([`abacActivity`](apps/orchestrator/src/local/abac.ts#L161)). The policy rows of the built-in scenarios are fixtures (§6).

<p align="center"><img src="docs/assets/02-glimmer-hover-and-pii-vault.png" alt="Glimmer hover popover with model badge, pseudonym vault token map and the PII detector-hit count" width="100%"></p>

### 5.2 Hover-intent speculative pre-fetch

<p align="center"><img src="docs/assets/arch-kinematic-prewarm.svg" alt="Timeline: click-then-fetch versus hover-intent pre-fetch with a 60 ms dwell and a 4-slot epoch-fenced buffer" width="100%"></p>

The store calls this the "kinematic speculative pre-warm". The mechanism is hover intent, not cursor physics: there is no velocity or deceleration model.

- **Trigger.** `mouseenter` on an entity pill ([`EntityPill.tsx:134`](apps/web/src/components/ticket/EntityPill.tsx#L134)), a work-queue row or a plan/fleet pill arms a 60 ms timer.
- **Speculative request.** If the pointer is still there when the timer fires, the request goes out into a **4-slot speculative buffer** whose slot kinds are `queue-brief`, `entity-hover` and `remediation`. Each slot is tagged with [`speculativeEpoch`](apps/web/src/store.ts#L409).
- **Click.** The click awaits the in-flight slot or promotes a resolved one instead of asking again.
- **Invalidation.** Any scope or tenant change bumps the epoch and drops every slot.
- **Selection pre-warm.** Selecting a literal UPN/GUID pre-warms the selection lens on `selectionchange`, before Enter.

The System & audit drawer reports hits, misses and milliseconds saved; one selection hit in the capture saved **4,384 ms**. Next to those counters is the per-tier routing ledger:

<p align="center"><img src="docs/assets/03-kinematic-prewarm-telemetry.png" alt="Router savings per tier, 5-stage pipeline records with model, tokens and latency, and the speculative pre-fetch counters" width="100%"></p>

### 5.3 Self-expanding N+k generative UI

The catalog starts with hand-built cards (N). It grows by k whenever a ticket needs a view that does not exist:

1. **Gatekeeper.** `muse-spark-1.3` ([`assessTicketElementNeeds`, dynamic-catalog.ts:197](apps/orchestrator/src/local/dynamic-catalog.ts#L197)) names the missing element (`FinanceBlobAbacConditionFix`), its domain, the extracted entities and the reason.
2. **Synthesizer.** `muse-wonder-1.0` ([`:314`](apps/orchestrator/src/local/dynamic-catalog.ts#L314)) writes no code. It emits a **JSON view specification** composed of **five layout primitives**: `quota-gauges` · `policy-chain` · `data-table` · `config-diff` · `event-stream`.
3. **Gate.** The spec must parse as [`SynthesizedDynamicCardSchema`](packages/catalog/src/schemas/components.ts#L574) (Zod). A failing reply never reaches the catalog; the operator sees a labelled template card instead.
4. **Mount.** The web app's local interpreter, [`SynthesizedDynamicCard`](apps/web/src/components/cards/SynthesizedDynamicCard.tsx#L343), maps each block to a React primitive ([`renderBlock`, :148](apps/web/src/components/cards/SynthesizedDynamicCard.tsx#L148)). It runs no model-written code. The spec is stored with the triaged ticket (`synthesizedElements` in `data/custom-scenarios.json`). Drawing the card from a stored spec is client-side rendering and makes no model call.
5. **Persistence.** A passing spec is also exported as `data/synthesized-elements/<ElementId>.tsx`: the JSON spec wrapped in a typed TS export so it can be reviewed as source. The web app never imports these files; it renders the JSON through `SynthesizedDynamicCard`. The spec is also added to [`data/dynamic-catalog.json`](data/dynamic-catalog.json). The System & audit drawer lists the registry.

The synthesizer gets the ticket's tenant context (`tenantFacts`) and must name only resources in it or in the ticket. The orchestrator, not the model, then sets each block's provenance ([`local/grounding.ts`](apps/orchestrator/src/local/grounding.ts)): data-table rows that match tenant data link to their `ptr://` dataset, and the card labels every other value, gauges included, as a model estimate. Only rows backed by tenant data are steerable: clicking one narrows the fix to that resource (§5.4); `PATCH /steer` answers 422 for a click on a model-written row.

<p align="center"><img src="docs/assets/04-nk-wonder-synthesis-and-reuse.png" alt="The net-new FinanceBlobAbacConditionFix card next to the k=5 synthesized element registry" width="100%"></p>

<p align="center"><img src="docs/assets/nk-ui-synthesis-loop.webp" alt="Loop: an unscripted ABAC ticket is triaged and Muse Wonder composes a card that did not exist" width="85%"></p>

> **Scope note.** `reuseCount` goes up when the gatekeeper names an element that already exists and Wonder re-synthesizes it ([`upsertCatalogEntry`, :287](apps/orchestrator/src/local/dynamic-catalog.ts#L287)). One path serves a stored card before any model call: an ABAC ticket whose view (`ManagementGroupAbacInheritanceCard`) is already in the catalog skips the gatekeeper and Wonder ([`catalogHit`, subagent-orchestrator.ts:890](apps/orchestrator/src/local/subagent-orchestrator.ts#L890)). Stage 3 returns the stored spec, with its activity rows rebound to the new ticket ([`reuseFromCatalog`, dynamic-catalog.ts:344](apps/orchestrator/src/local/dynamic-catalog.ts#L344)), and the pipeline record reads `dynamic-catalog (N+1 hit)`, 0 ms, 0 tokens. In the demo capture the card was on screen about 0.15 s after the click, and its live ARM values filled in about 1.7 s later. Every other custom ticket still gets a fresh element from the gatekeeper.

### 5.4 Two-way steering and the write-then-test loop

<p align="center"><img src="docs/assets/05-coderail-modal-sandbox-finverse.png" alt="Scope chips in zone 1; the Muse Code rail with the steering diff v0 → v1, prover strip, 1-click undo script and approve footer" width="100%"></p>

**Steering contract.** [`SteeringParams`](packages/catalog/src/steering.ts#L37) is a typed object with fields `remediationStrategy`, `scope`, `governance`, `targetResource`, `targetIds`, `region`, `dryRun` and `answers`. Each value records its source (`clarifier · row-click · operator`). The object carries a version and an FNV-1a digest. A scope chip, a typed answer or a lens-row click sends a delta to `PATCH /api/tickets/:id/steer` ([app.ts:549](apps/orchestrator/src/app.ts#L549)):

1. [`applySteeringDelta`](apps/orchestrator/src/local/steering.ts#L165) bumps the version when the digest changes.
2. [`steerCustomTicket`](apps/orchestrator/src/local/custom-ticket.ts#L706) asks the coder to **re-parameterise** the staged script: keep its structure and change only the lines the steering requires.
3. The rail shows the diff ("What changed · steering v0 → v1").
4. [`restageRemediationForSteering`](apps/orchestrator/src/tiers/tier3-remediate.ts#L1188) re-runs the pre-flight.
5. A staged script older than the current steering shows a stale banner with a one-click Regenerate.

<p align="center"><img src="docs/assets/coderail-steering-loop.webp" alt="Loop: a scope chip flips, the rail shimmers while the coder re-parameterises, then the steering diff lands" width="85%"></p>

**Write-then-test.** Every bundle runs a pre-flight before the rail offers approval:

| Check | Modal warm container ([`contextpane_sandbox.py:436`](modal-sandbox/contextpane_sandbox.py#L436)) | Local fallback ([`preflight/local.ts`](apps/orchestrator/src/preflight/local.ts)) |
|---|---|---|
| PowerShell 7 AST parse + one shared rule set ([`preflight-rules.json`](packages/catalog/src/preflight-rules.json)). It is a **command** allow-list: read-only verbs (`Get`, `Select`, `Where`, …) pass for any noun, every other cmdlet must be named in `allowedCommands` or in the bundle's steered contract, and privileged ones (role grants, app credentials, VM run commands, …) only through that contract. Commands without a hyphen (native binaries such as `pwsh`, `az`, `bash`) fail, as do forbidden commands and patterns (`PasswordProfile`, disabling a policy), destructive wildcards and a missing steered command. **If the AST check cannot run (no pwsh 7, sandbox timeout), the verdict is Verification Failed**; only Override with a justification gets past it | ✓ (persistent pwsh AST server) | ✓ `Parser::ParseFile` |
| `terraform fmt -check` · `terraform validate` (1.9.8, azurerm ~> 4.0) | ✓ | ✓ when the ticket has an HCL baseline |
| Mutating cmdlets inside `$PSCmdlet.ShouldProcess` | static check after either ([`applyWhatIfGate`](apps/orchestrator/src/preflight/local.ts)): an unguarded mutation fails the bundle; a read-only script without the guard only warns | same |
| Execution surface ([`preflight/execution-surface.ts`](apps/orchestrator/src/preflight/execution-surface.ts)): .NET and COM calls, runtime script blocks, dot-sourcing, aliases, commands that run code or sign in again (`Invoke-Command`, `Add-Type`, `Set-AzContext`, `Connect-MgGraph`, …; listed in the same rule file), and `Invoke-MgGraphRequest` / `Invoke-AzRestMethod` targets outside an allow-list of paths and methods all fail the bundle | applied to the sandbox's AST report by the orchestrator, including `$ExecutionContext` / `InvokeScript` / `NewScriptBlock` access, and every raw REST call is a write unless `-Method GET` is literal | same; without pwsh the bundle fails, and a case-insensitive text scan still lists what it can see |
| Literal targets that are in neither the tenant context nor the ticket | `Ungrounded target:` finding after either ([`local/grounding.ts`](apps/orchestrator/src/local/grounding.ts)); it warns rather than fails, since a fix may create a new resource. Identity, role and credential parameters (`-UserId`, `-PrincipalId`, `-RoleDefinitionId`, …) must name something in the tenant context: a name only the ticket mentions is an `Ungrounded identity:` finding and fails the bundle | same |
| `#Requires -Version 7.0` header (the executor runs pwsh 7 only) | static check after either ([tier3-remediate.ts:550](apps/orchestrator/src/tiers/tier3-remediate.ts#L550)) | same |

**The sandbox is offline and holds no tenant credentials.** Its only secret is the bearer token the orchestrator presents. It holds no Azure, Graph or Terraform state credentials. The Terraform working directory is set up at image build with `terraform init -backend=false`, and each bundle gets `fmt -check` and `validate`. It is Terraform 1.9.8, not OpenTofu, and nothing runs `plan` or `-WhatIf`.

**Live runs happen after Approve, through a typed action where one fits.** Every live write (typed actions, the built-in scenarios' lab writes, Reset drift, ABAC grant and reset, rollback) passes one gate: `LIVE_CLOUD_MODE=true` **and** `CTX_ALLOW_EXECUTE=true`, and the token's tenant id must be the lab tenant. Without both flags the write is simulated and labelled as such. Typed lab writes run on the orchestrator host with the engineer's token. A custom bundle can carry a **typed action** from the catalog ([`packages/catalog/src/typed-actions.ts`](packages/catalog/src/typed-actions.ts)): an ABAC container-conditioned grant, a licence-state change or an NSG reconcile to the Terraform baseline. ABAC tickets take it from the clarifier answers. Other custom tickets ask `muse-wonder-1.0` to pick one through a forced tool, offering only the entity ids the gathered context holds ([`execution/select-action.ts`](apps/orchestrator/src/execution/select-action.ts)). The parameters must pass the action's Zod schema and its context validator. With `CTX_ALLOW_EXECUTE=true`, approve then runs that action's typed Graph / ARM call and Revert runs its typed inverse ([`execution/typed-actions.ts`](apps/orchestrator/src/execution/typed-actions.ts)). The model-written script stays in the rail for review and is not executed. A bundle with no typed action runs its approved script only with `CTX_ALLOW_EXECUTE=true`, and only as a dedicated **executor identity**: a certificate-based service principal or the host's managed identity (`CTX_EXECUTOR_*` in [`.env.example`](.env.example), [`execution/executor-identity.ts`](apps/orchestrator/src/execution/executor-identity.ts)). The script connects as that identity for its own process and stops unless the Az and Graph contexts are that identity on the lab subscription. With no executor identity configured, execution is refused; `CTX_EXECUTOR_ALLOW_DELEGATED=true` restores the old behaviour of running as the engineer's own sign-in. A built-in scenario's script also needs `CTX_ALLOW_EXECUTE_BUILTIN_SCRIPTS=true`, because its typed lab write is already the executor. Approve does not run `-WhatIf` first. The `-WhatIf` dry run is the first command in the staged `REMEDIATION.md`, for the engineer to run in their own session. Approve also re-checks on the server what the rail shows: a failed invariant or a failed Free-Roam verdict is refused (409) unless overridden; a live break-glass write takes a fresh pre-change snapshot and is refused if it cannot; a second click on an approval still running is refused; and after `CTX_APPROVE_TIMEOUT_MS` (200 s) the answer is 504 with outcome *unknown* and an audit entry, so check the tenant. A fix is reported **executed** only when every one of its live writes landed; one failed Graph or ARM write leaves it failed, with the real status.

**Two approval modes, optional pull request.** *Break-glass* writes to the lab tenant (under the gates above), then commits the reconciled state to the staged branch so Git does not drift behind the tenant. *Pure GitOps* writes nothing live: the sandbox re-checks the bundle against the state of that moment. In either mode, a built-in scenario's approval can also push the ticket's `fix/<ticket>-<tenant>-remediation` branch and open a pull request (`CTX_GH_PR_ON_APPROVE=true` or the drawer's checkbox, with an authenticated `gh`). [PR #1](https://github.com/dudhasch/contextpane/pull/1) is a real one, opened by the app for `INC-4092` on 2026-10-26 (PowerShell, Graph requests, NSG patch and `REMEDIATION.md`); it is kept as a sample and not meant to be merged.

[`runRepairLoop`](apps/orchestrator/src/tiers/repair-loop.ts#L133) feeds the repairable findings back to the coder, for at most [`MAX_REPAIR_ITERATIONS = 2`](apps/orchestrator/src/tiers/repair-loop.ts#L35) turns. Infrastructure findings (sandbox unavailable, Terraform missing, …) are not sent back. The loop stops early if the coder returns an unchanged script, and it never forces a verdict. The verdict badge then reads "· N iter" and the proof panel lists every round. The run in the screenshot passed on the first attempt, so no repair timeline is drawn; the loop is covered by [`repair-loop.test.ts`](apps/orchestrator/src/tiers/repair-loop.test.ts).

**Invariant checks and f⁻¹.**
- [`formal-verifier.ts`](apps/orchestrator/src/local/formal-verifier.ts) checks seven invariants as a PCC bitmask ([`0x7f`, :87](apps/orchestrator/src/local/formal-verifier.ts#L87)): `break-glass-non-lockout`, `target-remediation`, `nsg-reachability`, `shadow-admin-zero-transitive`, `proactive-remediation-detect-read-only`, `idempotency-fork-isolated` and `bijective-inverse-rollback`. It also checks idempotency, f(f(S)) = f(S), on a forked state ([`:757`](apps/orchestrator/src/local/formal-verifier.ts#L757)). An ad-hoc ticket has no symbolic model, so the strip says "not provable" rather than claiming a proof. The 30-day blast radius next to it is also modelled: its cohorts and their before/after states come from the scenario's model, not from the tenant, and the rail labels it that way.
- **Snapshot.** On a break-glass approve, [`captureEntitySnapshot`](apps/orchestrator/src/local/snapshot.ts#L107) records the touched users, groups, CA policies, NSG rules, Intune objects and workload identities.
- **Inverse.** [`buildInverseFromSnapshot`](apps/orchestrator/src/local/inverse-rollback.ts#L205) derives the inverse for only the sections the bundle changed.
- **Rollback.** [`rollbackRemediation`](apps/orchestrator/src/tiers/tier3-rollback.ts#L101) executes the inverse through the lab write path, reads the state back and compares it with the snapshot. "Restored" comes only from that read-back. Out-of-band changes are not checked *before* restoring: there is no ETag or hash precondition. An out-of-band edit to a snapshotted entity is written back to its pre-change value without a warning.

### 5.5 Zero-context correlation and universal selection lenses

**Correlation from a ticket alone.** A pasted ticket names a user and an error and nothing else, yet the orchestrator assembles the same context a senior engineer would:
- **Gather.** It probes three MCP servers in parallel:
  - **Graph** (`mcp-msgraph`): users, group licensing, Conditional Access, Intune.
  - **Azure** (`mcp-azure-iac`): NSG drift against the Terraform baseline, AVD estate, policy, regional quota.
  - **PSA** (`mcp-erp`): ticket, contract, billed seats.
- **Lay out.** It asks `muse-spark-1.3` for a layout over the fixed catalog, or builds a new card per §5.3.
- **Ground.** Entity pills in the ticket body become provenance-coloured hover targets.

**Selection lenses.** Highlighting 3–120 characters anywhere opens the selection trigger. Enter sends `POST /api/explore-selection` ([app.ts:376](apps/orchestrator/src/app.ts#L376)), and `muse-wonder-1.0` composes a lens with four modes: **Triage lens · Inspector · State diff · Blast radius**. The lens rows live under `ptr://<scenario>/selection/<hash>`, and the phrase stays marked in the ticket as `Selection #n`.

---

## 6. What is live, what is simulated

ContextPane labels its sources in the UI. The same rule applies here:

| Area | Live | Simulated or fixture |
|---|---|---|
| Graph (users, licensing extension, CA, Intune) | Live reads against the seeded lab tenant `c4a8shili.onmicrosoft.com` with `LIVE_CLOUD_MODE=true` (Az token cache → Graph `$batch`); approved writes also need `CTX_ALLOW_EXECUTE=true`, check the token's tenant id, and match Intune objects by exact name, changing only the named group's assignment. A strict real-tenant read that fails says `unavailable` instead of filling in placeholders | Fabrikam Legal is manifest-only; the 15/15 CountViolation pool and devices are labelled fixtures |
| Azure ARM | NSG read/write + Terraform drift diff; regional quota (`westeurope` usages) in strict real-tenant mode. For the ABAC tickets: a live read of the storage account, policy assignment, role assignments and Activity Log, and on Approve one role-assignment PUT with a container condition (Revert deletes it), lab subscription only. NSG and ABAC writes sit behind the same `CTX_ALLOW_EXECUTE` gate | Policy compliance rows of the built-in scenarios (including their `RequestDisallowedByPolicy` detail) are fixture rows. The denial an ABAC ticket reports is a deterministic entry next to the live Activity Log rows; in `simulated-lab` mode the whole ABAC read is a labelled fixture |
| PSA / CSP | File-drop ERP inbox (`input/tickets/`), SLA clock | `mcp-erp` data, contracts and the "Billed (Pax8)" seat column are fixtures; there is no Pax8 integration |
| Models | Meta Model API calls and the Modal Glimmer deployment, with telemetry for every call | With no key every tier falls back to a labelled deterministic engine (`CTX_FORCE_LOCAL=true` forces it) |
| Verification | Credential-free Modal / local pwsh AST, `terraform fmt`/`validate` (`init -backend=false`); after Approve, typed Graph / ARM writes with the engineer's token, and scripts only as the `CTX_EXECUTOR_*` identity | `-WhatIf` is a static ShouldProcess check in the sandbox and is never run by Approve; rollback has no ETag/hash precondition; canary probes and the blast radius evaluate the symbolic model. The audit ledger (`data/audit-log.jsonl`) is append-only and hash-chained (`GET /api/audit` reports whether the chain verifies); its identity is the host's sign-in or the lab default, not a per-person login |
| Screenshots in this README | Real stack, real Meta and Modal calls | Data mode was `simulated-lab` (seeded fixtures plus live model calls); nothing was approved against the tenant during capture |

---

## 7. Monorepo map

```text
contextpane/
├── apps/
│   ├── orchestrator/        Bun + Hono API: router, tiers, sub-agents, steering, prover    → apps/orchestrator/README.md
│   └── web/                 React 19 + Zustand three-zone flight deck                     → apps/web/README.md
├── packages/
│   ├── catalog/             Zod contracts, ptr:// data plane, PII vault, steering schema  → packages/catalog/README.md
│   ├── mcp-msgraph/         Entra ID + Intune MCP server (live / lab)                     → packages/mcp-msgraph/README.md
│   ├── mcp-azure-iac/       Azure ARM + Terraform-baseline MCP server                     → packages/mcp-azure-iac/README.md
│   └── mcp-erp/             PSA tickets, contracts, billed seats MCP server               → packages/mcp-erp/README.md
├── modal-sandbox/           Modal apps: Glimmer 30B on L40S, pwsh + Terraform pre-flight  → modal-sandbox/README.md
├── data/                    N+k registry, synthesized .tsx cards, hover seed, skills      → data/README.md
├── golden-tenant/           declarative CA / Intune / app baselines cited by drift cards  → golden-tenant/README.md
├── demo-iac/                Terraform baseline (main.tf) + offline lab manifest
├── input/tickets/           ERP file-drop inbox (one seeded example)
├── scripts/                 PowerShell 7 lab seeding, config, smoke test, captures        → scripts/README.md
├── docs/                    visual assets, boundary traces, documentation index           → docs/README.md
├── DESIGN.md                Graphite & Signal design system
└── HACKATHON_ATTRIBUTION.md models, endpoints, provenance
```

- [apps/orchestrator](apps/orchestrator/README.md)
- [apps/web](apps/web/README.md)
- [packages/catalog](packages/catalog/README.md)
- [packages/mcp-msgraph](packages/mcp-msgraph/README.md)
- [packages/mcp-azure-iac](packages/mcp-azure-iac/README.md)
- [packages/mcp-erp](packages/mcp-erp/README.md)
- [modal-sandbox](modal-sandbox/README.md)
- [data](data/README.md)
- [golden-tenant](golden-tenant/README.md)
- [scripts](scripts/README.md)
- [docs](docs/README.md)

---

<sub>MIT © 2026 Timur Dudhasch. Screenshots and loops were captured from the running stack at 1440×900 in dark mode on 2026-10-29 and annotated with VectorCraft; the loops were encoded from CDP frame captures. Muse, Glimmer, Spark and Wonder are Meta model names used as served by the Meta Model API and the published open weights.</sub>
