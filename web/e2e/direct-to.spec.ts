import { test, expect } from "@playwright/test";
import { settle, grabberTo, showTabs } from "./helpers";

/**
 * Fly Here as an EFB's Direct-To, at the pilot's ask: from where the
 * pilot is -- the present position itself, as in the air a Direct-To goes
 * from wherever the airplane is -- over Home. The position is near
 * Campbell Airport (C81), and Home is set to Madison, elsewhere.
 */
test.use({ geolocation: { latitude: 42.3246, longitude: -88.0741 }, permissions: ["geolocation"] });

test("Fly Here goes direct from the present position, not from Home", async ({ page }) => {
  await page.goto("/app/plan?home=KMSN");
  await expect(page).not.toHaveURL(/[?&]home=/, { timeout: 10_000 });
  await settle(page);
  // Airport's search, at the pill out of the tabs alone.
  await grabberTo(page, "peek");
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  const search = page.getByTestId("search-airports");
  await search.click();
  await search.fill("KDLH");
  await page.getByTestId("search-result").filter({ hasText: "KDLH" }).first().click();
  await page.getByTestId("place-card").getByTestId("fly-here").click();
  await expect(page).toHaveURL(/[?&]dest=KDLH/, { timeout: 15_000 });
  await expect(page).toHaveURL(/[?&]dep=%4042\.3246%2C-88\.0741/);
  // All the way up as the search's card was; the route's box at the pill.
  await grabberTo(page, "peek");
  await expect(page.getByTestId("route-dep")).toContainText("N42°19.5′ W088°04.4′");
});
