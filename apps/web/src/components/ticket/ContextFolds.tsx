import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CATEGORY_META, type EnrichedEntity, type ScenarioBrief } from "@contextpane/catalog";
import { fmtDateTimeUtc } from "@/lib/format";
import { CATEGORY_ORDER, catStyle } from "@/lib/provenance";
import { EntityPill } from "./EntityPill";

/**
 * Reference material pinned to the bottom of the context zone: enriched tenant objects, contract,
 * infrastructure spec and timeline, each a collapsed 28px row that expands in place.
 */
export function ContextFolds({ brief }: { brief: ScenarioBrief }) {
  return (
    <div className="mt-auto shrink-0 divide-y divide-hairline border-t border-hairline pt-0">
      <EnrichedContext entities={brief.entities} />
      {brief.contract && (
        <Fold title={`Contract #${brief.contract.contractId}`} hint={brief.contract.title}>
          <ul className="space-y-0.5 text-12">
            {brief.contract.lines.map((l) => (
              <li key={l.description} className="flex justify-between gap-2">
                <span>{l.description}</span>
                <span className="shrink-0 font-mono text-11 text-faint">
                  {l.quantity}× {l.skuPartNumber}
                </span>
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-0.5 text-11 text-faint">
            {brief.contract.terms.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </Fold>
      )}
      {brief.infrastructureSpec && (
        <Fold title="Infrastructure spec" hint={brief.infrastructureSpec.split("\n")[0]}>
          <pre className="overflow-x-auto font-mono text-11 leading-relaxed whitespace-pre-wrap text-text">{brief.infrastructureSpec}</pre>
        </Fold>
      )}
      {brief.timeline.length > 0 && (
        <Fold title="Timeline" hint={`${brief.timeline.length} entries`}>
          <ol className="space-y-1 text-12">
            {brief.timeline.map((t) => (
              <li key={t.at + t.actor} className="grid grid-cols-[auto_1fr] gap-x-2">
                <span className="font-mono text-11 text-faint">{fmtDateTimeUtc(t.at)}</span>
                <span>
                  <span className="text-muted">{t.actor}:</span> {t.note}
                </span>
              </li>
            ))}
          </ol>
        </Fold>
      )}
    </div>
  );
}

/** All MCP-enriched tenant objects, grouped by domain; the domain colour sits on the group word and the underlines. */
function EnrichedContext({ entities }: { entities: EnrichedEntity[] }) {
  const groups = CATEGORY_ORDER.map((c) => ({ category: c, items: entities.filter((e) => e.category === c) })).filter((g) => g.items.length);
  return (
    <Fold
      data-testid="enriched-context"
      title={`Enriched Tenant Objects (${entities.length})`}
      hint={groups.map((g) => CATEGORY_META[g.category].label).join(", ")}
    >
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.category} style={catStyle(g.category)}>
            <div className="mb-0.5 text-11 font-semibold tracking-wider text-[color:var(--cat)] uppercase">{CATEGORY_META[g.category].label}</div>
            <div className="flex flex-wrap gap-x-1 gap-y-0.5">
              {g.items.map((e) => (
                <EntityPill key={`${e.category}-${e.id}`} entity={e} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Fold>
  );
}

function Fold({ title, hint, children, "data-testid": testId }: { title: string; hint?: string | undefined; children: ReactNode; "data-testid"?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1.5 text-left text-12 text-text transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal"
      >
        <ChevronRight className={`size-3.5 shrink-0 text-faint transition-transform duration-120 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        <span className="shrink-0 font-medium">{title}</span>
        {hint && !open && <span className="min-w-0 truncate text-11 text-faint">· {hint}</span>}
      </button>
      {open && <div className="max-h-[40vh] overflow-y-auto pt-1 pb-2 pl-5">{children}</div>}
    </section>
  );
}
