/**
 * Demo beat bus: hotkeys dispatch beats, components that own the UI for a
 * beat (an entity pill, the contract line) listen and act. Keeps the hotkey
 * layer free of refs into deep component trees.
 */
export type DemoBeat =
  | { kind: "hover"; entityId: string }
  | { kind: "toolbar"; lineId: string }
  | { kind: "codelens-diff" }
  | { kind: "close-popovers" };

const EVENT = "contextpane:demo";

export function dispatchDemo(beat: DemoBeat) {
  window.dispatchEvent(new CustomEvent<DemoBeat>(EVENT, { detail: beat, cancelable: true }));
}

/**
 * `claim()` lets exactly one listener own a beat (several pills can share an
 * entity id); it returns false when another listener already claimed it.
 */
export function onDemo(handler: (beat: DemoBeat, claim: () => boolean) => void): () => void {
  const listener = (e: Event) => {
    const ev = e as CustomEvent<DemoBeat>;
    handler(ev.detail, () => {
      if (ev.defaultPrevented) return false;
      ev.preventDefault();
      return true;
    });
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export const DEMO_HOTKEYS: Array<{ key: string; label: string; beat: string }> = [
  { key: "1", label: "Hover the affected UPN pill", beat: "UX 1 · Inline Hover Resolution (Tier 1A)" },
  { key: "2", label: "Select the E5 contract line", beat: "UX 2 · Semantic Floating Toolbar" },
  { key: "3", label: "Open the IaC drift diff", beat: "UX 3 · CodeLens · View Diff" },
  { key: "4", label: "Generate Fix & Stage PR", beat: "Tier 3 · muse-wonder + muse-code + sandbox" },
  { key: "5", label: "Approve & Execute (HITL)", beat: "Human-in-the-Loop approval" },
  { key: "6", label: "Switch tenant", beat: "Tier 0 · 0-token recipe hydration" },
  { key: "7", label: "Extract the ticket screenshot", beat: "Tier 2 · Vision (muse-spark-1.3)" },
  { key: "a", label: "Toggle the audit ledger", beat: "Tier 3 verifiable trail" },
  { key: "0", label: "Reset demo drift", beat: "Lab users back to SPE_E3 for the next take" },
  { key: "p", label: "Pin canvas as View Recipe", beat: "Persist layout, 0 tokens on next switch" },
  { key: "v", label: "Voice Steer", beat: "Muse Voice Transcribe → layout intent" },
  { key: "t", label: "Toggle router savings panel", beat: "Tokens / ms saved by Tier 0" },
  { key: "r", label: "Re-correlate (fresh)", beat: "Tier 1B/2 forced tool call" },
  { key: "Esc", label: "Close drawers & popovers", beat: "" },
  { key: "?", label: "This overlay", beat: "" },
];
