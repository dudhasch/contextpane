#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ErpNotFoundError, erpService } from "./service.ts";

/**
 * MCP stdio entrypoint for the ERP server. Every tool returns JSON text content
 * plus structuredContent so both LLM clients and typed callers can consume it.
 */
export function createErpMcpServer(): McpServer {
  const server = new McpServer({ name: "contextpane-erp", version: "0.1.0" });

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  });
  const fail = (error: unknown) => ({
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  });
  const guard = <T>(fn: () => T) => {
    try {
      return ok(fn());
    } catch (error) {
      if (error instanceof ErpNotFoundError) return fail(error);
      throw error;
    }
  };

  server.registerTool(
    "list_tenants",
    { title: "List ERP tenants", description: "List every customer tenant known to the ERP/PSA.", inputSchema: {} },
    async () => ok({ tenants: erpService.listTenants() }),
  );

  server.registerTool(
    "get_tenant_context",
    {
      title: "Get tenant context",
      description: "Tenant profile plus its primary escalation ticket and contract in one call.",
      inputSchema: { tenantId: z.string().describe("e.g. tenant-contoso-01") },
    },
    async ({ tenantId }) => guard(() => erpService.getTenantContext(tenantId)),
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get ERP ticket",
      description: "Fetch a ticket by id (INC-4092, INC-4099).",
      inputSchema: { ticketId: z.string() },
    },
    async ({ ticketId }) => guard(() => erpService.getTicket(ticketId)),
  );

  server.registerTool(
    "list_tickets",
    { title: "List tickets", description: "List tickets, optionally for one tenant.", inputSchema: { tenantId: z.string().optional() } },
    async ({ tenantId }) => ok({ tickets: erpService.listTickets(tenantId) }),
  );

  server.registerTool(
    "get_contract",
    {
      title: "Get ERP contract",
      description: "Fetch a contract with its billed lines (CNT-2026-884, CNT-2026-912). Pass tenantId to resolve the primary contract.",
      inputSchema: { contractId: z.string().optional(), tenantId: z.string().optional() },
    },
    async ({ contractId, tenantId }) =>
      guard(() => {
        if (contractId) return erpService.getContract(contractId);
        if (tenantId) return erpService.getContract(erpService.getTenant(tenantId).primaryContractId);
        throw new ErpNotFoundError("contract", "(none specified)");
      }),
  );

  server.registerTool(
    "get_billed_seats",
    {
      title: "Get billed seats",
      description: "Billed seat count and unit price for a SKU on a tenant's contracts.",
      inputSchema: { tenantId: z.string(), skuPartNumber: z.string() },
    },
    async ({ tenantId, skuPartNumber }) => ok({ billed: erpService.getBilledSeats(tenantId, skuPartNumber) }),
  );

  server.registerTool(
    "search",
    { title: "Search ERP", description: "Free-text search across tenants, tickets, contracts, UPNs and groups.", inputSchema: { query: z.string() } },
    async ({ query }) => ok({ hits: erpService.search(query) }),
  );

  return server;
}

if (import.meta.main) {
  const server = createErpMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[contextpane-erp] MCP server ready on stdio");
}
