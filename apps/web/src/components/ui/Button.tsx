import type { ButtonHTMLAttributes, ReactNode } from "react";
import { WorkingMark } from "./Pill";

type Variant = "primary" | "ghost" | "outline" | "danger" | "meta" | "healthy";
type Size = "xs" | "sm" | "md";

/* Tinted variants use the "-strong" text token so the label keeps 4.5:1 on the /25 hover tint. */
const VARIANT: Record<Variant, string> = {
  primary: "bg-signal text-signal-ink hover:bg-signal/90 border-transparent font-semibold",
  ghost: "bg-transparent text-muted hover:text-text hover:bg-raised border-transparent",
  outline: "bg-transparent text-text hover:bg-raised border-hairline",
  danger: "bg-critical/15 text-critical-strong hover:bg-critical/25 border-critical/40",
  meta: "bg-dom-intune/15 text-meta-strong hover:bg-dom-intune/25 border-dom-intune/40",
  healthy: "bg-healthy text-ground hover:bg-healthy-strong border-transparent font-semibold",
};

const SIZE: Record<Size, string> = {
  xs: "h-6 px-2 text-11 gap-1 [&>svg]:size-3",
  sm: "h-7 px-2.5 text-12 gap-1.5 [&>svg]:size-3.5",
  md: "h-9 px-3.5 text-13 gap-2 [&>svg]:size-4",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({ variant = "outline", size = "sm", icon, loading = false, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md border transition-colors duration-120 whitespace-nowrap disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-signal ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? <WorkingMark className={variant === "primary" || variant === "healthy" ? "text-current" : ""} /> : icon}
      {children}
    </button>
  );
}
