import { describe, expect, test } from "bun:test";
import type { ScenarioListItem } from "@contextpane/catalog";
import { orderWorkItems } from "./workitem";

const item = (scenarioId: string, origin: ScenarioListItem["origin"], createdAt: string, custom = false): ScenarioListItem =>
  ({ scenarioId, origin, createdAt, displayId: scenarioId, kind: origin === "anomaly" ? "anomaly" : "ticket", tenantId: "tenant-contoso-01", tenantName: "Contoso", title: scenarioId, resolved: false, ...(custom ? { custom: {} } : {}) }) as unknown as ScenarioListItem;

describe("work queue order (P1-1)", () => {
  const items = [
    item("ANOM-LIC-101", "anomaly", "2026-10-26T06:05:00Z"),
    item("INC-4099", "psa", "2026-10-26T07:20:00Z"),
    item("INC-4092", "psa", "2026-10-26T08:11:00Z"),
    item("ERP-2026323", "erp-drop", "2026-10-28T18:09:56Z", true),
    item("CUSTOM-13E7NK", "unscripted", "2026-10-28T10:50:14Z", true),
  ];
  test("with the seeded chip on, INC-4092 is position 1 however many custom tickets are newer", () => {
    expect(orderWorkItems(items, {}, { pinSeeded: true }).map((i) => i.scenarioId)).toEqual(["INC-4092", "INC-4099", "ANOM-LIC-101", "ERP-2026323", "CUSTOM-13E7NK"]);
  });
  test("without it, newest first", () => {
    expect(orderWorkItems(items)[0]!.scenarioId).toBe("ERP-2026323");
  });
});
