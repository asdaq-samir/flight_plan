import { test, expect, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The traffic about the map (TrafficLayer), from adsb.lol through the
 * planner, when the map's settings show it: stubbed here, adsb.lol's sky
 * not being the suite's. Two airplanes near Campbell Airport (C81).
 */

const TRAFFIC = {
  source: "adsb.lol", license: "ODbL 1.0",
  aircraft: [
    { hex: "a1", callsign: "N174HA", lat: 42.33, lon: -88.05, altitude_ft: 4500, pressure_altitude: false, track_deg: 320, speed_kt: 94, vertical_fpm: -800 },
    { hex: "a2", callsign: "UAL1023", lat: 42.30, lon: -88.10, altitude_ft: 9800, pressure_altitude: false, track_deg: 90, speed_kt: 220, vertical_fpm: 0 },
  ],
};

async function showTraffic(page: Page, on: boolean) {
  await page.addInitScript(show => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, traffic: show } }));
  }, on);
  const asks: URL[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/traffic"), route => {
    asks.push(new URL(route.request().url()));
    return route.fulfill({ json: TRAFFIC });
  });
  return asks;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("shown in the map's settings, the airplanes about are drawn on their tracks with their heights, and adsb.lol is credited", async ({ page }) => {
  const asks = await showTraffic(page, true);
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const marks = page.locator("svg[data-traffic]");
  await expect(marks).toHaveCount(2, { timeout: slow(15_000) });
  // With no own ship, each one's own height, a descent's arrow with it.
  const labels = page.locator(".leaflet-marker-pane").getByText(/^(4,500↓|9,800)/);
  await expect(labels).toHaveCount(2);
  await expect(marks.first()).toHaveAttribute("style", /rotate\(320deg\)/);
  await expect(page.locator(".leaflet-control-attribution")).toContainText("adsb.lol, ODbL");
  expect(asks.length).toBeGreaterThan(0);
  // Asked again while it shows.
  const first = asks.length;
  await expect.poll(() => asks.length, { timeout: slow(12_000) }).toBeGreaterThan(first);
});

test("between reports each airplane is carried on along its track, as ForeFlight's and FlightAware's are", async ({ page }) => {
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, traffic: true } }));
  });
  // One report, the planner's held answer growing older as adsb.lol is
  // not asked again (vfr.traffic): UAL1023 east at 450 kt.
  const reported = Date.now();
  const jet = { ...TRAFFIC.aircraft[1], speed_kt: 450 };
  await page.route(url => url.pathname.endsWith("/api/planner/traffic"), route =>
    route.fulfill({ json: { ...TRAFFIC, aircraft: [jet], age_s: (Date.now() - reported) / 1000 } }));
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const mark = page.locator("svg[data-traffic]");
  await expect(mark).toHaveCount(1, { timeout: slow(15_000) });
  // Its line out to where it will be in a minute.
  await expect(mark.locator("[data-trend]")).toHaveCount(1);
  const first = (await mark.boundingBox())!;
  await page.waitForTimeout(3000);
  const later = (await mark.boundingBox())!;
  // East, some 0.4 nm in three seconds: points to the right at this
  // zoom, and no jump back as the same report comes again.
  expect(later.x - first.x).toBeGreaterThan(2);
  expect(Math.abs(later.y - first.y)).toBeLessThan(2);
});

test("off, as it is unless shown, nothing is asked and nothing drawn", async ({ page }) => {
  const asks = await showTraffic(page, false);
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await page.waitForTimeout(2000);
  expect(asks).toHaveLength(0);
  await expect(page.locator("svg[data-traffic]")).toHaveCount(0);
  await expect(page.locator(".leaflet-control-attribution")).toHaveCount(0);
});
