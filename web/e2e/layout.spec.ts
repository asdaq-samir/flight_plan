import { test, expect, type Page, type TestInfo } from "@playwright/test";

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
 * where things actually land once a real layout engine gets to them,
 * which is why the whole file runs under both of playwright.config.ts's
 * own projects (a phone size and a desktop one) rather than picking
 * one -- most tests here compute their own thresholds off
 * `page.viewportSize()`, so the same assertion holds at either size
 * unmodified.
 */

const PAGES = ["/app/plan", "/app/label"] as const;

/** shadcn's Sidebar swaps to a Sheet overlay below its own mobile
 *  breakpoint -- a real behavior change (a different component
 *  entirely, per `useIsMobile()`), not just a resize, so the handful
 *  of tests asserting on that Sheet specifically (`data-mobile`,
 *  `openMobileSidebar`) skip themselves on the "desktop" project
 *  rather than failing on a DOM shape that page was never going to
 *  have. Desktop's own equivalent (`data-state="collapsed"` on the
 *  plain, non-Sheet Sidebar) has its own test further down.  */
function mobileOnly(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "mobile",
    "Sheet sidebar only exists below shadcn's own mobile breakpoint",
  );
}

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
  // No collapsible toolbar anywhere in this app anymore -- the route
  // form is the whole reason a pilot opened either map page, not a
  // settings drawer worth a tap to reveal (see PlanView's/LabelView's
  // own comments on their headers).
  test("the route form is visible immediately, not behind a trigger", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await expect(page.getByLabel("Departure")).toBeVisible();
    expect(await page.getByTestId("toolbar-trigger").count()).toBe(0);
  });

  test("sidebar starts collapsed on load, every load", async ({ page }, testInfo) => {
    mobileOnly(testInfo);
    await page.goto("/app/plan");
    await settle(page);
    // The mobile Sidebar is a Sheet that isn't even mounted until its
    // trigger opens it -- "collapsed" means "not there."
    expect(await page.locator('[data-mobile="true"]').count()).toBe(0);
  });

  test("sidebar opens from its own trigger, closed by default", async ({ page }, testInfo) => {
    mobileOnly(testInfo);
    await page.goto("/app/plan");
    await settle(page);
    await openMobileSidebar(page);
  });

  test("desktop: sidebar starts collapsed, opens and closes from its own trigger", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mobile's own version is above");
    await page.goto("/app/plan");
    await settle(page);
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await page.locator('[data-slot="sidebar-trigger"]').click();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    await page.locator('[data-slot="sidebar-trigger"]').click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });
});

// Deliberately the same shape as the /app/plan describe block above --
// Plan and Label are meant to look and behave like the same shell
// around a different sidebar now (see LabelView's own comment on its
// header), not two pages that happen to share components, so their own
// layout tests are the same tests, not analogous ones. The view
// filters used to live behind their own collapsible toolbar trigger;
// that's gone now (moved into the sidebar's own top, see LabelView),
// so there's nothing toolbar-specific left to test here that Plan's
// own suite doesn't already cover for both.
test.describe("/app/label", () => {
  test("the route form is visible immediately, not behind a trigger", async ({ page }) => {
    await page.goto("/app/label");
    await settle(page);
    await expect(page.getByLabel("Departure")).toBeVisible();
    expect(await page.getByTestId("toolbar-trigger").count()).toBe(0);
  });

  test("sidebar starts collapsed on load, every load", async ({ page }, testInfo) => {
    mobileOnly(testInfo);
    await page.goto("/app/label");
    await settle(page);
    expect(await page.locator('[data-mobile="true"]').count()).toBe(0);
  });

  test("sidebar opens from its own trigger, closed by default", async ({ page }, testInfo) => {
    mobileOnly(testInfo);
    await page.goto("/app/label");
    await settle(page);
    await openMobileSidebar(page);
  });

  test("desktop: sidebar starts collapsed, opens and closes from its own trigger", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mobile's own version is above");
    await page.goto("/app/label");
    await settle(page);
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await page.locator('[data-slot="sidebar-trigger"]').click();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    await page.locator('[data-slot="sidebar-trigger"]').click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
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

    // Plan and Label share the exact same bottom-corner layout now --
    // neither page has anything else floating over the map (each
    // page's own single most-needed action lives in the header
    // instead), so the guide button and the sidebar trigger land on
    // the same `bottom-8` on both, opposite corners, actually level
    // with each other rather than just "somewhere in the bottom half."
    test("guide button sits flush bottom-left, the sidebar trigger flush bottom-right, both level with each other", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("no viewport configured");

      const guideBox = await page.getByTestId("guide-button").boundingBox();
      const sidebarTriggerBox = await page.locator('[data-slot="sidebar-trigger"]').boundingBox();
      expect(guideBox).not.toBeNull();
      expect(sidebarTriggerBox).not.toBeNull();

      expect(guideBox!.x).toBeLessThan(20);
      expect(sidebarTriggerBox!.x + sidebarTriggerBox!.width).toBeGreaterThan(viewport.width - 20);

      // Same bottom-8, same size="icon" -- top edges within a few px
      // of each other, not just both loosely "in the bottom half."
      expect(Math.abs(guideBox!.y - sidebarTriggerBox!.y)).toBeLessThan(4);

      // Both sit just above Leaflet's own attribution control, not
      // flush against the very bottom edge.
      expect(sidebarTriggerBox!.y + sidebarTriggerBox!.height).toBeLessThan(viewport.height - 4);
    });
  });
}

