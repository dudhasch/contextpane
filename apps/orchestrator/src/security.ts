import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { cachedTokenClaims } from "@contextpane/mcp-msgraph";
import { REPO_ROOT, config, isLiveCloudMode } from "./config.ts";

/**
 * Local API hardening (review item 13). The orchestrator drives tenant writes, so even bound to
 * 127.0.0.1 it checks three things on /api/* and /ws:
 *
 *  1. Host header: 127.0.0.1, localhost or [::1] only. A DNS-rebinding page reaches the socket
 *     under its own host name and is refused here.
 *  2. A bearer token. CTX_API_TOKEN, or a random one minted at start-up and written to
 *     .contextpane/api-token (git-ignored, 0600); the Vite dev proxy reads that file and adds the
 *     header, so the browser never holds the token and `bun run dev` needs no setup.
 *  3. State-changing requests (POST, PUT, PATCH, DELETE) must be application/json and, when the
 *     browser sends an Origin, a local one: a cross-site form or `text/plain` "simple" request
 *     cannot pass, and a JSON one needs a CORS preflight that a foreign origin fails.
 */

export const API_TOKEN_FILE = process.env.CTX_API_TOKEN_FILE?.trim() || join(REPO_ROOT, ".contextpane", "api-token");

const envToken = process.env.CTX_API_TOKEN?.trim() ?? "";
const apiToken = envToken || randomBytes(32).toString("hex");

export const apiSecurity = {
  /** Off under `bun test` unless a test switches it on; CTX_API_AUTH=false disables it explicitly. */
  enforce: process.env.CTX_API_AUTH ? !/^(0|false|no|off)$/i.test(process.env.CTX_API_AUTH) : process.env.NODE_ENV !== "test",
  token: apiToken,
};

/** Writes the start-up token where the Vite proxy and the smoke scripts read it. A token from the environment is not written. */
export function publishApiToken(): string | null {
  if (envToken) return null;
  mkdirSync(dirname(API_TOKEN_FILE), { recursive: true });
  writeFileSync(API_TOKEN_FILE, `${apiToken}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(API_TOKEN_FILE, 0o600);
  } catch {
    /* Windows: ACLs, not modes */
  }
  return API_TOKEN_FILE;
}

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function tokenMatches(header: string | undefined): boolean {
  const presented = /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1]?.trim() ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(apiSecurity.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const localApiGuard: MiddlewareHandler = async (c, next) => {
  if (!apiSecurity.enforce) return next();
  const host = c.req.header("host") ?? "";
  if (!LOCAL_HOST_RE.test(host)) return c.json({ error: `host '${host.slice(0, 80)}' is not allowed` }, 421);
  // The health probe stays open so start-up scripts can wait on it; it changes nothing and returns no tenant data.
  if (c.req.path === "/api/health" && c.req.method === "GET") return next();
  if (!tokenMatches(c.req.header("authorization"))) return c.json({ error: "missing or invalid API token (see .contextpane/api-token)" }, 401);
  if (STATE_CHANGING.has(c.req.method)) {
    // A browser always sends Origin on a cross-site write; the Vite proxy passes the page's own.
    const origin = c.req.header("origin");
    if (origin && !LOCAL_ORIGIN_RE.test(origin)) return c.json({ error: `origin '${origin.slice(0, 80)}' is not allowed` }, 403);
    const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return c.json({ error: "state-changing requests must be application/json" }, 415);
  }
  return next();
};

/**
 * The identity an approval, override, rollback or closure is recorded under. It is never taken from
 * the request body: in live mode it is the signed-in Graph account, otherwise the lab's delegated identity.
 */
export function operatorIdentity(): string {
  if (isLiveCloudMode()) {
    const claims = cachedTokenClaims("https://graph.microsoft.com");
    const upn = claims?.upn ?? claims?.unique_name;
    if (typeof upn === "string" && upn.includes("@")) return upn;
  }
  return config.lab.delegatedIdentity;
}
