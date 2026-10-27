/**
 * Captures the README screenshots (1600x900) from the running workbench with a
 * headless Edge/Chrome driven over the DevTools protocol (no extra dependencies).
 *
 *   bun run scripts/capture-readme-screenshots.ts [--url http://localhost:5173] [--out docs/screenshots] [--closure] [--api http://127.0.0.1:4000]
 *
 * Needs the orchestrator (:4000) and the web app (:5173) running. Shot 3 runs a real
 * Tier 3 remediation for INC-4092 (stages the local fix/INC-4092-contoso-remediation
 * branch, never approves); shot 5 pins the ANOM-CA-204 canvas as a View Recipe, switches
 * to ANOM-INT-309 through Tier 0 and releases the pin again. Shot 6 highlights a phrase in
 * the INC-4092 ticket and spawns its ContextualMiniDashboard; shot 7 triages an unscripted
 * ticket from the composer; shot 9 drops a random ERP ticket into input/tickets/ (the folder is removed
 * again afterwards) and opens the unified work queue. With --closure, shot 8 approves INC-4092 as Emergency Break-Glass
 * (a live lab write in LIVE_CLOUD_MODE), captures the RESOLVED & VERIFIED badge with the
 * auto-drafted PSA resolution note, then resets the drift.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const URL_BASE = arg("--url", "http://localhost:5173");
const CLOSURE = process.argv.includes("--closure");
const API = arg("--api", process.env.CTX_ORCHESTRATOR_URL ?? "http://127.0.0.1:4000");
const ONLY = arg("--only", "");
const OUT = resolve(arg("--out", "docs/screenshots"));
const PORT = 9333;
const WIDTH = 1600;
const HEIGHT = 900;

const shouldRun = (shot: string) => !ONLY || ONLY === shot || ONLY === shot.replace(/^0+/, "");

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (msg) => {
      const data = JSON.parse(String(msg.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (data.id === undefined) return;
      const p = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error.message));
      else p?.resolve(data.result);
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error(`CDP connect failed: ${url}`));
    });
    return new Cdp(ws);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  }

  async waitFor(expression: string, timeoutMs: number, label: string) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.eval<boolean>(`Boolean(${expression})`).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  async key(key: string) {
    await this.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true })), true`);
  }

  async mouseTo(x: number, y: number) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  async shot(file: string) {
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } });
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`  ${file}`);
  }

  close() {
    this.ws.close();
  }
}

const exe = BROWSERS.find((b) => existsSync(b));
if (!exe) throw new Error("No Edge or Chrome found");
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "ctx-shots-"));
const browser = spawn(exe, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], {
  stdio: "ignore",
});

try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    const list = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => [])) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    target = list.find((t) => t.type === "page");
  }
  if (!target) throw new Error("headless browser did not expose a page");
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await cdp.send("Page.navigate", { url: URL_BASE });

  const canvasReady = (scenarioId: string, cards: number) =>
    `document.querySelector('[data-testid="tenant-breadcrumb"]')?.innerText.includes("#${scenarioId}") && document.querySelectorAll("section[data-component]").length >= ${cards} && !document.querySelector('[data-testid="tenant-breadcrumb"]').innerText.includes("correlating")`;
  /** Opens a work item through the unified queue (hotkeys 1-9 follow queue order, which shifts with drops). */
  const openItem = async (scenarioId: string) => {
    await cdp.key("Escape");
    await sleep(200);
    await cdp.eval(`document.querySelector('[data-testid="work-queue-button"]').click(), true`);
    await cdp.waitFor(`document.querySelector('[data-work-item="${scenarioId}"]')`, 5_000, `the ${scenarioId} queue row`);
    await cdp.eval(`document.querySelector('[data-work-item="${scenarioId}"]').click(), true`);
  };
  await cdp.waitFor(canvasReady("INC-4092", 3), 90_000, "the INC-4092 canvas");
  await sleep(1500);

  /* 1 · ticket mode: summary & plan, provenance pills, hover popover on the requester's UPN */
  if (shouldRun("01")) {
    const pill = await cdp.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector('[data-testid="enriched-context"] [data-entity^="lynne.robins"]') ?? document.querySelector('[data-entity^="lynne.robins"]');
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!pill) throw new Error("UPN pill not found");
    await cdp.mouseTo(pill.x - 4, pill.y);
    await sleep(100);
    await cdp.mouseTo(pill.x, pill.y);
    await cdp.waitFor(`[...document.querySelectorAll('[role="dialog"]')].some((d) => /Assigned SKU/.test(d.innerText) && /ms/.test(d.innerText) && !d.querySelector(".animate-pulse"))`, 20_000, "the hover popover");
    await sleep(400);
    await cdp.shot(join(OUT, "01-workbench-hover-popover.png"));
  }

  /* 2 · IaC diff modal */
  if (shouldRun("02")) {
    await cdp.mouseTo(WIDTH - 20, HEIGHT - 20);
    await cdp.key("Escape");
    await sleep(300);
    await cdp.key("d");
    await cdp.waitFor(`document.body.innerText.includes("@@")`, 10_000, "the diff modal");
    await sleep(500);
    await cdp.shot(join(OUT, "02-iac-diff-modal.png"));
  }

  /* 3 · Tier 3 approval drawer: Path A (copy + dry-run proof), Path B (delegated approval) */
  if (shouldRun("03")) {
    await cdp.key("Escape");
    await sleep(300);
    await cdp.key("f");
    await cdp.waitFor(`Boolean(document.querySelector('[data-testid="path-b"]')) && /Pre-Flight Checks Passed|Verified Safe|Verified With Warnings|Verification Failed/.test(document.querySelector("aside")?.innerText ?? "")`, 180_000, "the remediation bundle");
    await sleep(600);
    await cdp.shot(join(OUT, "03-tier3-approval-drawer.png"));
  }

  /* 4 · tenant anomaly ANOM-CA-204: plan step 1 expands the Conditional Access card */
  if (shouldRun("04")) {
    await openItem("ANOM-CA-204");
    await cdp.waitFor(canvasReady("ANOM-CA-204", 1), 60_000, "the ANOM-CA-204 canvas");
    await sleep(800);
    await cdp.key("e");
    await cdp.waitFor(`document.querySelector('section[data-component="EntraSignInTimeline"][data-expanded]')`, 10_000, "the expanded CA card");
    await sleep(700);
    await cdp.shot(join(OUT, "04-tenant-anomaly-ca-policy.png"));
  }

  /* 5 · pin the canvas as a recipe, switch to ANOM-INT-309 (Tier 0, 0 tokens), System & Audit open */
  if (shouldRun("05")) {
    await cdp.key("p");
    await cdp.waitFor(`document.body.innerText.includes("Recipe Pinned")`, 10_000, "the pinned recipe");
    await openItem("ANOM-INT-309");
    await cdp.waitFor(`${canvasReady("ANOM-INT-309", 1)} && document.querySelector('[data-testid="tenant-breadcrumb"]').innerText.includes("0 tokens")`, 30_000, "the ANOM-INT-309 recipe canvas");
    await cdp.waitFor(`!document.querySelector('[aria-label="Dismiss"]')`, 12_000, "the toasts to clear");
    await cdp.key("t");
    await sleep(900);
    await cdp.shot(join(OUT, "05-recipe-switch-system-audit.png"));
    await cdp.key("Escape");
    await cdp.key("p");
    await sleep(300);
  }

  /* 6 · highlight any text → Generate Context UI: a cyan mini-dashboard spawned from "temporary RDP" */
  if (shouldRun("06")) {
    await openItem("INC-4092");
    await cdp.waitFor(canvasReady("INC-4092", 3), 90_000, "the INC-4092 canvas");
    await cdp.waitFor(`document.querySelector('[data-testid="scenario-body"]')?.innerText.includes("temporary RDP")`, 15_000, "the INC-4092 ticket body");
    await sleep(800);
    const trigger = await cdp.eval<{ x: number; y: number } | null>(`(() => {
      const surface = document.querySelector('[data-testid="scenario-body"]')?.closest('[data-testid="selection-surface"]') ?? document.querySelector('[data-testid="selection-surface"]');
      if (!surface) return null;
      surface.scrollIntoView({ block: "center" });
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
      let node, hit = null;
      while ((node = walker.nextNode())) { const i = node.textContent.indexOf("temporary RDP"); if (i >= 0) { hit = { node, i }; break; } }
      if (!hit) return null;
      const range = document.createRange(); range.setStart(hit.node, hit.i); range.setEnd(hit.node, hit.i + "temporary RDP".length);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      surface.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return true;
    })()`);
    if (!trigger) throw new Error("ticket text not found for the selection shot");
    await cdp.waitFor(`document.querySelector('[data-testid="selection-trigger"]')`, 5_000, "the selection trigger pill");
    await sleep(400);
    await cdp.eval(`document.querySelector('[data-testid="selection-trigger"]').click(), true`);
    await cdp.waitFor(`document.querySelector('[data-mini-dashboard]') && !document.querySelector('[data-testid="mini-dashboard-loading"]')`, 30_000, "the mini-dashboard");
    await cdp.waitFor(`!document.querySelector('[aria-label="Dismiss"]')`, 12_000, "the toasts to clear");
    const badge = await cdp.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector('[data-selection]');
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (badge) {
      await cdp.mouseTo(badge.x - 3, badge.y);
      await sleep(80);
      await cdp.mouseTo(badge.x, badge.y);
      await sleep(350);
    }
    await cdp.shot(join(OUT, "06-highlight-generate-context-ui.png"));
  }

  /* 7 · unscripted ticket: the composer triages the ERP-sync sample live into CUSTOM-<hash> */
  if (shouldRun("07")) {
    await cdp.mouseTo(WIDTH - 20, HEIGHT - 20);
    await cdp.key("n");
    await cdp.waitFor(`document.querySelector('[data-sample="erp-secret"]')`, 10_000, "the ticket composer");
    await cdp.eval(`document.querySelector('[data-sample="erp-secret"]').click(), true`);
    await sleep(300);
    await cdp.eval(`document.querySelector('[data-testid="composer-submit"]').click(), true`);
    await cdp.waitFor(`document.querySelector('[data-testid="tenant-breadcrumb"]')?.innerText.includes("#CUSTOM-") && document.querySelectorAll("section[data-component]").length >= 1 && !document.querySelector('[data-testid="tenant-breadcrumb"]').innerText.includes("correlating")`, 90_000, "the custom ticket canvas");
    await cdp.waitFor(`!document.querySelector('[aria-label="Dismiss"]')`, 12_000, "the toasts to clear");
    await cdp.eval(`document.querySelector('[data-testid="scenario-pane"]').scrollTo({ top: 0 }), true`);
    await sleep(600);
    await cdp.shot(join(OUT, "07-unscripted-ticket-triage.png"));
  }

  /* 8 (--closure) · approve INC-4092 as Break-Glass → RESOLVED & VERIFIED, PSA resolution note; then reset the drift */
  if (CLOSURE && shouldRun("08")) {
    await openItem("INC-4092");
    await cdp.waitFor(canvasReady("INC-4092", 3), 90_000, "the INC-4092 canvas");
    await sleep(500);
    await cdp.key("f");
    await cdp.waitFor(`Boolean(document.querySelector('[data-testid="path-b"]')) && /Pre-Flight Checks Passed|Verified Safe|Verified With Warnings/.test(document.querySelector("aside")?.innerText ?? "")`, 180_000, "the remediation bundle");
    await cdp.key("x");
    await cdp.waitFor(`document.querySelector('[data-testid="resolution-note"]')`, 60_000, "the PSA resolution note");
    await cdp.waitFor(`!document.querySelector('[aria-label="Dismiss"]')`, 14_000, "the toasts to clear");
    await cdp.eval(`document.querySelector('[data-testid="scenario-pane"]').scrollTo({ top: 0 }), true`);
    await sleep(600);
    await cdp.shot(join(OUT, "08-ticket-closure-psa-note.png"));
    await cdp.key("0");
    await cdp.waitFor(`document.body.innerText.includes("Demo drift restored")`, 60_000, "the drift reset");
    await sleep(500);
  }

  /* 9 · the unified work queue: a random ERP drop lands in input/tickets/, the watcher ingests it, the queue lists every origin */
  if (shouldRun("09")) {
    await cdp.mouseTo(WIDTH - 20, HEIGHT - 20);
    await cdp.key("Escape");
    await sleep(300);
    const drop = (await fetch(`${API}/api/tickets/simulate-drop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archetype: "Mixed" }) }).then((r) => r.json())) as { scenarioId: string; dir: string; folder: string };
    try {
      await cdp.waitFor(`document.querySelector('[data-testid="queue-unseen"]')`, 15_000, "the ERP drop to reach the queue");
      await openItem(drop.scenarioId);
      await cdp.waitFor(`document.querySelector('[data-testid="scenario-display-id"]')?.innerText === "${drop.folder}" && document.querySelectorAll("section[data-component]").length >= 1 && !document.querySelector('[data-testid="tenant-breadcrumb"]').innerText.includes("correlating")`, 90_000, "the ERP drop canvas");
      await cdp.waitFor(`document.querySelector('[data-testid="ticket-attachment"] img')?.complete`, 10_000, "the attachment thumbnail");
      await cdp.waitFor(`!document.querySelector('[aria-label="Dismiss"]')`, 14_000, "the toasts to clear");
      await cdp.eval(`document.querySelector('[data-testid="scenario-pane"]').scrollTo({ top: 0 }), true`);
      await cdp.eval(`document.querySelector('[data-testid="work-queue-button"]').click(), true`);
      await cdp.waitFor(`document.querySelector('[data-testid="work-queue"]')`, 5_000, "the work queue popover");
      await cdp.eval(`document.querySelector('[data-testid="work-queue-search"]').blur(), true`);
      await sleep(500);
      await cdp.shot(join(OUT, "09-unified-work-queue-erp-drop.png"));
      await cdp.key("Escape");
    } finally {
      rmSync(drop.dir, { recursive: true, force: true });
    }
  }
  cdp.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
