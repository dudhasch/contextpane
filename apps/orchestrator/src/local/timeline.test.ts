import { describe, expect, test } from "bun:test";
import { SCENARIO_IDS } from "@contextpane/catalog";
import { getTimeline, getTimelineSlices } from "./timeline.ts";

describe("bi-temporal timeline", () => {
  test("every scenario has 4-5 ordered slices with contiguous valid intervals", () => {
    for (const scenarioId of SCENARIO_IDS) {
      const timeline = getTimeline(scenarioId);
      expect(timeline).not.toBeNull();
      expect(timeline!.scenarioId).toBe(scenarioId);
      expect(timeline!.tier).toBe(0);
      expect(timeline!.tokens).toBe(0);
      const slices = timeline!.slices;
      expect(slices.length).toBeGreaterThanOrEqual(4);
      expect(slices.length).toBeLessThanOrEqual(5);
      expect(slices.map((s) => s.kind)).toEqual(["baseline", "drift", "first-failure", "now", "counterfactual"]);
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i]!;
        expect(s.index).toBe(i);
        expect(s.timestamp).toBe(s.validFrom);
        expect(s.valid).toEqual([s.validFrom, s.validTo]);
        expect(s.tier).toBe(0);
        expect(s.tokens).toBe(0);
        expect(s.rehydration).toEqual({ tier: 0, tokens: 0, mode: "Tier0" });
        expect(s.state.cards.length).toBeGreaterThan(0);
        expect(Object.keys(s.state.statuses)).toEqual(s.state.entities.map((e) => e.id));
        if (i > 0) {
          expect(slices[i - 1]!.validTo).toBe(s.validFrom);
          expect(Date.parse(s.validFrom)).toBeGreaterThan(Date.parse(slices[i - 1]!.validFrom));
        }
      }
      expect(slices.at(-1)!.validTo).toBeNull();
      expect(slices.at(-1)!.counterfactual).toBe(true);
      expect(slices.slice(0, -1).every((s) => !s.counterfactual)).toBe(true);
      expect(slices[0]!.state.health).toBe("healthy");
      expect(slices[0]!.state.affectedEntities).toEqual([]);
      expect(slices.at(-1)!.state.health).toBe("healthy");
      expect(slices.at(-1)!.state.affectedEntities).toEqual([]);
    }
  });

  test("INC-4092 exact slices", () => {
    const slices = getTimelineSlices("INC-4092");
    expect(slices).toHaveLength(5);
    expect(slices.map((s) => [s.relativeLabel, s.timestamp, s.label])).toEqual([
      ["T-18m", "2026-10-26T07:46:00.000Z", "Healthy Baseline"],
      ["T-14m", "2026-10-26T07:50:00.000Z", "Out-of-Band NSG & Group Drift"],
      ["T-06m", "2026-10-26T07:58:00.000Z", "First Sign-In Failure"],
      ["NOW", "2026-10-26T08:04:00.000Z", "Active Incident"],
      ["T+Fix", "2026-10-26T08:12:00.000Z", "Counterfactual Post-Remediation"],
    ]);

    const [baseline, drift, failure, now, fix] = slices as [typeof slices[0], typeof slices[0], typeof slices[0], typeof slices[0], typeof slices[0]];
    expect(baseline.state.summary).toContain("15 SPE_E5 compliant");
    expect(baseline.state.summary).toContain("NSG clean");
    expect(baseline.state.summary).toContain("0 AADSTS53003");
    expect(baseline.state.statuses["AADSTS53003"]).toBe("0");

    expect(drift.state.summary).toContain("Allow-Temp-RDP-Diagnostic-Drift");
    expect(drift.state.summary).toContain("3389 open");
    expect(drift.state.summary).toContain("3 users");
    expect(drift.state.summary).toContain("SPE_E3");
    expect(drift.state.affectedEntities).toContain("Allow-Temp-RDP-Diagnostic-Drift");

    expect(failure.state.summary).toContain("lynne.robins");
    expect(failure.state.summary).toContain("AADSTS53003");
    expect(failure.state.summary).toContain("AVD");
    expect(failure.state.entities.some((e) => e.id.startsWith("lynne.robins") && e.status === "AADSTS53003")).toBe(true);

    expect(now.state.health).toBe("critical");
    expect(now.label).toBe("Active Incident");
    expect(fix.state.health).toBe("healthy");
    expect(fix.state.statuses["Allow-Temp-RDP-Diagnostic-Drift"]).toBe("removed");
  });

  test("changedCardId highlights the card that changed at each slice", () => {
    const inc = getTimelineSlices("INC-4092");
    expect(inc.map((s) => s.changedCardId)).toEqual([null, "IaCDriftBanner", "EntraSignInTimeline", "EntraSignInTimeline", "LicenseDriftCard"]);
    for (const scenarioId of SCENARIO_IDS) {
      const slices = getTimelineSlices(scenarioId);
      const cardIds = new Set(slices[0]!.state.cards.map((c) => c.cardId));
      expect(slices[0]!.changedCardId).toBeNull();
      for (const s of slices.slice(1)) {
        expect(s.changedCardId).not.toBeNull();
        expect(cardIds.has(s.changedCardId!)).toBe(true);
      }
    }
    // Generic scenarios highlight their own first/identity card, not INC-4092's.
    expect(getTimelineSlices("ANOM-LIC-101")[1]!.changedCardId).toBe("LicenseDriftCard");
    expect(getTimelineSlices("ANOM-CA-204")[2]!.changedCardId).toBe("EntraSignInTimeline");
    expect(getTimelineSlices("ANOM-INT-309")[1]!.changedCardId).toBe("IntuneDriftCard");
    expect(getTimelineSlices("INC-4099")[1]!.changedCardId).toBe("IntuneDriftCard");
  });

  test("generic scenarios derive slices from their own scenario data", () => {
    const lic = getTimelineSlices("ANOM-LIC-101");
    expect(lic[2]!.state.summary).toContain("CountViolation");
    expect(lic[3]!.state.summary).toContain("SPE_E5 CountViolation & orphaned licenses");
    const ca = getTimelineSlices("ANOM-CA-204");
    expect(ca[1]!.state.affectedEntities).toContain("CA-004-Block-Legacy-Auth");
    const int309 = getTimelineSlices("ANOM-INT-309");
    expect(int309[1]!.state.affectedEntities).toContain("SG-All-Workstations");
  });

  test("unknown scenario handling", () => {
    expect(getTimeline("NOPE-0000")).toBeNull();
    expect(getTimeline("")).toBeNull();
    expect(getTimeline("inc-4092")).toBeNull();
    expect(getTimelineSlices("NOPE-0000")).toEqual([]);
  });

  test("deterministic fresh copies (Tier 0 re-hydration)", () => {
    const a = getTimeline("INC-4092")!;
    const b = getTimeline("INC-4092")!;
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.slices[0]!.state.summary = "mutated";
    expect(getTimeline("INC-4092")!.slices[0]!.state.summary).not.toBe("mutated");
  });

  test("every slice (T-18m, T-14m, T-06m, NOW, T+Fix) populates non-empty state.cards and state.statuses with distinct healthy vs warning/critical states", () => {
    const slices = getTimelineSlices("INC-4092");
    expect(slices.map((s) => s.relativeLabel)).toEqual(["T-18m", "T-14m", "T-06m", "NOW", "T+Fix"]);
    for (const s of slices) {
      expect(s.state.cards.length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(s.state.statuses).length).toBeGreaterThanOrEqual(8);
    }
    expect(slices[0]!.state.cards.every((c) => c.status === "healthy")).toBe(true);
    expect(slices[4]!.state.cards.every((c) => c.status === "healthy")).toBe(true);
    expect(slices[1]!.state.cards.some((c) => c.status === "warning" || c.status === "critical")).toBe(true);
    expect(slices[2]!.state.cards.some((c) => c.status === "critical")).toBe(true);
    expect(slices[3]!.state.cards.some((c) => c.status === "critical")).toBe(true);
    expect(slices[0]!.state.cards.find((c) => c.cardId === "LicenseDriftCard")?.summary).toContain("5 of 5 users in SG-Contoso-Finance-AVD compliant on SPE_E5");
    expect(slices[4]!.state.cards.find((c) => c.cardId === "IaCDriftBanner")?.summary).toContain("0 rogue rules");
  });
});
