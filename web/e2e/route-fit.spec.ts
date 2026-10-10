import { test, expect, type Locator, type Page } from "@playwright/test";
import { closeSidebarWithTheStockKey, expectDrawerClosed, openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * The map and the sheet move together, as in Maps: opened fresh, the map
 * is on the pilot's position in the middle of what the half sheet leaves,
 * and kept there as the sheet goes down and up; a route entered is flown
 * to and fitted above the sheet; lowered to its capsule, the route is
 * fitted again to the whole screen, and raised, above the sheet again --
 * from wherever the map had got to, while any of it is in sight. With
 * neither the route nor the position in sight, the map stays put.
 */

// Geolocation is a secure origin's only: the suite's address must be one
// (CI's is localhost; from the test container, the local stack is reached
// on a localhost port forwarded to it).
const origin = new URL(process.env.BASE_URL ?? "http://localhost:8080").origin;

/** The course line's core, on screen. */
const courseBox = async (page: Page) => (await page.locator('path[stroke="#ff3b00"]').first().boundingBox())!;

/** Nothing of `a` under `b`. */
const apart = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;

/** The route clear of the panel, and filling much of what the panel
 *  leaves of the map: fitted there, not just somewhere out from under it. */
async function fittedClearOf(page: Page, panel: Locator) {
  const viewport = page.viewportSize()!;
  await expect(async () => {
    const line = await courseBox(page);
    const sheet = (await panel.boundingBox())!;
    expect(apart(line, sheet), `route ${JSON.stringify(line)} under the panel ${JSON.stringify(sheet)}`).toBe(true);
    expect(line.y).toBeGreaterThanOrEqual(0);
    expect(line.y + line.height).toBeLessThanOrEqual(viewport.height);
    // What the panel leaves: above a phone's sheet; beside a desktop's
    // card out, under it at rest.
    const out = (await panel.getAttribute("data-panel")) !== "peek";
    const free = viewport.width < 768
      ? { w: viewport.width, h: viewport.height - sheet.height }
      : out ? { w: viewport.width - sheet.x - sheet.width, h: viewport.height } : { w: viewport.width, h: viewport.height - sheet.y - sheet.height };
    expect(Math.max(line.width / free.w, line.height / free.h)).toBeGreaterThan(0.4);
  }).toPass({ timeout: slow(10_000) });
  return courseBox(page);
}

/** Own ship's marker, on screen. */
const shipAt = async (page: Page) => {
  const box = (await page.locator(".leaflet-marker-icon").filter({ has: page.locator("[data-own-ship]") }).last().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** The middle of what the panel leaves of the map: above a phone's
 *  sheet, beside a desktop's card out, under it at rest. */
async function middleOfMap(page: Page) {
  const viewport = page.viewportSize()!;
  const sheet = (await sideDrawer(page).boundingBox())!;
  if (viewport.width < 768) return { x: viewport.width / 2, y: sheet.y / 2 };
  return (await sideDrawer(page).getAttribute("data-panel")) !== "peek"
    ? { x: (sheet.x + sheet.width + viewport.width) / 2, y: viewport.height / 2 }
    : { x: viewport.width / 2, y: (sheet.y + sheet.height + viewport.height) / 2 };
}

/** Own ship in the middle of what the panel leaves, give or take the
 *  marker's own size. */
async function shipInTheMiddle(page: Page) {
  await expect(async () => {
    const at = await shipAt(page), middle = await middleOfMap(page);
    expect(Math.abs(at.x - middle.x)).toBeLessThan(40);
    expect(Math.abs(at.y - middle.y)).toBeLessThan(40);
  }).toPass({ timeout: slow(15_000) });
}

/** Where the map is: its pane's offset, which moves when the map does and
 *  only then. */
const mapAt = (page: Page) => page.locator(".leaflet-map-pane").evaluate(el => (el as HTMLElement).style.transform);

/** A drag on the chart, from a point clear of the panel and the map's
 *  buttons, by `dx`, `dy`. */
async function drag(page: Page, dx: number, dy: number) {
  const viewport = page.viewportSize()!;
  const from = { x: viewport.width / 2, y: viewport.width < 768 ? 150 : viewport.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  // Until the map has stopped: Leaflet carries a drag on a little.
  let was = "";
  await expect(async () => {
    const now = await mapAt(page);
    const still = now === was;
    was = now;
    await page.waitForTimeout(250);
    expect(still).toBe(true);
  }).toPass({ timeout: 5_000 });
}

test("opened fresh, the map is on the pilot's position in the middle of what the half sheet leaves, kept there as the sheet goes down, and left alone once panned off it", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ latitude: 42.3247, longitude: -88.0742 });
  await page.goto("/app/plan");
  await settle(page);
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  await expect(page.getByTestId("my-position-button")).toHaveAttribute("aria-pressed", "true");
  await shipInTheMiddle(page);
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await shipInTheMiddle(page);

  // Panned until the position is off the screen: the sheet raised, the
  // map stays where the pilot put it.
  const viewport = page.viewportSize()!;
  for (let i = 0; i < 3; i++) await drag(page, -viewport.width * 0.45, -60);
  const before = await mapAt(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(sideDrawer(page)).not.toHaveAttribute("data-panel", "peek");
  await page.waitForTimeout(900);
  expect(await mapAt(page)).toBe(before);

  // Turned off from the location arrow: the dot stays at its last place,
  // grey, as Maps' does.
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  const arrow = page.locator("[data-map-controls]").getByTestId("my-position-button");
  await arrow.click();
  await expect(arrow).toHaveAccessibleName("Hide my position");
  await expect(page.locator('[data-own-ship="on"]')).toBeVisible();
  await arrow.click();
  await expect(arrow).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-own-ship="off"]')).toBeVisible();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(0);
});

test("opened fresh with no position to have, the map stays on the country and nothing complains", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.getByTestId("my-position-button")).toHaveAttribute("aria-pressed", "false", { timeout: slow(10_000) });
  await expect(page.getByTestId("error-alert")).toHaveCount(0);
});

