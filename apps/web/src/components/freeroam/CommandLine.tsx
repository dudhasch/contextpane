import { FloatingPortal, autoUpdate, flip, offset, shift, useClick, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import { Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import type { ContextViewMode } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { CONTEXT_MODE_LIST, ContextModeIcon } from "../ui/ContextModeIcons";
import { OVERVIEW_PROMPT, QUICK_TENANT_CHIPS, TRY_CHIP_COUNT, type QuickChip } from "./chips";

const SCOPES = [
  { id: "hybrid", label: "Hybrid", title: "Tenant data via MCP plus cloud knowledge" },
  { id: "tenant-only", label: "Tenant", title: "Strict tenant MCP data only" },
  { id: "knowledge", label: "Knowledge", title: "Cloud, identity and security knowledge only" },
] as const;

/** Short visible labels for the inline "Try:" suggestions; the testid keeps the full chip label. */
const TRY_LABEL: Record<string, string> = {
  "Azure VMs (Get-AzVM)": "Azure VMs",
  "Users & License Drift": "License drift",
  "Workload Identities & OIDC": "Workload identities",
};

/**
 * Free-Roam command line (board D3): `✦` + one input + inline scope chips + `↵ open lens`, a refine row
 * for the newest lens once one is open, then either three "Try:" suggestions or the lens count line.
 */
export function CommandLine() {
  const scope = useWorkbench((s) => s.freeRoamScope);
  const setScope = useWorkbench((s) => s.setFreeRoamScope);
  const spawnDashboard = useWorkbench((s) => s.spawnFreeRoamDashboard);
  const stageRemediation = useWorkbench((s) => s.stageFreeRoamRemediation);
  const exploreStatus = useWorkbench((s) => s.exploreStatus);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const dashboards = useWorkbench((s) => s.freeRoamDashboards);
  const clearDashboards = useWorkbench((s) => s.clearFreeRoamDashboards);
  const [prompt, setPrompt] = useState("");
  const [refinement, setRefinement] = useState("");
  const [viewMode, setViewMode] = useState<ContextViewMode>("dashboard");
  const newest = dashboards[0];
  const loading = exploreStatus === "loading";
  const canSubmit = prompt.trim().length >= 2 || Boolean(newest && refinement.trim());

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = prompt.trim();
    const refine = refinement.trim();
    // A typed prompt opens a new lens (with the refinement as its constraint); a refinement alone re-opens the newest lens.
    const target = text.length >= 2 ? text : refine && newest ? newest.selectionText : "";
    if (!target) return;
    void spawnDashboard(target, { ...(refine ? { refinementText: refine } : {}), scope, viewMode });
    setPrompt("");
    setRefinement("");
  };

  const openChip = (chip: QuickChip) => void spawnDashboard(chip.prompt, { scope: "hybrid", viewMode: chip.viewMode });

  const stageNewest = () => {
    if (!newest) return;
    void stageRemediation({
      prompt: newest.selectionText,
      title: newest.card.title,
      ...(newest.card.suggestedAction.scriptPreview ? { scriptPreview: newest.card.suggestedAction.scriptPreview } : {}),
    });
  };

  return (
    <div className="shrink-0 border-b border-hairline px-4 pt-2.5 pb-1.5">
      <form onSubmit={submit} data-testid="free-roam-composer">
        <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface pr-1 pl-2.5 transition-colors focus-within:border-signal">
          <span aria-hidden className="shrink-0 text-13 leading-none text-signal">
            ✦
          </span>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask the tenant or a cloud question…"
            aria-label="Open a lens"
            data-testid="free-roam-prompt-input"
            className="h-full min-w-0 flex-1 bg-transparent text-13 text-text placeholder:text-faint focus:outline-none"
          />
          <div role="group" aria-label="Lens scope" className="flex shrink-0 items-center gap-0.5">
            {SCOPES.map((s) => {
              const active = scope === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(s.id)}
                  title={s.title}
                  data-testid={`free-roam-scope-${s.id}`}
                  className={`h-6 rounded px-1.5 text-12 transition-colors focus-visible:outline-2 focus-visible:outline-signal ${
                    active ? "bg-signal/12 text-signal-strong" : "text-muted hover:text-text"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <button
            type="submit"
            disabled={!canSubmit || loading}
            title="Open lens (Enter)"
            data-testid="free-roam-spawn-button"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-11 whitespace-nowrap text-muted transition-colors hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60 disabled:hover:bg-transparent"
          >
            {loading ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <span aria-hidden>↵</span>}
            open lens
          </button>
        </div>
        {newest && (
          <div className="flex h-7 min-w-0 items-center gap-2 pl-2.5 text-12">
            <span aria-hidden className="shrink-0 text-faint">
              ↳
            </span>
            <input
              type="text"
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
              placeholder={`Refine "${newest.card.title}"…`}
              aria-label="Refine the newest lens"
              data-testid="free-roam-refinement-input"
              className="h-6 min-w-0 flex-1 border-b border-hairline bg-transparent text-12 text-text placeholder:text-faint focus:border-signal focus:outline-none"
            />
          </div>
        )}
      </form>

      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 text-12">
        {dashboards.length === 0 ? (
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-faint">Try:</span>
            {QUICK_TENANT_CHIPS.slice(0, TRY_CHIP_COUNT).map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => openChip(chip)}
                title={chip.prompt}
                data-testid={`quick-tenant-chip-${chip.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="h-6 shrink-0 rounded px-1.5 whitespace-nowrap text-muted transition-colors hover:bg-raised hover:text-signal focus-visible:outline-2 focus-visible:outline-signal"
              >
                {TRY_LABEL[chip.label] ?? chip.label}
              </button>
            ))}
            <MoreSuggestions onOpen={openChip} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-11 text-faint">
              {dashboards.length} {dashboards.length === 1 ? "lens" : "lenses"} · newest first
            </span>
            <Button
              size="xs"
              variant="ghost"
              icon={<Wrench />}
              loading={remediateStatus === "loading"}
              onClick={stageNewest}
              title={`Stage a PowerShell 7 / Graph / Terraform action with pre-flight checks for "${newest?.card.title ?? ""}"`}
              data-testid="free-roam-stage-script-button"
            >
              Stage
            </Button>
            <Button size="xs" variant="ghost" icon={<Trash2 />} onClick={() => clearDashboards()} title="Close all open lenses">
              Clear
            </Button>
          </div>
        )}
        <div role="group" aria-label="Open the next lens as" className="ml-auto flex shrink-0 items-center gap-0.5">
          <span className="mr-0.5 text-11 text-faint">as</span>
          {CONTEXT_MODE_LIST.map((m) => {
            const active = viewMode === m.mode;
            return (
              <button
                key={m.mode}
                type="button"
                aria-pressed={active}
                aria-label={m.label}
                onClick={() => setViewMode(m.mode)}
                title={`Open the next lens as ${m.label}: ${m.hint}`}
                data-testid={`free-roam-mode-${m.mode}`}
                className={`grid size-6 place-items-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-signal ${
                  active ? "bg-signal/12 text-signal" : "text-faint hover:text-text"
                }`}
              >
                <ContextModeIcon mode={m.mode} className="size-3.5" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** "More…": the tenant posture overview and the tenant suggestions not shown inline. */
function MoreSuggestions({ onOpen }: { onOpen: (chip: QuickChip) => void }) {
  const spawnDashboard = useWorkbench((s) => s.spawnFreeRoamDashboard);
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: "menu" })]);
  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const row =
    "flex h-7 w-full min-w-0 items-center px-2.5 text-left text-12 text-text transition-colors hover:bg-ground hover:text-signal focus-visible:outline-2 focus-visible:outline-signal";

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={`h-6 shrink-0 rounded px-1.5 transition-colors hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal ${open ? "text-text" : "text-faint"}`}
        {...getReferenceProps()}
      >
        More…
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] w-[260px] animate-fade-in rounded-md bg-raised py-1 shadow-popover"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(() => void spawnDashboard(OVERVIEW_PROMPT, { scope: "hybrid", viewMode: "dashboard" }))}
              title={OVERVIEW_PROMPT}
              data-testid="free-roam-spawn-overview"
              className={row}
            >
              Tenant posture overview
            </button>
            {QUICK_TENANT_CHIPS.slice(TRY_CHIP_COUNT).map((chip) => (
              <button
                key={chip.label}
                type="button"
                role="menuitem"
                onClick={() => pick(() => onOpen(chip))}
                title={chip.prompt}
                data-testid={`quick-tenant-chip-${chip.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className={row}
              >
                <span className="truncate">{chip.label}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
