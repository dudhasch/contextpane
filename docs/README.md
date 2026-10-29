# docs/

The visual documentation for ContextPane. All media was captured from the running stack on 2026-10-29: 1440×900, dark theme, simulated-lab data, with live Meta Model API and Modal calls. There are no video files; motion is shipped as animated WebP with a GIF fallback.

## Animated loops

| File | Length | Shows |
|---|---|---|
| [`assets/hero-flight-deck.webp`](assets/hero-flight-deck.webp) · [`.gif`](assets/hero-flight-deck.gif) | 11.8 s | ① Glimmer hover popover ② selection → Muse Wonder lens ③ scope chip → steering v1 → rail diff |
| [`assets/nk-ui-synthesis-loop.webp`](assets/nk-ui-synthesis-loop.webp) | 11.1 s | unscripted ABAC ticket → triage stream → net-new `FinanceBlobAbacConditionFix` card |
| [`assets/coderail-steering-loop.webp`](assets/coderail-steering-loop.webp) | 9.4 s | scope chip → re-parameterising shimmer → "What changed · steering v0 → v1" |

## Architecture diagrams (SVG, dark-native)

| File | Shows |
|---|---|
| [`assets/arch-muse-execution-pipeline.svg`](assets/arch-muse-execution-pipeline.svg) | Meta Muse models in execution order: Stage 0 hover, stages 1–5, steering, Tier 3, provider boundary |
| [`assets/arch-pii-pointer-vault.svg`](assets/arch-pii-pointer-vault.svg) | `ptr://` v1/v2/v3 data plane, session PII vault, rehydration, fence outcomes |
| [`assets/arch-kinematic-prewarm.svg`](assets/arch-kinematic-prewarm.svg) | click-then-fetch vs hover-intent speculative pre-fetch (60 ms dwell, 4-slot epoch-fenced buffer) |

## Annotated screenshots

| File | Shows |
|---|---|
| [`assets/01-flight-deck-3zone.png`](assets/01-flight-deck-3zone.png) | the three zones (400 px · fluid · 440 px) on #INC-4092 |
| [`assets/02-glimmer-hover-and-pii-vault.png`](assets/02-glimmer-hover-and-pii-vault.png) | Glimmer hover badge (22.8 s generated, 2 ms cached) + pseudonym vault + 0-raw-PII metric |
| [`assets/03-kinematic-prewarm-telemetry.png`](assets/03-kinematic-prewarm-telemetry.png) | per-tier routing ledger, 5-stage pipeline records, pre-fetch counters |
| [`assets/04-nk-wonder-synthesis-and-reuse.png`](assets/04-nk-wonder-synthesis-and-reuse.png) | the synthesized ABAC card + the k=5 registry |
| [`assets/05-coderail-modal-sandbox-finverse.png`](assets/05-coderail-modal-sandbox-finverse.png) | scope chips, steering diff, prover strip, 1-click undo, approve footer |
| [`assets/06-universal-selection-lenses.png`](assets/06-universal-selection-lenses.png) | Selection #1 → Triage lens and Blast radius modes |

## How they were made

1. **Capture.** A headless Edge was driven over the Chrome DevTools protocol at exactly 1440×900, with `prefers-color-scheme: dark`, against the workbench and orchestrator. Stills and frame sequences (250–800 ms apart) were captured during real hover, selection, triage and steering interactions.
2. **Annotate.** Crops and numbered callouts were composed as SVG in the Graphite & Signal palette and rasterised with VectorCraft (`vectorcraft-cli convert`).
3. **Encode.** Lower-third captions were composited on each frame, then ffmpeg encoded the loops to animated WebP (libwebp, q70) and to GIF (two-pass palette).

[`scripts/capture-readme-screenshots.ts`](../scripts/capture-readme-screenshots.ts) is the repository's own repeatable CDP capture script.

## Other documentation

- [`traces/`](traces/README.md): boundary traces captured from the orchestrator's own code (the 3-step MCP vault boundary)
- [`../README.md`](../README.md): overview, model execution order, deep dives, quickstart
- [`../HACKATHON_ATTRIBUTION.md`](../HACKATHON_ATTRIBUTION.md): models, endpoints, provenance
- [`../DESIGN.md`](../DESIGN.md): the Graphite & Signal design system
- Package READMEs: [orchestrator](../apps/orchestrator/README.md) · [web](../apps/web/README.md) · [catalog](../packages/catalog/README.md) · [mcp-msgraph](../packages/mcp-msgraph/README.md) · [mcp-azure-iac](../packages/mcp-azure-iac/README.md) · [mcp-erp](../packages/mcp-erp/README.md) · [modal-sandbox](../modal-sandbox/README.md) · [data](../data/README.md) · [scripts](../scripts/README.md)
