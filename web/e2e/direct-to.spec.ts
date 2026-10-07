import { test, expect } from "@playwright/test";
import { settle } from "./helpers";

/**
 * Fly Here as an EFB's Direct-To, at the pilot's ask: from where the
 * pilot is -- the field nearest the position -- over Home. The position
 * is Campbell Airport's (C81), and Home is set to Madison, elsewhere.
 */
test.use({ geolocation: { latitude: 42.3246, longitude: -88.0741 }, permissions: ["geolocation"] });

test("Fly Here goes direct from where the pilot is, the field nearest the position, not from Home", async ({ page }) => {
  await page.goto("/app/plan?home=KMSN");
  await expect(page).not.toHaveURL(/[?&]home=/, { timeout: 10_000 });
  await settle(page);
  const search = page.getByTestId("search-airports");
  await search.click();
  await search.fill("KDLH");
  await page.getByTestId("search-result").filter({ hasText: "KDLH" }).first().click();
  await page.getByTestId("place-card").getByTestId("fly-here").click();
  await expect(page).toHaveURL(/[?&]dest=KDLH/, { timeout: 15_000 });
  await expect(page).toHaveURL(/[?&]dep=C81/);
});
