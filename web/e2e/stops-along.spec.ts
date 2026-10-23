import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * The map's Stops, at the owner's pick (option C of the stops canvas,
 * "Try C", 2026-10-23: "a button to show food, fuel, rest options along
 * the route they can pick from"): a button among the map's own while there
 * is a route, a card over FPL with Fuel, Food and Rest, each field in route
 * order with Add, and the same fields pinned on the chart.
 *
 * The fields are the planner's (vfr.fuelstops.along, vfr.nearby, tested
 * there); here /api/route-stops is answered with three, so the page is
 * tried without Overture.
 */

const field = (ident: string, city: string, from_nm: number, over: object) => ({
  ident, name: `${city} MUNI`, city: city.toUpperCase(), lat: 45 + from_nm / 600, lon: -90.5, flight: 0, departure: "C81",
  from_nm, added_nm: 3.2, fuel_types: [], runway_ft: 5000, elevation_ft: 1000, courtesy_car: false, nearby_known: true,
  food: null, lodging: null, car: null, ...over,
});
const DINER = { name: "Runway Diner", kind: "Diner", distance_m: 300, walk_min: 4, phone: null, lat: 45.2, lon: -90.5 };
const MOTEL = { name: "Lakeside Motel", kind: "Motel", distance_m: 3300, walk_min: null, phone: null, lat: 45.3, lon: -90.5 };
const STOPS = {
  pending: 0,
  fields: [
    field("KAAA", "Alpha", 80, { fuel_types: ["100LL", "A"] }),
    field("KBBB", "Bravo", 140, { food: DINER }),
    field("KCCC", "Charlie", 200, { fuel_types: ["100LL"], lodging: MOTEL, courtesy_car: true }),
  ],
};

async function stopsAlong(page: Page) {
  await page.route(url => url.pathname.endsWith("/route-stops"), route => route.fulfill({ json: STOPS }));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the map's Stops button opens the fields along the route by Fuel, Food or Rest, pinned on the chart", async ({ page }) => {
  await stopsAlong(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await button.click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await expect(card).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");

  // Food first: the field with a diner, what it is and how far.
  const rows = card.getByTestId("stops-field");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("KBBB · Bravo");
  await expect(rows.first()).toContainText("Runway Diner · 4 min walk");
  await expect(page.getByTitle("Food at KBBB")).toHaveCount(1);

  // Fuel: those that sell 100LL, in route order.
  await card.getByTestId("stops-kind").getByRole("radio", { name: "Fuel" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("KAAA");
  await expect(rows.nth(0)).toContainText("100LL, Jet A");
  await expect(rows.nth(1)).toContainText("KCCC");
  await expect(page.getByTitle("Fuel at KAAA")).toHaveCount(1);

  // Rest: a bed and the courtesy car.
  await card.getByTestId("stops-kind").getByRole("radio", { name: "Rest" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Lakeside Motel · 2.1 mi · Courtesy car");

  // The button again puts it away.
  await button.click();
  await expect(card).toHaveCount(0);
});

test("a field added from Fuel is a fuel stop, and from Food the pilot's own stop", async ({ page }) => {
  await stopsAlong(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("stops-along-button").click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await card.getByTestId("stops-field").first().getByTestId("stops-add").click();
  await expect(page).toHaveURL(/[?&]stops=KBBB(&|$)/);
  await expect(page).not.toHaveURL(/[?&]fuel=/);

  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("stops-along-button").click();
  await sideDrawer(page).getByTestId("stops-kind").getByRole("radio", { name: "Fuel" }).click();
  await sideDrawer(page).getByTestId("stops-field").first().getByTestId("stops-add").click();
  await expect(page).toHaveURL(/[?&]stops=KAAA(&|$)/);
  await expect(page).toHaveURL(/[?&]fuel=KAAA(&|$)/);
});
