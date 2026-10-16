import { test, expect, devices, type Page } from "@playwright/test";
import { mapStill, openMapSettings, settle, slow } from "../helpers";

/**
 * The map under a finger, as on an iPhone: what is drawn on the chart
 * keeps up while the finger is still down, a pan's and a pinch's, where it
 * waited for the fingers to lift (the owner, 2026-10-16: "Why doesn't the
 * map update while zooming in/out or even panning? Only updates when the
 * finger is off the screen"). Safari's user agent, from which Leaflet takes
 * a phone's ways -- on one it asks for a layer's tiles once a pan has ended
 * -- and the fingers Chromium's own touches (CDP), which WebKit here has
 * none of.
 */
test.use({ userAgent: devices["iPhone 15 Pro"].userAgent });
test.skip(({ browserName }) => browserName !== "chromium", "two fingers through Chromium's own touches (CDP)");

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");

/** The map opening on Campbell (C81), where the pilot last was, at the
 *  region's zoom. */
async function openOnC81(page: Page) {
  await page.addInitScript(() => localStorage.setItem("vfr.ownship",
    JSON.stringify({ state: { enabled: false, follow: true, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 })));
}

/** The middle of the chart the panel leaves in sight: above a sheet
 *  across the screen's foot, beside a card at its side. */
function chartMiddle(page: Page) {
  return page.evaluate(() => {
    const map = document.querySelector(".leaflet-container")!.getBoundingClientRect();
    const panel = document.querySelector('[data-slot="map-panel"]')?.getBoundingClientRect();
    if (panel && panel.width > map.width * 0.8) return { x: map.left + map.width / 2, y: map.top + (panel.top - map.top) / 2 };
    if (panel) return { x: panel.right + (map.right - panel.right) / 2, y: map.top + map.height / 2 };
    return { x: map.left + map.width / 2, y: map.top + map.height / 2 };
  });
}

/** Fingers on the screen, one or two, through Chromium's own touches. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: "touchStart" | "touchMove" | "touchEnd", points: [number, number][]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
}

test("the imagery over the chart comes in under a finger's pan, before it lifts", async ({ page }) => {
  await openOnC81(page);
  // The USGS's imagery stubbed, a tile a pixel, each counted as asked for.
  let asked = 0;
  await page.route(url => url.hostname === "basemap.nationalmap.gov", route => {
    asked++;
    return route.fulfill({ body: PIXEL, contentType: "image/png" });
  });
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  await page.getByTestId("overlay-select").getByRole("radio", { name: "Imagery" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => asked, { timeout: slow(15_000) }).toBeGreaterThan(0);
  await mapStill(page);
  const before = asked;
  const at = await chartMiddle(page);
  const touch = await fingers(page);
  await touch("touchStart", [[at.x, at.y]]);
  for (let i = 1; i <= 20; i++) {
    await touch("touchMove", [[at.x - i * 12, at.y]]);
    await page.waitForTimeout(30);
  }
  // Still held: the imagery asked for where the chart has come into sight.
  // On a phone Leaflet asked for it only once the pan had ended.
  await expect.poll(() => asked, { timeout: slow(5_000) }).toBeGreaterThan(before);
  await touch("touchEnd", []);
});

test("a pinch brings in the airports and the VFR waypoints of each level it passes, before the fingers lift", async ({ page }) => {
  await openOnC81(page);
  // Fields with no report and VFR waypoints across every box asked for:
  // at the region's zoom neither is drawn, from 8 both are.
  const grid = (url: string, row: (i: number, j: number, lat: number, lon: number) => object) => {
    const q = new URL(url).searchParams;
    const [s, w, n, e] = ["south", "west", "north", "east"].map(k => Number(q.get(k)));
    const out: object[] = [];
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) out.push(row(i, j, s! + ((n! - s!) * i) / 8, w! + ((e! - w!) * j) / 8));
    return out;
  };
  await page.route(url => url.pathname.endsWith("/api/planner/airports/in-view"), route => route.fulfill({ json: {
    airports: grid(route.request().url(), (i, j, lat, lon) => ({ ident: `G${i}${j}`, name: "Grid", lat, lon, kind: "small", flight_category: null, military: null })),
  } }));
  await page.route(url => url.pathname.endsWith("/api/planner/waypoints/in-view"), route => route.fulfill({ json: {
    waypoints: grid(route.request().url(), (i, j, lat, lon) => ({ ident: `VPG${i}${j}`, lat, lon, description: null })),
  } }));
  await page.goto("/app/plan");
  await settle(page);
  await mapStill(page);
  const targets = page.locator(".leaflet-airports-pane .leaflet-airport-target");
  const diamonds = page.locator(".leaflet-waypoints-pane .leaflet-marker-icon");
  await expect(targets).toHaveCount(0);
  await expect(diamonds).toHaveCount(0);
  // Two fingers spreading from 60 to 180 points apart: three times as
  // close, a level and a half in.
  const at = await chartMiddle(page);
  const touch = await fingers(page);
  await touch("touchStart", [[at.x - 30, at.y], [at.x + 30, at.y]]);
  for (let i = 1; i <= 20; i++) {
    await touch("touchMove", [[at.x - 30 - i * 3, at.y], [at.x + 30 + i * 3, at.y]]);
    await page.waitForTimeout(30);
  }
  // Still held: the fields' targets and the waypoints' diamonds drawn for
  // the level the pinch is at. They waited for the fingers to lift.
  await expect.poll(() => targets.count(), { timeout: slow(5_000) }).toBeGreaterThan(0);
  await expect.poll(() => diamonds.count(), { timeout: slow(5_000) }).toBeGreaterThan(0);
  await touch("touchEnd", []);
});
