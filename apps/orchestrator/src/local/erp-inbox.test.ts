import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getScenarioEntry, isAnyScenarioId } from "@contextpane/catalog";

process.env.LIVE_CLOUD_MODE = "false";
process.env.CTX_FORCE_LOCAL = "true";
const inbox = mkdtempSync(join(tmpdir(), "ctx-inbox-"));

const { generateDrop, generateAllLabTicketDrops, LAB_INCIDENT_TICKETS, DROP_ARCHETYPES } = await import("./erp-drop-generator.ts");
const { decodeCanvas, readPngInfo } = await import("./png.ts");
const { attachmentUrl, deterministicExtraction, discoverAttachments, ingestFolder, listInbox, parseTicketBody, resolveAttachmentPath, scanInbox, setInboxDir, simulateDrop, visionTriageDrop } = await import("./erp-inbox.ts");
// Bun runs every test file in one process: config.ts may already be loaded, so the inbox is redirected explicitly.
setInboxDir(inbox);
const INBOX_DIR = inbox;
const { gatherContext } = await import("../mcp/context.ts");
const { buildScenarioBrief } = await import("./brief.ts");

beforeAll(() => mkdirSync(INBOX_DIR, { recursive: true }));
afterAll(() => rmSync(inbox, { recursive: true, force: true }));

const quiet = { announce: false };

