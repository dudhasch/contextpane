import { Building2, ChevronDown, HelpCircle, Mic, Pin, PinOff, PiggyBank, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { TENANT_IDS, TENANT_REGISTRY, type TenantId } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { TelemetryPills } from "./TelemetryPills";

export function TopBar() {
  const tenantId = useWorkbench((s) => s.tenantId);
  const setTenant = useWorkbench((s) => s.setTenant);
  const recipes = useWorkbench((s) => s.recipes);
  const activeRecipeId = useWorkbench((s) => s.activeRecipeId);
  const hydrateRecipe = useWorkbench((s) => s.hydrateRecipe);
  const pinRecipe = useWorkbench((s) => s.pinRecipe);
  const unpinRecipe = useWorkbench((s) => s.unpinRecipe);
  const correlate = useWorkbench((s) => s.correlate);
  const canvasStatus = useWorkbench((s) => s.canvasStatus);
  const voiceOpen = useWorkbench((s) => s.voiceOpen);
  const setVoiceOpen = useWorkbench((s) => s.setVoiceOpen);
  const savingsOpen = useWorkbench((s) => s.savingsOpen);
  const setSavingsOpen = useWorkbench((s) => s.setSavingsOpen);
  const setHotkeysOpen = useWorkbench((s) => s.setHotkeysOpen);
  const auditOpen = useWorkbench((s) => s.auditOpen);
  const setAuditOpen = useWorkbench((s) => s.setAuditOpen);
  const resetDrift = useWorkbench((s) => s.resetDrift);
  const resetting = useWorkbench((s) => s.resetting);

  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex shrink-0 items-center gap-2 pr-2">
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
          <Building2 className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">ContextPane</span>
        <span className="hidden text-[11px] text-faint 2xl:inline">MSP Workbench</span>
      </div>

      <label className="relative flex shrink-0 items-center">
        <select
          value={tenantId}
          onChange={(e) => void setTenant(e.target.value as TenantId)}
          className="h-7 appearance-none rounded-md border border-border bg-elevated pr-7 pl-2.5 font-mono text-[12px] text-text focus:outline-2 focus:outline-primary"
          aria-label="Tenant"
        >
          {TENANT_IDS.map((id) => (
            <option key={id} value={id}>
              {TENANT_REGISTRY[id].shortLabel}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" />
      </label>

      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <TelemetryPills />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <label className="relative hidden items-center xl:flex">
          <select
            value={activeRecipeId ?? ""}
            onChange={(e) => (e.target.value ? void hydrateRecipe(e.target.value) : unpinRecipe())}
            className="h-7 max-w-48 appearance-none truncate rounded-md border border-border bg-elevated pr-7 pl-2.5 text-[12px] text-text focus:outline-2 focus:outline-primary"
            aria-label="View recipe"
          >
            <option value="">Live correlation (model)</option>
            {recipes.map((r) => (
              <option key={r.recipeId} value={r.recipeId}>
                {r.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" />
        </label>
        {activeRecipeId ? (
          <Button variant="primary" icon={<PinOff />} onClick={unpinRecipe} title="Release the pinned recipe (p)">
            Pinned · 0 tokens
          </Button>
        ) : (
          <Button variant="outline" icon={<Pin />} onClick={() => void pinRecipe()} disabled={canvasStatus !== "ready"} title="Pin as View Recipe (p)">
            Pin as View Recipe <span className="hidden text-faint 2xl:inline">(0 Tokens)</span>
          </Button>
        )}
        <Button variant={voiceOpen ? "meta" : "outline"} icon={<Mic />} onClick={() => setVoiceOpen(!voiceOpen)} title="Voice Steer (v)">
          Voice Steer <span className="hidden text-faint 2xl:inline">(Muse Audio)</span>
        </Button>
        <Button variant={savingsOpen ? "primary" : "ghost"} icon={<PiggyBank />} onClick={() => setSavingsOpen(!savingsOpen)} title="Router savings (t)">
          <span className="hidden xl:inline">Savings</span>
        </Button>
        <Button variant={auditOpen ? "primary" : "ghost"} icon={<ShieldCheck />} onClick={() => setAuditOpen(!auditOpen)} title="Verifiable audit ledger (a)">
          <span className="hidden xl:inline">Audit</span>
        </Button>
        <Button
          variant="ghost"
          icon={<RotateCcw />}
          onClick={() => void resetDrift()}
          loading={resetting}
          title="Reset demo drift: Contoso lab users back to SPE_E3, remediation state cleared"
          aria-label="Reset demo drift"
          className="text-faint"
        />
        <Button variant="ghost" icon={<RefreshCw />} onClick={() => void correlate({ fresh: true })} loading={canvasStatus === "loading"} title="Re-correlate (r)" />
        <Button variant="ghost" icon={<HelpCircle />} onClick={() => setHotkeysOpen(true)} title="Demo hotkeys (?)">
          <Kbd>?</Kbd>
        </Button>
      </div>
    </header>
  );
}
