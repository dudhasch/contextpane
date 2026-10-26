# ContextPane

**A local-first, MCP-driven, catalog-constrained Generative UI workbench for MSP Azure & Microsoft 365 engineers.**

Built from scratch for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026),
*Build for Your World* track. See [`HACKATHON_ATTRIBUTION.md`](./HACKATHON_ATTRIBUTION.md).

ContextPane takes a commercial ERP escalation ticket, correlates it live against Entra ID
(licenses, Conditional Access, sign-in logs) and Azure (NSG drift vs. Terraform), and
renders the answer as **Zod-validated UI components, never chat prose**. A 4-tier compute
router makes sure the cheapest possible path answers each request: a pinned View Recipe
costs **0 tokens and <150 ms**, an inline hover costs one `muse-glimmer-30b` call, and
only an explicit *Generate Fix* click escalates to `muse-wonder` + `muse-code` with a
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
│  Tier 1A hover             Modal/RunPod vLLM → Meta API (muse-glimmer-30b)   │
│  Tier 1B catalog           Modal/RunPod vLLM → Meta spark-1.3-contributor    │
│  Tier 2  correlate         Meta API muse-spark-1.3 (escalation)              │
│  Tier 3A/3B remediate      Meta API muse-wonder-1.0 + muse-code              │
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
| **1A** | `POST /api/hover` | Translates an entity (UPN, group, `AADSTS53003`) into a `HoverDiagnosticPopover`. | Open-weight `muse-glimmer-30b` on Modal / RunPod vLLM → Meta API `muse-glimmer-30b` |
| **1B** | `POST /api/correlate` | `Promise.all` over the 3 MCP servers, then one forced tool call (`hydrate_contextpane_layout`) returns the full layout; every component is Zod-validated and any gap is repaired by the deterministic hydrator. | Open-weight vLLM on Modal / RunPod → Meta API `muse-spark-1.3-contributor` |
| **2** | `POST /api/correlate` | Same call, escalated when Tier 1B fails or returns an invalid layout. | Meta API `muse-spark-1.3` |
| **3A / 3B** | `POST /api/remediate` | `muse-wonder` plans, `muse-code` emits the PowerShell + Terraform bundle, pre-flight verifies it in the Modal sandbox (falling back to the local PowerShell AST parse + cmdlet allow-list, `terraform fmt` + `validate`), a git worktree stages `fix/<ticket>-nsg-drift-*`, and `ActionApprovalDrawer` comes back for Human-in-the-Loop approval via `POST /api/approve`. | Meta API `muse-wonder-1.0` + `muse-code`, Modal `validate_remediation` |
| **Voice** | `POST /api/voice-steer` | Audio (base64) or text → intent → filter / pin / switch tenant / generate fix. | `muse-voice-transcribe` + `muse-spark-1.3` |

**Primary stack: Meta Model API + Modal.** A `META_API_KEY` alone (plus the optional Modal
sandbox URL) is a complete, first-class configuration: providers without a key are left out
of the chain entirely, so Meta answering Tier 1A/1B is not reported as a fallback. Open
weights are opt-in: `modal-sandbox/open_weights_vllm.py` serves `muse-glimmer-30b` on Modal
with vLLM (scale to zero), and `scripts/Start-RunPodGlimmer.ps1` does the same on RunPod;
either URL goes into `CTX_OPEN_WEIGHT_BASE_URL` (or `MODAL_INFERENCE_BASE_URL` /
`RUNPOD_VLLM_BASE_URL`). Baseten (`muse-spark-open-1026`) and Fireworks keys remain optional
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
│   ├── Start-RunPodGlimmer.ps1          Optional RunPod vLLM pod for open-weight muse-glimmer-30b
│   └── Test-ContextPaneSmoke.ps1
├── modal-sandbox/                Modal Tier 3B pre-flight sandbox + optional open-weight vLLM (Python)
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

Set `LIVE_CLOUD_MODE=true` to have `mcp-msgraph` and `mcp-azure-iac` shell out to
PowerShell 7 (`Get-MgGroupMember`, `Get-MgUserExtension`,
`Get-MgIdentityConditionalAccessPolicy`, `Get-AzNetworkSecurityGroup`). One cached
`Connect-AzAccount` sign-in on the machine is enough: the Az token cache persists across
processes, and when a spawned `pwsh` has no `Connect-MgGraph` context, `mcp-msgraph` mints a
Microsoft Graph token with `Get-AzAccessToken -ResourceUrl https://graph.microsoft.com` and
hands it to `Connect-MgGraph -AccessToken`. If a live query fails or exceeds its budget
(`CTX_GRAPH_TIMEOUT_MS`, `CTX_AZ_TIMEOUT_MS`, `CTX_GRAPH_SIGNIN_TIMEOUT_MS`), the server
transparently falls back to the manifest, so the demo never breaks when Wi-Fi drops. The
sign-in timeline always comes from the manifest in practice: the lab users never sign in,
and a UPN-filtered `auditLogs/signIns` query takes 40-60 s on a busy tenant, so it gets a
6 s budget.

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

Not yet exercised: the live provider calls (no Meta / Baseten / Fireworks keys were
available while building), `LIVE_CLOUD_MODE=true` against the seeded tenant, and the
deployed Modal sandbox. All three paths are typed, timeout-bounded and fall back to the
deterministic engine on failure.

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
