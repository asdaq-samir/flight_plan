import { test, expect } from "@playwright/test";
import { slow, settle, tapTheChart, beforeTheRoute } from "./helpers";

/**
 * The map: its popups, its zoom toggle and the dev page's zoom button,
 * own ship when the map is panned, and a route with no map to draw.
 */

test("plan page: a route from an airport to itself says so, rather than showing nothing at all", async ({ page }) => {
  // The form refuses to submit one, but the address can hold one: a
  // pasted link, an edited URL. Nothing is fetched for it, so the page
  // used to sit blank -- no chart, no message, nothing to press.
  await page.goto("/app/plan?dep=C81&dest=C81");
  await settle(page);
  await expect(page.getByText("A route needs two different airports.")).toBeVisible();
  await expect(page.getByText("C81 is both the departure and the destination.")).toBeVisible();

  // And it is a state the pilot can leave: change one and the route loads.
  await page.getByLabel("Destination", { exact: true }).click();
  await page.getByPlaceholder("Search for a destination").fill("KDLH");
  await page.getByRole("option", { name: /KDLH/ }).first().click();
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByText("A route needs two different airports.")).toBeHidden({ timeout: slow(25000) });
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

  // The departure marker: a tap opens its card, a tap on the chart puts
  // it away. There is no close button on a card -- closing one is
  // Leaflet's own `closeOnClick`. The tap goes to the marker and brings
  // the map in to it, so the wheel takes it back out before KORD can be
  // found.
  await page.locator(".leaflet-marker-icon", { hasText: "C81" }).first().click();
  await expect(popups).toHaveCount(1);
  await tapTheChart(page);
  await expect(popups).toHaveCount(0);
  const map = (await page.locator(".leaflet-container").boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 3);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
  }

  const chip = page.locator(".leaflet-marker-icon span.rounded-full").filter({ hasText: "KORD" }).first();
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
  const marker = page.locator(".leaflet-marker-icon", { hasText: /^9$/ }).first();
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

test("plan page: Waypoints draws the route's checkpoints and the landmarks they were chosen from at every zoom, and off leaves the course line alone", async ({ page }) => {
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

  // Off, from the search bar's settings, and the route again.
  await beforeTheRoute(page, async () => {
    const toggle = page.getByTestId("waypoints-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator(".leaflet-marker-icon", { hasText: "KDLH" }).first()).toBeVisible({ timeout: slow(30000) });
  await expect(numbered).toHaveCount(0);
  await expect(landmarks).toHaveCount(0);
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
