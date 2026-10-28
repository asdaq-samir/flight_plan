import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { grabberTo, settle, showTabs, sideDrawer, slow } from "./helpers";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:8080").origin;

/**
 * The map's Stops, one sheet near the pilot and along a route, at the
 * owner's pick of the Stops canvas (2026-10-27), where Fly-in Food was:
 * the map-pin button among the map's own, a sheet over FPL with how far to
 * look beside its title, the kinds as pills (All, Food, Fuel, Repair,
 * Training), and a row for each field with a line for each kind it has,
 * Call and Direct To or Add Stop; the Airport tab's Find Nearby tiles open
 * it with a kind picked.
 *
 * The fields are the planner's (/api/stops/near and /api/stops/along,
 * tested there); here they are answered with two, so the page is tried
 * without Overture or NASR.
 */

const DINER = { name: "Pilot Pete's", kind: "American restaurant", distance_m: 199, walk_min: 3, phone: null, website: null, lat: 45.2, lon: -90.5, on_field: true };
const SCHOOL = { name: "Citywings Flight School", kind: "Flight school", distance_m: 300, walk_min: 4, phone: null, website: null, lat: 45.2, lon: -90.5, on_field: true };
const STOPS = {
  pending: 0,
  fields: [
    { ident: "KAAA", name: "ALPHA MUNI", city: "ALPHA", lat: 42.4, lon: -88.0, distance_nm: 12.4, bearing_deg: 45,
      departure: "C81", added_nm: 2.2, off_nm: 0.4, phone: "847-555-0100",
      fuel_types: ["100LL", "A"], airframe_repair: "major", powerplant_repair: "minor", food: [DINER], training: [SCHOOL], places_known: true },
    { ident: "KBBB", name: "BRAVO MUNI", city: "BRAVO", lat: 42.8, lon: -88.5, distance_nm: 40.2, bearing_deg: 300,
      departure: "C81", added_nm: 6.0, off_nm: 3.2, phone: null,
      fuel_types: ["100LL"], airframe_repair: null, powerplant_repair: null, food: [], training: [], places_known: true },
  ],
};

/** The planner's two answers, each ask written down: "along", or "near"
 *  with the radius asked. */
async function stops(page: Page, asked: string[] = []) {
  await page.route(url => url.pathname.endsWith("/stops/near") || url.pathname.endsWith("/stops/along"), route => {
    const url = new URL(route.request().url());
    asked.push(url.pathname.endsWith("/near") ? `near ${url.searchParams.get("nm")}` : "along");
    return route.fulfill({ json: STOPS });
  });
}

/** The planner opened with no route, the pilot at Grayslake. */
async function nearMe(page: Page, context: BrowserContext) {
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ latitude: 42.3247, longitude: -88.0742 });
  await page.goto("/app/plan");
  await settle(page);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("with a course drawn, the map's Stops button opens the fields along it, each with a line for each kind it has, Call and Add Stop", async ({ page }) => {
  const asked: string[] = [];
  await stops(page, asked);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await expect(button).toHaveAccessibleName("Stops: fuel, food, repair and training at the airports");
  await button.click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await expect(card).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  // Along the route at first where there is one.
  await expect(card.getByTestId("stops-distance")).toHaveText("Along Route");
  await expect.poll(() => asked).toContain("along");

  const rows = card.getByTestId("stops-field");
  await expect(rows).toHaveCount(2, { timeout: slow(30_000) });
  // The owner's layout: ident and town; how far off the route; a line a kind.
  await expect(rows.nth(0).getByTestId("stops-field-open")).toHaveText("KAAA Alpha");
  await expect(rows.nth(0)).toContainText("On the route");
  await expect(rows.nth(1)).toContainText("3 nm off course");
  await expect(rows.nth(0).getByTestId("stops-line-fuel")).toHaveText("Fuel: 100LL, Jet A");
  await expect(rows.nth(0).getByTestId("stops-line-food")).toHaveText("Food: Pilot Pete's");
  await expect(rows.nth(0).getByTestId("stops-line-repair")).toHaveText("Repair: Airframe major, engine minor");
  await expect(rows.nth(0).getByTestId("stops-line-training")).toHaveText("Training: Citywings Flight School");
  // Only the lines for what the field has.
  await expect(rows.nth(1).getByTestId("stops-line-food")).toHaveCount(0);
  // Call: the FAA's number for the field, none where it lists none.
  await expect(rows.nth(0).getByTestId("stops-call")).toHaveAttribute("href", "tel:8475550100");
  await expect(rows.nth(1).getByTestId("stops-call")).toHaveCount(0);

  // A kind picked: only the fields that have it, and on the map its pin only.
  await card.getByTestId("stops-kind-food").click();
  await expect(card.getByTestId("stops-kind-food")).toHaveAttribute("aria-checked", "true");
  await expect(rows).toHaveCount(1);
  await expect(page.getByTitle("KAAA: Food")).toHaveCount(1);
  await card.getByTestId("stops-kind-all").click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTitle("KAAA: Fuel, Food, Repair, Training")).toHaveCount(1);

  // Add Stop puts the field in the route (the owner's "On course, have a
  // button to add stop", 2026-10-26).
  await rows.nth(1).getByTestId("stops-add-stop").click();
  await expect(page).toHaveURL(/[?&]stops=KBBB(&|$)/);
});

