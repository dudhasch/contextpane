import { describe, expect, test } from "bun:test";
import { fencedDataPtr, selectionDataPtr, selectionHash, type PointerFence } from "@contextpane/catalog";

// Offline fixtures only: the tests never reach the lab tenant, whatever .env.local says.
process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const { app } = await import("../app.ts");
const { gatherContext, invalidateContext } = await import("../mcp/context.ts");
const { publishDataPlane, publishSelection } = await import("./dataplane.ts");

/** The fence a client receives with a dataset's descriptor. */
const usersFence = (snap: { descriptors: Array<{ ptr: string; fence?: PointerFence }> }): PointerFence => snap.descriptors.find((d) => d.ptr === "ptr://inc-4092/entra/users")!.fence!;
const get = (ptr: string) => app.request(`/api/dataplane?ptr=${encodeURIComponent(ptr)}`);

describe("ptr:// fence enforcement on /api/dataplane", () => {
  test("a dataset pointer fenced to a previous epoch is a 409; the stale snapshot is not served after invalidateContext", async () => {
    const first = publishDataPlane(await gatherContext("INC-4092", { fresh: true }));
    const oldPtr = fencedDataPtr("INC-4092", "entra/users", usersFence(first));
    expect((await get(oldPtr)).status).toBe(200);

    invalidateContext("INC-4092");
    // The snapshot gathered before the bump is gone, not silently served.
    expect((await get("ptr://inc-4092/entra/users")).status).toBe(404);

    const second = publishDataPlane(await gatherContext("INC-4092", { fresh: true }));
    expect(second.epoch).toBeGreaterThan(first.epoch);
    const stale = await get(oldPtr);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { reason: string }).reason).toBe("stale-epoch");
    expect((await get("ptr://inc-4092/entra/users")).status).toBe(200);
    expect((await get(fencedDataPtr("INC-4092", "entra/users", usersFence(second)))).status).toBe(200);
  });

  test("a pointer fenced to another tenant is a 409", async () => {
    const snap = publishDataPlane(await gatherContext("INC-4092", { fresh: true }));
    const res = await get(fencedDataPtr("INC-4092", "entra/users", { ...usersFence(snap), tenantId: "tenant-fabrikam-02" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("cross-tenant");
  });

  test("a selection published under a previous epoch is a 409 after the scenario is invalidated", async () => {
    const snap = publishDataPlane(await gatherContext("INC-4092", { fresh: true }));
    const ptr = selectionDataPtr("INC-4092", selectionHash("INC-4092", "fence test selection"));
    const pub = publishSelection({ ptr, scenarioId: "INC-4092", selectedText: "lynne", sourceQuery: "test", rows: [{ id: 1 }], tenantId: snap.tenantId });
    expect(pub.fence).toEqual({ tenantId: snap.tenantId, epoch: snap.epoch, generation: expect.any(Number) });
    expect((await get(ptr)).status).toBe(200);

    invalidateContext("INC-4092");
    const stale = await get(ptr);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { reason: string }).reason).toBe("stale-epoch");
  });
});
