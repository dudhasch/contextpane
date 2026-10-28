import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCENARIO_REGISTRY,
  TENANT_REGISTRY,
  TicketExtractionSchema,
  clearCustomScenarios,
  customScenarioId,
  displayScenarioId,
  getCustomScenario,
  isTenantId,
  listCustomScenarios,
  registerCustomScenario,
  unregisterCustomScenario,
  type CanvasComponentType,
  type CustomScenarioEntry,
  type CustomScenarioId,
  type ErpDropSource,
  type ExtractedEntity,
  type ScenarioId,
  type ScenarioListItem,
  type TicketExtraction,
  type TicketIntent,
} from "@contextpane/catalog";
import { CA_POSTURE, INTUNE_SCENARIOS, LICENSE_ANOMALY, WORKLOAD_IDENTITY, getManifestTenant } from "@contextpane/mcp-msgraph";
import { config } from "../config.ts";
import { correlateUpstreamCloudStatus, correlateUpstreamCloudStatusSync } from "./cloud-status-correlator.ts";
import {
  assessTicketElementNeeds,
  buildDeterministicRoutingDecision,
  synthesizeAndPersistMissingElements,
  synthesizeAndPersistMissingElementsSync,
} from "./dynamic-catalog.ts";
import { LAB_INCIDENT_TICKETS } from "./erp-drop-generator.ts";
import {
  applyClarifiedAnswersToEntry,
  buildCustomTicketRemediationSync,
  buildSubAgentPipelineRecords,
  generateClarifyingQuestionsSync,
  refineEntryWithSubAgentsAsync,
  runSubAgentPipeline,
  verifyAndRepairGeneratedScript,
} from "./subagent-orchestrator.ts";

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
  requester?: { displayName: string; upn: string; role: string };
  priority?: string;
  clarifiedAnswers?: Record<string, string>;
}

/** How a ticket enters the registry: pasted (CUSTOM-<hash>) or dropped into the inbox (ERP-<id>). */
export interface RegisterOptions {
  scenarioId?: CustomScenarioId;
  origin?: "unscripted" | "erp-drop";
  createdAt?: string;
  erpDrop?: ErpDropSource;
}

interface Vote {
  intent: TicketIntent;
  re: RegExp;
  components: CanvasComponentType[];
  base: Partial<Record<ScenarioId, number>>;
}

