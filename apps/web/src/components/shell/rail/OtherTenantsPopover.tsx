import { FloatingFocusManager, FloatingPortal, autoUpdate, flip, offset, shift, useClick, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import { ClipboardCopy, Users, Zap } from "lucide-react";
import { useState } from "react";
import { useWorkbench } from "@/store";
import { Button } from "../../ui/Button";
import { CodeBlock } from "../../ui/CodeBlock";
import { Pill } from "../../ui/Pill";
import { useCopy } from "./shared";

export const PEER_TENANT_META: Record<string, { id: string; name: string; slug: string; domain: string; branchPrefix: string }> = {
  "Contoso Finance": { id: "tenant-contoso-01", name: "Contoso Finance", slug: "contoso-finance", domain: "c4a8shili.onmicrosoft.com", branchPrefix: "fleet/contoso-finance" },
  "Fabrikam Legal": { id: "tenant-fabrikam-02", name: "Fabrikam Legal", slug: "fabrikam-legal", domain: "fabrikamlegal.onmicrosoft.com", branchPrefix: "fleet/fabrikam-legal" },
  "Northwind Traders": { id: "tenant-northwind-03", name: "Northwind Traders", slug: "northwind-traders", domain: "northwindtraders.onmicrosoft.com", branchPrefix: "fleet/northwind-traders" },
  "Tailspin Aerospace": { id: "tenant-tailspin-04", name: "Tailspin Aerospace", slug: "tailspin-aerospace", domain: "tailspinaerospace.onmicrosoft.com", branchPrefix: "fleet/tailspin-aerospace" },
  "Woodgrove Bank": { id: "tenant-woodgrove-05", name: "Woodgrove Bank", slug: "woodgrove-bank", domain: "woodgrovebank.onmicrosoft.com", branchPrefix: "fleet/woodgrove-bank" },
};

export function resolveOtherAffectedClients(
  fleet: { signature: string; tenants: Array<{ tenant: string; affected: boolean }> } | null | undefined,
  activeTenantName: string,
  affectedTenantIds?: string[],
): Array<{ id: string; name: string; slug: string; domain: string; branchPrefix: string; badge: string }> {
  const fromIds = affectedTenantIds
    ? affectedTenantIds
        .map((raw) => {
          const byName = PEER_TENANT_META[raw];
          if (byName) return byName;
          const byId = Object.values(PEER_TENANT_META).find((m) => m.id === raw || m.slug === raw);
          if (byId) return byId;
          const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          return { id: `tenant-${slug}`, name: raw, slug, domain: `${slug.replace(/-/g, "")}.onmicrosoft.com`, branchPrefix: `fleet/${slug}` };
        })
        .filter((m) => m.name !== activeTenantName && m.id !== activeTenantName)
    : null;

  const baseList =
    fromIds ??
    (fleet?.tenants ?? [])
      .filter((t) => {
        const name = t.tenant ?? (t as { tenantName?: string }).tenantName ?? "";
        return t.affected && name !== "" && name !== activeTenantName;
      })
      .map((t) => {
        const name = t.tenant ?? (t as { tenantName?: string }).tenantName ?? "";
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return (
          PEER_TENANT_META[name] ?? {
            id: `tenant-${slug}`,
            name,
            slug,
            domain: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.onmicrosoft.com`,
            branchPrefix: `fleet/${slug}`,
          }
        );
      });

  return baseList.map((t) => ({
    ...t,
    badge: "1 issue · ✓ safety check ready",
  }));
}

function useActiveTenantName(): string {
  return useWorkbench((s) => {
    if (s.brief?.tenantName) return s.brief.tenantName;
    const active = s.scenarios.find((sc) => sc.scenarioId === s.scenarioId);
    return active?.tenantName ?? (s.scenarioId === "INC-4099" ? "Fabrikam Legal" : "Contoso Finance");
  });
}

/**
 * Text-11 trigger in the approve footer that opens the other affected tenants (fleet campaign) and the
 * OpenTofu export in a popover above it. Open state is `drawerTab === "fleet"`, so plan steps that call
 * `openRemediation({ tab: "fleet" })` land here.
 */
export function OtherTenantsPopover() {
  const open = useWorkbench((s) => s.drawerTab === "fleet");
  const setDrawerTab = useWorkbench((s) => s.setDrawerTab);
  const setCodeRailTab = useWorkbench((s) => s.setCodeRailTab);
  const fleet = useWorkbench((s) => s.fleet);
  const activeTenantName = useActiveTenantName();
  const count = fleet ? resolveOtherAffectedClients(fleet, activeTenantName).length : null;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => (next ? setDrawerTab("fleet") : setCodeRailTab(useWorkbench.getState().codeRailTab)),
    placement: "top-start",
    middleware: [offset(8), flip({ fallbackPlacements: ["top-end", "bottom-start"] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: "dialog" })]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        data-testid="fleet-tab"
        aria-expanded={open}
        title="Other managed tenants with the same misconfiguration"
        className={`inline-flex shrink-0 items-center gap-1 text-11 whitespace-nowrap transition-colors duration-120 ${open ? "text-signal" : "text-muted hover:text-text"}`}
        {...getReferenceProps()}
      >
        <Users className="size-3" aria-hidden />
        {count === null ? "Other tenants" : `${count} other tenant${count === 1 ? "" : "s"}`}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              aria-label="Other affected tenants"
              className="z-[9999] max-h-[70vh] w-[416px] max-w-[calc(100vw-16px)] animate-fade-in overflow-y-auto rounded-md bg-raised p-3 text-12 text-text shadow-popover"
            >
              <OtherTenantsBody />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function OtherTenantsBody() {
  const [view, setView] = useState<"clients" | "terraform">("clients");
  const fleet = useWorkbench((s) => s.fleet);
  const rev = useWorkbench((s) => s.reverseResult);
  const stage = useWorkbench((s) => s.stageCampaign);
  const activeTenantName = useActiveTenantName();
  const copy = useCopy();
  const peers = resolveOtherAffectedClients(fleet, activeTenantName);
  const views: Array<{ id: "clients" | "terraform"; label: string }> = [
    { id: "clients", label: `Affected tenants (${peers.length})` },
    { id: "terraform", label: "Export to OpenTofu" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-7 min-w-0 items-center gap-4" role="tablist">
        {views.map((v) => {
          const active = v.id === view;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(v.id)}
              className={`relative inline-flex h-full items-center text-12 whitespace-nowrap transition-colors duration-120 ${active ? "text-text" : "text-muted hover:text-text"}`}
            >
              {v.label}
              {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
            </button>
          );
        })}
        {view === "terraform" && rev && (
          <Button size="xs" variant="ghost" icon={<ClipboardCopy />} className="ml-auto" onClick={() => void copy(`${rev.imports.join("\n")}\n\n${rev.hcl}`, "Terraform configuration")}>
            Copy
          </Button>
        )}
      </div>

      {view === "clients" ? (
        <>
          <p className="text-12 text-muted">
            Your other managed tenants (excluding <span className="text-text">{activeTenantName}</span>) with this exact misconfiguration:{" "}
            <span className="font-medium text-warning">{peers.length}</span>.
          </p>
          {fleet ? (
            <>
              <ul>
                {peers.map((t) => {
                  const branch = `fleet/${fleet.signature}/${t.slug}`;
                  return (
                    <li key={t.id} className="border-t border-hairline py-1.5">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium text-text">{t.name}</span>
                        <Pill variant="status" tone="healthy" mono={false}>
                          {t.badge}
                        </Pill>
                      </div>
                      <div className="truncate font-mono text-11 text-faint">{t.domain}</div>
                      <div className="truncate font-mono text-11 text-signal" title={branch}>
                        {branch}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Button size="sm" variant="primary" icon={<Zap />} className="w-full" onClick={() => void stage()} data-testid="confirm-fleet-campaign">
                Create fix PRs for all {peers.length} tenants
              </Button>
            </>
          ) : (
            <p className="text-muted">Scanning client tenants…</p>
          )}
        </>
      ) : rev ? (
        <>
          <p className="text-12 text-muted">OpenTofu resources and import blocks for the manual portal changes.</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Pill variant="status" tone="healthy" mono={false}>
              Plan: {rev.tofuPlanSummary ?? rev.expectedPlanSummary ?? "0 to add, 0 to destroy"}
            </Pill>
            <Pill variant="status" tone="muted" mono={false}>
              {rev.imports.length} import blocks
            </Pill>
          </div>
          <CodeBlock code={`${rev.imports.join("\n")}\n\n${rev.hcl}`} maxHeight="max-h-64" hideToolbar />
        </>
      ) : (
        <p className="text-muted">Generating OpenTofu resources…</p>
      )}
    </div>
  );
}
