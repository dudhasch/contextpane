import type { SynthesizedBlock, SynthesizedDynamicCard } from "@contextpane/catalog";
import { contextForCorrelation, type CorrelationContext } from "../mcp/context.ts";
import { publishDataPlane } from "./dataplane.ts";

/**
 * Grounding (review items 8 and 9): what the coder and the card synthesizer may name is what the
 * tenant context holds. The index maps every resource, user, group, policy and identity name the
 * correlation context carries to the ptr:// dataset it was read from (null when it comes from a
 * context section the data plane does not publish). The coder's script and the card's rows are
 * checked against it; names the ticket itself mentions count as operator-supplied, not as invented.
 */
export interface GroundingIndex {
  tenantId: string;
  /** Workbench id the context was gathered for (a custom ticket's base scenario or tenant default). */
  contextId: string;
  /** Lower-cased name → ptr:// of the dataset that holds it, or null. */
  names: Map<string, string | null>;
  /** Lower-cased names the ticket text mentions (operator-supplied, not verified). */
  ticketNames: Set<string>;
  /** Compact tenant facts for model prompts; real identifiers here, the router's PII vault pseudonymises them. */
  facts: Record<string, unknown>;
}

/** Record keys whose string values name something in the tenant. */
const NAME_KEYS = new Set([
  "name",
  "displayname",
  "resourcename",
  "resourcegroup",
  "upn",
  "userprincipalname",
  "groupname",
  "spn",
  "owner",
  "storageaccount",
  "vaultname",
  "assignmentname",
  "policyname",
  "devicename",
  "id",
  "appid",
  "resourceid",
  "blockingpolicyname",
  "includegroupnames",
  "excludegroupnames",
  "breakglassgroup",
  "container",
  "containers",
  "identityname",
  "rolename",
  "skupartnumber",
  "hostpoolname",
  "subscriptionid",
  "nic",
]);

const MAX_FACT_ROWS = 25;

function addName(names: Map<string, string | null>, raw: string, ptr: string | null): void {
  const value = raw.trim();
  if (value.length < 3 || value.length > 300) return;
  const lower = value.toLowerCase();
  if (!names.has(lower) || (ptr && names.get(lower) === null)) names.set(lower, ptr);
  // ARM ids: the last segment ("…/vaults/kv-contoso-fin-02") is the name a script uses.
  if (value.includes("/")) {
    const last = value.split("/").filter(Boolean).at(-1);
    if (last && last.length >= 3) addName(names, last, ptr);
  }
}

function collectNames(value: unknown, names: Map<string, string | null>, ptr: string | null, depth = 0): void {
  if (depth > 7 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 500)) collectNames(item, names, ptr, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (NAME_KEYS.has(key.toLowerCase())) {
      if (typeof v === "string") addName(names, v, ptr);
      else if (Array.isArray(v)) for (const s of v) if (typeof s === "string") addName(names, s, ptr);
    }
    if (v && typeof v === "object") collectNames(v, names, ptr, depth + 1);
  }
}

/** Keeps only the naming and state fields of each row, at most MAX_FACT_ROWS rows. */
function compactRows(rows: unknown, keys: string[]): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return rows.slice(0, MAX_FACT_ROWS).map((row) => {
    const rec = (row ?? {}) as Record<string, unknown>;
    return Object.fromEntries(keys.filter((k) => rec[k] !== undefined && rec[k] !== null && rec[k] !== "").map((k) => [k, rec[k]]));
  });
}

/** Hyphenated resource-like words, e-mail addresses and GUIDs a ticket names. */
export function namesInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/g)) if (m[0].length >= 4) out.add(m[0].toLowerCase());
  return out;
}

