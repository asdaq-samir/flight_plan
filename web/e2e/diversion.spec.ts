import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * The diversion drill (DiversionDrill, lib/diversion): over a checkpoint,
 * against the clock, a field picked and the estimates checked against
 * the exact solution. The nearest fields are put in the planner's answer
 * so the field and its course are known.
 */
test("a diversion over a checkpoint: the clock, a field picked, and the estimates marked", async ({ page }) => {
  await page.route("**/api/planner/airports/nearest?*", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ airports: [
      { ident: "HERE", name: "Under Us", lat: 0, lon: 0, kind: "small", distance_nm: 0.4, bearing_deg: 0, longest_runway_ft: 2000, flight_category: "VFR" },
      { ident: "KAAA", name: "Near Field", lat: 0, lon: 0, kind: "small", distance_nm: 9, bearing_deg: 90, longest_runway_ft: 4000, flight_category: "VFR" },
      { ident: "KBBB", name: "Far Field", lat: 0, lon: 0, kind: "medium", distance_nm: 18, bearing_deg: 180, longest_runway_ft: 6000, flight_category: null },
    ] }),
  }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await page.getByRole("button", { name: "Nav Log", exact: true }).click();
  const rows = sideDrawer(page).locator("[data-kind=checkpoint]");
  await expect(rows.first()).toBeVisible({ timeout: slow(120000) });
  await rows.first().click();
  await sideDrawer(page).getByTestId("diversion-drill").first().click();

  const sheet = page.getByTestId("diversion-content");
  await sheet.getByTestId("diversion-start").click();
  await expect(sheet.getByTestId("diversion-clock")).toContainText("On the clock");
  // The field under the point is not a diversion; how far and which way
  // are not given.
  const fields = sheet.getByTestId("diversion-field");
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).not.toContainText("9 nm");
  await expect(sheet.getByTestId("diversion-check")).toBeDisabled();

  await fields.nth(1).click();
  await sheet.getByTestId("diversion-mh-input").fill("90");
  await sheet.getByTestId("diversion-ete-input").fill("10");
  await sheet.getByTestId("diversion-check").click();

  await expect(sheet.getByTestId("diversion-clock")).toContainText("You took");
  // South to KBBB: a heading of 090 is no estimate of it.
  await expect(sheet.getByTestId("diversion-mh")).toContainText("Not quite");
  await expect(sheet.getByText("To KBBB, worked out")).toBeVisible();
  await expect(sheet.getByTestId("diversion-nearest")).toContainText("The nearest was KAAA, 9 nm");
  // Not typed, not marked.
  await expect(sheet.getByTestId("diversion-fuel")).not.toContainText("Not quite");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
