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

  test("each skill signature comes from its own scenario: ANOM-APP-401 carries no INC-4092 fields", async () => {
    const app = await compileSkill("ANOM-APP-401");
    expect(app.id).toBe("skill-anom-app-401-tier0");
    const sig = app.signature;
    expect(sig.requiredEntities).toEqual(expect.arrayContaining(["spn-contoso-erp-sync", "RoleManagement.ReadWrite.Directory", "Mail.ReadWrite", "alex.wilber@c4a8shili.onmicrosoft.com"]));
    expect(sig.errorCodes).toEqual(["AADSTS7000222"]);
    expect(sig.skus).toEqual([]);
    expect(sig.dataPtrs.every((p) => p.startsWith("ptr://anom-app-401/"))).toBe(true);
    const flat = JSON.stringify(sig);
    for (const leak of ["SG-Contoso-Finance-AVD", "SPE_E5", "SPE_E3", "ca-policy-001", "INC-4092", "inc-4092"]) expect(flat).not.toContain(leak);
    // Its Tier-0 layout is the sign-in timeline only, no borrowed license card.
    expect(app.hydrate().map((c) => c.type)).toEqual(["EntraSignInTimeline"]);

    expect(captureTrace("ANOM-CA-204").signature).toMatchObject({ policyIds: ["CA-001", "CA-004"], groupNames: expect.arrayContaining(["SG-BreakGlass-Accounts"]) });
    expect(captureTrace("ANOM-LIC-101").signature).toMatchObject({ errorCodes: ["CountViolation"], skus: ["SPE_E5"], groupNames: ["SG-Contoso-M365-E5"] });
    const intune = captureTrace("INC-4099").signature;
    expect(intune.errorCodes).toEqual(["0x87D1FDE8"]);
    expect(intune.policyIds).toContain("cfg-fab-legacy-bl");
    expect(captureTrace("ANOM-INT-309").signature.requiredEntities).toContain("./Vendor/MSFT/Firewall/MdmStore/DomainProfile/EnableFirewall");
    for (const id of ["INC-4099", "ANOM-INT-309", "ANOM-CA-204", "ANOM-LIC-101"]) {
      const r = await runPropertyFuzzer(id as "INC-4099", 20);
      expect(r.failures).toEqual([]);
    }
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
    expect(skill.invariantProofMask).toBe(0x7f);
    expect(skill.minPerturbationCost).toBeGreaterThan(0);
    expect(skill.schemaSignature).toContain("0x7f");
  });
});
