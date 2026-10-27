import { describe, expect, test } from "bun:test";
import { validateComponents } from "@contextpane/catalog";
import {
  captureTrace, compileFromTrace, compileSkill, compileToTier0Skill,
  listCompiledSkills, lookupTier0Skill, matchCompiledSkill, runPropertyFuzzer,
} from "./skill-compiler.ts";

describe("Tier3->Tier0 skill compiler (unit, POST-compile logic)", () => {
  test("captureTrace rejects invalid scenario, accepts INC-4092", () => {
    expect(() => captureTrace("NOPE-0000")).toThrow(/Invalid trace/);
    const t = captureTrace("INC-4092");
    expect(t.scenarioId).toBe("INC-4092");
    expect(t.components).toContain("LicenseDriftCard");
    expect(t.signature.scenarioId).toBe("INC-4092");
  });

  test("invalid trace rejection", async () => {
    await expect(compileFromTrace(null)).rejects.toThrow(/Invalid trace/);
    await expect(compileFromTrace({ scenarioId: "BAD", components: ["LicenseDriftCard"], signature: { scenarioId: "BAD" } })).rejects.toThrow(/Invalid trace/);
    await expect(compileFromTrace({ scenarioId: "INC-4092", components: [], signature: { scenarioId: "INC-4092" } })).rejects.toThrow(/Invalid trace/);
    await expect(compileSkill("BAD-ID")).rejects.toThrow(/Invalid trace/);
  });

  test("property fuzzer: 100/100 Zod-valid + formal invariants", async () => {
    const r = await runPropertyFuzzer("INC-4092", 100);
    expect(r.cases).toBe(100);
    expect(r.passed).toBe(100);
    expect(r.failures).toEqual([]);
  });

  test("compile promotes to Tier0 registry and lookup matches in <2ms", async () => {
    const skill = await compileToTier0Skill("INC-4092");
    expect(skill.tier).toBe(0);
    expect(skill.tokenCost).toBe(0);
    expect(skill.fuzz).toEqual({ cases: 100, passed: 100 });
    expect(skill.id).toContain("inc-4092");
    // hydrate produces Zod-valid layout
    const layout = skill.hydrate();
    expect(validateComponents(layout).rejected).toEqual([]);
    expect(skill.remediate().scenarioId).toBe("INC-4092");
    // registry promotion + match
    expect(listCompiledSkills().some((s) => s.id === skill.id)).toBe(true);
    const hit = lookupTier0Skill(skill.signature);
    expect(hit?.skill.id).toBe(skill.id);
    expect(hit!.latencyMs).toBeLessThan(2);
    expect(matchCompiledSkill({ scenarioId: "INC-4092" })?.id).toBe(skill.id);
    expect(matchCompiledSkill({ scenarioId: "INC-4099" })).toBeNull();
    expect(skill.match(skill.signature)).toBe(true);
    expect(skill.match({ scenarioId: "INC-4099" })).toBe(false);
    // compileSkill alias path also works deterministically (same id/signature)
    const again = await compileSkill("INC-4092");
    expect(again.id).toBe(skill.id);
    expect(again.signature).toEqual(skill.signature);
  });
});
