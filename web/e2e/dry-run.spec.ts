import { test, expect } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

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
