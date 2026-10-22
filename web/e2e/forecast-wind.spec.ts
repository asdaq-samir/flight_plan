import { test, expect, type Page } from "@playwright/test";
import { openTab, settle, sideDrawer, slow } from "./helpers";

/**
 * A field the airplane reaches more than an hour from now has its runway
 * picked into the wind its TAF forecasts for then, at the owner's pick
 * (2026-10-20), and its info says so. The planner's forecast is stubbed:
 * an easterly at 14 kt, whatever the field reports now.
 */
async function easterly(page: Page, asked: string[] = []) {
  await page.route(url => /\/airport\/[^/]+\/forecast-wind$/.test(url.pathname), route => {
    const ident = new URL(route.request().url()).pathname.split("/").at(-2)!;
    asked.push(ident);
    return route.fulfill({
      json: { ident, distance_nm: 0, dir_true_deg: 90, speed_kt: 14, gust_kt: null, valid_from: 0, valid_to: 4_000_000_000 },
    });
  });
}

const depart = () => encodeURIComponent(new Date(Date.now() + 3 * 60 * 60_000).toISOString());

test("a field reached hours from now picks its runway into the forecast wind, and says it is the forecast", async ({ page }) => {
  const asked: string[] = [];
  await easterly(page, asked);
  await page.goto(`/app/plan?dep=C81&dest=KDLH&depart=${depart()}`);
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

test("a runway picked into an earlier wind follows the wind, where one the pilot picked stays", async ({ page }) => {
  // KABQ's 3, picked on a northerly, stood against the 180° the field then
  // reported (the owner's screenshot, 2026-10-21): picked into the wind
  // (`auto`), Duluth's 27 goes to 09 into the easterly; picked by the
  // pilot, it stays.
  await easterly(page);
  await page.goto(`/app/plan?dep=C81&dest=KDLH&depart=${depart()}&pattern=KDLH%3A27&auto=land%3AKDLH`);
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = sideDrawer(page).getByRole("region", { name: "KDLH · Arrive" });
  await expect(kdlh.getByRole("radio", { name: /^Runway 9, into the wind/ })).toBeChecked({ timeout: slow(60_000) });
  await expect(page).toHaveURL(/[?&]pattern=([^&]*%2C)?KDLH%3A9(%2C|&|$)/);

  await page.goto(`/app/plan?dep=C81&dest=KDLH&depart=${depart()}&pattern=KDLH%3A27`);
  await settle(page);
  await openTab(page, "Nav Log");
  await expect(kdlh.getByTestId("field-wind")).toContainText("090° 14 kt", { timeout: slow(60_000) });
  await expect(kdlh.getByRole("radio", { name: /^Runway 27/ })).toBeChecked();
  await expect(page).not.toHaveURL(/land%3AKDLH/);
});
