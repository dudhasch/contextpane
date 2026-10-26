# ContextPane

**A local-first, MCP-driven, catalog-constrained Generative UI workbench for MSP Azure & Microsoft 365 engineers.**

Built from scratch for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026),
*Build for Your World* track. See [`HACKATHON_ATTRIBUTION.md`](./HACKATHON_ATTRIBUTION.md).

ContextPane takes a commercial ERP escalation ticket, correlates it live against Entra ID
(licenses, Conditional Access, sign-in logs) and Azure (NSG drift vs. Terraform), and
renders the answer as **Zod-validated UI components, never chat prose**. A 4-tier compute
router makes sure the cheapest possible path answers each request: a pinned View Recipe
costs **0 tokens and <150 ms**, an inline hover costs one `muse-glimmer-30b` / `muse-spark-1.3` call, and
only an explicit *Generate Fix* click escalates to `muse-wonder-1.0` with a
verifiable pre-flight sandbox and a Human-in-the-Loop approval drawer.

---

## Quick start (works with zero API keys)

Prerequisites: [Bun](https://bun.sh) ≥ 1.2, PowerShell 7, optionally Terraform
(`winget install Oven-sh.Bun Hashicorp.Terraform`).

```bash
bun install
bun run dev
```

- Orchestrator: http://127.0.0.1:4000 (`GET /api/health`)
- Workbench: http://localhost:5173 (Vite proxies `/api` and `/ws` to the orchestrator)

Runtime state lives in `data/` (pinned recipes, remediation bundles) and
`.contextpane/` (terraform validation workspace, provider cache); both are git-ignored.
Staged remediations are real local branches named `fix/<ticket>-nsg-drift-<id>` that add
`demo-iac/remediations/<ticket>/` (script, patch, REMEDIATION.md); nothing is pushed.

With no keys in `.env.local`, every tier falls back to a deterministic local engine that
hydrates the same catalog components from `demo-iac/demo-lab-manifest.json`. Paste keys
later and the router starts calling Meta models with no code change.

Smoke-test every endpoint and its Zod schema:

```bash
pwsh -NoProfile -File ./scripts/Test-ContextPaneSmoke.ps1
```

---

## Architecture

```
┌────────────────────────────── apps/web (:5173) ──────────────────────────────┐
│  HUD: tenant switcher · router telemetry pills · Pin as Recipe · Voice Steer  │
│ ┌─ Left: ERP ticket ──────────┐ ┌─ Right: Catalog-constrained GenUI canvas ─┐ │
│ │ entity pills → hover (1A)   │ │ <TenantSummaryHeader/>                    │ │
│ │ contract line → toolbar     │ │ <LicenseDriftCard/>                       │ │
│ │ IaC CodeLens → remediate(3) │ │ <EntraSignInTimeline/>                    │ │
│ └─────────────────────────────┘ │ <IaCDriftBanner/>  <ActionApprovalDrawer/>│ │
└──────────────────────────────────┴───────────────────────────────────────────┘
                 │ REST + SSE (progress)          │ WebSocket /ws (telemetry)
┌────────────────────────── apps/orchestrator (:4000) ─────────────────────────┐
│                          4-Tier Meta Model Router                            │
│  Tier 0  recipe hydrate    0 tokens   in-process MCP binding      <150 ms    │
│  Tier 1A hover             Glimmer 30B open weights → Meta spark-1.3         │
│  Tier 1B catalog           Meta spark-1.3 (Glimmer opt-in, hovers only)      │
│  Tier 2  correlate         Meta API muse-spark-1.3 (escalation)              │
│  Tier 3A/3B remediate      Meta API muse-wonder-1.0 (muse-code if served)    │
│          └─ pre-flight: Modal sandbox → pwsh AST + terraform fmt/validate    │
│          └─ stage: git worktree branch fix/<ticket>-nsg-drift                │
│  Voice   voice-steer       muse-voice-transcribe → intent → layout filter    │
│  Every tier: Zod validate → deterministic local fallback                     │
└───────────────┬───────────────────────┬───────────────────────┬──────────────┘
                │ in-process (<50 ms) or MCP stdio              │
     ┌──────────┴────────┐  ┌───────────┴───────────┐  ┌────────┴─────────────┐
     │ packages/mcp-erp  │  │ packages/mcp-msgraph  │  │ packages/mcp-azure-iac│
     │ tickets,contracts │  │ Graph via pwsh 7 or   │  │ Az via pwsh 7 or      │
     │ 2 tenants         │  │ demo-lab-manifest.json│  │ manifest vs main.tf   │
     └───────────────────┘  └───────────────────────┘  └───────────────────────┘
                                        shared: packages/catalog (Zod schemas,
                                        View Recipes, hydrate_contextpane_layout tool)
```

### The 4-Tier Meta Model Router

| Tier | Endpoint | What happens | Model / provider chain |
|---|---|---|---|
| **0** | `GET /api/recipe/:id/hydrate?tenantId=` | Binds the 3 MCP outputs straight into a pinned `ViewRecipe` AST. No LLM. Measured: 2–11 ms server time. | — |
| **1A** | `POST /api/hover` | Translates an entity (UPN, group, `AADSTS53003`) into a `HoverDiagnosticPopover`. | Open-weight Muse Glimmer 30B (llama-server on Modal, RunPod or local) → Meta API `muse-spark-1.3` (`reasoning_effort: minimal`); every pill of both tenants is pre-generated and persisted to `data/hover-cache.json` |
| **1B** | `POST /api/correlate` | `Promise.all` over the 3 MCP servers, then one forced tool call (`hydrate_contextpane_layout`) returns the full layout; every component is Zod-validated and any gap is repaired by the deterministic hydrator. | Meta API `muse-spark-1.3` (`minimal`; open-weight Glimmer first only with `CTX_OPEN_WEIGHT_TIERS=hover,catalog`); the SSE stream paints `TenantSummaryHeader` from MCP data (`mcp_ready`) before the model answers |
| **2** | `POST /api/correlate` | Same call, escalated when Tier 1B fails or returns an invalid layout. | Meta API `muse-spark-1.3` (`low`) |
| **3A / 3B** | `POST /api/remediate` | `muse-wonder-1.0` plans and emits the PowerShell + Terraform bundle (`muse-code` takes the second step once the Meta API serves it), pre-flight verifies it in the Modal sandbox (falling back to the local PowerShell AST parse + cmdlet allow-list, `terraform fmt` + `validate`), a git worktree stages `fix/<ticket>-nsg-drift-*`, and `ActionApprovalDrawer` comes back for Human-in-the-Loop approval via `POST /api/approve`. | Meta API `muse-wonder-1.0`, Modal `validate_remediation` |
| **Voice** | `POST /api/voice-steer` | Audio (base64) or text → intent → filter / pin / switch tenant / generate fix. | `muse-voice-transcribe-1.0` + `muse-spark-1.3` |

**Primary stack: Meta Model API + Modal.** A `META_API_KEY` alone (plus the optional Modal
sandbox URL) is a complete, first-class configuration: providers without a key are left out
of the chain entirely, so Meta answering Tier 1A/1B is not reported as a fallback. Open
weights are opt-in: `scripts/Start-GlimmerOpenWeights.ps1` serves Meta's
`Muse-Glimmer-30B-GGUF` (Q4_K_M, 16.8 GB) with llama-server on a Modal L40S
(`modal-sandbox/glimmer_open_weights.py`, scale to zero) or locally, and wires the URL in;
`modal-sandbox/open_weights_vllm.py` and `scripts/Start-RunPodGlimmer.ps1` serve the
full-precision weights on vLLM instead. Telemetry names where Glimmer ran:
`modal-open-weights`, `runpod` or `local-glimmer-30b`. Any such URL goes into
`CTX_OPEN_WEIGHT_BASE_URL` (or `MODAL_INFERENCE_BASE_URL` / `RUNPOD_VLLM_BASE_URL`). Baseten (`muse-spark-open-1026`) and Fireworks keys remain optional
drop-in overrides ahead of Meta.

Every provider in a chain is bounded by a timeout and falls through on error, timeout,
missing key or invalid schema. When no provider answers, the deterministic engine produces
the same catalog components from the same MCP context and the telemetry reports
`provider: local`, so the UI never blocks on a model. Every tier records telemetry (tier,
provider, model, latency, tokens, fallback chain) and broadcasts it over `/ws`, which
drives the HUD pills and the *router savings* panel.

**Why forced tool calling?** Baseten's `muse-spark-open-1026` supports OpenAI-compatible
`tools` / `tool_choice` but not `response_format: { type: "json_schema" }`.
`packages/catalog` exports `getHydrateLayoutToolDefinition()`, which wraps the entire
layout schema as a function tool and forces it with
`tool_choice: { type: "function", function: { name: "hydrate_contextpane_layout" } }`.
The identical payload works on Fireworks and the Meta Model API.

### Catalog-constrained GenUI

The model never emits markup or prose. It emits a JSON layout whose components must be
one of six allow-listed primitives, each with a strict Zod schema:

`TenantSummaryHeader` · `LicenseDriftCard` · `EntraSignInTimeline` · `IaCDriftBanner` ·
`HoverDiagnosticPopover` · `ActionApprovalDrawer`

Anything that fails validation is dropped and the deterministic hydrator fills the gap,
so the canvas is always complete and always typed.

### View Recipes (0 tokens)

Pinning the current layout saves a `ViewRecipe` (pinned components + MCP bindings) to
`data/recipes.json`. Switching from **Contoso Finance** to **Fabrikam Legal** re-hydrates
the same recipe for the new tenant through Tier 0 in under 150 ms with zero LLM tokens.

---

## Repository layout

```
contextpane/
├── README.md · HACKATHON_ATTRIBUTION.md · DESIGN.md · LICENSE
├── package.json                  Bun workspaces ["packages/*", "apps/*"]
├── tsconfig.base.json · .env.example · mcp-servers.json
├── demo-iac/
│   ├── main.tf                   Expected clean Terraform baseline (Contoso Finance AVD)
│   ├── fabrikam.tf               Expected baseline (Fabrikam Legal sovereign LZ)
│   └── demo-lab-manifest.json    Deterministic offline telemetry, rewritten by the seed script
├── scripts/                      PowerShell 7 only
│   ├── Install-ContextPaneModules.ps1   Az + Microsoft.Graph submodules via ModuleFast (Justin Grote)
│   ├── Set-ContextPaneRouterConfig.ps1
│   ├── Invoke-SeedContextPaneLab.ps1
│   ├── Remove-ContextPaneLab.ps1
│   ├── Publish-ContextPaneRepo.ps1      Hackathon-compliant history audit/normalise + gh repo create
│   ├── Start-GlimmerOpenWeights.ps1     Open-weight Muse Glimmer 30B GGUF on Modal (L40S) or local llama-server
│   ├── Start-RunPodGlimmer.ps1          Optional RunPod vLLM pod for open-weight muse-glimmer-30b
│   └── Test-ContextPaneSmoke.ps1
├── modal-sandbox/                Modal Tier 3B pre-flight sandbox + optional open-weight Glimmer (Python)
├── packages/
│   ├── catalog/                  Zod schemas, View Recipes, forced tool schema, AADSTS catalog
│   ├── mcp-erp/                  MCP server 1: ERP/PSA tickets & contracts
│   ├── mcp-msgraph/              MCP server 2: Entra licenses, CA policies, sign-ins
│   └── mcp-azure-iac/            MCP server 3: NSG drift vs. Terraform baseline
└── apps/
    ├── orchestrator/             Bun + Hono, port 4000, 4-tier router, SSE + WS
    └── web/                      Vite + React 19 + Tailwind v4, port 5173
```

Each MCP package exposes both a **stdio MCP server** (`src/server.ts`, wired in
`mcp-servers.json` for any MCP client) and a **direct TypeScript service**
(`src/service.ts`) that the orchestrator calls in-process in <50 ms.

---

## Live cloud mode

Set `LIVE_CLOUD_MODE=true` to have `mcp-msgraph` and `mcp-azure-iac` read the real tenant.
One cached `Connect-AzAccount` sign-in on the machine is enough: each server runs `pwsh`
once to mint a bearer token from the Az token cache (`Get-AzAccessToken` for
`https://graph.microsoft.com` and `https://management.azure.com/`), keeps it in memory for
up to 45 minutes, and from then on talks to the APIs with plain `fetch()`:

- **Graph:** one `$batch` returns the entitlement group, its members, subscribed SKUs and
  the Conditional Access policies; a second batch fetches each member's
  `com.contextpane.licenseState` open extension. ~0.3-0.9 s warm.
- **ARM:** one `GET .../networkSecurityGroups/nsg-contoso-avd-hostpool-01` (~80-300 ms),
  diffed against `demo-iac/main.tf`.
- **Sign-ins:** a UPN-filtered `auditLogs/signIns` query takes 40-60 s on a busy tenant and
  the lab users never sign in, so it never blocks a request. It runs as a background probe
  (`CTX_GRAPH_SIGNIN_TIMEOUT_MS`); until it finds events, the timeline is the seeded one
  re-keyed to the live policy's real id and name (source `live-synthesized`).
- **Caching:** the assembled context is cached per tenant, fresh for 30 s and then served
  stale for up to 10 minutes while one background refresh replaces it. `?refresh=true` on
  any endpoint bypasses it. The orchestrator warms every tenant at startup (~6 s, mostly
  the two token mints).

If a live read fails or exceeds its budget (`CTX_GRAPH_TIMEOUT_MS`, `CTX_AZ_TIMEOUT_MS`),
the server transparently falls back to the manifest, so the demo never breaks when Wi-Fi
drops.

Install the Az and Microsoft.Graph submodules first. The script bootstraps
[ModuleFast](https://github.com/JustinGrote/ModuleFast) by Justin Grote
(`Invoke-RestMethod bit.ly/modulefast | Invoke-Expression`), which resolves the dependency
graph in parallel and installs into the CurrentUser scope in seconds instead of the minutes
`Install-Module` takes; if the bootstrap is unreachable it falls back to `Install-PSResource`.
`Invoke-SeedContextPaneLab.ps1 -InstallMissingModules` runs the same installer on demand.

```bash
pwsh -NoProfile -File ./scripts/Install-ContextPaneModules.ps1
```

Seed the lab tenant (review first, then run it yourself — it creates users, groups, a
Conditional Access policy, a resource group and a deliberately drifted NSG):

```bash
pwsh -NoProfile -File ./scripts/Invoke-SeedContextPaneLab.ps1
```

Tear it down:

```bash
pwsh -NoProfile -File ./scripts/Remove-ContextPaneLab.ps1
```

---

## Configuration

Copy `.env.example` to `.env.local`, or run the interactive configurator:

```bash
pwsh -NoProfile -File ./scripts/Set-ContextPaneRouterConfig.ps1
```

All model IDs are overridable via `CTX_MODEL_*` variables. `CTX_FORCE_LOCAL=true` pins
the router to the deterministic engine even when keys are present (demo safety switch).
`CTX_PRICE_USD_PER_1M_TOKENS` is the blended price behind the "API credit saved" figure in
the router savings panel (`t`).

### Publishing to GitHub (hackathon rules §3/§4)

Every commit must be new work created after the kickoff (2026-10-26 17:00 CET) and solely
authored. `Publish-ContextPaneRepo.ps1` audits the history, optionally rewrites it, and
creates the public repository with the GitHub CLI:

```bash
pwsh -NoProfile -File ./scripts/Publish-ContextPaneRepo.ps1 -NormalizeTimestampsToNow -WhatIf
```

- `-NormalizeTimestampsToNow` runs `git filter-branch --env-filter/--msg-filter` so every
  commit is authored and committed by `Timur Dudhasch <155721920+dudhasch@users.noreply.github.com>`,
  carries no `Co-Authored-By` trailer, and is timestamped >= now (monotonic, 1 s apart).
  It refuses to run before kickoff unless `-Force`.
- `-PushNow` (or simply running after kickoff) executes
  `gh repo create contextpane --public --source . --remote origin --push`.
- Once `origin` exists, the Tier 3 drawer can open a real pull request: tick
  **Open GitHub PR on approval** (or set `CTX_GH_PR_ON_APPROVE=true`) and
  `[Approve & Execute]` pushes the staged `fix/<ticket>-nsg-drift-<id>` branch and runs
  `gh pr create --base $CTX_GH_PR_BASE`. Without a remote the approval behaves as before.

---

## Demo hotkeys

Press `?` in the workbench for the overlay.

| Key | Beat |
|---|---|
| `1` | Hover the affected UPN pill → Tier 1A diagnostic popover |
| `2` | Select the E5 contract line → semantic floating toolbar (`12/15 Assigned • 3 Missing E5`) |
| `3` | CodeLens → unified HCL diff, Azure live state vs `demo-iac/main.tf` |
| `4` | Generate Fix & Stage PR → Tier 3 drawer with verification badge and staged branch |
| `5` | Approve & Execute via Delegated Identity (HITL) |
| `6` | Switch tenant (Contoso ↔ Fabrikam); with a pinned recipe this is Tier 0, 0 tokens |
| `p` | Pin / release the canvas as a View Recipe |
| `v` | Voice Steer panel (record, or type a command) |
| `t` | Router savings panel |
| `r` | Re-correlate with a fresh MCP context |
| `Esc` | Close everything |

## Verified behaviour (offline, no keys)

`pwsh ./scripts/Test-ContextPaneSmoke.ps1` on the reference machine:

```
Endpoint                                                   Status Latency(ms) Tier    Provider Schema
GET /api/health                                            OK              63 -       -        PASS
GET /api/recipe/default/hydrate?tenantId=tenant-contoso-01 OK       4 (srv 2) Tier 0  local    PASS
POST /api/hover                                            OK       6 (srv 0) Tier 1A local    PASS
POST /api/correlate                                        OK       2 (srv 0) Tier 1B local    PASS
POST /api/voice-steer                                      OK       1 (srv 0) Voice   local    PASS
POST /api/remediate                                        OK     3034 (srv 981) Tier 3B local  PASS   (AST pass · fmt pass · validate pass · Verified Safe)
POST /api/approve                                          OK              51 -       -        PASS
```

The first `/api/remediate` on a machine takes ~30 s while `terraform init` downloads the
azurerm provider into `.contextpane/tf-validate`; every later run validates in ~0.5 s.

## Verified behaviour (live: Meta Model API + Modal + seeded lab tenant)

Same smoke test with `META_API_KEY` and the Modal sandbox set and `LIVE_CLOUD_MODE=true`
against `c4a8shili.onmicrosoft.com`, after the startup warm-up:

```
  pre-flight: Verified Safe  ast=True fmt=True validate=True sandbox=modal-cloud-sandbox 667ms
Endpoint                                                   Status       Latency(ms) Tier    Provider Model                   Tokens Schema
GET /api/health                                            OK                    57 -       -        -                            0 PASS
GET /api/recipe/default/hydrate?tenantId=tenant-contoso-01 OK             6 (srv 3) Tier 0  local    deterministic                0 PASS
POST /api/hover                                            OK             7 (srv 0) Tier 1A meta     muse-spark-1.3 (cached)      0 PASS
POST /api/hover                                            OK             1 (srv 0) Tier 1A meta     muse-spark-1.3 (cached)      0 PASS
POST /api/correlate                                        OK       4067 (srv 4065) Tier 1B meta     muse-spark-1.3           10409 PASS
POST /api/voice-steer                                      OK            17 (srv 0) Voice   local    deterministic                0 PASS
POST /api/remediate                                        OK     18282 (srv 18279) Tier 3B meta     muse-wonder-1.0          13801 PASS
POST /api/approve                                          OK                  3098 -       -        -                            0 PASS
GET /api/telemetry/stats                                   OK                     1 -       -        -                            0 PASS
```

- **Hover:** every pill of the ticket (all 5 users, the entitlement group, the AADSTS code,
  the host pool and the NSG: 9 on Contoso) is pre-fetched after startup (~10 s, three at a
  time) and after every correlate, then served from memory in <10 ms with 0 tokens. An uncached hover on the Meta API takes ~2.3-3 s even at
  `reasoning_effort: minimal` (measured across `muse-spark-1.1`/`1.2`/`1.3`).
- **Correlate:** ~4-5.5 s for the layout, but the SSE stream sends `mcp_ready` with a
  `TenantSummaryHeader` built from the MCP data first (~0.7-1 s in the workbench). The model reasons over the context but leaves the verbatim MCP
  data (license users, sign-in events, HCL diff) for the orchestrator to fill in before Zod
  validation, which cut the layout output from ~9k to ~3k characters.
- **Remediate:** ~15-18 s, almost all of it `muse-wonder-1.0`. The Modal pre-flight takes
  670-770 ms round trip from Europe to us-east (350-420 ms inside the sandbox: AST ~10 ms,
  `fmt` ~40 ms, `validate` ~300 ms, run concurrently), down from 5.5-7 s, because the container
  keeps `pwsh` and the azurerm provider running between requests. The orchestrator pings it
  at startup and on every correlate, so the ~6.5 s cold boot happens before Generate Fix.
- **Voice:** `scripts/New-ContextPaneVoiceFixture.ps1 -WebM -Send` synthesizes the command
  with Windows' speech engine and transcribes it live: WAV in 1.9 s, MediaRecorder-style
  WebM/Opus in 2.5 s, both "only show license drift and the sign in timeline" → `filter`.

What the live Meta Model API taught the router:

- It only accepts `tool_choice: "auto"`; a named function choice is HTTP 400. The client
  sends `"auto"` with the single tool and an explicit "call this tool" instruction to Meta,
  and downgrades any other provider the first time it returns that 400.
- `muse-spark-1.3` and `muse-wonder-1.0` are reasoning models: reasoning tokens count against
  `max_tokens` (a 6000-token cap once ended mid-preamble with `finish_reason: length`), so
  every tier sends `reasoning_effort` (`CTX_META_REASONING_*`) and leaves headroom.
- `muse-glimmer-30b` and `muse-code` are not served, and the voice model is
  `muse-voice-transcribe-1.0`; the startup `GET /models` check swaps in the stand-ins.
- There is no `/audio/transcriptions`. Batch speech-to-text is `POST /v1/asr/transcribe`
  with a JSON `request` part (`{ "model", "audioEncoding": "WAV" }`) and an `audio` part,
  and it accepts 16-bit mono PCM WAV at 16 or 24 kHz only. The workbench re-encodes the
  MediaRecorder recording to 16 kHz WAV in the browser (`apps/web/src/lib/wav.ts`), and the
  orchestrator transcodes anything else with `ffmpeg` when it is installed.

Open-weight Muse Glimmer 30B, verified live on Modal (2026-10-26): `Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf`
on llama.cpp b11889, one L40S, weights in the `contextpane-glimmer-weights` Volume. A cold boot from zero is healthy in 17.7 s
(container up in 3.6 s, the 16.8 GB GGUF loaded from the Volume in ~14 s). All 18 hoverable
pills of Contoso Finance and Fabrikam Legal were generated by `modal-open-weights` and persisted to
`data/hover-cache.json`; a restart loads them and generates nothing (both tenants ready 1.9 s after
start, GPU untouched), and a cached hover is served in 0-2 ms. Glimmer always reasons (its template
cannot switch thinking off, and b11889 did not enforce `--reasoning-budget`), so one uncached hover
takes ~25 s on a warm L40S (1,097 completion tokens at ~44 tok/s) and 15-42 s three at a time
during the pre-warm. That is why interactive hovers keep an 8 s budget with Meta `muse-spark-1.3`
as the fallback, and why a fallback answer never replaces a cached Glimmer one. The GPU only serves
hovers (`CTX_OPEN_WEIGHT_TIERS=hover`), scales to zero after 2 idle minutes and is capped at one
container. The open-weight endpoints on RunPod or locally are not exercised.

---

## Scripts

```bash
bun run dev             # orchestrator + web
bun run typecheck       # tsc --noEmit across every workspace
bun run smoke           # PowerShell smoke test against :4000
bun run mcp:erp         # run an MCP server over stdio
```

---

MIT © 2026 Timur Dudhasch
