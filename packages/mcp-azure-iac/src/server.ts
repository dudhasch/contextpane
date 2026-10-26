#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { azureIacService } from "./service.ts";

export function createAzureIacMcpServer(): McpServer {
  const server = new McpServer({ name: "contextpane-azure-iac", version: "0.1.0" });

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  });
  const run = async (fn: () => Promise<unknown> | unknown) => {
    try {
      return ok(await fn());
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  };
  const tenantId = z.string().describe("tenant-contoso-01 | tenant-fabrikam-02");

  server.registerTool(
    "get_mode",
    { title: "Get mode", description: "LIVE_CLOUD_MODE flag, live-capable tenants and the resolved demo-iac directory.", inputSchema: {} },
    async () => ok(azureIacService.getMode()),
  );

  server.registerTool(
    "get_az_context",
    { title: "Get Az context", description: "Current Connect-AzAccount context (live mode only).", inputSchema: {} },
    async () => run(() => azureIacService.getAzContext()),
  );

  server.registerTool(
    "get_terraform_baseline",
    {
      title: "Get Terraform baseline",
      description: "The expected NSG state parsed from demo-iac/*.tf plus the raw file content.",
      inputSchema: { tenantId },
    },
    async (args) => run(() => azureIacService.getTerraformBaseline(args.tenantId)),
  );

  server.registerTool(
    "get_nsg_state",
    {
      title: "Get NSG state",
      description: "Live (Get-AzNetworkSecurityGroup) or seeded NSG state: tags and security rules.",
      inputSchema: { tenantId },
    },
    async (args) => run(() => azureIacService.getNsgState(args.tenantId)),
  );

  server.registerTool(
    "get_avd_estate",
    {
      title: "Get AVD estate",
      description: "AVD host pool topology (pool type, load balancing, session hosts, FSLogix) and the Azure Policy compliance of its resource group.",
      inputSchema: { tenantId: z.string() },
    },
    async ({ tenantId }) => run(() => azureIacService.getAvdEstate(tenantId)),
  );

  server.registerTool(
    "get_nsg_drift",
    {
      title: "Get NSG drift",
      description:
        "Compare Azure NSG state against the Terraform baseline: tag drift, rogue/modified/missing security rules with severity, a unified HCL diff and a CodeLens summary.",
      inputSchema: { tenantId },
    },
    async (args) => run(() => azureIacService.getNsgDrift(args.tenantId)),
  );

  server.registerTool(
    "get_resource_inventory",
    { title: "Get resource inventory", description: "Resource group + resources with tags.", inputSchema: { tenantId } },
    async (args) => run(() => azureIacService.getResourceInventory(args.tenantId)),
  );

  server.registerTool(
    "get_resource_diagnostic",
    {
      title: "Get resource diagnostic",
      description: "Hover-ready drift diagnostic for a resource name.",
      inputSchema: { tenantId, resourceName: z.string() },
    },
    async (args) => run(() => azureIacService.getResourceDiagnostic(args.tenantId, args.resourceName)),
  );

  return server;
}

if (import.meta.main) {
  const server = createAzureIacMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`[contextpane-azure-iac] MCP server ready on stdio (LIVE_CLOUD_MODE=${azureIacService.getMode().liveCloudMode})`);
}
