import { test, expect } from "@playwright/test";
import { closeCard, grabberTo, openMapSettings, openTab, panelTabs, settle, settled, sideDrawer, slow, tapTheChart } from "./helpers";

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
  // Its name and close in the tabs' place on top (the owner, 2026-10-27:
  // "Shouldn't the title replace the tabs?"): the panel back to the pill.
  await expect(panel.getByTestId("tab-title")).toContainText("Map");
  await expect(panelTabs(page)).toHaveCount(0);
  await closeCard(page, "sheet-card-close");
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

test("a checkpoint tapped on the chart opens its card in the sheet, ringed on the map; one opened over it closes back to it", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's card; wider it is the chart's popup");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await settled(panel);
  const marker = page.locator(".leaflet-marker-icon", { hasText: /^\d+$/ }).first();
  await expect(marker).toBeVisible({ timeout: slow(60000) });
  // The ring a picked point wears (Halo's orange).
  const rings = page.locator('.leaflet-container path[stroke="#ff3b00"]');
  const before = await rings.count();
  // Its own click, not one at its place: neighbouring checkpoints stack
  // on a phone's fitted route (map.spec).
  await marker.dispatchEvent("click");
  const checkpoint = panel.locator("[data-sheet-card]").filter({ hasText: "nm along" });
  await expect(checkpoint).toBeVisible();
  // Its name in the card's head, which names it.
  const name = checkpoint.getByRole("heading", { level: 2 });
  await expect(name).toBeVisible();
  await expect(checkpoint).toHaveAccessibleName((await name.innerText()).trim());
  await expect(panel).not.toHaveAttribute("data-panel", "peek");
  // Not a popup over the chart.
  await expect(page.locator(".leaflet-popup:visible")).toHaveCount(0);
  await expect.poll(() => rings.count()).toBeGreaterThan(before);
  const ringed = await rings.count();

  // The Map settings over it: its card on top, the checkpoint's kept
  // under it, and back to it as the top one is closed.
  await page.locator("[data-map-controls]").getByTestId("map-settings-button").click();
  const map = panel.getByRole("region", { name: "Map" });
  await expect(map).toBeVisible();
  await expect(checkpoint).toBeHidden();
  await closeCard(page, "sheet-card-close");
  await expect(map).toHaveCount(0);
  await expect(checkpoint).toBeVisible();

  // A tap on the chart puts it away, as it did the popup, and its ring
  // (the nav log's pick keeps its own).
  await tapTheChart(page);
  await expect(checkpoint).toHaveCount(0);
  await expect.poll(() => rings.count()).toBeLessThan(ringed);
});