test("label page: the toggle-view action sits in the header next to Load, not floating over the map", async ({ page }, testInfo) => {
  await page.goto("/app/label");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  const loadBox = await page.getByRole("button", { name: "Load" }).boundingBox();
  const actionBox = await page.getByTestId("map-action-button").boundingBox();
  expect(loadBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  // Nowhere near the bottom-left corner a floating action button would
  // otherwise pin it to -- true regardless of viewport.
  expect(actionBox!.y).toBeLessThan(viewport.height - 100);

  // To Load's right, same row -- mirrors Plan's own Chart/Brief pair,
  // including the same desktop-only guarantee (see that test's own
  // comment): a narrow phone wraps this onto its own line below Load
  // rather than shrinking DEP/DEST to force one.
  if (testInfo.project.name === "desktop") {
    expect(actionBox!.x).toBeGreaterThan(loadBox!.x);
    expect(Math.abs(actionBox!.y - loadBox!.y)).toBeLessThan(10);
  }
});

test("plan page: Flight Briefing sits in the header with Load, not floating over the map", async ({ page }, testInfo) => {
  await page.goto("/app/plan");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  const loadBox = await page.getByRole("button", { name: "Load" }).boundingBox();
  const briefingBox = await page.getByTestId("map-action-button").boundingBox();
  expect(loadBox).not.toBeNull();
  expect(briefingBox).not.toBeNull();
  // Nowhere near the bottom-left corner MapActionButton would
  // otherwise pin it to -- true regardless of viewport.
  expect(briefingBox!.y).toBeLessThan(viewport.height - 100);

  // To Load's right, same row -- only guaranteed once the header's
  // own flex-wrap has room to keep them on one line. DEP/DEST keep
  // their full, legible width even when it doesn't (a clipped ident
  // is worse than a second line -- see RouteForm's own comment), so a
  // narrow phone wraps Briefing onto its own line below Load instead
  // of shrinking anything to force one.
  if (testInfo.project.name === "desktop") {
    expect(briefingBox!.x).toBeGreaterThan(loadBox!.x);
    expect(Math.abs(briefingBox!.y - loadBox!.y)).toBeLessThan(10);
  }
});

test("plan page: the briefing view's own header holds its back button and its actions in one panel", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // One panel, not two -- no more route form (that's the map view's
  // own header). "Flight Briefing" is print-only now (see
  // FlightBriefingView's own comment) -- a "Back to Map" button takes
  // its place on screen instead, one clear way back rather than two.
  expect(await page.getByLabel("Departure").count()).toBe(0);
  const backButton = page.getByTestId("nav-back-to-map-button");
  await expect(backButton).toBeVisible();
  await expect(backButton).toHaveText(/Back to Map/);
  await expect(page.locator("header h1")).toBeHidden();

  // Back to map, the narrative split button, print, then the same
  // Settings gear every header ends in -- all four in one row, left
  // to right. Its own dropdown ("listen-button"/"generate-narrative-
  // button") is unmounted until opened -- see the test below for that.
  const backBox = await backButton.boundingBox();
  const narrativeBox = await page.getByTestId("narrative-primary-button").boundingBox();
  const printBox = await page.getByTestId("print-button").boundingBox();
  const gearBox = await page.locator("header").getByRole("link", { name: "Settings" }).boundingBox();
  expect(backBox).not.toBeNull();
  expect(narrativeBox).not.toBeNull();
  expect(printBox).not.toBeNull();
  expect(gearBox).not.toBeNull();
  expect(backBox!.x).toBeLessThan(narrativeBox!.x);
  expect(narrativeBox!.x).toBeLessThan(printBox!.x);
  expect(printBox!.x).toBeLessThan(gearBox!.x);
});

test("plan page: the narrative split button's chevron opens generate/listen as explicit choices", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  await expect(page.getByTestId("generate-narrative-button")).toHaveCount(0);
  await page.getByTestId("narrative-menu-trigger").click();
  await expect(page.getByTestId("generate-narrative-button")).toBeVisible();
  await expect(page.getByTestId("listen-button")).toBeVisible();
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

test("the Settings gear leads there, and its own back button leads back to where it was clicked from", async ({ page }) => {
  await page.goto("/app/label");
  await page.waitForTimeout(300);

  // Settings is an icon-only link (a gear, no visible text), so its
  // accessible name -- not text content -- is what finds it. No shared
  // PageHeader/wordmark left to test alongside it -- Plan, Label and
  // Settings each own a fully custom header now (route form + gear,
  // route form + gear, back button + sign-in), and none of them show
  // one.
  await page.locator("header").getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForURL("**/app/settings");
  await page.waitForTimeout(300);

  // Settings' own back button, not a wordmark, is the way back --
  // reads "Back to Label" specifically because that's where the gear
  // was actually clicked from (SettingsButton's own state.from).
  await page.getByRole("link", { name: "Back to Label" }).click();
  await page.waitForURL("**/app/label");
});

test("Settings' own Label link works, since Label has no header link of its own", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Label checkpoints" }).click();
  await page.waitForURL("**/app/label");
});
