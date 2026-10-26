import { ERP_CONTRACTS, ERP_TENANTS, ERP_TICKETS, type ErpContract, type ErpTenant, type ErpTicket } from "./data.ts";

/** SLA resolution window per severity (minutes). */
const SLA_RESOLUTION_MIN: Record<ErpTicket["severity"], number> = { P1: 240, P2: 480, P3: 1440, P4: 2880 };

/**
 * Open tickets are re-timed relative to "now" so the SLA countdown is always
 * live during a demo (opened 41 min ago, last update 12 min ago). Resolved
 * tickets and timeline entries keep their recorded timestamps.
 */
function withLiveClock(ticket: ErpTicket, now = Date.now()): ErpTicket {
  if (ticket.status === "Resolved") return ticket;
  const openedAt = new Date(now - 41 * 60_000);
  return {
    ...ticket,
    openedAt: openedAt.toISOString(),
    updatedAt: new Date(now - 12 * 60_000).toISOString(),
    slaBreachAt: new Date(openedAt.getTime() + SLA_RESOLUTION_MIN[ticket.severity] * 60_000).toISOString(),
  };
}

export class ErpNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} '${id}' not found in ERP`);
    this.name = "ErpNotFoundError";
  }
}

export interface ErpTenantContext {
  tenant: ErpTenant;
  ticket: ErpTicket;
  contract: ErpContract;
  openTicketCount: number;
}

export interface ErpSearchHit {
  type: "ticket" | "contract" | "tenant" | "upn" | "group";
  id: string;
  tenantId: string;
  label: string;
}

/**
 * Direct TypeScript service — the orchestrator imports this and calls it
 * in-process (sub-millisecond). server.ts exposes the same functions over MCP stdio.
 */
export const erpService = {
  listTenants(): ErpTenant[] {
    return Object.values(ERP_TENANTS);
  },

  getTenant(tenantId: string): ErpTenant {
    const tenant = ERP_TENANTS[tenantId];
    if (!tenant) throw new ErpNotFoundError("tenant", tenantId);
    return tenant;
  },

  getTicket(ticketId: string): ErpTicket {
    const ticket = ERP_TICKETS[ticketId.toUpperCase().replace(/^#/, "")];
    if (!ticket) throw new ErpNotFoundError("ticket", ticketId);
    return withLiveClock(ticket);
  },

  listTickets(tenantId?: string): ErpTicket[] {
    return Object.values(ERP_TICKETS)
      .filter((t) => !tenantId || t.tenantId === tenantId)
      .map(withLiveClock);
  },

  getContract(contractId: string): ErpContract {
    const contract = ERP_CONTRACTS[contractId.toUpperCase().replace(/^#/, "")];
    if (!contract) throw new ErpNotFoundError("contract", contractId);
    return contract;
  },

  listContracts(tenantId?: string): ErpContract[] {
    return Object.values(ERP_CONTRACTS).filter((c) => !tenantId || c.tenantId === tenantId);
  },

  /** Everything the orchestrator needs about a tenant in one call. */
  getTenantContext(tenantId: string): ErpTenantContext {
    const tenant = erpService.getTenant(tenantId);
    const ticket = erpService.getTicket(tenant.primaryTicketId);
    const contract = erpService.getContract(tenant.primaryContractId);
    const openTicketCount = erpService.listTickets(tenantId).filter((t) => t.status !== "Resolved").length;
    return { tenant, ticket, contract, openTicketCount };
  },

  /** Billed quantity for an entitlement group / SKU, used for drift math. */
  getBilledSeats(tenantId: string, skuPartNumber: string): { contractId: string; quantity: number; unitPriceUsd: number; groupName: string | null } | null {
    for (const contract of erpService.listContracts(tenantId)) {
      const line = contract.lines.find((l) => l.skuPartNumber === skuPartNumber);
      if (line) {
        return { contractId: contract.contractId, quantity: line.quantity, unitPriceUsd: line.unitPriceUsd, groupName: line.entitlementGroup };
      }
    }
    return null;
  },

  search(query: string): ErpSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: ErpSearchHit[] = [];
    for (const t of Object.values(ERP_TENANTS)) {
      if (t.displayName.toLowerCase().includes(q) || t.tenantId.includes(q)) {
        hits.push({ type: "tenant", id: t.tenantId, tenantId: t.tenantId, label: t.displayName });
      }
    }
    for (const t of Object.values(ERP_TICKETS)) {
      if (t.ticketId.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) {
        hits.push({ type: "ticket", id: t.ticketId, tenantId: t.tenantId, label: `${t.ticketId} — ${t.title}` });
      }
      for (const upn of t.affectedUpns) {
        if (upn.toLowerCase().includes(q)) hits.push({ type: "upn", id: upn, tenantId: t.tenantId, label: upn });
      }
      for (const g of t.affectedGroups) {
        if (g.toLowerCase().includes(q)) hits.push({ type: "group", id: g, tenantId: t.tenantId, label: g });
      }
    }
    for (const c of Object.values(ERP_CONTRACTS)) {
      if (c.contractId.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) {
        hits.push({ type: "contract", id: c.contractId, tenantId: c.tenantId, label: `${c.contractId} — ${c.title}` });
      }
    }
    return hits;
  },
};

export type ErpService = typeof erpService;
