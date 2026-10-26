import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * The map's fly-in food, at the owner's ask ("that button on the map is
 * for at airport restaurant like for a $100 hamburger", 2026-10-25): a
 * button among the map's own, a card over FPL of the fields near the pilot
 * with somewhere to eat a short walk from the ramp, nearest first, each
 * with how far, which way and its places, its name its card, and the same
 * fields pinned on the chart.
 *
 * The fields are the planner's (/api/airports/food, tested there); here it
 * is answered with two, so the page is tried without Overture.
 */

const DINER = { name: "Pilot Pete's", kind: "American restaurant", distance_m: 199, walk_min: 3, phone: null, website: null, lat: 45.2, lon: -90.5, on_field: true };
const CAFE = { name: "Kitty Hawk Cafe", kind: "Cafe", distance_m: 577, walk_min: 8, phone: null, website: null, lat: 45.3, lon: -90.5, on_field: true };
const FOOD = {
  pending: 0,
  fields: [
    { ident: "KAAA", name: "ALPHA MUNI", city: "ALPHA", lat: 42.4, lon: -88.0, distance_nm: 12.4, bearing_deg: 45, food: [DINER] },
    { ident: "KBBB", name: "BRAVO MUNI", city: "BRAVO", lat: 42.8, lon: -88.5, distance_nm: 40.2, bearing_deg: 300, food: [CAFE] },
  ],
};

async function food(page: Page) {
  await page.route(url => url.pathname.endsWith("/airports/food"), route => route.fulfill({ json: FOOD }));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the map's food button opens the airports near the pilot with a restaurant on the field, pinned on the chart", async ({ page }) => {
  await food(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await expect(button).toHaveAccessibleName("Restaurants at the airports near you");
  await button.click();
  const card = sideDrawer(page).getByTestId("food-card");
  await expect(card).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");

  const rows = card.getByTestId("food-field");
  await expect(rows).toHaveCount(2, { timeout: slow(30_000) });
  await expect(rows.nth(0)).toContainText("KAAA · Alpha");
  await expect(rows.nth(0)).toContainText("Pilot Pete's · American restaurant");
  await expect(rows.nth(0)).toContainText("12 nm NE");
  await expect(rows.nth(1)).toContainText("Kitty Hawk Cafe · Cafe");
  await expect(page.getByTitle("KBBB, a restaurant on the field")).toHaveCount(1);

  // A name opens the field's card, with its Fly Here.
  await rows.nth(1).getByTestId("food-field-open").click();
  await expect(page.getByTestId("place-card")).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=KBBB(&|$)/);
});

test("the food button is there with no route, and a second tap puts the card away", async ({ page }) => {
  await food(page);
  await page.goto("/app/plan");
  await settle(page);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await button.click();
  const card = sideDrawer(page).getByTestId("food-card");
  await expect(card).toBeVisible();
  await button.click();
  await expect(card).toHaveCount(0);
});
