import { test, expect, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * Tracking an airplane, as FlightAware and ForeFlight do, at the pilot's
 * ask: the Aircraft button under Nearest, its list and its search, a tap
 * on one on the map, its card and its path flown; and own ship's own
 * path. adsb.lol is stubbed through the planner: its sky is not the
 * suite's.
 */

const UAL = {
  hex: "a0b7d8", callsign: "UAL2088", registration: "N14511", type: "A21N", lat: 42.35, lon: -88.0,
  altitude_ft: 7000, pressure_altitude: false, track_deg: 90, speed_kt: 250, vertical_fpm: -1200, seen_s: 0.5, squawk: "3324",
};
const CESSNA = {
  hex: "a128b9", callsign: "N174HA", registration: "N174HA", type: "C172", lat: 42.30, lon: -88.12,
  altitude_ft: 2500, pressure_altitude: false, track_deg: 320, speed_kt: 94, vertical_fpm: 0, seen_s: 0.3, squawk: "1200",
};
const DETAIL = {
  hex: "a0b7d8", registration: "N14511", type: "A21N", description: "AIRBUS A-321neo", operator: "UNITED AIRLINES INC", year: "2024",
  departed: { ident: "TJSJ", name: "Luis Munoz Marin International Airport", at: Date.now() / 1000 - 4 * 3600 },
  trail: [
    { t: Date.now() / 1000 - 600, lat: 42.35, lon: -88.6, alt_ft: 12000 },
    { t: Date.now() / 1000 - 300, lat: 42.35, lon: -88.3, alt_ft: 9000 },
    { t: Date.now() / 1000 - 10, lat: 42.35, lon: -88.01, alt_ft: 7000 },
  ],
};

/** The planner's traffic, an airplane's flight and a search, stubbed. */
async function sky(page: Page, detail: object = DETAIL) {
  const reported = Date.now();
  await page.route(url => url.pathname.endsWith("/api/planner/traffic"), route =>
    route.fulfill({ json: { aircraft: [UAL, CESSNA], age_s: (Date.now() - reported) / 1000, source: "adsb.lol", license: "ODbL 1.0" } }));
  await page.route(url => url.pathname.startsWith("/api/planner/traffic/flight/"), route => route.fulfill({ json: detail }));
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/find"), route =>
    route.fulfill({ json: { aircraft: new URL(route.request().url()).searchParams.get("q") === "UAL2088" ? [UAL] : [] } }));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Aircraft sits under Nearest, lists the airplanes about, and a tap on one tracks it: its card, its path, the map on it", async ({ page }) => {
  await sky(page);
  await page.goto("/app/plan");
  await settle(page);
  const nearest = (await page.getByTestId("nearest-button").boundingBox())!;
  const aircraft = page.getByTestId("aircraft-button");
  const box = (await aircraft.boundingBox())!;
  expect(box.y).toBeGreaterThan(nearest.y + nearest.height - 1);
  expect(Math.abs(box.x - nearest.x)).toBeLessThan(2);
  await aircraft.click();
  const list = page.getByTestId("aircraft-card");
  await expect(list.getByTestId("aircraft-row")).toHaveCount(2, { timeout: slow(15_000) });
  await list.getByTestId("aircraft-row").filter({ hasText: "UAL2088" }).click();
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  const card = page.getByTestId("flight-card");
  await expect(card.getByTestId("flight-name")).toHaveText("UAL2088");
  await expect(card.getByTestId("flight-line")).toContainText("Airbus A-321neo · United Airlines Inc");
  await expect(card.getByTestId("flight-departed")).toContainText("TJSJ");
  await expect(card.getByTestId("flight-altitude")).toContainText("7,000 ft");
  await expect(card.getByTestId("flight-follow")).toHaveAttribute("aria-pressed", "true");
  // Ringed on the map, its path behind it in its heights' colours.
  await expect(page.locator("[data-traffic-tracked]")).toHaveCount(1);
  await expect(page.locator(".leaflet-overlay-pane path.tracked-path").first()).toBeAttached();
  // Put away: the list again, as an airport's card over Nearest.
  await card.getByTestId("flight-close").click();
  await expect(page).not.toHaveURL(/[?&]flight=/);
  await expect(list).toBeVisible();
});

