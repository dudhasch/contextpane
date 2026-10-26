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
│  Tier 1A hover             Fireworks → Baseten → Meta API (muse-glimmer-30b) │
│  Tier 1B/2 correlate       Baseten muse-spark-open-1026 → Meta API spark 1.3 │
│  Tier 3A/3B remediate      Meta API muse-wonder-1.0 + muse-code              │
│          └─ pre-flight: pwsh AST + terraform fmt/validate | Modal sandbox    │
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
| **1A** | `POST /api/hover` | Translates an entity (UPN, group, `AADSTS53003`) into a `HoverDiagnosticPopover`. | Fireworks `muse-glimmer-30b` → Baseten → Meta API |
| **1B** | `POST /api/correlate` | `Promise.all` over the 3 MCP servers, then one forced tool call (`hydrate_contextpane_layout`) returns the full layout; every component is Zod-validated and any gap is repaired by the deterministic hydrator. | Baseten `meta-models/muse-spark-open-1026` (open weights) |
| **2** | `POST /api/correlate` | Same call, escalated when Baseten is unavailable. | Meta API `muse-spark-1.3` |
| **3A / 3B** | `POST /api/remediate` | `muse-wonder` plans, `muse-code` emits the PowerShell + Terraform bundle, pre-flight verifies it (PowerShell AST parse + cmdlet allow-list, `terraform fmt` + `validate`, or the Modal sandbox), a git worktree stages `fix/<ticket>-nsg-drift-*`, and `ActionApprovalDrawer` comes back for Human-in-the-Loop approval via `POST /api/approve`. | Meta API `muse-wonder-1.0` + `muse-code` |
| **Voice** | `POST /api/voice-steer` | Audio (base64) or text → intent → filter / pin / switch tenant / generate fix. | `muse-voice-transcribe` + `muse-spark-open-1026` |

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
│   ├── Set-ContextPaneRouterConfig.ps1
│   ├── Invoke-SeedContextPaneLab.ps1
│   ├── Remove-ContextPaneLab.ps1
│   └── Test-ContextPaneSmoke.ps1
├── modal-sandbox/                Optional Modal pre-flight sandbox (Python)
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
`Get-MgIdentityConditionalAccessPolicy`, `Get-AzNetworkSecurityGroup`). You need an
authenticated `Connect-MgGraph` / `Connect-AzAccount` context in the environment the
orchestrator runs in. If a live query fails, the server transparently falls back to the
manifest, so the demo never breaks when Wi-Fi drops.

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
