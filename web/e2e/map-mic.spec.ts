import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * The map's microphone in the Tabs screen: at the left of the map's foot,
 * just over the sheet's tabs (the owner, 2026-11-04, "Move the mic back
 * to the left side, above the tabs"); its listening pill widens out of it
 * to the right (RadioPill).
 */
test("the map's microphone is at the left over the sheet, and its pill widens to the right", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet across the screen's foot");
  await page.goto("/app/plan?layout=tabs");
  await settle(page);
  const mic = page.getByTestId("mic-circle");
  await expect(mic).toBeVisible({ timeout: slow(30000) });
  const shut = (await mic.boundingBox())!;
  const sheet = (await sideDrawer(page).boundingBox())!;
  expect(shut.x).toBeLessThanOrEqual(16);
  // Over the sheet's top, close above it.
  expect(shut.y + shut.height).toBeLessThanOrEqual(sheet.y);
  expect(sheet.y - (shut.y + shut.height)).toBeLessThanOrEqual(40);
  // Tapped: the pill, listening or saying why it cannot -- the left edge
  // stays where it was, and it grows to the right.
  await mic.getByTestId("radio-button").click();
  const pill = page.getByTestId("radio-pill");
  await expect(pill).toBeVisible({ timeout: slow(10000) });
  await expect.poll(async () => (await mic.boundingBox())!.width).toBeGreaterThan(shut.width + 40);
  expect(Math.abs((await mic.boundingBox())!.x - shut.x)).toBeLessThanOrEqual(1);
});
