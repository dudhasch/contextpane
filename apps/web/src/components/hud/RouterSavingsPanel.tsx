import { PiggyBank, X } from "lucide-react";
import { TIER_COLOR, fmtMs, fmtTokens } from "@/lib/format";
import { useWorkbench } from "@/store";
import type { RouterTier } from "@contextpane/catalog";
import { Dot, Pill, TONE_DOT, TONE_TEXT, type Tone } from "../ui/Pill";

const TIER_ORDER: RouterTier[] = ["Tier 0", "Tier 1A", "Tier 1B", "Tier 2", "Tier 3A", "Tier 3B", "Voice"];

/** Tallies what Tier 0 recipes saved versus a full Tier 2 correlate. */
export function RouterSavingsPanel() {
  const open = useWorkbench((s) => s.savingsOpen);
  const stats = useWorkbench((s) => s.stats);
  const history = useWorkbench((s) => s.telemetryHistory);
  const close = () => useWorkbench.getState().setSavingsOpen(false);
  if (!open) return null;

  const baseline = stats?.tier2Baseline ?? { tokens: 6200, ms: 4800 };
  const zero = stats?.zeroTokenRequests ?? 0;
  const saved = stats?.estimatedSavings ?? { tokens: 0, ms: 0 };
  const total = stats?.totalRequests ?? 0;
  const spent = stats?.totalTokens ?? 0;
  const pct = total ? Math.round((zero / total) * 100) : 0;

  return (
    <aside className="absolute top-14 right-3 z-30 w-[380px] animate-fade-in card shadow-popover">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PiggyBank className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">Router savings</span>
          <Pill tone="primary">vs Tier 2 · {fmtTokens(baseline.tokens)} tok / {fmtMs(baseline.ms)}</Pill>
        </div>
        <button type="button" onClick={close} className="text-faint hover:text-text" aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="0-token requests" value={`${zero}`} sub={`${pct}% of ${total}`} tone="primary" />
        <Stat label="Tokens saved" value={fmtTokens(saved.tokens)} sub={`${fmtTokens(spent)} spent`} tone="healthy" />
        <Stat label="Latency saved" value={fmtMs(saved.ms)} sub="cumulative" tone="healthy" />
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-surface">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-faint">share of requests answered without a model</div>

      <table className="mt-3 w-full text-[11px]">
        <thead className="text-faint">
          <tr>
            <th className="py-1 text-left font-medium">Tier</th>
            <th className="py-1 text-right font-medium">Req</th>
            <th className="py-1 text-right font-medium">Avg ms</th>
            <th className="py-1 text-right font-medium">Tokens</th>
            <th className="py-1 text-left font-medium pl-2">Providers</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {TIER_ORDER.filter((t) => stats?.tiers[t]).map((t) => {
            const row = stats!.tiers[t]!;
            return (
              <tr key={t} className="border-t border-border-subtle">
                <td className="py-1">
                  <span className="flex items-center gap-1.5">
                    <Dot tone={TIER_COLOR[t] as Tone} />
                    {t}
                  </span>
                </td>
                <td className="py-1 text-right">{row.requests}</td>
                <td className="py-1 text-right">{row.avgLatencyMs}</td>
                <td className="py-1 text-right">{fmtTokens(row.totalTokens)}</td>
                <td className="py-1 pl-2 text-muted">
                  {Object.entries(row.byProvider)
                    .map(([p, n]) => `${p}×${n}`)
                    .join(" ")}
                </td>
              </tr>
            );
          })}
          {!stats?.tiers || Object.keys(stats.tiers).length === 0 ? (
            <tr>
              <td colSpan={5} className="py-2 text-center text-faint">
                no requests yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {history.length > 0 && (
        <div className="mt-3 flex h-8 items-end gap-0.5" title="last requests: bar = latency, colour = tier">
          {history.slice(-32).map((e) => (
            <div
              key={e.requestId}
              className={`flex-1 rounded-sm ${TONE_DOT[TIER_COLOR[e.tier] as Tone]}`}
              style={{ height: `${Math.max(8, Math.min(100, (Math.log10(e.latencyMs + 1) / 4.5) * 100))}%`, opacity: 0.85 }}
              title={`${e.tier} · ${e.provider} · ${e.latencyMs} ms · ${e.tokensUsed.total} tok`}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: Tone }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface p-2">
      <div className="text-[10px] text-faint uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-lg leading-tight ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="text-[10px] text-muted">{sub}</div>
    </div>
  );
}
