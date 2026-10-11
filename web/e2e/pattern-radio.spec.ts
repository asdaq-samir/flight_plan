import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow, openTab, openSection } from "./helpers";

/**
 * The briefing's Pattern & Radio (PatternRadio, lib/pattern, lib/radio):
 * each field's pattern drawn for the runway the wind favours, and the
 * calls in the order they are made. The destination's runways are put
 * in the briefing's answer, a right-traffic 27 into the wind, so the
 * card has one answer.
 */
test("each field's pattern for the runway into the wind, and its calls in order", async ({ page }) => {
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.airports.KDLH.runways = [{
      ends: "09/27", length_ft: 5718, width_ft: 150, surface: "ASP", lighted: true, closed: false,
      wind: { end: "27", headwind_kt: 12, crosswind_kt: 3 },
      runway_ends: [{ ident: "09", heading_true_deg: 92, traffic: "left" }, { ident: "27", heading_true_deg: 272, traffic: "right" }],
    }];
    await route.fulfill({ response, json });
  });

  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  await openTab(page, "Airports");
  const drawer = sideDrawer(page);

  const phases = drawer.getByTestId("radio-phase");
  await expect(phases).toHaveCount(2);
  await expect(phases.nth(0)).toContainText("Leaving C81");
  await expect(phases.nth(1)).toContainText("Into KDLH");
  await expect(phases.nth(1).getByTestId("pattern-runway")).toContainText("Runway 27 · right traffic");
  await openSection(page, "KDLH · Destination");
  await expect(phases.nth(1).getByTestId("pattern-diagram")).toBeVisible();
  // Arriving from the south-southeast: the pattern's side of 27 right is
  // the north, so the way in is over the field.
  await expect(phases.nth(1).getByTestId("pattern-entry")).toContainText("cross midfield 500 ft above pattern altitude");

  // A stock airplane has no registration: the call sign says so.
  const leaving = phases.nth(0).getByTestId("radio-call");
  await expect(leaving.filter({ hasText: "taxiing to runway" })).toContainText("[your registration]");
  await expect(phases.nth(1).getByTestId("radio-call").filter({ hasText: "Duluth Tower," })).toContainText("landing.");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
