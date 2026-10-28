import { useEffect } from "react";
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
      const s = useWorkbench.getState();
      // Ctrl+K / ⌘K: the work queue, from anywhere (inputs included).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setQueueOpen(!s.queueOpen);
        return;
      }
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      // Ctrl+. / ⌘.: collapse or expand the code rail.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === ".") {
        e.preventDefault();
        s.toggleCodeRail();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
          s.setComposerOpen(false);
          s.setQueueOpen(false);
          dispatchDemo({ kind: "close-popovers" });
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        // "7" is the Vision beat below; inside the open queue every digit 1-9 opens its row (WorkQueue onKey).
        case "8":
        case "9": {
          // Position in the unified queue (newest first, resolved last), as the popover numbers them.
          const item = s.orderedQueue()[Number(e.key) - 1];
          if (item) void s.selectScenario(item.scenarioId);
          break;
        }
        case "j":
          void s.stepQueue(1);
          break;
        case "k":
          void s.stepQueue(-1);
          break;
        case "q":
          s.setQueueOpen(!s.queueOpen);
          break;
        case "h": {
          const hero = brief?.entities.find((x) => x.type === "upn" && x.hoverable) ?? brief?.entities.find((x) => x.hoverable);
          if (hero) dispatchDemo({ kind: "hover", entityId: hero.id });
          break;
        }
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
        case "n":
          s.setComposerOpen(!s.composerOpen);
          break;
        case "c":
          dispatchDemo({ kind: "toggle-clarifier" });
          break;
        case "g":
          void s.simulateDrop();
          break;
        case "u": {
          const hero = brief?.entities.find((x) => x.type === "errorCode") ?? brief?.entities.find((x) => x.type === "resource") ?? brief?.entities[0];
          if (hero) void s.exploreSelection(hero.label || hero.id);
          break;
        }
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
