import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { z } from "zod";
import { VisionExtractionSchema, displayScenarioId, erpScenarioId, listCustomScenarios, type CustomScenarioEntry, type CustomScenarioId, type ScenarioListItem, type TicketAttachment, type VisionExtraction } from "@contextpane/catalog";
import { config } from "../config.ts";
import { workbenchEvents } from "../events.ts";
import { gatherContext, invalidateContext } from "../mcp/context.ts";
import { convergenceStore } from "../store/convergence.ts";
import { ZERO_USAGE, telemetry } from "../telemetry.ts";
import { matchSignIn, visionExtract, type VisionResult } from "../tiers/vision.ts";
import { customScenarioListItem, registerCustomTicket, removeCustomTicket } from "./custom-ticket.ts";
import { generateDrop, type DropArchetype } from "./erp-drop-generator.ts";
import { readPngInfo } from "./png.ts";

/**
 * The live ERP inbox: `<root>/input/tickets/#<id>/ticketbody.json` plus any image next to it.
 * A folder dropped from Explorer, PowerShell or POST /api/tickets/simulate-drop is detected within
 * about a second (fs.watch shortens the wait; a 1 s directory scan is the backbone, so a nested
 * create on Windows or a partially written JSON never slips through), triaged by the Tier 0
 * extractor and registered as the ERP-<id> work item (display id `#<id>`). A folder that
 * disappears again leaves the queue on the next scan.
 */

let currentInboxDir = config.inboxDir;
/** <root>/input/tickets (CTX_INBOX_DIR). */
export function getInboxDir(): string {
  return currentInboxDir;
}
/** Tests point the watcher at a temp folder; the tracked-folder state starts over. */
export function setInboxDir(dir: string): void {
  currentInboxDir = dir;
  tracked.clear();
}
export const TICKET_BODY_FILE = "ticketbody.json";
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/* ------------------------------ ticketbody.json ----------------------------- */

const Requester = z.union([z.string(), z.object({ displayName: z.string().optional(), name: z.string().optional(), upn: z.string().optional(), email: z.string().optional(), role: z.string().optional() })]);

/** The flexible ERP export: every field has aliases, and `id` may be missing (the folder name carries it). */
const TicketBodySchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    ticketId: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    customer: z.string().optional(),
    customerName: z.string().optional(),
    tenantName: z.string().optional(),
    requester: Requester.optional(),
    user: Requester.optional(),
    priority: z.union([z.string(), z.number()]).optional(),
    createdAt: z.string().optional(),
    created: z.string().optional(),
    openedAt: z.string().optional(),
    attachments: z.array(z.union([z.string(), z.object({ fileName: z.string().optional(), name: z.string().optional() })])).optional(),
  })
  .passthrough();

export interface ParsedTicketBody {
  displayId: string;
  title: string;
  body: string;
  customerName: string;
  requester: { displayName: string; upn: string; role: string } | null;
  priority: string | null;
  createdAt: string;
  /** Files named in the JSON (discovery on disk adds the rest). */
  listedAttachments: string[];
}

export function parseTicketBody(raw: unknown, folderName: string): ParsedTicketBody {
  const t = TicketBodySchema.parse(raw);
  const idRaw = t.id ?? t.ticketId ?? folderName;
  const displayId = `#${String(idRaw).trim().replace(/^#/, "")}`;
  const title = (t.title ?? t.subject ?? "").trim();
  const body = (t.body ?? t.description ?? t.summary ?? "").trim();
  if (title.length < 3) throw new Error(`${TICKET_BODY_FILE} needs a title or subject`);
  if (body.length < 10) throw new Error(`${TICKET_BODY_FILE} needs a body, description or summary`);
  const r = t.requester ?? t.user;
  const requester =
    r === undefined
      ? null
      : typeof r === "string"
        ? { displayName: r, upn: r.includes("@") ? r : "", role: "Requester" }
        : { displayName: r.displayName ?? r.name ?? r.upn ?? r.email ?? "Requester", upn: r.upn ?? r.email ?? "", role: r.role ?? "Requester" };
  const createdAtRaw = t.createdAt ?? t.created ?? t.openedAt;
  const createdAt = createdAtRaw && Number.isFinite(Date.parse(createdAtRaw)) ? new Date(createdAtRaw).toISOString() : new Date().toISOString();
  return {
    displayId,
    title,
    body,
    customerName: (t.customer ?? t.customerName ?? t.tenantName ?? "Contoso Finance").trim(),
    requester,
    priority: t.priority === undefined ? null : String(t.priority),
    createdAt,
    listedAttachments: (t.attachments ?? []).map((a) => (typeof a === "string" ? a : (a.fileName ?? a.name ?? ""))).filter(Boolean),
  };
}

