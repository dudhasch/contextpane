import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline" | "danger" | "meta" | "healthy";
type Size = "xs" | "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-canvas hover:bg-primary/90 border-transparent font-semibold",
  ghost: "bg-transparent text-muted hover:text-text hover:bg-elevated border-transparent",
  outline: "bg-transparent text-text hover:bg-elevated border-border",
  danger: "bg-critical/15 text-critical hover:bg-critical/25 border-critical/40",
  meta: "bg-meta/15 text-meta hover:bg-meta/25 border-meta/40",
  healthy: "bg-healthy text-canvas hover:bg-healthy/90 border-transparent font-semibold",
};

const SIZE: Record<Size, string> = {
  xs: "h-6 px-2 text-[11px] gap-1 [&>svg]:size-3",
  sm: "h-7 px-2.5 text-xs gap-1.5 [&>svg]:size-3.5",
  md: "h-9 px-3.5 text-[13px] gap-2 [&>svg]:size-4",
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
      className={`inline-flex items-center justify-center rounded-md border transition-colors duration-120 whitespace-nowrap disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
    </button>
  );
}
