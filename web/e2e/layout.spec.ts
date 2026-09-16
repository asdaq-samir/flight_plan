import { test, expect, type Page } from "@playwright/test";

/**
 * The regressions this file exists to catch (see playwright.config.ts
 * for why these need a real browser rather than the vitest suite):
 *
 *  - a handle's grab zone or a corner-pinned button not actually flush
 *    against the edge it's meant to sit on, because a wider sibling
 *    (a collapsed panel, a fixed-width card) was silently deciding the
 *    shared container's own shrink-to-fit width
 *  - a `width:0`/`height:0` collapsed panel that wasn't really zero,
 *    because padding lived on the same border-box element instead of
 *    an inner wrapper, or a flex item's default `min-width:auto`
 *    refused to shrink below its content
 *  - wide content (the nav log table) pushing the whole page into
 *    horizontal scroll instead of scrolling inside its own container,
 *    because an ancestor flex item was missing `min-w-0`
 *
 * None of these are about what a component renders -- only about
 * where things actually land once a real layout engine gets to them.
 */

const PAGES = ["/app/plan", "/app/label"] as const;

async function settle(page: Page) {
  // Long enough for the initial course/checkpoint fetch to resolve (or
  // fail) and the map to finish its first layout pass -- these tests
  // assert on structure and position, not on that data actually
  // arriving, but a mid-fetch render shouldn't be what gets measured.
  await page.waitForTimeout(1500);
}

for (const path of PAGES) {
  test.describe(path, () => {
    test("sidebar and toolbar start collapsed on load, every load", async ({ page }) => {
      await page.goto(path);
      await settle(page);

      const sidebarWidth = await page.getByTestId("sidebar").evaluate(
        el => el.getBoundingClientRect().width,
      );
      expect(sidebarWidth).toBe(0);

      const toolbarHeight = await page.getByTestId("toolbar-content").evaluate(
        el => el.getBoundingClientRect().height,
      );
      expect(toolbarHeight).toBe(0);
    });

    test("drag handles' grab zones are the same thickness on both pages", async ({ page }) => {
      await page.goto(path);
      await settle(page);

      const toolbarHandle = await page.getByTestId("toolbar-handle").boundingBox();
      const sidebarHandle = await page.getByTestId("sidebar-handle").boundingBox();
      expect(toolbarHandle).not.toBeNull();
      expect(sidebarHandle).not.toBeNull();
      // The toolbar's is measured by height (it resizes vertically),
      // the sidebar's by width (it resizes horizontally) -- the two
      // should still be the same thickness across their own drag axis,
      // the dimension that matters for how easy each is to grab.
      expect(toolbarHandle!.height).toBe(sidebarHandle!.width);
    });

    test("no page-level horizontal overflow", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflowing).toBe(false);
    });

    test("action button sits flush bottom-left, guide button flush bottom-right", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("no viewport configured");

      const actionBox = await page.getByTestId("map-action-button").boundingBox();
      expect(actionBox).not.toBeNull();
      expect(actionBox!.x).toBeLessThan(20);
      // bottom-6 (24px), not bottom-3: deliberately more clearance than
      // the 20px tolerance elsewhere in this file, for the thumb-reach
      // margin.
      expect(actionBox!.y + actionBox!.height).toBeGreaterThan(viewport.height - 30);

      const guideBox = await page.getByTestId("guide-button").boundingBox();
      expect(guideBox).not.toBeNull();
      expect(guideBox!.x + guideBox!.width).toBeGreaterThan(viewport.width - 20);
    });

    test("both drag handles open and close from the keyboard alone", async ({ page }) => {
      await page.goto(path);
      await settle(page);

      const toolbarHandle = page.getByTestId("toolbar-handle");
      await toolbarHandle.focus();
      await toolbarHandle.press("ArrowRight");
      const heightAfterOne = await page.getByTestId("toolbar-content").evaluate(el => el.getBoundingClientRect().height);
      expect(heightAfterOne).toBeGreaterThan(0);
      await toolbarHandle.press("Home");
      const heightAfterHome = await page.getByTestId("toolbar-content").evaluate(el => el.getBoundingClientRect().height);
      expect(heightAfterHome).toBe(0);
      await toolbarHandle.press("End");
      const heightAfterEnd = await page.getByTestId("toolbar-content").evaluate(el => el.getBoundingClientRect().height);
      expect(heightAfterEnd).toBeGreaterThan(heightAfterOne);

      const sidebarHandle = page.getByTestId("sidebar-handle");
      await sidebarHandle.focus();
      await sidebarHandle.press("ArrowRight");
      const widthAfterOne = await page.getByTestId("sidebar").evaluate(el => el.getBoundingClientRect().width);
      expect(widthAfterOne).toBeGreaterThan(0);
      await sidebarHandle.press("Home");
      const widthAfterHome = await page.getByTestId("sidebar").evaluate(el => el.getBoundingClientRect().width);
      expect(widthAfterHome).toBe(0);
    });
  });
}