/* ------------------------------- attachments ------------------------------- */

/** Every image file in the folder, listed in ticketbody.json or not; attachment1.png first. */
export function discoverAttachments(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => (a.toLowerCase() === "attachment1.png" ? -1 : b.toLowerCase() === "attachment1.png" ? 1 : a.localeCompare(b)));
}

/** `#2026323` → `%232026323`: a `#` in a URL is a fragment, so folder names are always encoded. */
export function attachmentUrl(folder: string, fileName: string): string {
  return `/api/tickets/inbox-attachment/${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`;
}

/** The on-disk path of an inbox attachment, or null when it is outside the inbox or not an image. */
export function resolveAttachmentPath(folder: string, fileName: string): string | null {
  if (!folder || !fileName || folder.includes("/") || folder.includes("\\") || folder.includes("..") || !IMAGE_RE.test(fileName) || basename(fileName) !== fileName) return null;
  const path = resolve(getInboxDir(), folder, fileName);
  const root = resolve(getInboxDir()) + sep;
  if (!path.startsWith(root) || !existsSync(path)) return null;
  return path;
}

function attachmentsOf(folder: string, parsed: ParsedTicketBody): TicketAttachment[] {
  const dir = join(getInboxDir(), folder);
  return discoverAttachments(dir).map((fileName) => {
    const st = statSync(join(dir, fileName));
    return {
      fileName,
      mimeType: MIME[fileName.split(".").pop()!.toLowerCase()] ?? "application/octet-stream",
      url: attachmentUrl(folder, fileName),
      uploadedBy: parsed.requester?.displayName ?? parsed.customerName,
      uploadedAt: st.mtime.toISOString(),
      sizeBytes: st.size,
    };
  });
}

/* --------------------------------- ingest ---------------------------------- */

interface Tracked {
  folder: string;
  scenarioId: string;
  /** Size + mtime of ticketbody.json and the attachment names: a change re-ingests the folder. */
  signature: string;
}

const tracked = new Map<string, Tracked>();

function signatureOf(folder: string): string | null {
  const file = join(getInboxDir(), folder, TICKET_BODY_FILE);
  if (!existsSync(file)) return null;
  const st = statSync(file);
  return `${st.size}:${Math.round(st.mtimeMs)}:${discoverAttachments(join(getInboxDir(), folder)).join(",")}`;
}

export interface IngestResult {
  entry: CustomScenarioEntry;
  item: ScenarioListItem;
  folder: string;
  attachments: string[];
  latencyMs: number;
}

/**
 * Reads `<folder>/ticketbody.json`, triages it and registers ERP-<id>. Returns null while the JSON is
 * still being written (unparseable), so the next scan retries instead of ingesting half a ticket.
 */
