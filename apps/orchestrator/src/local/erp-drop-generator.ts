import { Canvas, type Rgb } from "./png.ts";

/**
 * Random ERP ticket drops: a realistic `ticketbody.json` plus a customer "screenshot"
 * (`attachment1.png`) that matches the symptom, written as a folder into input/tickets/#<id>/.
 * Entities, error codes and infrastructure targets are the ones the live-seeded lab tenant
 * knows, so the Tier 0 extractor resolves them. The PowerShell twin is
 * scripts/New-RandomErpTicketDrop.ps1; both exercise the same inbox watcher.
 */

export const DROP_ARCHETYPES = ["AVD", "Intune", "CA", "WorkloadIdentity", "Licensing", "Mixed"] as const;
export type DropArchetype = (typeof DROP_ARCHETYPES)[number];

export interface ErpTicketBody {
  id: string;
  source: "ERP";
  subject: string;
  description: string;
  customer: string;
  requester: { displayName: string; upn: string; role: string };
  priority: "P1" | "P2" | "P3";
  createdAt: string;
  attachments: string[];
  /** The symptom the screenshot shows; also embedded in the PNG's tEXt chunks. */
  telemetry: { errorCode: string; correlationId: string; timestamp: string; device: string };
}

export interface GeneratedDrop {
  folder: string;
  displayId: string;
  archetype: DropArchetype;
  body: ErpTicketBody;
  png: Uint8Array;
}

interface Persona {
  displayName: string;
  upn: string;
  role: string;
  device: string;
}

const DOMAIN = "c4a8shili.onmicrosoft.com";
const PEOPLE: Persona[] = [
  { displayName: "Lynne Robins", upn: `lynne.robins.contoso@${DOMAIN}`, role: "Finance Analyst", device: "CONTOSO-LT-0471" },
  { displayName: "Diego Siciliani", upn: `diego.siciliani.contoso@${DOMAIN}`, role: "Finance Controller", device: "CONTOSO-LT-0488" },
  { displayName: "Patti Fernandez", upn: `patti.fernandez.contoso@${DOMAIN}`, role: "Accounts Payable", device: "CONTOSO-FIN-014" },
  { displayName: "Alex Wilber", upn: `alex.wilber.contoso@${DOMAIN}`, role: "Contractor · ERP Integration", device: "CONTOSO-FIN-021" },
];

