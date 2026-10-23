import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * The map's Stops, at the owner's pick (option C of the stops canvas,
 * "Try C", 2026-10-23: "a button to show food, fuel, rest options along
 * the route they can pick from"): a button among the map's own while there
 * is a route, a card over FPL with one list of the fields along it ("Don't
 * need three tabs"), each in route order with what it has and Add, its
 * name its card, and the same fields pinned on the chart.
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

test("the map's Stops button opens one list of the fields along the route, each with what it has, pinned on the chart", async ({ page }) => {
  await stopsAlong(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await button.click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await expect(card).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");

  // All three, in route order, each with what it has.
  const rows = card.getByTestId("stops-field");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("KAAA · Alpha");
  await expect(rows.nth(0).getByTestId("stops-glance")).toHaveText("100LL");
  await expect(rows.nth(1).getByTestId("stops-glance")).toHaveText("Food 4 min walk");
  await expect(rows.nth(2).getByTestId("stops-glance")).toHaveText(/100LL.*Hotel 2\.1 mi.*Courtesy car/);
  await expect(page.getByTitle("KBBB, a stop along the route")).toHaveCount(1);

  // A name opens the field's card.
  await rows.nth(1).getByTestId("stops-field-open").click();
  await expect(page.getByTestId("place-card")).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=KBBB(&|$)/);
});

test("a field added from the Stops is the pilot's own stop, at its place", async ({ page }) => {
  await stopsAlong(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("stops-along-button").click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await card.getByTestId("stops-field").nth(2).getByTestId("stops-add").click();
  await expect(page).toHaveURL(/[?&]stops=KCCC(&|$)/);
  await expect(page).not.toHaveURL(/[?&]fuel=/);
  // The button again puts the card away.
  await page.getByTestId("stops-along-button").click();
  await expect(card).toHaveCount(0);
});
