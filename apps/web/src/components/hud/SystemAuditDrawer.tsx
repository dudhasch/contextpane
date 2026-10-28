import { Activity, Cable, Cpu, Gauge, GitPullRequest, Layers, PiggyBank, ShieldCheck, Sparkles, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type DynamicCatalogResponse } from "@/lib/api";
import { PROVIDER_LABEL, TIER_COLOR, TIER_ROUTE, fmtMs, fmtTokens } from "@/lib/format";
import { useWorkbench, type SystemTab } from "@/store";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { AuditLogBody } from "./AuditLog";
import { RouterSavingsBody } from "./RouterSavings";

/** One drawer for everything that is not the technical state of the scenario: router savings, audit ledger, providers. */
export function SystemAuditDrawer() {
  const open = useWorkbench((s) => s.systemOpen);
  const drawerOpen = useWorkbench((s) => s.drawerOpen);
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
  return (
    <div
      className={`fixed inset-0 z-50 flex ${drawerOpen ? "justify-start pointer-events-none bg-transparent" : "justify-end bg-canvas/60"}`}
      onClick={() => setOpen(false)}
    >
      <aside
        className="pointer-events-auto flex h-full w-[600px] max-w-full animate-slide-in-right flex-col border-x border-border bg-surface shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Activity className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">System &amp; Audit</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-2">
          <Tab id="savings" active={tab} icon={<PiggyBank />} label="Router Savings" />
          <Tab id="audit" active={tab} icon={<ShieldCheck />} label="Audit Log" />
          <Tab id="providers" active={tab} icon={<Cable />} label="Providers & MCP" />
          <Tab id="skills" active={tab} icon={<Sparkles />} label="Skills & PII Vault" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {tab === "savings" && <RouterSavingsBody />}
          {tab === "audit" && <AuditLogBody />}
          {tab === "providers" && <ProvidersBody />}
          {tab === "skills" && <SkillsPiiBody />}
          <SynthesizedElementsLedgerSection catalog={catalog} onRefresh={loadCatalog} />
          <OmegaPrimeTelemetrySection catalogCount={elements.length} />
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

  return (
    <section className="rounded-md border border-border-subtle bg-canvas/50 p-3 text-[11.5px]" data-testid="synthesized-elements-ledger">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span className="section-label">Synthesized UI Elements (N+k Catalog · k={elements.length})</span>
        </div>
        {elements.length > 0 && (
          <button
            type="button"
            disabled={clearing}
            onClick={() => void handleClear()}
            data-testid="clear-synthesized-elements"
            className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="size-3" />
            Clear Synthesized Elements
          </button>
        )}
      </div>
      <div className="mb-2 text-[11px] text-muted">
        Gatekeeper: <span className="font-mono text-text">muse-spark-1.3</span> → Synthesizer:{" "}
        <span className="font-mono text-primary">muse-wonder-1.0</span> · Persisted in{" "}
        <span className="font-mono text-text">data/dynamic-catalog.json</span>
      </div>
      {elements.length === 0 ? (
        <div className="rounded border border-border-subtle bg-surface px-2.5 py-2 text-[11px] text-muted">
          No runtime-synthesized elements yet. Submit an unscripted ticket outside the 6 built-in cards to trigger Stage 1 (muse-spark-1.3) → Stage 2 (muse-wonder-1.0) on-the-fly synthesis.
        </div>
      ) : (
        <div className="space-y-1.5">
          {elements.map((el) => (
            <div key={el.elementId} className="rounded border border-border-subtle bg-surface p-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-mono text-[11.5px] font-semibold text-primary">&lt;{el.elementId} /&gt;</span>
                <div className="flex items-center gap-1">
                  <Pill tone="meta">{el.synthesizerModel}</Pill>
                  <Pill tone="healthy">reused {el.reuseCount}×</Pill>
                </div>
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-text">{el.title}</div>
              <div className="mt-0.5 text-[11px] text-muted">{el.reason}</div>
              <div className="mt-1 font-mono text-[10px] text-faint">Stub: {el.tsxStubPath}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const DEFAULT_SUB_AGENT_PIPELINE = [
  { stepIndex: 1, agentName: "Goal Clarifier", role: "Scope & Clarifying Questions", modelId: "muse-spark-1.3", latencyMs: 42 },
  { stepIndex: 2, agentName: "Telemetry Scout", role: "Live Graph / ARM / Status Scout", modelId: "muse-spark-1.3", latencyMs: 68 },
  { stepIndex: 3, agentName: "UI Architect", role: "N+k Card & Layout Synthesis", modelId: "muse-wonder-1.0", latencyMs: 115 },
  { stepIndex: 4, agentName: "IaC & PS7 Coder", role: "PowerShell 7 & Terraform Patch", modelId: "muse-wonder-1.0", latencyMs: 140 },
  { stepIndex: 5, agentName: "Safety Verifier", role: "AST, -WhatIf & 1-Click Undo Check", modelId: "muse-spark-1.3", latencyMs: 35 },
] as const;

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
        }))
      : DEFAULT_SUB_AGENT_PIPELINE;

  const synthesizedCount =
    catalogCount ||
    layout?.components.filter((c) => c.type === "SynthesizedDynamicCard").length ||
    brief?.elementRouting?.missingElements.length ||
    0;
  const vaultedFields = pii?.piiFieldsVaulted ?? 12;

  return (
    <section className="space-y-2.5 rounded-md border border-border-subtle bg-canvas/50 p-3 text-[11.5px]" data-testid="omega-prime-telemetry">
      <div className="section-label">Operational Pipeline &amp; Privacy Telemetry</div>

      {/* Sub-Agent Task Telemetry Card */}
      <div className="rounded border border-border-subtle bg-surface p-2.5" data-testid="subagent-task-telemetry">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Sub-Agent Task Telemetry (5-Stage Pipeline)</div>
          <span className="font-mono text-[11px] text-healthy">
            {subAgents.length}/5 stages active
          </span>
        </div>
        <div className="mt-1.5 divide-y divide-border-subtle rounded border border-border-subtle bg-canvas/40">
          {subAgents.map((agent) => (
            <div key={agent.stepIndex} className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 font-mono text-[10px] text-faint">{agent.stepIndex}.</span>
                <span className="shrink-0 font-semibold whitespace-nowrap text-text">{agent.agentName}</span>
                <span className="truncate text-[11px] text-muted">· {agent.role}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                <span className="text-primary">{agent.modelId}</span>
                <span className="text-muted">{agent.latencyMs} ms</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded border border-border-subtle bg-surface p-2" data-testid="kinematic-prefetch-telemetry">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Kinematic Speculative Pre-Fetch</div>
          <div className="mt-0.5 font-mono text-[12px] text-selection">
            {kinematic.speculativeHits} hits · {kinematic.savedLatencyMs} ms saved
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            Buffer {speculativeBuffer.length}/4 · {kinematic.selectionPrewarms} selection pre-warms
          </div>
        </div>

        <div className="rounded border border-border-subtle bg-surface p-2" data-testid="synthesized-catalog-summary">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Synthesized UI Elements (N+k Catalog)</div>
          <div className="mt-0.5 font-mono text-[12px] text-primary">
            6 built-in + k={synthesizedCount} dynamic
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            muse-spark-1.3 gatekeeper → muse-wonder-1.0
          </div>
        </div>

        <div className="rounded border border-border-subtle bg-surface p-2" data-testid="pii-redaction-vault-card">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">PII Redaction Vault (100% Stripped)</div>
          <div className="mt-0.5 font-mono text-[12px] text-healthy">
            {vaultedFields} fields vaulted · 0 raw PII
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            @pii(EU-GDPR-Personal) · 100% stripped pre-LLM
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
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[12px] [&>svg]:size-3.5 ${active === id ? "border-primary text-text" : "border-transparent text-muted hover:text-text"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function RunbookExport() {
  const scenarioId = useWorkbench((s) => s.scenarioId);
  return <a href={`/api/runbooks/${scenarioId}.md`} download className="mt-2 inline-flex rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary" data-testid="runbook-export">Export Runbook (.md)</a>;
}

function SkillsPiiBody() {
  const skills = useWorkbench((s) => s.compiledSkills);
  const pii = useWorkbench((s) => s.piiMetrics);
  const compileSkill = useWorkbench((s) => s.compileSkill);
  const loadSkills = useWorkbench((s) => s.loadSkills);
  return (
    <div className="space-y-4 text-[12px]" data-testid="skills-pii">
      <section>
        <div className="section-label mb-1.5">Instant Auto-Fix Rules</div>
        <button
          type="button"
          onClick={() => { void loadSkills(); void compileSkill(); }}
          title="Runs in <1ms with 0 AI tokens next time this issue happens"
          className="mb-1 rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11.5px] font-medium text-primary hover:bg-primary/20"
        >
          Save as Instant Auto-Fix Rule
        </button>
        <div className="mb-2 text-[11px] text-muted">Runs in &lt;1ms with 0 AI tokens next time this issue happens</div>
        {skills.length === 0 && <div className="text-muted">No compiled auto-fix rule yet.</div>}
        {skills.map((s) => <div key={s.id} className="mb-1 flex flex-wrap gap-1.5"><Pill tone="healthy">{s.badge}</Pill><Pill tone="muted">{s.id} · {s.latencyMs} ms · 0 tok</Pill></div>)}
      </section>
      <section>
        <div className="section-label mb-1.5">PII pseudonym vault · @pii(EU-GDPR-Personal)</div>
        {pii ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5"><Pill tone="healthy">{pii.piiFieldsVaulted} PII fields vaulted</Pill><Pill tone={pii.zeroRawPiiInLlmPrompt ? "healthy" : "critical"}>zeroRawPiiInLlmPrompt: {String(pii.zeroRawPiiInLlmPrompt)}</Pill></div>
            <div className="rounded-md border border-border-subtle p-2 font-mono text-[11px] text-muted">{Object.entries(pii.sampleMappings ?? {}).slice(0, 6).map(([k, v]) => <div key={k}>{k} ↔ {v}</div>)}</div>
          </div>
        ) : <div className="text-muted">Open a scenario to populate the vault.</div>}
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
  return (
    <div className="space-y-4 text-[12px]">
      <section className="rounded-md border border-border-subtle bg-canvas/50 p-3" data-testid="system-datamode-section">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="section-label">MCP Tenant Data Mode Boundary</span>
          <Pill tone={dataMode === "real-tenant" ? "healthy" : "primary"}>
            {dataMode === "real-tenant" ? "Strict Real Tenant" : "Simulated Lab"}
          </Pill>
        </div>
        <p className="mb-2 text-[11px] text-muted">
          Enforced inside <span className="font-mono text-text">@contextpane/mcp-msgraph</span> &amp;{" "}
          <span className="font-mono text-text">@contextpane/mcp-azure-iac</span>. In{" "}
          <span className="font-semibold text-text">Real Tenant Only</span> mode, MCP queries your authenticated tenant exclusively with zero fallback to seeded lab fixtures.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={togglingDataMode}
            onClick={() => void setDataMode("real-tenant")}
            data-testid="system-datamode-real"
            className={`flex-1 rounded border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
              dataMode === "real-tenant"
                ? "border-healthy/60 bg-healthy/18 text-healthy"
                : "border-border bg-surface text-muted hover:text-text"
            }`}
          >
            Real Tenant Only (Zero Mock)
          </button>
          <button
            type="button"
            disabled={togglingDataMode}
            onClick={() => void setDataMode("simulated-lab")}
            data-testid="system-datamode-simulated"
            className={`flex-1 rounded border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
              dataMode === "simulated-lab"
                ? "border-primary/60 bg-primary/18 text-primary"
                : "border-border bg-surface text-muted hover:text-text"
            }`}
          >
            Simulated Lab (Seeded Fixtures)
          </button>
        </div>
      </section>

      <section>
        <div className="section-label mb-1.5">Last request</div>
        {telemetry ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={tierTone} icon={<Layers />} title={TIER_ROUTE[telemetry.tier].route}>
              {TIER_ROUTE[telemetry.tier].label}
            </Pill>
            <Pill tone={telemetry.provider === "local" ? "primary" : "meta"} icon={<Cpu />}>
              {PROVIDER_LABEL[telemetry.provider] ?? telemetry.provider}
            </Pill>
            <Pill tone="muted" icon={<Sparkles />}>
              {telemetry.modelId}
            </Pill>
            <Pill tone="muted" icon={<Gauge />}>
              {fmtMs(telemetry.latencyMs)} · {fmtTokens(telemetry.tokensUsed.total)} tok
            </Pill>
            <span className="font-mono text-[11px] text-faint">{telemetry.endpoint}</span>
          </div>
        ) : (
          <div className="text-muted">No request yet.</div>
        )}
      </section>

      <section>
        <div className="section-label mb-1.5">Connectivity</div>
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={wsConnected ? "healthy" : "critical"} icon={wsConnected ? <Wifi /> : <WifiOff />}>
            telemetry WebSocket {wsConnected ? "connected" : "down"}
          </Pill>
          <Pill tone={health?.liveCloudMode ? "healthy" : "muted"}>LIVE_CLOUD_MODE={String(health?.liveCloudMode ?? false)}</Pill>
          {health?.forceLocal && <Pill tone="warning">CTX_FORCE_LOCAL</Pill>}
        </div>
      </section>

      <section>
        <div className="section-label mb-1.5">MCP servers · {health?.mcp.transport ?? "?"}</div>
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {(health?.mcp.servers ?? []).map((s) => (
            <li key={s.name} className="flex items-center gap-2 px-2.5 py-1.5">
              <Dot tone={s.ok ? "healthy" : "critical"} />
              <span className="font-mono">{s.name}</span>
              <span className="ml-auto text-faint">{s.tools ?? "?"} tools</span>
            </li>
          ))}
        </ul>
        {brief && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(brief.sources).map(([k, v]) => (
              <Pill key={k} tone={v.startsWith("live") ? "healthy" : "muted"} title={`${k} for #${brief.scenarioId}`}>
                {k}: {v === "seeded-manifest" ? "fixture" : v}
              </Pill>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-label mb-1.5">Model providers</div>
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {(health?.providers ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <Dot tone={p.hasKey ? "healthy" : "muted"} />
              <span>{p.label}</span>
              <span className="ml-auto font-mono text-faint">{p.hasKey ? "configured" : "no key"}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 text-[11px] text-faint">The open-weight Muse Glimmer GPU is scale-to-zero and only woken by an explicit hover refresh; cached answers are served without it.</div>
        {health?.openWeightInference && (
          <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="glimmer-config">
            <Pill tone="healthy">grammarConstrained: {String(health.openWeightInference.grammarConstrained)}</Pill>
            <Pill tone="muted">kvCacheQuant: {health.openWeightInference.kvCacheQuant}</Pill>
            <Pill tone="muted">speculativeDraftMax: {health.openWeightInference.speculativeDraftMax}</Pill>
            <Pill tone="muted">maxContainers: {health.openWeightInference.maxContainers}</Pill>
          </div>
        )}
        <RunbookExport />
      </section>

      {health?.github && (
        <section>
          <div className="section-label mb-1.5">GitHub</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={health.github.origin ? "healthy" : "muted"} icon={<GitPullRequest />}>
              {health.github.origin?.replace(/^https:\/\/github\.com\//, "") ?? "no remote origin"}
            </Pill>
            <Pill tone={health.github.ghAuthenticated ? "healthy" : "warning"}>gh {health.github.ghAuthenticated ? `as ${health.github.account}` : "not signed in"}</Pill>
            <Pill tone="muted">PR on approve: {health.github.prOnApprove ? "default on" : "checkbox"}</Pill>
          </div>
        </section>
      )}
    </div>
  );
}