export function ingestFolder(folder: string, options: { announce?: boolean } = {}): IngestResult | null {
  const started = performance.now();
  const dir = join(getInboxDir(), folder);
  const file = join(dir, TICKET_BODY_FILE);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // partial write: retry on the next tick
  }
  const parsed = parseTicketBody(raw, folder);
  const scenarioId = erpScenarioId(parsed.displayId);
  const ingestedAt = new Date().toISOString();
  const attachments = attachmentsOf(folder, parsed);
  const entry = registerCustomTicket(
    {
      title: parsed.title,
      body: parsed.body,
      customerName: parsed.customerName,
      ...(parsed.requester ? { requester: parsed.requester } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
    },
    { scenarioId, origin: "erp-drop", createdAt: parsed.createdAt, erpDrop: { folder, ingestedAt, attachments } },
  );
  invalidateContext(scenarioId);
  tracked.set(folder, { folder, scenarioId, signature: signatureOf(folder) ?? "" });
  const item = customScenarioListItem(entry, Boolean(convergenceStore.get(scenarioId)));
  const latencyMs = Math.round(performance.now() - started);
  if (options.announce !== false) {
    telemetry.record({
      requestId: telemetry.nextRequestId("t0"),
      endpoint: "/inbox/ingest",
      tier: "Tier 0",
      provider: "local",
      modelId: "deterministic-entity-extractor",
      latencyMs,
      tokensUsed: { ...ZERO_USAGE },
      fallbackChain: [],
      tenantId: entry.tenantId,
      estimatedSavings: { tokens: 1800, ms: 4000, versus: "model-based ticket classification" },
    });
    workbenchEvents.publish({ type: "inbox/ingested", item, folder, attachments: attachments.map((a) => a.fileName) });
    // Warm the brief and the data plane so the first click on the new item is instant.
    void gatherContext(scenarioId, { fresh: true }).catch(() => undefined);
  }
  return { entry, item, folder, attachments: attachments.map((a) => a.fileName), latencyMs };
}

export interface ScanResult {
  folders: string[];
  ingested: IngestResult[];
  removed: string[];
  scannedAt: string;
}

