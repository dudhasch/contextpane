import { describe, expect, test } from "bun:test";
import {
  GLOBAL_ADMIN_NODE,
  SHADOW_ADMIN_SCENARIO_ID,
  findShadowAdminPaths,
  scopeDiff,
  shadowAdminGraphPost,
  shadowAdminGraphPre,
  transitiveTier0ShadowAdmins,
} from "./shadow-admin.ts";

describe("ANOM-APP-401 shadow-admin privilege graph", () => {
  test("scenario id is the string ANOM-APP-401 (catalog-independent)", () => {
    expect(SHADOW_ADMIN_SCENARIO_ID).toBe("ANOM-APP-401");
    expect(shadowAdminGraphPre().scenarioId).toBe("ANOM-APP-401");
    expect(shadowAdminGraphPost().scenarioId).toBe("ANOM-APP-401");
  });

  test("pre graph: alex.wilber has 0 directory roles and owns the SPN", () => {
    const pre = shadowAdminGraphPre();
    const alex = pre.nodes.find((n) => n.id === "alex.wilber")!;
    expect(alex.kind).toBe("user");
    expect(alex.directoryRoles).toEqual([]);
    expect(alex.isAdmin).toBe(false);
    expect(pre.edges.some((e) => e.from === "alex.wilber" && e.to === "spn-contoso-erp-sync" && e.kind === "OWNS_APP")).toBe(true);
    const spn = pre.nodes.find((n) => n.id === "spn-contoso-erp-sync")!;
    expect(spn.scopes).toContain("RoleManagement.ReadWrite.Directory");
    expect(pre.nodes.find((n) => n.id === GLOBAL_ADMIN_NODE)?.tier).toBe(0);
  });

  test("pre: at least one shadow-admin path for alex within 3 hops", () => {
    const paths = findShadowAdminPaths(shadowAdminGraphPre());
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const alexPaths = paths.filter((p) => p.start === "alex.wilber");
    expect(alexPaths.length).toBeGreaterThanOrEqual(1);
    for (const p of alexPaths) {
      expect(p.hops).toBeLessThanOrEqual(3);
      expect(p.nodes[0]).toBe("alex.wilber");
      expect(p.nodes[p.nodes.length - 1]).toBe(GLOBAL_ADMIN_NODE);
      expect(p.end).toBe(GLOBAL_ADMIN_NODE);
    }
    expect(alexPaths[0]!.kinds).toEqual(["OWNS_APP", "ADD_CREDENTIAL", "ASSUME_SPN"]);
    // maxHops is honoured: the 3-hop path disappears with maxHops=2.
    expect(findShadowAdminPaths(shadowAdminGraphPre(), 2).filter((p) => p.start === "alex.wilber")).toEqual([]);
    expect(findShadowAdminPaths(shadowAdminGraphPre(), 3).length).toBeGreaterThanOrEqual(1);
  });

  test("pre transitive Tier 0 shadow admins is exactly alex (legit admin excluded)", () => {
    expect(transitiveTier0ShadowAdmins(shadowAdminGraphPre())).toEqual(["alex.wilber"]);
  });

  test("post: owner removed, grant revoked, scopes right-sized => transitive set EMPTY", () => {
    const post = shadowAdminGraphPost();
    expect(findShadowAdminPaths(post)).toEqual([]);
    expect(transitiveTier0ShadowAdmins(post)).toEqual([]);
    expect(post.edges.some((e) => e.kind === "OWNS_APP")).toBe(false);
    expect(post.edges.some((e) => e.kind === "ADD_CREDENTIAL" || e.kind === "ASSUME_SPN")).toBe(false);
    const spn = post.nodes.find((n) => n.id === "spn-contoso-erp-sync")!;
    expect(spn.scopes).toEqual(["User.Read.All", "Sites.Selected"]);
  });

  test("scope diff is exact", () => {
    expect(scopeDiff()).toEqual({
      remove: ["Directory.ReadWrite.All", "Sites.FullControl.All", "Mail.ReadWrite", "RoleManagement.ReadWrite.Directory"],
      add: ["User.Read.All", "Sites.Selected"],
      activityEvidence: ["GET /v1.0/users", "POST /v1.0/sites/{fin-site-id}/lists"],
    });
  });
});
