import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCENARIO_REGISTRY,
  TENANT_REGISTRY,
  TicketExtractionSchema,
  customScenarioId,
  getCustomScenario,
  isTenantId,
  listCustomScenarios,
  registerCustomScenario,
  type CanvasComponentType,
  type CustomScenarioEntry,
  type ExtractedEntity,
  type ScenarioId,
  type ScenarioListItem,
  type TicketExtraction,
  type TicketIntent,
} from "@contextpane/catalog";
import { CA_POSTURE, INTUNE_SCENARIOS, LICENSE_ANOMALY, WORKLOAD_IDENTITY, getManifestTenant } from "@contextpane/mcp-msgraph";
import { config } from "../config.ts";

/**
 * Unscripted ticket triage: a dynamic entity & intent extractor over the pasted text,
 * matched against the live-seeded tenant objects the MCP servers know (users, groups,
 * policies, devices, resources), then the registration of a CUSTOM-<hash> scenario that
 * inherits the closest built-in pattern. Deterministic and Tier 0 (0 tokens, <5 ms): the
 * model router takes over at correlate time, exactly as for a scripted ticket.
 */

export interface CustomTicketRequest {
  title: string;
  body: string;
  customerName?: string;
}

interface Vote {
  intent: TicketIntent;
  re: RegExp;
  components: CanvasComponentType[];
  base: Partial<Record<ScenarioId, number>>;
}

const VOTES: Vote[] = [
  { intent: "avd", re: /\bavd\b|virtual desktop|host ?pool|session host|vdpool|remote desktop/i, components: ["IaCDriftBanner", "EntraSignInTimeline"], base: { "INC-4092": 3 } },
  { intent: "nsg", re: /\bnsg\b|\b3389\b|\brdp\b|network security group|firewall\s+port|\bport\s+\d+|inbound rule|terraform|tag drift|\bhcl\b/i, components: ["IaCDriftBanner"], base: { "INC-4092": 3 } },
  { intent: "license", re: /licen[cs]e|\bsku\b|spe_e[35]|\be[35]\b|\bseats?\b|countviolation|orphan|unlicensed/i, components: ["LicenseDriftCard"], base: { "INC-4092": 1, "ANOM-LIC-101": 1 } },
  { intent: "copilot", re: /copilot/i, components: ["LicenseDriftCard"], base: { "ANOM-LIC-101": 3 } },
  { intent: "conditional-access", re: /conditional access|\bca-?\d{3}\b|\bca policy|\bmfa\b|aadsts5300[03]|blocked by (a )?policy|sign-?in (fail|block|den)|require compliant/i, components: ["EntraSignInTimeline"], base: { "ANOM-CA-204": 1 } },
  { intent: "break-glass", re: /break[- ]?glass|bg-admin|emergency access/i, components: ["EntraSignInTimeline"], base: { "ANOM-CA-204": 4 } },
  { intent: "legacy-auth", re: /legacy auth|\bimap\b|smtp auth|basic auth|report[- ]only/i, components: ["EntraSignInTimeline"], base: { "ANOM-CA-204": 4 } },
  { intent: "bitlocker", re: /bitlocker|0x87d1fde8|disk encryption|\bencrypt/i, components: ["IntuneDriftCard"], base: { "INC-4099": 4 } },
  { intent: "intune-compliance", re: /\bintune\b|complian[ct]|check-?ins?\b|\bmdm\b|laptops?\b|\bdevices?\b|workstation|grace period/i, components: ["IntuneDriftCard"], base: { "INC-4099": 1, "ANOM-INT-309": 1 } },
  { intent: "asr", re: /\basr\b|attack surface|lsass|credential stealing/i, components: ["IntuneDriftCard"], base: { "ANOM-INT-309": 4 } },
  { intent: "firewall", re: /\bfirewall\b(?!\s+port)(?![^.]*\b3389\b)|enablefirewall|firewall profile/i, components: ["IntuneDriftCard"], base: { "ANOM-INT-309": 3 } },
  { intent: "workload-identity", re: /service principal|\bspn\b|app registration|workload identity|enterprise app|erp[- ]sync|sync app|\bowner\b|github actions|federat/i, components: ["EntraSignInTimeline"], base: { "ANOM-APP-401": 4 } },
  { intent: "secret", re: /client secret|\bsecret\b|aadsts7000222|credential(s)? (has |have )?expired|expired (client )?(secret|credential|certificate)/i, components: ["EntraSignInTimeline"], base: { "ANOM-APP-401": 4 } },
  { intent: "oauth", re: /\boauth|consent|graph (api )?scope|api permission|overprivileged|least privilege/i, components: ["EntraSignInTimeline"], base: { "ANOM-APP-401": 2 } },
];