export function buildGroundingIndex(ctx: CorrelationContext, options: { ticketText?: string; extraFacts?: unknown } = {}): GroundingIndex {
  const names = new Map<string, string | null>();
  // Data-plane rows first: their names get a ptr:// a card block can bind to.
  try {
    const snapshot = publishDataPlane(ctx);
    for (const [ptr, rows] of snapshot.rows) collectNames(rows, names, ptr);
  } catch {
    /* a context the data plane cannot publish still grounds through the sections below */
  }
  const sections: unknown[] = [
    ctx.resourceInventory?.data,
    ctx.virtualMachines?.data,
    ctx.securityGroups?.data,
    ctx.azurePolicies?.data,
    ctx.regionalQuotas?.data,
    ctx.policies?.data,
    ctx.license?.data,
    ctx.caPosture?.data,
    ctx.intune?.data,
    ctx.drift?.data,
    ctx.avd?.data,
    ctx.workloadIdentity,
    ctx.signIns?.data,
    options.extraFacts,
  ];
  for (const section of sections) collectNames(section, names, null);
  addName(names, ctx.erp.tenant.verifiedDomain, null);

  const inventory = ctx.resourceInventory?.data as { subscriptionId?: string; resources?: unknown[] } | undefined;
  const facts: Record<string, unknown> = {
    tenant: { tenantId: ctx.tenantId, displayName: ctx.erp.tenant.displayName, verifiedDomain: ctx.erp.tenant.verifiedDomain },
    correlation: contextForCorrelation(ctx, []).facts,
    ...(inventory?.resources?.length ? { azureResources: compactRows(inventory.resources, ["type", "name", "resourceGroup", "location"]), subscriptionId: inventory.subscriptionId } : {}),
    ...(ctx.virtualMachines?.data?.length ? { virtualMachines: compactRows(ctx.virtualMachines.data, ["name", "resourceGroup", "location", "vmSize", "provisioningState"]) } : {}),
    ...(ctx.license?.data.users?.length ? { users: compactRows(ctx.license.data.users, ["upn", "displayName", "state", "licenseState", "department"]) } : {}),
    ...(ctx.securityGroups?.data?.length ? { securityGroups: compactRows(ctx.securityGroups.data, ["displayName", "assignedSku", "linkedPolicy", "state"]) } : {}),
    ...(ctx.policies?.data?.length ? { conditionalAccessPolicies: compactRows(ctx.policies.data, ["id", "displayName", "state", "includeGroupNames"]) } : {}),
    ...(ctx.azurePolicies?.data?.length ? { azurePolicies: compactRows(ctx.azurePolicies.data, ["name", "effect", "compliance", "scope"]) } : {}),
    ...(options.extraFacts ? { scenarioFacts: options.extraFacts } : {}),
  };
  return { tenantId: ctx.tenantId, contextId: ctx.ticketId, names, ticketNames: namesInText(options.ticketText ?? ""), facts };
}

/** The same index plus the names in `extra` (scenario facts such as the ABAC lab read). */
export function extendGrounding(index: GroundingIndex, extra: unknown): GroundingIndex {
  const names = new Map(index.names);
  collectNames(extra, names, null);
  return { ...index, names, facts: { ...index.facts, scenarioFacts: extra } };
}

/** An index from scenario facts alone, for when no correlation context could be gathered. */
export function groundingFromFacts(tenantId: string, contextId: string, facts: unknown, ticketText = ""): GroundingIndex {
  const names = new Map<string, string | null>();
  collectNames(facts, names, null);
  return { tenantId, contextId, names, ticketNames: namesInText(ticketText), facts: { scenarioFacts: facts } };
}

/** Is `value` a name the tenant context holds (or, with `allowTicket`, one the ticket itself names)? */
export function isGrounded(index: GroundingIndex, value: string, allowTicket = true): boolean {
  const lower = value.trim().toLowerCase();
  if (!lower) return false;
  if (index.names.has(lower) || (allowTicket && index.ticketNames.has(lower))) return true;
  if (lower.includes("/")) {
    const last = lower.split("/").filter(Boolean).at(-1) ?? "";
    return index.names.has(last) || (allowTicket && index.ticketNames.has(last));
  }
  return false;
}

/* ------------------------------ scripts and diffs ------------------------------ */

/** Parameters whose literal value names an existing resource, user, group or identity. */
const TARGET_PARAMS =
  "Name|ResourceGroupName|VaultName|KeyVaultName|StorageAccountName|AccountName|ResourceName|NetworkSecurityGroupName|VMName|VirtualNetworkName|HostPoolName|UserId|GroupId|ServicePrincipalId|ApplicationId|ObjectId|SignInName|UserPrincipalName|PolicyAssignmentName|ContainerName";
const PARAM_RE = new RegExp(String.raw`-(${TARGET_PARAMS})\s*:?\s+(?:'([^']+)'|"([^"$]+)"|([^\s$'"(@)\`|;][^\s;|)\`]*))`, "gi");
/** Creating cmdlets name what they create: their -Name / -DisplayName is new by design. */
const CREATING_LINE = /^\s*(?:if\s*\(.*\)\s*\{\s*)?(?:\$\w+\s*=\s*)?(New|Add)-\w+/i;
const TF_REF_RE = /^\+\s*(resource_group_name|storage_account_name|network_security_group_name|key_vault_name|virtual_network_name)\s*=\s*"([^"$]+)"/gim;

/**
 * Literal resource names a script or Terraform diff targets that neither the tenant context nor the
 * ticket names: the coder invented them. Variables, placeholders and names a New-/Add- cmdlet creates are skipped.
 */
