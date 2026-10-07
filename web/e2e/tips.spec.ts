import { test, expect } from "@playwright/test";
import { openPanel, openSettings, settle, slow, tapTheChart } from "./helpers";

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
  await openPanel(page);
  const tip = page.getByTestId("tip");

  // The route's box first, then the flight's line, then the altitude.
  await expect(tip).toContainText("Your route", { timeout: slow(15000) });
  await expect(tip).toHaveCount(1);
  await page.getByTestId("tip-close").click();
  await expect(tip).toContainText("The quick numbers", { timeout: slow(15000) });
  await page.getByTestId("tip-close").click();
  await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/FL\d{3}/, { timeout: slow(60000) });
  await expect(tip).toContainText("Why this altitude", { timeout: slow(15000) });
  // Put away by a tap elsewhere, as by its close: the pilot moved on.
  await tapTheChart(page);
  await expect(tip.filter({ hasText: "Why this altitude" })).toHaveCount(0);

  // Seen, not offered again on this device.
  await page.reload();
  await settle(page);
  await openPanel(page);
  await page.waitForTimeout(2500);
  await expect(tip.filter({ hasText: /Your route|The quick numbers|Why this altitude/ })).toHaveCount(0);

  // Settings, Tips, offers them again from the start.
  await page.goto("/app/plan");
  await openSettings(page);
  await page.getByTestId("tips-reset").click();
  await expect(page.getByTestId("tips-reset")).toContainText("Tips will show again");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect(tip).toContainText("Your route", { timeout: slow(15000) });
});
