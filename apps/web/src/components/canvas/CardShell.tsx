import { CircleCheckBig } from "lucide-react";
import type { ReactNode } from "react";
import type { ComponentType, HealthState, Provenance } from "@contextpane/catalog";
import { PROVIDER_LABEL, fmtTokens, healthTone } from "@/lib/format";
import { selectConvergence, useWorkbench } from "@/store";
import { Pill, type Tone } from "../ui/Pill";

interface CardShellProps {
  type: ComponentType;
  icon: ReactNode;
  title: string;
  state?: HealthState;
  statePill?: ReactNode;
  provenance: Provenance;
  repaired?: boolean;
  right?: ReactNode;
  children: ReactNode;
}

const CONVERGING: ComponentType[] = ["TenantSummaryHeader", "LicenseDriftCard", "EntraSignInTimeline", "IaCDriftBanner"];

/** Shared chrome for every catalog component: title, state, provenance tag, flash highlight, remediated ribbon. */
export function CardShell({ type, icon, title, state, statePill, provenance, repaired, right, children }: CardShellProps) {
  const highlight = useWorkbench((s) => s.highlightComponent);
  const convergence = useWorkbench(selectConvergence);
  const convergeFlash = useWorkbench((s) => s.convergeFlash);
  const tone: Tone = state ? healthTone(state) : "muted";
  const converged = Boolean(convergence) && CONVERGING.includes(type);
  const greenFlash = converged && convergeFlash;
  const flashing = highlight === type || greenFlash;
  return (
    <section
      id={`canvas-${type}`}
      data-component={type}
      data-converged={converged || undefined}
      style={{ ["--flash-color" as string]: greenFlash ? "var(--color-healthy)" : "var(--color-primary)" }}
      className={`card scroll-mt-2 animate-fade-in ${flashing ? `animate-pulse-ring ring-1 ${greenFlash ? "ring-healthy" : "ring-primary"}` : ""} ${converged ? "border-healthy/40" : ""}`}
    >
      <header className="mb-2 flex items-center gap-2">
        <span className="text-primary [&>svg]:size-4">{icon}</span>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {statePill ?? (state ? <Pill tone={tone}>{state}</Pill> : null)}
        <div className="ml-auto flex items-center gap-2">
          {converged && convergence && (
            <Pill
              tone="healthy"
              icon={<CircleCheckBig />}
              title={`${convergence.remediationId} · ${convergence.execution} · converged ${convergence.convergedAt.slice(11, 19)}Z via notifications/resources/updated, 0 LLM tokens`}
            >
              remediated · 0 tok
            </Pill>
          )}
          {right}
          <span className="font-mono text-[10px] text-faint" title={`provenance · ${provenance.provider}/${provenance.modelId} · validated=${provenance.validated}`}>
            {provenance.tier} · {provenance.provider === "local" ? "0 tokens" : `${PROVIDER_LABEL[provenance.provider] ?? provenance.provider} · ${fmtTokens(provenance.tokensUsed)} tok`}
            {repaired ? " · repaired" : ""}
          </span>
        </div>
      </header>
      {children}
    </section>
  );
}

export function KeyValue({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`truncate text-[12px] ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}
