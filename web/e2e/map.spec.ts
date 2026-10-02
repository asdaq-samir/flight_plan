import { test, expect } from "@playwright/test";
import { slow, settle, openSettings, tapTheChart } from "./helpers";

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
  await page.getByPlaceholder("Ident or airport name").fill("KDLH");
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
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator("img.leaflet-tile").first()).toBeAttached();
  const popups = page.locator(".leaflet-popup");
  // A tap on the chart itself, where nothing is drawn: a fixed corner
  // had a Class B chip under it once the pin had flown the map to KORD.

  // The departure marker: a tap opens its card, a tap on the chart puts
  // it away. There is no close button on a card -- closing one is
  // Leaflet's own `closeOnClick`. The tap goes to the marker, so the
  // map's zoom toggle comes back out to the whole route, which is what
  // the next step needs before it can find KORD.
  await page.locator(".leaflet-marker-icon", { hasText: "C81" }).first().click();
  await expect(popups).toHaveCount(1);
  await tapTheChart(page);
  await expect(popups).toHaveCount(0);
  const zoomToggle = page.getByTestId("map-action-button");
  await expect(zoomToggle).toHaveAttribute("aria-label", "Fit Route", { timeout: slow(10000) });
  await zoomToggle.click();
  await expect(zoomToggle).toHaveAttribute("aria-label", "Show Selected", { timeout: slow(10000) });

  await openSettings(page);
  await page.getByTestId("class-b-toggle").click();
  await page.keyboard.press("Escape");
  const chip = page.locator(".leaflet-marker-icon span.rounded-full").filter({ hasText: "KORD" }).first();
  await expect(chip).toBeVisible({ timeout: slow(25000) });
  await chip.click();
  await expect(popups).toHaveCount(1);

  // Its own pin does not dismiss it: a click inside a popup never
  // reaches the map, so Leaflet's closeOnClick cannot fire from there.
  await page.getByTestId("class-b-pin").click();
  await page.waitForTimeout(1500);   // the pin flies the map to the field
  await expect(popups).toHaveCount(1);

  // A tap on the chart does, exactly as it does for every other popup.
  await tapTheChart(page);
  await expect(popups).toHaveCount(0);
});

test("plan page: the map's zoom toggle goes to the selection and back, however many times", async ({ page }) => {
  // It is one button with two jobs, and which job it is offering has to
  // follow the map's real zoom -- including a zoom the button itself
  // caused. Two faults lived here, both invisible to a placement test:
  // the zoom the button caused was never reported (react-leaflet
  // re-registers an event handler passed as an object literal on every
  // commit, and the zoom fired inside that commit from FocusOn's own
  // effect), so the button offered "Show Selected" for ever; and
  // pressing it with that same point already selected moved nothing,
  // because the map only re-centres when the point it is given changes.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const button = page.getByTestId("map-action-button");
  await expect.poll(() => button.isDisabled(), { timeout: slow(20000) }).toBe(false);
  await expect(button).toHaveAttribute("aria-label", "Show Selected");

  // In: the map is now closer than the whole route needs, so the button
  // offers the way back, and the selection ring is drawn.
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Fit Route", { timeout: slow(10000) });
  await expect(page.locator(".leaflet-overlay-pane path")).not.toHaveCount(0);

  // Out, and in again -- the second press is the one that used to do
  // nothing at all, the point being already selected.
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Show Selected", { timeout: slow(10000) });
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Fit Route", { timeout: slow(10000) });
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Show Selected", { timeout: slow(10000) });
});

test("dev page: the map's zoom button follows the map's real zoom, as the planner's does", async ({ page }) => {
  // It used to decide from a fixed zoom 12 of its own, so a scroll-wheel
  // step in from the whole route still offered to show the selection.
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  const button = page.getByTestId("map-action-button");
  await expect.poll(() => button.isDisabled(), { timeout: slow(60000) }).toBe(false);
  await expect(button).toHaveAttribute("aria-label", "Show Selected");

  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Fit Route", { timeout: slow(10000) });
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Show Selected", { timeout: slow(10000) });

  // One wheel step in from the whole route: closer than the route needs.
  const map = await page.locator(".leaflet-container").boundingBox();
  if (!map) throw new Error("no map");
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(button).toHaveAttribute("aria-label", "Fit Route", { timeout: slow(10000) });
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

test("plan page: Show checkpoints draws the route's checkpoints at every zoom, and off leaves the course line alone", async ({ page }) => {
  // They used to start at a zoom picked from a menu (close in, by
  // default), so a route zoomed out to its region showed a line and two
  // airports.
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

  await openSettings(page);
  const toggle = page.getByTestId("checkpoints-toggle");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(numbered).toHaveCount(0);
});

test("plan page: my position is the location arrow among the map's buttons, and over plain http it says why there is none", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const arrow = page.locator("[data-map-controls]").getByTestId("my-position-button");
  await expect(arrow).toHaveAccessibleName("Show my position");
  await expect(arrow).toHaveAttribute("aria-pressed", "false");
  if (!(await page.evaluate(() => window.isSecureContext))) {
    await arrow.click();
    await expect(page.locator("[data-sonner-toast]", { hasText: "No position over this connection" })).toBeVisible();
    await expect(arrow).toHaveAttribute("aria-pressed", "false");
  }
  // Not the training page's: its map draws no own ship.
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator("[data-map-controls]")).toBeVisible();
  await expect(page.getByTestId("my-position-button")).toHaveCount(0);
});