test("plan page: nav log's map/print pair sits top-right, print flush against the edge", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  // The persistent site header now takes the top of the viewport --
  // "flush against the edge" means the map area's own top edge, which
  // starts below it, not the viewport's.
  const headerBox = await page.locator("header").boundingBox();
  expect(headerBox).not.toBeNull();

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);

  // Two buttons now, not one -- the map icon sits to the left of print,
  // so it's print (the last of the pair) that's actually flush against
  // the corner.
  const mapBox = await page.getByTestId("map-action-button").boundingBox();
  const printBox = await page.getByTestId("print-button").boundingBox();
  expect(mapBox).not.toBeNull();
  expect(printBox).not.toBeNull();
  expect(printBox!.x + printBox!.width).toBeGreaterThan(viewport.width - 20);
  const mapAreaTop = headerBox!.y + headerBox!.height;
  expect(mapBox!.y).toBeLessThan(mapAreaTop + 20);
  expect(printBox!.y).toBeLessThan(mapAreaTop + 20);
  expect(mapBox!.x).toBeLessThan(printBox!.x);
});

test("plan page: nav log view scrolls inside its own table, not the page", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(500);

  // The nav log table sits inside "Flight Plan Summary", collapsed by
  // default like every other briefing section -- a closed <details>
  // reports a zero-width scroller regardless of what it holds, so this
  // check is only meaningful once a pilot has actually opened it.
  await page.getByText("Flight Plan Summary").click();
  await page.waitForTimeout(200);

  const pageOverflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(pageOverflowing).toBe(false);

  const scroller = page.getByTestId("navlog-scroller");
  const info = await scroller.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  // A route's worth of columns (12, `whitespace-nowrap`) at a phone
  // width is wider than the viewport -- the scroller itself should be
  // the thing that overflows and scrolls, which is only meaningful to
  // assert once it actually has content (the "reading"/generating
  // placeholder is a single centered line, not the wide table).
  const hasTable = await scroller.locator("table").count();
  if (hasTable > 0) {
    expect(info.scrollWidth).toBeGreaterThanOrEqual(info.clientWidth);
  }
});

test("the site header's nav links actually reach every other page", async ({ page }) => {
  await page.goto("/app/home");
  await page.waitForTimeout(300);

  await page.locator("header").getByText("Plan", { exact: true }).click();
  await page.waitForURL("**/app/plan");

  await page.locator("header").getByText("Playground", { exact: true }).click();
  await page.waitForURL("**/app/playground");

  await page.locator("header").getByText("Account", { exact: true }).click();
  await page.waitForURL("**/app/account");

  // The wordmark itself is the way back to Home from anywhere --
  // there was no such path before this header existed.
  await page.locator("header").getByText("VFR Route", { exact: true }).click();
  await page.waitForURL("**/app/home");
});
