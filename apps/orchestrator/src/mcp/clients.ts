import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  azureIacService,
  createAzureIacMcpServer,
  type AvdEstate,
  type AzurePolicyAndHealthRow,
  type IacResult,
  type NsgDrift,
  type RealAzureVmRow,
  type RegionalQuotaRow,
  type TerraformBaseline,
} from "@contextpane/mcp-azure-iac";
import { createErpMcpServer, erpService, type ErpTenantContext } from "@contextpane/mcp-erp";
import {
  createMsGraphMcpServer,
  msgraphService,
  type CaPolicySummary,
  type CaPosture,
  type GraphResult,
  type IntuneDrift,
  type IntuneScenarioKey,
  type LicenseInventory,
  type LicenseState,
  type McpDataMode,
  type SecurityGroupSummary,
  type SignInSummary,
  type UserDiagnostic,
  type WorkloadIdentityFixture,
} from "@contextpane/mcp-msgraph";
import { join } from "node:path";
import { REPO_ROOT, config, isLiveCloudMode } from "../config.ts";

/**
 * One interface, two transports:
 *  - in-process: direct TypeScript calls (sub-millisecond, default)
 *  - stdio:      the same three servers spawned as MCP processes (CTX_MCP_TRANSPORT=stdio)
 */

export type PolicyDiagnostic = Awaited<ReturnType<typeof msgraphService.getPolicyDiagnostic>>;
export type GroupDiagnostic = Awaited<ReturnType<typeof msgraphService.getGroupDiagnostic>>;
export type ResourceDiagnostic = Awaited<ReturnType<typeof azureIacService.getResourceDiagnostic>>;
export type ResourceInventory = Awaited<ReturnType<typeof azureIacService.getResourceInventory>>;

export interface McpDataSources {
  transport: "in-process" | "stdio";
  getDataMode(): McpDataMode;
  setDataMode(mode: McpDataMode): Promise<{ dataMode: McpDataMode; liveCloudMode: boolean }>;
  erp: {
    getTenantContext(tenantId: string): Promise<ErpTenantContext>;
  };
  msgraph: {
    getLicenseState(tenantId: string): Promise<GraphResult<LicenseState>>;
    getLicenseInventory(tenantId: string, scenarioId?: string): Promise<GraphResult<LicenseInventory>>;
    getCaPosture(tenantId: string): Promise<GraphResult<CaPosture>>;
    getIntuneDrift(key: IntuneScenarioKey): Promise<GraphResult<IntuneDrift>>;
    getConditionalAccessPolicies(tenantId: string): Promise<GraphResult<CaPolicySummary[]>>;
    getSignInEvents(tenantId: string, options?: { upn?: string; top?: number }): Promise<GraphResult<SignInSummary[]>>;
    getUserDiagnostic(tenantId: string, upn: string): Promise<GraphResult<UserDiagnostic>>;
    getPolicyDiagnostic(tenantId: string, policyNameOrId: string): Promise<PolicyDiagnostic>;
    getGroupDiagnostic(tenantId: string, groupDisplayName: string): Promise<GroupDiagnostic>;
    getSecurityGroups(tenantId: string): Promise<GraphResult<SecurityGroupSummary[]>>;
    getWorkloadIdentityPosture(tenantId: string): Promise<GraphResult<WorkloadIdentityFixture | null>>;
  };
  azure: {
    getNsgDrift(tenantId: string): Promise<IacResult<NsgDrift>>;
    getAvdEstate(tenantId: string): Promise<IacResult<AvdEstate>>;
    getResourceDiagnostic(tenantId: string, resourceName: string): Promise<ResourceDiagnostic>;
    getResourceInventory(tenantId: string): Promise<ResourceInventory>;
    getVirtualMachines(tenantId: string): Promise<IacResult<RealAzureVmRow[]>>;
    getTerraformBaseline(tenantId: string): Promise<TerraformBaseline>;
    getAzurePolicies(tenantId: string): Promise<IacResult<AzurePolicyAndHealthRow[]>>;
    getRegionalQuotas(tenantId: string): Promise<IacResult<RegionalQuotaRow[]>>;
  };
  status(): Promise<{ transport: string; dataMode: McpDataMode; servers: Array<{ name: string; ok: boolean; tools?: number; error?: string }> }>;
}

/* ------------------------------- in-process ------------------------------- */

export const inProcessSources: McpDataSources = {
  transport: "in-process",
  getDataMode: () => msgraphService.getDataMode(),
  setDataMode: async (mode) => {
    const g = msgraphService.setDataMode(mode);
    azureIacService.setDataMode(mode);
    return g;
  },
  erp: {
    getTenantContext: async (tenantId) => erpService.getTenantContext(tenantId),
  },
  msgraph: {
    getLicenseState: (t) => msgraphService.getLicenseState(t),
    getLicenseInventory: (t, s) => msgraphService.getLicenseInventory(t, s),
    getCaPosture: (t) => msgraphService.getCaPosture(t),
    getIntuneDrift: (k) => msgraphService.getIntuneDrift(k),
    getConditionalAccessPolicies: (t) => msgraphService.getConditionalAccessPolicies(t),
    getSignInEvents: (t, o) => msgraphService.getSignInEvents(t, o),
    getUserDiagnostic: (t, upn) => msgraphService.getUserDiagnostic(t, upn),
    getPolicyDiagnostic: (t, p) => msgraphService.getPolicyDiagnostic(t, p),
    getGroupDiagnostic: (t, g) => msgraphService.getGroupDiagnostic(t, g),
    getSecurityGroups: (t) => msgraphService.getSecurityGroups(t),
    getWorkloadIdentityPosture: (t) => msgraphService.getWorkloadIdentityPosture(t),
  },
  azure: {
    getNsgDrift: (t) => azureIacService.getNsgDrift(t),
    getAvdEstate: (t) => azureIacService.getAvdEstate(t),
    getResourceDiagnostic: (t, r) => azureIacService.getResourceDiagnostic(t, r),
    getResourceInventory: (t) => azureIacService.getResourceInventory(t),
    getVirtualMachines: (t) => azureIacService.getVirtualMachines(t),
    getTerraformBaseline: async (t) => azureIacService.getTerraformBaseline(t),
    getAzurePolicies: (t) => azureIacService.getAzurePolicies(t),
    getRegionalQuotas: (t) => azureIacService.getRegionalQuotas(t),
  },
  async status() {
    return { transport: "in-process", dataMode: msgraphService.getDataMode(), servers: await inProcessToolCounts() };
  },
};