const COMPONENT_ORDER: CanvasComponentType[] = ["LicenseDriftCard", "EntraSignInTimeline", "IntuneDriftCard", "IaCDriftBanner"];

interface KnownObject {
  id: string;
  label: string;
  type: ExtractedEntity["type"];
  category: ExtractedEntity["category"];
  source: string;
  tenantId: string | null;
  /** Lower-cased needles that mean this object (display name, first/last name, short id). */
  needles: string[];
}

function knownObjects(): KnownObject[] {
  const out: KnownObject[] = [];
  const nameNeedles = (displayName: string) => {
    const parts = displayName.toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
    return [displayName.toLowerCase(), ...parts];
  };
  for (const tenantId of Object.keys(TENANT_REGISTRY)) {
    const t = getManifestTenant(tenantId);
    for (const u of t.users) out.push({ id: u.upn, label: u.displayName, type: "upn", category: "identity", source: "mcp-msgraph · GET /users", tenantId, needles: [u.upn.toLowerCase(), u.upn.split("@")[0]!.toLowerCase(), ...nameNeedles(u.displayName)] });
    for (const g of t.groups) out.push({ id: g.displayName, label: g.displayName, type: "group", category: "licensing", source: "mcp-msgraph · GET /groups", tenantId, needles: [g.displayName.toLowerCase()] });
    for (const p of t.conditionalAccessPolicies ?? []) out.push({ id: p.displayName, label: p.displayName.replace("[ContextPane-Demo] ", ""), type: "policy", category: "identity", source: "mcp-msgraph · GET /identity/conditionalAccess/policies", tenantId, needles: [p.displayName.toLowerCase().replace("[contextpane-demo] ", "")] });
    const nsg = t.azure?.nsg.name;
    if (nsg) out.push({ id: nsg, label: nsg, type: "resource", category: "azure", source: "mcp-azure-iac · ARM networkSecurityGroups", tenantId, needles: [nsg.toLowerCase()] });
    const rg = t.azure?.resourceGroup;
    if (rg) out.push({ id: rg, label: rg, type: "resource", category: "azure", source: "mcp-azure-iac · ARM resourceGroups", tenantId, needles: [rg.toLowerCase()] });
    if (tenantId === "tenant-contoso-01") out.push({ id: "vdpool-contoso-fin-01", label: "vdpool-contoso-fin-01", type: "resource", category: "azure", source: "mcp-azure-iac · ARM hostPools", tenantId, needles: ["vdpool-contoso-fin-01", "host pool"] });
  }
  for (const u of LICENSE_ANOMALY.users) out.push({ id: u.upn, label: u.displayName, type: "upn", category: "licensing", source: "mcp-msgraph · GET /users?$filter=accountEnabled", tenantId: "tenant-contoso-01", needles: [u.upn.toLowerCase(), ...nameNeedles(u.displayName)] });
  out.push({ id: LICENSE_ANOMALY.groupName, label: LICENSE_ANOMALY.groupName, type: "group", category: "licensing", source: "mcp-msgraph · GET /groups", tenantId: "tenant-contoso-01", needles: [LICENSE_ANOMALY.groupName.toLowerCase()] });
  out.push({ id: CA_POSTURE.breakGlassAccount, label: "bg-admin-01", type: "upn", category: "identity", source: "mcp-msgraph · GET /users", tenantId: "tenant-contoso-01", needles: ["bg-admin-01", CA_POSTURE.breakGlassAccount.toLowerCase()] });
  out.push({ id: CA_POSTURE.breakGlassGroup, label: CA_POSTURE.breakGlassGroup, type: "group", category: "identity", source: "mcp-msgraph · GET /groups", tenantId: "tenant-contoso-01", needles: [CA_POSTURE.breakGlassGroup.toLowerCase(), "break-glass group", "breakglass"] });
  for (const p of CA_POSTURE.policies) out.push({ id: p.displayName, label: p.displayName.replace("[ContextPane-Demo] ", ""), type: "policy", category: "identity", source: "mcp-msgraph · GET /identity/conditionalAccess/policies", tenantId: "tenant-contoso-01", needles: [p.displayName.toLowerCase().replace("[contextpane-demo] ", ""), p.key.toLowerCase()] });
  for (const [key, fixture] of Object.entries(INTUNE_SCENARIOS)) {
    const tenantId = key === "INC-4099" ? "tenant-fabrikam-02" : "tenant-contoso-01";
    for (const p of fixture.policies) out.push({ id: p.name, label: p.name, type: "policy", category: "intune", source: "mcp-msgraph · GET /deviceManagement/configurationPolicies", tenantId, needles: [p.name.toLowerCase()] });
    for (const d of fixture.devices) out.push({ id: d.deviceName, label: d.deviceName, type: "device", category: "intune", source: "mcp-msgraph · GET /deviceManagement/managedDevices", tenantId, needles: [d.deviceName.toLowerCase()] });
    for (const g of new Set(fixture.policies.flatMap((p) => p.assignedTo))) out.push({ id: g, label: g, type: "group", category: "intune", source: "mcp-msgraph · GET /groups", tenantId, needles: [g.toLowerCase()] });
  }
  out.push({ id: WORKLOAD_IDENTITY.spn.displayName, label: WORKLOAD_IDENTITY.spn.displayName, type: "resource", category: "identity", source: "mcp-msgraph · GET /servicePrincipals", tenantId: "tenant-contoso-01", needles: [WORKLOAD_IDENTITY.spn.displayName.toLowerCase(), "erp sync", "erp-sync", "sync app"] });
  out.push({ id: WORKLOAD_IDENTITY.owner.upn, label: WORKLOAD_IDENTITY.owner.displayName, type: "upn", category: "identity", source: "mcp-msgraph · GET /applications/{id}/owners", tenantId: "tenant-contoso-01", needles: [WORKLOAD_IDENTITY.owner.upn.toLowerCase(), ...nameNeedles(WORKLOAD_IDENTITY.owner.displayName), "contractor", "app owner"] });
  return out;
}

