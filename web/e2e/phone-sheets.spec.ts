import { test, expect, type Page } from "@playwright/test";
import { openMapSettings, settle } from "./helpers";

/**
 * A phone's sheets look as the map's floating sheet does, at the owner's
 * pick of the sheets audit (D1, 2026-10-17): glass, eight points in from
 * the screen's sides and its foot, the half sheet's 36-point corners and
 * a grabber, and a swipe down on the grabber or the title puts one away
 * (PhoneSheetContent). The Map settings stand for them all: every phone
 * sheet is the same component.
 */
test.use({ hasTouch: true });

/** One finger, through Chromium's own touches (CDP), from `from` and
 *  `dy` down the screen, a frame a move. */
async function swipe(page: Page, from: { x: number; y: number }, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, at?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ ...at, id: 1 }] : [] });
  await touch("touchStart", from);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", { x: from.x, y: from.y + (dy * i) / 10 });
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
  await cdp.detach();
}

test("a phone's sheet floats in glass as the map's sheet does, and a swipe down on its title puts it away", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet; wider it is a popover");
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  const sheet = page.locator("[data-slot=sheet-content]");
  await expect(sheet).toBeVisible();
  // Measured where it comes to rest, its slide in over.
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const look = await sheet.evaluate(el => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      left: box.left, right: innerWidth - box.right, foot: innerHeight - box.bottom,
      radius: parseFloat(style.borderTopLeftRadius), blur: style.backdropFilter,
      grabber: !!el.querySelector("[data-swipe-handle] > span"),
    };
  });
  expect(look.left).toBeCloseTo(8, 0);
  expect(look.right).toBeCloseTo(8, 0);
  expect(look.foot).toBeCloseTo(8, 0);
  expect(look.radius).toBe(36);
  expect(look.blur).toContain("blur");
  expect(look.grabber).toBe(true);

  const title = sheet.locator("[data-slot=sheet-title]");
  await expect(title).toHaveText("Map");
  const at = (await title.boundingBox())!;
  const from = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  // A short one: it gives and comes back.
  await swipe(page, from, 30);
  await page.waitForTimeout(500);
  await expect(sheet).toBeVisible();
  // Down past a third of it: away, as its close puts it.
  await swipe(page, from, 320);
  await expect(sheet).toHaveCount(0);
});
