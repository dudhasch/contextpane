import type { ContextViewMode } from "@contextpane/catalog";
import type { SVGProps } from "react";

export interface ContextModeInfo {
  mode: ContextViewMode;
  label: string;
  shortLabel: string;
  hint: string;
  svgPath: string;
}

export const CONTEXT_MODE_LIST: ContextModeInfo[] = [
  {
    mode: "dashboard",
    label: "Triage lens",
    shortLabel: "Triage lens",
    hint: "KPI tiles, proportional breakdown & filterable live table",
    svgPath: "/icons/mode-dashboard.svg",
  },
  {
    mode: "full-card",
    label: "Live inspector",
    shortLabel: "Inspector",
    hint: "Deep entity posture inspector, attribute cards & full PowerShell remediation script",
    svgPath: "/icons/mode-full-card.svg",
  },
  {
    mode: "comparison",
    label: "State diff",
    shortLabel: "State diff",
    hint: "Side-by-side peer cohort & golden baseline comparison matrix",
    svgPath: "/icons/mode-comparison.svg",
  },
  {
    mode: "blast-radius",
    label: "Blast radius & dependency graph",
    shortLabel: "Blast radius",
    hint: "Visual relationship chain: Owner / Principal → Workload / Policy → Scopes → Impacted Resources",
    svgPath: "/icons/mode-blast-radius.svg",
  },
];

export const CONTEXT_MODE_META: Record<ContextViewMode, ContextModeInfo> = {
  dashboard: CONTEXT_MODE_LIST[0]!,
  "full-card": CONTEXT_MODE_LIST[1]!,
  comparison: CONTEXT_MODE_LIST[2]!,
  "blast-radius": CONTEXT_MODE_LIST[3]!,
};

/**
 * VectorCraft-authored SVG icon for each Context UI generation mode.
 * Mirrors the SVG assets exported via VectorCraft MCP in `/public/icons/mode-*.svg`.
 */
export function ContextModeIcon({
  mode,
  className = "size-3.5",
  ...props
}: { mode: ContextViewMode } & SVGProps<SVGSVGElement>) {
  switch (mode) {
    case "dashboard":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          aria-hidden="true"
          {...props}
        >
          <rect x="1.5" y="1.5" width="5.5" height="4.5" rx="1" />
          <rect x="9" y="1.5" width="5.5" height="4.5" rx="1" />
          <rect x="1.5" y="8" width="13" height="6.5" rx="1" />
          <path d="M4 10.5h8M4 12.5h5" />
        </svg>
      );
    case "full-card":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          aria-hidden="true"
          {...props}
        >
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" />
          <circle cx="5.2" cy="4.8" r="1.3" />
          <path d="M8 4.2h3.8M8 5.8h2.4" />
          <path d="M4 8.5h8M4 10.5h8M4 12.5h5.5" />
        </svg>
      );
    case "comparison":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          aria-hidden="true"
          {...props}
        >
          <rect x="1.5" y="2" width="5.2" height="12" rx="1" />
          <rect x="9.3" y="2" width="5.2" height="12" rx="1" />
          <path d="M3.2 5h1.8M3.2 7.5h1.8M3.2 10h1.2" />
          <path d="M11 5h1.8M11 7.5h1.8M11 10h1.8" />
          <path d="M6.9 6.2h2.2M9.1 9.8H6.9" />
        </svg>
      );
    case "blast-radius":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          aria-hidden="true"
          {...props}
        >
          <circle cx="8" cy="8" r="2" />
          <circle cx="3" cy="3.2" r="1.4" />
          <circle cx="13" cy="3.2" r="1.4" />
          <circle cx="3" cy="12.8" r="1.4" />
          <circle cx="13" cy="12.8" r="1.4" />
          <path d="M4.1 4.2 6.5 6.5M11.9 4.2 9.5 6.5M4.1 11.8 6.5 9.5M11.9 11.8 9.5 9.5" />
        </svg>
      );
  }
}
