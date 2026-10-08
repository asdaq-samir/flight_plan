import { test, expect } from "@playwright/test";
import { openSettings, settle } from "./helpers";

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
});
