#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { msgraphService } from "./service.ts";

export function createMsGraphMcpServer(): McpServer {
  const server = new McpServer({ name: "contextpane-msgraph", version: "0.1.0" });

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return ok(await fn());
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  };
  const tenantId = z.string().describe("tenant-contoso-01 | tenant-fabrikam-02");

  server.registerTool(
    "get_mode",
    { title: "Get mode", description: "Whether LIVE_CLOUD_MODE is on and which tenants can be queried live.", inputSchema: {} },
    async () => ok(msgraphService.getMode()),
  );

  server.registerTool(
    "get_graph_context",
    { title: "Get Graph context", description: "Current Connect-MgGraph context (live mode only).", inputSchema: {} },
    async () => run(() => msgraphService.getGraphContext()),
  );

  server.registerTool(
    "get_license_state",
    {
      title: "Get license state",
      description:
        "Entra license assignment for the tenant's entitlement group: per-user current vs expected SKU (from the com.contextpane.licenseState open extension), drift list and assigned count.",
      inputSchema: { tenantId },
    },
    async (args) => run(() => msgraphService.getLicenseState(args.tenantId)),
  );

  server.registerTool(
    "get_license_inventory",
    {
      title: "Get license inventory",
      description:
        "SKU pools (subscribedSkus enabled/consumed/available), group-based licensing errors (CountViolation) and per-user assignment state and path (Direct / Group) for a tenant or for ANOM-LIC-101.",
      inputSchema: { tenantId, scenarioId: z.string().optional() },
    },
    async (args) => run(() => msgraphService.getLicenseInventory(args.tenantId, args.scenarioId)),
  );

  server.registerTool(
    "get_ca_posture",
    {
      title: "Get Conditional Access posture",
      description: "Demo Conditional Access policies diffed against the golden baseline (break-glass exclusion, report-only drift), the directory audit trail and legacy-auth sign-ins.",
      inputSchema: { tenantId },
    },
    async (args) => run(() => msgraphService.getCaPosture(args.tenantId)),
  );

  server.registerTool(
    "get_intune_drift",
    {
      title: "Get Intune drift",
      description: "Intune policy drift against the golden baseline: Settings Catalog values, conflicting profile assignments and device compliance (ANOM-INT-309, INC-4099).",
      inputSchema: { scenarioId: z.enum(["ANOM-INT-309", "INC-4099"]) },
    },
    async (args) => run(() => msgraphService.getIntuneDrift(args.scenarioId)),
  );

  server.registerTool(
    "get_group_members",
    {
      title: "Get group members",
      description: "Members of an Entra security group (Get-MgGroupMember). Defaults to the tenant's primary entitlement group.",
      inputSchema: { tenantId, groupDisplayName: z.string().optional() },
    },
    async (args) => run(() => msgraphService.getGroupMembers(args.tenantId, args.groupDisplayName)),
  );

  server.registerTool(
    "get_conditional_access_policies",
    {
      title: "Get Conditional Access policies",
      description: "Demo-scoped Conditional Access policies with included/excluded groups, target apps and grant controls.",
      inputSchema: { tenantId },
    },
    async (args) => run(() => msgraphService.getConditionalAccessPolicies(args.tenantId)),
  );

  server.registerTool(
    "get_sign_in_events",
    {
      title: "Get sign-in events",
      description: "Entra sign-in log entries with AADSTS codes and the Conditional Access policy that blocked them.",
      inputSchema: { tenantId, upn: z.string().optional(), top: z.number().int().min(1).max(100).optional() },
    },
    async (args) => run(() => msgraphService.getSignInEvents(args.tenantId, { upn: args.upn, top: args.top })),
  );

  server.registerTool(
    "get_user_diagnostic",
    {
      title: "Get user diagnostic",
      description: "Hover-ready diagnostic for a UPN: license drift, groups, blocking policies, recent sign-ins, AADSTS translation.",
      inputSchema: { tenantId, upn: z.string() },
    },
    async (args) => run(() => msgraphService.getUserDiagnostic(args.tenantId, args.upn)),
  );

  server.registerTool(
    "get_policy_diagnostic",
    {
      title: "Get policy diagnostic",
      description: "A Conditional Access policy plus the sign-ins it blocked.",
      inputSchema: { tenantId, policyNameOrId: z.string() },
    },
    async (args) => run(() => msgraphService.getPolicyDiagnostic(args.tenantId, args.policyNameOrId)),
  );

  server.registerTool(
    "get_group_diagnostic",
    {
      title: "Get group diagnostic",
      description: "Group membership, drift count and the policies targeting a group.",
      inputSchema: { tenantId, groupDisplayName: z.string() },
    },
    async (args) => run(() => msgraphService.getGroupDiagnostic(args.tenantId, args.groupDisplayName)),
  );

  return server;
}

if (import.meta.main) {
  const server = createMsGraphMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`[contextpane-msgraph] MCP server ready on stdio (LIVE_CLOUD_MODE=${msgraphService.getMode().liveCloudMode})`);
}
