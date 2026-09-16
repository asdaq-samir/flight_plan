import { defineConfig } from "@playwright/test";

/**
 * Layout tests, not the jsdom-based vitest suite above -- these exist
 * specifically because jsdom never runs a real layout engine (no box
 * model, no flexbox, no shrink-to-fit, `getBoundingClientRect()` always
 * zero), so a whole class of bug that only shows up once CSS is
 * actually laid out was invisible to `npm test` no matter what got
 * mocked. Every case here is a regression that slipped through in
 * exactly that way: a handle not truly flush against the screen edge,
 * a collapsed panel whose width didn't really go to zero, a table wide
 * enough to push the page itself into horizontal scroll.
 *
 * Needs the real app running and served -- see web/README.md for the
 * `docker compose up -d --build webapp planning-service` + `npx
 * playwright test` sequence (or docker run against the
 * mcr.microsoft.com/playwright image, no local browser install
 * needed). BASE_URL overrides the default of the local docker-compose
 * webapp port.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    viewport: { width: 390, height: 844 },
  },
});
