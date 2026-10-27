import { describe, expect, test } from "bun:test";
import { SCENARIO_IDS } from "@contextpane/catalog";
import { RUNBOOK_VERSION, generateRunbook, scrubPii } from "./runbook.ts";

const UPN_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/;

describe("runbook generator", () => {
  test("runbook sections for INC-4092", () => {
    const md = generateRunbook("INC-4092");
    expect(md).toContain("# Runbook: INC-4092");
    expect(md).toContain(RUNBOOK_VERSION);
    expect(md).toContain("Executive Root-Cause Summary");
    expect(md).toContain("Causal Timeline");
    expect(md).toContain("AVD-E3-SKU-Mismatch-With-Open-RDP");
    for (const label of ["T-18m", "T-14m", "T-06m", "NOW", "T+Fix"]) expect(md).toContain(label);
    expect(md).toContain("ptr://inc-4092/");
    expect(md).toContain("Formal Invariant Proofs");
    expect(md).toContain("break-glass-non-lockout");
    expect(md).toContain("target-remediation");
    expect(md).toContain("nsg-reachability");
    expect(md).toContain("Forward Remediation Script");
    expect(md).toContain("#Requires -Version 7.0");
    expect(md).toContain("SupportsShouldProcess");
    expect(md).toContain("ShouldProcess");
    expect(md).toContain("Inverse Rollback f^-1");
    // Inverse script comes from buildInverseRollback, scrubbed.
    expect(md).toContain("inverse rollback f^-1 for INC-4092");
  });

  test("every scenario: sections, timeline labels, 3 invariants, ptr://, no PII, deterministic", () => {
    for (const id of SCENARIO_IDS) {
      const md = generateRunbook(id);
      expect(md).toContain(`# Runbook: ${id}`);
      expect(md).toContain(`Runbook version: ${RUNBOOK_VERSION}`);
      expect(md).toContain("Executive Root-Cause Summary");
      expect(md).toContain("Causal Timeline");
      expect(md).toContain("T-18m");
      expect(md).toContain("T+Fix");
      expect(md).toContain("ptr://");
      expect(md).toContain("Formal Invariant Proofs");
      expect(md).toContain("Forward Remediation Script");
      expect(md).toContain("Inverse Rollback f^-1");
      expect(md).not.toMatch(UPN_RE);
      expect(md).not.toMatch(IP_RE);
      expect(generateRunbook(id)).toBe(md);
    }
  });

  test("scrubPii replaces UPNs and IPs/CIDRs", () => {
    const out = scrubPii("user someone@example.com from 10.0.0.1 and 10.20.0.0/16");
    expect(out).not.toMatch(UPN_RE);
    expect(out).not.toMatch(IP_RE);
    expect(out).toContain("upn_tok_redacted");
    expect(out).toContain("ip_tok_redacted");
  });

  test("unknown scenario throws", () => {
    expect(() => generateRunbook("NOPE-0000")).toThrow(/unknown scenarioId/);
    expect(() => generateRunbook("")).toThrow(/unknown scenarioId/);
    expect(() => generateRunbook("inc-4092")).toThrow(/unknown scenarioId/);
  });
});
