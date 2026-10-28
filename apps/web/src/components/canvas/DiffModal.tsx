/**
 * WP4: the diff modal is the code rail's `review` mode (`components/shell/rail/DiffReview.tsx`). This
 * module keeps its old exports so existing imports resolve.
 */
export { exposedRules, exposureCallout } from "../shell/rail/DiffReview";

/** @deprecated `setDiffOpen(true)` puts the code rail in `review` mode; renders nothing. */
export function DiffModal(): null {
  return null;
}
