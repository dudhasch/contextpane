import { useEffect } from "react";
import { dispatchDemo } from "@/lib/demo";
import { useWorkbench } from "@/store";
import { isReadOnlyBundle, preflightGate } from "../components/shell/rail/shared";

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

      // Writes to the lab (drift reset) and to input/tickets/ (ERP drop) need Shift: a stray key only asks.
      // Shift+0 is matched on e.code because its e.key differs per keyboard layout (")" on US, "=" on DE).
      if (e.shiftKey && e.code === "Digit0") {
        e.preventDefault();
        void s.resetDrift();
        return;
      }
      if (e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        void s.simulateDrop();
        return;
      }

      switch (e.key) {
        case "?":
          s.setHotkeysOpen(!s.hotkeysOpen);
          break;
        case "Escape":
          s.setHotkeysOpen(false);
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
        case "x": {
          if (!s.drawer) break;
          s.setDrawerOpen(true);
          if (s.drawer.approval.state !== "pending") break;
          // Same gate as the Approve button: a failed pre-flight or invariant, a fix that is still
          // regenerating, or an already-resolved ticket is never approved from the keyboard.
          const gate = preflightGate(s.drawer, s.formal, s.remediateStatus);
          const resolved = Boolean(s.convergence[s.drawer.ticketId]);
          const regenerating = s.refiningGoal || s.remediateStatus === "loading";
          if (gate.blocked || regenerating || resolved) {
            s.toast({
              tone: "warning",
              title: "Not approved",
              detail: regenerating
                ? "The fix is being regenerated for the new scope."
                : resolved
                  ? "This ticket is already resolved; reopen it or reset drift to run the fix again."
                  : `Fix or override the pre-flight first: ${gate.reasons[0] ?? "verification failed"}`,
            });
            break;
          }
          if (s.dataMode === "real-tenant" && s.executionMode === "break-glass" && !s.simulateCanaryFailure && !isReadOnlyBundle(s.drawer)) {
            // Against the real tenant a break-glass approval is a live write: confirm it with a click.
            const approve = s.approve;
            s.toast({ tone: "warning", title: "Apply this fix now?", detail: "Break-glass writes to the real tenant now. Press Apply to confirm.", action: { label: "Apply", onClick: () => void approve("approve") } });
            break;
          }
          void s.approve("approve");
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
          s.toast({ tone: "info", title: "Drop a random ERP ticket?", detail: "Writes a ticket folder to input/tickets/. Shift+G skips this prompt.", action: { label: "Drop ticket", onClick: () => void s.simulateDrop() } });
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
          s.toast({ tone: "warning", title: "Reset demo drift?", detail: "Rewrites every scenario's lab objects to their drifted state. Shift+0 skips this prompt.", action: { label: "Reset drift", onClick: () => void s.resetDrift() } });
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
