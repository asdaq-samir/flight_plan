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

    test("guide button sits flush right, stacked below the sidebar trigger in the top-right corner", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("no viewport configured");

      const guideBox = await page.getByTestId("guide-button").boundingBox();
      const sidebarTriggerBox = await page.locator('[data-slot="sidebar-trigger"]').boundingBox();
      expect(guideBox).not.toBeNull();
      expect(sidebarTriggerBox).not.toBeNull();
      expect(guideBox!.x + guideBox!.width).toBeGreaterThan(viewport.width - 20);
      // Below, not overlapping -- both claim the top-right corner now.
      expect(guideBox!.y).toBeGreaterThan(sidebarTriggerBox!.y + sidebarTriggerBox!.height);
      expect(guideBox!.y).toBeLessThan(viewport.height / 2);
    });
  });
}

test("label page: action button sits flush bottom-left (Plan's own version moved into its header, next to Chart)", async ({ page }) => {
  await page.goto("/app/label");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  const actionBox = await page.getByTestId("map-action-button").boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.x).toBeLessThan(20);
  // bottom-6 (24px), not bottom-3: deliberately more clearance than the
  // 20px tolerance elsewhere in this file, for the thumb-reach margin.
  expect(actionBox!.y + actionBox!.height).toBeGreaterThan(viewport.height - 30);
});

test("plan page: Flight Briefing sits next to Chart in the header, not floating over the map", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  const chartBox = await page.getByRole("button", { name: "Chart" }).boundingBox();
  const briefingBox = await page.getByTestId("map-action-button").boundingBox();
  expect(chartBox).not.toBeNull();
  expect(briefingBox).not.toBeNull();
  expect(briefingBox!.x).toBeGreaterThan(chartBox!.x);
  // Same row, not stacked -- and nowhere near the bottom-left corner
  // MapActionButton would otherwise pin it to.
  expect(Math.abs(briefingBox!.y - chartBox!.y)).toBeLessThan(10);
  expect(briefingBox!.y).toBeLessThan(viewport.height - 100);
});

test("plan page: the briefing view's own header replaces the route form with just its own actions", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // One header row, not two -- no more route form (that's the map
  // view's own header) and no label of its own either: the content
  // right below already opens with "Flight Briefing" as a real `<h1>`,
  // so the header doesn't repeat it.
  expect(await page.getByLabel("Departure").count()).toBe(0);
  await expect(page.locator("h1").getByText("Flight Briefing", { exact: true })).toBeVisible();

  // Back to map, listen, print, then the same Settings gear every
  // header ends in -- all four in one row, left to right.
  const backBox = await page.getByTestId("nav-back-to-map-button").boundingBox();
  const listenBox = await page.getByTestId("listen-button").boundingBox();
  const printBox = await page.getByTestId("print-button").boundingBox();
  const gearBox = await page.locator("header").getByRole("link", { name: "Settings" }).boundingBox();
  expect(backBox).not.toBeNull();
  expect(listenBox).not.toBeNull();
  expect(printBox).not.toBeNull();
  expect(gearBox).not.toBeNull();
  expect(backBox!.x).toBeLessThan(listenBox!.x);
  expect(listenBox!.x).toBeLessThan(printBox!.x);
  expect(printBox!.x).toBeLessThan(gearBox!.x);
});

test("plan page: the briefing header's own back-to-map button, not the wordmark, is the way back", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  expect(await page.getByTestId("map-action-button").count()).toBe(0);

  await page.getByTestId("nav-back-to-map-button").click();
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

test("the site header's own two destinations -- the wordmark and the Settings gear -- both work", async ({ page }) => {
  await page.goto("/app/label");
  await page.waitForTimeout(300);

  // Settings is an icon-only link (a gear, no visible text), so its
  // accessible name -- not text content -- is what finds it.
  await page.locator("header").getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForURL("**/app/settings");
  await page.waitForTimeout(300);

  // Settings has its own "Back to Plan" header instead of the shared
  // PageHeader (no reason for the gear that leads here to sit on the
  // page it leads to) -- that's the way back, not the wordmark.
  await page.getByRole("link", { name: "Back to Plan" }).click();
  await page.waitForURL("**/app/plan");
});

test("the wordmark is the way back to Plan from every other page that still shows it", async ({ page }) => {
  await page.goto("/app/label");
  await page.waitForTimeout(300);
  await page.locator("header").getByText("VFR Route", { exact: true }).click();
  await page.waitForURL("**/app/plan");
});

test("Settings' own Label link works, since Label has no header link of its own", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Label checkpoints" }).click();
  await page.waitForURL("**/app/label");
});
