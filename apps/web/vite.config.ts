import { readFileSync } from "node:fs";
import type { ClientRequest } from "node:http";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 127.0.0.1, not localhost: Node resolves localhost to ::1 first on Windows and the IPv6 fallback costs ~2 s per proxied request.
const orchestrator = process.env.CTX_ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";

/**
 * The orchestrator requires a bearer token (apps/orchestrator/src/security.ts): CTX_API_TOKEN, or the one it
 * writes to .contextpane/api-token at start-up. Read per request, so an orchestrator restart needs no Vite restart.
 */
const tokenFile = process.env.CTX_API_TOKEN_FILE ?? fileURLToPath(new URL("../../.contextpane/api-token", import.meta.url));
function apiToken(): string {
  if (process.env.CTX_API_TOKEN) return process.env.CTX_API_TOKEN.trim();
  try {
    return readFileSync(tokenFile, "utf8").trim();
  } catch {
    return "";
  }
}
function withToken(proxyReq: ClientRequest): void {
  const token = apiToken();
  if (token) proxyReq.setHeader("authorization", `Bearer ${token}`);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: orchestrator, changeOrigin: true, configure: (proxy) => proxy.on("proxyReq", withToken) },
      "/ws": { target: orchestrator.replace(/^http/, "ws"), ws: true, changeOrigin: true, configure: (proxy) => proxy.on("proxyReqWs", withToken) },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
