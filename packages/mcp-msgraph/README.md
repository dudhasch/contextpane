# @contextpane/mcp-msgraph

The Microsoft Entra ID + Intune **MCP server**. It feeds ContextPane:
- users and group-based licensing
- Conditional Access posture
- Intune Settings Catalog drift
- sign-ins with AADSTS codes
- workload-identity posture
- per-entity hover diagnostics

The data comes from either the seeded **live lab tenant** or the **deterministic multi-tenant fixtures**.

```bash
bun run mcp:msgraph            # stdio MCP server (packages/mcp-msgraph/src/server.ts)
```

The orchestrator imports the service in-process by default; `CTX_MCP_TRANSPORT=stdio` makes it spawn this server instead ([`apps/orchestrator/src/mcp/clients.ts`](../../apps/orchestrator/src/mcp/clients.ts)). It is registered as `contextpane-msgraph` in [`mcp-servers.json`](../../mcp-servers.json).

## Data modes

| Mode | When | Source |
|---|---|---|
| `simulated-lab` | default; `LIVE_CLOUD_MODE` unset/false, or `CTX_DATA_MODE=simulated-lab` | [`demo-iac/demo-lab-manifest.json`](../../demo-iac/demo-lab-manifest.json) + labelled fixtures ([`fixtures.ts`](src/fixtures.ts), [`golden.ts`](src/golden.ts), [`workload-identity.ts`](src/workload-identity.ts)) |
| `real-tenant` | `LIVE_CLOUD_MODE=true` or `CTX_DATA_MODE=real-tenant`; switchable at runtime with `set_data_mode` | Microsoft Graph for `tenant-contoso-01` (`c4a8shili.onmicrosoft.com`). In non-strict live mode a failed read falls back to the manifest |

Only Contoso Finance is live-capable. **Fabrikam Legal** (`fabrikamlegal.onmicrosoft.com`) is always manifest-only, which keeps a second tenant available for multi-tenant demos.

**Auth.**
- **Reads.** [`token.ts`](src/token.ts) mints a Graph token from the cached `Connect-AzAccount` context (`Get-AzAccessToken`), keeps it in memory for up to 45 minutes and refreshes it 5 minutes before expiry. Reads go out as Graph `$batch` POSTs ([`live.ts`](src/live.ts)).
- **CA / Intune writes.** These need a delegated `Connect-MgGraph` token persisted in `~/.mg`, which [`scripts/Connect-ContextPaneGraph.ps1`](../../scripts/Connect-ContextPaneGraph.ps1) sets up.

## Tools

All tools are read-only except the mode switch.

| Tool | Line | Returns |
|---|---|---|
| `get_mode` · `set_data_mode` | `server.ts:24`, `:30` | live flag, data mode, live-capable tenants |
| `get_workload_identity_posture` | `:40` | app registrations, service principals, secrets, OIDC federation posture |
| `get_graph_context` | `:50` | the Connect-MgGraph context |
| `get_license_state` | `:56` | current vs expected SKU per user (open extension `com.contextpane.licenseState`) |
| `get_license_inventory` | `:67` | `subscribedSkus` pools, group-licensing errors, assignment path |
| `get_ca_posture` | `:78` | Conditional Access vs the golden baseline, audit trail, legacy-auth sign-ins |
| `get_intune_drift` | `:88` | Settings Catalog drift, conflicting assignments, compliance |
| `get_group_members` · `get_security_groups` | `:98`, `:158` | Entra group members; `SG-*` groups |
| `get_conditional_access_policies` | `:108` | demo-scoped CA policies |
| `get_sign_in_events` | `:118` | sign-ins with AADSTS codes |
| `get_user_diagnostic` · `get_policy_diagnostic` · `get_group_diagnostic` | `:128`, `:138`, `:148` | hover diagnostics for a UPN, a CA policy (plus the sign-ins it blocked) and a group |

## Reversible mutations

The service performs these writes; they are not exposed as MCP tools. The orchestrator calls them only after a human approval, and simulates them offline or for manifest-only tenants:

| Method | Graph call | Reversal |
|---|---|---|
| `setLicenseExtensionState` (`service.ts:930`) | `$batch` PATCH of the `com.contextpane.licenseState` extension | the same call with the drifted state (Reset drift) |
| `setConditionalAccessState` (`service.ts:1240`) | PATCH the CA policy: exclude the AVD group, switch to report-only | restored on reset |
| `setIntuneState` (`service.ts:1443`) | PUT `configurationPolicies`, POST `/assign` | restored on reset |

Each takes a `LabLicenseState`, so remediate and reset are the same operation in opposite directions. The orchestrator's pre-change snapshot ([`apps/orchestrator/src/local/snapshot.ts`](../../apps/orchestrator/src/local/snapshot.ts)) uses these reads, and the f⁻¹ inverse goes through these writes.

## Tests

[`golden.test.ts`](src/golden.test.ts) checks the golden-baseline drift against [`golden-tenant/`](../../golden-tenant).
