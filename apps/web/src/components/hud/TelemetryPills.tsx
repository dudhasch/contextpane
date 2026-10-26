import { Activity, Cpu, Gauge, Layers, Sparkles, Wifi, WifiOff } from "lucide-react";
import { PROVIDER_LABEL, TIER_COLOR, fmtMs, fmtTokens } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Pill, type Tone } from "../ui/Pill";

/** Live compute-router telemetry: tier, provider, model, latency, tokens. */
export function TelemetryPills() {
  const telemetry = useWorkbench((s) => s.telemetry);
  const wsConnected = useWorkbench((s) => s.wsConnected);
  const health = useWorkbench((s) => s.health);
  const canvasStatus = useWorkbench((s) => s.canvasStatus);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const busy = canvasStatus === "loading" || remediateStatus === "loading";

  const tierTone = (telemetry ? TIER_COLOR[telemetry.tier] : "muted") as Tone;
  const providerTone: Tone = telemetry?.provider === "local" ? "primary" : telemetry?.provider === "meta" ? "meta" : telemetry ? "healthy" : "muted";
  const flashKey = telemetry?.requestId;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Pill tone={tierTone} icon={<Layers />} flashKey={flashKey} title="Active router tier">
        {telemetry ? telemetry.tier : "Tier —"}
      </Pill>
      <Pill tone={providerTone} icon={<Cpu />} flashKey={flashKey} title="Provider">
        {telemetry ? (PROVIDER_LABEL[telemetry.provider] ?? telemetry.provider) : "Provider —"}
      </Pill>
      <Pill tone={telemetry?.provider === "local" ? "muted" : "meta"} icon={<Sparkles />} flashKey={flashKey} title="Model id" className="max-w-56">
        {telemetry ? telemetry.modelId : "model —"}
      </Pill>
      <Pill tone={busy ? "warning" : "muted"} icon={<Gauge />} flashKey={flashKey} title="Latency of the last request">
        {busy ? "…" : telemetry ? fmtMs(telemetry.latencyMs) : "— ms"}
      </Pill>
      <Pill tone={telemetry && telemetry.tokensUsed.total > 0 ? "meta" : "muted"} icon={<Activity />} flashKey={flashKey} title="Tokens used by the last request">
        {telemetry ? `${fmtTokens(telemetry.tokensUsed.total)} tok` : "— tok"}
      </Pill>
      <Pill
        tone={wsConnected ? "healthy" : "critical"}
        icon={wsConnected ? <Wifi /> : <WifiOff />}
        title={wsConnected ? `Telemetry WebSocket connected · MCP ${health?.mcp.transport ?? "?"} · live cloud ${health?.liveCloudMode ? "ON" : "off"}` : "Telemetry WebSocket disconnected"}
      >
        {wsConnected ? (health?.liveCloudMode ? "LIVE" : "OFFLINE-SAFE") : "WS ↓"}
      </Pill>
    </div>
  );
}
