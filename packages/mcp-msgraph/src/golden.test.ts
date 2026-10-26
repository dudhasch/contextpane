import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Offline fixtures only: the tests never reach the lab tenant.
process.env.LIVE_CLOUD_MODE = "false";
const { CA_POSTURE } = await import("./fixtures.ts");
const { findRepoRoot } = await import("./manifest.ts");
const { msgraphService } = await import("./service.ts");

const root = findRepoRoot()!;
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

describe("golden-tenant baseline files", () => {
  test("are canonical JSON.stringify(_, null, 2) so live objects diff line by line", () => {
    const files = ["entra/conditional-access", "intune/win11", "intune/fabrikam"].flatMap((d) =>
      readdirSync(join(root, "golden-tenant", d)).map((f) => `golden-tenant/${d}/${f}`),
    );
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) expect(read(f)).toBe(`${JSON.stringify(JSON.parse(read(f)), null, 2)}\n`);
  });

  test("agree with the CA fixtures the drift is computed from", () => {
    for (const p of CA_POSTURE.policies) {
      const golden = JSON.parse(read(`golden-tenant/entra/conditional-access/${p.key}.json`));
      expect(golden.displayName).toBe(p.displayName);
      expect(golden.state).toBe(p.golden.state);
      expect(golden.conditions.users.excludeGroups).toEqual(p.golden.excludeGroups);
    }
  });
});

describe("CA and Intune drift carry line provenance", () => {
  test("ANOM-CA-204: each drifted field points at its golden lines; the diff restores them", async () => {
    const { data } = await msgraphService.getCaPosture("tenant-contoso-01");
    const drift = data.policies.flatMap((p) => p.drift);
    expect(drift.length).toBeGreaterThan(0);
    for (const d of drift) {
      expect(d.sourceRef?.file).toMatch(/^golden-tenant\/entra\/conditional-access\/CA-00[14]\.json$/);
      const line = read(d.sourceRef!.file).split("\n")[d.sourceRef!.startLine - 1]!;
      expect(line).toContain(d.field === "state" ? '"state"' : '"excludeGroups"');
    }
    expect(data.baselineDiff).toContain("+++ golden-tenant/entra/conditional-access/CA-001.json");
    expect(data.baselineDiff).toContain('+        "SG-BreakGlass-Accounts"');
    expect(data.baselineDiff).toContain('-  "state": "enabledForReportingButNotEnforced"');
  });

  test("ANOM-INT-309: the ASR rule cites asr-baseline.json and the duplicate assignment shows in the diff", async () => {
    const { data } = await msgraphService.getIntuneDrift("ANOM-INT-309");
    const asr = data.settings.find((s) => s.settingName.startsWith("ASR"))!;
    expect(asr.sourceRef?.file).toBe("golden-tenant/intune/win11/asr-baseline.json");
    expect(read(asr.sourceRef!.file).split("\n")[asr.sourceRef!.startLine - 1]).toContain("blockcredentialstealing");
    expect(data.baselineDiff).toContain('"blockcredentialstealingfromwindowslocalsecurityauthoritysubsystem": "audit"');
    expect(data.baselineDiff).toContain("+++ golden-tenant/intune/win11/assignments.json");
  });
});
