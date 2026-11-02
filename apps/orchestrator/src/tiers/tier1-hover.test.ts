import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIO_IDS } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { config } = await import("../config.ts");
const { hoverScope, hoverCacheDecision, hoverContextDigest, invalidateHoverCache } = await import("./tier1-hover.ts");
const { gatherContext } = await import("../mcp/context.ts");
const { describeMetaModelResolution, STAND_INS } = await import("../router/meta-models.ts");

describe("Tier 1A hover cache scope (audit M-05)", () => {
  test("every Muse Glimmer seed answer is reachable from a scenario scope", () => {
    const seed = JSON.parse(readFileSync(join(config.dataDir, "hover-cache.seed.json"), "utf8")) as { entries: Record<string, { provider: string }> };
    const scopes = new Set(SCENARIO_IDS.map((id) => hoverScope(id)));
    const keys = Object.keys(seed.entries);
    expect(keys.length).toBeGreaterThanOrEqual(18);
    expect(keys.filter((k) => !scopes.has(k.split("|")[0]!))).toEqual([]);
    expect(hoverScope("INC-4092")).toBe("tenant-contoso-01");
    expect(hoverScope("INC-4099")).toBe("tenant-fabrikam-02");
    expect(hoverScope("ANOM-CA-204")).toBe("ANOM-CA-204");
  });

  test("the stand-in table is published, never silent", () => {
    const r = describeMetaModelResolution();
    expect(r.standIns).toEqual(STAND_INS);
    expect(r.standIns["muse-code"]).toBe("muse-wonder-1.0");
    expect(r.standIns["muse-glimmer-30b"]).toBe("muse-spark-1.3");
  });
});

describe("Tier 1A hover cache freshness (review item 5)", () => {
  test("an answer is served only for the context it was generated from; seed answers only in simulated-lab mode", () => {
    expect(hoverCacheDecision(undefined, "d1", false)).toBe("miss");
    expect(hoverCacheDecision({ contextDigest: "d1" }, "d1", true)).toBe("hit");
    expect(hoverCacheDecision({ contextDigest: "d1" }, "d2", false)).toBe("miss");
    expect(hoverCacheDecision({}, "d1", false)).toBe("pin");
    expect(hoverCacheDecision({}, "d1", true)).toBe("miss");
  });

  test("the digest follows tenant state, not the clock", async () => {
    const ctx = await gatherContext("INC-4092", { fresh: true });
    const upn = ctx.license?.data.users[0]?.upn;
    expect(upn).toBeDefined();
    const digest = hoverContextDigest(ctx, upn!, "upn");
    expect(hoverContextDigest(await gatherContext("INC-4092", { fresh: true }), upn!, "upn")).toBe(digest);
    // Re-stamped events (the fixtures stamp them relative to now) keep the digest.
    const restamped = { ...ctx, signIns: ctx.signIns ? { ...ctx.signIns, data: ctx.signIns.data.map((e) => ({ ...e, timestamp: "2030-01-01T00:00:00Z" })) } : ctx.signIns };
    expect(hoverContextDigest(restamped, upn!, "upn")).toBe(digest);
    // A changed licence row (what an approve writes) changes it.
    const fixed = { ...ctx, license: { ...ctx.license!, data: { ...ctx.license!.data, users: ctx.license!.data.users.map((u) => (u.upn === upn ? { ...u, driftStatus: u.driftStatus === "compliant" ? ("drifted" as const) : ("compliant" as const) } : u)) } } };
    expect(hoverContextDigest(fixed, upn!, "upn")).not.toBe(digest);
  });

  test("invalidation drops a scope's entries once", () => {
    invalidateHoverCache("INC-4092");
    expect(invalidateHoverCache("INC-4092")).toBe(0);
  });
});
