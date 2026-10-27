import { describe, expect, test } from "bun:test";
import { DATASETS, LayoutComponentSchema, dataPtr } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext, contextForCorrelation } = await import("../mcp/context.ts");
const { publishDataPlane, resolveDataPtr, pseudonymizeForLlm, createPiiVault } = await import("./dataplane.ts");
const { bindDataPlane } = await import("../tiers/tier2-correlate.ts");

describe("ptr:// data-plane bypass", () => {
  test("publishes every card dataset and resolves it by pointer", async () => {
    const ctx = await gatherContext("INC-4092", { fresh: true });
    const snapshot = publishDataPlane(ctx);
    const ptrs = snapshot.descriptors.map((d) => d.ptr);
    expect(ptrs).toContain("ptr://inc-4092/entra/users");
    expect(ptrs).toContain("ptr://inc-4092/entra/signins");
    expect(ptrs).toContain("ptr://inc-4092/iac/drift-diff");
    const users = resolveDataPtr("ptr://inc-4092/entra/users");
    expect(users.found).toBe(true);
    expect(Array.isArray(users.value)).toBe(true);
    expect(users.descriptor?.rowCount).toBe((users.value as unknown[]).length);
  });

  test("the correlation prompt carries descriptors, never rows or personal columns", async () => {
    const ctx = await gatherContext("INC-4092");
    const snapshot = publishDataPlane(ctx);
    const prompt = JSON.stringify(contextForCorrelation(ctx, snapshot.descriptors));
    const users = resolveDataPtr("ptr://inc-4092/entra/users").value as Array<{ upn: string }>;
    const ticketText = `${ctx.erp.ticket?.requester.upn} ${ctx.erp.ticket?.description}`.toLowerCase();
    for (const u of users.filter((x) => !ticketText.includes(x.upn.toLowerCase()))) expect(prompt).not.toContain(u.upn);
    expect(prompt).not.toContain("security_rule {");
    expect(prompt.length).toBeLessThan(snapshot.bytes);
    for (const d of snapshot.descriptors) expect(Object.keys(d.aggregates)).not.toContain("upn");
  });

  test("ptr:// v2 where/select/order + combined, over real users", async () => {
    const ctx = await gatherContext("INC-4092");
    publishDataPlane(ctx);
    const raw = resolveDataPtr("ptr://inc-4092/entra/users").value as Array<Record<string, any>>;
    const drifted = resolveDataPtr("ptr://inc-4092/entra/users?where=driftStatus:drifted");
    expect(drifted.found).toBe(true);
    expect(drifted.value).toEqual(raw.filter((r) => String(r.driftStatus).toLowerCase() === "drifted"));
    const projected = resolveDataPtr("ptr://inc-4092/entra/users?select=upn,currentSku,expectedSku&order=upn");
    expect(projected.found).toBe(true);
    for (const r of projected.value as any[]) expect(Object.keys(r)).toEqual(["upn", "currentSku", "expectedSku"]);
    expect((projected.value as any[]).map((r) => r.upn)).toEqual(raw.map((r) => r.upn).sort((a, b) => String(a).localeCompare(String(b))));
    const desc = resolveDataPtr("ptr://inc-4092/entra/users?order=-upn");
    expect((desc.value as any[]).map((r) => r.upn)).toEqual(raw.map((r) => r.upn).sort((a, b) => String(b).localeCompare(String(a))));
    const combined = resolveDataPtr("ptr://inc-4092/entra/users?where=driftStatus:drifted&select=upn,currentSku,expectedSku&order=upn");
    expect(combined.found).toBe(true);
    expect((combined.value as any[]).every((r) => Object.keys(r).length === 3)).toBe(true);
  });

  test("ptr:// v2 invalid query fails closed, plain ptr unchanged", async () => {
    const ctx = await gatherContext("INC-4092");
    publishDataPlane(ctx);
    for (const ptr of ["ptr://inc-4092/entra/users?where=nope:drifted", "ptr://inc-4092/entra/users?select=nope", "ptr://inc-4092/entra/users?order=nope", "ptr://inc-4092/entra/users?where=driftStatus=drifted", "ptr://inc-4092/entra/users?where=status:drifted"]) {
      const hit = resolveDataPtr(ptr);
      expect(hit.found).toBe(false);
      expect(hit.value).toEqual([]);
    }
    const plain = resolveDataPtr("ptr://inc-4092/entra/users");
    expect(plain.found).toBe(true);
    expect(Array.isArray(plain.value)).toBe(true);
  });

  test("PII vault: metrics, no raw UPN/IP in pseudonymized output, round-trip", async () => {
    const ctx = await gatherContext("INC-4092");
    const snapshot = publishDataPlane(ctx);
    expect(snapshot.piiMetrics.zeroRawPiiInLlmPrompt).toBe(true);
    expect(snapshot.piiMetrics.piiFieldsVaulted).toBeGreaterThan(0);
    expect(Object.keys(snapshot.piiMetrics.tokenMappings).length).toBe(snapshot.piiMetrics.piiFieldsVaulted);
    const hit = resolveDataPtr("ptr://inc-4092/entra/users");
    expect(hit.piiMetrics.piiFieldsVaulted).toBeGreaterThan(0);
    const users = hit.value as Array<{ upn: string }>;
    const safeJson = JSON.stringify(hit.pseudonymizedValue ?? pseudonymizeForLlm(users, snapshot.piiVault));
    for (const u of users) expect(safeJson).not.toContain(u.upn);
    expect(safeJson).toContain("upn_tok_01");
    const signins = resolveDataPtr("ptr://inc-4092/entra/signins");
    if (signins.found && Array.isArray(signins.value)) {
      const safe2 = JSON.stringify(signins.pseudonymizedValue);
      for (const e of signins.value as Array<{ ipAddress?: string; upn?: string }>) { if (e.ipAddress) expect(safe2).not.toContain(e.ipAddress); if (e.upn) expect(safe2).not.toContain(e.upn); }
    }
    const vault = createPiiVault();
    const input = [{ upn: "a@b.c", ipAddress: "1.2.3.4" }];
    const safe = vault.pseudonymize(input) as any[];
    expect(safe[0].upn).toBe("upn_tok_01");
    expect(safe[0].ipAddress).toBe("ip_tok_01");
    expect(vault.unvault("upn_tok_01")).toBe("a@b.c");
    expect(vault.depseudonymize(safe)).toEqual(input);
    expect(vault.metrics().piiFieldsVaulted).toBe(2);
  });

  test("binding replaces model pointers and inline rows with the data-plane rows", async () => {
    const ctx = await gatherContext("INC-4092");
    const snapshot = publishDataPlane(ctx);
    const raw = {
      tenantId: ctx.tenantId,
      ticketId: ctx.scenarioId,
      components: [
        {
          type: "LicenseDriftCard",
          id: "license-drift-card-inc-4092",
          props: {
            headline: "model headline",
            users: { dataPtr: dataPtr("INC-4092", "entra/users") },
            skuPools: { dataPtr: "ptr://anom-lic-101/entra/sku-pools" },
            groupErrors: [{ invented: true }],
          },
        },
      ],
    };
    const { raw: bound, binding } = bindDataPlane(raw, ctx, snapshot);
    const component = LayoutComponentSchema.parse((bound as { components: unknown[] }).components[0]);
    if (component.type !== "LicenseDriftCard") throw new Error(`unexpected ${component.type}`);
    expect(component.props.headline).toBe("model headline");
    expect(component.props.users).toEqual(snapshot.rows.get(dataPtr("INC-4092", "entra/users")) as never);
    expect(component.props.skuPools).toEqual(snapshot.rows.get(dataPtr("INC-4092", "entra/sku-pools")) as never);
    expect(binding.bound).toBe(3);
    expect(binding.rejected).toHaveLength(2);
    expect(component.dataPtrs[DATASETS["entra/users"].prop]).toBe("ptr://inc-4092/entra/users");
  });
});
