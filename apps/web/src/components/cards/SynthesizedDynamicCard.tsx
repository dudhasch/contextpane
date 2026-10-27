import { Activity, ArrowRight, CheckCircle2, Cloud, Code2, Cpu, Database, GitCompareArrows, ShieldAlert, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";
import type { SynthesizedBlock, SynthesizedDynamicCard as Props } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { CardShell, DataTable, Stat } from "../canvas/CardShell";
import { DiffView } from "../canvas/DiffView";
import { Button } from "../ui/Button";
import { Mono, Pill, type Tone } from "../ui/Pill";
import { RolePermissionHoverPopover } from "../ui/RolePermissionHoverPopover";

function statusTone(state: string): Tone {
  if (state === "critical" || state === "Deny" || state === "Failed") return "critical";
  if (state === "warning" || state === "Audit" || state === "Warning") return "warning";
  if (state === "healthy" || state === "Allow" || state === "Pass" || state === "Succeeded") return "healthy";
  return "muted";
}

function renderBlock(block: SynthesizedBlock, filterText: string) {
  switch (block.kind) {
    case "quota-gauges": {
      return (
        <div key={block.title} className="space-y-2 rounded-lg border border-border-subtle bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text">
              <Cpu className="size-3.5 text-teal-400" />
              {block.title}
            </span>
            <Pill tone="meta">ARM Compute Usages</Pill>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {block.gauges.map((g) => {
              const pct = Math.min(100, Math.round((g.used / Math.max(1, g.limit)) * 100));
              const barColor =
                g.status === "critical"
                  ? "bg-rose-500"
                  : g.status === "warning"
                    ? "bg-amber-500"
                    : "bg-emerald-500";
              return (
                <div
                  key={g.id}
                  className={`rounded-md border p-2.5 ${
                    g.status === "critical"
                      ? "border-critical/40 bg-critical/8"
                      : g.status === "warning"
                        ? "border-warning/35 bg-warning/8"
                        : "border-emerald-500/30 bg-emerald-500/6"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 text-[11.5px]">
                    <span className="font-medium text-text">{g.label}</span>
                    <Pill tone={statusTone(g.status)}>
                      {g.used} / {g.limit} {g.unit} ({pct}%)
                    </Pill>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-900/90">
                    <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px]">
                    {g.errorCode && (
                      <span className="font-mono font-semibold text-text/90">{g.errorCode}</span>
                    )}
                    {g.detail && <span className="text-muted">{g.detail}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "policy-chain": {
      return (
        <div key={block.title} className="space-y-2 rounded-lg border border-border-subtle bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text">
              <ShieldAlert className="size-3.5 text-rose-400" />
              {block.title}
            </span>
            <Pill tone="critical">Multi-Hop Governance Evaluation</Pill>
          </div>
          <div className="space-y-2">
            {block.hops.map((hop, idx) => (
              <div
                key={`${hop.step}-${idx}`}
                className={`flex flex-col gap-1 rounded-md border p-2.5 text-[11.5px] ${
                  hop.effect === "Deny"
                    ? "border-critical/45 bg-critical/10"
                    : hop.effect === "Audit"
                      ? "border-warning/35 bg-warning/8"
                      : "border-border-subtle bg-elevated/60"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                      {hop.step}
                    </span>
                    <ArrowRight className="size-3 text-faint" />
                    <RolePermissionHoverPopover query={hop.node}>
                      <span className="font-mono font-semibold text-text">{hop.node}</span>
                    </RolePermissionHoverPopover>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {hop.code && <Mono>{hop.code}</Mono>}
                    <Pill tone={statusTone(hop.effect)}>{hop.effect}</Pill>
                  </div>
                </div>
                <div className="text-[11px] text-muted">{hop.detail}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "data-table": {
      const q = filterText.trim().toLowerCase();
      const filteredRows = q
        ? block.rows.filter((r) =>
            Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
          )
        : block.rows;
      return (
        <div key={block.title} className="space-y-2 rounded-lg border border-border-subtle bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text">
              <Database className="size-3.5 text-sky-400" />
              {block.title}
            </span>
            <span className="font-mono text-[10.5px] text-faint">{filteredRows.length} rows</span>
          </div>
          <DataTable
            head={block.columns.map((c) => c.label)}
            rows={filteredRows.map((row) =>
              block.columns.map((col) => {
                const val = String(row[col.key] ?? "—");
                const lowerVal = val.toLowerCase();
                if (lowerVal.includes("denied") || lowerVal.includes("blocked") || lowerVal.includes("100% full")) {
                  return <Pill tone="critical">{val}</Pill>;
                }
                if (lowerVal.includes("allowed") || lowerVal.includes("ready to deploy") || lowerVal.includes("operational")) {
                  return <Pill tone="healthy">{val}</Pill>;
                }
                if (lowerVal.includes("advisory")) {
                  return <Pill tone="warning">{val}</Pill>;
                }
                return <span className={col.mono ? "font-mono text-[11px]" : "text-[11.5px]"}>{val}</span>;
              }),
            )}
          />
        </div>
      );
    }

    case "config-diff": {
      return (
        <div key={block.title} className="space-y-2 rounded-lg border border-border-subtle bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text">
              <Code2 className="size-3.5 text-teal-400" />
              {block.title}
            </span>
            <Mono>{block.filePath}</Mono>
          </div>
          <DiffView diff={block.diff} />
        </div>
      );
    }

    case "event-stream": {
      return (
        <div key={block.title} className="space-y-2 rounded-lg border border-border-subtle bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text">
              <Activity className="size-3.5 text-amber-400" />
              {block.title}
            </span>
            <Pill tone="muted">{block.events.length} ARM events</Pill>
          </div>
          <DataTable
            head={["Timestamp (UTC)", "ARM Operation", "Status", "Error / Code", "Caller & Detail"]}
            rows={block.events.map((ev) => [
              <span className="font-mono text-[10.5px] text-faint">
                {ev.timestamp.replace("T", " ").replace("Z", "")}
              </span>,
              <span className="font-mono text-[11px]">{ev.operation}</span>,
              <Pill tone={statusTone(ev.status)}>{ev.status}</Pill>,
              <Mono>{ev.code}</Mono>,
              <div className="space-y-0.5 text-[11px]">
                <div className="font-mono text-[10.5px] text-sky-300">{ev.caller}</div>
                <div className="text-muted">{ev.detail}</div>
              </div>,
            ])}
          />
        </div>
      );
    }
  }
}

export function SynthesizedDynamicCard({
  props,
  triggeredBy,
}: {
  props: Props;
  triggeredBy: string[];
}) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const setDiffOpen = useWorkbench((s) => s.setDiffOpen);
  const [filterText, setFilterText] = useState("");

  const meta = props.synthesisMeta;
  const quotaBlock = props.blocks.find((b) => b.kind === "quota-gauges");
  const policyBlock = props.blocks.find((b) => b.kind === "policy-chain");
  const diffBlock = props.blocks.find((b) => b.kind === "config-diff");
  const eventBlock = props.blocks.find((b) => b.kind === "event-stream");

  return (
    <CardShell
      type="SynthesizedDynamicCard"
      icon={<Cloud />}
      title={props.title}
      state={props.state}
      triggeredBy={triggeredBy}
      source={`Synthesized UI (${props.elementId})`}
      codeLens={props.sourceRef}
      tabs={[
        { id: "all", label: "Full Diagnostic View", badge: props.blocks.length },
        ...(quotaBlock ? [{ id: "quota-gauges", label: "Regional Quotas", badge: quotaBlock.gauges.length }] : []),
        ...(policyBlock ? [{ id: "policy-chain", label: "Policy Evaluation Chain", badge: policyBlock.hops.length }] : []),
        ...(diffBlock ? [{ id: "config-diff", label: "Terraform / ARM Diff" }] : []),
        ...(eventBlock ? [{ id: "event-stream", label: "ARM Activity Log", badge: eventBlock.events.length }] : []),
      ]}
      summary={
        <div className="space-y-1.5">
          <div className="text-[12.5px] leading-snug text-text">{props.headline}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <span className="inline-flex items-center gap-1 rounded border border-teal-500/35 bg-teal-500/10 px-1.5 py-0.5 font-mono text-teal-300">
              <Sparkles className="size-3" />
              Stage 1 ({meta.gatekeeperModel}) → Stage 2 ({meta.synthesizerModel})
            </span>
            <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5 font-mono text-muted">
              {meta.reusedFromCatalog ? `Reused from dynamic-catalog.json (×${meta.reuseCount})` : "Persisted to data/dynamic-catalog.json"}
            </span>
            <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5 font-mono text-faint">
              {meta.tsxStubPath}
            </span>
          </div>
        </div>
      }
      primaryAction={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            icon={<GitCompareArrows />}
            onClick={() => {
              setDiffOpen(true, "SynthesizedDynamicCard");
              openRemediation({ tab: "terraform", focusBanner: "Focused: Azure VM Region & Policy Terraform Fix" });
            }}
          >
            Open Terraform Diff &amp; Fix
          </Button>
          <Button
            size="xs"
            variant="meta"
            icon={<Wrench />}
            onClick={() => openRemediation({ tab: "powershell", focusBanner: `Focused: Azure VM Quota & Policy Remediation (${props.elementId})` })}
          >
            Stage Azure VM Fix
          </Button>
        </div>
      }
    >
      {(tab) => {
        const blocksToRender =
          tab === "all" ? props.blocks : props.blocks.filter((b) => b.kind === tab);

        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-teal-500/25 bg-teal-500/6 px-2.5 py-1.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stat label="Synthesized Element:" tone="primary">
                  {props.elementId}
                </Stat>
                <Stat label="Primitives:" tone="healthy">
                  {props.requiredPrimitives.join(" · ")}
                </Stat>
              </div>
              <input
                type="search"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter regions / SKUs..."
                className="h-6 rounded border border-border-subtle bg-slate-950/80 px-2 font-mono text-[11px] text-text placeholder:text-faint focus:border-teal-400 focus:outline-none"
              />
            </div>

            {blocksToRender.map((b) => renderBlock(b, filterText))}

            {props.recommendedActions.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-elevated/50 p-2.5">
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-text">
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                  <span>Recommended Remediation Actions</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {props.recommendedActions.map((act) => (
                    <Button
                      key={act.id}
                      size="xs"
                      variant={act.kind === "stage-fix" ? "meta" : "outline"}
                      icon={act.kind === "view-diff" ? <GitCompareArrows /> : <Wrench />}
                      onClick={() =>
                        openRemediation({
                          tab: act.kind === "view-diff" ? "terraform" : "powershell",
                          focusBanner: `Focused: ${act.label}`,
                        })
                      }
                      title={act.command ?? act.description}
                    >
                      {act.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </CardShell>
  );
}
export default SynthesizedDynamicCard;
