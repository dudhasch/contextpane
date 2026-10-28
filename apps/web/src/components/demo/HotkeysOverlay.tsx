import { Keyboard, X } from "lucide-react";
import { DEMO_HOTKEYS } from "@/lib/demo";
import { useWorkbench } from "@/store";
import { Kbd } from "../ui/Kbd";

/** Shell hotkeys listed right after the work-queue shortcut. */
const SHELL_HOTKEYS = [{ key: "Ctrl .", label: "Collapse / expand the code rail", beat: "Muse Code rail · ⌘. on macOS" }];
const queueIdx = DEMO_HOTKEYS.findIndex((h) => h.key === "Ctrl K") + 1;
const HOTKEYS = [...DEMO_HOTKEYS.slice(0, queueIdx), ...SHELL_HOTKEYS, ...DEMO_HOTKEYS.slice(queueIdx)];

export function HotkeysOverlay() {
  const open = useWorkbench((s) => s.hotkeysOpen);
  const setOpen = useWorkbench((s) => s.setHotkeysOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="w-[560px] animate-fade-in card shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="size-4 text-primary" />
            <span className="text-[13px] font-semibold">Demo hotkeys</span>
            <span className="text-[11px] text-faint">every demo beat, no mouse precision required</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-faint hover:text-text" aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
        <table className="w-full text-[12px]">
          <tbody>
            {HOTKEYS.map((h) => (
              <tr key={h.key} className="border-t border-border-subtle">
                <td className="w-14 py-1.5">
                  <Kbd>{h.key}</Kbd>
                </td>
                <td className="py-1.5">{h.label}</td>
                <td className="py-1.5 text-right font-mono text-[11px] text-muted">{h.beat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
