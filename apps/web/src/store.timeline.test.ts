import { describe, expect, test } from "bun:test";
import { LayoutSchema, type Layout } from "@contextpane/catalog";
import { applyTimelineSliceToLayout, useWorkbench } from "./store";
import { resolveOtherAffectedClients } from "./components/canvas/ActionApprovalDrawer";
import { shouldRenderCaBlockedBadge } from "./components/canvas/EntraSignInTimeline";
import type { TimelineSliceItem } from "./lib/api";

function buildIncidentLayout(): Layout {
  return LayoutSchema.parse({
    tenantId: "tenant-contoso-01",
    ticketId: "INC-4092",
    layoutId: "lay-timeline-test",
    generatedAt: "2026-10-26T08:10:00Z",
    provenance: { tier: "Tier 0", provider: "local", modelId: "deterministic", latencyMs: 1, tokensUsed: 0 },
    components: [
      {
        type: "EntraSignInTimeline",
        id: "entra-timeline",
        props: {
          headline: "3 Finance users blocked by CA-Contoso-Block-Legacy-Auth (53003)",
          focusUpn: "lynne.robins.contoso@c4a8shili.onmicrosoft.com",
          windowStart: "2026-10-26T07:00:00Z",
          windowEnd: "2026-10-26T08:15:00Z",
          rootCause: null,
          microActions: [],
          events: [
            {
              id: "ev-1",
              timestamp: "2026-10-26T08:09:41Z",
              upn: "lynne.robins.contoso@c4a8shili.onmicrosoft.com",
              displayName: "Lynne Robins",
              appDisplayName: "Azure Virtual Desktop",
              appId: "9cdead84-a844-4324-93f2-b2e6bb768d07",
              clientAppUsed: "Mobile Apps and Desktop clients",
              ipAddress: "198.51.100.42",
              location: "Zurich, CH",
              status: "failure",
              errorCode: 53003,
              errorCodeLabel: "AADSTS53003",
              failureReason: "Access has been blocked by Conditional Access policies.",
              conditionalAccessStatus: "failure",
              blockingPolicyName: "CA-Contoso-Block-Legacy-Auth",
              deviceCompliant: true,
              mfaSatisfied: true,
              isHighlighted: true,
            },
            {
              id: "ev-2",
              timestamp: "2026-10-26T08:06:12Z",
              upn: "diego.siciliani.contoso@c4a8shili.onmicrosoft.com",
              displayName: "Diego Siciliani",
              appDisplayName: "Azure Virtual Desktop",
              appId: "9cdead84-a844-4324-93f2-b2e6bb768d07",
              clientAppUsed: "Mobile Apps and Desktop clients",
              ipAddress: "198.51.100.43",
              location: "Zurich, CH",
              status: "failure",
              errorCode: 53003,
              errorCodeLabel: "AADSTS53003",
              failureReason: "Access has been blocked by Conditional Access policies.",
              conditionalAccessStatus: "failure",
              blockingPolicyName: "CA-Contoso-Block-Legacy-Auth",
              deviceCompliant: true,
              mfaSatisfied: true,
              isHighlighted: true,
            },
          ],
          policies: [],
          state: "critical",
        },
      },
    ],
  });
}

