# @contextpane/mcp-erp

The PSA / commercial **MCP server**. It provides the MSP's customer tenants, tickets, contracts and billed seat lines, and it supplies the commercial side of a remediation: which customer, which SLA, and how many seats are billed versus assigned.

```bash
bun run mcp:erp                # stdio MCP server (packages/mcp-erp/src/server.ts)
```

It is registered as `contextpane-erp` in [`mcp-servers.json`](../../mcp-servers.json). The data is **fixture-only and read-only** ([`src/data.ts`](src/data.ts)).

## Tools

| Tool | Line | Returns |
|---|---|---|
| `list_tenants` | `server.ts:32` | every ERP/PSA customer tenant |
| `get_tenant_context` | `:38` | tenant profile, primary ticket and contract |
| `get_ticket` · `list_tickets` | `:48`, `:58` | one ticket (`INC-4092`, `INC-4099`); tickets, optionally per tenant |
| `get_contract` | `:64` | contract with billed lines (`CNT-2026-884`, `CNT-2026-912`) |
| `get_billed_seats` | `:79` | billed seat count and unit price for a SKU |
| `search` | `:89` | free-text search across tenants, tickets, contracts, UPNs and groups |

## Tenants

| Id | Customer | Domain | Ticket · contract |
|---|---|---|---|
| `tenant-contoso-01` | Contoso Finance | `c4a8shili.onmicrosoft.com` (the seeded live lab) | INC-4092 · CNT-2026-884 |
| `tenant-fabrikam-02` | Fabrikam Legal | `fabrikamlegal.onmicrosoft.com` (fixtures) | INC-4099 · CNT-2026-912 |

## SLA clock

`SLA_RESOLUTION_MIN` sets the resolution budget: P1 240, P2 480, P3 1440 and P4 2880 minutes ([`service.ts:4`](src/service.ts#L4)). `withLiveClock` re-times open tickets relative to now (for example "opened 41 minutes ago"), so SLA badges move during a demo. The clock is simulated.

## Ticket queue

New tickets reach ContextPane through two other paths:
- **ERP file-drop inbox.** The orchestrator watches `input/tickets/#<id>/ticketbody.json` plus attachments ([`apps/orchestrator/src/local/erp-inbox.ts`](../../apps/orchestrator/src/local/erp-inbox.ts)). [`scripts/New-RandomErpTicketDrop.ps1`](../../scripts/New-RandomErpTicketDrop.ps1) generates drops.
- **Composer.** An operator can paste a ticket into the composer.

## What is not here

There is no Pax8 or CSP integration. The "Billed (Pax8)" column in the license card is a label over `get_billed_seats` from the fixture contracts.
