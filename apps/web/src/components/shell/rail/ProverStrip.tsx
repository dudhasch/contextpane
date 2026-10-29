import { ChevronDown, ClipboardCopy, ShieldAlert, Undo2, Wrench, Zap } from "lucide-react";
import { useState } from "react";
import { useWorkbench } from "@/store";
import { Button } from "../../ui/Button";
import { Pill } from "../../ui/Pill";

/** Canary trace stage ids → words; the raw id stays in the tooltip. */
const CANARY_STAGE_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  CANARY_RING_0: "Canary ring 0",
  SYNTHETIC_PROBED: "Probed",
  CONVERGED: "Converged",
  AUTO_ROLLED_BACK: "Auto-rolled back",
};
import { RAIL_FRAME, RAIL_INSET_X, ScriptCode } from "./ScriptCode";
import { VERDICT_SHORT, VERDICT_TONE, blastSummarySentence, humanizeInvariant, useCopy, usePreflight, useRevertLabel, type Drawer } from "./shared";

/**
 * Always-visible prover strip under the rail tabs, framed as its own module: verdict, proof, blast
 * radius and undo as short status words on one row (`rollback-tab` expands it in place; the full
 * wording sits in each pill's title, and the row wraps instead of truncating), the canary trace on a
 * second line once a run reports one, and the pre-flight failure as an inline critical state with
 * Auto-Fix / Override.
 */
