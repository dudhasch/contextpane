import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { SELECTION_BAR_EVENT, selectionBarPins } from "@/lib/selection-bar";

/**
 * Close policy for a hover popover whose text can be selected (EntityPill, role hovers).
 * A close request is deferred, not dropped, while
 * - a press that started inside the popover is still down (`selecting`: a drag that
 *   leaves the popover must not close it before mouseup), or
 * - the selection bar is up for a selection made inside this popover, or
 * - this popover holds the live selection;
 * and re-checked on document pointerup and when the selection bar unmounts, so an
 * outside click or a finished Generate closes it on the first try.
 */
export function usePopoverPinning(floating: MutableRefObject<HTMLElement | null>, close: () => void) {
  const selecting = useRef(false);
  const closePending = useRef(false);

  const pinned = useCallback(() => {
    const el = floating.current;
    if (!el) return false;
    if (selecting.current || selectionBarPins(el)) return true;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.toString().trim().length < 3) return false;
    return el.contains(sel.getRangeAt(0).commonAncestorContainer);
  }, [floating]);

  const requestClose = useCallback(() => {
    if (pinned()) {
      closePending.current = true;
      return;
    }
    closePending.current = false;
    close();
  }, [pinned, close]);

  /** The pointer came back (floating-ui reopened): forget the deferred close. */
  const cancelClose = useCallback(() => {
    closePending.current = false;
  }, []);

  useEffect(() => {
    const recheck = () => {
      if (closePending.current) requestClose();
    };
    const onPointerUp = () => {
      if (!selecting.current) return;
      selecting.current = false;
      // After the selection bar had a chance to mount for this mouseup.
      window.setTimeout(recheck, 0);
    };
    document.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener(SELECTION_BAR_EVENT, recheck);
    return () => {
      document.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener(SELECTION_BAR_EVENT, recheck);
    };
  }, [requestClose]);

  const onPointerDownCapture = useCallback(() => {
    selecting.current = true;
  }, []);

  return { requestClose, cancelClose, onPointerDownCapture };
}
