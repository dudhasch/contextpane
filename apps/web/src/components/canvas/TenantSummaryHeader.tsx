import { BadgeCheck, Building2, ChevronRight, Cloud, ShieldCheck } from "lucide-react";
import type { ComponentType, HealthState, Provenance, TenantSummaryHeader as Props } from "@contextpane/catalog";
import { healthTone } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Dot, Pill, TONE_TEXT, type Tone } from "../ui/Pill";
import { CardShell, KeyValue } from "./CardShell";

const SEV_TONE: Record<string, Tone> = { P1: "critical", P2: "warning", P3: "primary", P4: "muted" };

const HEALTH_PILL_CLASS: Record<Tone, string> = {
  primary: "bg-primary/12 border-primary/40 text-primary hover:bg-primary/20",
  healthy: "bg-healthy/12 border-healthy/40 text-healthy hover:bg-healthy/20",
  warning: "bg-warning/12 border-warning/40 text-warning hover:bg-warning/20",
  critical: "bg-critical/12 border-critical/40 text-critical hover:bg-critical/20",
  meta: "bg-meta/12 border-meta/40 text-meta hover:bg-meta/20",
  muted: "bg-elevated border-border text-muted hover:bg-surface",
};

export function TenantSummaryHeaderCard({ props, provenance, repaired }: { props: Props; provenance: Provenance; repaired?: boolean }) {
  const overall: HealthState = (["critical", "warning", "healthy"] as const).find((s) => Object.values(props.healthSummary).includes(s)) ?? "unknown";
  return (
    <CardShell
      type="TenantSummaryHeader"
      icon={<Building2 />}
      title={props.tenantName}
      state={overall}
      provenance={provenance}
      repaired={repaired}
      right={props.activeEscalation ? <Pill tone={SEV_TONE[props.activeEscalation.severity] ?? "warning"}>{props.activeEscalation.badge}</Pill> : null}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-[1.1fr_1.2fr_0.8fr_0.6fr_1.6fr]">
        <KeyValue label="Tenant ID" mono>
          {props.tenantId}
        </KeyValue>
        <KeyValue label="Verified domain" mono>
          {props.verifiedDomain}
        </KeyValue>
        <KeyValue label="ERP contract" mono>
          {props.erpContractId}
        </KeyValue>
        <KeyValue label="SLA tier">{props.slaTier}</KeyValue>
        {props.activeEscalation && (
          <KeyValue label="Active escalation">
            <span title={props.activeEscalation.title}>
              <span className="font-mono text-primary">#{props.activeEscalation.ticketId}</span> {props.activeEscalation.title}
            </span>
          </KeyValue>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Health label="Licenses" icon={<BadgeCheck />} state={props.healthSummary.licenses} target="LicenseDriftCard" />
        <Health label="Identity" icon={<ShieldCheck />} state={props.healthSummary.identity} target="EntraSignInTimeline" />
        <Health label="Infrastructure" icon={<Cloud />} state={props.healthSummary.infrastructure} target="IaCDriftBanner" />
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-faint">
          <Dot tone={props.providerTelemetry.provider === "local" ? "primary" : "meta"} />
          {props.providerTelemetry.tier} · {props.providerTelemetry.modelId} · {props.providerTelemetry.latencyMs} ms · {props.providerTelemetry.tokensUsed} tok
        </span>
      </div>
    </CardShell>
  );
}

/** Status pill that doubles as navigation: smooth-scrolls to the owning card and pulse-highlights it. */
function Health({ label, icon, state, target }: { label: string; icon: React.ReactNode; state: HealthState; target: ComponentType }) {
  const reveal = useWorkbench((s) => s.revealComponent);
  const tone = healthTone(state);
  return (
    <button
      type="button"
      onClick={() => reveal(target)}
      title={`Jump to ${target}`}
      className={`inline-flex h-6 items-center gap-1.5 rounded-pill border px-2 text-[11px] leading-none font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-primary [&>svg]:size-3 ${HEALTH_PILL_CLASS[tone]}`}
    >
      {icon}
      {label}: <span className={`font-mono ${TONE_TEXT[tone]}`}>{state}</span>
      <ChevronRight className="opacity-60" />
    </button>
  );
}
