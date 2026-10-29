import { test, expect, type Page } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * Fuel stops suggested as Tesla suggests chargers, at the owner's pick
 * (option A, 2026-10-21): a flight too long for its tanks gets a stop the
 * planner chose, dashed in the route's box and pinned on the map, and its
 * menu puts it in the route. FPL's list has no cards of them since the
 * route line took their job (the owner's redesign, 2026-10-26;
 * route-line.spec).
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

test("a fuel stop the planner suggests is dashed in the route's box and pinned on the map", async ({ page }) => {
  await suggested(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("route-fuel-stop")).toHaveText("KRPD", { timeout: slow(60_000) });
  await expect(page.getByTitle("Suggested fuel stop KRPD")).toHaveCount(1);
  // No cards of it in FPL's list: the route line does their job.
  await expect(sideDrawer(page).getByTestId("fuel-stop-card")).toHaveCount(0);
});

test("a stop suggested on a flight from a present position is dashed in the route's box too", async ({ page }) => {
  // The owner's screenshot (2026-10-22): from a present position, the stop
  // was missing, the departure there no field to follow.
  // Named as the route's box names the position, as the planner sends it.
  await suggested(page, "@42.2333,-87.9883");
  await page.goto("/app/plan?dep=@42.2333,-87.9883&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("route-fuel-stop")).toHaveText("KRPD", { timeout: slow(60_000) });
  await expect(page.getByTitle("Suggested fuel stop KRPD")).toHaveCount(1);
});

test("a suggested fuel stop can be taken out of the route box and put back, or added from its menu", async ({ page }) => {
  // The owner's ask (2026-10-24): "Fuel stops should also have a way to
  // delete them and add them back as pleased".
  await suggested(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const chip = sideDrawer(page).getByTestId("route-fuel-stop");
  await expect(chip).toHaveText("KRPD", { timeout: slow(60_000) });
  // Its menu's Remove takes it out of the box.
  await chip.click();
  await page.getByTestId("route-fuel-stop-remove").click();
  await expect(chip).toHaveCount(0);
  // The route's menu puts it back.
  await sideDrawer(page).getByTestId("share-route").click();
  await page.getByTestId("route-show-fuel").click();
  await expect(chip).toHaveText("KRPD");
  // And its menu's Add to Route makes it a stop of the route.
  await chip.click();
  await page.getByTestId("route-fuel-stop-add").click();
  await expect(page).toHaveURL(/[?&]stops=KRPD(&|$)/);
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

// The owner's pick of the trip-stops canvas ("Ok do it", 2026-10-22): the
// stop's card a tap on it, with its figures.
test("a suggested stop's pin opens its card with its figures", async ({ page }) => {
  await suggested(page);
  await page.route(url => url.pathname.endsWith("/airport/KRPD/services"), route => route.fulfill({ json: SERVICES }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const pin = page.getByTitle("Suggested fuel stop KRPD");
  await expect(pin).toHaveCount(1, { timeout: slow(60_000) });
  await pin.click();
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

test("the airport's card says its fuel in its details, and what is on the field and the places near it at its foot", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/airport/KRPD/services"), route => route.fulfill({ json: SERVICES }));
  await page.goto("/app/plan?place=KRPD");
  const card = page.getByTestId("place-card");
  await expect(card).toBeVisible({ timeout: slow(30_000) });
  const details = card.getByTestId("place-details");
  await expect(details.getByTestId("services-fuel")).toContainText("100LL, Jet A");
  // Its remarks folded under their own row, opened by a tap.
  await expect(details).not.toContainText("24 hour self serve fuel.");
  await details.getByTestId("services-fuel-remarks").click();
  await expect(details).toContainText("24 hour self serve fuel.");
  const services = card.getByTestId("place-services");
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
  const chip = sideDrawer(page).getByTestId("route-fuel-stop");
  await expect(chip).toHaveAccessibleName("Suggested stop KRPD", { timeout: slow(60_000) });
  await chip.click();
  await page.getByTestId("route-fuel-stop-add").click();
  await expect(page).toHaveURL(/[?&]stops=KRPD(&|$)/);
  await expect(page).not.toHaveURL(/[?&]fuel=/);
});
