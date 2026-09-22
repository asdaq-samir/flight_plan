import { test, expect, type Page, type Route } from "@playwright/test";

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
// used to live there are in layout.spec.ts against the layers popover.
//
// The app registers a service worker that answers API calls
// NetworkFirst (vite.config.ts), and a request a service worker
// handles is not a page request -- page.route never sees it, so a
// mocked response silently lost to the real one. The Class B call
// fires after the layer is switched on, by which time the worker is
// certainly active, which is why this spec needs it off and the
// load-time specs do not.
test.use({ serviceWorkers: "block" });

const PLAN = "/app/plan?dep=C81&dest=KDLH";
const chips = (page: Page) => page.locator(".leaflet-marker-icon span.rounded-full");

const FIXTURE = {
  airports: [
    {
      ident: "KORD", name: "Chicago O'Hare International Airport",
      lat: 41.978, lon: -87.908, floor_ft_msl: 0, shelves: 12, tac: "Chicago TAC",
      flight_category: "IFR", metar: "METAR KORD 221451Z 08014KT 1SM BR OVC004",
      ceiling_ft: 400, visibility_sm: 1, wind_dir_true_deg: 80, wind_speed_kt: 14,
      taf: "TAF KORD 221500Z 2215/2318 07012G20KT 2SM", taf_ceiling_ft: 800, taf_visibility_sm: 2,
    },
    {
      ident: "KMSP", name: "Minneapolis St Paul International Airport",
      lat: 44.882, lon: -93.222, floor_ft_msl: 0, shelves: 9, tac: "Minneapolis-St Paul TAC",
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
  await page.getByTestId("layers-button").click();
  await page.getByTestId("class-b-toggle").click();
  await page.keyboard.press("Escape");
}

test("off until asked for: a route does not come covered in them", async ({ page }) => {
  // Thirty extra markers are useful on a cross-country that passes one
  // and clutter on a route that does not.
  await page.goto(PLAN);
  await page.waitForTimeout(4000);
  await expect(chips(page)).toHaveCount(0);
});

test("switched on, every Class B is on the map by name", async ({ page }) => {
  await page.goto(PLAN);
  await page.waitForTimeout(4000);
  await showClassB(page);
  // The real planner: thirty is what the FAA's own shapefile yields.
  await expect.poll(() => chips(page).count(), { timeout: 20000 }).toBe(30);
  await expect(chips(page).filter({ hasText: "KORD" })).toHaveCount(1);
});

test("the marker's colour is the field's own flight category", async ({ page }) => {
  await mockClassB(page);
  await page.goto(PLAN);
  await page.waitForTimeout(4000);
  await showClassB(page);

  const ord = chips(page).filter({ hasText: "KORD" }).first();
  const msp = chips(page).filter({ hasText: "KMSP" }).first();
  await expect(ord).toBeVisible({ timeout: 15000 });

  // IFR is red. A field with no report is grey, deliberately not the
  // green one: "unknown" must not look like "fine".
  const ifrColour = await ord.evaluate(el => getComputedStyle(el).backgroundColor);
  const unknownColour = await msp.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(ifrColour).toBe("rgb(179, 38, 30)");
  expect(unknownColour).toBe("rgb(143, 163, 176)");
});

test("hovering one shows what it is doing and what it is forecast to do", async ({ page }) => {
  await mockClassB(page);
  await page.goto(PLAN);
  await page.waitForTimeout(4000);
  await showClassB(page);

  const ord = chips(page).filter({ hasText: "KORD" }).first();
  await expect(ord).toBeVisible({ timeout: 15000 });
  await ord.hover();

  const tip = page.locator(".leaflet-tooltip");
  await expect(tip).toContainText("IFR");
  await expect(tip).toContainText("Chicago TAC");
  await expect(tip).toContainText("METAR KORD");
  await expect(tip).toContainText("TAF KORD");
  // Both columns, so "now" and "later" are distinguishable at a glance.
  await expect(tip).toContainText("400 ft");
  await expect(tip).toContainText("800 ft");

  // The raw text has to stay inside the card. Leaflet's own stylesheet
  // sets white-space: nowrap on tooltips, which ran a METAR straight
  // off the right edge.
  const overflow = await tip.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a field with no report says so rather than showing a blank", async ({ page }) => {
  await mockClassB(page);
  await page.goto(PLAN);
  await page.waitForTimeout(4000);
  await showClassB(page);

  const msp = chips(page).filter({ hasText: "KMSP" }).first();
  await expect(msp).toBeVisible({ timeout: 15000 });
  await msp.hover();
  await expect(page.locator(".leaflet-tooltip")).toContainText("no report");
});

test("tapping one opens a card, and the card pins its terminal chart", async ({ page }) => {
  // The pin used to float at the map's top-right corner with nothing
  // around it to say which airport it meant. It belongs with the
  // field's own weather, which is what a tap opens.
  //
  // Pinning from a route view would draw nothing -- the FAA publishes
  // terminal charts from zoom 10 and a whole route fits at about 6 --
  // so the pin goes there first.
  const tacTiles: string[] = [];
  page.on("request", r => { if (r.url().includes("/chart-tile/tac/")) tacTiles.push(r.url()); });

  await page.goto(PLAN);
  await page.waitForTimeout(4000);
  await showClassB(page);
  const ord = chips(page).filter({ hasText: "KORD" }).first();
  await expect(ord).toBeVisible({ timeout: 20000 });

  expect(tacTiles).toHaveLength(0);

  // A tap goes to the field, the way a tap on any marker on either map
  // does. The chart's own tile z is the map's zoom, up to the zoom the
  // FAA publishes sectionals at.
  const tileZoom = () => page.evaluate(() => {
    const tile = document.querySelector('img.leaflet-tile[src*="/chart-tile/sec/"]') as HTMLImageElement | null;
    const m = tile?.src.match(/\/sec\/(\d+)\//);
    return m ? Number(m[1]) : null;
  });
  const before = await tileZoom();
  await ord.click();
  await expect.poll(tileZoom, { timeout: 20000 }).toBeGreaterThanOrEqual(10);
  expect(before).toBeLessThan(10);

  // The card: the same weather the tooltip shows, plus the pin.
  const card = page.locator(".leaflet-popup-content");
  await expect(card).toContainText("KORD");
  await expect(card).toContainText("METAR KORD");
  // An icon, named by its accessible name rather than by words on the
  // card: the card is mostly raw METAR and TAF, and labelled buttons
  // under it pushed the weather off a phone screen.
  const pin = card.getByTestId("class-b-pin");
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(pin).toHaveAttribute("aria-label", "Pin the Chicago TAC");
  expect(tacTiles).toHaveLength(0);   // the card alone draws no chart
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toHaveAttribute("aria-label", /Unpin/);

  await expect.poll(() => tacTiles.length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile[src*="/chart-tile/tac/"]')]
        .some(img => img.complete && img.naturalWidth > 0)), { timeout: 45000 })
    .toBe(true);
});