const VOTES: Vote[] = [
  { intent: "avd", re: /\bavd\b|virtual desktop|host ?pool|session host|vdpool|remote desktop|aadloginforwindows|0x801c0042|vmextensionprovisioningerror|usererrorguestagent|operationnotallowed|dracut|initramfs/i, components: ["IaCDriftBanner", "EntraSignInTimeline"], base: { "INC-4092": 3 } },
  { intent: "nsg", re: /\bnsg\b|\b3389\b|\brdp\b|network security group|firewall\s+port|\bport\s+\d+|inbound rule|terraform|tag drift|\bhcl\b|aadds104|aadds501|no_proposal_chosen|ipsec|expressroute|asymmetric|requestdisallowedbypolicy|subnetisfull/i, components: ["IaCDriftBanner"], base: { "INC-4092": 3 } },
  { intent: "license", re: /licen[cs]e|\bsku\b|spe_e[35]|\be[35]\b|\bseats?\b|countviolation|orphan|unlicensed|latearrivingdata|_timereceived|cost anomaly|orphaneddisks/i, components: ["LicenseDriftCard"], base: { "INC-4092": 1, "ANOM-LIC-101": 2 } },
  { intent: "copilot", re: /copilot/i, components: ["LicenseDriftCard"], base: { "ANOM-LIC-101": 3 } },
  { intent: "conditional-access", re: /conditional access|\bca-?\d{3}\b|cap-\d{3}|\bca policy|\bmfa\b|aadsts5300[03]|aadsts50020|anomaloustoken|impossible travel|largeobject|usercertificate|overquota|blocked by (a )?policy|sign-?in (fail|block|den)|require compliant/i, components: ["EntraSignInTimeline"], base: { "ANOM-CA-204": 2 } },
  { intent: "break-glass", re: /break[- ]?glass|bg-admin|emergency access/i, components: ["EntraSignInTimeline"], base: { "ANOM-CA-204": 4 } },
  { intent: "legacy-auth", re: /legacy auth|\bimap\b|smtp auth|basic auth|report[- ]only/i, components: ["EntraSignInTimeline"], base: { "ANOM-CA-204": 4 } },
  { intent: "bitlocker", re: /bitlocker|0x87d1fde8|disk encryption|\bencrypt/i, components: ["IntuneDriftCard"], base: { "INC-4099": 4 } },
  { intent: "intune-compliance", re: /\bintune\b|complian[ct]|check-?ins?\b|\bmdm\b|laptops?\b|\bdevices?\b|workstation|grace period/i, components: ["IntuneDriftCard"], base: { "INC-4099": 1, "ANOM-INT-309": 1 } },
  { intent: "asr", re: /\basr\b|attack surface|lsass|credential stealing/i, components: ["IntuneDriftCard"], base: { "ANOM-INT-309": 4 } },
  { intent: "firewall", re: /\bfirewall\b(?!\s+port)(?![^.]*\b3389\b)|enablefirewall|firewall profile|event\s*id\s*5156|eventid5156|filtering platform/i, components: ["IntuneDriftCard"], base: { "ANOM-INT-309": 3 } },
  { intent: "workload-identity", re: /service principal|\bspn\b|app registration|workload identity|enterprise app|erp[- ]sync|sync app|\bowner\b|github actions|federat|pimroleoutsidegovernance|roleassignmentupdatenotpermitted|authorizationpermissionmismatch/i, components: ["EntraSignInTimeline"], base: { "ANOM-APP-401": 4 } },
  { intent: "secret", re: /client secret|\bsecret\b|aadsts7000222|credential(s)? (has |have )?expired|expired (client )?(secret|credential|certificate)/i, components: ["EntraSignInTimeline"], base: { "ANOM-APP-401": 4 } },
  { intent: "oauth", re: /\boauth|consent|graph (api )?scope|api permission|overprivileged|least privilege|right[- ]size/i, components: ["EntraSignInTimeline"], base: { "ANOM-APP-401": 2 } },
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
  /** The built-in pattern this object belongs to, when it is specific to one. */
  scenarioId?: ScenarioId;
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
    if (tenantId === "tenant-contoso-01") {
      out.push({ id: "vdpool-contoso-fin-01", label: "vdpool-contoso-fin-01", type: "resource", category: "azure", source: "mcp-azure-iac · ARM hostPools", tenantId, needles: ["vdpool-contoso-fin-01", "host pool"] });
      out.push({ id: "vm-contoso-avd-0", label: "vm-contoso-avd-0", type: "resource", category: "azure", source: "mcp-azure-iac · ARM virtualMachines", tenantId, needles: ["vm-contoso-avd-0"] });
      out.push({ id: "vm-contoso-avd-1", label: "vm-contoso-avd-1", type: "resource", category: "azure", source: "mcp-azure-iac · ARM virtualMachines", tenantId, needles: ["vm-contoso-avd-1"] });
      out.push({ id: "stcontosofslogix01", label: "stcontosofslogix01", type: "resource", category: "azure", source: "mcp-azure-iac · ARM storageAccounts", tenantId, needles: ["stcontosofslogix01"] });
      out.push({ id: "CONTOSO-LT-0288", label: "CONTOSO-LT-0288", type: "device", category: "intune", source: "mcp-msgraph · GET /deviceManagement/managedDevices", tenantId, needles: ["contoso-lt-0288"] });
    }
  }
  for (const u of LICENSE_ANOMALY.users) out.push({ id: u.upn, label: u.displayName, type: "upn", category: "licensing", source: "mcp-msgraph · GET /users?$filter=accountEnabled", tenantId: "tenant-contoso-01", needles: [u.upn.toLowerCase(), ...nameNeedles(u.displayName)], scenarioId: "ANOM-LIC-101" });
  out.push({ id: LICENSE_ANOMALY.groupName, label: LICENSE_ANOMALY.groupName, type: "group", category: "licensing", source: "mcp-msgraph · GET /groups", tenantId: "tenant-contoso-01", needles: [LICENSE_ANOMALY.groupName.toLowerCase()] });
  out.push({ id: CA_POSTURE.breakGlassAccount, label: "bg-admin-01", type: "upn", category: "identity", source: "mcp-msgraph · GET /users", tenantId: "tenant-contoso-01", needles: ["bg-admin-01", CA_POSTURE.breakGlassAccount.toLowerCase()], scenarioId: "ANOM-CA-204" });
  out.push({ id: CA_POSTURE.breakGlassGroup, label: CA_POSTURE.breakGlassGroup, type: "group", category: "identity", source: "mcp-msgraph · GET /groups", tenantId: "tenant-contoso-01", needles: [CA_POSTURE.breakGlassGroup.toLowerCase(), "break-glass group", "breakglass"] });
  for (const p of CA_POSTURE.policies) out.push({ id: p.displayName, label: p.displayName.replace("[ContextPane-Demo] ", ""), type: "policy", category: "identity", source: "mcp-msgraph · GET /identity/conditionalAccess/policies", tenantId: "tenant-contoso-01", needles: [p.displayName.toLowerCase().replace("[contextpane-demo] ", ""), p.key.toLowerCase()] });
  for (const [key, fixture] of Object.entries(INTUNE_SCENARIOS)) {
    const tenantId = key === "INC-4099" ? "tenant-fabrikam-02" : "tenant-contoso-01";
    for (const p of fixture.policies) out.push({ id: p.name, label: p.name, type: "policy", category: "intune", source: "mcp-msgraph · GET /deviceManagement/configurationPolicies", tenantId, needles: [p.name.toLowerCase()] });
    for (const d of fixture.devices) out.push({ id: d.deviceName, label: d.deviceName, type: "device", category: "intune", source: "mcp-msgraph · GET /deviceManagement/managedDevices", tenantId, needles: [d.deviceName.toLowerCase()] });
    for (const g of new Set(fixture.policies.flatMap((p) => p.assignedTo))) out.push({ id: g, label: g, type: "group", category: "intune", source: "mcp-msgraph · GET /groups", tenantId, needles: [g.toLowerCase()] });
  }
  out.push({ id: WORKLOAD_IDENTITY.spn.displayName, label: WORKLOAD_IDENTITY.spn.displayName, type: "resource", category: "identity", source: "mcp-msgraph · GET /servicePrincipals", tenantId: "tenant-contoso-01", needles: [WORKLOAD_IDENTITY.spn.displayName.toLowerCase(), "erp sync", "erp-sync", "sync app"] });
  out.push({ id: WORKLOAD_IDENTITY.owner.upn, label: WORKLOAD_IDENTITY.owner.displayName, type: "upn", category: "identity", source: "mcp-msgraph · GET /applications/{id}/owners", tenantId: "tenant-contoso-01", needles: [WORKLOAD_IDENTITY.owner.upn.toLowerCase(), ...nameNeedles(WORKLOAD_IDENTITY.owner.displayName), "contractor", "app owner"], scenarioId: "ANOM-APP-401" });
  return out;
}

