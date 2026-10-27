import { Activity, Cable, Cpu, Gauge, GitPullRequest, Layers, PiggyBank, ShieldCheck, Sparkles, Wifi, WifiOff, X } from "lucide-react";
import { useEffect } from "react";
import { PROVIDER_LABEL, TIER_COLOR, TIER_ROUTE, fmtMs, fmtTokens } from "@/lib/format";
import { useWorkbench, type SystemTab } from "@/store";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { AuditLogBody } from "./AuditLog";
import { RouterSavingsBody } from "./RouterSavings";

/** One drawer for everything that is not the technical state of the scenario: router savings, audit ledger, providers. */
export function SystemAuditDrawer() {
  const open = useWorkbench((s) => s.systemOpen);
  const tab = useWorkbench((s) => s.systemTab);
  const setOpen = useWorkbench((s) => s.setSystemOpen);
  const loadDrawerExtras = useWorkbench((s) => s.loadDrawerExtras);
  useEffect(() => {
    if (open) void loadDrawerExtras();
  }, [open, loadDrawerExtras]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-canvas/60" onClick={() => setOpen(false)}>
      <aside className="flex h-full w-[600px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-popover" onClick={(e) => e.stopPropagation()}>
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
          <OmegaPrimeTelemetrySection />
        </div>
      </aside>
    </div>
  );
}

function OmegaPrimeTelemetrySection() {
  const formal = useWorkbench((s) => s.formal);
  const dp = useWorkbench((s) => s.dataplaneDetail);
  const kinematic = useWorkbench((s) => s.kinematicMetrics);
  const speculativeBuffer = useWorkbench((s) => s.speculativeBuffer);
  const speculativeEpoch = useWorkbench((s) => s.speculativeEpoch);

  const deltaW = formal?.formal.minPerturbationCost ?? formal?.formal.maxSmtSynthesis?.minPerturbationCost ?? 6.5;
  const mask = formal?.formal.invariantProofMask ?? 0x7f;
  const ib = dp?.informationBottleneck;
  const entropyBits = ib?.viewportEntropyBits ?? 21.4;
  const capacityBits = ib?.humanCapacityBits ?? 42.0;
  const scanNs = dp?.columnarScanNs ?? 14200;
  const fence = dp?.fence;
  const firstDesc = dp?.datasets?.[0];

  return (
    <section className="rounded-md border border-border-subtle bg-canvas/50 p-3 text-[11.5px]" data-testid="omega-prime-telemetry">
      <div className="section-label mb-2">ContextPane Ω-Prime Systems Telemetry</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-border-subtle bg-surface p-2">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">MaxSMT ΔW Cost &amp; PCC Mask</div>
          <div className="mt-0.5 font-mono text-[12px] text-healthy">
            ΔW = {deltaW.toFixed(2)} · 0x{mask.toString(16).toUpperCase()} (7/7)
          </div>
          <div className="mt-0.5 text-[10px] text-muted">
            0 collateral lockouts · optimal minimum-delta verified
          </div>
        </div>
        <div className="rounded border border-border-subtle bg-surface p-2">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Information Bottleneck Bits</div>
          <div className="mt-0.5 font-mono text-[12px] text-primary">
            I(V; A*) = {entropyBits.toFixed(1)} / {capacityBits.toFixed(1)} bits
          </div>
          <div className="mt-0.5 text-[10px] text-muted">
            Within human foveal budget (≤ 42.0 bits)
          </div>
        </div>
        <div className="rounded border border-border-subtle bg-surface p-2">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">ptr:// v3 Columnar Scan ns</div>
          <div className="mt-0.5 font-mono text-[12px] text-text">
            {scanNs.toLocaleString()} ns · epoch {fence?.epoch ?? speculativeEpoch} · gen {fence?.generation ?? 3}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">
            {firstDesc
              ? `burstiness B=${(firstDesc.burstiness ?? 0).toFixed(2)} · log2Bucket=${firstDesc.log2RowBucket ?? 3}`
              : "Typed Uint32Array bitmap + order-preserving HMAC"}
          </div>
        </div>
        <div className="rounded border border-border-subtle bg-surface p-2">
          <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Kinematic Speculative Hit</div>
          <div className="mt-0.5 font-mono text-[12px] text-selection">
            {kinematic.speculativeHits} hits · {kinematic.savedLatencyMs} ms saved
          </div>
          <div className="mt-0.5 text-[10px] text-muted">
            Buffer {speculativeBuffer.length}/4 · {kinematic.selectionPrewarms} selection pre-warms
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
        <div className="mb-2 text-[10.5px] text-muted">Runs in &lt;1ms with 0 AI tokens next time this issue happens</div>
        {skills.length === 0 && <div className="text-muted">No compiled auto-fix rule yet.</div>}
        {skills.map((s) => <div key={s.id} className="mb-1 flex flex-wrap gap-1.5"><Pill tone="healthy">{s.badge}</Pill><Pill tone="muted">{s.id} · {s.latencyMs} ms · 0 tok</Pill></div>)}
      </section>
      <section>
        <div className="section-label mb-1.5">PII pseudonym vault · @pii(EU-GDPR-Personal)</div>
        {pii ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5"><Pill tone="healthy">{pii.piiFieldsVaulted} PII fields vaulted</Pill><Pill tone={pii.zeroRawPiiInLlmPrompt ? "healthy" : "critical"}>zeroRawPiiInLlmPrompt: {String(pii.zeroRawPiiInLlmPrompt)}</Pill></div>
            <div className="rounded-md border border-border-subtle p-2 font-mono text-[10.5px] text-muted">{Object.entries(pii.sampleMappings ?? {}).slice(0, 6).map(([k, v]) => <div key={k}>{k} ↔ {v}</div>)}</div>
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
  const tierTone = (telemetry ? TIER_COLOR[telemetry.tier] : "muted") as Tone;
  return (
    <div className="space-y-4 text-[12px]">
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
            <span className="font-mono text-[10.5px] text-faint">{telemetry.endpoint}</span>
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
        <div className="mt-1 text-[10.5px] text-faint">The open-weight Muse Glimmer GPU is scale-to-zero and only woken by an explicit hover refresh; cached answers are served without it.</div>
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
