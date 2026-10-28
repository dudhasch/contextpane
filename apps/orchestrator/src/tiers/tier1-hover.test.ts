import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIO_IDS } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { config } = await import("../config.ts");
const { hoverScope } = await import("./tier1-hover.ts");
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
