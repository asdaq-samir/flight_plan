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

test("off, as it is unless shown, nothing is asked and nothing drawn", async ({ page }) => {
  const asks = await showTraffic(page, false);
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await page.waitForTimeout(2000);
  expect(asks).toHaveLength(0);
  await expect(page.locator("svg[data-traffic]")).toHaveCount(0);
  await expect(page.locator(".leaflet-control-attribution")).toHaveCount(0);
});
