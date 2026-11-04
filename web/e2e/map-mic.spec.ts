import { test, expect } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The map's microphone in the Tabs screen: at the top right of the map,
 * under the status bar (the owner, 2026-11-04, "move the mic button to
 * top right which expands to glass listening pill"); its listening pill
 * widens out of it to the left (RadioPill).
 */
test("the map's microphone is at the top right, and its pill widens to the left", async ({ page }) => {
  await page.goto("/app/plan?layout=tabs");
  await settle(page);
  const mic = page.getByTestId("mic-circle");
  await expect(mic).toBeVisible({ timeout: slow(30000) });
  const view = page.viewportSize()!;
  const shut = (await mic.boundingBox())!;
  expect(shut.y).toBeLessThan(view.height / 4);
  expect(view.width - (shut.x + shut.width)).toBeLessThanOrEqual(16);
  // Tapped: the pill, listening or saying why it cannot -- the right
  // edge stays where it was, and it grows to the left.
  await mic.getByTestId("radio-button").click();
  const pill = page.getByTestId("radio-pill");
  await expect(pill).toBeVisible({ timeout: slow(10000) });
  {
    await expect.poll(async () => (await mic.boundingBox())!.width).toBeGreaterThan(shut.width + 40);
    const open = (await mic.boundingBox())!;
    expect(Math.abs(open.x + open.width - (shut.x + shut.width))).toBeLessThanOrEqual(1);
  }
});