export function ungroundedTargets(index: GroundingIndex, script: string, terraformDiff = ""): string[] {
  const missing = new Set<string>();
  const code = script.replace(/<#[\s\S]*?#>/g, "");
  for (const line of code.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const creating = CREATING_LINE.test(line);
    for (const m of line.matchAll(PARAM_RE)) {
      const param = m[1]!.toLowerCase();
      const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
      if (!value || /^[<{[]|^\$|^-|^(true|false|null)$/i.test(value) || /^\d+$/.test(value)) continue;
      if (creating && (param === "name" || param === "displayname")) continue;
      if (!isGrounded(index, value)) missing.add(value);
    }
  }
  for (const m of terraformDiff.matchAll(TF_REF_RE)) {
    const value = m[2]!.trim();
    if (value && !isGrounded(index, value)) missing.add(value);
  }
  return [...missing];
}

export function groundingFindings(index: GroundingIndex | null, script: string, terraformDiff = ""): string[] {
  if (!index) return [];
  return ungroundedTargets(index, script, terraformDiff).map(
    (name) => `Ungrounded target: '${name}' is not in the tenant context (${index.contextId}) or the ticket; confirm it exists before approving`,
  );
}

/* ------------------------------ synthesized cards ------------------------------ */

/** The column a row click steers with: rowParamKey, else the first name/id/resource-like column (same rule as the web card). */
export function rowSteerColumn(block: Extract<SynthesizedBlock, { kind: "data-table" }>): string | null {
  if (block.rowParamKey && block.columns.some((c) => c.key === block.rowParamKey)) return block.rowParamKey;
  return block.columns.find((c) => /^(name|id|resource|resourceName|target|vault|policy|device|user|upn)$/i.test(c.key))?.key ?? null;
}

function provenanceOf(grounded: number, total: number): "tenant-data" | "mixed" | "model-estimate" {
  if (total > 0 && grounded === total) return "tenant-data";
  return grounded > 0 ? "mixed" : "model-estimate";
}

/** Rows bind only to the tenant context, never to what the ticket names: a row is data, the ticket is a claim. */
function groundedPtr(index: GroundingIndex | null, value: unknown): { grounded: boolean; ptr: string | null } {
  if (!index || typeof value !== "string" || !value.trim()) return { grounded: false, ptr: null };
  const lower = value.trim().toLowerCase();
  const key = index.names.has(lower) ? lower : lower.split("/").filter(Boolean).at(-1) ?? "";
  return index.names.has(key) ? { grounded: true, ptr: index.names.get(key) ?? null } : { grounded: false, ptr: null };
}

/**
 * Sets every block's provenance from the tenant context, whatever the model put there: a data-table row
 * is grounded when its steering cell (or, without one, any cell) names something in the context; gauges
 * are always model estimates (no context number backs them); policy hops and events are grounded by node
 * and caller. Grounded rows bind to the ptr:// dataset their name was read from.
 */
export function bindCardToGrounding(card: SynthesizedDynamicCard, index: GroundingIndex | null): SynthesizedDynamicCard {
  const blocks = card.blocks.map((block): SynthesizedBlock => {
    const { provenance: _p, dataPtr: _d, ...base } = block as SynthesizedBlock & { provenance?: unknown; dataPtr?: unknown };
    switch (block.kind) {
      case "data-table": {
        const steerKey = rowSteerColumn(block);
        const ungroundedRows: number[] = [];
        let ptr: string | null = null;
        block.rows.forEach((row, i) => {
          const cells = steerKey ? [row[steerKey]] : Object.values(row);
          const hit = cells.map((v) => groundedPtr(index, v)).find((h) => h.grounded);
          if (!hit) ungroundedRows.push(i);
          else ptr ??= hit.ptr;
        });
        const { ungroundedRows: _u, ...table } = base as typeof block;
        return { ...table, kind: "data-table", provenance: provenanceOf(block.rows.length - ungroundedRows.length, block.rows.length), ungroundedRows, ...(ptr ? { dataPtr: ptr } : {}) };
      }
      case "quota-gauges":
        return { ...(base as typeof block), provenance: "model-estimate" };
      case "policy-chain": {
        const hits = block.hops.map((h) => groundedPtr(index, h.node));
        const ptr = hits.find((h) => h.ptr)?.ptr;
        return { ...(base as typeof block), provenance: provenanceOf(hits.filter((h) => h.grounded).length, hits.length), ...(ptr ? { dataPtr: ptr } : {}) };
      }
      case "event-stream": {
        const hits = block.events.map((e) => groundedPtr(index, e.caller));
        const ptr = hits.find((h) => h.ptr)?.ptr;
        return { ...(base as typeof block), provenance: provenanceOf(hits.filter((h) => h.grounded).length, hits.length), ...(ptr ? { dataPtr: ptr } : {}) };
      }
      case "config-diff":
        return base as typeof block;
    }
  });
  return { ...card, blocks };
}

/**
 * Whether a row click may steer: false when `value` appears only in model-authored rows of the ticket's
 * synthesized cards, true when a grounded row holds it, null when no synthesized row holds it (another view).
 */
export function rowClickGrounded(cards: SynthesizedDynamicCard[], key: string, value: string): boolean | null {
  let seenModelRow = false;
  for (const card of cards) {
    for (const block of card.blocks) {
      if (block.kind !== "data-table") continue;
      const modelRows = new Set(block.ungroundedRows ?? (block.provenance === "tenant-data" ? [] : block.rows.map((_, i) => i)));
      for (const [i, row] of block.rows.entries()) {
        const cells = row[key] !== undefined ? [row[key]] : Object.values(row);
        if (!cells.some((c) => String(c) === value)) continue;
        if (!modelRows.has(i)) return true;
        seenModelRow = true;
      }
    }
  }
  return seenModelRow ? false : null;
}
