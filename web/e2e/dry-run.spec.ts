import { test, expect, type Page } from "@playwright/test";
import { grabberTo, openPanel, settle, settled, sideDrawer, slow } from "./helpers";

/**
 * The planned flight's dry run flies own ship, as if a pilot were flying
 * the route (lib/map/ownShip's simulateFix): the location arrow on, own
 * ship moving along the course with the plan's heading, and put back as
 * the pilot had it -- here off, no GPS asked -- when the run is closed;
 * nothing of it kept as where the pilot has flown (ownTrail).
 */
test("the dry run flies own ship along the route, and gives it back as it was", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await expect(page.locator("[data-own-ship]")).toHaveCount(0);

  await start.click();
  const ship = page.locator('[data-own-ship="on"]');
  await expect(ship).toHaveCount(1);
  await expect(page.locator("[data-map-controls]").getByTestId("my-position-button")).toHaveAttribute("aria-pressed", "true");
  // Moving: its place on the chart changes as the run plays (with the
  // map following it, the marker itself may stay put, so the map pane's too).
  const where = () => page.evaluate(() => {
    const icon = document.querySelector('[data-own-ship="on"]')!.closest(".leaflet-marker-icon") as HTMLElement;
    const pane = document.querySelector(".leaflet-map-pane") as HTMLElement;
    return `${icon.style.transform} ${pane.style.transform}`;
  });
  const first = await where();
  await expect.poll(where, { timeout: slow(10_000) }).not.toBe(first);

  await sideDrawer(page).getByTestId("dry-run-close").click();
  await expect(page.locator("[data-own-ship]")).toHaveCount(0);
  const kept = await page.evaluate(() => ({ ship: localStorage.getItem("vfr.ownship"), trail: localStorage.getItem("vfr.owntrail") }));
  expect(JSON.parse(kept.ship ?? "{}").state?.enabled ?? false).toBe(false);
  expect(kept.trail).toBeNull();
});

test("the dry run's chart draws the airspace the course passes through, named as the side view names it", async ({ page }) => {
  // The owner's ask: "Also draw the airspace on the dry run as well". Out
  // of C81, under Chicago's Class B, to Madison's Class C.
  await page.goto("/app/plan?dep=C81&dest=KMSN");
  await settle(page);
  await openPanel(page);
  const side = sideDrawer(page).getByTestId("mini-profile-airspace");
  await expect(side.first()).toBeVisible({ timeout: slow(60_000) });
  const names = (await side.allTextContents()).map(t => t.trim()).sort();
  expect(names.some(n => n.startsWith("KMSN "))).toBe(true);

  await sideDrawer(page).getByTestId("dry-run-start").click();
  const run = sideDrawer(page).getByTestId("dry-run");
  // Each piece drawn, and each name once, as the side view had them (the
  // chart's only labels: recharts draws them in a layer of their own).
  await expect.poll(() => run.locator(".recharts-reference-area").count(), { timeout: slow(10_000) }).toBeGreaterThanOrEqual(names.length);
  const drawn = async () => (await run.locator(".recharts-label").allTextContents()).map(t => t.trim()).sort();
  await expect.poll(drawn).toEqual(names);
  // Inside the chart, its ends' names too.
  const chart = (await run.locator(".recharts-surface").boundingBox())!;
  for (const box of await run.locator(".recharts-label").evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right };
  }))) {
    expect(box.left).toBeGreaterThanOrEqual(chart.x - 1);
    expect(box.right).toBeLessThanOrEqual(chart.x + chart.width + 1);
  }
});

/** Own ship's marker, on screen. */
async function shipAt(page: Page) {
  const box = (await page.locator(".leaflet-marker-icon").filter({ has: page.locator('[data-own-ship="on"]') }).last().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The middle of what the panel leaves of the map: above a phone's sheet,
 *  beside a desktop's card out, under it at rest. */
async function middleOfMap(page: Page) {
  const viewport = page.viewportSize()!;
  const sheet = (await sideDrawer(page).boundingBox())!;
  if (viewport.width < 768) return { x: viewport.width / 2, y: sheet.y / 2 };
  return (await sideDrawer(page).getAttribute("data-panel")) !== "peek"
    ? { x: (sheet.x + sheet.width + viewport.width) / 2, y: viewport.height / 2 }
    : { x: viewport.width / 2, y: (sheet.y + sheet.height + viewport.height) / 2 };
}

test("the dry run's airplane is brought back to the middle of what the panel leaves as the sheet goes down and up, after a pan too", async ({ page }) => {
  // The owner's notice: "during dry run map should adjust as well to the
  // pill and half card".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await start.click();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
  // Panned by hand, off the middle: the map no longer follows it.
  const viewport = page.viewportSize()!;
  const from = { x: viewport.width < 768 ? viewport.width / 2 : viewport.width * 0.75, y: 150 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 90, from.y - 60, { steps: 8 });
  await page.mouse.up();
  const inTheMiddle = async () => {
    await settled(sideDrawer(page));
    await expect(async () => {
      const at = await shipAt(page), middle = await middleOfMap(page);
      expect(Math.abs(at.x - middle.x)).toBeLessThan(40);
      expect(Math.abs(at.y - middle.y)).toBeLessThan(40);
    }).toPass({ timeout: slow(10_000) });
  };
  await grabberTo(page, "peek");
  await inTheMiddle();
  await grabberTo(page, "half");
  await inTheMiddle();
});
