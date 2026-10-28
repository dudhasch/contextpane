/**
 * The one floating "Generate Context UI" bar's lifecycle, shared with the hover popovers
 * so a popover stays pinned only while the bar belongs to a selection inside it, and
 * re-checks its pending close the moment the bar goes away.
 */
export const SELECTION_BAR_EVENT = "contextpane:selection-bar";

interface SelectionBarState {
  /** The hover popover the selection was made in, or null for the ticket body. */
  anchor: Element | null;
}

let current: SelectionBarState | null = null;

export function getSelectionBar(): SelectionBarState | null {
  return current;
}

export function setSelectionBar(next: SelectionBarState | null) {
  current = next;
  window.dispatchEvent(new CustomEvent(SELECTION_BAR_EVENT, { detail: next }));
}

/** True while the bar is up for a selection made inside `popover`. */
export function selectionBarPins(popover: Element | null): boolean {
  const anchor = current?.anchor;
  return Boolean(popover && anchor && (popover === anchor || popover.contains(anchor) || anchor.contains(popover)));
}
