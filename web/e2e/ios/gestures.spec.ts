import { test, expect, devices, type Page } from "@playwright/test";
import { airportMarks, drawn, mapStill, openMapSettings, settle, slow } from "../helpers";

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
  await page.addInitScript(() => localStorage.setItem("wingtip.ownship",
    JSON.stringify({ state: { enabled: false, follow: true, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 })));
}

/** The middle of the chart the panel leaves in sight: above a sheet
 *  across the screen's foot, beside a card at its side. */
function chartMiddle(page: Page) {
  return page.evaluate(() => {
    const map = document.querySelector(".maplibregl-map")!.getBoundingClientRect();
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

test("a pinch brings in the airports of each level it passes, before the fingers lift", async ({ page }) => {
  await openOnC81(page);
  // Fields with no report across every box asked for: at the region's
  // zoom none is drawn, from 8 they are -- regional
  // fields, as a small one's mark waits for 10 since the owner's "Do two
  // levels up" (2026-10-29, 507308ae: AirportsLayer's SHOWN_FROM).
  const grid = (url: string, row: (i: number, j: number, lat: number, lon: number) => object) => {
    const q = new URL(url).searchParams;
    const [s, w, n, e] = ["south", "west", "north", "east"].map(k => Number(q.get(k)));
    const out: object[] = [];
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) out.push(row(i, j, s! + ((n! - s!) * i) / 8, w! + ((e! - w!) * j) / 8));
    return out;
  };
  await page.route(url => url.pathname.endsWith("/api/planner/airports/in-view"), route => route.fulfill({ json: {
    airports: grid(route.request().url(), (i, j, lat, lon) => ({ ident: `G${i}${j}`, name: "Grid", lat, lon, kind: "medium", flight_category: null, military: null })),
  } }));
  await page.goto("/app/plan");
  await settle(page);
  await mapStill(page);
  // Out to the region's zoom, 7: the page opens on the position at 8
  // since the owner's "make the current position zoom level the same as
  // class D airports" (2026-11-04, ownShip's OPEN_ZOOM), where these
  // fields are drawn already.
  await page.evaluate(() => {
    const box = document.querySelector(".maplibregl-map") as unknown as Record<string, unknown>;
    const key = Object.keys(box).find(k => k.startsWith("__reactFiber"))!;
    let map: { setZoom: (z: number, o: object) => void } | null = null;
    const seen = new Set<unknown>();
    const walk = (f: { memoizedProps?: { value?: { map?: { setZoom?: unknown } } }; child?: unknown; sibling?: unknown } | null, depth: number) => {
      if (!f || map || depth > 40 || seen.has(f)) return;
      seen.add(f);
      const value = f.memoizedProps?.value;
      if (value?.map?.setZoom) { map = value.map as typeof map; return; }
      walk(f.child as typeof f, depth + 1);
      walk(f.sibling as typeof f, depth);
    };
    walk(box[key] as Parameters<typeof walk>[0], 0);
    map!.setZoom(7, { animate: false });
  });
  await mapStill(page);
  // The fields' places on the airports' canvas (AirportCanvas), drawn or
  // a target for a tap without a mark of their own.
  const targets = { count: async () => (await airportMarks(page)).length };
  await expect.poll(() => targets.count(), { timeout: slow(5_000) }).toBe(0);
  // Two fingers spreading from 60 to 180 points apart: three times as
  // close, a level and a half in. Each 6 points out at a step, so the
  // second step is past the ruler's 10 (lib/map/ruler's STILL_PX): at 3 a
  // step, on a busy runner the fourth came after the ruler's 400 ms hold,
  // the ruler came up and took the pinch (MapRuler), and the map stayed
  // at 7 (run 41014180625; here, the fourth move at 476 ms).
  const at = await chartMiddle(page);
  const touch = await fingers(page);
  await touch("touchStart", [[at.x - 30, at.y], [at.x + 30, at.y]]);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [[at.x - 30 - i * 6, at.y], [at.x + 30 + i * 6, at.y]]);
    await page.waitForTimeout(30);
  }
  // A pinch, not a ruler.
  await expect(page.getByTestId("map-ruler")).toHaveCount(0);
  // Still held: the fields' targets drawn for
  // the level the pinch is at. They waited for the fingers to lift.
  await expect.poll(() => targets.count(), { timeout: slow(5_000) }).toBeGreaterThan(0);
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
  // Where the map rests: its zoom (GlMapShell's data-zoom, the app's levels).
  const zoom = () => page.getByTestId("gl-map").getAttribute("data-zoom").then(Number);
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
  // Left between levels: the zoom not a whole one.
  await expect.poll(async () => { const z = await zoom(); return Math.abs(z - Math.round(z)); }).toBeGreaterThan(0.01);
});

test("a pinch draws the course line again at its own width as it zooms, not scaled up and settling back", async ({ page }) => {
  // The owner's notice (2026-10-16): "The course line seems to get thicker
  // with the zoom and then settles back". Leaflet's SVG renderer scaled
  // what it had drawn, strokes and all, until the fingers lifted.
  await openOnC81(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect.poll(async () => (await drawn(page, "route-line")).length, { timeout: slow(30_000) }).toBeGreaterThan(0);
  await mapStill(page);
  // How much the map's canvas is scaled by CSS: never, as the WebGL map
  // draws every frame of a pinch itself.
  const scale = () => page.evaluate(() => {
    const t = getComputedStyle(document.querySelector(".maplibregl-canvas")!).transform;
    return t === "none" ? 1 : new DOMMatrixReadOnly(t).a;
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
  await expect.poll(async () => (await drawn(page, "route-line")).length).toBeGreaterThan(0);
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
  // The WebGL map asks for the tiles a pinch bares as it goes: counted
  // from the chart's first draw.
  let asked = 0;
  page.on("request", r => { if (r.url().includes("/api/planner/chart-tile/")) asked += 1; });
  await expect.poll(() => page.getByTestId("gl-map").getAttribute("data-chart-zoom"), { timeout: slow(15_000) }).not.toBeNull();
  await mapStill(page);
  const before = asked;
  // Two fingers near the top, from 180 to 130 points apart: 0.47 of a level
  // out, its foot drawn out past where the tiles reached.
  const map = (await page.locator(".maplibregl-map").boundingBox())!;
  const at = { x: map.x + map.width / 2, y: map.y + 120 };
  const touch = await fingers(page);
  await touch("touchStart", [[at.x - 90, at.y], [at.x + 90, at.y]]);
  for (let i = 1; i <= 25; i++) {
    await touch("touchMove", [[at.x - 90 + i, at.y], [at.x + 90 - i, at.y]]);
    await page.waitForTimeout(30);
  }
  // Still held: the edges it bared asked for already.
  await expect.poll(() => asked, { timeout: slow(5_000) }).toBeGreaterThan(before);
  await touch("touchEnd", []);
});
