/**
 * Captures the four README screenshots (1600x900) from the running workbench with a
 * headless Edge/Chrome driven over the DevTools protocol (no extra dependencies).
 *
 *   bun run scripts/capture-readme-screenshots.ts [--url http://localhost:5173] [--out docs/screenshots]
 *
 * Needs the orchestrator (:4000) and the web app (:5173) running. Shot 3 runs a real
 * Tier 3 remediation (stages a local fix/* branch, never approves); shot 4 pins the
 * current canvas as the "Contoso Finance triage" recipe and switches to Fabrikam.
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
const OUT = resolve(arg("--out", "docs/screenshots"));
const PORT = 9333;
const WIDTH = 1600;
const HEIGHT = 900;

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

  const canvasReady = `document.querySelectorAll("[data-component]").length >= 4 && !document.body.innerText.includes("Correlating ticket")`;
  await cdp.waitFor(canvasReady, 90_000, "the Contoso canvas");
  await sleep(1500);

  /* 1 · workbench + hover popover on the requester's UPN */
  const pill = await cdp.eval<{ x: number; y: number } | null>(`(() => {
    const el = [...document.querySelectorAll("button")].find((b) => /^lynne\\.robins/.test(b.innerText.trim()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!pill) throw new Error("UPN pill not found");
  await cdp.mouseTo(pill.x, pill.y);
  await cdp.waitFor(`[...document.querySelectorAll('[role="dialog"]')].some((d) => /tok/.test(d.innerText) && !d.querySelector(".animate-pulse"))`, 20_000, "the hover popover");
  await sleep(400);
  await cdp.shot(join(OUT, "01-workbench-hover-popover.png"));

  /* 2 · IaC diff modal */
  await cdp.mouseTo(WIDTH - 20, HEIGHT - 20);
  await cdp.key("Escape");
  await sleep(300);
  await cdp.key("3");
  await cdp.waitFor(`document.body.innerText.includes("@@")`, 10_000, "the diff modal");
  await sleep(500);
  await cdp.shot(join(OUT, "02-iac-diff-modal.png"));

  /* 3 · Tier 3 approval drawer, verified in the Modal sandbox */
  await cdp.key("Escape");
  await sleep(300);
  await cdp.key("4");
  await cdp.waitFor(`/Verified Safe|Verified With Warnings|Verification Failed/.test(document.querySelector("aside")?.innerText ?? "")`, 180_000, "the remediation bundle");
  await sleep(600);
  await cdp.shot(join(OUT, "03-tier3-approval-drawer.png"));

  /* 4 · pin the canvas as a recipe, switch to Fabrikam (Tier 0, 0 tokens), router savings open */
  await cdp.key("Escape");
  await sleep(300);
  await cdp.key("p");
  await cdp.waitFor(`document.body.innerText.includes("Pinned · 0 tokens")`, 10_000, "the pinned recipe");
  await cdp.key("6");
  await cdp.waitFor(`document.querySelector('[data-component="TenantSummaryHeader"]')?.innerText.includes("Fabrikam") && document.body.innerText.includes("LLM tokens")`, 30_000, "the Fabrikam recipe canvas");
  await cdp.waitFor(`!document.querySelector('[aria-label="Dismiss"]')`, 12_000, "the toasts to clear");
  await cdp.key("t");
  await sleep(900);
  await cdp.shot(join(OUT, "04-fabrikam-recipe-router-savings.png"));
  cdp.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
