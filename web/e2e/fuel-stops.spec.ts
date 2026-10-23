import { test, expect, type Page } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * Fuel stops suggested as Tesla suggests chargers, at the owner's pick
 * (option A, 2026-10-21): a flight too long for its tanks gets a stop the
 * planner chose, a row in FPL's list with what the airplane lands with and
 * when, dashed in the route's box and pinned on the map, other fields in
 * its menu, and one tap puts it in the route.
 *
 * The planner's choice is its own (vfr.fuelstops, tested there); here the
 * live nav log for C81-KDLH, a route CI reads anyway, is answered with a
 * suggestion added to its totals, so the page is tried without planning a
 * trip long enough to need one.
 */

const STOP = {
  ident: "KRPD", name: "RICE LAKE RGNL - CARL'S FLD", city: "RICE LAKE", lat: 45.419, lon: -91.7735, from_nm: 220.4, added_nm: 1.2,
  lands_with_gal: 18.6, minutes: 118.0, fuel_types: "100LL,A", runway_ft: 6700, elevation_ft: 1109,
};
const CHOICE = { ...STOP, ident: "KEAU", name: "CHIPPEWA VALLEY RGNL", city: "EAU CLAIRE", lat: 44.8658, lon: -91.4843, added_nm: 6.0, lands_with_gal: 21.2 };

async function suggested(page: Page, departure = "C81", reason: "fuel" | "break" = "fuel") {
  await page.route(url => url.pathname.endsWith("/navlog") && !url.searchParams.get("stops"), async route => {
    const body = await (await route.fetch()).text();
    const lines = body.split("\n").filter(Boolean).map(line => {
      const message = JSON.parse(line);
      if (message.type !== "done") return line;
      message.totals.fuel_stops = [{ departure, destination: "KDLH", usable_gal: 48, reason, stops: [STOP], choices: [CHOICE] }];
      return JSON.stringify(message);
    });
    await route.fulfill({ contentType: "application/x-ndjson", body: `${lines.join("\n")}\n` });
  });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a fuel stop the planner suggests is a row of the route, dashed in its box and pinned on the map, and one tap adds it", async ({ page }) => {
  await suggested(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);

  // FPL's row: the field and its town, what the airplane lands with.
  const row = sideDrawer(page).getByTestId("fuel-stop");
  await expect(row).toBeVisible({ timeout: slow(60_000) });
  await expect(row).toHaveAttribute("data-ident", "KRPD");
  await expect(row.getByRole("heading")).toHaveText("KRPD");
  await expect(row).toContainText(/Rice lake/i);
  await expect(row.getByTestId("fuel-gauge")).toContainText("18 gal");

  // Dashed in the route's box, after the departure, and pinned.
  await expect(sideDrawer(page).getByTestId("route-fuel-stop")).toHaveText("KRPD");
  await expect(page.getByTitle("Suggested fuel stop KRPD")).toHaveCount(1);

  // Its menu offers the other field.
  await row.getByTestId("fuel-stop-other").click();
  await expect(page.getByTestId("fuel-stop-choice")).toHaveText(/KEAU · Eau claire/i);
  await page.keyboard.press("Escape");

  // Added: a stop of the route.
  await sideDrawer(page).getByTestId("fuel-stop-keep").click();
  await expect(page).toHaveURL(/[?&]stops=KRPD(&|$)/);
});

