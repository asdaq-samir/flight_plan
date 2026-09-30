import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What the browser suite's specs share: the two pages, the waits CI
 * doubles, and the drawer opened and closed the way the stock
 * components open and close it. The head of layout.spec.ts, when
 * that file held nearly every test.
 */

export const PAGES = ["/app/plan", "/app/dev"] as const;

/** An explicit wait, doubled in CI: playwright.config.ts doubles the
 *  default waits there, and a wait written out here would otherwise
 *  stay at its local figure -- which on a runner carrying the stack,
 *  the browsers and a planner rendering tiles on four cores ran out. */
export const slow = (ms: number) => ms * (process.env.CI ? 2 : 1);

export async function settle(page: Page) {
  // The map's first layout pass: its first tile attached, which is
  // after the container has been measured and the chart asked for --
  // these tests assert on structure and position, not on the route's
  // data arriving. Capped at the flat 1.5 s this used to sleep every
  // time (44 times a run, 66 s summed), for a page with no map to wait
  // on; usually it is a few hundred milliseconds.
  await page.locator("img.leaflet-tile").first().waitFor({ state: "attached", timeout: 1500 }).catch(() => {});
}

/** The side drawer is shadcn's own Sidebar, on the left: a fixed panel
 *  beside the map from `md` up, a Sheet over it on a phone. Both carry
 *  `data-slot="sidebar"` and the side. */
export const sideDrawer = (page: Page) => page.locator('[data-slot="sidebar"][data-side="left"]');

/** The Dev-mode switch, in the header's settings: opened first. */
export async function devSwitchInSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  return page.getByRole("switch", { name: "Dev mode" });
}
/** The console: a stock Sheet from the top from `md` up, a sheet up from
 *  the bottom edge on a phone (shadcn's Drawer). */
export const consoleSheet = (page: Page) => page.getByTestId("console-sheet");

/** Closed: on a phone the Sheet is not in the page at all; on a
 *  desktop the panel stays mounted, collapsed off screen. */
export async function expectDrawerClosed(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  if (viewport.width < 768) await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toHaveCount(0);
  else await expect(sideDrawer(page)).toHaveAttribute("data-state", "collapsed");
}

export async function expectDrawerOpen(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  if (viewport.width < 768) await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toBeVisible();
  else await expect(sideDrawer(page)).toHaveAttribute("data-state", "expanded");
}

/** Opening and closing the drawer is one shape on both pages: the
 *  stock trigger in the header opens it and says so, and the stock
 *  components' own key closes it -- Escape on a phone, where the drawer
 *  is a Radix Sheet, and Cmd/Ctrl+B on a desktop, where it is shadcn's
 *  panel. This app binds no key of its own to it. */
export async function closeSidebarWithTheStockKey(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  if (viewport.width < 768) {
    // The pointer off the drawer first, as a finger is: left where the
    // trigger was clicked, it is over the drawer's own header icons once
    // the drawer has slid in, one of their tooltips opens, and Escape
    // closes the tooltip -- the drawer stayed open about one run in ten.
    // The drawer is on the left: the overlay beside it on the right.
    // And the sheet at rest first: an Escape pressed while it was still
    // sliding in left it open, now and then, on a loaded machine.
    await page.mouse.move(viewport.width - 4, viewport.height / 2);
    await settled(page.locator('[data-slot="sidebar"][data-mobile="true"]'));
    await page.keyboard.press("Escape");
  } else {
    await page.keyboard.press("ControlOrMeta+b");
  }
}

/** Every finite animation on and under an element run out -- a
 *  sheet's slide, the panel's width easing in. A spinner's spin is
 *  endless and left alone: waited on, it never finished. And one
 *  cancelled on the way is as done as one that ran out: its `finished`
 *  rejects, with an AbortError, and Promise.all used to take that for
 *  the whole wait failing (the Model Training drawer, its table drawn
 *  at once from the planner's kept read, three times running on CI). */
export async function settled(locator: Locator) {
  await locator.evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(a => a.effect?.getTiming().iterations !== Infinity)
    .map(a => a.finished.catch(() => undefined))));
}

/** The drawer's box once it is open and done opening: measured 300 ms
 *  after the tap, it was 29 px short of its width on a loaded runner. */
export async function openedDrawerBox(page: Page) {
  await expectDrawerOpen(page);
  await settled(sideDrawer(page));
  return sideDrawer(page).boundingBox();
}

export async function openSidebar(page: Page) {
  const sidebarTrigger = page.getByTestId("sidebar-trigger-button");
  await sidebarTrigger.click();
  await expectDrawerOpen(page);
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(sidebarTrigger).toBeEnabled();

  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "false");
}

/** The briefing is the flight planning drawer: open it from its header
 *  toggle, and the URL says so. */
export async function openBriefing(page: Page) {
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expectDrawerOpen(page);
}