describe("ticketbody.json contract", () => {
  test("accepts the flexible ERP aliases and derives the id from the folder when omitted", () => {
    const a = parseTicketBody({ subject: "AVD blocked", summary: "Lynne cannot sign in to AVD, AADSTS53003.", tenantName: "Contoso Finance", user: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", priority: 1, created: "2026-10-27T08:00:00Z" }, "#2026323");
    expect(a.displayId).toBe("#2026323");
    expect(a.title).toBe("AVD blocked");
    expect(a.body).toContain("AADSTS53003");
    expect(a.customerName).toBe("Contoso Finance");
    expect(a.requester).toEqual({ displayName: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", upn: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", role: "Requester" });
    expect(a.priority).toBe("1");
    expect(a.createdAt).toBe("2026-10-27T08:00:00.000Z");

    const b = parseTicketBody({ ticketId: 2026400, title: "Intune drift", description: "Device CONTOSO-LT-0471 not compliant 0x87D1FDE8.", customer: "Contoso", requester: { name: "Patti Fernandez", email: "patti.fernandez.contoso@c4a8shili.onmicrosoft.com" }, attachments: [{ name: "shot.png" }] }, "#whatever");
    expect(b.displayId).toBe("#2026400");
    expect(b.requester?.displayName).toBe("Patti Fernandez");
    expect(b.listedAttachments).toEqual(["shot.png"]);
    expect(() => parseTicketBody({ title: "x" }, "#1")).toThrow();
  });

  test("ERP ids normalise safely: #2026323 → ERP-2026323, URLs encode the # folder", () => {
    expect(attachmentUrl("#2026323", "attachment1.png")).toBe("/api/tickets/inbox-attachment/%232026323/attachment1.png");
    expect(resolveAttachmentPath("../#2026323", "attachment1.png")).toBeNull();
    expect(resolveAttachmentPath("#2026323", "../../.env")).toBeNull();
    expect(resolveAttachmentPath("#2026323", "ticketbody.json")).toBeNull();
  });
});

describe("random drop generator", () => {
  test("a seed reproduces the drop; every archetype writes a valid tagged PNG that names its symptom", () => {
    const a = generateDrop({ archetype: "AVD", ticketId: "#2026323", seed: 7, now: new Date("2026-10-27T09:00:00Z") });
    const b = generateDrop({ archetype: "AVD", ticketId: "#2026323", seed: 7, now: new Date("2026-10-27T09:00:00Z") });
    expect(a.body).toEqual(b.body);
    expect(Buffer.from(a.png).equals(Buffer.from(b.png))).toBe(true);
    expect(a.folder).toBe("#2026323");
    expect(a.body.id).toBe("#2026323");
    expect(a.body.description).toContain("vdpool-contoso-fin-01");
    for (const archetype of DROP_ARCHETYPES) {
      const d = generateDrop({ archetype, seed: 11 });
      expect(d.folder).toMatch(/^#2026\d{3}$/);
      const info = readPngInfo(d.png);
      expect(info).toEqual(expect.objectContaining({ width: 640, height: 400 }));
      expect(info!.texts.ErrorCode).toBe(d.body.telemetry.errorCode);
      expect(info!.texts.CorrelationId).toBe(d.body.telemetry.correlationId);
      expect(`${d.body.subject} ${d.body.description}`).toContain(d.body.telemetry.errorCode);
      const canvas = decodeCanvas(d.png)!;
      // The error badge is painted red at (60..96, 80..116).
      expect([canvas.data[(90 * 640 + 70) * 3], canvas.data[(90 * 640 + 70) * 3 + 1]]).toEqual([239, 68]);
    }
  });
});

describe("inbox watcher pipeline", () => {
  const folder = "#2026777";
  const dir = join(INBOX_DIR, folder);

  test("discovers every image next to ticketbody.json, listed or not, attachment1.png first", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "zzz-extra.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    writeFileSync(join(dir, "attachment1.png"), generateDrop({ archetype: "AVD", seed: 3 }).png);
    writeFileSync(join(dir, "notes.txt"), "not an image");
    expect(discoverAttachments(dir)).toEqual(["attachment1.png", "zzz-extra.jpg"]);
  });

  test("a half-written ticketbody.json is skipped, the complete one ingests as ERP-<id> with attachments and a brief", async () => {
    writeFileSync(join(dir, "ticketbody.json"), '{"subject": "Lynne blocked from AVD (AADSTS53003)", "description": "Lynne Robins');
    expect(scanInbox(quiet).ingested).toHaveLength(0);
    expect(isAnyScenarioId("ERP-2026777")).toBe(false);

    writeFileSync(
      join(dir, "ticketbody.json"),
      JSON.stringify({ subject: "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-01", description: "Lynne Robins gets AADSTS53003 opening the Windows App against vdpool-contoso-fin-01. The NSG nsg-contoso-avd-hostpool-01 allows RDP 3389 from the internet, not in Terraform.", customer: "Contoso Finance", requester: { displayName: "Lynne Robins", upn: "lynne.robins.contoso@c4a8shili.onmicrosoft.com", role: "Finance Analyst" }, priority: "P1", createdAt: "2026-10-27T08:30:00Z" }),
    );
    const scan = scanInbox(quiet);
    expect(scan.ingested.map((r) => r.item.scenarioId)).toEqual(["ERP-2026777"]);
    const item = scan.ingested[0]!.item;
    expect(item.origin).toBe("erp-drop");
    expect(item.displayId).toBe("#2026777");
    expect(item.kind).toBe("ticket");
    // Queue order is arrival: the row carries the ingest time, the entry keeps the ERP timestamp.
    expect(item.createdAt).toBe(item.custom!.erpDrop!.ingestedAt);
    expect(item.custom?.createdAt).toBe("2026-10-27T08:30:00.000Z");
    expect(item.custom?.erpDrop?.attachments.map((a) => a.fileName)).toEqual(["attachment1.png", "zzz-extra.jpg"]);
    expect(item.custom?.erpDrop?.attachments[0]?.url).toBe("/api/tickets/inbox-attachment/%232026777/attachment1.png");
    expect(item.custom?.extraction.baseScenarioId).toBeNull();
    expect(item.custom?.extraction.entities.some((e) => e.type === "upn" && e.resolvedTo?.startsWith("lynne.robins"))).toBe(true);
    expect(item.custom?.extraction.entities.some((e) => e.id === "AADSTS53003")).toBe(true);
    expect(isAnyScenarioId("ERP-2026777")).toBe(true);
    expect(getScenarioEntry("ERP-2026777")?.kind).toBe("ticket");

    // Unchanged folder: nothing re-ingests.
    expect(scanInbox(quiet).ingested).toHaveLength(0);

    const ctx = await gatherContext("ERP-2026777", { fresh: true });
    expect(ctx.ticketId).toBe("ERP-2026777");
    expect(ctx.scenarioId).toBeNull();
    const brief = buildScenarioBrief(ctx);
    expect(brief.originKind).toBe("erp-drop");
    expect(brief.displayId).toBe("#2026777");
    expect(brief.status).toBe("New");
    expect(brief.requester?.displayName).toBe("Lynne Robins");
    expect(brief.attachments.map((a) => a.fileName)).toEqual(["attachment1.png", "zzz-extra.jpg"]);
    expect(brief.origin).toContain("input/tickets/#2026777");
    expect(brief.timeline.some((t) => t.actor === "ERP inbox watcher")).toBe(true);
    expect(brief.summary.endsWith(".")).toBe(true);
    expect(brief.steps.every((s) => s.detail.endsWith("."))).toBe(true);
    expect(listInbox().map((i) => i.scenarioId)).toContain("ERP-2026777");
    expect(resolveAttachmentPath(folder, "attachment1.png")).toBe(join(INBOX_DIR, folder, "attachment1.png"));
  });

  test("Muse Vision offline → deterministic fallback reads the PNG tEXt chunks and matches the sign-in log", async () => {
    const entry = getScenarioEntry("ERP-2026777");
    expect(entry && "erpDrop" in entry).toBe(true);
    const result = await visionTriageDrop(entry as Parameters<typeof visionTriageDrop>[0]);
    expect(result.source).toBe("deterministic");
    expect(result.attachment.fileName).toBe("attachment1.png");
    expect(result.extraction?.errorCode).toBe("AADSTS53003");
    expect(result.extraction?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.telemetry.tokensUsed.total).toBe(0);
    expect(result.match?.upn).toBeDefined();
    const bare = deterministicExtraction(new Uint8Array([1, 2, 3]), entry as Parameters<typeof deterministicExtraction>[1]);
    expect(bare.errorCode).toBe("AADSTS53003");
  });

  test("simulate-drop writes #2026xxx/ticketbody.json + attachment1.png and ingests through the same scan", () => {
    const drop = simulateDrop({ archetype: "WorkloadIdentity", seed: 42 });
    expect(drop.folder).toMatch(/^#2026\d{3}$/);
    expect(existsSync(join(drop.dir, "ticketbody.json"))).toBe(true);
    expect(existsSync(join(drop.dir, "attachment1.png"))).toBe(true);
    expect(drop.ingest?.item.scenarioId).toBe(drop.scenarioId);
    expect(drop.ingest?.item.custom?.extraction.baseScenarioId).toBeNull();
    expect(drop.ingest?.item.custom?.extraction.entities.some((e) => e.id === "AADSTS7000222")).toBe(true);
    const json = JSON.parse(readFileSync(join(drop.dir, "ticketbody.json"), "utf8")) as { id: string; attachments: string[] };
    expect(json.id).toBe(drop.displayId);
    expect(json.attachments).toEqual(["attachment1.png"]);
    expect(readPngInfo(new Uint8Array(readFileSync(join(drop.dir, "attachment1.png"))))?.texts.ErrorCode).toBe("AADSTS7000222");
    // Explicit ids are honoured and folders may be re-dropped.
    const again = simulateDrop({ archetype: "Licensing", ticketId: "#2026999", seed: 1 });
    expect(again.scenarioId).toBe("ERP-2026999");
    expect(again.ingest?.item.custom?.extraction.baseScenarioId).toBeNull();
  });

  test("a folder that disappears leaves the queue on the next scan", () => {
    rmSync(dir, { recursive: true, force: true });
    const scan = scanInbox(quiet);
    expect(scan.removed).toContain("ERP-2026777");
    expect(isAnyScenarioId("ERP-2026777")).toBe(false);
    expect(listInbox().map((i) => i.scenarioId)).not.toContain("ERP-2026777");
    expect(ingestFolder(folder, quiet)).toBeNull();
  });

  test("all 20 c4a8shili lab escalation tickets (INC-2026-88412..88560) ingest cleanly without resolution spoilers", () => {
    expect(LAB_INCIDENT_TICKETS).toHaveLength(20);
    const drops = generateAllLabTicketDrops();
    expect(drops).toHaveLength(20);

    const forbiddenSpoilers = [
      "MSP L3 Root Cause",
      "Root Cause & Resolution",
      "Revoke-MgUserSignInSession",
      "resetRedemption",
      "Start-ADSyncSyncCycle",
      "azuread_directory_role_eligibility_schedule_request",
      "Storage Blob Data Contributor",
      "Resize-Partition",
      "Azure CNI Overlay",
      "dcr-sentinel-windows-sec",
    ];

    for (const d of drops) {
      expect(d.body.customer).toBe("Contoso Finance");
      expect(d.body.tenantDomain).toBe("c4a8shili.onmicrosoft.com");
      expect(`${d.body.subject}\n${d.body.description}`).toContain("c4a8shili.onmicrosoft.com");
      for (const spoiler of forbiddenSpoilers) {
        expect(d.body.subject).not.toContain(spoiler);
        expect(d.body.description).not.toContain(spoiler);
      }
      const res = simulateDrop({ ticketId: d.body.incidentId });
      expect(res.folder).toBe(d.folder);
      expect(res.ingest?.entry.tenantId).toBe("tenant-contoso-01");
      expect(res.ingest?.entry.extraction.entities.some((e) => e.type === "errorCode")).toBe(true);
      const info = readPngInfo(d.png);
      expect(info?.texts.ErrorCode).toBe(d.body.telemetry.errorCode);
    }

    // All 20 remain registered concurrently in the inbox without eviction
    const inboxIds = new Set(listInbox().map((i) => i.displayId));
    for (const spec of LAB_INCIDENT_TICKETS) {
      expect(inboxIds.has(spec.id)).toBe(true);
    }
  });
});