test("another field from the stop's menu goes in in its place", async ({ page }) => {
  await suggested(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const row = sideDrawer(page).getByTestId("fuel-stop");
  await expect(row).toBeVisible({ timeout: slow(60_000) });
  await row.getByTestId("fuel-stop-other").click();
  await page.getByTestId("fuel-stop-choice").click();
  await expect(page).toHaveURL(/[?&]stops=KEAU(&|$)/);
});

test("a stop suggested on a flight from a present position is a row of the route too", async ({ page }) => {
  // The owner's screenshot (2026-10-22): from a present position, the stop
  // dashed in the route's box was missing from FPL's list, the departure
  // there no field to follow.
  // Named as the route's box names the position, as the planner sends it.
  await suggested(page, "@42.2333,-87.9883");
  await page.goto("/app/plan?dep=@42.2333,-87.9883&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("route-fuel-stop")).toHaveText("KRPD", { timeout: slow(60_000) });
  const row = sideDrawer(page).getByTestId("fuel-stop");
  await expect(row).toHaveAttribute("data-ident", "KRPD");
  await expect(sideDrawer(page).getByTestId("fuel-stop-keep")).toBeVisible();
});

/** What KRPD offers on the ground, as the planner answers it (vfr.nearby,
 *  vfr.faa_data.airport_services): a diner a walk away, a courtesy car. */
const SERVICES = {
  ident: "KRPD", fuel_types: ["100LL", "A"], fuel_notes: ["24 hour self serve fuel."], landing_fee: false, tie_down: true,
  hangar: true, airframe_repair: null, powerplant_repair: null, oxygen: false, courtesy_car: true, ground_notes: ["Courtesy car available."],
  food: [{ name: "Runway Diner", kind: "Diner", distance_m: 300, walk_min: 4, phone: "+17155550100", lat: 45.42, lon: -91.77 }],
  lodging: [{ name: "Lakeside Inn", kind: "Hotel", distance_m: 3300, walk_min: null, phone: null, lat: 45.45, lon: -91.75 }],
  cars: [], nearby_unavailable: false,
};

// The owner's pick of the trip-stops canvas ("Ok do it", 2026-10-22): A,
// what is there on the ground under each suggested stop, and the stop's
// card a tap on its row.
test("a suggested stop's row says what is there on the ground, and a tap opens its card with its figures", async ({ page }) => {
  await suggested(page);
  await page.route(url => url.pathname.endsWith("/airport/KRPD/services"), route => route.fulfill({ json: SERVICES }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const row = sideDrawer(page).getByTestId("fuel-stop");
  await expect(row).toBeVisible({ timeout: slow(60_000) });
  await expect(row.getByTestId("stop-glance")).toHaveText(/100LL.*Food 4 min walk.*Hotel 2\.1 mi.*Courtesy car/);

  await row.getByTestId("fuel-stop-open").click();
  const card = page.getByTestId("place-card");
  await expect(card.getByTestId("place-stop")).toContainText("Suggested fuel stop");
  await expect(card.getByTestId("place-stop-after")).toContainText("From C81");
  await expect(card.getByTestId("place-stop-after")).toContainText("1h 58m");
  await expect(card.getByTestId("place-stop-fuel")).toContainText("18 gal");
  await expect(card.getByTestId("place-stop-added")).toContainText("+1 nm");

  // Kept from its card at its place, a fuel stop.
  await card.getByTestId("place-add-stop").click();
  await expect(page).toHaveURL(/[?&]stops=KRPD(&|$)/);
  await expect(page).toHaveURL(/[?&]fuel=KRPD(&|$)/);
});

test("the airport's Info says its fuel, what is on the field and the places near it", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/airport/KRPD/services"), route => route.fulfill({ json: SERVICES }));
  await page.goto("/app/plan?place=KRPD");
  const card = page.getByTestId("place-card");
  await expect(card).toBeVisible({ timeout: slow(30_000) });
  const info = card.getByTestId("place-tab-radio");
  if (await info.isVisible()) await info.click();
  const services = card.getByTestId("place-services");
  await expect(services.getByTestId("services-fuel")).toContainText("100LL, Jet A");
  await expect(services).toContainText("24 hour self serve fuel.");
  await expect(services.getByTestId("services-courtesy-car")).toBeVisible();
  await expect(services.getByTestId("services-food")).toContainText(/Runway Diner.*4 min walk/);
  await expect(services.getByTestId("services-food")).toHaveAttribute("href", "tel:+17155550100");
  await expect(services.getByTestId("services-lodging")).toContainText(/Lakeside Inn.*2\.1 mi/);
  await expect(services).toContainText("Places © Overture Maps Foundation");
});

test("a long flight the tanks hold is offered a break about half way, kept as the pilot's own stop", async ({ page }) => {
  await suggested(page, "C81", "break");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const row = sideDrawer(page).getByTestId("fuel-stop");
  await expect(row).toBeVisible({ timeout: slow(60_000) });
  await expect(row.getByRole("region", { name: /Suggested stop for a break, KRPD/ })).toBeVisible();
  await expect(sideDrawer(page).getByTestId("route-fuel-stop")).toHaveAccessibleName("Suggested stop KRPD: add it to the route");
  const keep = sideDrawer(page).getByTestId("fuel-stop-keep");
  await expect(keep).toHaveText("Add Stop");
  await keep.click();
  await expect(page).toHaveURL(/[?&]stops=KRPD(&|$)/);
  await expect(page).not.toHaveURL(/[?&]fuel=/);
});
