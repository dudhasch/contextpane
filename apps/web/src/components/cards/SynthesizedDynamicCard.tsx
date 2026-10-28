import { Cloud, GitCompareArrows, Search, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SynthesizedBlock, SynthesizedDynamicCard as Props } from "@contextpane/catalog";
import { humanizeStatus } from "@/lib/format";
import { useWorkbench } from "@/store";
import { DataTable, Ghost, GhostLines, Section, SmartTechPath } from "../canvas/Section";
import { DiffView } from "../canvas/DiffView";
import { Button } from "../ui/Button";
import { Pill, TONE_TEXT, type Tone } from "../ui/Pill";
import { RolePermissionHoverPopover } from "../ui/RolePermissionHoverPopover";

function statusTone(state: string): Tone {
  if (state === "critical" || state === "Deny" || state === "Failed") return "critical";
  if (state === "warning" || state === "Audit" || state === "Warning") return "warning";
  if (state === "healthy" || state === "Allow" || state === "Pass" || state === "Succeeded") return "healthy";
  return "muted";
}

/** Tone of a free-text table value: the value cell carries the colour, there is no status column. */
function valueTone(value: string): Tone | null {
  const v = value.toLowerCase();
  if (v.includes("denied") || v.includes("blocked") || v.includes("100% full")) return "critical";
  if (v.includes("advisory")) return "warning";
  if (v.includes("allowed") || v.includes("ready to deploy") || v.includes("operational")) return "healthy";
  return null;
}

/** ARM ids, OMA-URIs, registry keys and file paths: no spaces, at least two separators. */
const isPathLike = (value: string) => value.length > 24 && !/\s/.test(value) && (value.match(/[\\/]/g)?.length ?? 0) >= 2;

const TRACK_FILL: Record<string, string> = { critical: "bg-critical", warning: "bg-warning" };

/**
 * Nested module inside the surface card (WP10): every block is its own hairline-framed box on the
 * ground fill, its `BlockHead` the box's header row.
 */
const BLOCK_FRAME = "overflow-hidden rounded-md border border-hairline bg-ground [--module:var(--ground)]";

/**
 * Block sub-head without the card title the agent repeats in front of it:
 * `Azure Region Capacity · Resource & State Metrics` under that card reads `Resource & State Metrics`.
 */
function blockLabel(title: string, cardTitle?: string): string {
  const at = title.lastIndexOf(" · ");
  if (at > 0) return title.slice(at + 3).trim() || title;
  if (cardTitle) {
    const prefix = cardTitle.trim().toLowerCase();
    if (prefix && title.toLowerCase().startsWith(prefix)) {
      const rest = title.slice(cardTitle.trim().length).replace(/^\s*[-–—:|]\s*/, "").trim();
      if (rest) return rest;
    }
  }
  return title;
}

/** Header row of a block box: faint uppercase label (wraps, never truncates), the block's count in mono, hairline-2 below. */
function BlockHead({ label, cardTitle, count, aside }: { label: string; cardTitle?: string; count?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 border-b border-hairline-2 px-3 py-1.5" data-block-head="">
      <span className="min-w-0 text-11 font-medium tracking-wider text-faint uppercase" title={label}>
        {blockLabel(label, cardTitle)}
      </span>
      {count !== undefined && <span className="shrink-0 font-mono text-11 text-faint">{count}</span>}
      {aside && <span className="ml-auto min-w-0 truncate font-mono text-11 text-faint">{aside}</span>}
    </div>
  );
}

function diffCount(diff: string): string {
  let add = 0;
  let del = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) add++;
    else if (line.startsWith("-")) del++;
  }
  return `+${add} −${del}`;
}

/**
 * WP6: while a refine streams, every block stays mounted with its values ghosted; when the UI
 * Architect's card lands, the blocks refill one after another (90 ms apart) instead of all at once.
 */
const REFILL_STEP_MS = 90;

function useBlockRefill(pending: boolean, count: number): (index: number) => boolean {
  const [revealed, setRevealed] = useState(Number.POSITIVE_INFINITY);
  const wasPending = useRef(pending);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setRevealed(0);
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= count) window.clearInterval(timer);
    }, REFILL_STEP_MS);
    return () => window.clearInterval(timer);
  }, [pending, count]);
  return (index) => pending || index >= revealed;
}

