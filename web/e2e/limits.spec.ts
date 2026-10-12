import { test, expect } from "@playwright/test";
import { openMapSettings, openSettings, settle } from "./helpers";

/**
 * The first-launch acknowledgement (lib/limits, LimitsDialog): seen once
 * on a fresh device, closed only by "I understand", and not again. The
 * suite's session has it given; this spec starts without it.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("limits-fresh")) return;
    localStorage.removeItem("vfr.limits");
    sessionStorage.setItem("limits-fresh", "1");
  });
});

test("a fresh device is told what the planner is not, once, and Settings has it again", async ({ page }) => {
  await page.goto("/app/plan");
  const dialog = page.getByTestId("limits-dialog");
  await expect(dialog).toContainText("planning aid for VFR flight");
  await expect(dialog).toContainText("14 CFR 91.3, 91.103");

  // Only the button closes it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.getByTestId("limits-acknowledge").click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await settle(page);
  await expect(dialog).toHaveCount(0);

  await openSettings(page);
  await page.getByTestId("about-limits").click();
  const sheet = page.getByTestId("about-limits-sheet");
  await expect(sheet).toContainText("planning aid for VFR flight");
  await expect(sheet).toContainText("Data sources");
  // The traffic's source among them, as the FAA's are.
  await expect(sheet).toContainText("adsb.lol ADS-B traffic, under the Open Database License");
});

// The traffic's source credited under the map's settings beside the
// FAA's charts, at the owner's ask, whether the traffic is shown or not.
test("the map's settings credit adsb.lol for the traffic as they credit the FAA for the charts", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vfr.limits", JSON.stringify({ state: { acknowledged: true }, version: 0 })));
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  const settings = page.getByTestId("map-settings");
  await expect(settings).toContainText("Charts from the FAA");
  await expect(settings).toContainText("Traffic from adsb.lol, under the Open Database License.");
});
