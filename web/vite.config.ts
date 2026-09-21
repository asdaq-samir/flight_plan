import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Built into Spring Boot's static resources, which is what makes it the
// only public surface: the bundle and the API it calls arrive from one
// origin, so there is one session, one set of access rules, and no second
// front door on another port.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The app in the air: a service worker (Workbox, generated at
    // build) that keeps the app shell, every chart tile the map has
    // drawn or `KeepRoute` fetched ahead, and the planner's own
    // answers (course, checkpoints, nav log, briefing) as they are
    // fetched -- so a route opened on the ground opens again with no
    // connection at all. Served from /app/sw.js by webapp (its /app/**
    // handler serves a real file as itself), scoped to /app/. Installs
    // only on a secure origin: https, or localhost.
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "VFR Route", short_name: "VFR Route", description: "A charted course, checkpoints, nav log and briefing.",
        start_url: "/app/plan", scope: "/app/", display: "standalone",
        background_color: "#ffffff", theme_color: "#ffffff",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        navigateFallback: "/app/index.html",
        navigateFallbackAllowlist: [/^\/app\//],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [
          {
            // The chart tiles, served by the planner (…/chart-tile/…) or
            // from the CDN (…/tiles/<cycle>/…): cache first, they are
            // the same for the whole 56-day cycle, and a miss offline
            // is simply a blank tile.
            urlPattern: ({ url }) => url.pathname.includes("/chart-tile/") || url.pathname.includes("/tiles/"),
            handler: "CacheFirst",
            options: {
              cacheName: "chart-tiles",
              expiration: { maxEntries: 20000, maxAgeSeconds: 60 * 24 * 3600, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The planner's answers: the network when there is one
            // (the winds change), the last answer when there is not.
            urlPattern: ({ url, request }) =>
              request.method === "GET" && url.pathname.startsWith("/api/planner/") && !url.pathname.includes("/chart-tile/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "planner-api",
              networkTimeoutSeconds: 15,
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  base: "/app/",
  // Mirrors tsconfig.json's own "@/*" path -- shadcn's generated
  // components import from "@/lib/utils" etc., and Vite needs this
  // independently of TypeScript's own (type-check-only) path mapping.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "../springboot-app/src/main/resources/static/app",
    emptyOutDir: true,
    // The libraries in chunks of their own, so that a change to this
    // app's code (most deploys) leaves React, the map and the query
    // client with the same hashed names -- and so still in the
    // browser's cache, where WebMvcConfig lets hashed assets live for
    // a year.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/leaflet/")) return "leaflet";
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|@tanstack|scheduler)\//.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // The API is not in this process. Proxying in dev means the same
    // relative URLs work in both, so nothing has to know where it runs.
    proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } },
  },
  // e2e/ is Playwright's own suite (`npm run test:e2e`), a real browser
  // against the actually-running app -- vitest's default globs would
  // otherwise also pick up its *.spec.ts files and fail them here for
  // the wrong reason (no @playwright/test import resolves under vitest).
  test: { environment: "node", exclude: ["**/node_modules/**", "e2e/**"] },
});
