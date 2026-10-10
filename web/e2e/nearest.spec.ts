import { test, expect } from "@playwright/test";
import { openMapSettings, openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * Nearest as a card of the panel's (NearestCard), at the pilot's ask: half
 * way up, the map fitted to the fields above it, a field opened as a
 * layer over the list and its close back to it. And the fields the armed
 * services keep to themselves, off the map until the Map sheet's
 * Military is on. The fields are put in the planner's answers, so where
 * they are is known.
 */
test.use({ geolocation: { latitude: 42.3246, longitude: -88.0741 }, permissions: ["geolocation"] });

const FIELD = { kind: "small", longest_runway_ft: 3500, flight_category: "VFR", military: null };

test("Nearest opens as a card half way up, a field over it as a layer, and its close back to the list", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airports/nearest"), route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ airports: [
      { ...FIELD, ident: "C81", name: "Campbell", lat: 42.3246, lon: -88.0741, distance_nm: 0.1, bearing_deg: 0 },
      { ...FIELD, ident: "KUGN", name: "Waukegan National", lat: 42.4222, lon: -87.8679, distance_nm: 11, bearing_deg: 55, radio: { kind: "TWR", mhz: 120.4 } },
      { ...FIELD, ident: "KFHU", name: "Libby AAF", lat: 42.45, lon: -88.2, distance_nm: 9, bearing_deg: 320, military: "joint" },
    ] }),
  }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  // Among the map's buttons on its left.
  await page.locator("[data-map-controls-left]").getByTestId("nearest-button").click();
  const card = sideDrawer(page).getByTestId("nearest-card");
  await expect(card).toBeVisible();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  const rows = card.getByTestId("nearest-airport");
  await expect(rows).toHaveCount(3, { timeout: slow(15000) });
  await expect(rows.nth(2)).toContainText("joint use");
  // Each row its weather, its runway and the frequency to call it on, and
  // how far and which way, its arrow pointing there (north up, the
  // airplane not moving).
  await expect(rows.nth(1)).toContainText("VFR");
  await expect(rows.nth(1)).toContainText("3,500 ft · TWR 120.4");
  await expect(rows.nth(1)).toContainText("11 nm");
  await expect(rows.nth(1)).toContainText("NE");
  await expect(rows.nth(1).getByTestId("nearest-arrow")).toHaveAttribute("style", /rotate\(55deg\)/);

  await rows.nth(1).click();
  await expect(sideDrawer(page).getByTestId("place-card")).toBeVisible();
  await sideDrawer(page).getByTestId("place-close").click();
  await expect(card).toBeVisible();
  await card.getByTestId("nearest-close").click();
  await expect(card).toHaveCount(0);
  await expect(sideDrawer(page).getByTestId("panel-tab-navlog")).toBeVisible();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
});

test("a field the armed services keep to themselves is off the map until Military is on", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airports/in-view"), route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ airports: [
      { ...FIELD, ident: "KMIL", name: "Some AFB", lat: 42.36, lon: -88.16, kind: "medium", military: "military" },
      { ...FIELD, ident: "KCIV", name: "Some Municipal", lat: 42.29, lon: -88.01, kind: "medium" },
    ] }),
  }));
  // Close in at C81, its card brings the map to it at zoom 9, where the
  // fields' chips are drawn (AirportsLayer).
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const chip = (ident: string) => page.locator(".leaflet-marker-icon", { hasText: ident });
  await openMapSettings(page);
  await expect(page.getByTestId("military-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(chip("KCIV")).toBeVisible({ timeout: slow(15000) });
  await expect(chip("KMIL")).toHaveCount(0);
  await openMapSettings(page);
  await page.getByTestId("military-toggle").click();
  await page.keyboard.press("Escape");
  await expect(chip("KMIL")).toBeVisible();
});


test("Nearest is from a place typed -- a town, an address, an airport -- and back from the position at its clear", async ({ page }) => {
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/airports/nearest"), route => {
    const at = new URL(route.request().url()).searchParams;
    asked.push(`${at.get("lat")},${at.get("lon")}`);
    return route.fulfill({ json: { airports: [
      { ...FIELD, ident: "KMSN", name: "Dane County Regional", lat: 43.14, lon: -89.34, distance_nm: 4.1, bearing_deg: 40 },
    ] } });
  });
  await page.route(url => url.pathname.endsWith("/api/planner/places/search"), route => route.fulfill({ json: { places: [
    { label: "Madison, WI", kind: "town", lat: 43.0849, lon: -89.3888 },
    { label: "Madison, AL", kind: "town", lat: 34.7, lon: -86.74 },
  ] } }));
  await page.goto("/app/plan?near=1");
  await settle(page);
  const card = sideDrawer(page).getByTestId("nearest-card");
  const field = card.getByTestId("nearest-from");
  await expect(field).toHaveAttribute("placeholder", "Current position");

  await field.fill("madison");
  await card.getByTestId("nearest-from-option").filter({ hasText: "Madison, WI" }).click();
  await expect(card).toContainText("Near Madison, WI");
  await expect(page).toHaveURL(/[?&]nearAt=43\.0849%2C-89\.3888/);
  await expect(card.getByTestId("nearest-airport")).toContainText("KMSN");
  expect(asked).toContain("43.1,-89.4");

  // Its clear: from the position again.
  await card.getByTestId("nearest-from-clear").click();
  await expect(page).not.toHaveURL(/nearAt=/);
  await expect(field).toHaveValue("");
});
