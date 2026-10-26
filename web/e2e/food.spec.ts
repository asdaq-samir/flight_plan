import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:8080").origin;

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
    { ident: "KAAA", name: "ALPHA MUNI", city: "ALPHA", lat: 42.4, lon: -88.0, distance_nm: 12.4, bearing_deg: 45, food: [DINER],
      departure: "C81", added_nm: 2.2, off_nm: 0.4 },
    { ident: "KBBB", name: "BRAVO MUNI", city: "BRAVO", lat: 42.8, lon: -88.5, distance_nm: 40.2, bearing_deg: 300, food: [CAFE],
      departure: "C81", added_nm: 6.0, off_nm: 3.2 },
  ],
};

async function food(page: Page) {
  await page.route(url => url.pathname.endsWith("/airports/food") || url.pathname.endsWith("/route-food"), route => route.fulfill({ json: FOOD }));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("with a course drawn, the map's food button opens the airports along it with a restaurant on the field, pinned on the chart", async ({ page }) => {
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
  // Restaurant first (the owner's pick B, 2026-10-26): its name, its
  // airport, what it is.
  await expect(rows.nth(0)).toContainText("Pilot Pete's");
  await expect(rows.nth(0)).toContainText("American restaurant");
  // Along the route (the owner's "when a course is drawn then look for
  // fly in food along the route"): how far along and the miles it adds.
  await expect(card.getByTestId("food-scope-route")).toHaveAttribute("aria-pressed", "true");
  await expect(rows.nth(0)).toContainText("On course");
  await expect(rows.nth(1)).toContainText("3 nm off course");
  // Add Stop puts the field in the route (the owner's "On course, have a
  // button to add stop", 2026-10-26).
  await rows.nth(1).getByTestId("food-add-stop").click();
  await expect(page).toHaveURL(/[?&]stops=KBBB(&|$)/);
  await expect(rows.nth(1)).toContainText("Kitty Hawk Cafe");
  await expect(page.getByTitle("KBBB, a restaurant on the field")).toHaveCount(1);

});

test("with no route the food button looks round the pilot within a radius picked from its menu, a hundred miles at first", async ({ page, context }) => {
  // The owner's "add in the search radius in it, and by default set it
  // 100 nm" (2026-10-26).
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/airports/food"), route => {
    asked.push(new URL(route.request().url()).searchParams.get("nm") ?? "");
    return route.fulfill({ json: FOOD });
  });
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ latitude: 42.3247, longitude: -88.0742 });
  await page.goto("/app/plan");
  await settle(page);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await button.click();
  const card = sideDrawer(page).getByTestId("food-card");
  await expect(card).toBeVisible();
  const radius = card.getByTestId("food-radius");
  await expect(radius).toHaveText("Within 100 nm");
  await expect(card.getByTestId("food-field").first()).toContainText("12 nm NE", { timeout: slow(30_000) });
  expect(asked).toContain("100");
  await radius.click();
  await page.getByTestId("food-radius-option").filter({ hasText: "Within 50 nm" }).click();
  await expect(radius).toHaveText("Within 50 nm");
  await expect.poll(() => asked).toContain("50");
  // Round the pilot, Direct To: a flight from here to the field.
  await card.getByTestId("food-field").first().getByTestId("food-direct").click();
  await expect(page).toHaveURL(/[?&]dest=KAAA(&|$)/);
  await expect(page).toHaveURL(/[?&]dep=%4042\.3/);
  await button.click();
  await expect(card).toHaveCount(0);
});
