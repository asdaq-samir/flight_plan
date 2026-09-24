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
  // Playwright's own default for an `expect()` wait is 5s, which is a
  // reasonable figure for a page that is already built and a poor one
  // for this app: much of what these tests assert on arrives from the
  // planner, which renders each chart tile from FAA raster on demand
  // and is being asked for several routes at once by the workers
  // below. The flake this fixes was a 5s wait for the map's first tile
  // -- an assertion about the full-screen button, failing on tile
  // latency. It costs nothing when things are fast, and the 30s test
  // timeout above still catches anything genuinely hung.
  expect: { timeout: 15_000 },
  // One retry: a handful of tests wait on the planner's live nav log,
  // and under two workers on a busy machine one has missed a wait once
  // and passed every run since. A retry keeps a transient miss from
  // failing the run without hiding a real regression, which fails
  // twice.
  retries: 1,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    // The app registers a service worker that answers API calls itself
    // (vite.config.ts) and takes over an open page as soon as it is
    // active, and a request the worker handles never reaches
    // page.route -- a mock then silently loses to the real answer, and
    // whether it did depends on timing. Blocked for the whole suite, a
    // mock always applies. A spec about the worker itself (keeping a
    // route's charts offline) opts back in with
    // test.use({ serviceWorkers: "allow" }).
    serviceWorkers: "block",
  },
  // Both projects run the whole suite -- most of it (corner-flush
  // checks, overflow checks, nav links) computes its assertions off
  // `page.viewportSize()` rather than a hard-coded number, so it holds
  // at either size unmodified. The handful of tests that are
  // genuinely mobile-only (shadcn's Sidebar swaps to a Sheet overlay
  // below its own breakpoint, a real behavior change, not just a
  // resize) skip themselves on "desktop" -- see layout.spec.ts's own
  // `mobileOnly` helper.
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
