import { BadgeCheck, Building2, Cloud, ShieldCheck } from "lucide-react";
import type { HealthState, Provenance, TenantSummaryHeader as Props } from "@contextpane/catalog";
import { healthTone } from "@/lib/format";
import { Dot, Pill, type Tone } from "../ui/Pill";
import { CardShell, KeyValue } from "./CardShell";

const SEV_TONE: Record<string, Tone> = { P1: "critical", P2: "warning", P3: "primary", P4: "muted" };

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
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
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
      </div>
      {props.activeEscalation && (
        <div className="mt-2.5 flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-[12px]">
          <span className="font-mono text-primary">#{props.activeEscalation.ticketId}</span>
          <span className="truncate">{props.activeEscalation.title}</span>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Health label="Licenses" icon={<BadgeCheck />} state={props.healthSummary.licenses} />
        <Health label="Identity" icon={<ShieldCheck />} state={props.healthSummary.identity} />
        <Health label="Infrastructure" icon={<Cloud />} state={props.healthSummary.infrastructure} />
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-faint">
          <Dot tone={props.providerTelemetry.provider === "local" ? "primary" : "meta"} />
          {props.providerTelemetry.tier} · {props.providerTelemetry.modelId} · {props.providerTelemetry.latencyMs} ms · {props.providerTelemetry.tokensUsed} tok
        </span>
      </div>
    </CardShell>
  );
}

function Health({ label, icon, state }: { label: string; icon: React.ReactNode; state: HealthState }) {
  return (
    <Pill tone={healthTone(state)} icon={icon} mono={false}>
      {label}: <span className="font-mono">{state}</span>
    </Pill>
  );
}
