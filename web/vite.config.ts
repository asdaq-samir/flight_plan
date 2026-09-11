import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built to planner-ui's static directory so FastAPI serves it, which keeps
// the deployment story unchanged while the port is in progress: the old
// pages stay reachable until this one is at parity. When Spring Boot
// becomes the public surface, only this output path moves.
export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: { outDir: "../planner-ui/app/web", emptyOutDir: true },
  server: {
    port: 5173,
    // The API is not in this process. Proxying in dev means the same
    // relative URLs work in both, so nothing has to know where it runs.
    proxy: { "/api": { target: "http://planner-ui:8000", changeOrigin: true } },
  },
  test: { environment: "node" },
});
