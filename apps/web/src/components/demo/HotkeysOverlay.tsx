import { Keyboard, X } from "lucide-react";
import { DEMO_HOTKEYS } from "@/lib/demo";
import { useWorkbench } from "@/store";
import { Kbd } from "../ui/Kbd";


export function HotkeysOverlay() {
  const open = useWorkbench((s) => s.hotkeysOpen);
  const setOpen = useWorkbench((s) => s.setHotkeysOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ground/80" onClick={() => setOpen(false)}>
      <div className="w-[560px] max-w-[95vw] animate-fade-in rounded-md border border-hairline bg-surface px-4 py-3 shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="size-4 text-signal" />
            <span className="text-13 font-semibold">Demo hotkeys</span>
            <span className="text-11 text-faint">every demo beat, no mouse precision required</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-faint hover:text-text" aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
        <table className="w-full text-12">
          <tbody>
            {DEMO_HOTKEYS.map((h) => (
              <tr key={h.key} className="border-t border-hairline-2">
                <td className="w-14 py-1.5">
                  <Kbd>{h.key}</Kbd>
                </td>
                <td className="py-1.5">{h.label}</td>
                <td className="py-1.5 text-right font-mono text-11 text-muted">{h.beat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
