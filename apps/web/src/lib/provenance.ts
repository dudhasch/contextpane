import { CATEGORY_META, COMPONENT_CATEGORY, type CanvasComponentType, type ProvenanceCategory } from "@contextpane/catalog";
import type { CSSProperties } from "react";

/**
 * Semantic provenance colours shared by the left pane and the canvas: an entity
 * pill and the card it spawned always carry the same colour (amber licensing,
 * rose identity & Conditional Access, violet Intune, teal Azure IaC).
 *
 * The colour resolves from the theme's `--dom-*` custom property (tokens.css), so
 * it follows dark / light at runtime; the `CATEGORY_META` hex from the catalog is
 * only the fallback for a context without the token sheet.
 */

export const CATEGORY_ORDER: ProvenanceCategory[] = ["licensing", "identity", "intune", "azure"];

/** CSS custom property that carries a category's themed colour. */
export const CATEGORY_VAR: Record<ProvenanceCategory, string> = {
  licensing: "--dom-licensing",
  identity: "--dom-identity",
  intune: "--dom-intune",
  azure: "--dom-azure",
  selection: "--dom-selection",
};

/** CSS colour value for a category: `var(--dom-<category>, <catalog hex>)`. */
export function categoryColor(category: ProvenanceCategory): string {
  return `var(${CATEGORY_VAR[category]}, ${CATEGORY_META[category].color})`;
}

export function cardCategory(type: CanvasComponentType): ProvenanceCategory {
  return COMPONENT_CATEGORY[type];
}

/** Inline custom property the category classes below read (`--cat`). */
export function catStyle(category: ProvenanceCategory, extra: CSSProperties = {}): CSSProperties {
  return { ["--cat" as string]: categoryColor(category), ...extra };
}

/** Pill / chip in the category colour. */
export const CAT_CHIP = "border-[color-mix(in_oklab,var(--cat)_45%,transparent)] bg-[color-mix(in_oklab,var(--cat)_14%,transparent)] text-[var(--cat)]";
export const CAT_TEXT = "text-[var(--cat)]";
export const CAT_DOT = "bg-[var(--cat)]";
