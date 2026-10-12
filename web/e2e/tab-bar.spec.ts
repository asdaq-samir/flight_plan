import { test, expect } from "@playwright/test";
import { grabberTo, openPanel, settle, sideDrawer } from "./helpers";

/**
 * The planner's tab bar, at the pilot's ask in place of the map's buttons
 * on its left: FPL, Airport, Aircraft and NRST along a phone's bottom, the
 * panel's sheet above it -- FPL the route's box (empty with no route, to
 * type one in), the others the search bar's shape, their field with the
 * console's gear beside it.
 */

test("the tabs swap the panel's head and body, FPL's empty box with no route", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const bar = page.getByTestId("tab-bar");
  await expect(bar).toBeVisible();
  // With no route, Airport: the airport search and the gear beside it.
  await expect(page.getByTestId("tab-airport")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page).getByTestId("search-airports")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("settings-button")).toBeVisible();

  await page.getByTestId("tab-aircraft").click();
  await expect(page).toHaveURL(/[?&]aircraft=1/);
  await expect(sideDrawer(page).getByTestId("aircraft-search")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("settings-button")).toBeVisible();

  await page.getByTestId("tab-nrst").click();
  await expect(page).toHaveURL(/[?&]near=1/);
  await expect(page).not.toHaveURL(/[?&]aircraft=1/);
  await expect(sideDrawer(page).getByTestId("nearest-from")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("nearest-card")).toBeVisible();

  // FPL with no route: the route's box, empty to type one in.
  await page.getByTestId("tab-fpl").click();
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page).getByTestId("route-clear")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("search-airports")).toHaveCount(0);
  // Its close: back to Airport.
  await sideDrawer(page).getByTestId("route-clear").click();
  await expect(page.getByTestId("tab-airport")).toHaveAttribute("aria-current", "page");
});

test("a route opens on FPL, the sheet stands on the bar, and the other tabs keep it planned", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  // On a phone the bar is along the screen's bottom, the sheet above it.
  const viewport = page.viewportSize()!;
  if (viewport.width < 768) {
    const bar = (await page.getByTestId("tab-bar").boundingBox())!;
    const sheet = (await sideDrawer(page).boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThan(viewport.height - 40);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y + 1);
  }
  // Airport and back: the route still there, on FPL.
  await page.getByTestId("tab-airport").click();
  await expect(sideDrawer(page).getByTestId("search-airports")).toBeVisible();
  await expect(page).toHaveURL(/dep=C81/);
  await page.getByTestId("tab-fpl").click();
  await expect(sideDrawer(page).getByTestId("panel-tab-navlog")).toBeVisible();
});

test("FPL with no route rests as a pill, as the other tabs do, its tap the empty box", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's sheet: a larger screen's panel is no pill");
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("tab-fpl").click();
  await expect(sideDrawer(page).getByTestId("route-clear")).toBeVisible();
  // Down to the pill, where it went only to a strip.
  await grabberTo(page, "peek");
  await expect(sideDrawer(page)).toHaveAttribute("data-shape", "capsule");
  await expect(sideDrawer(page).getByTestId("capsule-title")).toHaveText("Plan a route");
  // Its tap, the route's box to type one in.
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("route-clear")).toBeVisible();
});

test("an airport tapped in the route opens its card, and is changed from its menu", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const destination = page.getByLabel("Destination", { exact: true });
  await destination.click();
  // Its card over the route, as a tap on it on the chart opens it.
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  const card = sideDrawer(page).getByTestId("place-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("KDLH");
  // Closed, the route again, on FPL.
  await sideDrawer(page).getByTestId("place-close").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  // Changed from the pill's menu: its search, as a tap was.
  await destination.click({ button: "right" });
  await page.getByTestId("change-point").click();
  await expect(page.getByPlaceholder("Search for a destination")).toBeVisible();
});
