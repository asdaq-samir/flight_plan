import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built into Spring Boot's static resources, which is what makes it the
// only public surface: the bundle and the API it calls arrive from one
// origin, so there is one session, one set of access rules, and no second
// front door on another port.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/app/",
  // Mirrors tsconfig.json's own "@/*" path -- shadcn's generated
  // components import from "@/lib/utils" etc., and Vite needs this
  // independently of TypeScript's own (type-check-only) path mapping.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../springboot-app/src/main/resources/static/app", emptyOutDir: true },
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
