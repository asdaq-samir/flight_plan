import { test, expect, type Page, type Route } from "@playwright/test";
import { openSettings, beforeTheRoute } from "./helpers";

/**
 * The Class B airports on the map.
 *
 * Mocked rather than live wherever the assertion is about what is
 * shown: the real endpoint returns whatever the weather is doing right
 * now, and a test that passes only while Chicago is VFR is not a test.
 * The count and the terminal-chart tap run against the real planner,
 * because those are about the map rather than the numbers.
 */

// Nothing is drawn at the map's corner any more; the assertions that
// used to live there are in layout.spec.ts against the map's settings.
// The mocks below apply because playwright.config.ts blocks the app's
// service worker for the whole suite.

const PLAN = "/app/plan?dep=C81&dest=KDLH";
// The pill is a Class B field's alone (airportIcon's `classB`); the
// route's own C81 and KDLH draw squarer chips, so counting pills counts
// Class B airports.
const chips = (page: Page) => page.locator(".leaflet-marker-icon span.rounded-full");

/** The route on the map: its destination chip drawn, which is after
 *  the course has arrived and the markers laid out. It used to be a
 *  flat four seconds a test. */
async function routeDrawn(page: Page) {
  await expect(page.locator(".leaflet-marker-icon", { hasText: "KDLH" }).first()).toBeVisible({ timeout: 20000 });
}

const FIXTURE = {
  airports: [
    {
      ident: "KORD", name: "Chicago O'Hare International Airport",
      lat: 41.978, lon: -87.908, floor_ft_msl: 0, shelves: 12,
      flight_category: "IFR", metar: "METAR KORD 221451Z 08014KT 1SM BR OVC004",
      ceiling_ft: 400, visibility_sm: 1, wind_dir_true_deg: 80, wind_speed_kt: 14,
      taf: "TAF KORD 221500Z 2215/2318 07012G20KT 2SM", taf_ceiling_ft: 800, taf_visibility_sm: 2,
    },
    {
      ident: "KMSP", name: "Minneapolis St Paul International Airport",
      lat: 44.882, lon: -93.222, floor_ft_msl: 0, shelves: 9,
      flight_category: null, metar: null,
      ceiling_ft: null, visibility_sm: null, wind_dir_true_deg: null, wind_speed_kt: null,
      taf: null, taf_ceiling_ft: null, taf_visibility_sm: null,
    },
  ],
};

/** The client rewrites every planner path through the gateway
 *  (/api/x -> /api/planner/x) in a middleware, so the URL the network
 *  actually sees is not the one the call site wrote. Matching on the
 *  tail is what survives that. */
async function mockClassB(page: Page) {
  await page.route(url => url.pathname.endsWith("/class-b"), (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
}

async function showClassB(page: Page) {
  await openSettings(page);
  await page.getByTestId("class-b-toggle").click();
  await page.keyboard.press("Escape");
}

/** On, from the planner's search bar, before the route is loaded. */
async function showClassBFirst(page: Page) {
  await beforeTheRoute(page, () => page.getByTestId("class-b-toggle").click());
}

test("off until asked for: a route does not come covered in them", async ({ page }) => {
  // Thirty extra markers are useful on a cross-country that passes one
  // and clutter on a route that does not.
  await page.goto(PLAN);
  await routeDrawn(page);
  await page.waitForTimeout(500);   // a moment for any chips that were coming
  await expect(chips(page)).toHaveCount(0);
});

test("switched on, every Class B is on the map by name", { tag: "@smoke" }, async ({ page }) => {
  await showClassBFirst(page);
  await page.goto(PLAN);
  await routeDrawn(page);
  // The real planner: thirty is what the FAA's own shapefile yields.
  await expect.poll(() => chips(page).count(), { timeout: 20000 }).toBe(30);
  await expect(chips(page).filter({ hasText: "KORD" })).toHaveCount(1);
});

test("the marker's colour is the field's own flight category", async ({ page }) => {
  await mockClassB(page);
  await showClassBFirst(page);
  await page.goto(PLAN);
  await routeDrawn(page);

  const ord = chips(page).filter({ hasText: "KORD" }).first();
  const msp = chips(page).filter({ hasText: "KMSP" }).first();
  await expect(ord).toBeVisible({ timeout: 15000 });

  // IFR is red. A field with no report is grey, deliberately not the
  // green one: "unknown" must not look like "fine". Asked of the
  // locator, which retries: Leaflet redraws a marker's icon as the
  // layer settles, and a colour read once off the element it had just
  // replaced came back "" (a detached node has no computed style).
  await expect(ord).toHaveCSS("background-color", "rgb(179, 38, 30)");
  await expect(msp).toHaveCSS("background-color", "rgb(143, 163, 176)");
});

test("tapping one opens its card in the panel, with Fly Here, as any airport on the chart does", async ({ page }) => {
  // It had a card of its own on the map, the METAR and the TAF raw and a
  // pin for its terminal chart; the field's card in the panel has the
  // weather, the radio and the runways, and the settings' TAC the chart.
  await mockClassB(page);
  await showClassBFirst(page);
  await page.goto(PLAN);
  await routeDrawn(page);

  const ord = chips(page).filter({ hasText: "KORD" }).first();
  await expect(ord).toBeVisible({ timeout: 15000 });
  await ord.click();
  await expect(page).toHaveURL(/[?&]place=KORD/);
  // The live card, unmocked: the class-b fixture is only the chips.
  await expect(page.getByTestId("place-name")).toContainText("O'Hare", { timeout: 15000 });
  await expect(page.getByTestId("fly-here")).toBeVisible();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
});

test("on the training map, which has no card, a tap goes to the field at its terminal chart's zoom", async ({ page }) => {
  // Pinning from a route view would draw nothing -- the FAA publishes
  // terminal charts from zoom 10 and a whole route fits at about 6 --
  // so the tap goes to where the sheet is.
  await mockClassB(page);
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await showClassB(page);
  const ord = chips(page).filter({ hasText: "KORD" }).first();
  await expect(ord).toBeVisible({ timeout: 20000 });

  const tileZoom = () => page.evaluate(() => {
    const tile = document.querySelector('img.leaflet-tile[src*="/chart-tile/sec/"]') as HTMLImageElement | null;
    const m = tile?.src.match(/\/sec\/(\d+)\//);
    return m ? Number(m[1]) : null;
  });
  const before = await tileZoom();
  await ord.click();
  await expect.poll(tileZoom, { timeout: 20000 }).toBeGreaterThanOrEqual(10);
  expect(before).toBeLessThan(10);
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
});

test("on an IFR base, the settings' TAC draws the IFR area chart at a Class B field", async ({ page }) => {
  // The terminal sheet over an IFR chart is the IFR area chart: the
  // Class B row's chart segment says Area there, and that is what draws.
  const areaTiles: string[] = [];
  page.on("request", r => { if (r.url().includes("/chart-tile/ifr_area/")) areaTiles.push(r.url()); });
  await mockClassB(page);
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await openSettings(page);
  await page.getByTestId("base-chart-select").getByRole("radio", { name: "IFR low" }).click();
  await page.getByTestId("class-b-toggle").click();
  await expect(page.getByTestId("tac-toggle")).toHaveText("Area");
  await page.getByTestId("tac-toggle").click();
  await page.keyboard.press("Escape");

  const ord = chips(page).filter({ hasText: "KORD" }).first();
  await expect(ord).toBeVisible({ timeout: 20000 });
  await ord.click();
  await expect.poll(() => areaTiles.length, { timeout: 20000 }).toBeGreaterThan(0);
});
