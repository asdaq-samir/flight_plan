import { test, expect } from "@playwright/test";
import { airportMark, beforeTheRoute, openPanel, settle, sideDrawer, slow, tapTheChart, grabberTo, controlsInSight, openNavLog, navLogSheet } from "./helpers";

/**
 * The map: its popups, its zoom toggle and the dev page's zoom button,
 * own ship when the map is panned, and a route with no map to draw.
 */

test("plan page: a route from an airport to itself is a local flight: the field's briefing, and the time aloft with its fuel check", async ({ page }) => {
  // The pattern, practice approaches: it was refused, the page asking for
  // two different airports.
  await page.goto("/app/plan?dep=C81&dest=C81");
  await grabberTo(page, "full");
  await expect(sideDrawer(page).getByTestId("navlog-ete")).toHaveText("1h 00m", { timeout: slow(30000) });
  await expect(sideDrawer(page).locator('[data-slot="section-summary"] dt').nth(1)).toHaveText("Aloft");
  // Its fuel required among the figures.
  await expect(page.getByTestId("navlog-fuel")).toHaveText(/^\d+\.\d gal$/, { timeout: slow(30000) });

  // Longer aloft: its chip in the pill, in the address, and more fuel.
  await controlsInSight(page);
  await page.getByTestId("local-duration").click();
  await page.getByRole("option", { name: "2 h", exact: true }).click();
  await expect(page).toHaveURL(/[?&]local_min=120/);
  await expect(sideDrawer(page).getByTestId("navlog-ete")).toHaveText("2h 00m", { timeout: slow(30000) });
});

test("plan page: every popup the map opens dismisses the same way", async ({ page }) => {
  // They did not. The airport and checkpoint popups took Leaflet's
  // defaults; the Class B card set autoClose and closeOnClick off, so
  // on the same map the same gesture -- a tap on the chart -- dismissed
  // one and left the other sitting there, over the markers underneath
  // it, swallowing their clicks. `MapPopup` gives all of them one
  // dismissal, and this is the test that says so.
  // Class B on from the start, from the search bar's settings.
  await beforeTheRoute(page, () => page.getByTestId("class-b-toggle").click());
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator("img.leaflet-tile").first()).toBeAttached();
  const popups = page.locator(".leaflet-popup");
  // A tap on the chart itself, where nothing is drawn: a fixed corner
  // had a Class B chip under it once the pin had flown the map to KORD.

  // The departure marker: a tap opens its card in the panel, as every
  // airport on the chart does -- it was a weather card over the chart --
  // and a tap on the chart puts it away. The card brings the map in to
  // the field, so the wheel takes it back out before KORD can be found.
  await page.locator(".leaflet-marker-icon", { hasText: "C81" }).first().click();
  await expect(page.getByTestId("place-card")).toBeVisible({ timeout: slow(15000) });
  await expect(popups).toHaveCount(0);
  await tapTheChart(page);
  await expect(page.getByTestId("place-card")).toHaveCount(0);
  const map = (await page.locator(".leaflet-container").boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 3);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
  }

  const chip = page.locator(".leaflet-marker-icon").filter({ has: page.locator('[data-airspace="B"]'), hasText: "KORD" }).first();
  await expect(chip).toBeVisible({ timeout: slow(25000) });
  // A Class B chip opens the field's card in the panel, as every
  // airport on the chart does, not a popup of its own on the map.
  await chip.click();
  await expect(page.getByTestId("place-card")).toBeVisible({ timeout: slow(15000) });
  await expect(popups).toHaveCount(0);

  // A tap on the chart puts it away, as it does every card.
  await tapTheChart(page);
  await expect(page.getByTestId("place-card")).toHaveCount(0);
});

test("plan page: a checkpoint picked on the map brings the map in to it, so there is no zoom button", async ({ page }) => {
  // The map's buttons had a zoom toggle between the whole route and the
  // selected point; picking a point already does the one, and the wheel
  // or a pinch the other.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator("[data-map-controls]")).toBeVisible();
  await expect(page.locator("[data-map-controls]").getByRole("button", { name: /zoom|fit route|show selected/i })).toHaveCount(0);
  const zoomOfTiles = () => page.evaluate(() => Math.max(...[...document.querySelectorAll<HTMLImageElement>("img.leaflet-tile")]
    .map(img => Number(new URL(img.src).pathname.split("/").at(-3))).filter(Number.isFinite)));
  const before = await zoomOfTiles();
  // A checkpoint drawn at this zoom: those without room for their dots
  // wait for the map to come in (RouteMap's useSpaced).
  const marker = page.locator(".leaflet-marker-icon", { hasText: /^\d+$/ }).first();
  await expect(marker).toBeVisible({ timeout: slow(60000) });
  // Its own click, not one at its place: the route fitted to a phone
  // stacks neighbouring checkpoints, and a click there lands on the one
  // drawn over it.
  await marker.dispatchEvent("click");
  await expect.poll(zoomOfTiles, { timeout: slow(10000) }).toBeGreaterThan(before);
  await expect(page.locator(".leaflet-overlay-pane path")).not.toHaveCount(0);
});

test("plan page: panning the map with own ship off leaves 'Keep the map on me' as it was", async ({ page }) => {
  // `follow` is remembered per browser. A pan at the desk -- own ship
  // off, and over plain http it cannot even be turned on -- used to
  // store it off, so in the air the map no longer kept up and the
  // checkbox that says so was disabled.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const follow = () => page.evaluate(() => JSON.parse(localStorage.getItem("vfr.ownship") ?? "{}").state?.follow ?? true);
  expect(await follow()).toBe(true);

  const map = await page.locator(".leaflet-container").boundingBox();
  if (!map) throw new Error("no map");
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.down();
  await page.mouse.move(map.x + map.width / 2 + 120, map.y + map.height / 2 + 60, { steps: 8 });
  await page.mouse.up();

  expect(await follow()).toBe(true);
});