test("with no route the Stops look round the pilot, 25 nm at first, the distance and the kind picked from the sheet", async ({ page, context }) => {
  const asked: string[] = [];
  await stops(page, asked);
  await nearMe(page, context);
  const button = page.getByTestId("stops-along-button");
  await expect(button).toBeVisible({ timeout: slow(30_000) });
  await button.click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await expect(card).toBeVisible();
  // The sheet alone: FPL's Saved stood over it (the owner's screenshot, 2026-10-26).
  await expect(sideDrawer(page).getByTestId("saved-strip")).toHaveCount(0);
  const distance = card.getByTestId("stops-distance");
  await expect(distance).toHaveText("Within 25 nm");
  await expect(card.getByTestId("stops-field").first()).toContainText("12 nm NE", { timeout: slow(30_000) });
  await expect.poll(() => asked).toContain("near 25");
  // No Along Route without a route.
  await distance.click();
  await expect(page.getByTestId("stops-distance-option")).toHaveText(["Within 10 nm", "Within 25 nm", "Within 50 nm", "Within 100 nm"]);
  await page.getByTestId("stops-distance-option").filter({ hasText: "Within 50 nm" }).click();
  await expect(distance).toHaveText("Within 50 nm");
  await expect.poll(() => asked).toContain("near 50");
  // The kind picked is kept for the next time.
  await card.getByTestId("stops-kind-training").click();
  await expect(card.getByTestId("stops-field")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("vfr.preferences") ?? "{}").state?.stopKind)).toBe("training");
  // Round the pilot, Direct To: a flight from here to the field.
  await card.getByTestId("stops-field").first().getByTestId("stops-direct").click();
  await expect(page).toHaveURL(/[?&]dest=KAAA(&|$)/);
  await expect(page).toHaveURL(/[?&]dep=%4042\.3/);
  await button.click();
  await expect(card).toHaveCount(0);
});

test("the Airport tab's Find Nearby tiles open the Stops round the pilot with that kind picked", async ({ page, context }) => {
  await stops(page);
  await nearMe(page, context);
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await grabberTo(page, "half");
  const nearby = sideDrawer(page).getByTestId("find-nearby");
  await expect(nearby).toBeVisible();
  await expect(nearby.getByRole("button")).toHaveText(["Food", "Fuel", "Repair", "Flight Training"]);
  // A finger's 44 points.
  const tile = nearby.getByTestId("find-nearby-repair");
  expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await tile.click();
  const card = sideDrawer(page).getByTestId("stops-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("stops-kind-repair")).toHaveAttribute("aria-checked", "true");
  await expect(card.getByTestId("stops-distance")).toHaveText("Within 25 nm");
  await expect(card.getByTestId("stops-field")).toHaveCount(1, { timeout: slow(30_000) });
  await expect(card.getByTestId("stops-field").first().getByTestId("stops-line-repair")).toBeVisible();
});
