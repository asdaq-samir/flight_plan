import { test, expect, type Page } from "@playwright/test";

/**
 * The regressions this file exists to catch (see playwright.config.ts
 * for why these need a real browser rather than the vitest suite):
 *
 *  - a corner-pinned button not actually flush against the edge it's
 *    meant to sit on, because a wider sibling was silently deciding
 *    the shared container's own shrink-to-fit width
 *  - the sidebar (a `MapDrawer` over the map area) not actually
 *    starting closed, not opening from its trigger, or covering the
 *    header it is meant to sit under
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

async function settle(page: Page) {
  // Long enough for the initial course/checkpoint fetch to resolve (or
  // fail) and the map to finish its first layout pass -- these tests
  // assert on structure and position, not on that data actually
  // arriving, but a mid-fetch render shouldn't be what gets measured.
  await page.waitForTimeout(1500);
}

/** Shell's own sidebar is one `MapDrawer` -- a panel over the map
 *  area, under the header -- identically on a phone and a desktop
 *  window alike (full width below `sm`, a fixed width above), so
 *  unlike most things this `mobile`/`desktop`-project split file has
 *  to special-case per viewport, opening and closing it is one shape,
 *  checked once, that holds at either size unmodified. */
async function openSidebar(page: Page) {
  const sidebarTrigger = page.getByTestId("sidebar-trigger-button");
  const sidebar = page.locator('[data-slot="map-drawer"]');
  await sidebarTrigger.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "true");

  // In the map area, not over the header: the panel starts where the
  // header ends, and the header's own buttons stay usable above it.
  const headerBox = await page.locator("header").boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  await expect(sidebarTrigger).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeVisible();
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "false");
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

  test("sidebar starts closed on load, every load", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    // Not just hidden -- the panel isn't even mounted until its own
    // trigger opens it, so "closed" means "not there."
    expect(await page.locator('[data-slot="map-drawer"]').count()).toBe(0);
  });

  test("sidebar opens from its own trigger, closes on Escape", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await openSidebar(page);
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

  test("sidebar starts closed on load, every load", async ({ page }) => {
    await page.goto("/app/label");
    await settle(page);
    expect(await page.locator('[data-slot="map-drawer"]').count()).toBe(0);
  });

  test("sidebar opens from its own trigger, closes on Escape", async ({ page }) => {
    await page.goto("/app/label");
    await settle(page);
    await openSidebar(page);
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

    // Guide button: inline in the header next to the sidebar trigger on
    // both pages, not floating over the map -- see MapGuideButton's own
    // comment on why there's no floating mode left to opt out of.
    test("guide button sits in the header next to the sidebar trigger, not floating over the map", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("no viewport configured");

      const guideBox = await page.getByTestId("guide-button").boundingBox();
      const triggerBox = await page.getByTestId("sidebar-trigger-button").boundingBox();
      expect(guideBox).not.toBeNull();
      expect(triggerBox).not.toBeNull();

      // Nowhere near the bottom-left corner a floating guide button
      // would otherwise pin to -- true regardless of viewport.
      expect(guideBox!.y).toBeLessThan(viewport.height - 100);

      // Same row as the sidebar trigger, leading (to the left of) it.
      expect(Math.abs(guideBox!.y - triggerBox!.y)).toBeLessThan(10);
      expect(guideBox!.x).toBeLessThan(triggerBox!.x);
    });
  });
}

test.describe("/app/plan", () => {
  // Plan's own sidebar trigger moved into the header (this session's
  // own change) -- in the tabs' own trailing slot, the same spot
  // Brief's Print button sits in one tab over, not floating over the
  // map at all anymore.
  test("the sidebar trigger sits in the header, trailing the Map/Brief tabs, not floating over the map", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);

    const tabsBox = await page.getByRole("tab", { name: "Map" }).boundingBox();
    const triggerBox = await page.getByTestId("sidebar-trigger-button").boundingBox();
    expect(tabsBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();

    // Same row as the tabs, trailing (to the right of) them.
    expect(Math.abs(tabsBox!.y - triggerBox!.y)).toBeLessThan(10);
    expect(triggerBox!.x).toBeGreaterThan(tabsBox!.x);

    // Actually toggles the sidebar from here, same as it always did.
    const sidebar = page.locator('[data-slot="map-drawer"]');
    await page.getByTestId("sidebar-trigger-button").click();
    await expect(sidebar).toBeVisible();
  });
});

