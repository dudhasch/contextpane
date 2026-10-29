import { Activity, Cable, Cpu, Gauge, GitPullRequest, PiggyBank, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type DynamicCatalogResponse } from "@/lib/api";
import { PROVIDER_LABEL, TIER_COLOR, TIER_ROUTE, fmtMs, fmtTokens, humanizeSource } from "@/lib/format";
import { useWorkbench, type SystemTab } from "@/store";
import { CODE_RAIL_COLLAPSED_PX, CODE_RAIL_OPEN_PX } from "../shell/CodeRail";
import { Button } from "../ui/Button";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { AuditLogBody } from "./AuditLog";
import { RouterSavingsBody } from "./RouterSavings";

/** One drawer for everything that is not the technical state of the scenario: router savings, audit ledger, providers. */
export function SystemAuditDrawer() {
  const open = useWorkbench((s) => s.systemOpen);
  const codeRailOpen = useWorkbench((s) => s.codeRailOpen);
  const tab = useWorkbench((s) => s.systemTab);
  const setOpen = useWorkbench((s) => s.setSystemOpen);
  const loadDrawerExtras = useWorkbench((s) => s.loadDrawerExtras);
  const [catalog, setCatalog] = useState<DynamicCatalogResponse | null>(null);

  const loadCatalog = () => {
    api
      .dynamicCatalog()
      .then((res) => setCatalog(res))
      .catch(() => undefined);
  };

  useEffect(() => {
    if (open) {
      void loadDrawerExtras();
      loadCatalog();
    }
  }, [open, loadDrawerExtras]);

  if (!open) return null;
  const elements = catalog?.catalog?.dynamicElements ?? [];
  // Docks against the code rail's hairline whatever the rail is doing, so the rail stays usable.
  const railPx = (codeRailOpen ? CODE_RAIL_OPEN_PX : CODE_RAIL_COLLAPSED_PX) + 1;
  return (
    <div className="fixed top-12 bottom-0 left-0 z-50 flex justify-end bg-ground/40" style={{ right: railPx }} onClick={() => setOpen(false)}>
      <aside
        className="flex h-full w-[600px] max-w-full animate-slide-in-right flex-col border-l border-hairline bg-surface shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-4">
          <Activity className="size-4 text-signal" />
          <span className="text-13 font-semibold">System &amp; audit</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex h-8 shrink-0 items-stretch gap-4 border-b border-hairline px-4">
          <Tab id="savings" active={tab} icon={<PiggyBank />} label="Router savings" />
          <Tab id="audit" active={tab} icon={<ShieldCheck />} label="Audit log" />
          <Tab id="providers" active={tab} icon={<Cable />} label="Providers & MCP" />
          <Tab id="skills" active={tab} icon={<Sparkles />} label="Skills & PII vault" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
          {tab === "savings" && <RouterSavingsBody />}
          {tab === "audit" && <AuditLogBody />}
          {tab === "providers" && <ProvidersBody />}
          {tab === "skills" && <SkillsPiiBody />}
          <SynthesizedElementsLedgerSection catalog={catalog} onRefresh={loadCatalog} />
          <OmegaPrimeTelemetrySection catalogCount={elements.filter((el) => el.synthesizerModel !== "deterministic-template").length} />
        </div>
      </aside>
    </div>
  );
}

