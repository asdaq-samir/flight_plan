import { test, expect, type Page } from "@playwright/test";

/**
 * The regressions this file exists to catch (see playwright.config.ts
 * for why these need a real browser rather than the vitest suite):
 *
 *  - a corner-pinned button not actually flush against the edge it's
 *    meant to sit on, because a wider sibling was silently deciding
 *    the shared container's own shrink-to-fit width
 *  - the toolbar drawer or the sidebar (shadcn's own `Collapsible`/
 *    `Sidebar`) not actually starting closed, or not actually opening
 *    from its trigger
 *  - wide content (the nav log table) pushing the whole page into
 *    horizontal scroll instead of scrolling inside its own container,
 *    because an ancestor flex item was missing `min-w-0`
 *
 * None of these are about what a component renders -- only about
 * where things actually land once a real layout engine gets to them.
 * The default viewport here (see playwright.config.ts) is phone-sized,
 * which is deliberate: it's what exercises the sidebar's own mobile
 * `Sheet` path, not just the desktop push-layout one.
 */

const PAGES = ["/app/plan", "/app/label"] as const;

async function settle(page: Page) {
  // Long enough for the initial course/checkpoint fetch to resolve (or
  // fail) and the map to finish its first layout pass -- these tests
  // assert on structure and position, not on that data actually
  // arriving, but a mid-fetch render shouldn't be what gets measured.
  await page.waitForTimeout(1500);
}

async function openMobileSidebar(page: Page) {
  const sidebarTrigger = page.locator('[data-slot="sidebar-trigger"]');
  const mobileSidebar = page.locator('[data-mobile="true"]');
  await sidebarTrigger.click();
  await expect(mobileSidebar).toBeVisible();
  // Closed via Escape, not a second click on the trigger -- the
  // Sheet's own full-viewport overlay sits on top of everything
  // (including the trigger's own screen position) while open, the
  // same as any other modal dialog; Escape is the one dismissal
  // path that doesn't depend on what's currently on top.
  await page.keyboard.press("Escape");
  await expect(mobileSidebar).not.toBeVisible();
}

test.describe("/app/plan", () => {
  // No collapsible toolbar here -- the route form is the whole reason
  // a pilot opened this page, not a settings drawer worth a tap to
  // reveal (see PlanView's own comment on its toolbar).
  test("the route form is visible immediately, not behind a trigger", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await expect(page.getByLabel("Departure")).toBeVisible();
    expect(await page.getByTestId("toolbar-trigger").count()).toBe(0);
  });

  test("sidebar starts collapsed on load, every load", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    // The mobile Sidebar is a Sheet that isn't even mounted until its
    // trigger opens it -- "collapsed" means "not there."
    expect(await page.locator('[data-mobile="true"]').count()).toBe(0);
  });

  test("sidebar opens from its own trigger, closed by default", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await openMobileSidebar(page);
  });
});

test.describe("/app/label", () => {
  test("sidebar and toolbar start collapsed on load, every load", async ({ page }) => {
    await page.goto("/app/label");
    await settle(page);

    // Radix's Collapsible doesn't render closed content at all (no
    // box to measure), and the mobile Sidebar is a Sheet that isn't
    // even mounted until its trigger opens it -- "collapsed" for
    // both now means "not there," not "there at width/height 0."
    await expect(page.getByTestId("toolbar-content")).not.toBeVisible();
    expect(await page.locator('[data-mobile="true"]').count()).toBe(0);
  });

  test("toolbar and sidebar open from their own trigger, closed by default", async ({ page }) => {
    await page.goto("/app/label");
    await settle(page);

    const toolbarTrigger = page.getByTestId("toolbar-trigger");
    const toolbarContent = page.getByTestId("toolbar-content");
    await toolbarTrigger.click();
    await expect(toolbarContent).toBeVisible();
    await toolbarTrigger.click();
    await expect(toolbarContent).not.toBeVisible();

    await openMobileSidebar(page);
  });
});

for (const path of PAGES) {
  test.describe(path, () => {
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
  });
}

test("plan page: nav log's listen/print pair sits top-right, print flush against the edge", async ({ page }) => {
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
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // Two buttons, not the three-button row this used to be -- no more
  // "back to map" button here at all (see NavLogActions' own comment),
  // so it's print (the last of the pair) that's actually flush against
  // the corner, with listen to its left.
  const listenBox = await page.getByTestId("listen-button").boundingBox();
  const printBox = await page.getByTestId("print-button").boundingBox();
  expect(listenBox).not.toBeNull();
  expect(printBox).not.toBeNull();
  expect(printBox!.x + printBox!.width).toBeGreaterThan(viewport.width - 20);
  const mapAreaTop = headerBox!.y + headerBox!.height;
  expect(listenBox!.y).toBeLessThan(mapAreaTop + 20);
  expect(printBox!.y).toBeLessThan(mapAreaTop + 20);
  expect(listenBox!.x).toBeLessThan(printBox!.x);
});

test("plan page: the header's own Plan link, not a dedicated button, is the way back from the briefing view", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  expect(await page.getByTestId("map-action-button").count()).toBe(0);

  await page.locator("header").getByText("Plan", { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  await expect(page.getByTestId("map-action-button")).toBeVisible();
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
  await page.goto("/app/label");
  await page.waitForTimeout(300);

  await page.locator("header").getByText("Plan", { exact: true }).click();
  await page.waitForURL("**/app/plan");

  await page.locator("header").getByText("Dev", { exact: true }).click();
  await page.waitForURL("**/app/dev");

  await page.locator("header").getByText("Settings", { exact: true }).click();
  await page.waitForURL("**/app/settings");

  // The wordmark itself is the way back to Plan, the app's own
  // homepage, from anywhere -- Dev links to Label instead of Label
  // having its own permanent nav item (see PageHeader's own comment).
  await page.locator("header").getByText("VFR Route", { exact: true }).click();
  await page.waitForURL("**/app/plan");
});

test("Dev's own Label link works, since Label has no header link of its own", async ({ page }) => {
  await page.goto("/app/dev");
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Label checkpoints" }).click();
  await page.waitForURL("**/app/label");
});