/** mulberry32: a seed reproduces the same drop (the seeded example and the unit tests rely on it). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
const guid = (r: () => number) => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? Math.floor(r() * 16) : 8 + Math.floor(r() * 4)) as number).toString(16));

interface Template {
  subject: string;
  description: string;
  errorCode: string;
  priority: ErpTicketBody["priority"];
  dialogTitle: string;
  dialogLines: string[];
  app: string;
}

function template(archetype: DropArchetype, r: () => number, who: Persona, when: string, stamp: string): Template {
  const other = pick(r, PEOPLE.filter((p) => p.upn !== who.upn));
  switch (archetype) {
    case "AVD":
      return {
        subject: `${who.displayName} cannot connect to AVD (${pick(r, ["AADSTS53003", "AADSTS53003"])}) and RDP 3389 looks open on the host pool`,
        description: `${who.displayName} (${who.role}) gets a Conditional Access block when opening the Windows App against vdpool-contoso-fin-01 since ${when}; the dialog shows AADSTS53003 with correlation id {CORR}. The user was moved to the Microsoft 365 E5 bundle last week but still appears on E3. While checking nsg-contoso-avd-hostpool-01 a vendor rule allowing RDP 3389 from the internet is visible in the portal and is not in our Terraform.`,
        errorCode: "AADSTS53003",
        priority: "P1",
        dialogTitle: "WINDOWS APP - SIGN-IN ERROR",
        dialogLines: ["YOUR SIGN-IN WAS BLOCKED BY", "CONDITIONAL ACCESS (AADSTS53003)", "", `USER: ${who.upn}`, "APP: AZURE VIRTUAL DESKTOP CLIENT", "HOST POOL: VDPOOL-CONTOSO-FIN-01"],
        app: "Azure Virtual Desktop",
      };
    case "Intune":
      return {
        subject: `${who.device} shows Not compliant after the ASR baseline update (0x87D1FDE8)`,
        description: `${who.displayName}'s laptop ${who.device} reports 'Not compliant' in the Company Portal since ${when}. Intune shows error 0x87D1FDE8 on Intune-Win11-ASR-Baseline and a conflict with the firewall profile; the device check-in succeeded but the ASR rule stays in Audit. ${other.displayName} on ${other.device} sees the same banner.`,
        errorCode: "0x87D1FDE8",
        priority: "P2",
        dialogTitle: "COMPANY PORTAL - DEVICE STATUS",
        dialogLines: ["THIS DEVICE IS NOT COMPLIANT", "ERROR 0X87D1FDE8", "", `DEVICE: ${who.device}`, "POLICY: INTUNE-WIN11-ASR-BASELINE", "SETTING: ASR RULE (AUDIT)"],
        app: "Intune Company Portal",
      };
    case "CA":
      return {
        subject: `Finance users blocked by CA-001 since the break-glass change (AADSTS53003)`,
        description: `Since ${when} ${who.displayName} and ${other.displayName} are blocked by Conditional Access policy CA-001 when signing in to Outlook and Teams (AADSTS53003, correlation {CORR}). The emergency access account bg-admin-01 is no longer excluded from the policy and CA-004 is still in report-only mode. Please check the break-glass exclusion before more users are locked out.`,
        errorCode: "AADSTS53003",
        priority: "P1",
        dialogTitle: "MICROSOFT ENTRA - SIGN-IN BLOCKED",
        dialogLines: ["ACCESS HAS BEEN BLOCKED BY", "CONDITIONAL ACCESS POLICIES", "ERROR AADSTS53003", "", `USER: ${who.upn}`, "POLICY: CA-001"],
        app: "Microsoft 365",
      };
    case "WorkloadIdentity":
      return {
        subject: `ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired secret)`,
        description: `The nightly GitHub Actions run of spn-contoso-erp-sync fails since ${when} with AADSTS7000222: the client secret has expired. The app registration still lists the contractor Alex Wilber as owner although he holds no admin role, and the granted Graph scopes (Directory.ReadWrite.All, Sites.FullControl.All, Mail.ReadWrite) are far wider than the sync needs. Please rotate to a federated credential and right-size the permissions.`,
        errorCode: "AADSTS7000222",
        priority: "P2",
        dialogTitle: "GITHUB ACTIONS - RUN FAILED",
        dialogLines: ["ERROR: AADSTS7000222", "THE PROVIDED CLIENT SECRET", "IS EXPIRED", "", "APP: SPN-CONTOSO-ERP-SYNC", `RUN: ${stamp}`],
        app: "GitHub Actions",
      };
    case "Licensing":
      return {
        subject: `SPE_E5 group licensing shows CountViolation and ${who.displayName} lost Teams`,
        description: `Since ${when} the group-based licensing of SG-Finance-E5 reports CountViolation on SPE_E5; ${who.displayName} (${who.role}) lost Teams and Exchange while several disabled accounts still hold E5 seats and a Copilot add-on. Please reclaim the orphaned seats and re-apply the licence to the active users.`,
        errorCode: "CountViolation",
        priority: "P2",
        dialogTitle: "MICROSOFT 365 ADMIN - LICENSES",
        dialogLines: ["LICENSE ASSIGNMENT FAILED", "COUNTVIOLATION ON SPE_E5", "", "GROUP: SG-FINANCE-E5", `USER: ${who.upn}`, "AVAILABLE SEATS: 0"],
        app: "Microsoft 365 admin center",
      };
    case "Mixed": {
      const avd = template("AVD", r, who, when, stamp);
      return {
        ...avd,
        subject: `${who.displayName}: AVD sign-in blocked (AADSTS53003), ${who.device} not compliant (0x87D1FDE8)`,
        description: `${avd.description} The same laptop ${who.device} shows 'Not compliant' in the Company Portal with 0x87D1FDE8 on Intune-Win11-ASR-Baseline, so the compliant-device requirement of CA-001 can never be met.`,
        priority: "P1",
      };
    }
  }
}

export interface GenerateOptions {
  archetype?: DropArchetype | "Random";
  /** `#2026323` or `2026323`; random `#2026xxx` otherwise. */
  ticketId?: string;
  seed?: number;
  now?: Date;
}