let knownCache: KnownObject[] | null = null;
const known = () => (knownCache ??= knownObjects());

const SKU_WORDS: Array<[RegExp, string]> = [
  [/\bspe_e5\b|\bm365 e5\b|\bmicrosoft 365 e5\b|\be5\b/i, "SPE_E5"],
  [/\bspe_e3\b|\bm365 e3\b|\bmicrosoft 365 e3\b|\be3\b/i, "SPE_E3"],
  [/microsoft_365_copilot|\bcopilot\b/i, "Microsoft_365_Copilot"],
];

/** Graph permission scopes: Resource(.Segment).Verb(.Qualifier)(.All), e.g. Mail.ReadWrite, User.Read.All, Sites.Selected. */
const GRAPH_SCOPE_RE = /\b[A-Z][A-Za-z]+(?:\.[A-Z][A-Za-z]+){1,3}\b|\boffline_access\b/g;
const SCOPE_VERBS = new Set(["Read", "ReadWrite", "ReadBasic", "Write", "FullControl", "Manage", "Selected", "Send", "Create", "AccessAsUser", "Invite"]);

export function isGraphScope(token: string): boolean {
  if (token === "offline_access") return true;
  const parts = token.split(".");
  return parts.length >= 2 && (parts.slice(1).some((p) => SCOPE_VERBS.has(p)) || parts.at(-1) === "All");
}

/** Scopes the workload-identity fixture actually grants or needs; anything else is only text. */
const KNOWN_SCOPES = new Set([...WORKLOAD_IDENTITY.appPermissions, ...WORKLOAD_IDENTITY.requiredPermissions, ...WORKLOAD_IDENTITY.oauth2PermissionGrant.scope.split(" ")]);

/**
 * One person, one pill: when a display name matched several UPNs, keep the one the ticket spelled
 * out, else the one that belongs to the chosen pattern (the app owner for a workload-identity ticket),
 * else the first match.
 */
