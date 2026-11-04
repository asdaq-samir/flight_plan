import { test, expect, type Page } from "@playwright/test";
import { closeProfile, grabberTo, openPanel, openProfile, settle, sideDrawer, slow } from "./helpers";

/**
 * Flying mode (useFlyingMode), the canvas's Flying screen: once own ship
 * is underway with a route -- here the planned flight's dry run, which
 * flies own ship (lib/map/ownShip's simulateFix) -- the next checkpoint is
 * over the map (FlyingHead), the map's buttons are 60 points with words
 * (MapControls), and the route's box and the tab bar are put away
 * (MapPanel's `flying`); the dry run closed, own ship is off and the
 * planner is back as it was. Done flying leaves it with one tap.
 */

const FLYING_PX = 60;

async function startDryRun(page: Page) {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await openProfile(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await start.click();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
}

test("in flight the next checkpoint is over the map, the buttons are 60 points and the route box and tabs are away; closed, they return", async ({ page }) => {
  await startDryRun(page);
  // The next checkpoint's card at the top; a dry run keeps the sheet where
  // it was, its card's controls in sight (a real flight's goes to the pill).
  const head = page.getByTestId("flying-head");
  await expect(head).toBeVisible({ timeout: slow(10_000) });
  await expect(head.getByTestId("flying-next-name")).not.toBeEmpty();
  await expect(head.getByTestId("flying-next-figures")).toContainText("nm");
  await expect(sideDrawer(page)).not.toHaveAttribute("data-panel", "peek");
  await expect(sideDrawer(page).getByTestId("dry-run-close")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("route-box")).toBeHidden();
  await expect(sideDrawer(page).getByTestId("tab-fpl")).toBeHidden();
  await expect(page.getByTestId("done-flying")).toBeVisible();
  // The map's buttons: NRST, D→ and the location arrow at the right, the
  // microphone at the left, each 60 points.
  const buttons = [
    page.getByTestId("flying-nearest"), page.getByTestId("flying-direct"), page.locator("[data-map-controls]").getByTestId("my-position-button"),
    page.locator("[data-map-food]").getByTestId("radio-button"),
  ];
  for (const button of buttons) {
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(Math.round(box.width)).toBe(FLYING_PX);
    expect(Math.round(box.height)).toBe(FLYING_PX);
  }
  await expect(page.getByTestId("map-settings-button")).toHaveCount(0);

  // The dry run closed from the Profile: on the ground at once, everything
  // back -- the small buttons, and at half the route's box and the tabs.
  await grabberTo(page, "half");
  await sideDrawer(page).getByTestId("dry-run-close").click();
  await expect(page.locator("[data-own-ship]")).toHaveCount(0);
  await expect(head).toHaveCount(0);
  await expect(page.getByTestId("flying-nearest")).toHaveCount(0);
  await expect(page.getByTestId("map-settings-button")).toBeVisible();
  const mic = (await page.locator("[data-map-food]").getByTestId("radio-button").boundingBox())!;
  expect(Math.round(mic.width)).toBeLessThan(FLYING_PX);
  await closeProfile(page);
  await grabberTo(page, "half");
  await expect(sideDrawer(page).getByTestId("route-box")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("tab-fpl")).toBeVisible();
});

test("Done flying leaves flying mode with one tap while the airplane flies on", async ({ page }) => {
  await startDryRun(page);
  await expect(page.getByTestId("flying-head")).toBeVisible({ timeout: slow(10_000) });
  await page.getByTestId("done-flying").click();
  await expect(page.getByTestId("flying-head")).toHaveCount(0);
  await expect(page.getByTestId("flying-nearest")).toHaveCount(0);
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
});