export function generateDrop(options: GenerateOptions = {}): GeneratedDrop {
  const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
  const r = rng(seed);
  const archetype: DropArchetype = !options.archetype || options.archetype === "Random" ? pick(r, DROP_ARCHETYPES) : options.archetype;
  const now = options.now ?? new Date();
  const digits = options.ticketId ? options.ticketId.replace(/^#/, "").replace(/[^0-9A-Za-z]/g, "") : `2026${String(Math.floor(r() * 1000)).padStart(3, "0")}`;
  const displayId = `#${digits}`;
  const who = archetype === "WorkloadIdentity" ? PEOPLE[3]! : pick(r, PEOPLE.slice(0, 3));
  const minutesAgo = 20 + Math.floor(r() * 300);
  const at = new Date(now.getTime() - minutesAgo * 60_000);
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, "Z");
  const when = `${stamp.slice(11, 16)} UTC today`;
  const t = template(archetype, r, who, when, stamp);
  const correlationId = guid(r);
  const body: ErpTicketBody = {
    id: displayId,
    source: "ERP",
    subject: t.subject,
    description: t.description.replace("{CORR}", correlationId),
    customer: "Contoso Finance",
    requester: { displayName: who.displayName, upn: who.upn, role: who.role },
    priority: t.priority,
    createdAt: at.toISOString(),
    attachments: ["attachment1.png"],
    telemetry: { errorCode: t.errorCode, correlationId, timestamp: stamp, device: who.device },
  };
  return { folder: displayId, displayId, archetype, body, png: paintScreenshot(t, body, who) };
}

const BG: Rgb = [17, 22, 32];
const WINDOW: Rgb = [30, 36, 48];
const TITLE: Rgb = [40, 47, 62];
const BORDER: Rgb = [70, 80, 100];
const TEXT: Rgb = [226, 232, 240];
const MUTED: Rgb = [148, 163, 184];
const RED: Rgb = [239, 68, 68];
const AMBER: Rgb = [245, 158, 11];

/** A 640x400 "screenshot": window chrome, a red error badge and the symptom lines in the pixel font. */
function paintScreenshot(t: Template, body: ErpTicketBody, who: Persona): Uint8Array {
  const c = new Canvas(640, 400, BG);
  c.fillRect(40, 30, 560, 340, WINDOW);
  c.strokeRect(40, 30, 560, 340, BORDER);
  c.fillRect(41, 31, 558, 28, TITLE);
  c.text(52, 38, t.dialogTitle, TEXT, 2);
  c.fillRect(560, 38, 12, 12, RED);
  // Error badge
  c.fillRect(60, 80, 36, 36, RED);
  c.text(72, 88, "!", TEXT, 3);
  let y = 84;
  for (const line of t.dialogLines) {
    c.text(110, y, line, line.startsWith("ERROR") || /AADSTS|0X87D|COUNTVIOLATION/.test(line) ? AMBER : TEXT, 2);
    y += 20;
  }
  y += 10;
  c.fillRect(60, y, 520, 1, BORDER);
  y += 12;
  const tele = body.telemetry;
  c.text(60, y, `ERROR CODE: ${tele.errorCode}`, AMBER, 2);
  y += 18;
  c.text(60, y, `CORRELATION ID: ${tele.correlationId}`, MUTED, 2);
  y += 18;
  c.text(60, y, `TIMESTAMP: ${tele.timestamp}`, MUTED, 2);
  y += 18;
  c.text(60, y, `DEVICE: ${who.device} - ENTRA JOINED`, MUTED, 2);
  y += 18;
  c.text(60, y, `APP: ${t.app}`, MUTED, 2);
  c.text(52, 352, `TICKET ${body.id} - ${body.customer} - ${body.requester.displayName}`, MUTED, 2);
  return c.toPng({
    Title: `${body.id} ${t.dialogTitle}`,
    ErrorCode: tele.errorCode,
    CorrelationId: tele.correlationId,
    Timestamp: tele.timestamp,
    Device: `${who.device} · Entra joined`,
    User: who.upn,
    App: t.app,
    Software: "ContextPane random ERP drop generator",
  });
}
