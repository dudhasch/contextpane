# Trace: the 3-step MCP vault boundary

Raw tenant identifiers stay inside the orchestrator. Models receive pseudonyms and `ptr://` pointers; the orchestrator swaps them back to real values only on its own side of the boundary.

This trace was captured on 2026-10-29, before rehydration was scoped and before the untrusted-data delimiters were added; the notes under each step say what the merged code does differently. The numbers are from that capture. It runs the orchestrator's own functions on ticket `INC-4092` (Contoso Finance, lab tenant `c4a8shili.onmicrosoft.com`) with `CTX_FORCE_LOCAL=true`, so the MCP services serve the seeded lab state and no provider is called. The UPN is a seeded demo user.

```text
 MCP servers (in-process)        orchestrator (Bun)                              model provider
 ────────────────────────        ──────────────────────────────────────────      ──────────────
 msgraph · azure-iac · erp  ──▶  ① gatherContext: real UPNs, GUIDs, rows
                                    publishDataPlane → ptr://inc-4092/…#fence
                                 ② contextForCorrelation (descriptors, no rows)
                                    vaultMessages: UPN → upn_tok_NN       ──────▶  sees tokens + ptr://
                                 ③ depseudonymizeJsonText(tool args,     ◀──────  answers with tokens + ptr://
                                      only tokens this prompt/ticket carried)
                                    resolveDataPtr(ptr, fence) → rows
                                    rows sent back to a model are re-pseudonymised
```

## Step 1: the orchestrator gathers with real identifiers

The orchestrator calls MCP itself. [`gatherContext`](../../apps/orchestrator/src/mcp/context.ts#L119) probes the msgraph, azure-iac and erp services in parallel with real identifiers, and no model decides which MCP call to make. The rows are published to the data plane under fenced pointers by [`publishDataPlane`](../../apps/orchestrator/src/local/dataplane.ts#L118). The tenant's people are also registered with the session vault, so free text that names them is pseudonymised as well ([context.ts:137](../../apps/orchestrator/src/mcp/context.ts#L137)).

```text
ticket sender     lynne.robins.contoso@c4a8shili.onmicrosoft.com
pointers          ptr://inc-4092/entra/users · ptr://inc-4092/entra/sku-pools
                  ptr://inc-4092/entra/group-errors · ptr://inc-4092/entra/signins · …
fence             tenant-contoso-01 · epoch 1 · generation 11
```

## Step 2: the outbound prompt carries tokens and pointers

[`contextForCorrelation`](../../apps/orchestrator/src/mcp/context.ts#L496) builds the prompt context from scalar facts and one schema-and-aggregate descriptor per dataset. No multi-row array reaches the prompt. Every provider call then goes through [`chatWithForcedTool`](../../apps/orchestrator/src/router/openai.ts#L160), and its first step, [`vaultMessages`](../../apps/orchestrator/src/router/openai.ts#L134), replaces UPNs / e-mail addresses, known display names, known user object ids, known device names, phone numbers and public IPv4 addresses with session tokens. [`recordPrompt`](../../packages/catalog/src/dataplane.ts#L954) scans what actually leaves and counts detector hits: what the vault detector can see, not all PII. The ticket text now travels inside `<untrusted_customer_data>` delimiters, under a system rule to treat it as data.

```text
outgoing prompt   "Ticket from upn_tok_01: {"scenario":{"scenarioId":"INC-4092", …"
size              8,155 characters · no "rows" array
detector hits     0
```

## Step 3: the reply is de-referenced in the orchestrator, and re-redacted on the way back

The model answers through a forced tool call. Its arguments can name only tokens and pointers. The orchestrator rehydrates the tokens server-side ([`depseudonymizeJsonText`, openai.ts:228](../../apps/orchestrator/src/router/openai.ts#L228)), but only tokens this prompt carried, or, with a `piiScope`, tokens earlier prompts of the same tenant and ticket carried. A token from another ticket or tenant, or one the model guessed, stays a token and is counted in `refusedRehydrations`. It resolves a pointer only through [`resolveDataPtr`](../../apps/orchestrator/src/local/dataplane.ts#L320), and only after the v3 fence passes; `GET /api/dataplane` answers 409 on a fence failure ([app.ts:824](../../apps/orchestrator/src/app.ts#L824)).

```text
model tool args   {"targetEntityId":"upn_tok_01","dataPtr":"ptr://inc-4092/entra/users"}
rehydrated        {"targetEntityId":"lynne.robins.contoso@c4a8shili.onmicrosoft.com","dataPtr":"ptr://inc-4092/entra/users"}

resolve (fence ok)          found · 5 rows
  orchestrator row 0        {"upn":"lynne.robins.contoso@c4a8shili.onmicrosoft.com","displayName":"Lynne Robins", …}
  model-safe row 0          {"upn":"upn_tok_03","displayName":"displayName_tok_03", …}
resolve (tenant-fabrikam-02) not found · pointer fence failed: cross-tenant
```

Rows that go back to a model are pseudonymised again first. The selection lens, for example, sends Muse Wonder at most five vaulted sample rows ([explore.ts:174](../../apps/orchestrator/src/tiers/explore.ts#L174)). Each data-plane snapshot keeps its own vault. That is why the same person is `upn_tok_01` in the session vault and `upn_tok_03` in this snapshot's vault.

## What this trace does not show

- **MCP calls are not driven by the model.** The model never emits an MCP tool call carrying a `ptr://` argument for the orchestrator to execute. The orchestrator gathers deterministically before any model runs, and model output is applied to layouts and remediation bundles.
- **Two kinds of token.** `ptr://` addresses datasets. Individual people and objects are vaulted as `upn_tok_NN`, `displayName_tok_NN` and so on.
- **No workload-identity or Activity Log hop on this ticket.** The repository has no trace from a ticket sender to an owned service principal to an Activity Log policy deny, and the `RequestDisallowedByPolicy` detail on INC-4092's policy rows is fixture data. The only Activity Log query belongs to the ABAC lab tickets, whose payroll identity is a fixed lab constant rather than one discovered from the sender (see [README §4.1 and §5](../../README.md#5-what-is-live-what-is-simulated)).
- **Pseudonymisation, not encryption.** The tokens are session-scoped aliases with an epoch-salted (unkeyed) digest; rehydration is scoped per prompt, tenant and ticket.
- **Images are not vaulted.** A screenshot is sent to the vision model only with `CTX_VISION_SEND_IMAGES=true`; by default the vision tier makes no call.
- **Tier 3 gets the full context.** Its PowerShell must name the users it changes, so Tier 3 receives the full context instead of descriptors. That context still goes through `chatWithForcedTool`, so the coder writes tokens and the orchestrator rehydrates the script. The custom-ticket coder and the card synthesizer also receive compact `tenantFacts` from the gathered context, through the same vault and under a rule that marks them as data.