function renderBlock(block: SynthesizedBlock, filterText: string, pending = false, cardTitle?: string) {
  switch (block.kind) {
    case "quota-gauges":
      return (
        <div key={block.title} data-block={block.kind} data-ghost={pending || undefined} className={BLOCK_FRAME}>
          <BlockHead label={block.title} cardTitle={cardTitle} count={block.gauges.length} />
          <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 px-3 py-2 sm:grid-cols-2">
            {block.gauges.map((g) => {
              const pct = Math.min(100, Math.round((g.used / Math.max(1, g.limit)) * 100));
              const tone = statusTone(g.status);
              return (
                <div key={g.id} className="min-w-0">
                  <div className="flex min-w-0 items-baseline justify-between gap-2 text-12">
                    <span className="min-w-0 truncate text-text" title={g.label}>
                      {g.label}
                    </span>
                    <Ghost pending={pending} className={`shrink-0 font-mono text-12 ${tone === "muted" || tone === "healthy" ? "text-text" : TONE_TEXT[tone]}`}>
                      {g.used}/{g.limit} {g.unit} · {pct}%
                    </Ghost>
                  </div>
                  <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-raised">
                    <div
                      className={`h-full transition-[width,opacity] duration-150 ease-[var(--ease-ops)] ${TRACK_FILL[g.status] ?? "bg-signal"} ${pending ? "opacity-0" : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {(g.errorCode || g.detail) && (
                    <div className="mt-1 flex min-w-0 items-baseline gap-1.5 text-11">
                      {g.errorCode && (
                        <Ghost pending={pending} className="shrink-0 font-mono text-muted">
                          {g.errorCode}
                        </Ghost>
                      )}
                      {g.detail && (
                        <span className="min-w-0 truncate text-faint" title={g.detail}>
                          <Ghost pending={pending}>{g.detail}</Ghost>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );

    case "policy-chain":
      return (
        <div key={block.title} data-block={block.kind} data-ghost={pending || undefined} className={BLOCK_FRAME}>
          <BlockHead label={block.title} cardTitle={cardTitle} count={block.hops.length} />
          <ol className="mx-3 my-2 space-y-1.5 border-l-2 border-[color:var(--cat)] pl-3">
            {block.hops.map((hop, idx) => (
              <li key={`${hop.step}-${idx}`} className="min-w-0 text-12">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-11 text-faint">{hop.step}</span>
                  <span aria-hidden className="shrink-0 text-faint">
                    →
                  </span>
                  <RolePermissionHoverPopover query={hop.node}>
                    <span className="truncate font-mono font-semibold text-text">{hop.node}</span>
                  </RolePermissionHoverPopover>
                  <Ghost pending={pending} className="ml-auto flex shrink-0 items-center gap-2">
                    {hop.code && <span className="font-mono text-11 text-faint">{hop.code}</span>}
                    <Pill variant="status" tone={statusTone(hop.effect)}>
                      {hop.effect}
                    </Pill>
                  </Ghost>
                </div>
                <div className="text-11 text-muted">
                  <Ghost pending={pending}>{hop.detail}</Ghost>
                </div>
              </li>
            ))}
          </ol>
        </div>
      );

    case "data-table": {
      const q = filterText.trim().toLowerCase();
      const filteredRows = q ? block.rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q))) : block.rows;
      return (
        <div key={block.title} data-block={block.kind} data-ghost={pending || undefined} className={BLOCK_FRAME}>
          <BlockHead label={block.title} cardTitle={cardTitle} count={q ? `${filteredRows.length}/${block.rows.length}` : block.rows.length} />
          <DataTable
            className="px-3 pb-1"
            head={block.columns.map((c) => c.label)}
            rows={filteredRows.map((row) =>
              block.columns.map((col) => {
                const val = String(row[col.key] ?? "—");
                if (isPathLike(val)) return <SmartTechPath path={val} ghost={pending} />;
                const tone = valueTone(val);
                return (
                  <Ghost pending={pending} className={`${col.mono ? "font-mono" : ""} ${tone ? TONE_TEXT[tone] : "text-text"}`}>
                    <span title={val}>{val}</span>
                  </Ghost>
                );
              }),
            )}
          />
        </div>
      );
    }

    case "config-diff":
      return (
        <div key={block.title} data-block={block.kind} data-ghost={pending || undefined} className={BLOCK_FRAME}>
          <BlockHead label={block.title} cardTitle={cardTitle} count={diffCount(block.diff)} aside={<span title={block.filePath}>{block.filePath}</span>} />
          {pending ? (
            <GhostLines lines={block.diff.replace(/\r\n/g, "\n").split("\n")} className="max-h-72" />
          ) : (
            <DiffView diff={block.diff} maxHeight="max-h-72" edges="none" className="animate-fade-in" />
          )}
        </div>
      );

    case "event-stream": {
      const isArm = /\barm\b/i.test(block.title);
      return (
        <div key={block.title} data-block={block.kind} data-ghost={pending || undefined} className={BLOCK_FRAME}>
          <BlockHead label={block.title} cardTitle={cardTitle} count={`${block.events.length} ${isArm ? "ARM" : "audit"}`} />
          <ul className="divide-y divide-hairline-2 px-3 font-mono text-11">
            {block.events.map((ev) => (
              <li key={ev.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1">
                <span className="text-faint" title={ev.timestamp}>
                  <Ghost pending={pending}>{ev.timestamp.replace("T", " ").replace(/(\.\d+)?Z$/, "").slice(5)}</Ghost>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-12 text-text" title={ev.operation}>
                    <Ghost pending={pending}>{ev.operation}</Ghost>
                  </span>
                  <span className="block truncate text-muted" title={`${ev.caller} · ${ev.detail}`}>
                    <Ghost pending={pending}>
                      {ev.caller} <span className="font-sans">· {ev.detail}</span>
                    </Ghost>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <Ghost pending={pending} className={TONE_TEXT[statusTone(ev.status)]}>
                    {humanizeStatus(ev.status)}
                  </Ghost>
                  <Ghost pending={pending} className="text-faint">
                    {ev.code}
                  </Ghost>
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
}

export function SynthesizedDynamicCard({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const [filterText, setFilterText] = useState("");
  // WP6: a refine keeps this section mounted; its blocks ghost until the UI Architect's card lands.
  const pending = useWorkbench((s) => s.pendingRefine.elements);
  const blockPending = useBlockRefill(pending, props.blocks.length);

  const meta = props.synthesisMeta;
  const quotaBlock = props.blocks.find((b) => b.kind === "quota-gauges");
  const policyBlock = props.blocks.find((b) => b.kind === "policy-chain");
  const tableBlock = props.blocks.find((b) => b.kind === "data-table");
  const diffBlock = props.blocks.find((b) => b.kind === "config-diff");
  const eventBlock = props.blocks.find((b) => b.kind === "event-stream");

  const stageAction = props.recommendedActions.find((a) => a.kind === "stage-fix") ?? props.recommendedActions[0];
  const diffAction = props.recommendedActions.find((a) => a.kind === "view-diff");

  const primaryCtaLabel = stageAction?.label ?? "Stage remediation fix";
  const diffCtaLabel = diffAction?.label ?? "Inspect Configuration & IaC Diff";

  const dynamicFilterPlaceholder =
    tableBlock && tableBlock.columns.length >= 2
      ? `Filter ${tableBlock.columns
          .slice(0, 2)
          .map((c) => c.label.toLowerCase())
          .join(" / ")}…`
      : "Filter rows…";

  return (
    <Section
      type="SynthesizedDynamicCard"
      icon={<Cloud />}
      title={props.title}
      state={props.state}
      triggeredBy={triggeredBy}
      synthesized
      ghost={pending}
      source={meta.source === "fallback" ? "template" : meta.synthesizerModel}
      footerMeta={meta.reusedFromCatalog ? `verified view ×${meta.reuseCount}` : "synthesized view"}
      details={
        <div className="space-y-1">
          <p>{props.reason}</p>
          <p className="font-mono text-faint">
            {meta.gatekeeperModel} → {meta.synthesizerModel}
            {meta.latencyMs > 0 ? ` · ${(meta.latencyMs / 1000).toFixed(1)}s` : ""}
          </p>
        </div>
      }
      tabs={[
        { id: "all", label: "All", badge: props.blocks.length },
        ...(quotaBlock ? [{ id: "quota-gauges", label: "Quota", badge: quotaBlock.gauges.length }] : []),
        ...(policyBlock ? [{ id: "policy-chain", label: "Policy", badge: policyBlock.hops.length }] : []),
        ...(tableBlock ? [{ id: "data-table", label: "Table", badge: tableBlock.rows.length }] : []),
        ...(diffBlock ? [{ id: "config-diff", label: "Diff" }] : []),
        ...(eventBlock ? [{ id: "event-stream", label: "Activity", badge: eventBlock.events.length }] : []),
      ]}
      summary={props.headline}
      toolbar={
        tableBlock && (
          <label className="flex items-center gap-1 text-faint focus-within:text-text">
            <Search aria-hidden className="size-3 shrink-0" />
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={dynamicFilterPlaceholder}
              aria-label="Filter table rows"
              className="h-6 w-[150px] border-b border-hairline bg-transparent text-12 text-text placeholder:text-faint focus:border-signal focus:outline-none"
            />
          </label>
        )
      }
    >
      {(tab) => {
        const blocksToRender = tab === "all" ? props.blocks : props.blocks.filter((b) => b.kind === tab);
        return (
          <div>
            <div className="space-y-2">{blocksToRender.map((b) => renderBlock(b, filterText, blockPending(props.blocks.indexOf(b)), props.title))}</div>
            {/* The section's one action row. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-hairline-2 pt-2">
              <Button
                size="xs"
                variant="outline"
                icon={<Wrench />}
                data-testid="synth-stage-fix-btn"
                onClick={() => openRemediation({ tab: "powershell", focusBanner: `Focused: ${primaryCtaLabel}` })}
              >
                {primaryCtaLabel}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={<GitCompareArrows />}
                data-testid="synth-diff-btn"
                onClick={() => openRemediation({ tab: "terraform", focusBanner: `Focused: ${diffCtaLabel}` })}
              >
                {diffCtaLabel}
              </Button>
            </div>
          </div>
        );
      }}
    </Section>
  );
}
export default SynthesizedDynamicCard;
