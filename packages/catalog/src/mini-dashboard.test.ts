import { describe, expect, test } from "bun:test";
import {
  COMPOSE_MINI_DASHBOARD_TOOL_NAME,
  ContextualMiniDashboardModelArgsSchema,
  ContextualMiniDashboardSchema,
  DataPtrSchema,
  SelectionDataPtrSchema,
  baseScenarioOf,
  customScenarioId,
  getComposeMiniDashboardToolDefinition,
  getScenarioEntry,
  isAnyScenarioId,
  isCustomScenarioId,
  parseSelectionPtr,
  registerCustomScenario,
  selectionDataPtr,
  selectionHash,
  unregisterCustomScenario,
} from "./index.ts";

const card = {
  id: "selection-abc12345",
  selectionText: "uncompliant device",
  title: "Non-Compliant Intune Devices Cohort",
  subtitle: "Live query across deviceManagement/managedDevices · 6 devices matched",
  sourceQuery: "GET /v1.0/deviceManagement/managedDevices?$filter=complianceState eq 'noncompliant'",
  provenanceCategory: "selection" as const,
  kpis: [
    { label: "Matched", value: "6 devices", tone: "critical" as const },
    { label: "In grace", value: "0", tone: "default" as const },
  ],
  breakdown: [
    { label: "NonCompliant", count: 6, pct: 100, tone: "critical" as const },
    { label: "Compliant", count: 0, pct: 0, tone: "success" as const },
  ],
  columns: [
    { key: "deviceName", label: "Device", mono: true },
    { key: "complianceState", label: "Compliance", isBadge: true },
  ],
  rowsPtr: "ptr://inc-4099/selection/abc12345",
  rows: [{ deviceName: "FAB-LT-01", complianceState: "NonCompliant" }],
  suggestedAction: { label: "Sync devices", scriptPreview: "Sync-MgDeviceManagementManagedDevice -ManagedDeviceId <id>", targetStepIndex: 1 },
};

describe("ContextualMiniDashboardSchema", () => {
  test("accepts a complete selection card", () => {
    const parsed = ContextualMiniDashboardSchema.safeParse(card);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.provenanceCategory).toBe("selection");
  });

  test("rejects out-of-range KPIs, bad tones, foreign provenance and malformed pointers", () => {
    expect(ContextualMiniDashboardSchema.safeParse({ ...card, kpis: [card.kpis[0]] }).success).toBe(false);
    expect(ContextualMiniDashboardSchema.safeParse({ ...card, kpis: [...card.kpis, ...card.kpis, card.kpis[0]] }).success).toBe(false);
    expect(ContextualMiniDashboardSchema.safeParse({ ...card, breakdown: [{ ...card.breakdown[0], tone: "rose" }, card.breakdown[1]] }).success).toBe(false);
    expect(ContextualMiniDashboardSchema.safeParse({ ...card, provenanceCategory: "intune" }).success).toBe(false);
    expect(ContextualMiniDashboardSchema.safeParse({ ...card, rowsPtr: "ptr://inc-4099/entra/users" }).success).toBe(false);
    expect(ContextualMiniDashboardSchema.safeParse({ ...card, selectionText: "" }).success).toBe(false);
  });

  test("the model-facing tool takes { dataPtr } for rows and never asks for the id or provenance", () => {
    const tool = getComposeMiniDashboardToolDefinition();
    expect(tool.function.name).toBe(COMPOSE_MINI_DASHBOARD_TOOL_NAME);
    const props = (tool.function.parameters as { properties: Record<string, any> }).properties;
    expect(Object.keys(props.rows.properties)).toEqual(["dataPtr"]);
    expect(props).not.toHaveProperty("id");
    expect(props).not.toHaveProperty("provenanceCategory");
    expect(ContextualMiniDashboardModelArgsSchema.safeParse({ ...card, rows: { dataPtr: card.rowsPtr } }).success).toBe(true);
  });

  test("selection pointers are deterministic, parse back and sit on the data plane", () => {
    const hash = selectionHash("INC-4099", "Uncompliant Device ");
    expect(hash).toBe(selectionHash("inc-4099", "uncompliant device"));
    expect(hash).not.toBe(selectionHash("INC-4092", "uncompliant device"));
    const ptr = selectionDataPtr("INC-4099", hash);
    expect(ptr).toBe(`ptr://inc-4099/selection/${hash}`);
    expect(SelectionDataPtrSchema.safeParse(ptr).success).toBe(true);
    expect(DataPtrSchema.safeParse(ptr).success).toBe(true);
    expect(parseSelectionPtr(ptr)).toEqual({ scenario: "inc-4099", hash });
    expect(parseSelectionPtr("ptr://inc-4099/entra/users")).toBeNull();
  });
});

describe("custom scenario registry", () => {
  test("CUSTOM-<hash> ids resolve to their base scenario once registered", () => {
    const id = customScenarioId("k3f9a1");
    expect(id).toBe("CUSTOM-K3F9A1");
    expect(isCustomScenarioId(id)).toBe(true);
    expect(isAnyScenarioId(id)).toBe(false);
    registerCustomScenario({
      scenarioId: id,
      kind: "ticket",
      origin: "unscripted",
      tenantId: "tenant-contoso-01",
      title: "Finance user cannot connect to AVD",
      remediationScope: "AVD NSG drift & E5 license state",
      components: ["EntraSignInTimeline", "IaCDriftBanner"],
      baseScenarioId: "INC-4092",
      shortHash: "k3f9a1",
      createdAt: "2026-10-27T10:00:00Z",
      ticket: { title: "t", body: "b" },
      extraction: { tenantId: "tenant-contoso-01", baseScenarioId: "INC-4092", intents: ["avd", "nsg"], entities: [], components: ["EntraSignInTimeline", "IaCDriftBanner"], rationale: "avd, nsg" },
    });
    expect(isAnyScenarioId(id)).toBe(true);
    expect(baseScenarioOf(id)).toBe("INC-4092");
    expect(baseScenarioOf("ANOM-CA-204")).toBe("ANOM-CA-204");
    expect(baseScenarioOf("CUSTOM-UNREGISTERED")).toBeNull();
    expect(baseScenarioOf("ERP-202699999")).toBeNull();
    expect(getScenarioEntry(id)?.components).toEqual(["EntraSignInTimeline", "IaCDriftBanner"]);
    expect(unregisterCustomScenario(id)).toBe(true);
    expect(isAnyScenarioId(id)).toBe(false);
    expect(baseScenarioOf(id)).toBeNull();
  });
});
