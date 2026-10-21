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

async function suggested(page: Page) {
  await page.route(url => url.pathname.endsWith("/navlog") && !url.searchParams.get("stops"), async route => {
    const body = await (await route.fetch()).text();
    const lines = body.split("\n").filter(Boolean).map(line => {
      const message = JSON.parse(line);
      if (message.type !== "done") return line;
      message.totals.fuel_stops = [{ departure: "C81", destination: "KDLH", usable_gal: 48, stops: [STOP], choices: [CHOICE] }];
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
  await expect(row.getByRole("heading")).toHaveText(/KRPD · Rice lake/i);
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
