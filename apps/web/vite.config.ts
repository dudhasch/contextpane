import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 127.0.0.1, not localhost: Node resolves localhost to ::1 first on Windows and the IPv6 fallback costs ~2 s per proxied request.
const orchestrator = process.env.CTX_ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: orchestrator, changeOrigin: true },
      "/ws": { target: orchestrator.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
