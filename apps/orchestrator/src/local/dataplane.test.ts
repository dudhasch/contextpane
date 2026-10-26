import { describe, expect, test } from "bun:test";
import { DATASETS, LayoutComponentSchema, dataPtr } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { gatherContext, contextForCorrelation } = await import("../mcp/context.ts");
const { publishDataPlane, resolveDataPtr } = await import("./dataplane.ts");
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
