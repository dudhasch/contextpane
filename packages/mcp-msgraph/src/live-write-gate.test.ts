import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as liveModule from "./live.ts";
import { assertWriteAllowed, LiveWriteRefusedError } from "./live.ts";
import { msgraphService } from "./service.ts";
import { labTenantId, liveWriteBlockReason, setMcpDataMode } from "./pwsh.ts";

/** An unsigned JWT with only the claims the gate reads. */
function token(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.`;
}

describe("one gate in front of every live Graph write", () => {
  const prev = { allow: process.env.CTX_ALLOW_EXECUTE, skip: process.env.CTX_SKIP_PWSH };
  beforeEach(() => {
    process.env.CTX_SKIP_PWSH = "true";
  });
  afterEach(() => {
    setMcpDataMode("simulated-lab");
    if (prev.allow === undefined) delete process.env.CTX_ALLOW_EXECUTE;
    else process.env.CTX_ALLOW_EXECUTE = prev.allow;
    if (prev.skip === undefined) delete process.env.CTX_SKIP_PWSH;
    else process.env.CTX_SKIP_PWSH = prev.skip;
  });

  test("live mode alone does not open the gate: CTX_ALLOW_EXECUTE must be true as well", () => {
    setMcpDataMode("simulated-lab");
    expect(liveWriteBlockReason()).toBe("LIVE_CLOUD_MODE=false");
    setMcpDataMode("real-tenant");
    delete process.env.CTX_ALLOW_EXECUTE;
    expect(liveWriteBlockReason()).toContain("CTX_ALLOW_EXECUTE=false");
    process.env.CTX_ALLOW_EXECUTE = "true";
    expect(liveWriteBlockReason()).toBeNull();
  });

  test("a token from another directory never reaches a write; the lab tenant's does", () => {
    setMcpDataMode("real-tenant");
    process.env.CTX_ALLOW_EXECUTE = "true";
    expect(() => assertWriteAllowed(token({ tid: "11111111-2222-3333-4444-555555555555" }))).toThrow(LiveWriteRefusedError);
    expect(() => assertWriteAllowed(token({}))).toThrow(/not the lab tenant/);
    expect(() => assertWriteAllowed(token({ tid: labTenantId() }))).not.toThrow();
    delete process.env.CTX_ALLOW_EXECUTE;
    expect(() => assertWriteAllowed(token({ tid: labTenantId() }))).toThrow(/CTX_ALLOW_EXECUTE=false/);
  });

  test("gate closed in live mode: the CA write is simulated and says why", async () => {
    setMcpDataMode("real-tenant");
    delete process.env.CTX_ALLOW_EXECUTE;
    const res = await msgraphService.setConditionalAccessState("tenant-contoso-01", "remediated");
    expect(res.source).toBe("simulated");
    expect(res.fallbackReason).toContain("CTX_ALLOW_EXECUTE=false");
  });

  test("a CA write that fails live is ok:false with the error, never a simulated success, and moves no lab state", async () => {
    setMcpDataMode("simulated-lab");
    const before = (await msgraphService.getConditionalAccessPolicies("tenant-contoso-01")).data.map((p) => [p.id, p.state, p.blocks]);
    setMcpDataMode("real-tenant");
    process.env.CTX_ALLOW_EXECUTE = "true";
    // CTX_SKIP_PWSH=true: no token can be minted, so the live attempt fails before any PATCH.
    const res = await msgraphService.setConditionalAccessState("tenant-contoso-01", "remediated");
    expect(res.source).toBe("live-graph");
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((r) => !r.ok)).toBe(true);
    expect(res.results[0]!.error).toBeTruthy();
    setMcpDataMode("simulated-lab");
    const after = (await msgraphService.getConditionalAccessPolicies("tenant-contoso-01")).data.map((p) => [p.id, p.state, p.blocks]);
    expect(after).toEqual(before);
  });

  test("a licence write that fails live is ok:false per user", async () => {
    setMcpDataMode("real-tenant");
    process.env.CTX_ALLOW_EXECUTE = "true";
    const res = await msgraphService.setLicenseExtensionState("tenant-contoso-01", ["lynne.robins.contoso@c4a8shili.onmicrosoft.com"], "remediated");
    expect(res.source).toBe("live-graph");
    expect(res.results.every((r) => !r.ok)).toBe(true);
  });
});

describe("strict real-tenant reads report what Graph returned, nothing invented", () => {
  afterEach(() => setMcpDataMode("simulated-lab"));

  test("workload identity: no made-up owner or GitHub OIDC credential when Graph cannot say", async () => {
    setMcpDataMode("real-tenant");
    const apps = spyOn(liveModule, "fetchRealApplicationsLive").mockResolvedValue([
      { objectId: "app-1", appId: "00000000-0000-0000-0000-000000000001", displayName: "app-one", signInAudience: "AzureADMyOrg", passwordCredentials: [], keyCredentialsCount: 0, requiredResourceAccessCount: 1 },
    ] as never);
    const extra = spyOn(liveModule, "fetchApplicationOwnersAndFicsLive").mockRejectedValue(new Error("Graph HTTP 403: Insufficient privileges"));
    try {
      const res = await msgraphService.getWorkloadIdentityPosture("tenant-contoso-01");
      expect(res.data?.owner.upn).toBe("(owners not readable)");
      expect(res.data?.owner.upn).not.toContain("tenant-admin@live");
      expect(res.data?.federatedCredential.issuer).toBe("");
      expect(res.data?.federatedCredential.driftState).toBe("unavailable");
    } finally {
      apps.mockRestore();
      extra.mockRestore();
    }
  });

  test("workload identity: the real first owner and federated credential when Graph returns them", async () => {
    setMcpDataMode("real-tenant");
    const apps = spyOn(liveModule, "fetchRealApplicationsLive").mockResolvedValue([
      { objectId: "app-1", appId: "00000000-0000-0000-0000-000000000001", displayName: "app-one", signInAudience: "AzureADMyOrg", passwordCredentials: [], keyCredentialsCount: 0, requiredResourceAccessCount: 1 },
    ] as never);
    const extra = spyOn(liveModule, "fetchApplicationOwnersAndFicsLive").mockResolvedValue({
      owners: [{ objectId: "u-1", upn: "owner@lab.example", displayName: "Real Owner" }],
      federatedCredentials: [{ name: "gh", issuer: "https://token.actions.githubusercontent.com", subject: "repo:x/y:ref:refs/heads/main", audiences: ["api://AzureADTokenExchange"] }],
    });
    try {
      const res = await msgraphService.getWorkloadIdentityPosture("tenant-contoso-01");
      expect(res.data?.owner.upn).toBe("owner@lab.example");
      expect(res.data?.federatedCredential.subject).toBe("repo:x/y:ref:refs/heads/main");
    } finally {
      apps.mockRestore();
      extra.mockRestore();
    }
  });

  test("Conditional Access: an empty grant stays empty (no defaulted Require MFA)", async () => {
    setMcpDataMode("real-tenant");
    const spy = spyOn(liveModule, "fetchAllConditionalAccessPoliciesLive").mockResolvedValue({
      policies: [{ id: "p1", displayName: "Session only", state: "enabled", createdDateTime: null, modifiedDateTime: null, includeGroups: [], excludeGroups: [], includeUsers: [], includeApplications: [], clientAppTypes: [], grantOperator: null, builtInControls: [] }],
      groupNamesById: new Map(),
    } as never);
    try {
      const res = await msgraphService.getConditionalAccessPolicies("tenant-contoso-01");
      expect(res.data[0]!.grant.builtInControls).toEqual([]);
      expect(res.data[0]!.blocks).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

