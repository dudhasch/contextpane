import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { azureIacService, type IacResult, type NsgDrift, type TerraformBaseline } from "@contextpane/mcp-azure-iac";
import { erpService, type ErpTenantContext } from "@contextpane/mcp-erp";
import {
  msgraphService,
  type CaPolicySummary,
  type GraphResult,
  type LicenseState,
  type SignInSummary,
  type UserDiagnostic,
} from "@contextpane/mcp-msgraph";
import { join } from "node:path";
import { REPO_ROOT, config } from "../config.ts";

/**
 * One interface, two transports:
 *  - in-process: direct TypeScript calls (sub-millisecond, default)
 *  - stdio:      the same three servers spawned as MCP processes (CTX_MCP_TRANSPORT=stdio)
 */

export type PolicyDiagnostic = Awaited<ReturnType<typeof msgraphService.getPolicyDiagnostic>>;
export type GroupDiagnostic = Awaited<ReturnType<typeof msgraphService.getGroupDiagnostic>>;
export type ResourceDiagnostic = Awaited<ReturnType<typeof azureIacService.getResourceDiagnostic>>;

export interface McpDataSources {
  transport: "in-process" | "stdio";
  erp: {
    getTenantContext(tenantId: string): Promise<ErpTenantContext>;
  };
  msgraph: {
    getLicenseState(tenantId: string): Promise<GraphResult<LicenseState>>;
    getConditionalAccessPolicies(tenantId: string): Promise<GraphResult<CaPolicySummary[]>>;
    getSignInEvents(tenantId: string, options?: { upn?: string; top?: number }): Promise<GraphResult<SignInSummary[]>>;
    getUserDiagnostic(tenantId: string, upn: string): Promise<GraphResult<UserDiagnostic>>;
    getPolicyDiagnostic(tenantId: string, policyNameOrId: string): Promise<PolicyDiagnostic>;
    getGroupDiagnostic(tenantId: string, groupDisplayName: string): Promise<GroupDiagnostic>;
  };
  azure: {
    getNsgDrift(tenantId: string): Promise<IacResult<NsgDrift>>;
    getResourceDiagnostic(tenantId: string, resourceName: string): Promise<ResourceDiagnostic>;
    getTerraformBaseline(tenantId: string): Promise<TerraformBaseline>;
  };
  status(): Promise<{ transport: string; servers: Array<{ name: string; ok: boolean; tools?: number; error?: string }> }>;
}

/* ------------------------------- in-process ------------------------------- */

export const inProcessSources: McpDataSources = {
  transport: "in-process",
  erp: {
    getTenantContext: async (tenantId) => erpService.getTenantContext(tenantId),
  },
  msgraph: {
    getLicenseState: (t) => msgraphService.getLicenseState(t),
    getConditionalAccessPolicies: (t) => msgraphService.getConditionalAccessPolicies(t),
    getSignInEvents: (t, o) => msgraphService.getSignInEvents(t, o),
    getUserDiagnostic: (t, upn) => msgraphService.getUserDiagnostic(t, upn),
    getPolicyDiagnostic: (t, p) => msgraphService.getPolicyDiagnostic(t, p),
    getGroupDiagnostic: (t, g) => msgraphService.getGroupDiagnostic(t, g),
  },
  azure: {
    getNsgDrift: (t) => azureIacService.getNsgDrift(t),
    getResourceDiagnostic: (t, r) => azureIacService.getResourceDiagnostic(t, r),
    getTerraformBaseline: async (t) => azureIacService.getTerraformBaseline(t),
  },
  async status() {
    return {
      transport: "in-process",
      servers: [
        { name: "contextpane-erp", ok: true, tools: 7 },
        { name: "contextpane-msgraph", ok: true, tools: 9 },
        { name: "contextpane-azure-iac", ok: true, tools: 7 },
      ],
    };
  },
};

/* ---------------------------------- stdio --------------------------------- */

class StdioPool {
  private clients = new Map<string, Promise<Client>>();

  private spec(name: string): { command: string; args: string[] } {
    const map: Record<string, string> = {
      "contextpane-erp": "packages/mcp-erp/src/server.ts",
      "contextpane-msgraph": "packages/mcp-msgraph/src/server.ts",
      "contextpane-azure-iac": "packages/mcp-azure-iac/src/server.ts",
    };
    const rel = map[name];
    if (!rel) throw new Error(`unknown MCP server ${name}`);
    return { command: "bun", args: ["run", join(REPO_ROOT, rel)] };
  }

  async get(name: string): Promise<Client> {
    let pending = this.clients.get(name);
    if (!pending) {
      pending = (async () => {
        const { command, args } = this.spec(name);
        const transport = new StdioClientTransport({
          command,
          args,
          cwd: REPO_ROOT,
          env: { ...(process.env as Record<string, string>), LIVE_CLOUD_MODE: String(config.liveCloudMode) },
          stderr: "pipe",
        });
        const client = new Client({ name: "contextpane-orchestrator", version: "0.1.0" });
        await client.connect(transport);
        return client;
      })();
      this.clients.set(name, pending);
      pending.catch(() => this.clients.delete(name));
    }
    return pending;
  }

  async call<T>(server: string, tool: string, args: Record<string, unknown>): Promise<T> {
    const client = await this.get(server);
    const result = await client.callTool({ name: tool, arguments: args });
    if (result.isError) {
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "MCP tool error";
      throw new Error(`${server}/${tool}: ${text}`);
    }
    if (result.structuredContent) return result.structuredContent as T;
    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "null";
    return JSON.parse(text) as T;
  }

  async status() {
    const servers = [];
    for (const name of ["contextpane-erp", "contextpane-msgraph", "contextpane-azure-iac"]) {
      try {
        const client = await this.get(name);
        const tools = await client.listTools();
        servers.push({ name, ok: true, tools: tools.tools.length });
      } catch (error) {
        servers.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { transport: "stdio", servers };
  }
}

const pool = new StdioPool();

export const stdioSources: McpDataSources = {
  transport: "stdio",
  erp: {
    getTenantContext: (tenantId) => pool.call("contextpane-erp", "get_tenant_context", { tenantId }),
  },
  msgraph: {
    getLicenseState: (tenantId) => pool.call("contextpane-msgraph", "get_license_state", { tenantId }),
    getConditionalAccessPolicies: (tenantId) => pool.call("contextpane-msgraph", "get_conditional_access_policies", { tenantId }),
    getSignInEvents: (tenantId, options) => pool.call("contextpane-msgraph", "get_sign_in_events", { tenantId, ...options }),
    getUserDiagnostic: (tenantId, upn) => pool.call("contextpane-msgraph", "get_user_diagnostic", { tenantId, upn }),
    getPolicyDiagnostic: (tenantId, policyNameOrId) => pool.call("contextpane-msgraph", "get_policy_diagnostic", { tenantId, policyNameOrId }),
    getGroupDiagnostic: (tenantId, groupDisplayName) => pool.call("contextpane-msgraph", "get_group_diagnostic", { tenantId, groupDisplayName }),
  },
  azure: {
    getNsgDrift: (tenantId) => pool.call("contextpane-azure-iac", "get_nsg_drift", { tenantId }),
    getResourceDiagnostic: (tenantId, resourceName) => pool.call("contextpane-azure-iac", "get_resource_diagnostic", { tenantId, resourceName }),
    getTerraformBaseline: (tenantId) => pool.call("contextpane-azure-iac", "get_terraform_baseline", { tenantId }),
  },
  status: () => pool.status(),
};

export const sources: McpDataSources = config.mcpTransport === "stdio" ? stdioSources : inProcessSources;