test("an airplane is found by its callsign, and a tap on one on the map tracks it too", async ({ page }) => {
  await sky(page, { ...DETAIL, departed: null });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  await page.getByTestId("aircraft-search").fill("ual 2088");
  const found = page.getByTestId("aircraft-card").getByTestId("aircraft-found").filter({ hasText: "UAL2088" });
  await expect(found.first()).toBeVisible({ timeout: slow(15_000) });
  await page.getByTestId("aircraft-search").press("Enter");
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  // No field it took off from in its track: no Departed row.
  await expect(page.getByTestId("flight-card").getByTestId("flight-name")).toHaveText("UAL2088");
  await expect(page.getByTestId("flight-departed")).toHaveCount(0);
  // One tapped on the map: the Cessna, the second heard.
  await page.getByTestId("flight-close").click();
  const hits = page.locator("[data-traffic-hit]");
  await expect(hits).toHaveCount(2);
  await hits.nth(1).dispatchEvent("click");
  await expect(page).toHaveURL(/[?&]flight=a128b9/);
  await expect(page.getByTestId("flight-card").getByTestId("flight-name")).toHaveText("N174HA");
});

test("a search finds the airplanes about as it is typed, and asks the planner one name at a time, the last typed", async ({ page }) => {
  await sky(page);
  // The planner's search held two seconds, as adsb.lol's pace can.
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/find"), async route => {
    const q = new URL(route.request().url()).searchParams.get("q")!;
    asked.push(q);
    await new Promise(done => setTimeout(done, 2000));
    await route.fulfill({ json: { aircraft: q === "N654FL" ? [{ ...CESSNA, hex: "a89c1e", callsign: "N654FL", registration: "N654FL" }] : [] } });
  });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  const card = page.getByTestId("aircraft-card");
  await expect(card.getByTestId("aircraft-row")).toHaveCount(2, { timeout: slow(15_000) });
  const search = page.getByTestId("aircraft-search");
  // On the map already: found as it is typed, before any answer.
  await search.fill("N17");
  await expect(card.getByTestId("aircraft-found")).toHaveText([/N174HA/]);
  // A name typed with pauses, as on a phone's keyboard: only the first and
  // the last are asked about, never the ones between.
  for (const typed of ["N65", "N654", "N654F", "N654FL"]) {
    await search.fill(typed);
    await page.waitForTimeout(700);
  }
  await expect(card.getByTestId("aircraft-found")).toHaveText([/N654FL/], { timeout: slow(15_000) });
  expect(asked.at(-1)).toBe("N654FL");
  expect(asked.filter(q => q === "N654" || q === "N654F")).toEqual([]);
});

test("in the air, own ship's path flown is drawn behind it", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.addInitScript(() => {
    const started = Date.now();
    // East at 360 kt, a tenth of a mile a second, at 3,000 ft.
    const position = () => ({
      coords: {
        latitude: 42.3246, longitude: -88.0741 + ((Date.now() - started) / 1000) * 0.1 / (60 * 0.7392),
        accuracy: 10, heading: 90, speed: 360 / 1.943844, altitude: 3000 / 3.28084, altitudeAccuracy: 10, toJSON() { return this; },
      },
      timestamp: Date.now(), toJSON() { return this; },
    }) as unknown as GeolocationPosition;
    Geolocation.prototype.watchPosition = function (success: PositionCallback) {
      window.setTimeout(() => success(position()), 0);
      return window.setInterval(() => success(position()), 1000);
    };
    Geolocation.prototype.clearWatch = function (id: number) { window.clearInterval(id); };
    localStorage.removeItem("vfr.owntrail");
    localStorage.setItem("vfr.ownship",
      JSON.stringify({ state: { enabled: true, follow: true, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 }));
  });
  await page.route(url => url.pathname.endsWith("/api/planner/airspace/ahead"), route => route.fulfill({ json: { alerts: [], unavailable: [] } }));
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.locator(".leaflet-overlay-pane path.own-trail")).toBeAttached({ timeout: slow(15_000) });
});