function SynthesizedElementsLedgerSection({
  catalog,
  onRefresh,
}: {
  catalog: DynamicCatalogResponse | null;
  onRefresh: () => void;
}) {
  const [clearing, setClearing] = useState(false);
  const toast = useWorkbench((s) => s.toast);

  const handleClear = async () => {
    setClearing(true);
    try {
      const res = await api.clearDynamicCatalog();
      onRefresh();
      toast({
        tone: "info",
        title: `Cleared ${res.removed} synthesized UI element${res.removed === 1 ? "" : "s"}`,
        detail: "data/dynamic-catalog.json reset to 0 runtime elements.",
      });
    } catch (e) {
      toast({ tone: "critical", title: "Failed to clear dynamic catalog", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setClearing(false);
    }
  };

  const elements = catalog?.catalog?.dynamicElements ?? [];
  // A template card was built without a model call; only the rest are syntheses (L-03).
  const isTemplate = (el: { synthesizerModel: string }) => el.synthesizerModel === "deterministic-template";
  const synthesizedCount = elements.filter((el) => !isTemplate(el)).length;

  return (
    <section className="border-t border-hairline pt-3 text-12" data-testid="synthesized-elements-ledger">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="section-label">
          Synthesized UI elements · k={synthesizedCount}
          {elements.length > synthesizedCount ? ` · ${elements.length - synthesizedCount} template` : ""}
        </span>
        {elements.length > 0 && (
          <button
            type="button"
            disabled={clearing}
            onClick={() => void handleClear()}
            data-testid="clear-synthesized-elements"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-11 text-critical transition-colors hover:bg-raised disabled:opacity-50"
          >
            <Trash2 className="size-3" />
            Clear synthesized elements
          </button>
        )}
      </div>
      <div className="mb-1.5 text-11 text-faint">
        Gatekeeper → synthesizer per element (a <span className="font-mono">deterministic-template</span> entry made no model call) · persisted in{" "}
        <span className="font-mono">data/dynamic-catalog.json</span>
      </div>
      {elements.length === 0 ? (
        <div className="text-muted">
          No runtime-synthesized elements yet. Submit an unscripted ticket outside the 6 built-in cards to trigger stage 1 (muse-spark-1.3) → stage 2 (muse-wonder-1.0) synthesis.
        </div>
      ) : (
        <ul className="divide-y divide-hairline-2 border-y border-hairline-2">
          {elements.map((el) => (
            <li key={el.elementId} className="py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="font-mono text-12 text-text">&lt;{el.elementId} /&gt;</span>
                <span className="font-mono text-11 text-faint" title={`gatekeeper: ${el.gatekeeperModel}`}>
                  {isTemplate(el) ? "template · no model call" : el.synthesizerModel} · used {el.reuseCount}×
                </span>
              </div>
              <div className="text-text">{el.title}</div>
              <div className="text-muted">{el.reason}</div>
              <div className="font-mono text-11 text-faint">{el.tsxStubPath}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OmegaPrimeTelemetrySection({ catalogCount }: { catalogCount: number }) {
  const brief = useWorkbench((s) => s.brief);
  const layout = useWorkbench((s) => s.layout);
  const pii = useWorkbench((s) => s.piiMetrics);
  const kinematic = useWorkbench((s) => s.kinematicMetrics);
  const speculativeBuffer = useWorkbench((s) => s.speculativeBuffer);

  const subAgents =
    brief?.subAgentTasks && brief.subAgentTasks.length > 0
      ? brief.subAgentTasks.map((t) => ({
          stepIndex: t.stepIndex,
          agentName: t.agentName.replace(/^\d+\.\s*/, ""),
          role: t.role,
          modelId: t.modelId,
          latencyMs: t.latencyMs,
          usedModel: t.source === "llm",
          source: t.source ?? t.status,
          tokensUsed: t.tokensUsed ?? 0,
          iterations: t.iterations,
        }))
      : [];

  const synthesizedCount =
    catalogCount ||
    layout?.components.filter((c) => c.type === "SynthesizedDynamicCard").length ||
    brief?.elementRouting?.missingElements.length ||
    0;
  const vaultedFields = pii?.piiFieldsVaulted ?? 0;
  const promptsScanned = pii?.promptsScanned ?? 0;
  const rawPiiPromptHits = pii?.rawPiiPromptHits ?? 0;

  return (
    <section className="space-y-3 border-t border-hairline pt-3 text-12" data-testid="omega-prime-telemetry">
      <div className="section-label">Pipeline and privacy telemetry</div>

      <div data-testid="subagent-task-telemetry">
        <div className="flex items-center justify-between gap-2">
          <span className="text-12 font-medium text-text">Sub-agent tasks · 5-stage pipeline</span>
          <span className={`font-mono text-11 ${subAgents.some((a) => a.usedModel) ? "text-healthy" : "text-faint"}`}>
            {subAgents.length ? `${subAgents.filter((a) => a.usedModel).length}/${subAgents.length} called a model` : "pipeline not run"}
          </span>
        </div>
        {subAgents.length === 0 ? (
          <div className="mt-0.5 text-muted">The sub-agent pipeline runs only for custom and ERP tickets; nothing to report for this one.</div>
        ) : (
          <ul className="mt-1 divide-y divide-hairline-2 border-y border-hairline-2">
            {subAgents.map((agent) => (
              <li key={agent.stepIndex} className="flex items-center justify-between gap-2 py-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-11 text-faint">{agent.stepIndex}.</span>
                  <span className="shrink-0 font-medium whitespace-nowrap text-text">{agent.agentName}</span>
                  <span className="truncate text-muted">· {agent.role}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 font-mono text-11">
                  <span className={agent.usedModel ? "text-text" : "text-muted"}>{agent.modelId}</span>
                  {!agent.usedModel && <span className="text-warning">{humanizeSource(agent.source)}</span>}
                  {agent.iterations !== undefined && agent.iterations > 0 && (
                    <span className="text-healthy" title="Write-then-test repair turns: sandbox findings fed back to the coder">{agent.iterations} iter</span>
                  )}
                  {agent.tokensUsed > 0 && <span className="text-faint">{agent.tokensUsed} tok</span>}
                  <span className="text-faint">{agent.latencyMs} ms</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:divide-x sm:divide-hairline">
        <div data-testid="kinematic-prefetch-telemetry">
          <div className="section-label">Speculative pre-fetch</div>
          <div className="mt-0.5 font-mono text-12 text-text">
            {kinematic.speculativeHits} hits · {kinematic.savedLatencyMs} ms saved
          </div>
          <div className="text-11 text-muted">
            Buffer {speculativeBuffer.length}/4 · {kinematic.selectionPrewarms} selection pre-warms
          </div>
        </div>

        <div className="sm:pl-3" data-testid="synthesized-catalog-summary">
          <div className="section-label">N+k catalog</div>
          <div className="mt-0.5 font-mono text-12 text-text">6 built-in + k={synthesizedCount} dynamic</div>
          <div className="text-11 text-muted">muse-spark-1.3 gatekeeper → muse-wonder-1.0</div>
        </div>

        <div className="sm:pl-3" data-testid="pii-redaction-vault-card">
          <div className="section-label">PII redaction vault</div>
          <div className={`mt-0.5 font-mono text-12 ${rawPiiPromptHits > 0 ? "text-critical" : "text-healthy"}`}>
            {vaultedFields} fields vaulted · {rawPiiPromptHits} prompt{rawPiiPromptHits === 1 ? "" : "s"} with raw PII
          </div>
          <div className="text-11 text-muted">
            {promptsScanned > 0 ? `${promptsScanned} model prompts scanned after pseudonymisation` : "No model prompt scanned yet"}
          </div>
        </div>
      </div>
    </section>
  );
}

function Tab({ id, active, icon, label }: { id: SystemTab; active: SystemTab; icon: React.ReactNode; label: string }) {
  const setOpen = useWorkbench((s) => s.setSystemOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true, id)}
      aria-pressed={active === id}
      className={`relative inline-flex items-center gap-1.5 text-12 whitespace-nowrap transition-colors [&>svg]:size-3.5 ${active === id ? "text-text" : "text-muted hover:text-text"}`}
    >
      {icon}
      {label}
      {active === id && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
    </button>
  );
}

function RunbookExport() {
  const scenarioId = useWorkbench((s) => s.scenarioId);
  return (
    <a href={`/api/runbooks/${scenarioId}.md`} download className="mt-2 inline-flex text-12 text-signal hover:underline" data-testid="runbook-export">
      Export runbook (.md)
    </a>
  );
}

function SkillsPiiBody() {
  const skills = useWorkbench((s) => s.compiledSkills);
  const pii = useWorkbench((s) => s.piiMetrics);
  const compileSkill = useWorkbench((s) => s.compileSkill);
  const loadSkills = useWorkbench((s) => s.loadSkills);
  return (
    <div className="space-y-4 text-12" data-testid="skills-pii">
      <section>
        <div className="section-label mb-1">Instant auto-fix rules</div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            void loadSkills();
            void compileSkill();
          }}
          title="Runs in <1ms with 0 AI tokens next time this issue happens"
        >
          Save as instant auto-fix rule
        </Button>
        <div className="mt-1 mb-1.5 text-11 text-faint">Runs in &lt;1ms with 0 AI tokens next time this issue happens</div>
        {skills.length === 0 && <div className="text-muted">No compiled auto-fix rule yet.</div>}
        <ul className="divide-y divide-hairline-2">
          {skills.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2 py-1">
              <Pill variant="status" tone="healthy" mono={false}>
                {s.badge}
              </Pill>
              <span className="font-mono text-11 text-faint">
                {s.id} · {s.latencyMs} ms · 0 tok
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="section-label mb-1">PII pseudonym vault · @pii(EU-GDPR-Personal)</div>
        {pii ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3">
              <Pill variant="status" tone="healthy" mono={false}>
                {pii.piiFieldsVaulted} PII fields vaulted
              </Pill>
              <Pill variant="status" tone={pii.zeroRawPiiInLlmPrompt ? "healthy" : "critical"} mono={false} title="Computed by scanning every outgoing model prompt after the vault ran">
                {pii.zeroRawPiiInLlmPrompt ? "No raw PII" : `Raw PII in ${pii.rawPiiPromptHits ?? "?"}`} in {pii.promptsScanned ?? 0} prompts
              </Pill>
            </div>
            <div className="border-l-2 border-hairline pl-2 font-mono text-11 text-muted">
              {Object.entries(pii.sampleMappings ?? {})
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k}>
                    {k} ↔ {v}
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div className="text-muted">Open a scenario to populate the vault.</div>
        )}
      </section>
    </div>
  );
}

/** Live provider and MCP status plus the router telemetry of the last request (formerly in the top bar). */
function ProvidersBody() {
  const health = useWorkbench((s) => s.health);
  const wsConnected = useWorkbench((s) => s.wsConnected);
  const telemetry = useWorkbench((s) => s.telemetry);
  const brief = useWorkbench((s) => s.brief);
  const dataMode = useWorkbench((s) => s.dataMode);
  const togglingDataMode = useWorkbench((s) => s.togglingDataMode);
  const setDataMode = useWorkbench((s) => s.setDataMode);
  const tierTone = (telemetry ? TIER_COLOR[telemetry.tier] : "muted") as Tone;
  const modeButton = (active: boolean) =>
    `relative inline-flex h-7 items-center text-12 whitespace-nowrap transition-colors disabled:opacity-60 ${active ? "text-text" : "text-muted hover:text-text"}`;
  return (
    <div className="space-y-4 text-12">
      <section data-testid="system-datamode-section">
        <div className="mb-1 flex items-center justify-between">
          <span className="section-label">MCP tenant data mode</span>
          <Pill variant="status" tone={dataMode === "real-tenant" ? "healthy" : "primary"} mono={false}>
            {dataMode === "real-tenant" ? "Strict real tenant" : "Simulated lab"}
          </Pill>
        </div>
        <p className="mb-1 text-muted">
          Enforced inside <span className="font-mono">@contextpane/mcp-msgraph</span> and <span className="font-mono">@contextpane/mcp-azure-iac</span>. In real-tenant mode, MCP
          queries your authenticated tenant only, with no fallback to seeded lab fixtures.
        </p>
        <div className="flex items-center gap-4 border-b border-hairline">
          <button
            type="button"
            disabled={togglingDataMode}
            onClick={() => void setDataMode("real-tenant")}
            data-testid="system-datamode-real"
            aria-pressed={dataMode === "real-tenant"}
            className={modeButton(dataMode === "real-tenant")}
          >
            Real tenant only (zero mock)
            {dataMode === "real-tenant" && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-signal" />}
          </button>
          <button
            type="button"
            disabled={togglingDataMode}
            onClick={() => void setDataMode("simulated-lab")}
            data-testid="system-datamode-simulated"
            aria-pressed={dataMode === "simulated-lab"}
            className={modeButton(dataMode === "simulated-lab")}
          >
            Simulated lab (seeded fixtures)
            {dataMode === "simulated-lab" && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-signal" />}
          </button>
        </div>
      </section>

      <section>
        <div className="section-label mb-1">Last request</div>
        {telemetry ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill variant="status" tone={tierTone} title={TIER_ROUTE[telemetry.tier].route} mono={false}>
              {TIER_ROUTE[telemetry.tier].label}
            </Pill>
            <span className="inline-flex items-center gap-1 text-muted [&>svg]:size-3">
              <Cpu />
              {PROVIDER_LABEL[telemetry.provider] ?? telemetry.provider}
            </span>
            <span className="font-mono text-11 text-text">{telemetry.modelId}</span>
            <span className="inline-flex items-center gap-1 font-mono text-11 text-muted [&>svg]:size-3">
              <Gauge />
              {fmtMs(telemetry.latencyMs)} · {fmtTokens(telemetry.tokensUsed.total)} tok
            </span>
            <span className="font-mono text-11 text-faint">{telemetry.endpoint}</span>
          </div>
        ) : (
          <div className="text-muted">No request yet.</div>
        )}
      </section>

      <section>
        <div className="section-label mb-1">Connectivity</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Pill variant="status" tone={wsConnected ? "healthy" : "critical"} mono={false}>
            Telemetry WebSocket {wsConnected ? "connected" : "down"}
          </Pill>
          <Pill variant="status" tone={health?.liveCloudMode ? "healthy" : "muted"}>
            LIVE_CLOUD_MODE={String(health?.liveCloudMode ?? false)}
          </Pill>
          {health?.forceLocal && (
            <Pill variant="status" tone="warning">
              CTX_FORCE_LOCAL
            </Pill>
          )}
        </div>
      </section>

      <section>
        <div className="section-label mb-1">MCP servers · {health?.mcp.transport ?? "?"}</div>
        <ul className="divide-y divide-hairline-2 border-y border-hairline-2">
          {(health?.mcp.servers ?? []).map((s) => (
            <li key={s.name} className="flex items-center gap-2 py-1">
              <Dot tone={s.ok ? "healthy" : "critical"} />
              <span className="font-mono">{s.name}</span>
              <span className="ml-auto text-faint">{s.tools ?? "?"} tools</span>
            </li>
          ))}
        </ul>
        {brief && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-11 text-faint">
            {Object.entries(brief.sources).map(([k, v]) => (
              <span key={k} title={`${k} for #${brief.scenarioId}`}>
                {k}: <span className={v.startsWith("live") ? "text-healthy" : "text-muted"}>{humanizeSource(v)}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-label mb-1">Model providers</div>
        <ul className="divide-y divide-hairline-2 border-y border-hairline-2">
          {(health?.providers ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1">
              <Dot tone={p.hasKey ? "healthy" : "muted"} />
              <span>{p.label}</span>
              <span className="ml-auto font-mono text-11 text-faint">{p.hasKey ? "configured" : "no key"}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 text-11 text-faint">The open-weight Muse Glimmer GPU is scale-to-zero and only woken by an explicit hover refresh; cached answers are served without it.</div>
        {health?.openWeightInference && (
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-11 text-muted" data-testid="glimmer-config">
            <span>grammarConstrained: {String(health.openWeightInference.grammarConstrained)}</span>
            <span>kvCacheQuant: {health.openWeightInference.kvCacheQuant}</span>
            <span>speculativeDraftMax: {health.openWeightInference.speculativeDraftMax}</span>
            <span>maxContainers: {health.openWeightInference.maxContainers}</span>
          </div>
        )}
        <RunbookExport />
      </section>

      {health?.github && (
        <section>
          <div className="section-label mb-1">GitHub</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 font-mono text-11 text-text [&>svg]:size-3">
              <GitPullRequest />
              {health.github.origin?.replace(/^https:\/\/github\.com\//, "") ?? "no remote origin"}
            </span>
            <Pill variant="status" tone={health.github.ghAuthenticated ? "healthy" : "warning"} mono={false}>
              gh {health.github.ghAuthenticated ? `as ${health.github.account}` : "not signed in"}
            </Pill>
            <span className="text-11 text-faint">PR on approve: {health.github.prOnApprove ? "default on" : "checkbox"}</span>
          </div>
        </section>
      )}
    </div>
  );
}
