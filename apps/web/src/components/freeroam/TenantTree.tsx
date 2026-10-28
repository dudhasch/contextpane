import { ChevronRight, Radar, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { fmtTimeUtc } from "@/lib/format";
import type { FreeRoamCategory, FreeRoamEntityItem } from "@/lib/api";
import { displayInventoryItem } from "@/lib/pseudonym";
import { useWorkbench } from "@/store";
import { Stat } from "../canvas/Section";
import { Button } from "../ui/Button";
import { CONTEXT_MODE_META } from "../ui/ContextModeIcons";
import { QUICK_KNOWLEDGE_CHIPS } from "./chips";

/** Groups open on first render: enough to show live state without pushing the folds off a 900px screen. */
const DEFAULT_OPEN: Record<string, boolean> = {
  "azure-vms": true,
  users: true,
  "ca-policies": true,
  "workload-identities": true,
};

const STATUS_TEXT: Record<FreeRoamEntityItem["tone"], string> = {
  critical: "text-critical",
  warning: "text-warning",
  success: "text-muted",
  default: "text-faint",
};

/** Words that keep their capitals when a category title is sentence-cased. */
const PROPER = new Set(["Azure", "Entra", "Intune", "Microsoft"]);

/** "Azure Virtual Machines (Get-AzVM)" → "Azure virtual machines"; acronyms and product names keep their case. */
function groupTitle(raw: string): string {
  const base = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return base
    .split(" ")
    .map((w, i) => (i === 0 || PROPER.has(w) || /[A-Z].*[A-Z]|\d/.test(w) ? w : w.toLowerCase()))
    .join(" ")
    .replace(/conditional access/i, "Conditional Access");
}

/** Status word: "Secret Expired" → "secret expired", "NonCompliant" → "non-compliant"; identifiers (SPE_E5, 96%) unchanged. */
function statusWord(badge: string): { word: string; mono: boolean } {
  if (/^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/.test(badge)) return { word: badge.toLowerCase(), mono: false };
  if (/^[A-Z][a-z]+[A-Z][a-z]+$/.test(badge)) return { word: badge.replace(/([a-z])([A-Z])/, "$1-$2").toLowerCase(), mono: false };
  return { word: badge, mono: /[_\d%]/.test(badge) };
}

/**
 * Free-Roam context zone (board D3): tenant header, stat row, the collapsible MCP entity tree and,
 * pinned to the bottom, one fold with saved boards and the knowledge matrices.
 */
export function TenantTree() {
  const dataMode = useWorkbench((s) => s.dataMode);
  const inventory = useWorkbench((s) => s.freeRoamInventory);
  const inventoryStatus = useWorkbench((s) => s.freeRoamInventoryStatus);
  const loadInventory = useWorkbench((s) => s.loadFreeRoamInventory);
  const spawnDashboard = useWorkbench((s) => s.spawnFreeRoamDashboard);
  const scanAnomalies = useWorkbench((s) => s.scanAnomalies);
  const scanningAnomalies = useWorkbench((s) => s.scanningAnomalies);
  const [open, setOpen] = useState<Record<string, boolean>>(DEFAULT_OPEN);
  const summary = inventory?.summary;
  const modeWord = dataMode === "real-tenant" ? "live Graph & ARM" : "lab fixtures";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3.5 pt-1.5" data-testid="free-roam-explorer">
      <header className="shrink-0 pb-2">
        <div className="flex h-7 min-w-0 items-center gap-1.5">
          <h2 className="shrink-0 text-13 font-semibold text-text">{inventory?.tenant.displayName ?? "Tenant"}</h2>
          {inventory?.tenant.verifiedDomain && (
            <span className="min-w-0 truncate font-mono text-11 text-muted" title={inventory.tenant.verifiedDomain}>
              · {inventory.tenant.verifiedDomain}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => void loadInventory()}
              aria-label="Refresh tenant inventory"
              title="Refresh tenant inventory"
              className="grid size-6 place-items-center rounded text-faint transition-colors hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-signal"
            >
              <RefreshCw className={`size-3.5 ${inventoryStatus === "loading" ? "animate-spin" : ""}`} />
            </button>
            <Button
              size="xs"
              variant="ghost"
              icon={<Radar />}
              loading={scanningAnomalies}
              onClick={() => void scanAnomalies()}
              title="Scan Entra ID, Intune and Azure ARM for live anomalies and add findings to the work queue"
              data-testid="free-roam-scan-anomalies-button"
            >
              Scan tenant
            </Button>
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-11 whitespace-nowrap text-faint">
          <span
            data-testid="free-roam-canvas-datamode"
            className={dataMode === "real-tenant" ? "text-healthy" : "text-muted"}
            title={dataMode === "real-tenant" ? "Strict real tenant: Microsoft Graph & Azure ARM only, no simulated fallback" : "Simulated lab: seeded Contoso fixtures"}
          >
            {modeWord}
          </span>
          {inventory?.gatheredAt && (
            <>
              <span aria-hidden>·</span>
              <span title={inventory.gatheredAt}>{fmtTimeUtc(inventory.gatheredAt).slice(0, 5)}Z</span>
            </>
          )}
          {inventory && inventory.fallbackReasons.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate text-warning" title={inventory.fallbackReasons.join("\n")}>
                {inventory.fallbackReasons.length} fallback
              </span>
            </>
          )}
        </div>
        {summary && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <Stat label="Users">{summary.users}</Stat>
            <Stat label="CA policies">{summary.caPolicies}</Stat>
            <Stat label="SKU pools">{summary.skuPools}</Stat>
            <Stat label="ARM objects">{summary.azureResources + summary.azurePolicies}</Stat>
          </div>
        )}
      </header>

      <div className="-mx-3.5 shrink-0 divide-y divide-hairline-2 border-t border-hairline" data-testid="free-roam-entity-tree">
        {!inventory &&
          (inventoryStatus === "error" ? (
            <div className="px-3.5 py-2 text-12 text-critical">Tenant inventory failed to load.</div>
          ) : (
            <div className="space-y-1.5 px-3.5 py-2" aria-busy="true">
              <div className="h-3 w-2/3 animate-pulse rounded bg-raised" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-raised" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-raised" />
            </div>
          ))}
        {(inventory?.categories ?? []).map((cat) => (
          <TreeGroup
            key={cat.id}
            cat={cat}
            open={Boolean(open[cat.id])}
            onToggle={() => setOpen((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
            dataMode={dataMode}
            onOpenLens={(item) => void spawnDashboard(item.queryPrompt, { scope: "hybrid", viewMode: "dashboard" })}
          />
        ))}
      </div>

      <LibraryFold />
    </div>
  );
}

function TreeGroup({
  cat,
  open,
  onToggle,
  dataMode,
  onOpenLens,
}: {
  cat: FreeRoamCategory;
  open: boolean;
  onToggle: () => void;
  dataMode: string;
  onOpenLens: (item: FreeRoamEntityItem) => void;
}) {
  const source = cat.source === "seeded-manifest" ? "lab" : cat.source;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={cat.title}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 px-3.5 text-left text-12 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal"
      >
        <ChevronRight aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform duration-120 ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 truncate font-medium text-text">{groupTitle(cat.title)}</span>
        <span className="shrink-0 font-mono text-11 text-faint">
          · {cat.count} · <span className={cat.source.startsWith("live") ? "text-healthy" : ""}>{source}</span>
        </span>
      </button>
      {open && (
        <div className="pb-1">
          {cat.items.length === 0 ? (
            <div className="py-1 pr-3.5 pl-[34px] text-12 text-faint">No objects returned in this data mode.</div>
          ) : (
            cat.items.map((item) => {
              const shown = displayInventoryItem(item, cat, dataMode);
              const status = statusWord(item.badge);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenLens(item)}
                  title={`${shown.label}\n${shown.sublabel}\nOpen a lens`}
                  className="flex h-7 w-full min-w-0 items-center gap-2 pr-3.5 pl-[34px] text-left text-12 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal"
                >
                  <span className="max-w-[55%] shrink-0 truncate text-text">{shown.label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-11 text-muted">{shown.sublabel}</span>
                  <span className={`shrink-0 ${status.mono ? "font-mono text-11" : ""} ${STATUS_TEXT[item.tone]}`}>{status.word}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** One collapsed row pinned to the bottom of the zone: saved boards and the knowledge matrices. */
function LibraryFold() {
  const savedBoards = useWorkbench((s) => s.savedBoards);
  const dashboards = useWorkbench((s) => s.freeRoamDashboards);
  const saveBoard = useWorkbench((s) => s.saveCurrentFreeRoamBoard);
  const loadBoard = useWorkbench((s) => s.loadSavedFreeRoamBoard);
  const deleteBoard = useWorkbench((s) => s.deleteSavedFreeRoamBoard);
  const spawnDashboard = useWorkbench((s) => s.spawnFreeRoamDashboard);
  const [open, setOpen] = useState(false);
  const [boardName, setBoardName] = useState("");

  return (
    <section className="-mx-3.5 mt-auto shrink-0 border-t border-hairline" data-testid="free-roam-saved-boards">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1.5 px-3.5 text-left text-12 text-text transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal"
      >
        <ChevronRight aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform duration-120 ${open ? "rotate-90" : ""}`} />
        <span className="font-medium">Boards</span>
        <span className="font-mono text-11 text-faint">{savedBoards.length}</span>
        <span aria-hidden className="text-faint">·</span>
        <span className="font-medium">Knowledge matrices</span>
        <span className="font-mono text-11 text-faint">{QUICK_KNOWLEDGE_CHIPS.length}</span>
      </button>
      {open && (
        <div className="max-h-[40vh] overflow-y-auto pb-2">
          <div className="px-3.5 pt-1 text-11 font-semibold tracking-wider text-faint uppercase">Boards</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (dashboards.length === 0) return;
              saveBoard(boardName);
              setBoardName("");
            }}
            className="flex items-center gap-2 px-3.5 pl-[34px]"
          >
            <input
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="Board name"
              aria-label="Board name"
              className="h-6 min-w-0 flex-1 border-b border-hairline bg-transparent text-12 text-text placeholder:text-faint focus:border-signal focus:outline-none"
            />
            <Button type="submit" size="xs" variant="ghost" disabled={dashboards.length === 0} title="Save the open lenses as a board">
              Save {dashboards.length} {dashboards.length === 1 ? "lens" : "lenses"}
            </Button>
          </form>
          {savedBoards.map((b) => (
            <div key={b.id} className="group flex h-7 min-w-0 items-center gap-2 pr-2 pl-[34px] text-12 hover:bg-raised">
              <button
                type="button"
                onClick={() => loadBoard(b.id)}
                title={`Load board "${b.name}"`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-text hover:text-signal"
              >
                <span className="min-w-0 truncate">{b.name}</span>
                <span className="shrink-0 font-mono text-11 text-faint">{b.dashboards.length}</span>
              </button>
              <button
                type="button"
                onClick={() => deleteBoard(b.id)}
                aria-label={`Delete board ${b.name}`}
                title="Delete saved board"
                className="grid size-6 shrink-0 place-items-center rounded text-faint hover:text-critical focus-visible:outline-2 focus-visible:outline-signal"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}

          <div className="mt-2 px-3.5 text-11 font-semibold tracking-wider text-faint uppercase">Knowledge matrices</div>
          {QUICK_KNOWLEDGE_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => void spawnDashboard(chip.prompt, { scope: "knowledge", viewMode: chip.viewMode })}
              data-testid={`quick-knowledge-chip-${chip.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              title={chip.prompt}
              className="flex h-7 w-full min-w-0 items-center gap-2 pr-3.5 pl-[34px] text-left text-12 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal"
            >
              <span className="min-w-0 flex-1 truncate text-text">{chip.label}</span>
              <span className="shrink-0 text-11 text-faint">{CONTEXT_MODE_META[chip.viewMode].shortLabel}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
