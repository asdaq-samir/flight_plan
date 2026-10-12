import { test, expect } from "@playwright/test";
import { grabberTo, openPanel, settle, sideDrawer } from "./helpers";

/**
 * The planner's tab bar, at the pilot's ask in place of the map's buttons
 * on its left: FPL, Airport, Aircraft, NRST and Settings, the card's first
 * row and at rest the pill itself -- FPL the route's box (empty with no
 * route, to type one in), the others their search bar the whole width,
 * Settings the console.
 */

test("the tabs swap the panel's head and body, FPL's empty box with no route", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const bar = page.getByTestId("tab-bar");
  await expect(bar).toBeVisible();
  // With no route, Airport: the airport search, Settings a tab of the bar.
  await expect(page.getByTestId("tab-airport")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page).getByTestId("search-airports")).toBeVisible();
  await expect(bar.getByTestId("settings-button")).toBeVisible();

  await page.getByTestId("tab-aircraft").click();
  await expect(page).toHaveURL(/[?&]aircraft=1/);
  await expect(sideDrawer(page).getByTestId("aircraft-search")).toBeVisible();

  await page.getByTestId("tab-nrst").click();
  await expect(page).toHaveURL(/[?&]near=1/);
  await expect(page).not.toHaveURL(/[?&]aircraft=1/);
  await expect(sideDrawer(page).getByTestId("nearest-from")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("nearest-card")).toBeVisible();

  // FPL with no route: the route's box, empty to type one in.
  await page.getByTestId("tab-fpl").click();
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("search-airports")).toHaveCount(0);

  // Settings, the last tab: the console, the tab up while it is out, and
  // put away the tab it was opened from again.
  await bar.getByTestId("settings-button").click();
  await expect(bar.getByTestId("settings-button")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
});

test("a route opens on FPL, the tabs on the card, and another tab keeps the panel's height and the route", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  // The tabs the card's own row, at rest the pill itself, at the pilot's
  // ask: not along the screen's bottom.
  const bar = (await page.getByTestId("tab-bar").boundingBox())!;
  const sheet = (await sideDrawer(page).boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(sheet.y);
  expect(bar.y + bar.height).toBeLessThanOrEqual(sheet.y + sheet.height);
  // Another tab at the pill: the pill kept, the route still there.
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
  await page.getByTestId("tab-airport").click();
  await expect(page.getByTestId("tab-airport")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
  await expect(page).toHaveURL(/dep=C81/);
  // The tab up tapped opens it half way, on the search; FPL again there
  // keeps the half.
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("search-airports")).toBeVisible();
  await page.getByTestId("tab-fpl").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  await expect(sideDrawer(page).getByTestId("panel-tab-navlog")).toBeVisible();
});

test("FPL with no route rests as the tabs' pill too, the tab up tapped the empty box", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("tab-fpl").click();
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
  // Down to the pill, where it went only to a strip; no figures with no
  // route.
  await grabberTo(page, "peek");
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
  await expect(sideDrawer(page).getByTestId("panel-foot")).toHaveCount(0);
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
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

test("all the way up, a small button on the separator shows the route's box and folds it away again", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "full");
  // Folded, the route's name alone over the tabs.
  await expect(panel.getByTestId("route-folded")).toHaveText("C81 → KDLH");
  await expect(panel.getByTestId("route-box")).toHaveCount(0);
  // Small, and on the separator: its middle on the line the body starts at.
  const fold = panel.getByTestId("route-fold");
  const button = (await fold.boundingBox())!;
  const body = (await panel.locator("[data-panel-body]").boundingBox())!;
  expect(button.height).toBeLessThan(30);
  expect(Math.abs(button.y + button.height / 2 - body.y)).toBeLessThanOrEqual(2);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByTestId("route-box")).toBeVisible();
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByTestId("route-box")).toHaveCount(0);
});
