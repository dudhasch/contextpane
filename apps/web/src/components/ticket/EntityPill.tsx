import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { AlertTriangle, ExternalLink, KeyRound, ShieldBan, Sparkles, UserRound, Users, Cloud, Hash } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { EntityType, QuickAction } from "@contextpane/catalog";
import { onDemo } from "@/lib/demo";
import { PROVIDER_LABEL, healthTone } from "@/lib/format";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, TONE_TEXT, type Tone } from "../ui/Pill";

const ICON: Partial<Record<EntityType, ReactNode>> = {
  upn: <UserRound />,
  group: <Users />,
  errorCode: <AlertTriangle />,
  resource: <Cloud />,
  policy: <ShieldBan />,
  sku: <Hash />,
};

interface EntityPillProps {
  entityId: string;
  entityType: EntityType;
  label?: string;
}

/**
 * UX Pattern 1 — Inline Hover Resolution. Hovering (150 ms) calls Tier 1A and
 * renders the HoverDiagnosticPopover; a skeleton shows instantly so the
 * perceived latency stays inside the 350 ms budget.
 */
export function EntityPill({ entityId, entityType, label }: EntityPillProps) {
  const [open, setOpen] = useState(false);
  const hover = useWorkbench((s) => s.hover);
  const entry = useWorkbench((s) => s.hovers[entityId.toLowerCase()]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 150, close: 120 }, handleClose: safePolygon() }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);

  useEffect(() => {
    if (open) void hover(entityId, entityType);
  }, [open, entityId, entityType, hover]);

  useEffect(
    () =>
      onDemo((beat, claim) => {
        if (beat.kind === "hover" && beat.entityId.toLowerCase() === entityId.toLowerCase() && claim()) setOpen(true);
        if (beat.kind === "close-popovers") setOpen(false);
      }),
    [entityId],
  );

  const tone: Tone = entry?.popover ? healthTone(entry.popover.status) : "primary";

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        {...getReferenceProps()}
        className={`inline-flex h-5 max-w-full items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 align-middle font-mono text-[11px] text-primary underline decoration-dotted underline-offset-2 hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-primary ${open ? "bg-primary/20" : ""}`}
      >
        <span className="[&>svg]:size-3">{ICON[entityType] ?? <Hash />}</span>
        <span className="truncate">{label ?? entityId}</span>
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-80 animate-fade-in rounded-lg border border-sky-500/40 bg-[#0B1120]/95 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.9)] ring-1 ring-white/10 backdrop-blur-xl"
          >
            <HoverPopoverBody entityId={entityId} entityType={entityType} tone={tone} onClose={() => setOpen(false)} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function HoverPopoverBody({ entityId, entityType, tone, onClose }: { entityId: string; entityType: EntityType; tone: Tone; onClose: () => void }) {
  const entry = useWorkbench((s) => s.hovers[entityId.toLowerCase()]);
  if (!entry || entry.status === "loading") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted">{entityId}</span>
          <Pill tone="meta" icon={<Sparkles />}>
            Tier 1A
          </Pill>
        </div>
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface" />
        <div className="h-3 w-full animate-pulse rounded bg-surface" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface" />
      </div>
    );
  }
  if (entry.status === "error" || !entry.popover) {
    return <div className="text-xs text-critical">{entry.error ?? "diagnostic unavailable"}</div>;
  }
  const p = entry.popover;
  const t = p.providerTelemetry;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted" title={p.entityId}>
          {p.entityId}
        </span>
        <Pill tone={tone}>{p.status}</Pill>
      </div>
      <div className="text-[13px] font-medium leading-snug">{p.headline}</div>
      {p.errorCodeTranslation && (
        <div className="rounded-md border border-critical/30 bg-critical/8 p-2 text-[11px]">
          <div className="font-mono text-critical">{p.errorCodeTranslation.code}</div>
          <div className="mt-0.5 text-text">{p.errorCodeTranslation.meaning}</div>
          <div className="mt-1 text-muted">{p.errorCodeTranslation.likelyCause}</div>
          {p.errorCodeTranslation.docsUrl && (
            <a href={p.errorCodeTranslation.docsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
              Microsoft Learn <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
      {p.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {p.facts.map((f) => (
            <FactRow key={`${f.label}-${f.value}`} label={f.label} value={f.value} mono={f.mono} tone={f.tone ? healthTone(f.tone) : undefined} />
          ))}
        </dl>
      )}
      {p.quickActions.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {p.quickActions.map((a) => (
            <QuickActionButton key={a.id} action={a} entityType={entityType} onDone={onClose} />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border-subtle pt-1.5 text-[10px] text-faint">
        <span>
          {t.tier} · {PROVIDER_LABEL[t.provider] ?? t.provider} · {t.modelId}
        </span>
        <span className={entry.latencyMs !== undefined && entry.latencyMs <= 350 ? "text-healthy" : "text-warning"}>
          {entry.latencyMs ?? t.latencyMs} ms · {t.tokensUsed} tok
        </span>
      </div>
    </div>
  );
}

function FactRow({ label, value, mono, tone }: { label: string; value: string; mono: boolean; tone?: Tone }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${tone ? TONE_TEXT[tone] : "text-text"} break-words`}>{value}</dd>
    </>
  );
}

function QuickActionButton({ action, onDone }: { action: QuickAction; entityType: EntityType; onDone: () => void }) {
  const s = useWorkbench.getState;
  const run = () => {
    const state = s();
    switch (action.kind) {
      case "issue-tap":
        if (action.targetEntityId) void state.issueTap(action.targetEntityId);
        break;
      case "inspect-policy":
        if (action.targetEntityId) void state.inspectPolicy(action.targetEntityId);
        else state.revealComponent("EntraSignInTimeline");
        break;
      case "assign-license":
        // HITL: the license change only ever runs from the approval drawer, opened on its PowerShell tab.
        state.openLicenseRemediation(action.targetEntityId?.includes("@") ? action.targetEntityId : undefined);
        break;
      case "view-diff":
        state.setDiffOpen(true);
        break;
      case "generate-fix":
      case "exclude-group-report-only":
        void state.remediate();
        break;
      case "open-sign-in-logs":
        state.flashComponent("EntraSignInTimeline");
        break;
      default:
        state.toast({ tone: "info", title: action.label, detail: action.description });
    }
    onDone();
  };
  const icon = action.kind === "issue-tap" ? <KeyRound /> : action.kind === "inspect-policy" ? <ShieldBan /> : action.kind === "generate-fix" ? <Sparkles /> : undefined;
  return (
    <Button size="xs" variant={action.kind === "generate-fix" ? "meta" : "outline"} icon={icon} onClick={run} title={action.description}>
      {action.label}
    </Button>
  );
}