/** One pass over the inbox: new or changed folders are ingested, vanished folders leave the queue. */
export function scanInbox(options: { announce?: boolean } = {}): ScanResult {
  const ingested: IngestResult[] = [];
  const removed: string[] = [];
  const folders = existsSync(getInboxDir())
    ? readdirSync(getInboxDir(), { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort()
    : [];
  const present = new Set(folders);
  for (const folder of folders) {
    const signature = signatureOf(folder);
    if (!signature) continue; // no ticketbody.json (yet)
    const known = tracked.get(folder);
    if (known && known.signature === signature) continue;
    try {
      const result = ingestFolder(folder, options);
      if (result) ingested.push(result);
    } catch (error) {
      console.warn(`[inbox] ${folder}/${TICKET_BODY_FILE} rejected: ${error instanceof Error ? error.message : String(error)}`);
      tracked.set(folder, { folder, scenarioId: "", signature });
    }
  }
  // Folders that vanished (a cleaned-up smoke drop) and persisted drops whose folder is gone.
  for (const entry of listCustomScenarios()) {
    if (entry.origin !== "erp-drop" || !entry.erpDrop) continue;
    if (present.has(entry.erpDrop.folder) && signatureOf(entry.erpDrop.folder)) continue;
    removeCustomTicket(entry.scenarioId);
    invalidateContext(entry.scenarioId);
    tracked.delete(entry.erpDrop.folder);
    removed.push(entry.scenarioId);
    if (options.announce !== false) workbenchEvents.publish({ type: "inbox/removed", scenarioId: entry.scenarioId, folder: entry.erpDrop.folder });
  }
  for (const folder of [...tracked.keys()]) if (!present.has(folder)) tracked.delete(folder);
  return { folders, ingested, removed, scannedAt: new Date().toISOString() };
}

export interface InboxItem {
  folder: string;
  displayId: string;
  scenarioId: string;
  title: string;
  ingestedAt: string;
  createdAt: string;
  attachments: TicketAttachment[];
  resolved: boolean;
}

/** What is in the inbox right now, newest first (GET /api/tickets/inbox). */
export function listInbox(): InboxItem[] {
  return listCustomScenarios()
    .filter((e) => e.origin === "erp-drop" && e.erpDrop)
    .map((e) => ({
      folder: e.erpDrop!.folder,
      displayId: displayScenarioId(e.scenarioId),
      scenarioId: e.scenarioId,
      title: e.title,
      ingestedAt: e.erpDrop!.ingestedAt,
      createdAt: e.createdAt,
      attachments: e.erpDrop!.attachments,
      resolved: Boolean(convergenceStore.get(e.scenarioId)),
    }))
    .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
}

/* --------------------------------- watcher --------------------------------- */

let watcher: FSWatcher | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

/** fs.watch for immediacy + a periodic scan for certainty. Returns a disposer. */
export function startInboxWatcher(): () => void {
  mkdirSync(getInboxDir(), { recursive: true });
  const first = scanInbox({ announce: false });
  console.log(`  [inbox] watching ${getInboxDir()} · ${first.folders.length} folder(s), ${listInbox().length} ticket(s) ingested`);
  const tick = () => {
    try {
      scanInbox();
    } catch (error) {
      console.warn(`[inbox] scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    watcher = watch(getInboxDir(), { recursive: true }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(tick, 150);
    });
    watcher.on("error", () => undefined);
  } catch (error) {
    console.warn(`[inbox] fs.watch unavailable (${error instanceof Error ? error.message : String(error)}); scanning every ${config.inboxScanMs} ms`);
  }
  interval = setInterval(tick, config.inboxScanMs);
  interval.unref?.();
  return () => {
    watcher?.close();
    watcher = null;
    if (interval) clearInterval(interval);
    interval = null;
    if (debounce) clearTimeout(debounce);
    debounce = null;
  };
}

/* ------------------------------ simulate a drop ----------------------------- */

export interface SimulateDropResult {
  folder: string;
  displayId: string;
  scenarioId: CustomScenarioId;
  archetype: DropArchetype;
  files: string[];
  dir: string;
  ingest: IngestResult | null;
}

/**
 * Writes a fresh `#2026xxx/ticketbody.json` + `attachment1.png` into the inbox and runs the same scan
 * the watcher runs, so the UI button and a folder dropped in Explorer take exactly one path.
 */
export function simulateDrop(options: { archetype?: DropArchetype | "Random"; ticketId?: string; seed?: number } = {}): SimulateDropResult {
  mkdirSync(getInboxDir(), { recursive: true });
  let drop = generateDrop(options);
  // Never overwrite an existing drop with a random id; a requested id replaces on purpose.
  for (let i = 0; !options.ticketId && existsSync(join(getInboxDir(), drop.folder)) && i < 20; i++) drop = generateDrop({ ...options, seed: (options.seed ?? 0) + i + 1 });
  const dir = join(getInboxDir(), drop.folder);
  mkdirSync(dir, { recursive: true });
  // The attachment lands first, the JSON last and atomically: the watcher only ingests complete drops.
  writeFileSync(join(dir, "attachment1.png"), drop.png);
  const tmp = join(dir, `.${TICKET_BODY_FILE}.tmp`);
  writeFileSync(tmp, JSON.stringify(drop.body, null, 2) + "\n", "utf8");
  renameSync(tmp, join(dir, TICKET_BODY_FILE));
  const scan = scanInbox();
  const ingest = scan.ingested.find((r) => r.folder === drop.folder) ?? null;
  return { folder: drop.folder, displayId: drop.displayId, scenarioId: erpScenarioId(drop.displayId), archetype: drop.archetype, files: [TICKET_BODY_FILE, "attachment1.png"], dir, ingest };
}

/* ------------------------------ vision triage ------------------------------ */

export interface VisionTriageResult extends VisionResult {
  scenarioId: string;
  attachment: TicketAttachment;
  /** muse-vision when the model read the pixels; deterministic when the PNG metadata and ticket text answered. */
  source: "muse-vision" | "deterministic";
}

/**
 * `[Extract Telemetry via Muse Vision]` on a dropped ticket: the orchestrator reads the file from
 * input/tickets/<folder>/ itself and sends it to muse-spark-1.3 as an image part. Offline (no key,
 * timeout) the deterministic fallback answers from the PNG's tEXt chunks and the ticket text, then
 * matches the sign-in log the same way.
 */
export async function visionTriageDrop(entry: CustomScenarioEntry, fileName?: string): Promise<VisionTriageResult> {
  const drop = entry.erpDrop;
  if (!drop) throw new Error(`${entry.scenarioId} is not an ERP drop`);
  const attachment = (fileName ? drop.attachments.find((a) => a.fileName === fileName) : drop.attachments[0]) ?? null;
  if (!attachment) throw new Error(`${entry.scenarioId} has no attachment${fileName ? ` named ${fileName}` : ""}`);
  const path = resolveAttachmentPath(drop.folder, attachment.fileName);
  if (!path) throw new Error(`${attachment.fileName} is missing from ${drop.folder}`);
  const bytes = readFileSync(path);
  const imageDataUri = `data:${attachment.mimeType};base64,${bytes.toString("base64")}`;
  const result = await visionExtract({ tenantId: entry.tenantId, ticketId: displayScenarioId(entry.scenarioId), fileName: attachment.fileName, imageDataUri });
  if (result.extraction) return { ...result, scenarioId: entry.scenarioId, attachment, source: "muse-vision" };
  const extraction = deterministicExtraction(new Uint8Array(bytes), entry);
  const match = await matchSignIn(entry.tenantId, extraction).catch(() => null);
  const event = telemetry.record({
    requestId: telemetry.nextRequestId("vision"),
    endpoint: "/api/vision/triage",
    tier: "Tier 0",
    provider: "local",
    modelId: "png-text-chunks+ticket-text",
    latencyMs: 1,
    tokensUsed: { ...ZERO_USAGE },
    fallbackChain: result.telemetry.fallbackChain,
    tenantId: entry.tenantId,
  });
  return { extraction, match, scenarioId: entry.scenarioId, attachment, source: "deterministic", telemetry: event, ...(result.error ? { error: `${result.error} → deterministic fallback` } : {}) };
}

/** No pixels are read: the generator tagged the PNG with tEXt chunks, and the ticket text names the code. */
export function deterministicExtraction(png: Uint8Array, entry: CustomScenarioEntry): VisionExtraction {
  const texts = readPngInfo(png)?.texts ?? {};
  const text = `${entry.ticket.title}\n${entry.ticket.body}`;
  const code =
    texts.ErrorCode ??
    text.match(
      /\bAADSTS\d{4,7}\b|\b0x87D[0-9A-F]{5}\b|\b0x801C[0-9A-F]{4}\b|CountViolation|AADDS104|AADDS501|AnomalousToken|PIMRoleOutsideGovernance|LargeObject|UserErrorGuestAgentStatusUnavailable|OperationNotAllowed|DracutEmergencyMode|VMExtensionProvisioningError|AuthorizationPermissionMismatch|NO_PROPOSAL_CHOSEN|AsymmetricRoutingDeny|RoleAssignmentUpdateNotPermitted|RequestDisallowedByPolicy|SubnetIsFull|OverQuota|EventID5156|LateArrivingData|OrphanedDisksCostSpike/i,
    )?.[0] ??
    "";
  const correlationId = texts.CorrelationId ?? text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "";
  const timestamp = texts.Timestamp ?? entry.createdAt;
  const device = texts.Device ?? "";
  const recommendedComponent: VisionExtraction["recommendedComponent"] = /0x87D|EventID5156/i.test(code)
    ? "IntuneDriftCard"
    : /CountViolation|LateArrivingData|OrphanedDisksCostSpike/i.test(code)
      ? "LicenseDriftCard"
      : /AADDS|UserErrorGuestAgent|OperationNotAllowed|Dracut|0x801C|VMExtension|NO_PROPOSAL|Asymmetric|RequestDisallowed|SubnetIsFull/i.test(code)
        ? "IaCDriftBanner"
        : "EntraSignInTimeline";
  const normalizedCode = /^aadsts|^0x/i.test(code) ? code.toUpperCase().replace("0X", "0x") : code;
  return VisionExtractionSchema.parse({ errorCode: normalizedCode, appId: "", correlationId, timestamp, deviceState: device, recommendedComponent });
}
