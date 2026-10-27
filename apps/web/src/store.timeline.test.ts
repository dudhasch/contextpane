import { describe, expect, test } from "bun:test";
import { LayoutSchema, type Layout } from "@contextpane/catalog";
import { applyTimelineSliceToLayout } from "./store";
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
      }
    }
  });
});
