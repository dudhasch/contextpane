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
import { ExternalLink, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { usePopoverPinning } from "@/hooks/usePopoverPinning";
import { findRolePermissionsInText, lookupRoleOrPermission, type RolePermissionEntry } from "@contextpane/catalog";
import { Pill, type Tone } from "./Pill";

function riskTone(tier: RolePermissionEntry["riskTier"]): Tone {
  if (tier === "Critical Tier-0") return "critical";
  if (tier === "High") return "warning";
  return "healthy";
}

export function RolePermissionCardContent({ entry }: { entry: RolePermissionEntry }) {
  const tone = riskTone(entry.riskTier);
  return (
    <div className="space-y-2 text-left">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-text">
            {entry.riskTier === "Critical Tier-0" ? (
              <ShieldAlert className="size-3.5 shrink-0 text-critical" />
            ) : entry.riskTier === "Least-Privilege" ? (
              <ShieldCheck className="size-3.5 shrink-0 text-healthy" />
            ) : (
              <KeyRound className="size-3.5 shrink-0 text-warning" />
            )}
            <span>{entry.displayName}</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted">
            GUID: <span className="text-sky-300">{entry.guid}</span>
          </div>
        </div>
        <Pill tone={tone}>{entry.riskTier}</Pill>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5 font-medium text-muted">
          {entry.category}
        </span>
        <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-sky-300">
          Grant: {entry.grantType}
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-text/95">{entry.summary}</p>

      <div className="rounded-md border border-border-subtle bg-surface/90 p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
          Allowed Actions &amp; API Calls
        </div>
        <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted">
          {entry.allowedActions.map((act) => (
            <li key={act} className="truncate" title={act}>
              • {act}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border border-emerald-500/25 bg-emerald-500/8 p-2 text-[11px]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
          Recommended Least-Privilege Alternative
        </div>
        <div className="mt-0.5 text-emerald-100/90">{entry.leastPrivilegeAlternative}</div>
      </div>

      <div className="flex items-center justify-between border-t border-border-subtle pt-1.5 text-[11px]">
        <span className="text-faint">Role &amp; Permission Inspector</span>
        <a
          href={entry.referenceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 font-medium text-sky-400 hover:text-sky-300 hover:underline"
        >
          {entry.referenceUrl.includes("graphpermissions.merill.net")
            ? "graphpermissions.merill.net"
            : "azadvertizer.net"}{" "}
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

interface RolePermissionHoverPopoverProps {
  query: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps any role/permission badge or text mention. If `lookupRoleOrPermission(query)` matches,
 * hovering opens the rich Role & Permission Inspector popover. If not matched, renders children as-is.
 */
export function RolePermissionHoverPopover({
  query,
  children,
  className = "",
}: RolePermissionHoverPopoverProps) {
  const entry = lookupRoleOrPermission(query);
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: open && Boolean(entry),
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
    useHover(context, { delay: { open: 110, close: 160 }, handleClose: safePolygon({ buffer: 4 }) }),
    useFocus(context),
    useDismiss(context, {
      outsidePress: (event) =>
        !(event.target instanceof Element && event.target.closest('[data-selection-bar="true"], [data-testid="selection-trigger-bar"]')),
    }),
    useRole(context, { role: "dialog" }),
  ]);

  if (!entry) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        data-role-permission={entry.id}
        className={`inline-flex cursor-help items-center decoration-sky-400/60 decoration-dotted underline-offset-2 hover:underline ${className}`}
      >
        {children}
      </span>
      {open && (
        <FloatingPortal root={typeof document !== "undefined" ? document.body : null}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({ onPointerDownCapture: pinning.onPointerDownCapture })}
            data-hover-popover="true"
            data-testid="permission-hover-popover"
            className="z-[9999] w-[340px] max-w-[360px] select-text animate-fade-in rounded-lg border border-sky-500/45 bg-slate-950/[0.98] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.95)] ring-1 ring-white/10 backdrop-blur-md"
          >
            <RolePermissionCardContent entry={entry} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * Scans a string for any known Microsoft Graph permissions, Entra ID roles, or Azure RBAC roles
 * and wraps each matched mention in a `<RolePermissionHoverPopover>`.
 */
export function TextWithRolePermissionHovers({ text }: { text: string }) {
  const direct = lookupRoleOrPermission(text);
  if (direct) {
    return <RolePermissionHoverPopover query={direct.id}>{text}</RolePermissionHoverPopover>;
  }
  const matches = findRolePermissionsInText(text);
  if (matches.length === 0) {
    return <>{text}</>;
  }
  const needles = matches
    .flatMap((m) => [m.id, m.displayName])
    .filter((v, idx, arr) => v.length >= 4 && arr.indexOf(v) === idx)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (needles.length === 0) {
    return <>{text}</>;
  }
  const re = new RegExp(`(${needles.join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        const matched = lookupRoleOrPermission(part);
        if (matched) {
          return (
            <RolePermissionHoverPopover key={`${part}-${i}`} query={matched.id}>
              {part}
            </RolePermissionHoverPopover>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
