import { Activity, Cable, Cpu, Gauge, GitPullRequest, Layers, PiggyBank, ShieldCheck, Sparkles, Wifi, WifiOff, X } from "lucide-react";
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
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {tab === "savings" && <RouterSavingsBody />}
          {tab === "audit" && <AuditLogBody />}
          {tab === "providers" && <ProvidersBody />}
        </div>
      </aside>
    </div>
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
