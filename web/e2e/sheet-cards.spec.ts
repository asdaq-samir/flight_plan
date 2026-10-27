import { test, expect } from "@playwright/test";
import { grabberTo, openMapSettings, openTab, settle, settled, sideDrawer, slow } from "./helpers";

/**
 * On a phone, what a control opens (ResponsivePopover) and what a tap on
 * the chart opens (MapPopup) is a card in the map's one sheet, as Maps
 * opens everything in its sheet, at the owner's ask ("Yes to all, let's
 * have consistency and common code", 2026-10-27): not a sheet floating
 * over it, nor a popup over the chart (SheetCard). The panel comes up
 * half way for it at the least; its close, Escape, a swipe back and a
 * device's Back put it away, back to what was under it and the panel
 * where it was.
 */

test("the Map settings open as a card in the map's sheet, and its close goes back to what was under it", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's card; wider it is a popover");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await settled(panel);
  await expect(panel).toHaveAttribute("data-panel", "peek");

  // From the pill: the panel up half way for it, the card its body.
  await openMapSettings(page);
  const card = panel.getByRole("region", { name: "Map" });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-testid", "map-settings");
  await expect(panel).toHaveAttribute("data-panel", "half");
  // Nothing floating over the panel, and nothing made modal.
  await expect(page.locator("[data-slot=sheet-content]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Its name where a screen reader starts reading it.
  await expect(card.getByRole("heading", { name: "Map", level: 2 })).toBeFocused();
  // Its close, at the right of its name: the panel back to the pill.
  await card.getByTestId("sheet-card-close").click();
  await expect(card).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-panel", "peek");

  // From half, over the route's box: the box out of sight under it, and
  // there again as Escape puts it away, the panel still half way and the
  // focus back on the map's button.
  await grabberTo(page, "half");
  const dest = panel.getByTestId("route-dest");
  await expect(dest).toBeVisible();
  await openMapSettings(page);
  await expect(card).toBeVisible();
  await expect(dest).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(dest).toBeVisible();
  await expect(page.locator("[data-map-controls]").getByTestId("map-settings-button")).toBeFocused();
});

test("the approaches' pull-down is a card in the sheet, and the list it opens takes its place there", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's card; wider it is a popover");
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route =>
    route.fulfill({ json: { airport: "KDLH", cycle: "261001", procedures: [] } }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await openTab(page, "Nav Log");
  await expect(panel).toHaveAttribute("data-panel", "full");
  const arrive = panel.getByRole("region", { name: "KDLH · Arrive" });
  await arrive.locator("[data-testid=procedure-kind][data-kind=approach]").click({ timeout: slow(30000) });
  const menu = panel.getByTestId("procedure-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-sheet-card", "");
  // The route's list under it, kept out of sight.
  await expect(arrive).toBeHidden();
  // Its foot opens the field's whole list, a card of its own in its place.
  await page.getByTestId("procedure-menu-all").click();
  await expect(menu).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "KDLH approaches" })).toBeVisible();
  await expect(panel.getByTestId("procedures-none")).toBeVisible();
  // Closed: the route's list again, the panel all the way up as it was.
  await page.getByTestId("procedures-close").click();
  await expect(panel.getByRole("heading", { name: "KDLH approaches" })).toHaveCount(0);
  await expect(arrive).toBeVisible();
  await expect(panel).toHaveAttribute("data-panel", "full");
});