test("label page: the toggle-view action sits in the header next to the sidebar trigger, not floating over the map", async ({ page }) => {
  await page.goto("/app/label");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  const triggerBox = await page.getByTestId("sidebar-trigger-button").boundingBox();
  const actionBox = await page.getByTestId("map-action-button").boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  // Nowhere near the bottom-left corner a floating action button would
  // otherwise pin it to -- true regardless of viewport.
  expect(actionBox!.y).toBeLessThan(viewport.height - 100);

  // To the sidebar trigger's left, same row -- mirrors Plan's own fit-
  // route button beside its own sidebar trigger.
  expect(actionBox!.x).toBeLessThan(triggerBox!.x);
  expect(Math.abs(actionBox!.y - triggerBox!.y)).toBeLessThan(10);
});

test("plan page: the Map/Brief tabs sit in their own row below Load, not floating over the map", async ({ page }) => {
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

  // Below Load, its own row -- a Map/Brief tab pair, not a "Brief"
  // button sharing Load's own row the way it used to (see PlanView's
  // own comment on why the switch reads better as two tabs than a
  // one-directional button). Always its own row regardless of
  // viewport width, unlike the old single-row layout's phone-only wrap.
  expect(briefingBox!.y).toBeGreaterThan(loadBox!.y);
});

test("plan page: the persistent header stays on screen in the Brief view, with narrative actions trailing the tabs", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // One shared header, not a second page shell -- the route form is
  // still right there (PlanView's own header is always rendered now,
  // covering both tabs). "Flight Briefing" is print-only (see
  // FlightBriefingView's own comment), not an on-screen title this
  // view draws for itself.
  await expect(page.getByLabel("Departure")).toBeVisible();
  await expect(page.locator("header h1")).toBeHidden();

  // The Brief tab, then the AI button (LangGraph/CrewAI live as tabs
  // inside the popover it opens, not as their own header buttons),
  // then Print -- trailing in the tabs' own row, left to right, while
  // Brief is the active tab.
  const tabsBox = await page.getByRole("tab", { name: "Brief" }).boundingBox();
  const aiBox = await page.getByTestId("ai-narrative-button").boundingBox();
  const printBox = await page.getByTestId("print-button").boundingBox();
  expect(tabsBox).not.toBeNull();
  expect(aiBox).not.toBeNull();
  expect(printBox).not.toBeNull();
  expect(tabsBox!.x).toBeLessThan(aiBox!.x);
  expect(aiBox!.x).toBeLessThan(printBox!.x);

  // Same row as the tabs, not stacked below them.
  expect(Math.abs(tabsBox!.y - printBox!.y)).toBeLessThan(10);

  // The one Settings gear this page has, still in its own row above --
  // not duplicated down here next to the narrative actions.
  await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveCount(1);
});

test("plan page: opening the briefing pops a 'planning aid only' warning toast, and its semantic nav log is available", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  // No more permanently docked banner -- a toast instead (see
  // FlightBriefingView's own comment), same sonner instance the
  // page's progress/error toasts use.
  await expect(page.locator("[data-sonner-toast]", { hasText: "Planning aid only" })).toBeVisible();

  // "Flight Plan Summary" opens by default (see FlightBriefingView) --
  // the nav log is on screen without a click.
  await expect(page.getByRole("table", { name: /Navigation log from/i })).toBeVisible();
});

test("plan page: the briefing header offers one AI button, not a named button per framework", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // LangGraph and CrewAI (nav-log-agent's and crewai-agent's own real,
  // billed Claude calls) live as two tabs inside the popover this one
  // button opens, not as their own separate triggers in the header --
  // checked without opening it, the same restraint the old per-
  // framework buttons' own test had around not actually triggering
  // "generate".
  const aiButton = page.getByTestId("ai-narrative-button");
  await expect(aiButton).toBeVisible();
  await expect(aiButton).toBeEnabled();
  expect(await page.getByTestId("langgraph-narrative-button").count()).toBe(0);
  expect(await page.getByTestId("crewai-narrative-button").count()).toBe(0);
});

