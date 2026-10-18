import { test, expect, type Page } from "@playwright/test";
import { controlsInSight, openMapSettings, settle, settled, sideDrawer } from "./helpers";

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

test("a phone's sheet swipes away from its content too, once that is scrolled to its top, and scrolls where it is not", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet; wider it is a popover");
  // The owner's pick ("Ok 1-3"): as an iOS sheet's scrolling content hands
  // a drag down to the sheet.
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  const sheet = page.locator("[data-slot=sheet-content]");
  await expect(sheet).toBeVisible();
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const list = sheet.locator(".overflow-y-auto").first();
  const box = (await list.boundingBox())!;
  const middle = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 200) };
  // Scrolled down, a swipe down scrolls it back, the sheet where it is.
  await list.evaluate(el => { el.scrollTop = 150; });
  await swipe(page, middle, 120);
  await page.waitForTimeout(500);
  await expect(sheet).toBeVisible();
  expect(await list.evaluate(el => el.scrollTop)).toBeLessThan(150);
  // At its top, the same swipe, further, puts the sheet away.
  await list.evaluate(el => { el.scrollTop = 0; });
  await swipe(page, middle, 320);
  await expect(sheet).toHaveCount(0);
});

test("a swipe up on a sheet opened from the map's sheet moves neither it nor the map's sheet behind it", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet; wider it is a popover");
  // The owner's notice: a swipe up on the Procedures dragged FPL up from
  // behind it, the press going on up React's tree to the map sheet's head.
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route =>
    route.fulfill({ json: { airport: "KDLH", cycle: "261001", procedures: [] } }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await controlsInSight(page);
  const panel = sideDrawer(page);
  const top = async () => (await panel.boundingBox())!.y;
  await sideDrawer(page).getByTestId("route-approaches").click();
  const sheet = page.locator("[data-slot=sheet-content]");
  await expect(sheet).toBeVisible();
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  // Half way under it, as it opens with the Procedures (PlanWorkspace),
  // and at rest there.
  await settled(panel);
  const before = await panel.getAttribute("data-panel");
  const panelTop = await top();
  const sheetTop = (await sheet.boundingBox())!.y;
  // Up from its title, and up from its content.
  const title = (await sheet.locator("[data-slot=sheet-title]").boundingBox())!;
  await swipe(page, { x: title.x + title.width / 2, y: title.y + title.height / 2 }, -200);
  await page.waitForTimeout(600);
  const body = (await page.getByTestId("procedures").boundingBox())!;
  await swipe(page, { x: body.x + body.width / 2, y: body.y + 40 }, -200);
  await page.waitForTimeout(600);
  await expect(sheet).toBeVisible();
  expect(Math.abs((await sheet.boundingBox())!.y - sheetTop)).toBeLessThan(2);
  await expect(panel).toHaveAttribute("data-panel", before!);
  expect(Math.abs(await top() - panelTop)).toBeLessThan(2);
});