let knownCache: KnownObject[] | null = null;
const known = () => (knownCache ??= knownObjects());

const SKU_WORDS: Array<[RegExp, string]> = [
  [/\bspe_e5\b|\bm365 e5\b|\bmicrosoft 365 e5\b|\be5\b/i, "SPE_E5"],
  [/\bspe_e3\b|\bm365 e3\b|\bmicrosoft 365 e3\b|\be3\b/i, "SPE_E3"],
  [/microsoft_365_copilot|\bcopilot\b/i, "Microsoft_365_Copilot"],
];

function hasWord(text: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${esc}([^a-z0-9_]|$)`, "i").test(text);
}

function detectTenant(text: string, customerName?: string): string {
  const probe = `${customerName ?? ""} ${text}`.toLowerCase();
  if (/fabrikam|\blegal\b/.test(probe)) return "tenant-fabrikam-02";
  return "tenant-contoso-01";
}

/** The deterministic entity & intent extractor. Pure: no I/O, no model. */
export function extractTicket(input: CustomTicketRequest): TicketExtraction {
  const text = `${input.title}\n${input.body}`;
  const lower = text.toLowerCase();
  const tenantId = detectTenant(text, input.customerName);
  const intents: TicketIntent[] = [];
  const components = new Set<CanvasComponentType>();
  const base: Partial<Record<ScenarioId, number>> = {};
  const why: string[] = [];
  for (const v of VOTES) {
    if (!v.re.test(text)) continue;
    intents.push(v.intent);
    for (const c of v.components) components.add(c);
    for (const [id, n] of Object.entries(v.base)) base[id as ScenarioId] = (base[id as ScenarioId] ?? 0) + (n ?? 0);
    why.push(v.intent);
  }
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const push = (e: ExtractedEntity) => {
    const key = `${e.type}:${e.id.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push(e);
  };
  // Literal identifiers first: UPNs, error codes, SKUs, device names.
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const upn = m[0];
    const hit = known().find((k) => k.type === "upn" && k.id.toLowerCase() === upn.toLowerCase());
    push({ id: upn, label: hit?.label ?? upn, type: "upn", category: "identity", resolvedTo: hit?.id ?? null, source: hit?.source ?? "ticket text", confidence: hit ? 1 : 0.6 });
  }
  for (const m of text.matchAll(/\bAADSTS\d{4,7}\b/gi)) {
    const code = m[0].toUpperCase();
    const cat = code === "AADSTS7000222" ? "identity" : "identity";
    push({ id: code, label: code, type: "errorCode", category: cat, resolvedTo: code, source: "mcp-msgraph · GET /auditLogs/signIns (status/errorCode)", confidence: 1 });
    if (code === "AADSTS7000222") { base["ANOM-APP-401"] = (base["ANOM-APP-401"] ?? 0) + 4; components.add("EntraSignInTimeline"); }
    else if (code === "AADSTS53000") { base["INC-4099"] = (base["INC-4099"] ?? 0) + 2; components.add("EntraSignInTimeline"); }
    else if (code === "AADSTS53003") { base["INC-4092"] = (base["INC-4092"] ?? 0) + 3; components.add("EntraSignInTimeline"); }
  }
  for (const m of text.matchAll(/\b0x87D[0-9A-F]{5}\b/gi)) {
    const code = m[0].toUpperCase().replace("0X", "0x");
    push({ id: code, label: code, type: "errorCode", category: "intune", resolvedTo: code, source: "mcp-msgraph · deviceManagement/deviceConfigurationDeviceStateSummaries", confidence: 1 });
    components.add("IntuneDriftCard");
    base["INC-4099"] = (base["INC-4099"] ?? 0) + 3;
  }
  if (/countviolation/i.test(text)) push({ id: "CountViolation", label: "CountViolation", type: "errorCode", category: "licensing", resolvedTo: "CountViolation", source: "mcp-msgraph · GET /groups/{id}?$select=licenseProcessingState", confidence: 1 });
  for (const [re, sku] of SKU_WORDS) if (re.test(text)) push({ id: sku, label: sku === "Microsoft_365_Copilot" ? "Copilot" : sku, type: "sku", category: "licensing", resolvedTo: sku, source: "mcp-msgraph · GET /subscribedSkus", confidence: 1 });
  for (const m of text.matchAll(/\b(?:CONTOSO|FAB|FABRIKAM)-[A-Z]{2,4}-\d{3,4}\b/gi)) {
    const name = m[0].toUpperCase();
    const hit = known().find((k) => k.type === "device" && k.id === name);
    push({ id: name, label: name, type: "device", category: "intune", resolvedTo: hit?.id ?? null, source: hit?.source ?? "ticket text", confidence: hit ? 1 : 0.5 });
  }
  // Names, groups, policies, resources the tenant knows, by display name or first/last name.
  for (const k of known()) {
    if (k.tenantId && k.tenantId !== tenantId) continue;
    if (k.type === "upn" && seen.has(`upn:${k.id.toLowerCase()}`)) continue;
    const needle = k.needles.find((n) => n.length >= 3 && hasWord(lower, n));
    if (!needle) continue;
    // A bare first name is weaker evidence than a full name or an id.
    const confidence = needle.includes(" ") || needle.includes("@") || needle.includes("-") || needle.length > 8 ? 1 : 0.7;
    push({ id: k.id, label: k.label, type: k.type, category: k.category, resolvedTo: k.id, source: k.source, confidence });
    if (k.type === "upn") components.add(components.has("LicenseDriftCard") ? "LicenseDriftCard" : "EntraSignInTimeline");
    if (k.category === "azure") components.add("IaCDriftBanner");
    if (k.category === "intune") components.add("IntuneDriftCard");
    if (k.id === WORKLOAD_IDENTITY.spn.displayName || k.id === WORKLOAD_IDENTITY.owner.upn) base["ANOM-APP-401"] = (base["ANOM-APP-401"] ?? 0) + 2;
    if (k.id === CA_POSTURE.breakGlassGroup || k.id === CA_POSTURE.breakGlassAccount) base["ANOM-CA-204"] = (base["ANOM-CA-204"] ?? 0) + 2;
    if (k.id === LICENSE_ANOMALY.groupName) base["ANOM-LIC-101"] = (base["ANOM-LIC-101"] ?? 0) + 2;
  }
  // Pick the base pattern: the tenant decides what exists; the votes decide which story it is.
  let baseScenarioId: ScenarioId;
  if (tenantId === "tenant-fabrikam-02") baseScenarioId = "INC-4099";
  else {
    const ranked = (Object.entries(base) as Array<[ScenarioId, number]>).filter(([id]) => SCENARIO_REGISTRY[id].tenantId === tenantId).sort((a, b) => b[1] - a[1]);
    baseScenarioId = ranked[0]?.[0] ?? "INC-4092";
  }
  if (tenantId === "tenant-fabrikam-02") components.delete("IaCDriftBanner");
  const ordered = COMPONENT_ORDER.filter((c) => components.has(c));
  const finalComponents = ordered.length ? ordered : [...SCENARIO_REGISTRY[baseScenarioId].components];
  const matched = entities.filter((e) => e.resolvedTo).length;
  const rationale = `${why.length ? `intents ${why.join(", ")}` : "no intent keywords"}; ${matched}/${entities.length} entities resolved against ${tenantId}; closest pattern ${baseScenarioId} (${SCENARIO_REGISTRY[baseScenarioId].remediationScope})`.slice(0, 300);
  return TicketExtractionSchema.parse({ tenantId, baseScenarioId, intents, entities, components: finalComponents, rationale });
}

