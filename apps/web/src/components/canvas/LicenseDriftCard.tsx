import { BadgeCheck, Wrench } from "lucide-react";
import type { AssignmentState, LicenseDriftCard as Props } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, type Tone } from "../ui/Pill";
import { CardShell, DataTable, Stat } from "./CardShell";

const STATE_TONE: Record<AssignmentState, Tone> = {
  Active: "healthy",
  Reclaimed: "healthy",
  Drifted: "warning",
  "Error: CountViolation": "critical",
  Orphaned: "critical",
};

/**
 * Compact label for long SKU part numbers so the columns never collide: every
 * segment but the last is cut to 4 characters (INFORMATION_PROTECTION_COMPLIANCE →
 * INFO_PROT_COMPLIANCE). The full part number stays in the tooltip.
 */
export function shortSku(sku: string, max = 16): string {
  if (sku.length <= max) return sku;
  const parts = sku.split("_");
  if (parts.length === 1) return `${sku.slice(0, max - 1)}…`;
  const last = parts[parts.length - 1]!;
  const head = parts.slice(0, -1).map((p) => p.slice(0, 4));
  const out = [...head, last].join("_");
  return out.length <= max + 6 ? out : `${out.slice(0, max + 5)}…`;
}

/** Expanded-tab only: Git ↔ Live Graph ↔ Pax8 contract seat paths. Nothing on the collapsed card. */
function CommercialSubTab() {
  const rec = useWorkbench((s) => s.commercial);
  const loadOps = useWorkbench((s) => s.loadOps);
  if (!rec) return <button type="button" onClick={() => void loadOps()} className="text-[11.5px] text-primary hover:underline">Load 3-Way Commercial &amp; Seat Reconciler…</button>;
  return (
    <div className="space-y-1.5 text-[11.5px]" data-testid="commercial-subtab">
      <div><span className="text-healthy">Path A · {rec.pathA.label}:</span> <span className="text-muted">$0/mo net · ${rec.pathA.wasteEliminatedMonthly}/mo waste eliminated</span></div>
      <div><span>Path B · {rec.pathB.label}:</span> <span className="text-muted">+${rec.pathB.netDeltaMonthly}/mo prorated ({rec.contractId})</span></div>
    </div>
  );
}

function SkuBadges({ skus, muted = false }: { skus: string; muted?: boolean }) {
  const list = skus.split(",").map((s) => s.trim());
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((sku) => (
        <span key={sku} title={sku} className={`inline-block rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${muted || sku === "NONE" ? "text-muted" : "text-text"}`}>
          {shortSku(sku)}
        </span>
      ))}
    </span>
  );
}

/** License Pool & Assignment card (amber). */
export function LicenseDriftCardView({ props, triggeredBy }: { props: Props; triggeredBy: string[] }) {
  const openRemediation = useWorkbench((s) => s.openRemediation);
  const remediateStatus = useWorkbench((s) => s.remediateStatus);
  const open = props.users.filter((u) => u.assignmentState !== "Active" && u.assignmentState !== "Reclaimed");
  const errors = props.groupErrors.reduce((n, e) => n + e.affectedUsers, 0);
  const live = props.skuPools.some((p) => p.source === "live-graph");
  return (
    <CardShell
      type="LicenseDriftCard"
      icon={<BadgeCheck />}
      title={`License Pool & Assignment · ${props.groupName}`}
      state={props.state}
      triggeredBy={triggeredBy}
      source={live ? "live subscribedSkus" : "pool: fixture"}
      tabs={[
        { id: "users", label: "Assignments", badge: props.users.length },
        { id: "pool", label: "SKU Pools", badge: props.skuPools.length },
        { id: "commercial", label: "3-Way Reconciler" },
      ]}
      summary={
        <div className="space-y-1">
          <div className="text-[12.5px] leading-snug">{props.headline}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {props.skuPools.map((p) => (
              <Stat key={p.skuPartNumber} label={`${p.skuPartNumber} Pool:`} tone={p.available <= 0 ? "critical" : undefined}>
                {p.skuPartNumber === props.skuPartNumber || !p.note ? `${p.consumed}/${p.enabled} assigned · ${p.available} available` : p.note}
              </Stat>
            ))}
            <Stat label="Group Errors:" tone={errors ? "critical" : "healthy"}>
              {props.groupErrors.length ? props.groupErrors.map((e) => `${e.state} (${e.affectedUsers})`).join(", ") : "0"}
            </Stat>
          </div>
        </div>
      }
      primaryAction={
        open.length > 0 && (
          <Button size="xs" variant="meta" icon={<Wrench />} loading={remediateStatus === "loading"} onClick={() => openRemediation({ tab: "powershell" })}>
            Stage License Remediation
          </Button>
        )
      }
    >
      {(tab) =>
        tab === "commercial" ? (
          <CommercialSubTab />
        ) : tab === "pool" ? (
          <div className="space-y-2">
            <DataTable
              head={["SKU", "Enabled", "Consumed", "Available", "Source"]}
              rows={props.skuPools.map((p) => [
                <span title={p.skuName} className="font-mono">
                  {p.skuPartNumber}
                </span>,
                <span className="font-mono">{p.enabled}</span>,
                <span className="font-mono">{p.consumed}</span>,
                <span className={`font-mono ${p.available <= 0 ? "text-critical" : "text-healthy"}`}>{p.available}</span>,
                <span className="text-faint">{p.source === "live-graph" ? "live Graph" : "fixture"}</span>,
              ])}
            />
            {props.groupErrors.map((e) => (
              <div key={e.groupName + e.skuPartNumber} className="rounded-md border border-critical/30 bg-critical/8 px-2.5 py-1.5 text-[11.5px]">
                <span className="font-mono text-critical">{e.groupName} · State: Error · {e.state}</span>
                <div className="text-muted">{e.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          <DataTable
            head={["User", "Account", "Assigned SKU", "Expected SKU", "Path", "Assignment State"]}
            rows={props.users.map((u) => [
              <div className="min-w-0" title={u.upn}>
                <div className="leading-tight">{u.displayName}</div>
                <div className="truncate font-mono text-[10px] text-faint">{u.upn}</div>
              </div>,
              <span className={u.accountEnabled ? "text-text" : "text-warning"}>
                {u.accountEnabled ? "Enabled" : "Disabled"}
                {u.lastSignIn && !u.accountEnabled ? <span className="block font-mono text-[10px] text-faint">last {u.lastSignIn.slice(0, 10)}</span> : null}
              </span>,
              <SkuBadges skus={u.currentSku} />,
              <SkuBadges skus={u.expectedSku} muted />,
              <span className="font-mono text-[11px] whitespace-nowrap text-muted">{u.assignmentPath}</span>,
              <Pill tone={STATE_TONE[u.assignmentState]}>{u.assignmentState}</Pill>,
            ])}
          />
        )
      }
    </CardShell>
  );
}
