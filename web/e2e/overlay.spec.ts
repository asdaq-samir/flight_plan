import { test, expect, type Page } from "@playwright/test";
import { openMapSettings, settle, slow } from "./helpers";

/**
 * Over the chart, at the pilot's ask (the map's settings, OverlayTiles):
 * the USGS's aerial imagery, or Google's map or satellite imagery where
 * the deployment has a key -- faint, half or full -- each credited in the
 * map's corner. The USGS's and Google's servers are stubbed: a tile is a
 * pixel, a session and the view's copyright Google's own shapes.
 */

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");

/** The tile servers stubbed; the requests made to each, by host. */
async function servers(page: Page, key: string | null) {
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/map/google"), route => (key
    ? route.fulfill({ json: { key } })
    : route.fulfill({ status: 404, json: { detail: "No Google Maps key is set for this deployment." } })));
  await page.route(url => url.hostname === "basemap.nationalmap.gov", route => {
    asked.push(route.request().url());
    return route.fulfill({ body: PIXEL, contentType: "image/png" });
  });
  await page.route(url => url.hostname === "tile.googleapis.com", route => {
    const url = new URL(route.request().url());
    asked.push(url.toString());
    if (url.pathname === "/v1/createSession") {
      return route.fulfill({ json: { session: "test-session", expiry: String(Math.round(Date.now() / 1000) + 14 * 86400), tileWidth: 256, tileHeight: 256, imageFormat: "png" } });
    }
    if (url.pathname === "/tile/v1/viewport") return route.fulfill({ json: { copyright: "Map data ©2026 Google", maxZoomRects: [] } });
    return route.fulfill({ body: PIXEL, contentType: "image/png" });
  });
  return asked;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the USGS's imagery over the chart, credited, at the strength picked; no Google where there is no key", async ({ page }) => {
  const asked = await servers(page, null);
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  const overlay = page.getByTestId("overlay-select");
  await expect(overlay.getByRole("radio")).toHaveText(["Off", "Imagery"]);
  await overlay.getByRole("radio", { name: "Imagery" }).click();
  await expect.poll(() => asked.some(u => u.includes("USGSImageryOnly")), { timeout: slow(15000) }).toBe(true);
  await expect(page.locator(".leaflet-control-attribution", { hasText: "USGS The National Map" })).toBeVisible();
  // Half to begin with, then full.
  const layer = page.locator(".leaflet-layer", { has: page.locator('img[src*="USGSImageryOnly"]') });
  await expect(layer).toHaveCSS("opacity", "0.6");
  // Above the base chart and the terminal sheet (zIndex 5), on purpose.
  await expect(layer).toHaveCSS("z-index", "6");
  await page.getByTestId("overlay-strength").getByRole("radio", { name: "Full" }).click();
  await expect(layer).toHaveCSS("opacity", "1");
  // Off: gone, its credit too.
  await overlay.getByRole("radio", { name: "Off" }).click();
  await expect(page.locator('img[src*="USGSImageryOnly"]')).toHaveCount(0);
  await expect(page.getByTestId("overlay-strength")).toHaveCount(0);
});

test("Google's map or its satellite over the chart where the deployment has a key, with Google Maps and its data's copyright", async ({ page }) => {
  const asked = await servers(page, "AIza-test");
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  await page.getByTestId("overlay-select").getByRole("radio", { name: "Google" }).click();
  await expect.poll(() => asked.some(u => u.includes("/v1/createSession?key=AIza-test")), { timeout: slow(15000) }).toBe(true);
  await expect.poll(() => asked.some(u => /\/v1\/2dtiles\/\d+\/\d+\/\d+\?session=test-session&key=AIza-test/.test(u))).toBe(true);
  await expect(page.locator(".leaflet-control-attribution", { hasText: "Google Maps · Map data ©2026 Google" })).toBeVisible();
  // Its satellite: a session of its own, with Google's roads over it.
  await page.getByTestId("google-overlay-select").getByRole("radio", { name: "Satellite" }).click();
  await expect.poll(() => asked.filter(u => u.includes("/v1/createSession")).length).toBe(2);
});

test("a saved Google overlay where there is no key is off, with no Strength row left", async ({ page }) => {
  await servers(page, null);
  await page.addInitScript(() => {
    const kept = localStorage.getItem("vfr.preferences");
    const saved = kept ? JSON.parse(kept) : { state: {}, version: 0 };
    saved.state.overlay = "google-satellite";
    localStorage.setItem("vfr.preferences", JSON.stringify(saved));
  });
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  await expect(page.getByTestId("overlay-select").getByRole("radio", { name: "Off" })).toBeChecked();
  await expect(page.getByTestId("overlay-strength")).toHaveCount(0);
  await expect(page.getByTestId("google-overlay-select")).toHaveCount(0);
});
