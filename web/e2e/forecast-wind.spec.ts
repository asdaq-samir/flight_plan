import { test, expect } from "@playwright/test";
import { openTab, settle, sideDrawer, slow } from "./helpers";

/**
 * A field the airplane reaches more than an hour from now has its runway
 * picked into the wind its TAF forecasts for then, at the owner's pick
 * (2026-10-20), and its info says so. The planner's forecast is stubbed:
 * an easterly at 14 kt, whatever the field reports now.
 */
test("a field reached hours from now picks its runway into the forecast wind, and says it is the forecast", async ({ page }) => {
  const asked: string[] = [];
  await page.route(url => /\/airport\/[^/]+\/forecast-wind$/.test(url.pathname), route => {
    const ident = new URL(route.request().url()).pathname.split("/").at(-2)!;
    asked.push(ident);
    return route.fulfill({
      json: { ident, distance_nm: 0, dir_true_deg: 90, speed_kt: 14, gust_kt: null, valid_from: 0, valid_to: 4_000_000_000 },
    });
  });
  const depart = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
  await page.goto(`/app/plan?dep=C81&dest=KDLH&depart=${encodeURIComponent(depart)}`);
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = sideDrawer(page).getByRole("region", { name: "KDLH · Arrive" });
  // The airport's wind under its ident, the forecast's for when it lands
  // there, said so to VoiceOver.
  const wind = kdlh.getByTestId("field-wind");
  await expect(wind).toContainText(/forecast for \d{4}Z, 90 true at 14 knots/, { timeout: slow(60_000) });
  await expect(wind).toContainText("090° 14 kt");
  expect(asked).toContain("KDLH");
  // Duluth's 09 into the easterly.
  await expect(kdlh.getByRole("radio", { name: /^Runway 9, into the wind/ })).toBeVisible();
});
