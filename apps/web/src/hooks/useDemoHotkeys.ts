import { useEffect } from "react";
import { SCENARIO_IDS } from "@contextpane/catalog";
import { dispatchDemo } from "@/lib/demo";
import { useWorkbench } from "@/store";

/**
 * Keyboard-driven demo mode. Every beat of the video is reachable without mouse
 * precision. Ignored while typing in inputs.
 */
export function useDemoHotkeys() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useWorkbench.getState();
      const brief = s.brief;

      switch (e.key) {
        case "?":
          s.setHotkeysOpen(!s.hotkeysOpen);
          break;
        case "Escape":
          s.setHotkeysOpen(false);
          s.setDrawerOpen(false);
          s.setDiffOpen(false);
          s.setVoiceOpen(false);
          s.setSystemOpen(false);
          dispatchDemo({ kind: "close-popovers" });
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          const scenarioId = SCENARIO_IDS[Number(e.key) - 1];
          if (scenarioId) void s.selectScenario(scenarioId);
          break;
        }
        case "h": {
          const hero = brief?.entities.find((x) => x.type === "upn" && x.hoverable) ?? brief?.entities.find((x) => x.hoverable);
          if (hero) dispatchDemo({ kind: "hover", entityId: hero.id });
          break;
        }
        case "m":
          void s.setMode(s.mode === "ticket" ? "anomaly" : "ticket");
          break;
        case "e": {
          const first = brief?.steps[0];
          if (first) s.runStep(first);
          break;
        }
        case "d":
          s.setDiffOpen(!s.diffOpen);
          break;
        case "f":
          s.openRemediation();
          break;
        case "x":
          if (s.drawer && s.drawer.approval.state === "pending") {
            s.setDrawerOpen(true);
            void s.approve("approve");
          } else if (s.drawer) {
            s.setDrawerOpen(true);
          }
          break;
        case "p":
          if (s.activeRecipeId) s.unpinRecipe();
          else void s.pinRecipe();
          break;
        case "v":
          s.setVoiceOpen(!s.voiceOpen);
          break;
        case "t":
          s.setSystemOpen(!s.systemOpen, "savings");
          break;
        case "a":
          s.setSystemOpen(!s.systemOpen, "audit");
          break;
        case "r":
          void s.correlate({ fresh: true });
          break;
        case "7": {
          const attachment = brief?.attachments[0];
          if (attachment) void s.extractVision(attachment);
          break;
        }
        case "0":
          void s.resetDrift();
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
