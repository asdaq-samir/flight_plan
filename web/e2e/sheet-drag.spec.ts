import { test, expect, type Locator, type Page } from "@playwright/test";
import { grabberTo, openPanel, settle, sideDrawer } from "./helpers";

/**
 * The map's panel dragged by a finger from anywhere on its body, as an
 * iOS sheet's scrolling content hands its drag to the sheet
 * (useDetentDrag): up, the sheet comes out until it is all the way out;
 * down, once the content is back at its start, the sheet goes down --
 * and while the content is scrolled, it scrolls instead.
 */
test.use({ hasTouch: true });

/** A finger down on `at` and `dy` down the screen (up, negative), a
 *  frame a move, as a finger's moves come: slowly enough that the sheet
 *  comes to rest where it was let go, past half way to the next height
 *  rather than thrown there. */
async function fingerDrag(page: Page, at: { x: number; y: number }, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, p?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ ...p, id: 1 }] : [] });
  await touch("touchStart", at);
  for (let i = 1; i <= 20; i++) {
    await touch("touchMove", { x: at.x, y: at.y + dy * i / 20 });
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
  await cdp.detach();
}

test("the panel follows a finger from anywhere on its body: out to the top, and down from its content's start", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "half");
  const middleOf = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 120) };
  };

  // Up from half, on the tabs' bar -- all of the body half way up shows
  // -- the sheet comes all the way out, and the tab under the finger is
  // not picked by the release.
  const tabs = panel.getByRole("tablist");
  const picked = await tabs.getByRole("tab", { selected: true }).textContent();
  await fingerDrag(page, await middleOf(tabs), -400);
  await expect(panel).toHaveAttribute("data-panel", "full");
  await expect(tabs.getByRole("tab", { selected: true })).toHaveText(picked!);

  const tab = page.getByTestId("navlog-scroller");
  await expect(tab).toBeVisible();
  const middle = () => middleOf(tab);

  // Scrolled down, a drag down scrolls it back rather than taking the
  // sheet down.
  await expect.poll(() => tab.evaluate(el => el.scrollHeight > el.clientHeight + 300)).toBe(true);
  await tab.evaluate(el => { el.scrollTop = 300; });
  await fingerDrag(page, await middle(), 120);
  await expect(panel).toHaveAttribute("data-panel", "full");

  // At its start, a drag down takes the sheet down.
  await tab.evaluate(el => { el.scrollTop = 0; });
  await fingerDrag(page, await middle(), 400);
  await expect(panel).toHaveAttribute("data-panel", "half");

  // And a mouse on the body leaves the sheet where it is: a drag across
  // it selects its words.
  await grabberTo(page, "full");
  const at = await middle();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y - 200, { steps: 10 });
  await page.mouse.up();
  await expect(panel).toHaveAttribute("data-panel", "full");
});
