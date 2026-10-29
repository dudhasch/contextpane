import { CircleCheckBig, ExternalLink, FileCheck2, GitBranch, History, RotateCcw, ShieldCheck, ShieldX, Zap } from "lucide-react";
import type { AuditActionType, AuditEntry } from "@contextpane/catalog";
import { fmtMs } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Pill, TONE_TEXT, type Tone } from "../ui/Pill";

const ACTION: Record<AuditActionType, { label: string; tone: Tone; icon: React.ReactNode }> = {
  "remediation-verified": { label: "Pre-flight verified", tone: "primary", icon: <FileCheck2 /> },
  "hitl-approval": { label: "HITL approval", tone: "healthy", icon: <ShieldCheck /> },
  "hitl-rejection": { label: "HITL rejection", tone: "critical", icon: <ShieldX /> },
  "drift-reset": { label: "Demo drift reset", tone: "muted", icon: <RotateCcw /> },
  "autonomous-rollback": { label: "Auto-rollback (previous state restored)", tone: "critical", icon: <History /> },
  "fleet-campaign": { label: "Multi-client fix PRs created", tone: "warning", icon: <Zap /> },
  "ticket-closed": { label: "Ticket closed in PSA", tone: "healthy", icon: <CircleCheckBig /> },
  "ticket-reopened": { label: "Ticket reopened", tone: "warning", icon: <RotateCcw /> },
  "preflight-autofix": { label: "Auto-fix + pre-flight re-run", tone: "primary", icon: <FileCheck2 /> },
  "preflight-override": { label: "Pre-flight overridden (justified)", tone: "warning", icon: <ShieldX /> },
  "hitl-rollback": { label: "Revert (inverse from pre-change snapshot)", tone: "warning", icon: <RotateCcw /> },
};

function check(v: boolean | null): { text: string; className: string } {
  if (v === null) return { text: "–", className: "text-faint" };
  return v ? { text: "pass", className: "text-healthy" } : { text: "fail", className: "text-critical" };
}

/** Tier 3 verifiable audit ledger (data/audit-log.json): who ran what, as which identity, verified where. */
export function AuditLogBody() {
  const entries = useWorkbench((s) => s.audit);

  const approvals = entries.filter((e) => e.actionType === "hitl-approval").length;
  const verified = entries.filter((e) => e.modalSandboxVerified).length;
  const live = entries.filter((e) => e.execution === "live-graph").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-13 font-semibold">Verifiable audit ledger</span>
        <span className="font-mono text-11 text-faint">data/audit-log.json</span>
      </div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-12 text-muted">
        <span>
          <span className="font-mono text-text">{approvals}</span> HITL approvals
        </span>
        <span>
          <span className="font-mono text-text">{verified}</span> Modal-sandbox verified
        </span>
        <span>
          <span className="font-mono text-text">{live}</span> Live Graph executions
        </span>
        <span className="ml-auto text-11 text-faint">GDAP / delegated identity on every row</span>
      </div>
      {entries.length === 0 ? (
        <div className="py-6 text-center text-12 text-muted">No Tier 3 actions yet. Stage a fix, approve it or reset the drift.</div>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-hairline-2 overflow-y-auto border-y border-hairline">
          {entries.map((e) => (
            <AuditRow key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AuditRow({ entry: e }: { entry: AuditEntry }) {
  const a = ACTION[e.actionType];
  const ast = check(e.astPass);
  const tf = check(e.tfValidatePass);
  return (
    <li className="py-1.5 text-12" data-audit-id={e.id}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex shrink-0 [&>svg]:size-3.5 ${TONE_TEXT[a.tone]}`} aria-hidden>
          {a.icon}
        </span>
        <span className="font-medium text-text">{a.label}</span>
        <span className="font-mono text-11 text-muted">#{e.ticketId}</span>
        {e.execution === "live-graph" && (
          <Pill variant="status" tone="healthy" mono={false}>
            Live Graph
          </Pill>
        )}
        {e.execution === "simulated" && (
          <Pill variant="status" tone="muted" mono={false}>
            Simulated
          </Pill>
        )}
        <span className="ml-auto font-mono text-11 text-faint" title={e.timestamp}>
          {e.timestamp.slice(11, 19)}Z · {fmtMs(e.latencyMs)}
        </span>
      </div>
      <div className="mt-0.5 truncate text-muted" title={e.detail}>
        {e.detail}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-11 text-faint">
        <span title="Delegated (GDAP) identity the action ran as">id {e.delegatedIdentity}</span>
        {(e.actionType === "remediation-verified" || e.actionType.startsWith("hitl")) && (
          <>
            <span className={e.modalSandboxVerified ? "text-healthy" : "text-warning"}>{e.modalSandboxVerified ? "Modal sandbox ✓" : "Local pre-flight"}</span>
            <span>
              AST <span className={ast.className}>{ast.text}</span>
            </span>
            <span>
              tf validate <span className={tf.className}>{tf.text}</span>
            </span>
          </>
        )}
        {e.gitBranch && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3" />
            {e.gitBranch}
          </span>
        )}
        {e.prUrl && (
          <a href={e.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-signal hover:underline">
            PR #{e.prUrl.split("/pull/")[1]} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </li>
  );
}
