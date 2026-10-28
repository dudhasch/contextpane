/**
 * Compatibility shim: the card chrome became the borderless lens `Section` (WP3, decision Q3).
 * Existing imports of `CardShell` keep compiling and render the new anatomy.
 */
export { Section as CardShell, Section, DataTable, SmartTechPath, Stat, useExpanded } from "./Section";
export type { CardTab, SectionProps, SectionProps as CardShellProps } from "./Section";
