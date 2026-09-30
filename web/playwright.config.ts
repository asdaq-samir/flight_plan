import { defineConfig } from "@playwright/test";
import { DEVELOPER_STATE } from "./e2e/emailSignIn";

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
// In CI (the e2e job) four cores carry the whole stack, the browsers
// and a planner rendering map tiles for a cold cache at once: the
// waits below are doubled there, a test gets two more goes, and two
// workers rather than a share of the cores.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // 60s, not Playwright's 30s. The suite runs every test against the real
  // stack, both viewports at once, and a full run's slowest tests take
  // 25-31s there (the departure-time ETAs, the map's popups, the Class B
  // cards) though each takes under 10s alone -- the planner is drawing
  // tiles and nav logs for every worker together. At 30s those failed
  // now and then on nothing but load. A hung test still fails, in a
  // minute.
  timeout: ci ? 120_000 : 60_000,
  // Playwright's own default for an `expect()` wait is 5s, which is a
  // reasonable figure for a page that is already built and a poor one
  // for this app: much of what these tests assert on arrives from the
  // planner, which renders each chart tile from FAA raster on demand
  // and is being asked for several routes at once by the workers
  // below. The flake this fixes was a 5s wait for the map's first tile
  // -- an assertion about the full-screen button, failing on tile
  // latency. It costs nothing when things are fast, and the test
  // timeout above still catches anything genuinely hung.
  expect: { timeout: ci ? 30_000 : 15_000 },
  // One retry: a handful of tests wait on the planner's live nav log,
  // and under two workers on a busy machine one has missed a wait once
  // and passed every run since. A retry keeps a transient miss from
  // failing the run without hiding a real regression, which fails
  // twice.
  retries: ci ? 2 : 1,
  // Three quarters of the machine's cores locally (six of eight ran the
  // suite in 4.0 minutes against 4.6 at the default half, with no more
  // flakes); two in CI, where the four-core runner is the stack's too.
  workers: ci ? 2 : "75%",
  // A whole run that is not done in half an hour is a stack that is
  // not answering, and the report of what did and did not pass is
  // worth more than the job's own time limit cutting it off unsaid.
  globalTimeout: ci ? 30 * 60_000 : undefined,
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
  //
  // Both as the developer: the local stack signs in the way a
  // deployment does (docker-compose.yml's inbox), so "setup" signs in
  // once, by email, and every test opens that session unless it says
  // otherwise -- a signed-out one with
  // test.use({ storageState: { cookies: [], origins: [] } }).
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "mobile", dependencies: ["setup"],
      use: { viewport: { width: 390, height: 844 }, storageState: DEVELOPER_STATE },
    },
    {
      name: "desktop", dependencies: ["setup"],
      use: { viewport: { width: 1280, height: 800 }, storageState: DEVELOPER_STATE },
    },
  ],
});
