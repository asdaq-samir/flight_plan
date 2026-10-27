import { test, expect } from "@playwright/test";
import { consolePage, controlsInSight, openSetup, settle, slow } from "./helpers";

/**
 * The first-run tips (lib/tips, TipHost): one at a time beside the
 * control it is about, once in sight, each said once on this device, and
 * offered again from Settings. The suite's session has them all seen;
 * this spec starts with none seen, once, so a reload keeps what it saw.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("tips-fresh")) return;
    localStorage.removeItem("vfr.tips");
    sessionStorage.setItem("tips-fresh", "1");
  });
});

test("a new pilot is shown what to look for, a tip at a time, each once", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await controlsInSight(page);
  const tip = page.getByTestId("tip");

  // The route's box first; then the flight's line and the altitude, which
  // all the way up are in sight together, one and then the other.
  await expect(tip).toContainText("Your route", { timeout: slow(15000) });
  await expect(tip).toHaveCount(1);
  await page.getByTestId("tip-close").click();
  await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/\d,\d{3} feet|FL\d{3}/, { timeout: slow(60000) });
  await expect(tip).toHaveAttribute("aria-label", /The quick numbers|Why this altitude/, { timeout: slow(15000) });
  const quickFirst = await tip.getAttribute("aria-label") === "The quick numbers";
  if (quickFirst) {
    await page.getByTestId("tip-close").click();
    await expect(tip).toContainText("Why this altitude", { timeout: slow(15000) });
  }
  // Put away by a tap elsewhere, as by its close: the pilot moved on --
  // here on the route's figures, the sheet all the way up over the chart.
  await page.locator('[data-tip="flight-line"]').last().click();
  await expect(tip.filter({ hasText: "Why this altitude" })).toHaveCount(0);
  // The figures' own, where it was not first: offered once they are in
  // sight (on a desktop's column the next tip can come before it).
  if (!quickFirst && await tip.filter({ hasText: "The quick numbers" }).isVisible()) await page.getByTestId("tip-close").click();

  // Seen, not offered again on this device.
  await page.reload();
  await settle(page);
  await controlsInSight(page);
  await page.waitForTimeout(2500);
  await expect(tip.filter({ hasText: /Your route|The quick numbers|Why this altitude/ })).toHaveCount(0);

  // The Guide offers them again from the start, at its top (the owner's
  // "Tips can move to guide").
  await page.goto("/app/plan");
  await openSetup(page);
  await consolePage(page.getByTestId("console-sheet"), "Guide");
  await page.getByTestId("tips-reset").click();
  await expect(page.getByTestId("tips-reset")).toContainText("Tips Will Show Again");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await controlsInSight(page);
  await expect(tip).toContainText("Your route", { timeout: slow(15000) });
});