function dedupeUpns(entities: ExtractedEntity[], lower: string, baseScenarioId: ScenarioId | null): ExtractedEntity[] {
  const hint = new Map(known().filter((k) => k.type === "upn").map((k) => [k.id.toLowerCase(), k.scenarioId]));
  const byName = new Map<string, ExtractedEntity[]>();
  for (const e of entities) if (e.type === "upn") byName.set(e.label.toLowerCase(), [...(byName.get(e.label.toLowerCase()) ?? []), e]);
  const drop = new Set<ExtractedEntity>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const keep =
      group.find((e) => lower.includes(e.id.toLowerCase())) ??
      (baseScenarioId ? group.find((e) => hint.get(e.id.toLowerCase()) === baseScenarioId) : undefined) ??
      group[0]!;
    for (const e of group) if (e !== keep) drop.add(e);
  }
  return entities.filter((e) => !drop.has(e));
}

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
    else if (code === "AADSTS50020") { base["ANOM-CA-204"] = (base["ANOM-CA-204"] ?? 0) + 3; components.add("EntraSignInTimeline"); }
  }
  for (const m of text.matchAll(/\b0x87D[0-9A-F]{5}\b/gi)) {
    const code = m[0].toUpperCase().replace("0X", "0x");
    push({ id: code, label: code, type: "errorCode", category: "intune", resolvedTo: code, source: "mcp-msgraph · deviceManagement/deviceConfigurationDeviceStateSummaries", confidence: 1 });
    components.add("IntuneDriftCard");
    base["INC-4099"] = (base["INC-4099"] ?? 0) + 3;
  }
  if (/countviolation/i.test(text)) push({ id: "CountViolation", label: "CountViolation", type: "errorCode", category: "licensing", resolvedTo: "CountViolation", source: "mcp-msgraph · GET /groups/{id}?$select=licenseProcessingState", confidence: 1 });
  const EXTRA_ERROR_CODES: Array<[RegExp, string, ExtractedEntity["category"], string, ScenarioId, CanvasComponentType]> = [
    [/\bAADDS104\b/i, "AADDS104", "azure", "mcp-azure-iac · ARM domainServices/health", "INC-4092", "IaCDriftBanner"],
    [/\bAADDS501\b/i, "AADDS501", "azure", "mcp-azure-iac · ARM domainServices/health", "INC-4092", "IaCDriftBanner"],
    [/\banomalousToken\b/i, "AnomalousToken", "identity", "mcp-msgraph · GET /identityProtection/riskDetections", "ANOM-CA-204", "EntraSignInTimeline"],
    [/\bPIMRoleOutsideGovernance\b|outside of PIM/i, "PIMRoleOutsideGovernance", "identity", "mcp-msgraph · GET /auditLogs/directoryAudits", "ANOM-APP-401", "EntraSignInTimeline"],
    [/\bLargeObject\b/i, "LargeObject", "identity", "mcp-msgraph · Entra Connect Health syncErrors", "ANOM-CA-204", "EntraSignInTimeline"],
    [/\bUserErrorGuestAgentStatusUnavailable\b/i, "UserErrorGuestAgentStatusUnavailable", "azure", "mcp-azure-iac · RecoveryServices backupJobs", "INC-4092", "IaCDriftBanner"],
    [/\bOperationNotAllowed\b/i, "OperationNotAllowed", "azure", "mcp-azure-iac · ARM Microsoft.Compute/disks", "INC-4092", "IaCDriftBanner"],
    [/\bDracutEmergencyMode\b|\bdracut-initqueue\b/i, "DracutEmergencyMode", "azure", "mcp-azure-iac · ARM bootDiagnostics", "INC-4092", "IaCDriftBanner"],
    [/\b0x801C0042\b|-2145648574/i, "0x801C0042", "azure", "mcp-azure-iac · ARM virtualMachines/extensions (AADLoginForWindows)", "INC-4092", "IaCDriftBanner"],
    [/\bVMExtensionProvisioningError\b/i, "VMExtensionProvisioningError", "azure", "mcp-azure-iac · ARM virtualMachines/extensions", "INC-4092", "IaCDriftBanner"],
    [/\bAuthorizationPermissionMismatch\b/i, "AuthorizationPermissionMismatch", "identity", "mcp-azure-iac · Storage Blob RBAC dataActions", "ANOM-APP-401", "EntraSignInTimeline"],
    [/\bNO_PROPOSAL_CHOSEN\b/i, "NO_PROPOSAL_CHOSEN", "azure", "mcp-azure-iac · ARM virtualNetworkGateways IKEDiagnosticLog", "INC-4092", "IaCDriftBanner"],
    [/\bAsymmetricRoutingDeny\b|Asymmetric Routing/i, "AsymmetricRoutingDeny", "azure", "mcp-azure-iac · AZFWNetworkRule logs", "INC-4092", "IaCDriftBanner"],
    [/\bRoleAssignmentUpdateNotPermitted\b/i, "RoleAssignmentUpdateNotPermitted", "identity", "mcp-azure-iac · Microsoft.Authorization/roleAssignments", "ANOM-APP-401", "EntraSignInTimeline"],
    [/\bRequestDisallowedByPolicy\b/i, "RequestDisallowedByPolicy", "azure", "mcp-azure-iac · Microsoft.Authorization/policyAssignments", "INC-4092", "IaCDriftBanner"],
    [/\bSubnetIsFull\b/i, "SubnetIsFull", "azure", "mcp-azure-iac · ARM Microsoft.Network/subnets", "INC-4092", "IaCDriftBanner"],
    [/\bOverQuota\b/i, "OverQuota", "identity", "mcp-azure-iac · Log Analytics _LogOperation", "ANOM-CA-204", "EntraSignInTimeline"],
    [/\bEventID\s*5156\b/i, "EventID5156", "intune", "mcp-msgraph · Sentinel SecurityEvent / AMA DCR", "ANOM-INT-309", "IntuneDriftCard"],
    [/\bLateArrivingData\b|\b_TimeReceived\b/i, "LateArrivingData", "licensing", "mcp-erp · Log Analytics Usage (_TimeReceived vs TimeGenerated)", "ANOM-LIC-101", "LicenseDriftCard"],
    [/\bOrphanedDisksCostSpike\b|\bCost Anomaly Detected\b/i, "OrphanedDisksCostSpike", "licensing", "mcp-erp · Microsoft Cost Management anomaly alert", "ANOM-LIC-101", "LicenseDriftCard"],
  ];
  for (const [re, code, cat, source, scId, comp] of EXTRA_ERROR_CODES) {
    if (!re.test(text)) continue;
    push({ id: code, label: code, type: "errorCode", category: cat, resolvedTo: code, source, confidence: 1 });
    base[scId] = (base[scId] ?? 0) + 3;
    components.add(comp);
  }
  for (const [re, sku] of SKU_WORDS) if (re.test(text)) push({ id: sku, label: sku === "Microsoft_365_Copilot" ? "Copilot" : sku, type: "sku", category: "licensing", resolvedTo: sku, source: "mcp-msgraph · GET /subscribedSkus", confidence: 1 });
  for (const m of text.matchAll(GRAPH_SCOPE_RE)) {
    const scope = m[0];
    if (!isGraphScope(scope)) continue;
    const knownScope = KNOWN_SCOPES.has(scope);
    push({ id: scope, label: scope, type: "permission", category: "identity", resolvedTo: knownScope ? scope : null, source: knownScope ? "mcp-msgraph · servicePrincipals/{id}/appRoleAssignments" : "ticket text (Graph permission scope)", confidence: knownScope ? 1 : 0.8 });
    components.add("EntraSignInTimeline");
    base["ANOM-APP-401"] = (base["ANOM-APP-401"] ?? 0) + 1;
  }
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
  // Custom tickets stand on their own synthesized brief, cards, and remediation scripts without inheriting INC-4092 or INC-4099.
  const baseScenarioId: ScenarioId | null = null;
  if (tenantId === "tenant-fabrikam-02") components.delete("IaCDriftBanner");
  const ordered = COMPONENT_ORDER.filter((c) => components.has(c));
  const finalComponents: CanvasComponentType[] = ordered.length ? ordered : ["SynthesizedDynamicCard"];
  const rankedHint = (Object.entries(base) as Array<[ScenarioId, number]>).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const finalEntities = dedupeUpns(entities, lower, rankedHint);
  const matched = finalEntities.filter((e) => e.resolvedTo).length;
  const rationale = `${why.length ? `intents ${why.join(", ")}` : "no intent keywords"}; ${matched}/${finalEntities.length} entities resolved against ${tenantId}; standalone custom ticket (baseScenarioId: null)`.slice(0, 300);
  return TicketExtractionSchema.parse({ tenantId, baseScenarioId, intents, entities: finalEntities, components: finalComponents, rationale });
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
      if (!(s?.scenarioId?.startsWith("CUSTOM-") || s?.scenarioId?.startsWith("ERP-")) || !isTenantId(s.tenantId)) continue;
      if (s.baseScenarioId !== null && s.baseScenarioId !== undefined && !(s.baseScenarioId in SCENARIO_REGISTRY)) continue;
      const probe = s.ticket?.requester ? `${s.ticket.body}\n${s.ticket.requester.displayName} ${s.ticket.requester.upn}` : s.ticket?.body ?? "";
      const freshExtraction = s.ticket?.title && probe ? extractTicket({ title: s.ticket.title, body: probe, ...(s.ticket.customerName ? { customerName: s.ticket.customerName } : {}) }) : null;
      const extraction = freshExtraction ? { success: true as const, data: freshExtraction } : TicketExtractionSchema.safeParse(s.extraction);
      if (!extraction.success) continue;
      // Entries written before origins existed were all pasted tickets.
      registerCustomScenario({
        ...s,
        origin: s.origin ?? (s.scenarioId.startsWith("ERP-") ? "erp-drop" : "unscripted"),
        extraction: extraction.data,
        components: s.components?.length ? s.components : extraction.data.components,
        baseScenarioId: null,
      });
      n++;
    }
    return n;
  } catch (error) {
    console.warn(`[custom-tickets] ignoring unreadable ${FILE}: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

function mergeEntities(rawEntities: ExtractedEntity[], routedEntities: Array<{ id: string; label: string; type: string; category: ExtractedEntity["category"] }>, sourceLabel: string): ExtractedEntity[] {
  const merged = [...rawEntities];
  const seen = new Set(rawEntities.map((e) => `${e.type}:${e.id.toLowerCase()}`));
  for (const e of routedEntities) {
    const type = (e.type === "setting" ? "keyword" : e.type) as ExtractedEntity["type"];
    const key = `${type}:${e.id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: e.id,
      label: e.label,
      type,
      category: e.category,
      resolvedTo: e.id,
      source: sourceLabel,
      confidence: 1,
    });
  }
  return merged;
}

