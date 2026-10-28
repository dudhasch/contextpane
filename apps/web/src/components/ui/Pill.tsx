import type { ReactNode } from "react";

export type Tone = "primary" | "healthy" | "warning" | "critical" | "meta" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  primary: "bg-primary/12 border-primary/40 text-primary",
  healthy: "bg-healthy/12 border-healthy/40 text-healthy",
  warning: "bg-warning/12 border-warning/40 text-warning",
  critical: "bg-critical/12 border-critical/40 text-critical",
  meta: "bg-meta/12 border-meta/40 text-meta",
  muted: "bg-elevated border-border text-muted",
};

export const TONE_TEXT: Record<Tone, string> = {
  primary: "text-primary",
  healthy: "text-healthy",
  warning: "text-warning",
  critical: "text-critical",
  meta: "text-meta",
  muted: "text-muted",
};

export const TONE_DOT: Record<Tone, string> = {
  primary: "bg-primary",
  healthy: "bg-healthy",
  warning: "bg-warning",
  critical: "bg-critical",
  meta: "bg-meta",
  muted: "bg-faint",
};

interface PillProps {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  mono?: boolean;
  className?: string;
  title?: string;
  flashKey?: string | number;
}

export function Pill({ tone = "muted", icon, children, mono = true, className = "", title, flashKey }: PillProps) {
  return (
    <span
      key={flashKey}
      title={title}
      style={{ ["--flash-color" as string]: `var(--color-${tone === "muted" ? "border" : tone})` }}
      className={`inline-flex h-6 items-center gap-1.5 rounded-pill border px-2 text-[11px] leading-snug whitespace-nowrap ${mono ? "font-mono" : "font-medium"} ${TONE_CLASS[tone]} ${flashKey !== undefined ? "animate-flash" : ""} ${className}`}
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
