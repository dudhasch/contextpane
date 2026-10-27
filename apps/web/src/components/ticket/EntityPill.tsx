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
import { AlertTriangle, Cloud, Cpu, ExternalLink, Hash, Laptop, ShieldBan, SlidersHorizontal, Sparkles, UserRound, Users, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { EnrichedEntity, EntityType, QuickAction } from "@contextpane/catalog";
import { onDemo } from "@/lib/demo";
import { PROVIDER_LABEL, healthTone } from "@/lib/format";
import { CAT_CHIP, catStyle } from "@/lib/provenance";
import { selectActiveTimelineSlice, selectHover, useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, TONE_TEXT, type Tone } from "../ui/Pill";

const ICON: Partial<Record<EntityType, ReactNode>> = {
  upn: <UserRound />,
  group: <Users />,
  errorCode: <AlertTriangle />,
  resource: <Cloud />,
  policy: <ShieldBan />,
  sku: <Hash />,
  setting: <SlidersHorizontal />,
  device: <Laptop />,
};

interface EntityPillProps {
  entity: Pick<EnrichedEntity, "id" | "type" | "category" | "target" | "tab" | "hoverable"> & { label?: string; note?: string };
  /** Smaller inline variant used inside running text. */
  inline?: boolean;
}

/**
 * An MCP-enriched entity in its provenance colour. Hovering (150 ms) opens the Tier 1A
 * diagnostic popover and lights up the card the entity spawned; a click expands that
 * card and scrolls it into focus.
 */
export function EntityPill({ entity, inline = false }: EntityPillProps) {
  const [open, setOpen] = useState(false);
  const hover = useWorkbench((s) => s.hover);
  const setLinked = useWorkbench((s) => s.setLinked);
  const focusCard = useWorkbench((s) => s.focusCard);
  const entry = useWorkbench((s) => selectHover(s, entity.id));
  const activeSlice = useWorkbench(selectActiveTimelineSlice);
  const hoverable = entity.hoverable !== false;
  const isTimeTravel = Boolean(activeSlice && activeSlice.relativeLabel !== "NOW");
  const sliceEntity = isTimeTravel
    ? activeSlice?.state.entities?.find(
        (e) =>
          e.id.toLowerCase() === entity.id.toLowerCase() ||
          e.id.toLowerCase() === (entity.label ?? "").toLowerCase(),
      )
    : undefined;
  const sliceStatus = isTimeTravel
    ? (sliceEntity?.status ??
      activeSlice?.state.statuses?.[entity.id] ??
      (activeSlice?.state.health === "healthy" ? "compliant" : undefined))
    : undefined;
  const sliceHealth = isTimeTravel
    ? (sliceEntity?.health ?? (activeSlice?.state.health === "healthy" ? "healthy" : undefined))
    : undefined;
  const effectiveNote = isTimeTravel && sliceStatus ? sliceStatus : entity.note;
  const sliceRing =
    sliceHealth === "healthy"
      ? "ring-1 ring-healthy/60 border-healthy/50"
      : sliceHealth === "critical"
        ? "ring-1 ring-critical/60 border-critical/50"
        : sliceHealth === "warning"
          ? "ring-1 ring-warning/60 border-warning/50"
          : "";

  const { refs, floatingStyles, context } = useFloating({
    open: open && hoverable,
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
    if (open && hoverable) void hover(entity.id, entity.type);
  }, [open, hoverable, entity.id, entity.type, hover]);

  useEffect(
    () =>
      onDemo((beat, claim) => {
        if (beat.kind === "hover" && beat.entityId.toLowerCase() === entity.id.toLowerCase() && claim()) setOpen(true);
        if (beat.kind === "close-popovers") setOpen(false);
      }),
    [entity.id],
  );

  const tone: Tone = entry?.popover ? healthTone(entry.popover.status) : "primary";
  const label = entity.label ?? entity.id;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        style={catStyle(entity.category)}
        {...getReferenceProps({
          onMouseEnter: () => setLinked({ target: entity.target, category: entity.category }),
          onMouseLeave: () => setLinked(null),
          onClick: () => focusCard(entity.target, entity.tab),
        })}
        data-entity={entity.id}
        data-slice-status={sliceStatus}
        title={`${entity.id} · click to open its card`}
        className={`inline-flex max-w-full items-center gap-1 rounded border align-middle font-mono transition-colors hover:brightness-125 focus-visible:outline-2 focus-visible:outline-[var(--cat)] ${CAT_CHIP} ${sliceRing} ${inline ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[11.5px]"} ${open ? "brightness-125" : ""}`}
      >
        <span className="shrink-0 [&>svg]:size-3">{ICON[entity.type] ?? <Hash />}</span>
        <span className="truncate">{label}</span>
        {effectiveNote && !inline && <span className="shrink-0 font-sans text-[10px] opacity-85">· {effectiveNote}</span>}
      </button>
      {open && hoverable && (
        <FloatingPortal root={typeof document !== "undefined" ? document.body : null}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] w-80 animate-fade-in rounded-lg border border-sky-500/40 bg-slate-950/[0.98] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.95)] ring-1 ring-white/10 backdrop-blur-md"
          >
            <HoverPopoverBody entityId={entity.id} tone={tone} onClose={() => setOpen(false)} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function HoverPopoverBody({ entityId, tone, onClose }: { entityId: string; tone: Tone; onClose: () => void }) {
  const entry = useWorkbench((s) => selectHover(s, entityId));
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
            <QuickActionButton key={a.id} action={a} onDone={onClose} />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border-subtle pt-1.5 text-[10px] text-faint">
        <span className="inline-flex items-center gap-1">
          <Cpu className="size-3" />
          {t.tier} · {PROVIDER_LABEL[t.provider] ?? t.provider}
        </span>
        <span>{entry.latencyMs ?? t.latencyMs} ms</span>
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

function QuickActionButton({ action, onDone }: { action: QuickAction; onDone: () => void }) {
  const run = () => {
    const state = useWorkbench.getState();
    switch (action.kind) {
      case "inspect-policy":
        // The Conditional Access inspector is the policies tab of the sign-in card.
        state.focusCard("EntraSignInTimeline", "policies");
        break;
      case "stage-license-fix":
        // HITL: the license change only ever runs from the approval drawer, opened on its PowerShell tab.
        state.focusCard("LicenseDriftCard", "users");
        state.openRemediation({ tab: "powershell", ...(action.targetEntityId?.includes("@") ? { focusUpn: action.targetEntityId } : {}) });
        break;
      case "stage-intune-fix":
        state.focusCard("IntuneDriftCard", "settings");
        state.openRemediation({ tab: "powershell" });
        break;
      case "view-diff":
        state.focusCard("IaCDriftBanner", "nsg");
        state.setDiffOpen(true);
        break;
      case "generate-fix":
        state.openRemediation();
        break;
      case "open-sign-in-logs":
        state.focusCard("EntraSignInTimeline", "signins");
        break;
      default:
        state.toast({ tone: "info", title: action.label, detail: action.description });
    }
    onDone();
  };
  const primary = action.kind === "stage-license-fix" || action.kind === "stage-intune-fix" || action.kind === "generate-fix";
  const icon = action.kind === "inspect-policy" ? <ShieldBan /> : primary ? <Wrench /> : undefined;
  return (
    <Button size="xs" variant={primary ? "meta" : "outline"} icon={icon} onClick={run} title={action.description}>
      {action.label}
    </Button>
  );
}
