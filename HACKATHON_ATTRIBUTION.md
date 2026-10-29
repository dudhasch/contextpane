# Hackathon Attribution: Meta Global AI Developer Hackathon 2026

| Field | Value |
|---|---|
| **Project** | ContextPane: an operator-steered remediation workbench for MSP engineers on Microsoft Entra ID, Intune and Azure |
| **Track** | Indie Developer Track |
| **Themes** | Build for Your World · Push the Frontier |
| **Bonus prizes entered** | Best Build on Meta Open Weights · Best Agentic Use-Case · Best Creative Build |
| **Hackathon window** | October 26 – November 4, 2026 |
| **Team** | Solo entry: Timur Dudhasch (GitHub `dudhasch`) |
| **License** | MIT (see [`LICENSE`](LICENSE)) |
| **Repository** | https://github.com/dudhasch/contextpane |

This file and the root [`README.md`](README.md) cite the same model ids, endpoints and `file:line` pointers. Line numbers were verified against the tree at the commit that added this file.

## Provenance statement

Every line of code, script, schema, document and demo asset in this repository was created **inside the hackathon window**, starting on **October 26, 2026**. The repository was initialised empty on that date, and the commit history is the audit trail:

```bash
git log --reverse --format='%ad  %h  %s' --date=iso
```

No code was carried over from a prior project. Third-party dependencies are declared in the workspace `package.json` files and are all OSI-licensed. Internal working notes (audits, review loops, journals, voiceover staging) were moved to a git-ignored `/archive` folder before submission; they remain in the commit history.

## Meta models used