/**
 * In-process services skip the MCP wire for speed, but the tool counts the HUD shows come from
 * each server's own registry: build the server once, link it over an in-memory transport and
 * list its tools.
 */
let toolCounts: Promise<Array<{ name: string; ok: boolean; tools?: number; error?: string }>> | null = null;
function inProcessToolCounts() {
  toolCounts ??= Promise.all(
    ([
      ["contextpane-erp", createErpMcpServer],
      ["contextpane-msgraph", createMsGraphMcpServer],
      ["contextpane-azure-iac", createAzureIacMcpServer],
    ] as const).map(async ([name, create]) => {
      try {
        const server = create();
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "contextpane-orchestrator", version: "0.1.0" });
        await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
        const { tools } = await client.listTools();
        await client.close();
        return { name, ok: true, tools: tools.length };
      } catch (error) {
        return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return toolCounts;
}

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
          env: { ...(process.env as Record<string, string>), LIVE_CLOUD_MODE: String(isLiveCloudMode()) },
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
    return { transport: "stdio", dataMode: msgraphService.getDataMode(), servers };
  }
}

const pool = new StdioPool();

export const stdioSources: McpDataSources = {
  transport: "stdio",
  getDataMode: () => msgraphService.getDataMode(),
  setDataMode: async (mode) => {
    const g = msgraphService.setDataMode(mode);
    azureIacService.setDataMode(mode);
    await Promise.all([
      pool.call("contextpane-msgraph", "set_data_mode", { dataMode: mode }).catch(() => null),
      pool.call("contextpane-azure-iac", "set_data_mode", { dataMode: mode }).catch(() => null),
    ]);
    return g;
  },
  erp: {
    getTenantContext: (tenantId) => pool.call("contextpane-erp", "get_tenant_context", { tenantId }),
  },
  msgraph: {
    getLicenseState: (tenantId) => pool.call("contextpane-msgraph", "get_license_state", { tenantId }),
    getLicenseInventory: (tenantId, scenarioId) => pool.call("contextpane-msgraph", "get_license_inventory", { tenantId, ...(scenarioId ? { scenarioId } : {}) }),
    getCaPosture: (tenantId) => pool.call("contextpane-msgraph", "get_ca_posture", { tenantId }),
    getIntuneDrift: (scenarioId) => pool.call("contextpane-msgraph", "get_intune_drift", { scenarioId }),
    getConditionalAccessPolicies: (tenantId) => pool.call("contextpane-msgraph", "get_conditional_access_policies", { tenantId }),
    getSignInEvents: (tenantId, options) => pool.call("contextpane-msgraph", "get_sign_in_events", { tenantId, ...options }),
    getUserDiagnostic: (tenantId, upn) => pool.call("contextpane-msgraph", "get_user_diagnostic", { tenantId, upn }),
    getPolicyDiagnostic: (tenantId, policyNameOrId) => pool.call("contextpane-msgraph", "get_policy_diagnostic", { tenantId, policyNameOrId }),
    getGroupDiagnostic: (tenantId, groupDisplayName) => pool.call("contextpane-msgraph", "get_group_diagnostic", { tenantId, groupDisplayName }),
    getSecurityGroups: (tenantId) => pool.call("contextpane-msgraph", "get_security_groups", { tenantId }),
    getWorkloadIdentityPosture: (tenantId) => pool.call("contextpane-msgraph", "get_workload_identity_posture", { tenantId }),
  },
  azure: {
    getNsgDrift: (tenantId) => pool.call("contextpane-azure-iac", "get_nsg_drift", { tenantId }),
    getAvdEstate: (tenantId) => pool.call("contextpane-azure-iac", "get_avd_estate", { tenantId }),
    getResourceDiagnostic: (tenantId, resourceName) => pool.call("contextpane-azure-iac", "get_resource_diagnostic", { tenantId, resourceName }),
    getResourceInventory: (tenantId) => pool.call("contextpane-azure-iac", "get_resource_inventory", { tenantId }),
    getVirtualMachines: (tenantId) => pool.call("contextpane-azure-iac", "get_virtual_machines", { tenantId }),
    getTerraformBaseline: (tenantId) => pool.call("contextpane-azure-iac", "get_terraform_baseline", { tenantId }),
    getAzurePolicies: (tenantId) => pool.call("contextpane-azure-iac", "get_azure_policies", { tenantId }),
    getRegionalQuotas: (tenantId) => pool.call("contextpane-azure-iac", "get_regional_quotas", { tenantId }),
  },
  status: () => pool.status(),
};

export const sources: McpDataSources = config.mcpTransport === "stdio" ? stdioSources : inProcessSources;
