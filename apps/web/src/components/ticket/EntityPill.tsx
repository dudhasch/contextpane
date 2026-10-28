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
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePopoverPinning } from "@/hooks/usePopoverPinning";
import { lookupRoleOrPermission, type EnrichedEntity, type EntityType, type ProviderTelemetry, type QuickAction } from "@contextpane/catalog";
import { onDemo } from "@/lib/demo";
import { healthTone, humanizeStatus, provenanceBadge } from "@/lib/format";
import { catStyle } from "@/lib/provenance";
import { selectActiveTimelineSlice, selectHover, useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill, TONE_TEXT, type Tone } from "../ui/Pill";
import { RolePermissionCardContent } from "../ui/RolePermissionHoverPopover";

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
  const prewarmHover = useWorkbench((s) => s.prewarmEntityHover);
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
      ? "rounded-sm ring-1 ring-healthy/60"
      : sliceHealth === "critical"
        ? "rounded-sm ring-1 ring-critical/60"
        : sliceHealth === "warning"
          ? "rounded-sm ring-1 ring-warning/60"
          : "";

  const { refs, floatingStyles, context } = useFloating({
    open: open && hoverable,
    onOpenChange: (nextOpen) => {
      if (nextOpen) {
        pinning.cancelClose();
        setOpen(true);
      } else pinning.requestClose();
    },
    placement: "top-start",
    middleware: [offset(6), flip({ fallbackPlacements: ["bottom-start", "right-start"] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const closePopover = useCallback(() => setOpen(false), []);
  const pinning = usePopoverPinning(refs.floating, closePopover);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 150, close: 180 }, handleClose: safePolygon({ buffer: 2 }) }),
    useFocus(context),
    useDismiss(context, {
      outsidePress: (event) =>
        !(event.target instanceof Element && event.target.closest('[data-selection-bar="true"], [data-testid="selection-trigger-bar"]')),
    }),
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
          onMouseEnter: () => {
            setLinked({ target: entity.target, category: entity.category });
            if (hoverable) {
              window.setTimeout(() => void prewarmHover(entity.id, entity.type), 60);
            }
          },
          onMouseLeave: () => setLinked(null),
          onClick: () => focusCard(entity.target, entity.tab),
        })}
        data-entity={entity.id}
        data-slice-status={sliceStatus}
        title={`${entity.id} · click to open its card`}
        className={
          inline
            ? `inline text-left text-text underline decoration-[color:var(--cat)] decoration-2 underline-offset-[3px] transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-[var(--cat)] ${sliceRing} ${open ? "bg-raised" : ""}`
            : `inline-flex h-6 max-w-full items-center rounded-sm px-1 align-middle transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-[var(--cat)] ${sliceRing} ${open ? "bg-raised" : ""}`
        }
      >
        {inline ? (
          label
        ) : (
          <>
            <Pill variant="entity" icon={ICON[entity.type] ?? <Hash />} className="max-w-full min-w-0">
              {label}
            </Pill>
            {effectiveNote && <span className="ml-1 shrink-0 text-11 text-faint">· {effectiveNote}</span>}
          </>
        )}
      </button>
      {open && hoverable && (
        <FloatingPortal root={typeof document !== "undefined" ? document.body : null}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({ onPointerDownCapture: pinning.onPointerDownCapture })}
            data-hover-popover="true"
            data-testid="hover-popover"
            className={`z-[9999] select-text ${lookupRoleOrPermission(entity.id) ? "w-[340px] max-w-[360px]" : "w-[288px] max-w-[300px]"} animate-fade-in rounded-lg border border-hairline bg-raised p-2.5 shadow-popover`}
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
  const rolePerm = lookupRoleOrPermission(entityId);
  if (rolePerm) {
    return (
      <div className="space-y-2">
        <RolePermissionCardContent entry={rolePerm} />
        {entry?.popover && entry.popover.quickActions.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-hairline-2 pt-1.5">
            {entry.popover.quickActions.map((a) => (
              <QuickActionButton key={a.id} action={a} onDone={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (!entry || entry.status === "loading") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-11 text-muted">{entityId}</span>
          <Pill tone="meta" icon={<Sparkles />} mono={false}>
            Live Context
          </Pill>
        </div>
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface" />
        <div className="h-3 w-full animate-pulse rounded bg-surface" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface" />
      </div>
    );
  }
  if (entry.status === "error" || !entry.popover) {
    return <div className="text-12 text-critical">{entry.error ?? "diagnostic unavailable"}</div>;
  }
  const p = entry.popover;
  const t = p.providerTelemetry;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-11 text-muted" title={p.entityId}>
          {p.entityId}
        </span>
        <Pill tone={tone}>{humanizeStatus(p.status)}</Pill>
      </div>
      <div className="text-13 font-medium leading-snug">{p.headline}</div>
      {p.errorCodeTranslation && (
        <div className="rounded-md border border-critical/30 bg-critical/8 p-2 text-11">
          <div className="font-mono text-critical">{p.errorCodeTranslation.code}</div>
          <div className="mt-0.5 text-text">{p.errorCodeTranslation.meaning}</div>
          <div className="mt-1 text-muted">{p.errorCodeTranslation.likelyCause}</div>
          {p.errorCodeTranslation.docsUrl && (
            <a href={p.errorCodeTranslation.docsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-signal hover:underline">
              Microsoft Learn <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
      {p.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-11">
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
      <HoverProvenance telemetry={t} serveMs={entry.latencyMs} />
    </div>
  );
}

/** Which model produced the headline (facts and actions are always the deterministic diagnostic). */
function HoverProvenance({ telemetry, serveMs }: { telemetry: ProviderTelemetry; serveMs: number | undefined }) {
  const badge = provenanceBadge(telemetry);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-hairline-2 pt-1.5 text-11 text-faint" data-testid="hover-provenance">
      <span className="inline-flex min-w-0 items-center gap-1" title={badge.title}>
        <Cpu className={`size-3 shrink-0 ${badge.tone === "healthy" ? "text-healthy" : badge.tone === "meta" ? "text-dom-intune" : ""}`} />
        <span className={`truncate ${badge.tone === "healthy" ? "text-healthy" : badge.tone === "meta" ? "text-dom-intune" : ""}`}>{badge.label}</span>
      </span>
      {serveMs !== undefined && serveMs > 1 && <span className="shrink-0 font-mono">{serveMs} ms</span>}
    </div>
  );
}

function formatFactValue(val: string): string {
  return val
    .replace(/\bgroupBasedLicensing\b/g, "Group-Based Licensing")
    .replace(/\bdirectAssignment\b/g, "Direct Assignment");
}

function FactRow({ label, value, mono, tone }: { label: string; value: string; mono: boolean; tone?: Tone }) {
  return (
    <>
      <dt className="text-faint">{formatFactValue(label)}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${tone ? TONE_TEXT[tone] : "text-text"} break-words`}>{formatFactValue(value)}</dd>
    </>
  );
}

function QuickActionButton({ action, onDone }: { action: QuickAction; onDone: () => void }) {
  const run = () => {
    const state = useWorkbench.getState();
    switch (action.kind) {
      case "inspect-policy":
        // Expand Sign-In History & Conditional Access on the Policy Inspector tab, highlight the blocking policy, and open the drawer focused on the CA fix.
        state.inspectPolicyAndFix(action.targetEntityId);
        break;
      case "stage-license-fix":
        // HITL: the license change only ever runs from the approval drawer, opened on its PowerShell tab.
        state.focusCard("LicenseDriftCard", "users");
        state.openRemediation({
          tab: "powershell",
          focusBanner: "Focused: License Pool & Group Remediation",
          ...(action.targetEntityId?.includes("@") ? { focusUpn: action.targetEntityId } : {}),
        });
        break;
      case "stage-intune-fix":
        state.focusCard("IntuneDriftCard", "settings");
        state.openRemediation({ tab: "powershell", focusBanner: "Focused: Intune Policy & Endpoint Remediation" });
        break;
      case "view-diff":
        state.focusCard("IaCDriftBanner", "nsg");
        state.openRemediation({ tab: "terraform", focusBanner: "Focused: NSG & Terraform Drift Remediation" });
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
