# @contextpane/mcp-azure-iac

The Azure Resource Manager + IaC **MCP server**. It compares the live (or seeded) Azure estate with the Terraform baseline in [`demo-iac/main.tf`](../../demo-iac/main.tf) and reports:
- NSG rule and tag drift
- the AVD estate
- policy compliance
- regional compute quota
- resource inventory and per-resource hover diagnostics

```bash
bun run mcp:azure-iac          # stdio MCP server (packages/mcp-azure-iac/src/server.ts)
```

It is registered as `contextpane-azure-iac` in [`mcp-servers.json`](../../mcp-servers.json). The orchestrator calls it in-process by default.

## Data modes

[`getMcpDataMode()` (shared.ts:104)](src/shared.ts#L104) picks the mode:
1. An explicit `CTX_DATA_MODE` (`real-tenant` or `simulated-lab`) wins.
2. Otherwise `LIVE_CLOUD_MODE=true` means `real-tenant`.
3. `set_data_mode` changes the mode at runtime.

In strict real-tenant mode there is no fallback. In non-strict live mode a failed ARM read falls back to [`demo-iac/demo-lab-manifest.json`](../../demo-iac/demo-lab-manifest.json) (`service.ts:61-68`). Only `tenant-contoso-01` (subscription `20505597-…`, resource group `rg-contoso-avd-prod`) is live-capable.

**Auth.** [`token.ts`](src/token.ts) mints an ARM token (`https://management.azure.com/`) from the cached `Connect-AzAccount` context and keeps it in memory for up to 45 minutes. All calls are plain `fetch()` ([`live.ts`](src/live.ts)).

## Tools

| Tool | Line | Returns |
|---|---|---|
| `get_mode` · `set_data_mode` | `server.ts:24`, `:30` | live flag, data mode, live tenants, resolved `demo-iac` directory |
| `get_az_context` | `:40` | the Connect-AzAccount context |
| `get_terraform_baseline` | `:46` | the expected NSG parsed from `demo-iac/*.tf` ([`hcl.ts`](src/hcl.ts), a deliberately small HCL reader) |
| `get_nsg_state` | `:56` | live or seeded NSG |
| `get_nsg_drift` | `:76` | tag and rule drift, severity, unified HCL diff, CodeLens line refs |
| `get_avd_estate` | `:66` | AVD host pool, FSLogix, policy compliance |
| `get_resource_inventory` · `get_virtual_machines` | `:87`, `:93` | resource groups and resources; `Get-AzVM`-style VM list |
| `get_resource_diagnostic` | `:103` | hover drift diagnostic for a resource |
| `get_azure_policies` | `:113` | policy compliance and Resource Health |
| `get_regional_quotas` | `:123` | EU regional quota utilisation |

## Reversible mutations

| Method | ARM call | Reversal |
|---|---|---|
| `setNsgState` (`service.ts:416`) | PUT / DELETE security rules, PATCH tags | the opposite state (`remediated` ↔ `drifted`) |
| `restoreNsgState` (`service.ts:427`) | restore from a captured snapshot | used by the f⁻¹ inverse |
| `reconcileNsgTo` (`service.ts:433`) | converge to a given rule set | n/a |
| [`putAbacRoleAssignmentLive`](src/abac.ts#L346) | PUT one Storage Blob Data Contributor assignment with a container condition (`conditionVersion 2.0`), then a GET read-back | [`deleteAbacRoleAssignmentsLive`](src/abac.ts#L380) |

Without live mode these are simulated in memory (`service.ts:444`).

## What is live and what is fixture

| Capability | Status |
|---|---|
| NSG rules + tags, drift vs Terraform | live in real-tenant mode |
| Regional quota (`Microsoft.Compute/locations/westeurope/usages`) | live in strict real-tenant mode, seeded otherwise |
| Policy assignments | listed live in strict mode, but every assignment is mapped to Compliant; fallback rows (including the `RequestDisallowedByPolicy` detail text) are hard-coded |
| Activity Log | queried only for the ABAC lab ([`readActivityLog`, abac.ts:239](src/abac.ts#L239)): failed `roleAssignments/write` events with `RequestDisallowedByPolicy`, last 24 h, 2.5 s budget |
| RBAC / ABAC role-assignment conditions | [`abac.ts`](src/abac.ts), an exported module the orchestrator calls in-process (not an MCP tool): live read of the lab storage account, policy assignment and role assignments, and the conditioned grant above. Every call is refused outside the lab subscription ([`arm`, :69](src/abac.ts#L69)); in `simulated-lab` mode the orchestrator uses a labelled fixture instead |
| OpenTofu / state files | no `tofu` binary and no state-file diff; drift compares the parsed `.tf` with live or manifest state, and validation uses Terraform 1.9.8 |

## Tests

[`drift.test.ts`](src/drift.test.ts) covers the HCL parser and the drift diff.