describe("applyTimelineSliceToLayout sign-in timestamp & badge honesty", () => {
  test("Before Issue (baseline) rewrites sign-in rows to pre-incident timestamps (<= 07:45 UTC), success status, and zero CA Blocked (53003) badges", () => {
    const baselineSlice: TimelineSliceItem = {
      id: "slice-baseline",
      kind: "baseline",
      label: "Before Issue (07:46)",
      relativeLabel: "T-18m",
      timestamp: "2026-10-26T07:46:00Z",
      validFrom: "2026-10-26T07:00:00Z",
      validTo: "2026-10-26T07:50:00Z",
      changedCardId: null,
      state: {
        summary: "Healthy baseline · 0 issues",
        health: "healthy",
        cards: [
          { cardId: "EntraSignInTimeline", status: "healthy", summary: "All AVD sign-ins succeeded" },
        ],
      },
    };

    const result = applyTimelineSliceToLayout(buildIncidentLayout(), baselineSlice);
    const signInCard = result.components.find((c) => c.type === "EntraSignInTimeline");
    expect(signInCard).toBeDefined();
    if (signInCard?.type === "EntraSignInTimeline") {
      expect(signInCard.props.state).toBe("healthy");
      expect(signInCard.props.events.length).toBe(2);
      for (const ev of signInCard.props.events) {
        expect(ev.status).toBe("success");
        expect(ev.errorCode).toBe(0);
        expect(ev.errorCodeLabel).toBe("AVD Sign-In OK · Compliant");
        expect(ev.errorCodeLabel).not.toContain("53003");
        expect(ev.blockingPolicyName).toBeUndefined();
        expect(ev.failureReason).toBeUndefined();
        expect(ev.timestamp <= "2026-10-26T07:45:00Z").toBe(true);
      }
    }
  });

  test("After Fix (Preview / counterfactual) rewrites sign-in rows to post-fix timestamps (>= 08:09:58Z), success status, and zero CA Blocked (53003) badges", () => {
    const previewSlice: TimelineSliceItem = {
      id: "slice-counterfactual",
      kind: "counterfactual",
      label: "After Fix (Preview)",
      relativeLabel: "T+Fix",
      timestamp: "2026-10-26T08:12:15Z",
      validFrom: "2026-10-26T08:12:15Z",
      validTo: null,
      changedCardId: null,
      state: {
        summary: "Preview after fix · All healthy",
        health: "healthy",
        cards: [
          { cardId: "EntraSignInTimeline", status: "healthy", summary: "All AVD sign-ins succeeded (SPE_E5)" },
        ],
      },
    };

    const result = applyTimelineSliceToLayout(buildIncidentLayout(), previewSlice);
    const signInCard = result.components.find((c) => c.type === "EntraSignInTimeline");
    expect(signInCard).toBeDefined();
    if (signInCard?.type === "EntraSignInTimeline") {
      expect(signInCard.props.state).toBe("healthy");
      for (const ev of signInCard.props.events) {
        expect(ev.status).toBe("success");
        expect(ev.errorCode).toBe(0);
        expect(ev.errorCodeLabel).toBe("AVD Sign-In OK (SPE_E5)");
        expect(ev.errorCodeLabel).not.toContain("53003");
        expect(ev.blockingPolicyName).toBeUndefined();
        expect(ev.timestamp >= "2026-10-26T08:09:58Z").toBe(true);
        expect(shouldRenderCaBlockedBadge(ev)).toBe(false);
      }
    }
  });

  test("shouldRenderCaBlockedBadge never renders a red CA Blocked badge when row.status === 'success'", () => {
    expect(shouldRenderCaBlockedBadge({ status: "success", errorCode: 53003, blockingPolicyName: "CA-Legacy" })).toBe(false);
    expect(shouldRenderCaBlockedBadge({ status: "success", errorCode: 0, blockingPolicyName: undefined })).toBe(false);
    expect(shouldRenderCaBlockedBadge({ status: "failure", errorCode: 53003, blockingPolicyName: "CA-Legacy" })).toBe(true);
  });

  test("resolveOtherAffectedClients filters out active tenant (Contoso Finance) and maps external affected peers accurately", () => {
    const fleet = {
      scenarioId: "INC-4092",
      signature: "AVD-E3-SKU-Mismatch-With-Open-RDP",
      affectedCount: 3,
      totalTenants: 5,
      tenants: [
        { tenantId: "tenant-contoso-01", tenantName: "Contoso Finance", affected: true, matchedSignals: ["SPE_E3"], affectedEntityCount: 3 },
        { tenantId: "tenant-fabrikam-02", tenantName: "Fabrikam Legal", affected: false, matchedSignals: [], affectedEntityCount: 0 },
        { tenantId: "tenant-northwind-03", tenantName: "Northwind Traders", affected: true, matchedSignals: ["SPE_E3"], affectedEntityCount: 1 },
        { tenantId: "tenant-tailspin-04", tenantName: "Tailspin Aerospace", affected: true, matchedSignals: ["SPE_E3"], affectedEntityCount: 1 },
        { tenantId: "tenant-woodgrove-05", tenantName: "Woodgrove Bank", affected: true, matchedSignals: ["SPE_E3"], affectedEntityCount: 1 },
      ],
    };
    const peers = resolveOtherAffectedClients(fleet, "Contoso Finance");
    expect(peers.map((p) => p.name)).not.toContain("Contoso Finance");
    expect(peers.map((p) => p.name)).toEqual(["Northwind Traders", "Tailspin Aerospace", "Woodgrove Bank"]);
    expect(peers.every((p) => p.badge === "1 issue · ✓ Safety Check Ready")).toBe(true);
  });

  test("B5 speculative selection cache promotes pre-warmed explore-selection with speculativeHit: true and fails closed on epoch bump", async () => {
    const state = useWorkbench.getState();
    const epoch = state.speculativeEpoch;
    const scenarioId = state.scenarioId;
    const key = `${scenarioId}:${epoch}:temporary rdp`;

    const mockCard = {
      id: "mini-speculative-test",
      selectedText: "temporary RDP",
      title: "Temporary RDP Rule Drift",
      subtitle: "Live Tenant Query · Matched in 0.4s",
      category: "azure" as const,
      tone: "critical" as const,
      viewMode: "dashboard" as const,
      summary: "Inbound TCP/3389 is open from * on nsg-contoso-avd-hostpool-01.",
      kpis: [{ label: "Open Port", value: "3389", tone: "critical" as const }],
      columns: [{ key: "ruleName", label: "Rule", mono: true }],
      rows: [{ ruleName: "Allow-Temp-RDP-Diagnostic-Drift" }],
      actions: [],
      dataPtr: "ptr://inc-4092/selection/mini-speculative-test",
      provenance: { tier: "Tier 0" as const, provider: "local" as const, modelId: "deterministic", latencyMs: 1, tokensUsed: 0 },
    };

    const mockResponse = {
      scenarioId,
      tenantId: "tenant-contoso-01",
      card: mockCard as any,
      dataPtr: "ptr://inc-4092/selection/mini-speculative-test",
      slice: {
        dataset: "iac/drift-diff",
        rowCount: 1,
        columns: ["ruleName"],
      },
      tier: "Tier 0",
      provider: "local",
      modelId: "deterministic",
      latencyMs: 180,
      tokenCount: 0,
    };

    useWorkbench.setState((s) => ({
      speculativeSelectionCache: {
        ...s.speculativeSelectionCache,
        [key]: {
          key,
          scenarioId,
          epoch,
          normalizedText: "temporary rdp",
          rawText: "temporary RDP",
          viewMode: "dashboard",
          status: "ready",
          startedAt: performance.now() - 120,
          resolvedAt: performance.now() - 10,
          promise: Promise.resolve(mockResponse as any),
          response: mockResponse as any,
        },
      },
    }));

    const t0 = performance.now();
    await useWorkbench.getState().exploreSelection("temporary RDP", { viewMode: "dashboard" });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(15);
    const promoted = useWorkbench.getState().miniDashboards.find((m) => m.id === "mini-speculative-test");
    expect(promoted).toBeDefined();
    expect(promoted?.speculativeHit).toBe(true);
    expect(useWorkbench.getState().kinematicMetrics.speculativeHits).toBeGreaterThanOrEqual(1);
    expect(useWorkbench.getState().kinematicMetrics.lastHitKind).toBe("explore-selection");

    // Bump epoch and verify cache is cleared (zero stale ABA promotion)
    const nextEpoch = useWorkbench.getState().bumpSpeculativeEpoch();
    expect(nextEpoch).toBeGreaterThan(epoch);
    expect(Object.keys(useWorkbench.getState().speculativeSelectionCache)).toHaveLength(0);
    expect(useWorkbench.getState().speculativeBuffer).toHaveLength(0);
  });
});
