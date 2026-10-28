import { Sparkles } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { ClarifyingQuestion, ContextViewMode, EnrichedEntity } from "@contextpane/catalog";
import { useWorkbench } from "@/store";
import { EntityPill } from "./EntityPill";

/** Shared text helpers of the context zone: slug cleanup and entity / selection marking in running text. */

export type SelectionItem = { id: string; text: string; refinementText?: string; viewMode?: ContextViewMode; index: number };

export const NO_SELECTIONS: SelectionItem[] = [];
export const NO_ENTITIES: EnrichedEntity[] = [];

function formatSlugWord(w: string): string {
  if (/^(vm|rg|az|ca|spn|sku|dns|bgp|iam|pim|mfa|arm|rbac|oidc|kv|pr|id|ip|nsg|avd)$/i.test(w)) {
    return w.toUpperCase();
  }
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function cleanInlineSlugs(text: string): string {
  return text
    .replace(/\belement_not_existent\b/gi, "custom diagnostic view")
    .replace(/\b(?:data\/)?dynamic-catalog\.json\b/gi, "custom view catalog")
    .replace(/\bmuse-(?:wonder|spark|glimmer|voice)[a-z0-9.-]*\b/gi, "live analyzer")
    .replace(/\s*\((?:Remove-MgGroupMemberByRef|Invoke-MgLicenseUser|Set-MgUserLicense|Update-MgIdentityConditionalAccessPolicy)[^)]*\)/g, "")
    .replace(/\b([a-z]{2,}(?:_[a-z0-9]{2,})+)\b/g, (match) =>
      match.split("_").map(formatSlugWord).join(" "),
    );
}

export function humanizeClarifierSlug(raw: string, q?: ClarifyingQuestion): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (q) {
    const matchedOpt = q.options.find(
      (o) =>
        o.value.toLowerCase() === trimmed.toLowerCase() ||
        o.id.toLowerCase() === trimmed.toLowerCase() ||
        o.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (matchedOpt && !/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(matchedOpt.label)) {
      return cleanInlineSlugs(matchedOpt.label);
    }
  }
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(trimmed)) {
    return trimmed
      .split(/[_-]+/)
      .map(formatSlugWord)
      .join(" ");
  }
  return cleanInlineSlugs(trimmed);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces enriched entity ids (and their longer labels) inside free text with inline entity
 * underlines, and marks every phrase the engineer explored with a "Selection #n" provenance
 * badge that links to its mini-dashboard on the canvas.
 */
export function EnrichedText({ text, entities, selections = [] }: { text: string; entities: EnrichedEntity[]; selections?: SelectionItem[] }) {
  const { parts, byNeedle, bySelection } = useMemo(() => {
    const byNeedle = new Map<string, EnrichedEntity>();
    for (const e of entities) {
      for (const needle of [e.id, e.label]) if (needle.length >= 6 && !byNeedle.has(needle)) byNeedle.set(needle, e);
    }
    const bySelection = new Map<string, SelectionItem>();
    for (const s of selections) bySelection.set(s.text.toLowerCase(), s);
    // Selections first: an explored phrase is marked even when it overlaps an entity id.
    const selectionNeedles = [...bySelection.values()].map((s) => s.text).sort((a, b) => b.length - a.length);
    const entityNeedles = [...byNeedle.keys()].filter((n) => !bySelection.has(n.toLowerCase())).sort((a, b) => b.length - a.length);
    const all = [...selectionNeedles.map(escapeRe), ...entityNeedles.map(escapeRe)];
    if (!all.length) return { parts: [text], byNeedle, bySelection };
    const re = new RegExp(`(${all.join("|")})`, selectionNeedles.length ? "gi" : "g");
    return { parts: text.split(re), byNeedle, bySelection };
  }, [text, entities, selections]);
  return (
    <>
      {parts.map((part, i) => {
        if (part === undefined || part === "") return null;
        const selection = bySelection.get(part.toLowerCase());
        if (selection) return <SelectionBadge key={`sel-${part}-${i}`} selection={selection} text={part} />;
        const entity = byNeedle.get(part);
        return entity ? <EntityPill key={`${part}-${i}`} entity={{ ...entity, label: part }} inline /> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/** Provenance mark on an explored phrase; hovering it pulses the mini-dashboard it spawned. */
function SelectionBadge({ selection, text }: { selection: SelectionItem; text: string }) {
  const setLinked = useWorkbench((s) => s.setLinkedSelection);
  const mounted = useWorkbench((s) => s.miniDashboards.some((m) => m.id === selection.id));
  const explore = useWorkbench((s) => s.exploreSelection);
  const extra = selection.refinementText ? ` + "${selection.refinementText}"` : "";
  return (
    <button
      type="button"
      data-selection={selection.id}
      onMouseEnter={() => setLinked(selection.id)}
      onMouseLeave={() => setLinked(null)}
      onClick={() =>
        mounted
          ? document.getElementById(`mini-${selection.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
          : void explore(selection.text, { ...(selection.refinementText ? { refinementText: selection.refinementText } : {}), ...(selection.viewMode ? { viewMode: selection.viewMode } : {}) })
      }
      title={mounted ? `Selection #${selection.index}${extra} · click to scroll to its Context Lens` : `Selection #${selection.index}${extra} · dismissed; click to generate it again`}
      className={`inline rounded-sm px-0.5 text-left underline decoration-dashed decoration-2 underline-offset-[3px] transition-colors hover:bg-signal/12 focus-visible:outline-2 focus-visible:outline-signal ${mounted ? "text-signal decoration-signal" : "text-muted decoration-signal/50"}`}
    >
      <Sparkles className="mr-0.5 inline size-3 align-[-1px]" aria-hidden="true" />
      {text}
      <sup className="ml-0.5 font-mono text-11 text-faint">#{selection.index}</sup>
    </button>
  );
}
