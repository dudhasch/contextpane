import type { ReactNode } from "react";

export type Tone = "primary" | "healthy" | "warning" | "critical" | "meta" | "muted";

/** Pill rendering: `fill` (legacy tinted box), `status` (dot + word), `entity` (domain-coloured underline). */
export type PillVariant = "fill" | "status" | "entity";

/* Text on a tint of its own tone uses the "-strong" token so it keeps 4.5:1 in light mode. */
const TONE_CLASS: Record<Tone, string> = {
  primary: "bg-signal/12 border-signal/40 text-signal-strong",
  healthy: "bg-healthy/12 border-healthy/40 text-healthy-strong",
  warning: "bg-warning/12 border-warning/40 text-warning-strong",
  critical: "bg-critical/12 border-critical/40 text-critical-strong",
  meta: "bg-dom-intune/12 border-dom-intune/40 text-meta-strong",
  muted: "bg-raised border-hairline text-muted",
};

export const TONE_TEXT: Record<Tone, string> = {
  primary: "text-signal",
  healthy: "text-healthy",
  warning: "text-warning",
  critical: "text-critical",
  meta: "text-dom-intune",
  muted: "text-muted",
};

export const TONE_DOT: Record<Tone, string> = {
  primary: "bg-signal",
  healthy: "bg-healthy",
  warning: "bg-warning",
  critical: "bg-critical",
  meta: "bg-dom-intune",
  muted: "bg-faint",
};

/** Raw token behind each tone, for the flash ring (`--flash-color`). */
const TONE_VAR: Record<Tone, string> = {
  primary: "var(--signal)",
  healthy: "var(--healthy)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  meta: "var(--dom-intune)",
  muted: "var(--hairline)",
};

interface PillProps {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  mono?: boolean;
  className?: string;
  title?: string;
  flashKey?: string | number;
  /**
   * `fill` (default): tinted box with a tone border.
   * `status`: 6px dot + label in the tone colour, no fill, no border (`icon` is not rendered).
   * `entity`: label underlined in the inherited `--cat` colour (see `catStyle`), no fill.
   */
  variant?: PillVariant;
}

export function Pill({ tone = "muted", icon, children, mono = true, className = "", title, flashKey, variant = "fill" }: PillProps) {
  const font = mono ? "font-mono" : "font-medium";
  const flash = flashKey !== undefined ? "animate-flash" : "";
  const flashStyle = { ["--flash-color" as string]: TONE_VAR[tone] };

  if (variant === "status") {
    return (
      <span key={flashKey} title={title} style={flashStyle} className={`inline-flex items-center gap-1.5 text-[11px] leading-snug whitespace-nowrap ${font} ${TONE_TEXT[tone]} ${flash} ${className}`}>
        <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
        <span className="truncate">{children}</span>
      </span>
    );
  }

  if (variant === "entity") {
    return (
      <span
        key={flashKey}
        title={title}
        style={{ ["--flash-color" as string]: "var(--cat, var(--hairline))" }}
        className={`inline-flex items-center gap-1 text-[11px] leading-snug whitespace-nowrap text-text ${font} ${flash} ${className}`}
      >
        {icon && <span className="inline-flex shrink-0 text-[color:var(--cat,currentColor)] [&>svg]:size-3">{icon}</span>}
        <span className="truncate underline decoration-[color:var(--cat,currentColor)] decoration-2 underline-offset-[3px]">{children}</span>
      </span>
    );
  }

  return (
    <span
      key={flashKey}
      title={title}
      style={flashStyle}
      className={`inline-flex h-6 items-center gap-1.5 rounded-pill border px-2 text-[11px] leading-snug whitespace-nowrap ${font} ${TONE_CLASS[tone]} ${flash} ${className}`}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:size-3">{icon}</span>}
      <span className="truncate py-0.5 leading-snug">{children}</span>
    </span>
  );
}

export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${pulse ? "animate-pulse-dot" : ""}`} />;
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`mono-chip ${className}`}>{children}</code>;
}
