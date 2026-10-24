import { test, expect, devices, type Page } from "@playwright/test";
import { airportMarks, mapStill, openMapSettings, settle, slow } from "../helpers";

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
  // The fields' places on the airports' canvas (AirportCanvas), drawn or
  // a target for a tap without a mark of their own.
  const targets = { count: async () => (await airportMarks(page)).length };
  const diamonds = page.locator(".leaflet-waypoints-pane .leaflet-marker-icon");
  expect(await targets.count()).toBe(0);
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

test("a pinch is left where the fingers leave it, as ForeFlight's is, between the chart's levels", async ({ page }) => {
  // The owner's recording of ForeFlight (2026-10-16): its map rests where
  // the fingers left it. Where the map rests is read off the chart's
  // tiles: a level at its own size on a whole one, scaled between two.
  await openOnC81(page);
  await page.goto("/app/plan");
  await settle(page);
  await mapStill(page);
  const scales = () => page.evaluate(() => [...document.querySelectorAll(".leaflet-tile-container")]
    .map(c => Number((c as HTMLElement).style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1)));
  const at = await chartMiddle(page);
  const touch = await fingers(page);
  await touch("touchStart", [[at.x - 30, at.y], [at.x + 30, at.y]]);
  // From 60 to 82 points apart: under half a level in.
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [[at.x - 30 - i * 1.1, at.y], [at.x + 30 + i * 1.1, at.y]]);
    await page.waitForTimeout(30);
  }
  await touch("touchEnd", []);
  await mapStill(page);
  // Left between levels: no level of the chart at its own size.
  await expect.poll(async () => (await scales()).some(s => Math.abs(s - 1) < 0.001)).toBe(false);
});

test("a pinch draws the course line again at its own width as it zooms, not scaled up and settling back", async ({ page }) => {
  // The owner's notice (2026-10-16): "The course line seems to get thicker
  // with the zoom and then settles back". Leaflet's SVG renderer scaled
  // what it had drawn, strokes and all, until the fingers lifted.
  await openOnC81(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const core = page.locator('.leaflet-overlay-pane path[stroke="#e600e6"]');
  await expect(core).toBeAttached({ timeout: slow(30_000) });
  await mapStill(page);
  // How much the renderer's <svg> is scaled, and the core's own width.
  const scale = () => page.evaluate(() => {
    const svg = document.querySelector('.leaflet-overlay-pane path[stroke="#e600e6"]')!.closest("svg")!;
    return new DOMMatrixReadOnly(getComputedStyle(svg).transform).a;
  });
  const at = await chartMiddle(page);
  const touch = await fingers(page);
  // From 60 to 180 points apart: three times as close, a level and a half in.
  await touch("touchStart", [[at.x - 30, at.y], [at.x + 30, at.y]]);
  const seen: number[] = [];
  for (let i = 1; i <= 20; i++) {
    await touch("touchMove", [[at.x - 30 - i * 3, at.y], [at.x + 30 + i * 3, at.y]]);
    await page.waitForTimeout(30);
    seen.push(await scale());
  }
  // Still held: the line drawn again as the fingers zoom it, scaled a
  // little at most between two draws (PINCH_REDRAW_MS) -- where it was
  // scaled up to three times until they lifted.
  expect(Math.max(...seen), `the renderer's scale under the pinch: ${seen.map(s => s.toFixed(2)).join(" ")}`).toBeLessThan(1.2);
  await expect(core).toHaveAttribute("stroke-width", "2.5");
  await touch("touchEnd", []);
});

test("a pinch out fills the chart's edges with tiles before the fingers lift, under half a level", async ({ page }) => {
  // The owner's notice (2026-10-16): "map is updating fine while panning
  // but not when zooming in or out". Leaflet asks for a pinch's tiles only
  // as it crosses half a level; the chart's layers ask as the map moves
  // (LIVE_TILES), a pinch's frames among them, so a pinch out short of
  // that fills the edges it bares as it goes. Kept so.
  await openOnC81(page);
  await page.route(url => url.pathname.startsWith("/api/planner/chart-tile/"), route => route.fulfill({ body: PIXEL, contentType: "image/png" }));
  await page.goto("/app/plan");
  await settle(page);
  await mapStill(page);
  // How far the chart's tiles reach past the map's edges, points (bare where negative).
  const reach = () => page.evaluate(() => {
    const map = document.querySelector(".leaflet-container")!.getBoundingClientRect();
    const tiles = [...document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded")].map(t => t.getBoundingClientRect());
    return Math.min(
      map.left - Math.min(...tiles.map(t => t.left)), map.top - Math.min(...tiles.map(t => t.top)),
      Math.max(...tiles.map(t => t.right)) - map.right, Math.max(...tiles.map(t => t.bottom)) - map.bottom,
    );
  });
  await expect.poll(reach, { timeout: slow(15_000) }).toBeGreaterThanOrEqual(0);
  // Two fingers near the top, from 180 to 130 points apart: 0.47 of a level
  // out, its foot drawn out past where the tiles reached.
  const map = (await page.locator(".leaflet-container").boundingBox())!;
  const at = { x: map.x + map.width / 2, y: map.y + 120 };
  const touch = await fingers(page);
  await touch("touchStart", [[at.x - 90, at.y], [at.x + 90, at.y]]);
  for (let i = 1; i <= 25; i++) {
    await touch("touchMove", [[at.x - 90 + i, at.y], [at.x + 90 - i, at.y]]);
    await page.waitForTimeout(30);
  }
  // Still held: the edges filled with the level's own tiles.
  await expect.poll(reach, { timeout: slow(5_000) }).toBeGreaterThanOrEqual(0);
  await touch("touchEnd", []);
});