test("a route entered is fitted above the half sheet, to the whole screen at the capsule, and above the sheet again", async ({ page }) => {
  // Home from a link, so Fly Here has somewhere to fly from.
  await page.goto("/app/plan?home=C81");
  await expect(page).not.toHaveURL(/[?&]home=/, { timeout: slow(10_000) });
  const search = page.getByTestId("search-airports");
  await search.click();
  await search.fill("KDLH");
  await page.getByTestId("search-result").filter({ hasText: "KDLH" }).first().click();
  await page.getByTestId("place-card").getByTestId("fly-here").click();
  await expect(page).toHaveURL(/dep=C81.*dest=KDLH|dest=KDLH.*dep=C81/);
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  const half = await fittedClearOf(page, sideDrawer(page));

  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await fittedClearOf(page, sideDrawer(page));
  // No smaller on a phone, once it has got there -- clear of the capsule
  // it already was. It was bigger by a sixth: the half sheet then covered
  // half the screen, and now a phone's ends at the flight's line (exact
  // half), where a route like this one is as wide as the screen either
  // way and its width, not the sheet, sets its size.
  if (page.viewportSize()!.width < 768) {
    await expect.poll(async () => (await courseBox(page)).height, { timeout: slow(10_000) }).toBeGreaterThanOrEqual(half.height - 1);
  }

  await openPanel(page);
  await fittedClearOf(page, sideDrawer(page));
});

test("a route the pilot has moved is fitted again as the sheet goes up and down while any of it is in sight, and left alone once it is not", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await fittedClearOf(page, sideDrawer(page));
  // Moved, the route part off the screen: fitted again.
  await drag(page, 120, 80);
  await openPanel(page);
  await fittedClearOf(page, sideDrawer(page));

  // Panned right off it: left alone.
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await fittedClearOf(page, sideDrawer(page));
  const viewport = page.viewportSize()!;
  for (let i = 0; i < 4; i++) await drag(page, Math.min(300, viewport.width * 0.7), 0);
  const before = await mapAt(page);
  await openPanel(page);
  await page.waitForTimeout(900);
  expect(await mapAt(page)).toBe(before);
});

test("an airport's card keeps its field in sight: the next position the GPS gives does not take the map back to own ship", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ latitude: 42.3247, longitude: -88.0742 });
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.getByTestId("my-position-button")).toHaveAttribute("aria-pressed", "true");
  await shipInTheMiddle(page);

  // A field far from the position, from the search: the map goes to it.
  const search = page.getByTestId("search-airports");
  await search.click();
  await search.fill("KDLH");
  await page.getByTestId("search-result").filter({ hasText: "KDLH" }).first().click();
  await expect(sideDrawer(page).getByTestId("place-card")).toBeVisible();
  const field = page.locator(".leaflet-marker-icon", { hasText: /^KDLH$/ }).first();
  await expect(field).toBeInViewport({ timeout: slow(10_000) });

  // The GPS moves on: the map stays on the field, as Maps' does once a
  // place is picked, until the location arrow is tapped.
  await context.setGeolocation({ latitude: 42.33, longitude: -88.08 });
  await page.waitForTimeout(2000);
  await expect(field).toBeInViewport();
});
