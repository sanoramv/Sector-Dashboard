/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path for GitHub Pages project sites (https://<user>.github.io/<repo>/).
// Set VITE_BASE_PATH="/<repo-name>/" in the deploy workflow env. Defaults to "/"
// for local dev and for GitHub Pages user/org sites served from the domain root.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // NSE's archive hosts do not send CORS headers, so a plain browser fetch to
    // them is blocked. These dev-only proxies let `npm run dev` exercise the same
    // data-pipeline code paths against live NSE endpoints without hitting CORS.
    // Production (GitHub Pages) never uses this proxy - it only reads the static
    // JSON files published under /data by the scheduled fetch pipeline.
    proxy: {
      "/nse-archives": {
        target: "https://nsearchives.nseindia.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nse-archives/, ""),
      },
      "/niftyindices": {
        target: "https://niftyindices.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/niftyindices/, ""),
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
