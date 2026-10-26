import { useEffect } from "react";
import { TENANT_IDS } from "@contextpane/catalog";
import { dispatchDemo } from "@/lib/demo";
import { useWorkbench } from "@/store";

/**
 * Keyboard-driven demo mode. Every beat of the 3-minute video is reachable
 * without mouse precision. Ignored while typing in inputs.
 */
export function useDemoHotkeys() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useWorkbench.getState();
      const requesterUpn = s.context?.ticket.requester.upn;
      const anchorLine = s.context?.contract.lines.find((l) => l.semanticAnchor)?.lineId ?? "L1";

      switch (e.key) {
        case "?":
          s.setHotkeysOpen(!s.hotkeysOpen);
          break;
        case "Escape":
          s.setHotkeysOpen(false);
          s.setDrawerOpen(false);
          s.setDiffOpen(false);
          s.setVoiceOpen(false);
          s.setSavingsOpen(false);
          s.setToolbarLine(null);
          dispatchDemo({ kind: "close-popovers" });
          break;
        case "1":
          if (requesterUpn) dispatchDemo({ kind: "hover", entityId: requesterUpn });
          break;
        case "2":
          s.setToolbarLine(s.toolbarLineId === anchorLine ? null : anchorLine);
          break;
        case "3":
          s.setDiffOpen(!s.diffOpen);
          break;
        case "4":
          void s.remediate();
          break;
        case "5":
          if (s.drawer && s.drawer.approval.state === "pending") {
            s.setDrawerOpen(true);
            void s.approve("approve");
          } else if (s.drawer) {
            s.setDrawerOpen(true);
          }
          break;
        case "6": {
          const next = TENANT_IDS[(TENANT_IDS.indexOf(s.tenantId) + 1) % TENANT_IDS.length]!;
          void s.setTenant(next);
          break;
        }
        case "p":
          if (s.activeRecipeId) s.unpinRecipe();
          else void s.pinRecipe();
          break;
        case "v":
          s.setVoiceOpen(!s.voiceOpen);
          break;
        case "t":
          s.setSavingsOpen(!s.savingsOpen);
          break;
        case "r":
          void s.correlate({ fresh: true });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