export function registerCustomTicket(input: CustomTicketRequest, options: RegisterOptions = {}): CustomScenarioEntry {
  const title = input.title.trim().slice(0, 140);
  const body = input.body.trim().slice(0, 6000);
  const createdAt = options.createdAt ?? new Date().toISOString();
  // The requester is evidence too: an ERP ticket names them in a field, not in the prose.
  const probe = input.requester ? `${body}\n${input.requester.displayName} ${input.requester.upn}` : body;
  const rawExtraction = extractTicket({ title, body: probe, ...(input.customerName ? { customerName: input.customerName } : {}) });
  const id = options.scenarioId ?? customScenarioId(shortHash(`${title}\n${body}`));
  const base = rawExtraction.baseScenarioId ? SCENARIO_REGISTRY[rawExtraction.baseScenarioId] : null;

  const t1Start = performance.now();
  const clarifyingQuestions = generateClarifyingQuestionsSync({
    title,
    body,
    ...(input.clarifiedAnswers ? { clarifiedAnswers: input.clarifiedAnswers } : {}),
  });
  const t1Ms = Math.max(1, Math.round(performance.now() - t1Start));

  const t2Start = performance.now();
  const cloudStatusCorrelation = correlateUpstreamCloudStatusSync({
    ticketText: `${title}\n${body}`,
    createdAt,
  });
  const t2Ms = Math.max(1, Math.round(performance.now() - t2Start));

  const t3Start = performance.now();
  const routingDecision = buildDeterministicRoutingDecision({
    title,
    body: probe,
    matchedSeededComponents: rawExtraction.components,
  });

  const hasMissingElements = routingDecision.missingElements.length > 0;
  const finalComponents: CanvasComponentType[] = hasMissingElements
    ? ["SynthesizedDynamicCard"]
    : rawExtraction.components;

  const extraction: TicketExtraction = hasMissingElements
    ? {
        ...rawExtraction,
        components: finalComponents,
        entities: mergeEntities(rawExtraction.entities, routingDecision.extractedEntities, "muse-spark-1.3 · N+k Catalog Gatekeeper"),
        rationale: `Stage-1 muse-spark-1.3 routed to dynamic UI synthesis (${routingDecision.missingElements.map((m) => m.elementId).join(", ")}) -> Stage-2 muse-wonder-1.0 synthesized dynamic UI element`.slice(0, 300),
      }
    : rawExtraction;

  const synthesizedElements = hasMissingElements
    ? synthesizeAndPersistMissingElementsSync({
        ticketId: id,
        ticketPrompt: `${title}\n${body}`,
        decision: routingDecision,
      })
    : undefined;
  const t3Ms = Math.max(1, Math.round(performance.now() - t3Start));

  const t4Start = performance.now();
  const rawRemediation = hasMissingElements
    ? buildCustomTicketRemediationSync({
        scenarioId: id,
        ticketTitle: title,
        ticketBody: body,
      })
    : undefined;
  const t4Ms = Math.max(1, Math.round(performance.now() - t4Start));

  const safetyCheck = rawRemediation
    ? verifyAndRepairGeneratedScript(rawRemediation.powershellScript, id)
    : { repairedScript: "", passed: true, repaired: false, warnings: [], latencyMs: 1 };
  const customRemediation = rawRemediation
    ? { ...rawRemediation, powershellScript: safetyCheck.repairedScript }
    : undefined;

  const initialAnswers: Record<string, string> = Object.fromEntries(
    clarifyingQuestions.map((q) => {
      const raw = input.clarifiedAnswers?.[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
      const matched = q.options.find(
        (o) => o.value.toLowerCase() === raw.toLowerCase() || o.id.toLowerCase() === raw.toLowerCase() || o.label.toLowerCase() === raw.toLowerCase(),
      );
      return [q.id, matched ? matched.label : raw];
    }),
  );
  const subAgentTasks = buildSubAgentPipelineRecords({
    scenarioId: id,
    title,
    body,
    questions: clarifyingQuestions,
    clarifiedAnswers: initialAnswers,
    elementIds: hasMissingElements ? routingDecision.missingElements.map((m) => m.elementId) : finalComponents,
    gatekeeperModel: "muse-spark-1.3",
    synthesizerModel: "muse-wonder-1.0",
    measurements: {
      1: { latencyMs: t1Ms, status: "fallback", source: "fallback-on-error", tokensUsed: 0 },
      2: { latencyMs: t2Ms, status: "completed", source: "mcp-probe", tokensUsed: 0 },
      3: { latencyMs: t3Ms, status: "fallback", source: "fallback-on-error", tokensUsed: 0 },
      4: { latencyMs: t4Ms, status: "fallback", source: "fallback-on-error", tokensUsed: 0 },
      5: { latencyMs: safetyCheck.latencyMs, status: safetyCheck.passed ? "completed" : "fallback", source: "symbolic-verifier", tokensUsed: 0 },
    },
  });

  const rawEntry: CustomScenarioEntry = {
    scenarioId: id,
    kind: "ticket",
    origin: options.origin ?? "unscripted",
    tenantId: extraction.tenantId as CustomScenarioEntry["tenantId"],
    title,
    remediationScope: hasMissingElements ? routingDecision.missingElements[0]?.title ?? "Dynamic cloud remediation" : (base?.remediationScope ?? "Dynamic cloud remediation"),
    components: finalComponents,
    baseScenarioId: extraction.baseScenarioId,
    shortHash: id.slice(id.indexOf("-") + 1),
    createdAt,
    ticket: {
      title,
      body,
      ...(input.customerName ? { customerName: input.customerName.trim().slice(0, 80) } : {}),
      ...(input.requester ? { requester: input.requester } : {}),
      ...(input.priority ? { priority: input.priority.slice(0, 12) } : {}),
    },
    extraction,
    elementRouting: routingDecision,
    ...(synthesizedElements ? { synthesizedElements } : {}),
    cloudStatusCorrelation,
    ...(customRemediation ? { customRemediation } : {}),
    clarifyingQuestions,
    clarifiedAnswers: initialAnswers,
    subAgentTasks,
    ...(options.erpDrop ? { erpDrop: options.erpDrop } : {}),
  };

  const finalizedEntry =
    input.clarifiedAnswers && Object.keys(input.clarifiedAnswers).length > 0
      ? applyClarifiedAnswersToEntry(rawEntry, input.clarifiedAnswers)
      : rawEntry;

  const entry = registerCustomScenario(finalizedEntry);
  save();
  return entry;
}

/**
 * Full async Two-Stage N+k Triage (`muse-spark-1.3` -> `muse-wonder-1.0`) + Live Upstream Cloud Status Correlation
 * + Per-Task Sub-Agent Pipeline & Goal Clarifier.
 */
export async function triageCustomTicketAsync(
  input: CustomTicketRequest,
  options: RegisterOptions = {},
): Promise<CustomScenarioEntry> {
  const title = input.title.trim().slice(0, 140);
  const body = input.body.trim().slice(0, 6000);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const probe = input.requester ? `${body}\n${input.requester.displayName} ${input.requester.upn}` : body;
  const rawExtraction = extractTicket({ title, body: probe, ...(input.customerName ? { customerName: input.customerName } : {}) });
  const id = options.scenarioId ?? customScenarioId(shortHash(`${title}\n${body}`));
  const base = rawExtraction.baseScenarioId ? SCENARIO_REGISTRY[rawExtraction.baseScenarioId] : null;

  const {
    routingDecision,
    gatekeeperModel,
    cloudStatusCorrelation,
    clarifyingQuestions,
    synthesizedElements,
    customRemediation,
    subAgentTasks,
  } = await runSubAgentPipeline({
    scenarioId: id,
    title,
    body,
    probeText: probe,
    createdAt,
    matchedSeededComponents: rawExtraction.components,
    ...(input.clarifiedAnswers ? { clarifiedAnswers: input.clarifiedAnswers } : {}),
  });

  const hasMissingElements = routingDecision.missingElements.length > 0;
  const finalComponents: CanvasComponentType[] = hasMissingElements
    ? ["SynthesizedDynamicCard"]
    : rawExtraction.components;

  const initialAnswers: Record<string, string> = Object.fromEntries(
    clarifyingQuestions.map((q) => {
      const raw = input.clarifiedAnswers?.[q.id] ?? q.selectedValue ?? q.options[0]?.label ?? q.options[0]?.value ?? "";
      const matched = q.options.find(
        (o) => o.value.toLowerCase() === raw.toLowerCase() || o.id.toLowerCase() === raw.toLowerCase() || o.label.toLowerCase() === raw.toLowerCase(),
      );
      return [q.id, matched ? matched.label : raw];
    }),
  );

  const extraction: TicketExtraction = hasMissingElements
    ? {
        ...rawExtraction,
        components: finalComponents,
        entities: mergeEntities(rawExtraction.entities, routingDecision.extractedEntities, `${gatekeeperModel} · N+k Catalog Gatekeeper`),
        rationale: `Stage-1 ${gatekeeperModel} routed to dynamic UI synthesis (${routingDecision.missingElements.map((m) => m.elementId).join(", ")}) -> Stage-2 muse-wonder-1.0 synthesized dynamic UI element`.slice(0, 300),
      }
    : rawExtraction;

  const rawEntry: CustomScenarioEntry = {
    scenarioId: id,
    kind: "ticket",
    origin: options.origin ?? "unscripted",
    tenantId: extraction.tenantId as CustomScenarioEntry["tenantId"],
    title,
    remediationScope: hasMissingElements ? routingDecision.missingElements[0]?.title ?? "Dynamic cloud remediation" : (base?.remediationScope ?? "Dynamic cloud remediation"),
    components: finalComponents,
    baseScenarioId: extraction.baseScenarioId,
    shortHash: id.slice(id.indexOf("-") + 1),
    createdAt,
    ticket: {
      title,
      body,
      ...(input.customerName ? { customerName: input.customerName.trim().slice(0, 80) } : {}),
      ...(input.requester ? { requester: input.requester } : {}),
      ...(input.priority ? { priority: input.priority.slice(0, 12) } : {}),
    },
    extraction,
    elementRouting: routingDecision,
    ...(synthesizedElements ? { synthesizedElements } : {}),
    cloudStatusCorrelation,
    ...(customRemediation ? { customRemediation } : {}),
    clarifyingQuestions,
    clarifiedAnswers: initialAnswers,
    subAgentTasks,
    ...(options.erpDrop ? { erpDrop: options.erpDrop } : {}),
  };

  const entry = registerCustomScenario(rawEntry);
  save();
  return entry;
}

/**
 * Interactive Goal Clarifier refinement: applies operator-selected option pills or free-text answers
 * to a custom ticket/project, re-synthesizing its brief, dynamic cards, and PowerShell/IaC remediation.
 */
export async function refineCustomTicketGoal(
  scenarioId: string,
  clarifiedAnswers: Record<string, string>,
): Promise<CustomScenarioEntry | null> {
  const existing = getCustomScenario(scenarioId);
  if (!existing) return null;
  const updated = await refineEntryWithSubAgentsAsync(existing, clarifiedAnswers);
  registerCustomScenario(updated);
  save();
  return updated;
}

/** Drops a custom ticket (an ERP folder that disappeared from the inbox) and persists the registry. */
export function removeCustomTicket(scenarioId: string): boolean {
  const removed = unregisterCustomScenario(scenarioId);
  if (removed) save();
  return removed;
}

/** Clears unscripted (or all) custom tickets on demo reset and persists the registry. */
export function clearCustomTickets(originFilter?: "unscripted" | "erp-drop"): string[] {
  const removed = clearCustomScenarios(originFilter);
  if (removed.length > 0) save();
  return removed;
}

export function customScenarioListItem(entry: CustomScenarioEntry, resolved: boolean): ScenarioListItem {
  return {
    scenarioId: entry.scenarioId,
    kind: "ticket",
    origin: entry.origin,
    displayId: displayScenarioId(entry.scenarioId),
    tenantId: entry.tenantId,
    tenantName: TENANT_REGISTRY[entry.tenantId].displayName,
    title: entry.title,
    resolved,
    // Queue order is arrival: a drop ranks by when it landed in the inbox, not by the ERP's own timestamp.
    createdAt: entry.erpDrop?.ingestedAt ?? entry.createdAt,
    custom: {
      origin: entry.origin,
      baseScenarioId: entry.baseScenarioId,
      shortHash: entry.shortHash,
      createdAt: entry.createdAt,
      ticket: entry.ticket,
      extraction: entry.extraction,
      components: entry.components,
      ...(entry.erpDrop ? { erpDrop: entry.erpDrop } : {}),
    },
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
  ...LAB_INCIDENT_TICKETS.map((t) => ({
    id: t.incidentId.toLowerCase(),
    title: t.subject,
    body: t.description,
    customerName: "Contoso Finance",
  })),
];
