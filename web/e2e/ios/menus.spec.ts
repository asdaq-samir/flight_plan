import { test, expect } from "@playwright/test";
import { grabberTo, settle, showTabs, sideDrawer } from "../helpers";

/**
 * A menu's rows to a finger, as iOS's own menus' are: 44 points each, the
 * row the control, as the grouped lists' rows are (GroupedList), where
 * they were 31 to 34 (the commonality audit's C-2). On the iOS devices,
 * a touch pointer: the "mobile" project's viewport alone has none.
 */
test("a menu's rows are 44 points tall to a finger", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await grabberTo(page, "half");
  await sideDrawer(page).getByTestId("airport-strip-shows").click();
  const items = page.getByRole("menuitemradio");
  await expect(items).toHaveCount(3);
  // Each row's own height, as laid out: the menu scales in as it opens,
  // and its box measured mid-way was 43.8.
  for (const item of await items.all()) expect(await item.evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
});