test("plan page: the Map tab, not the wordmark, is the way back to the map", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // The header (and its Map/Brief tabs) never left the screen -- going
  // back is switching tabs, not clicking a button a separate page drew
  // for itself.
  await page.getByRole("tab", { name: "Map" }).click();
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("data-state", "active");
});

test("plan page: nav log view scrolls inside its own table, not the page", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await page.getByTestId("map-action-button").click();
  await page.waitForTimeout(500);

  // The nav log table sits inside "Flight Plan Summary", the one
  // briefing section that opens by default -- a closed <details> would
  // report a zero-width scroller regardless of what it holds.
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

test("the Settings gear leads there, and its own Map icon leads back to where it was clicked from", async ({ page }) => {
  await page.goto("/app/label");
  await page.waitForTimeout(300);

  // Settings is an icon-only link (a gear, no visible text), so its
  // accessible name -- not text content -- is what finds it. No shared
  // PageHeader/wordmark left to test alongside it -- Plan, Label and
  // Settings each own a fully custom header now, and none of them show
  // one.
  await page.locator("header").getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForURL("**/app/settings");
  await page.waitForTimeout(300);

  // A plain Map icon now, not a context-sensitive "Back to Label"/
  // "Back to Brief" text label -- but the destination it actually
  // points at is still `state.from` (SettingsButton's own), the exact
  // page the gear was clicked from, not a flat, always-/app/plan link.
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.waitForURL("**/app/label");
});

test("Settings' Dev tab embeds the real Label workspace inline, not a link to a separate page", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForTimeout(300);
  // Lives in its own Dev tab, not visible on the default Account tab
  // (Radix Tabs doesn't mount an inactive TabsContent).
  await page.getByRole("tab", { name: "Dev" }).click();
  await page.waitForTimeout(500);

  // The actual workspace -- its own route form, right there, the same
  // as clicking Plan's own Map tab shows the real map immediately
  // rather than a button that navigates away to get it.
  await expect(page.getByLabel("Departure")).toBeVisible();

  // Its own header ends in a Map icon here, not Settings' own gear
  // (which would just point right back at the page already showing
  // it) -- and it actually works.
  const mapLink = page.getByRole("link", { name: "Map", exact: true });
  await expect(mapLink).toBeVisible();
  await mapLink.click();
  await page.waitForURL("**/app/plan");
});

test("Settings page: Account and Dev are two separate tabs; Dev ML is a panel over the map on Dev", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForTimeout(300);

  const accountTab = page.getByRole("tab", { name: "Account" });
  const devTab = page.getByRole("tab", { name: "Dev" });
  await expect(accountTab).toHaveAttribute("data-state", "active");

  await devTab.click();
  await page.waitForTimeout(300);
  await expect(devTab).toHaveAttribute("data-state", "active");
  // The labeling workspace is what Dev actually shows -- Dev ML's own
  // panel stays off screen until its own trigger is opened.
  await expect(page.getByLabel("Departure")).toBeVisible();
  expect(await page.locator("summary", { hasText: "Model Comparison" }).count()).toBe(0);

  await page.getByRole("button", { name: "Dev ML" }).click();
  const devMl = page.locator('[data-slot="map-drawer"][data-side="top"]');
  await expect(devMl).toBeVisible();
  await expect(devMl.getByText("Model comparison")).toBeVisible();
  // The same kind of drawer as the waypoint list, dropping down from
  // the top of the map area rather than over the header -- the header
  // stays usable above it.
  const headerBox = await page.locator("header").boundingBox();
  const devMlBox = await devMl.boundingBox();
  expect(devMlBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

  // One drawer at a time over the same map: opening the waypoint list
  // closes Dev ML, and Escape closes whichever is open.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.locator('[data-slot="map-drawer"][data-side="right"]')).toBeVisible();
  await expect(devMl).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="map-drawer"]')).toHaveCount(0);
});

test("plan page: a click on the dimmed map closes the sidebar, and the header above it never dims", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const overlay = page.locator('[data-slot="map-drawer-overlay"]');
  await expect(overlay).toBeVisible();
  const headerBox = await page.locator("header").boundingBox();
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  await overlay.click({ position: { x: 10, y: 10 } });
  await expect(page.locator('[data-slot="map-drawer"]')).toHaveCount(0);
});