export function ProverStrip({ drawer }: { drawer: Drawer }) {
  const formal = useWorkbench((s) => s.formal);
  const drawerTab = useWorkbench((s) => s.drawerTab);
  const setDrawerTab = useWorkbench((s) => s.setDrawerTab);
  const codeRailTab = useWorkbench((s) => s.codeRailTab);
  const setCodeRailTab = useWorkbench((s) => s.setCodeRailTab);
  const preflight = usePreflight();
  const expanded = drawerTab === "formal" || drawerTab === "rollback";
  // Collapsing restores the drawer tab that matches the script on screen.
  const toggle = () => (expanded ? setCodeRailTab(codeRailTab) : setDrawerTab("formal"));

  const verdict = drawer.verificationStatus.verdict;
  const notProvable = formal?.formal.passed === null;
  const invariants = formal?.formal.invariants ?? [];
  const proven = invariants.filter((i) => i.passed).length;
  // Idempotency is null when no symbolic model checked a fixture transform (ad-hoc tickets, Free-Roam).
  const proofOk = formal?.formal.passed === true && formal.idempotency?.passed === true;
  // U-2: how many write-then-test turns the sandbox findings cost before this verdict.
  const repair = drawer.verificationStatus.repair;
  const iterations = repair?.iterations ?? 0;
  const targets = formal?.blastRadius.rows.find((r) => r.cohort === "target")?.entities.length;

  return (
    <div
      className={`${RAIL_INSET_X} mt-2 shrink-0 overflow-hidden ${RAIL_FRAME} bg-ground ${preflight.failed ? "!border-critical/50" : ""}`}
      data-strip={preflight.failed ? "critical" : "ok"}
      data-rail-frame="prover"
      data-testid="prover-strip"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        title={expanded ? "Collapse proof, blast radius and undo" : "Show proof, blast radius and undo"}
        data-testid="rollback-tab"
        className="flex min-h-[30px] w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1 text-left transition-colors duration-120 hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
      >
        <Pill
          variant="status"
          tone={VERDICT_TONE[verdict]}
          mono={false}
          className="shrink-0"
          title={
            iterations
              ? `Pre-flight: ${verdict} · ${iterations} repair iteration${iterations === 1 ? "" : "s"} (${drawer.verificationStatus.sandboxProvider})${repair?.exhausted ? " · budget exhausted" : ""}`
              : `Pre-flight: ${verdict}`
          }
        >
          {VERDICT_SHORT[verdict]}
          {iterations > 0 && (
            <span className="font-mono opacity-80" data-testid="verification-iterations">
              {" "}
              · {iterations} iter{repair?.exhausted ? " · exhausted" : ""}
            </span>
          )}
        </Pill>
        <Pill
          variant="status"
          tone={!formal || notProvable ? "muted" : proofOk ? "healthy" : "critical"}
          mono={false}
          className="shrink-0"
          title={
            !formal
              ? "Formal safety invariants: proving…"
              : notProvable
                ? "Formal safety invariants: no symbolic model for this ticket, so none is claimed"
                : `Formal safety invariants: ${proven} of ${invariants.length} proven`
          }
        >
          {!formal ? "proving…" : notProvable ? "not provable" : `${proven}/${invariants.length} proven`}
        </Pill>
        {formal && (
          <Pill
            variant="status"
            tone="healthy"
            mono={false}
            className="shrink-0"
            title={`Blast radius: ${blastSummarySentence(drawer.ticketId)}`}
          >
            {targets !== undefined ? `${targets} target${targets === 1 ? "" : "s"} · 0 collateral` : "0 collateral"}
          </Pill>
        )}
        {formal && (
          <Pill
            variant="status"
            tone={formal.rollback.powershellScript ? "healthy" : "warning"}
            mono={false}
            className="shrink-0"
            title={formal.rollback.powershellScript ? "1-click undo script ready" : "No undo script for this bundle"}
          >
            {formal.rollback.powershellScript ? "undo ready" : "no undo"}
          </Pill>
        )}
        <ChevronDown aria-hidden className={`ml-auto size-3.5 shrink-0 text-muted transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </button>

      <CanaryTrace />

      {preflight.failed && <PreflightFailure reasons={preflight.reasons} />}

      {expanded && <ProofDetail drawer={drawer} />}
    </div>
  );
}

/** `Health check: CANARY_0 → CANARY_1 → CONVERGED` on one mono line once a run reported stages. */
function CanaryTrace() {
  const canary = useWorkbench((s) => s.canary);
  const reverted = useWorkbench((s) => s.liveConsoleReverted || s.drawer?.approval.state === "rolled-back");
  if (!canary) return null;
  // Wording keyed on what executed: only a landed inverse restored anything in the tenant (HARD_CASES 6).
  const rolledBack = canary.rollbackExecuted
    ? "ROLLED_BACK · tenant restored from the pre-change snapshot"
    : canary.execution === "live-graph"
      ? "ROLLED_BACK · inverse staged, the live change is still in the tenant"
      : "ROLLED_BACK · drill, nothing was written live";
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2.5 pb-1.5 font-mono text-11 whitespace-nowrap" data-testid="canary-trace">
      <span className="shrink-0 font-sans text-faint">Health check</span>
      {reverted ? (
        <span className="truncate font-semibold text-warning" title={rolledBack} data-testid="canary-rolled-back">
          {rolledBack}
        </span>
      ) : (
        canary.stages.map((s, i) => (
          <span key={s.stage} className="inline-flex min-w-0 items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-faint">→</span>}
            <span
              className={`truncate ${
                s.stage === "AUTO_ROLLED_BACK" ? "font-semibold text-critical" : s.stage === "CONVERGED" ? "font-semibold text-healthy" : "text-muted"
              }`}
              title={s.stage}
            >
              {CANARY_STAGE_LABEL[s.stage] ?? s.stage}
            </span>
          </span>
        ))
      )}
    </div>
  );
}

/** Inline critical state: why the pre-flight failed, then Auto-Fix or an audited override. */
function PreflightFailure({ reasons }: { reasons: string[] }) {
  const autofixPreflight = useWorkbench((s) => s.autofixPreflight);
  const overridePreflight = useWorkbench((s) => s.overridePreflight);
  const toast = useWorkbench((s) => s.toast);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? reasons : reasons.slice(0, 2);

  const autofix = async () => {
    setBusy(true);
    await autofixPreflight();
    setBusy(false);
  };
  const override = async () => {
    if (justification.trim().length < 10) {
      toast({ tone: "warning", title: "Justification required", detail: "Write at least 10 characters explaining why this bundle may run anyway." });
      return;
    }
    setBusy(true);
    await overridePreflight(justification.trim());
    setBusy(false);
    setJustification("");
  };

  return (
    <div className="border-t border-critical/40 px-2.5 pt-1.5 pb-2" data-testid="preflight-failure-banner" role="alert">
      <div className="flex items-center gap-1.5 text-12 font-medium text-critical">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
        Pre-flight failed: fix or justify before running
      </div>
      <ul className="mt-0.5 space-y-0.5 text-12 text-critical-strong">
        {shown.map((r, i) => (
          <li key={i} className="line-clamp-2 break-words">
            {r}
          </li>
        ))}
      </ul>
      {reasons.length > 2 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-11 text-muted hover:text-text">
          {showAll ? "Show fewer" : `+${reasons.length - 2} more`}
        </button>
      )}
      <div className="mt-1.5 flex min-w-0 items-center gap-2">
        <Button size="xs" variant="primary" icon={<Wrench />} onClick={() => void autofix()} disabled={busy} data-testid="preflight-autofix-button">
          Auto-fix &amp; re-run
        </Button>
        <input
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Justification (audited)…"
          aria-label="Override justification"
          data-testid="preflight-override-justification"
          className="h-6 min-w-0 flex-1 rounded border border-hairline bg-ground px-2 text-11 text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-signal"
        />
        <Button size="xs" variant="outline" icon={<ShieldAlert />} onClick={() => void override()} disabled={busy} data-testid="preflight-override-button" className="text-warning">
          Override
        </Button>
      </div>
    </div>
  );
}

/** The old "Safety checks & undo" tab, in place under the strip: proof, blast radius, ASR check, undo script. */
function ProofDetail({ drawer }: { drawer: Drawer }) {
  const formal = useWorkbench((s) => s.formal);
  const compileSkill = useWorkbench((s) => s.compileSkill);
  const rollbackNow = useWorkbench((s) => s.rollbackNow);
  const revert = useRevertLabel();
  const copy = useCopy();

  if (!formal) {
    return <div className="border-t border-hairline-2 px-3 py-2 text-12 text-muted">Running pre-flight safety verification…</div>;
  }
  const b = formal.blastRadius;
  const asrBlast = formal.asrBlast ?? formal.formal.asrBlast ?? null;
  const notProvable = formal.formal.passed === null;

  return (
    <div className="max-h-[48vh] overflow-y-auto border-t border-hairline-2 animate-fade-in" data-testid="formal-proof">
      <section className="px-3 pt-2 pb-2.5">
        <div className="flex h-6 items-center gap-2">
          <span className="section-label text-faint">Pre-flight proof</span>
          <Button size="xs" variant="ghost" icon={<Zap />} className="ml-auto" onClick={() => void compileSkill()} title="Runs in <1ms automatically next time this issue happens">
            Save as auto-fix rule
          </Button>
        </div>
        {notProvable && (
          <p className="text-12 text-muted" data-testid="formal-not-provable">
            No symbolic model exists for this ticket ({formal.formal.note ?? "ad-hoc ticket"}), so no invariant is claimed. Rely on the pre-flight checks and the -WhatIf dry run.
          </p>
        )}
        <ul className="mt-1 space-y-1 text-12">
          {formal.formal.invariants.map((i) => (
            <li key={i.id} className="flex items-start gap-2">
              <span className={`shrink-0 font-semibold ${i.passed ? "text-healthy" : "text-critical"}`}>{i.passed ? "✓" : "✗"}</span>
              <span className="text-text">{humanizeInvariant(i.id, drawer.ticketId, i.statement)}</span>
            </li>
          ))}
          {!notProvable && formal.idempotency && (
            <li className="flex items-start gap-2">
              <span className={`shrink-0 font-semibold ${formal.idempotency.passed ? "text-healthy" : "text-critical"}`}>{formal.idempotency.passed ? "✓" : "✗"}</span>
              <span className="text-text">Safe to re-run: running it twice produces the same state</span>
            </li>
          )}
        </ul>
      </section>

      <section className="border-t border-hairline-2 px-3 pt-2 pb-2.5" data-testid="blast-radius">
        <div className="section-label text-faint">Blast radius</div>
        <p className="mt-0.5 text-12 text-muted">{blastSummarySentence(drawer.ticketId)}</p>
        <ul className="mt-1.5 text-12">
          {b.rows.map((r) => {
            const label =
              r.cohort === "target"
                ? `Affected targets (${r.entities.length})`
                : r.cohort === "break-glass"
                  ? `Break-Glass admins (${r.entities.length})`
                  : `Other tenant users (${r.entities.length})`;
            return (
              <li key={r.cohort} className="flex min-w-0 items-baseline gap-2 border-t border-hairline-2 py-1 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-text" title={label}>
                  {label}
                </span>
                <span className="min-w-0 truncate text-muted" title={`${r.before} → ${r.after}`}>
                  {r.before} <span className="text-faint">→</span> <span className="font-medium text-healthy">{r.cohort === "target" ? `${r.after} (restored)` : r.after}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {asrBlast && (
          <p className="mt-1.5 text-12 text-text" data-testid="asr-blast">
            <span className="font-medium text-warning">App compatibility:</span> {asrBlast.executions} legitimate runs of{" "}
            <span className="font-mono">{asrBlast.binary}</span> across {asrBlast.workstations} workstations; a scoped path exclusion is included.
          </p>
        )}
      </section>

      <RepairLoopTimeline drawer={drawer} />

      <section className="border-t border-hairline-2 pt-2 pb-3">
        <div className="flex h-6 items-center gap-1 px-3">
          <span className="section-label text-faint">1-click undo</span>
          <Button size="xs" variant="ghost" icon={<ClipboardCopy />} className="ml-auto" onClick={() => void copy(formal.rollback.powershellScript, "1-Click Undo script")}>
            Copy
          </Button>
          <Button size="xs" variant="ghost" icon={<Undo2 />} onClick={() => void rollbackNow()} title={revert.title}>
            {revert.label}
          </Button>
        </div>
        <p className="px-3 pb-1.5 text-12 text-muted">If anything goes wrong after applying, this script restores the exact previous state.</p>
        {/* R-7: the previous state is the drifted one; name the exposure the undo brings back. */}
        {formal.rollback.restores.some((r) => /rules\/tags->pre-state|Allow-Temp-RDP|3389/.test(r)) && (
          <p className="px-3 pb-1.5 text-12 text-warning" data-testid="undo-exposure-note">
            Undo re-opens TCP/3389 from any source on the host-pool NSG until the drift is fixed again.
          </p>
        )}
        <ScriptCode code={formal.rollback.powershellScript} name="rollback.ps1" maxHeight="max-h-64" inset="mx-3" />
      </section>
    </div>
  );
}

/** U-2: the write-then-test loop as a per-iteration timeline (sandbox findings → coder → sandbox again). */
function RepairLoopTimeline({ drawer }: { drawer: Drawer }) {
  const repair = drawer.verificationStatus.repair;
  if (!repair || repair.iterations === 0) return null;
  return (
    <section className="border-t border-hairline-2 px-3 pt-2 pb-2.5" data-testid="repair-loop-timeline">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="section-label text-faint">
          Write-then-test · {repair.iterations}/{repair.maxIterations} repair iteration{repair.iterations === 1 ? "" : "s"}
        </span>
        <span className={`ml-auto font-mono text-11 ${repair.exhausted ? "text-warning" : "text-healthy"}`}>
          {repair.exhausted ? "budget exhausted · findings left, verdict not forced" : `sandbox verdict: ${drawer.verificationStatus.verdict}`}
        </span>
      </div>
      <ol className="mt-1 text-12">
        {repair.rounds.map((r) => (
          <li key={r.iteration} className="border-t border-hairline-2 py-1 first:border-t-0">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 font-mono text-11">
              <span className="font-medium text-text">
                #{r.iteration} · {r.verdictBefore} → {r.verdictAfter}
              </span>
              <span className="text-faint">
                {r.source === "llm" ? `${r.modelId} · ${r.tokensUsed} tok · ${r.latencyMs} ms` : "coder offline"} · sandbox {r.preflightLatencyMs} ms{r.scriptChanged ? "" : " · script unchanged"}
              </span>
            </div>
            <ul className="mt-0.5 text-11 text-muted">
              {r.findingsBefore.slice(0, 3).map((finding, i) => (
                <li key={i} className="break-words">
                  ↳ {finding}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