test("plan page: VFR Checkpoints draws the route's checkpoints and the landmarks they were chosen from at every zoom, and off leaves the course line alone", async ({ page }) => {
  // They used to start at a zoom picked from a menu (close in, by
  // default), so a route zoomed out to its region showed a line and two
  // airports; the landmarks, from zoom 7.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const numbered = page.locator(".leaflet-marker-icon", { hasText: /^\d+$/ });
  await expect(numbered.first()).toBeVisible({ timeout: slow(60000) });

  // Out to the zoom a whole region fits at: the tiles say which.
  const zoomOfTiles = () => page.evaluate(() => Math.min(...[...document.querySelectorAll<HTMLImageElement>("img.leaflet-tile")]
    .map(img => Number(new URL(img.src).pathname.split("/").at(-3))).filter(Number.isFinite)));
  const map = (await page.locator(".leaflet-container").boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
  }
  await expect.poll(zoomOfTiles, { timeout: slow(10000) }).toBeLessThanOrEqual(5);
  await expect(numbered.first()).toBeVisible();
  // The landmarks' dim dots, in their slate outline.
  const landmarks = page.locator('path.leaflet-interactive[stroke="#5b6b76"]');
  await expect(landmarks.first()).toBeAttached();

  // Off, from the search bar's settings, and the route again: no
  // checkpoints on the map, none asked for, and the nav log from the
  // departure to the destination alone, as the pilot asked.
  await beforeTheRoute(page, async () => {
    const toggle = page.getByTestId("waypoints-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
  });
  const asked: string[] = [];
  page.on("request", r => { if (/\/(checkpoints|navlog)\?/.test(r.url())) asked.push(new URL(r.url()).pathname.split("/").pop()!); });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator(".leaflet-marker-icon", { hasText: "KDLH" }).first()).toBeVisible({ timeout: slow(30000) });
  await expect(numbered).toHaveCount(0);
  await expect(landmarks).toHaveCount(0);
  await openPanel(page);
  await expect(page.getByTestId("navlog-fuel")).toBeAttached({ timeout: slow(60000) });
  await openNavLog(page);
  const rows = navLogSheet(page).locator('[role="row"][data-kind]');
  await expect(navLogSheet(page).locator('[role="row"][data-kind="checkpoint"]')).toHaveCount(0);
  expect(await rows.count()).toBeGreaterThan(0);
  expect(asked).not.toContain("checkpoints");
});

test("my position is the location arrow among the map's buttons, on both pages, and over plain http it says why there is none", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const arrow = page.locator("[data-map-controls]").getByTestId("my-position-button");
  await expect(arrow).toHaveAccessibleName("Show my position");
  await expect(arrow).toHaveAttribute("aria-pressed", "false");
  if (!(await page.evaluate(() => window.isSecureContext))) {
    await arrow.click();
    // An alert, with OK: something the pilot just did.
    const alert = page.getByTestId("error-alert");
    await expect(alert).toContainText("No position over this connection");
    await alert.getByRole("button", { name: "OK" }).click();
    await expect(alert).toHaveCount(0);
    await expect(arrow).toHaveAttribute("aria-pressed", "false");
  }
  // The training page's as well: its map is the same (MapShell).
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator("[data-map-controls]").getByTestId("my-position-button")).toBeVisible();
});

test("the chart's airports keep coming in under a finger's pan, before it lets go", async ({ page }) => {
  // The owner's ask: "can you update the map even while panning ... until
  // I let go of the finger, the airports don't show up".
  // The map opening where the pilot last was, at the region's zoom.
  await page.addInitScript(() => localStorage.setItem("vfr.ownship",
    JSON.stringify({ state: { enabled: false, follow: true, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 })));
  // One reporting field in the middle of each box the planner is asked
  // for, named for the question: X1 for the first, X2 for the next.
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/airports/in-view"), route => {
    const q = new URL(route.request().url()).searchParams;
    const [south, west, north, east] = ["south", "west", "north", "east"].map(k => Number(q.get(k)));
    asked.push(`${south},${west},${north},${east}`);
    return route.fulfill({ json: { airports: [{
      ident: `X${asked.length}`, name: "Asked for", lat: (south + north) / 2, lon: (west + east) / 2,
      kind: "small", longest_runway_ft: 3500, flight_category: "VFR", military: null,
    }] } });
  });
  await page.goto("/app/plan");
  await settle(page);
  // On the airports' canvas (AirportCanvas) with its mark, as a marker
  // was in the page wherever it was.
  const drawn = async (ident: string) => !!(await airportMark(page, ident))?.chip;
  await expect.poll(() => drawn("X1"), { timeout: slow(15_000) }).toBe(true);
  const first = asked.length;
  // A pan of a screen and a half to the east, the finger still down: past
  // the box asked for (the view and a screen round it).
  const viewport = page.viewportSize()!;
  const y = viewport.width < 768 ? 160 : viewport.height / 3;
  // Clear of the map's buttons down the right edge: the food button is
  // there with no route too since 2026-10-25, and took the press.
  const from = viewport.width - 90;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(from - (viewport.width * 1.6 * i) / 30, y);
    await page.waitForTimeout(40);
  }
  // Still held: asked again, and the new field's mark drawn.
  await expect.poll(() => asked.length, { timeout: slow(10_000) }).toBeGreaterThan(first);
  await expect.poll(() => drawn(`X${asked.length}`)).toBe(true);
  await page.mouse.up();
});
