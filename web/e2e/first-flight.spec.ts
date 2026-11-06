import { test, expect } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The first flight's card (FirstFlight, useFirstFlight): over the map the
 * first time the planner opens with no route on this device, a
 * destination picked from the airport search, Plan it planning from where
 * the airplane is; then the nav log open and the card gone for good. The
 * suite's session has the tips all seen, the card with them; this spec
 * starts with none seen, once, so a reload keeps what it saw.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("first-fresh")) {
      localStorage.removeItem("wingtip.tips");
      sessionStorage.setItem("first-fresh", "1");
    }
    // Own ship on with a fix by Campbell (C81), where the first flight
    // departs from: the planner's nearest field to it.
    const position = () => ({
      coords: { latitude: 42.325, longitude: -88.074, accuracy: 10, altitude: 300, altitudeAccuracy: 5, heading: 0, speed: 0, toJSON() { return this; } },
      timestamp: Date.now(), toJSON() { return this; },
    }) as unknown as GeolocationPosition;
    Geolocation.prototype.watchPosition = function (success: PositionCallback) {
      window.setTimeout(() => success(position()), 0);
      return window.setInterval(() => success(position()), 1000);
    };
    Geolocation.prototype.clearWatch = function (id: number) { window.clearInterval(id); };
    localStorage.setItem("wingtip.ownship",
      JSON.stringify({ state: { enabled: true, follow: false, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 }));
  });
});

test("a new pilot is asked where to, Plan it plans from where the airplane is, the nav log opens and the card is gone for good", async ({ page }) => {
  test.setTimeout(slow(90_000));
  await page.goto("/app/plan");
  await settle(page);
  const card = page.getByTestId("first-flight");
  await expect(card).toBeVisible({ timeout: slow(15_000) });
  await expect(card.getByTestId("first-flight-plan")).toBeDisabled();

  // Madison picked from the search the route's box uses.
  await card.getByTestId("first-flight-dest").fill("KMSN");
  await card.getByTestId("search-result").filter({ hasText: "KMSN" }).first().click({ timeout: slow(15_000) });
  await expect(card.getByTestId("first-flight-dest")).toHaveValue(/KMSN/);
  await card.getByTestId("first-flight-plan").click();

  // Planned from the nearest field to the fix: the nav log's rows, over
  // the route, and the card gone.
  const navlog = page.getByTestId("navlog-list");
  await expect(navlog).toBeVisible({ timeout: slow(60_000) });
  await expect(navlog.getByRole("row").nth(1)).toBeVisible({ timeout: slow(60_000) });
  await expect(page).toHaveURL(/dest=KMSN/);
  await expect(card).toHaveCount(0);

  // Seen: not offered again on this device, even with no route.
  await page.goto("/app/plan");
  await settle(page);
  await page.waitForTimeout(1500);
  await expect(card).toHaveCount(0);
});
