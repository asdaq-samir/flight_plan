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
  build: { outDir: "../springboot-app/src/main/resources/static/app", emptyOutDir: true },
  server: {
    port: 5173,
    // The API is not in this process. Proxying in dev means the same
    // relative URLs work in both, so nothing has to know where it runs.
    proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } },
  },
  test: { environment: "node" },
});
