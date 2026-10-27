/**
 * Demo beat bus: hotkeys dispatch beats, components that own the UI for a
 * beat (an entity pill) listen and act. Keeps the hotkey layer free of refs
 * into deep component trees.
 */
export type DemoBeat = { kind: "hover"; entityId: string } | { kind: "close-popovers" };

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
  { key: "1-9", label: "Open the work item at that position in the queue", beat: "One stream: tickets, anomalies, ERP drops, ad-hoc" },
  { key: "Ctrl K", label: "Open the work queue (search, origin filters)", beat: "Unified selector · q also toggles it" },
  { key: "j / k", label: "Next / previous work item", beat: "Step through the queue" },
  { key: "g", label: "🎲 Drop a random ERP ticket into input/tickets/", beat: "fs watcher → #2026xxx ingested in ~1 s" },
  { key: "h", label: "Hover the hero entity", beat: "Tier 1A · inline hover diagnostics" },
  { key: "e", label: "Run step 1 of the resolution plan", beat: "Left pane → card expands" },
  { key: "d", label: "Open the Terraform diff", beat: "IaC drift" },
  { key: "f", label: "Stage the fix", beat: "Tier 3 · plan, code, pre-flight, branch" },
  { key: "x", label: "Approve & Execute (HITL)", beat: "Delegated identity, cards turn emerald" },
  { key: "7", label: "Extract the ticket screenshot", beat: "Tier 2 · Vision (muse-spark-1.3)" },
  { key: "p", label: "Pin canvas as View Recipe", beat: "0 tokens on the next scenario switch" },
  { key: "v", label: "Voice Steer", beat: "Muse Voice Transcribe → layout intent" },
  { key: "t", label: "System & Audit · router savings", beat: "Tokens / ms saved by Tier 0" },
  { key: "a", label: "System & Audit · audit log", beat: "Verifiable trail" },
  { key: "0", label: "Reset demo drift", beat: "Every scenario back to its drifted state" },
  { key: "r", label: "Re-correlate (fresh)", beat: "Tier 1B/2 forced tool call" },
  { key: "n", label: "Triage an unscripted ticket", beat: "Paste any ticket → CUSTOM-<hash> triaged live" },
  { key: "u", label: "Generate Context UI for the hero phrase", beat: "Highlight any text → cyan mini-dashboard" },
  { key: "Esc", label: "Close drawers & popovers", beat: "" },
  { key: "?", label: "This overlay", beat: "" },
];