| Stage / tier | Purpose | Model id as configured | What answers | Provider | Code |
|---|---|---|---|---|---|
| 0 · Tier 1A hover | Inline hover diagnostic (`AADSTS…` translation, grounded fields) | `muse-glimmer-30b` | `Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf` on llama.cpp `llama-server`, strict `json_schema` → GBNF | Modal, 1× L40S, scale to zero | [`modal-sandbox/glimmer_open_weights.py:133`](modal-sandbox/glimmer_open_weights.py#L133), [`apps/orchestrator/src/tiers/tier1-hover.ts:52`](apps/orchestrator/src/tiers/tier1-hover.ts#L52) |
| 0 · Tier 1A fallback | Same, when the open-weight endpoint is not used | `muse-spark-1.3` | `muse-spark-1.3` | Meta Model API | [`apps/orchestrator/src/config.ts:164`](apps/orchestrator/src/config.ts#L164) |
| 1 · Goal Clarifier | Scoping questions → typed steering v0 | `muse-wonder-1.0` | `muse-wonder-1.0` | Meta Model API | [`apps/orchestrator/src/local/subagent-orchestrator.ts:146`](apps/orchestrator/src/local/subagent-orchestrator.ts#L146) |
| 3 · UI Architect gatekeeper | Names the missing catalog element | `muse-spark-1.3` | `muse-spark-1.3` | Meta Model API | [`apps/orchestrator/src/local/dynamic-catalog.ts:188`](apps/orchestrator/src/local/dynamic-catalog.ts#L188) |
| 3 · UI Architect synthesizer | Fills a `SynthesizedDynamicCard` from five primitives | `muse-wonder-1.0` | `muse-wonder-1.0` | Meta Model API | [`apps/orchestrator/src/local/dynamic-catalog.ts:285`](apps/orchestrator/src/local/dynamic-catalog.ts#L285) |
| 4 · Coder (custom tickets, steering) | PS7 script, Terraform diff, rollback; re-parameterises on steer | `muse-wonder-1.0` | `muse-wonder-1.0` | Meta Model API | [`apps/orchestrator/src/local/subagent-orchestrator.ts:354`](apps/orchestrator/src/local/subagent-orchestrator.ts#L354) |
| Tier 3A plan | Remediation plan for built-in scenarios | `muse-wonder-1.0` | `muse-wonder-1.0` | Meta Model API | [`apps/orchestrator/src/tiers/tier3-remediate.ts:162`](apps/orchestrator/src/tiers/tier3-remediate.ts#L162) |
| Tier 3B code / repair turns | PowerShell + Terraform synthesis; write-then-test repairs | `muse-code` | **`muse-wonder-1.0`** (stand-in) | Meta Model API | [`apps/orchestrator/src/tiers/tier3-remediate.ts:191`](apps/orchestrator/src/tiers/tier3-remediate.ts#L191), [`apps/orchestrator/src/tiers/repair-loop.ts:109`](apps/orchestrator/src/tiers/repair-loop.ts#L109) |
| Tier 1B / 2 correlate | Ticket ↔ Graph ↔ IaC correlation → forced layout | `muse-spark-1.3` | `muse-spark-1.3` | Meta Model API | [`apps/orchestrator/src/tiers/tier2-correlate.ts:64`](apps/orchestrator/src/tiers/tier2-correlate.ts#L64) |
| Selection lens | Highlight → 4-mode Context Lens | `muse-wonder-1.0`, then `muse-spark-1.3` | as configured | Meta Model API | [`apps/orchestrator/src/tiers/explore.ts:104`](apps/orchestrator/src/tiers/explore.ts#L104) |
| Vision | Ticket screenshot as an image part | `muse-spark-1.3` | `muse-spark-1.3` | Meta Model API | [`apps/orchestrator/src/config.ts:167`](apps/orchestrator/src/config.ts#L167) |
| Voice | Hands-free steering (`POST /asr/transcribe`, 16-bit mono WAV) | `muse-voice-transcribe-1.0`, intent via `muse-spark-1.3` | as configured | Meta Model API | [`apps/orchestrator/src/router/openai.ts:235`](apps/orchestrator/src/router/openai.ts#L235), [`apps/orchestrator/src/tiers/voice.ts:54`](apps/orchestrator/src/tiers/voice.ts#L54) |

**Stand-ins (disclosed).** The hackathon brief names two ids the Meta Model API does not serve (checked against `GET /v1/models` on 2026-10-26): `muse-glimmer-30b` exists only as open weights, and `muse-code` is not exposed. At start-up [`apps/orchestrator/src/router/meta-models.ts:11`](apps/orchestrator/src/router/meta-models.ts#L11) swaps any unserved Meta id for its stand-in (`muse-glimmer-30b → muse-spark-1.3` on the Meta API, `muse-code → muse-wonder-1.0`). The startup log prints `<id> is not served → <stand-in>`, and `GET /api/config` reports the swap under `metaModelResolution`. Tier 3B code synthesis therefore runs on `muse-wonder-1.0`, and Glimmer only ever runs as our Modal open-weight deployment.

**Optional, not configured for the demo.** The router also knows Fireworks (`accounts/fireworks/models/muse-glimmer-30b`) and Baseten (`meta-models/muse-spark-open-1026`) as drop-in providers ahead of Meta. Neither had a key in the demo configuration, so neither produced any answer shown in the README assets.

## Endpoints

| Endpoint | What it is | Configured by |
|---|---|---|
| Meta Model API (`/v1/chat/completions`, `/v1/models`, `/v1/asr/transcribe`) | Hosted Muse models | `META_API_BASE_URL`, `META_API_KEY` |
| Modal app `contextpane-glimmer` | Muse Glimmer 30B on 1× L40S, `max_containers=1`, 120 s scale-down, weights in Volume `contextpane-glimmer-weights` | `MODAL_INFERENCE_BASE_URL` (or `CTX_OPEN_WEIGHT_BASE_URL`), `CTX_OPEN_WEIGHT_TIERS=hover` |
| Modal app `contextpane-sandbox` | Warm CPU class (4 vCPU, 2 GiB, 300 s scale-down): persistent pwsh AST server, Terraform 1.9.8 + azurerm ~> 4.0; `validate_remediation` web endpoint | `CTX_MODAL_SANDBOX_URL`, `CTX_MODAL_SANDBOX_TOKEN`, `CTX_MODAL_SANDBOX_ENABLED` |

## MCP servers

| Server | Package | Tools | Live source |
|---|---|---|---|
| `contextpane-msgraph` | [`packages/mcp-msgraph`](packages/mcp-msgraph/README.md) | 15 (users, licensing, CA, Intune, sign-ins, diagnostics) | Microsoft Graph via the Az token cache; delegated `Connect-MgGraph` token for CA/Intune writes |
| `contextpane-azure-iac` | [`packages/mcp-azure-iac`](packages/mcp-azure-iac/README.md) | 12 (NSG drift vs Terraform, AVD, policy, quota, inventory) | Azure Resource Manager |
| `contextpane-erp` | [`packages/mcp-erp`](packages/mcp-erp/README.md) | 7 (tenants, tickets, contracts, billed seats, search) | fixtures only |

All three are registered in [`mcp-servers.json`](mcp-servers.json). The orchestrator calls them in-process by default (`CTX_MCP_TRANSPORT=stdio` spawns them).

## Bonus prize alignment

**Best Build on Meta Open Weights.**
- **Deployment.** Muse Glimmer 30B runs from Meta's published GGUF weights on our own Modal deployment ([`modal-sandbox/glimmer_open_weights.py`](modal-sandbox/glimmer_open_weights.py)).
- **Constrained output.** Every request uses a strict `HoverDiagnostic` JSON-schema response format, which llama-server enforces as a grammar.
- **Persisted answers.** Every hover pill of the seeded scenarios was generated by it and persisted with its real latency and token counts ([`data/hover-cache.seed.json`](data/hover-cache.seed.json)). A refresh (`?refresh=true`) re-runs it live, and the hover popover badge names the provider that actually answered.

**Best Agentic Use-Case.** Custom tickets run a five-stage sub-agent pipeline:
- **Stages.** A clarifier (`muse-wonder-1.0`), an MCP telemetry scout, a Spark→Wonder UI architect, a coder and a static verifier ([`apps/orchestrator/src/local/subagent-orchestrator.ts:677`](apps/orchestrator/src/local/subagent-orchestrator.ts#L677)).
- **Two-way steering.** The operator steers through typed `SteeringParams`; `PATCH /api/tickets/:id/steer` makes the coder re-parameterise the staged script ([`apps/orchestrator/src/app.ts:514`](apps/orchestrator/src/app.ts#L514)).
- **Write-then-test.** Sandbox findings go back to the coder for up to two repair turns ([`apps/orchestrator/src/tiers/repair-loop.ts:34`](apps/orchestrator/src/tiers/repair-loop.ts#L34)).
- **Human approval and inverse.** Nothing executes against a tenant without an explicit approval. The inverse is derived from a pre-change snapshot ([`apps/orchestrator/src/local/inverse-rollback.ts:205`](apps/orchestrator/src/local/inverse-rollback.ts#L205)).

**Best Creative Build.** The diagnostic UI expands itself:
- **Gatekeeper and synthesizer.** When no catalog card fits, `muse-spark-1.3` names the missing element and `muse-wonder-1.0` composes it from five primitives (`quota-gauges`, `policy-chain`, `data-table`, `config-diff`, `event-stream`).
- **Schema gate.** The card is validated with Zod before it is shown.
- **Persistence.** A valid card is persisted as `data/synthesized-elements/<ElementId>.tsx` plus a [`data/dynamic-catalog.json`](data/dynamic-catalog.json) entry.

## Media assets

Every image and loop in [`docs/assets/`](docs/assets) was produced during the hackathon:
- **Screenshots.** Captured from the running stack (1440×900, dark) through the Chrome DevTools protocol.
- **Annotations and diagrams.** Annotations were composed as SVG and rasterised with VectorCraft. The architecture diagrams are hand-authored SVG.
- **Loops.** Encoded to animated WebP and GIF with ffmpeg.

There are no video files in the repository.

## Non-Meta components

- Model Context Protocol (`@modelcontextprotocol/sdk`) for the three tool servers.
- Microsoft Graph PowerShell SDK and Az PowerShell for live cloud mode.
- Terraform CLI for IaC validation; Modal for the remote sandbox and the open-weight deployment; llama.cpp (`ghcr.io/ggml-org/llama.cpp:server-cuda`) as the inference server.
- ModuleFast by Justin Grote (MIT) bootstraps the Az / Microsoft.Graph module install (`scripts/Install-ContextPaneModules.ps1`); GitHub CLI (`gh`) for publishing and Tier 3 PRs.
- Bun, Hono, Vite, React 19, Tailwind v4, Zustand, Zod, floating-ui, lucide-react.

## Contact

Timur Dudhasch, GitHub `dudhasch`
