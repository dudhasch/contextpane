import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * In-place clamp for long copy (WP8 fold): the element keeps its clamp class until the reader
 * expands it; `overflowing` says whether a "more" affordance is needed at all. Resets when `key`
 * changes (another ticket, a regenerated step).
 */
export function useClamp<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setExpanded(false);
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, expanded]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);
  return { ref, expanded, overflowing: expanded || overflowing, toggle };
}
