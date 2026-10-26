import { CATEGORY_META, COMPONENT_CATEGORY, type CanvasComponentType, type ProvenanceCategory } from "@contextpane/catalog";
import type { CSSProperties } from "react";

/**
 * Semantic provenance colours shared by the left pane and the canvas: an entity
 * pill and the card it spawned always carry the same colour (amber licensing,
 * rose identity & Conditional Access, violet Intune, teal Azure IaC).
 */

export const CATEGORY_ORDER: ProvenanceCategory[] = ["licensing", "identity", "intune", "azure"];

export function categoryColor(category: ProvenanceCategory): string {
  return CATEGORY_META[category].color;
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