/* ------------------------------- registration ------------------------------- */

function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

const FILE = join(config.dataDir, "custom-scenarios.json");
const persist = process.env.NODE_ENV !== "test";

function save() {
  if (!persist) return;
  try {
    mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, scenarios: listCustomScenarios().reverse() }, null, 2) + "\n", "utf8");
    renameSync(tmp, FILE);
  } catch (error) {
    console.warn(`[custom-tickets] persist failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let loaded = false;
/** Re-registers the custom tickets of the last run (data/custom-scenarios.json) so a restart keeps them. */
export function loadCustomScenarios(): number {
  if (loaded || !persist) return 0;
  loaded = true;
  if (!existsSync(FILE)) return 0;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as { scenarios?: CustomScenarioEntry[] };
    let n = 0;
    for (const s of raw.scenarios ?? []) {
      if (!s?.scenarioId?.startsWith("CUSTOM-") || !isTenantId(s.tenantId) || !(s.baseScenarioId in SCENARIO_REGISTRY)) continue;
      const extraction = TicketExtractionSchema.safeParse(s.extraction);
      if (!extraction.success) continue;
      registerCustomScenario({ ...s, extraction: extraction.data });
      n++;
    }
    return n;
  } catch (error) {
    console.warn(`[custom-tickets] ignoring unreadable ${FILE}: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

export function registerCustomTicket(input: CustomTicketRequest): CustomScenarioEntry {
  const title = input.title.trim().slice(0, 140);
  const body = input.body.trim().slice(0, 6000);
  const extraction = extractTicket({ title, body, ...(input.customerName ? { customerName: input.customerName } : {}) });
  const id = customScenarioId(shortHash(`${title}\n${body}`));
  const base = SCENARIO_REGISTRY[extraction.baseScenarioId];
  const entry = registerCustomScenario({
    scenarioId: id,
    kind: "ticket",
    tenantId: extraction.tenantId as CustomScenarioEntry["tenantId"],
    title,
    remediationScope: base.remediationScope,
    components: extraction.components,
    baseScenarioId: extraction.baseScenarioId,
    shortHash: id.slice("CUSTOM-".length),
    createdAt: new Date().toISOString(),
    ticket: { title, body, ...(input.customerName ? { customerName: input.customerName.trim().slice(0, 80) } : {}) },
    extraction,
  });
  save();
  return entry;
}

export function customScenarioListItem(entry: CustomScenarioEntry, resolved: boolean): ScenarioListItem {
  return {
    scenarioId: entry.scenarioId,
    kind: "ticket",
    tenantId: entry.tenantId,
    tenantName: TENANT_REGISTRY[entry.tenantId].displayName,
    title: entry.title,
    resolved,
    custom: { baseScenarioId: entry.baseScenarioId, shortHash: entry.shortHash, createdAt: entry.createdAt, ticket: entry.ticket, extraction: entry.extraction, components: entry.components },
  };
}

export { getCustomScenario, listCustomScenarios };

/** The three 1-click samples the composer offers; also what the tests and the smoke run paste. */
export const SAMPLE_UNSCRIPTED_TICKETS: Array<{ id: string; title: string; body: string; customerName: string }> = [
  {
    id: "avd-diego",
    title: "Finance user Diego cannot connect to AVD and firewall port 3389 looks open",
    body: "Diego Siciliani (Finance) gets a block when he opens the Azure Virtual Desktop client this morning; the dialog shows AADSTS53003. He was moved to the new M365 E5 bundle last week but still seems to be on E3. While checking the host pool nsg-contoso-avd-hostpool-01 a vendor rule allowing RDP 3389 from the internet is visible in the portal, which is not in our Terraform.",
    customerName: "Contoso Finance",
  },
  {
    id: "legal-bitlocker",
    title: "Legal laptops failing BitLocker check-in with conflict error",
    body: "Several Fabrikam Legal Windows 11 laptops show 'Not compliant' in the Company Portal since the weekend. Intune reports error 0x87D1FDE8 on the BitLocker policy and the devices sit in a conflict between the old Fabrikam-Legacy-BitLocker-DeviceConfig profile and the disk encryption baseline. Grady Archie cannot open Outlook (AADSTS53000, require compliant device).",
    customerName: "Fabrikam Legal",
  },
  {
    id: "erp-secret",
    title: "ERP sync app failing with expired secret AADSTS7000222 and contractor still listed as owner",
    body: "The nightly GitHub Actions run of spn-contoso-erp-sync fails with AADSTS7000222 (client secret expired). The app registration still lists the contractor Alex Wilber as owner although he holds no admin role, and the granted Graph scopes (Directory.ReadWrite.All, Sites.FullControl.All, Mail.ReadWrite) look far wider than what the sync uses. Please rotate to a federated credential and right-size the permissions.",
    customerName: "Contoso Finance",
  },
];
