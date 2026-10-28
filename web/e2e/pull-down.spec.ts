import { test, expect } from "@playwright/test";
import { controlsInSight, grabberTo, sideDrawer, slow } from "./helpers";

/**
 * Every pick-one choice is the app's one pull-down (components/PullDown),
 * as iOS's pull-down button is: the one picked on its trigger, a tap a
 * menu of them on the light material with a 14-point corner, and the
 * picked one's checkmark on the left of its words. It was Radix's Select
 * here, a listbox of its own with the tick on the right.
 */
test("a pick-one is the pull-down: a menu of the choices, the picked one's tick on the left", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "judged as a phone");
  await page.goto("/app/plan?dep=C81&dest=C81");
  await grabberTo(page, "full");
  await expect(sideDrawer(page).getByTestId("navlog-ete")).toHaveText("1h", { timeout: slow(30000) });
  await controlsInSight(page);

  const trigger = page.getByTestId("local-duration");
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAccessibleName("Time aloft: 1h");
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // The app's menu look, the same as every action menu's (ui/menuLook).
  expect(await menu.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).toBe("14px");
  // The one picked ticked, its tick at the row's left and its words after.
  const picked = menu.getByRole("menuitemradio", { name: "1h", exact: true });
  await expect(picked).toHaveAttribute("aria-checked", "true");
  await expect(menu.locator("[role=menuitemradio][aria-checked=true]")).toHaveCount(1);
  const tick = await picked.locator("[data-slot=dropdown-menu-radio-item-indicator] svg").boundingBox();
  const row = await picked.boundingBox();
  const words = await picked.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el.lastChild!);
    return range.getBoundingClientRect().left;
  });
  expect(tick && row).toBeTruthy();
  expect(tick!.x - row!.x).toBeLessThan(24);
  expect(tick!.x + tick!.width).toBeLessThanOrEqual(words);

  // Picked from the menu: the trigger says it, the flight follows.
  await menu.getByRole("menuitemradio", { name: "2h", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/[?&]local_min=120/);
  await expect(trigger).toHaveAccessibleName("Time aloft: 2h");
  // From the keyboard too, as a menu is: Enter opens it on the one picked.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "2h", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
});
