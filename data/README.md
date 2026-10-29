# data/

Persistent state the orchestrator reads at start-up. Tracked files are deliberate, schema-valid artifacts. Everything the app writes at runtime is git-ignored.

## Tracked

| Path | What it is | Written by |
|---|---|---|
| [`dynamic-catalog.json`](dynamic-catalog.json) | The **N+k registry**: 4 built-in cards plus every Muse-synthesized element (`elementId`, domain, reason, primitives, gatekeeper and synthesizer model, `reuseCount`, `tsxStubPath`, full `cardTemplate`) | [`apps/orchestrator/src/local/dynamic-catalog.ts`](../apps/orchestrator/src/local/dynamic-catalog.ts) |
| [`synthesized-elements/*.tsx`](synthesized-elements) | One typed module per synthesized card: it re-exports `SynthesizedDynamicCardSchema` and the card spec, so the card is reviewable as source | same, on every schema-valid synthesis |
| [`hover-cache.seed.json`](hover-cache.seed.json) | Muse Glimmer 30B hover answers generated on the Modal L40S, keyed `tenant\|entity`, each with its real latency and token counts; copied to `hover-cache.json` on a fresh clone | Tier 1A warm-up |
| [`compiled-skills.json`](compiled-skills.json) | Tier 0 compiled skills: recipes keyed by a scenario signature that replay a remediation layout with 0 tokens | `POST /api/skills/compile` |

The registry currently holds k = 5 synthesized elements:

| Element | Synthesized for |
|---|---|
| `CantRecreateMyKeyvaultAfterCard` · `CanRecreateMyKeyVaultCard` | Key Vault soft-delete name reservation |
| `MyApiAssignmentForMcpCard` | a missing app-role assignment for an MCP API |
| `LynneRobinsCannotAccessNewlyCard` | Key Vault data-plane access after recreation |
| `FinanceBlobAbacConditionFix` | an ABAC condition on Storage Blob Data Reader plus an inherited CAF policy (captured for the README) |

All of them were composed by `muse-spark-1.3` (gatekeeper) and `muse-wonder-1.0` (synthesizer). The UPNs inside them belong to the seeded demo users of the lab tenant.

## Git-ignored runtime state

| Path | Contents |
|---|---|
| `hover-cache.json` | live hover answers (seeded from the file above) |
| `audit-log.json` | the approval / rollback / closure audit ledger |
| `remediations/` | stored remediation bundles |
| `custom-scenarios.json` | triaged custom tickets (capped at 12) |
| `recipes.json` · `settings.json` | pinned View Recipes; data-mode setting |
| `synthesized-elements-log.json` | per-synthesis audit log (prompt pseudonymised) |
| `router-debug.jsonl` | raw router traces with `CTX_ROUTER_DEBUG=1` |

Tests never write here: catalog writes are disabled under `NODE_ENV=test` unless `CTX_PERSIST_CATALOG=true`. "Clear synthesized elements" in the System & audit drawer (`POST /api/dynamic-catalog/clear`) resets the registry to the built-ins.
