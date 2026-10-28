import { PiggyBank } from "lucide-react";
import { TIER_COLOR, TIER_ROUTE, fmtMs, fmtTokens } from "@/lib/format";
import { useWorkbench } from "@/store";
import type { RouterTier } from "@contextpane/catalog";
import { Dot, Pill, TONE_DOT, TONE_TEXT, type Tone } from "../ui/Pill";

/** Fallback when the orchestrator has not sent a price yet (mirrors CTX_PRICE_USD_PER_1M_TOKENS default). */
const DEFAULT_USD_PER_1M_TOKENS = 1.0;

interface TierRow {
  key: string;
  tiers: RouterTier[];
  label: string;
  route: string;
  tone: Tone;
}

/** The five routing tiers a judge should see, always, even before a tier has served a request. */
const TIER_ROWS: TierRow[] = [
  { key: "t0", tiers: ["Tier 0"], ...TIER_ROUTE["Tier 0"], tone: "primary" },
  { key: "t1a", tiers: ["Tier 1A"], ...TIER_ROUTE["Tier 1A"], tone: "healthy" },
  { key: "t1b", tiers: ["Tier 1B"], ...TIER_ROUTE["Tier 1B"], tone: "meta" },
  { key: "t2", tiers: ["Tier 2"], ...TIER_ROUTE["Tier 2"], tone: "meta" },
  { key: "t3", tiers: ["Tier 3A", "Tier 3B"], ...TIER_ROUTE["Tier 3A"], tone: "warning" },
];

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Tallies what Tier 0 recipes saved versus a full Tier 2 correlate, per tier (System & Audit drawer). */
export function RouterSavingsBody() {
  const stats = useWorkbench((s) => s.stats);
  const history = useWorkbench((s) => s.telemetryHistory);

  const baseline = stats?.tier2Baseline ?? { tokens: 6200, ms: 4800 };
  const zero = stats?.zeroTokenRequests ?? 0;
  const saved = stats?.estimatedSavings ?? { tokens: 0, ms: 0 };
  const pricePer1M = stats?.pricing?.usdPer1MTokens ?? DEFAULT_USD_PER_1M_TOKENS;
  const usdSaved = saved.usd ?? (saved.tokens / 1_000_000) * pricePer1M;
  const total = stats?.totalRequests ?? 0;
  const spent = stats?.totalTokens ?? 0;
  const pct = total ? Math.round((zero / total) * 100) : 0;

  const rows = TIER_ROWS.map((row) => {
    const parts = row.tiers.map((t) => stats?.tiers[t]).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const requests = parts.reduce((n, s) => n + s.requests, 0);
    const totalLatency = parts.reduce((n, s) => n + s.avgLatencyMs * s.requests, 0);
    const tokens = parts.reduce((n, s) => n + s.totalTokens, 0);
    const byProvider: Record<string, number> = {};
    for (const s of parts) for (const [p, n] of Object.entries(s.byProvider)) byProvider[p] = (byProvider[p] ?? 0) + n;
    return { ...row, requests, avgMs: requests ? Math.round(totalLatency / requests) : 0, tokens, byProvider };
  });
  const extras = (
    [
      ["Voice", "Voice steer"],
      ["Vision", "Tier 2 · Vision"],
    ] as const
  ).flatMap(([tier, label]) => {
    const s = stats?.tiers[tier];
    return s ? [{ tier, label, s }] : [];
  });

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <PiggyBank className="size-4 text-primary" />
        <span className="text-[13px] font-semibold">Router savings</span>
        <Pill tone="primary">vs Tier 2 · {fmtTokens(baseline.tokens)} tok / {fmtMs(baseline.ms)}</Pill>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="0-token req" value={`${zero}`} sub={`${pct}% of ${total}`} tone="primary" />
        <Stat label="Tokens saved" value={fmtTokens(saved.tokens)} sub={`${fmtTokens(spent)} spent`} tone="healthy" />
        <Stat label="Latency saved" value={fmtMs(saved.ms)} sub="cumulative" tone="healthy" />
        <Stat label="API credit saved" value={fmtUsd(usdSaved)} sub={`@ $${pricePer1M.toFixed(2)}/1M tok`} tone="healthy" title="Estimated: tokens saved × blended price (CTX_PRICE_USD_PER_1M_TOKENS)" />
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-surface">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-faint">share of requests answered without a model</div>

      <table className="mt-3 w-full text-[11px]">
        <thead className="text-faint">
          <tr>
            <th className="py-1 text-left font-medium">Tier · route</th>
            <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">Req</th>
            <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">Avg ms</th>
            <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">Tokens</th>
            <th className="py-1 pl-2 text-left font-medium">Served by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-t border-border-subtle ${r.requests === 0 ? "text-faint" : ""}`}>
              <td className="py-1 pr-2">
                <span className="flex items-center gap-1.5">
                  <Dot tone={r.tone} />
                  <span className="font-medium text-text">{r.label}</span>
                </span>
                <span className="block pl-3.5 font-mono text-[10px] text-faint">{r.route}</span>
              </td>
              <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">{r.requests}</td>
              <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">{r.requests ? r.avgMs : "–"}</td>
              <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">{r.requests ? fmtTokens(r.tokens) : "–"}</td>
              <td className="py-1 pl-2 font-mono text-muted">
                {Object.entries(r.byProvider)
                  .map(([p, n]) => `${p}×${n}`)
                  .join(" ") || "–"}
              </td>
            </tr>
          ))}
          {extras.map(({ tier, label, s }) => (
            <tr key={tier} className="border-t border-border-subtle">
              <td className="py-1 pr-2">
                <span className="flex items-center gap-1.5">
                  <Dot tone="meta" />
                  <span className="font-medium text-text">{label}</span>
                </span>
                <span className="block pl-3.5 font-mono text-[10px] text-faint">{TIER_ROUTE[tier].route}</span>
              </td>
              <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">{s.requests}</td>
              <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">{s.avgLatencyMs}</td>
              <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">{fmtTokens(s.totalTokens)}</td>
              <td className="py-1 pl-2 font-mono text-muted">
                {Object.entries(s.byProvider)
                  .map(([p, n]) => `${p}×${n}`)
                  .join(" ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {history.length > 0 && (
        <div className="mt-3 flex h-8 items-end gap-0.5" title="last requests: bar = latency, colour = tier">
          {history.slice(-40).map((e) => (
            <div
              key={e.requestId}
              className={`flex-1 rounded-sm ${TONE_DOT[TIER_COLOR[e.tier] as Tone]}`}
              style={{ height: `${Math.max(8, Math.min(100, (Math.log10(e.latencyMs + 1) / 4.5) * 100))}%`, opacity: 0.85 }}
              title={`${e.tier} · ${e.provider} · ${e.latencyMs} ms · ${e.tokensUsed.total} tok`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone, title }: { label: string; value: string; sub: string; tone: Tone; title?: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface p-2" title={title}>
      <div className="truncate text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`truncate font-mono text-lg leading-tight ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="truncate text-[11px] text-muted">{sub}</div>
    </div>
  );
}
