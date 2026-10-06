import { test, expect } from "@playwright/test";
import { PAGES, settle, expectDrawerClosed, expectDrawerOpen, openSidebar, sideDrawer, openSettings, openPanel, closeSidebarWithTheStockKey } from "./helpers";

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
 *
 * The pages' other tests are in files of their own, by subject:
 * briefing, checkpoints, map, plans, switch, dev-page, consoles and
 * tiles. Their names are chosen for CI as well: `--shard` cuts the
 * suite, in file order, into equal counts of tests, and while nearly
 * every test was here the slow ones (the altitude plans, the popups,
 * the worklist, the TAC) fell on the same two shards of eight.
 */

test.describe("/app/plan", () => {
  // At rest the panel is Maps' capsule: with no route a search bar, with
  // one the route, its chip opening the panel on the route form.
  test("the panel rests on a search bar with no route, and on the route in a capsule whose chip opens its form", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await closeSidebarWithTheStockKey(page);
    await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
    await expect(page.getByTestId("search-airports")).toBeVisible();
    await page.goto("/app/plan?dep=C81&dest=KDLH");
    await settle(page);
    await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KDLH");
    await openPanel(page);
    await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
    expect(await page.getByTestId("toolbar-trigger").count()).toBe(0);
  });

  // Opened, the planner is Maps opened: no route, the sheet half way up
  // on the search bar with the console's button beside it, Favorites
  // under it. A route's link lands on the route, the panel at rest; a
  // reload forgets it (lib/freshLoad).
  test("a fresh load opens on the search half way up, a route's link on the route at rest, and a reload forgets the route", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
    await expect(page.getByTestId("search-airports")).toBeVisible();
    await expect(sideDrawer(page).getByTestId("settings-button")).toBeVisible();
    await expect(page.getByTestId("search-close")).toHaveCount(0);
    await expect(page.getByTestId("favorite-home")).toBeVisible();

    await page.goto("/app/plan?dep=C81&dest=KDLH");
    await settle(page);
    await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KDLH");
    await expectDrawerClosed(page);

    await page.reload();
    await settle(page);
    await expect(page).not.toHaveURL(/[?&]dep=/);
    await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
    await expect(page.getByTestId("search-airports")).toBeVisible();
  });

  test("sidebar opens from its own trigger, closes on Escape", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await closeSidebarWithTheStockKey(page);
    await expectDrawerClosed(page);
    await openSidebar(page);
  });
});

// Deliberately the same shape as the /app/plan describe block above --
// Plan and Label are meant to look and behave like the same shell
// around a different sidebar now (see TrainWorkspace's own comment on its
// header), not two pages that happen to share components, so their own
// layout tests are the same tests, not analogous ones. The view
// filters used to live behind their own collapsible toolbar trigger;
// that's gone now (moved into the sidebar's own top, see TrainWorkspace),
// so there's nothing toolbar-specific left to test here that Plan's
// own suite doesn't already cover for both.
test.describe("/app/dev", () => {
  test("the panel rests on the route in a capsule, its chip opening the route form", async ({ page }) => {
    await page.goto("/app/dev");
    await settle(page);
    await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KDLH");
    await openPanel(page);
    await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
    expect(await page.getByTestId("toolbar-trigger").count()).toBe(0);
  });

  test("sidebar starts closed on load, every load", async ({ page }) => {
    await page.goto("/app/dev");
    await settle(page);
    await expectDrawerClosed(page);
  });

  test("sidebar opens from its own trigger, closes on Escape", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/app/dev");
    await settle(page);
    await openSidebar(page);
  });

  test("the old labeling address still lands here, route and all", async ({ page }) => {
    await page.goto("/app/label?dep=C81&dest=KDLH");
    await page.waitForURL("**/app/dev?dep=C81&dest=KDLH");
  });
});

const TITLES: Record<string, string> = {
  "/app/plan": "Plan a route — Wingtip Maps",
  "/app/dev": "Dev — Wingtip Maps",
};

for (const path of PAGES) {
  test.describe(path, () => {
    // The page renders its own <title> and React hoists it into the
    // head, above index.html's own static one (which is there for a
    // crawler that never runs JS). Both are in the document; the
    // browser reads the first, so this pins which wins.
    test("the browser tab is named for this page, not the static fallback", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await expect(page).toHaveTitle(TITLES[path]!);
    });

    test("no page-level horizontal overflow", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflowing).toBe(false);
    });

    // No guide button in either header any more: the planner's guide
    // lives in the Pilot drawer's Guide tab, the rating guide in the
    // Developer drawer's own rating step.
    test("no info button in the header", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      expect(await page.getByTestId("guide-button").count()).toBe(0);
    });
  });
}

test.describe("/app/plan", () => {
  // One bar, the panel's head, the same shape as Dev's: no tabs in it
  // (the briefing is the flight planning panel, not a second view), the
  // route leading it, and the panel's grabber on its far edge.
  test("the panel's head is the page's one bar, with no tabs: at the bottom of a phone and the top from md up, the route leading it, and the panel's grabber opens the nav log", async ({ page }) => {
    await page.goto("/app/plan?dep=C81&dest=KDLH");
    await settle(page);
    // Out half way, where the head is the route form (at rest, the capsule).
    await openPanel(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport configured");
    const phone = viewport.width < 768;

    const header = page.locator("header");
    await expect(header.getByRole("tablist")).toHaveCount(0);
    const headerBox = (await header.boundingBox())!;
    if (phone) expect(headerBox.y).toBeGreaterThan(viewport.height / 2);
    else expect(headerBox.y).toBeLessThan(40);
    const departureBox = (await header.getByLabel("Departure", { exact: true }).boundingBox())!;
    expect(departureBox.x - headerBox.x).toBeLessThan(40);

    // The grabber on the panel's far edge: the top of a phone's sheet,
    // the bottom of a card at the top of the screen -- once the sheet has
    // come to rest: measured once, a busy runner caught it moving, 7.6 px
    // off, then 2.2 and 2.9 on its retries (main's run 37340767548).
    await expect(async () => {
      const panelBox = (await sideDrawer(page).boundingBox())!;
      const grabber = (await page.getByTestId("sidebar-trigger-button").boundingBox())!;
      if (phone) expect(Math.abs(grabber.y - panelBox.y)).toBeLessThan(2);
      else expect(Math.abs(grabber.y + grabber.height - (panelBox.y + panelBox.height))).toBeLessThan(2);
    }).toPass({ timeout: 10_000 });
    // A tap lowers it from half way, and the next opens it all the way.
    await page.getByTestId("sidebar-trigger-button").click();
    await expectDrawerClosed(page);
    await page.getByTestId("sidebar-trigger-button").click();
    await expectDrawerOpen(page);
  });
});

for (const path of PAGES) {
  test(`${path}: the map's buttons sit at the map's right edge, away from the panel, and the console's button is on the panel's capsule: the planner's search bar, the training page's route`, async ({ page }) => {
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport configured");

    const first = page.locator("[data-map-controls] button").first();
    const firstBox = (await first.boundingBox())!;
    // On the map, flush with its right edge -- the same on both pages: at
    // the top over a phone's sheet, at the bottom under a desktop's card.
    expect(viewport.width - (firstBox.x + firstBox.width)).toBeLessThan(20);
    if (viewport.width < 768) expect(firstBox.y).toBeLessThan(viewport.height / 2);
    else expect(firstBox.y).toBeGreaterThan(viewport.height / 2);
    // Never among the map's buttons, on either page.
    expect(await page.locator("[data-map-controls]").getByTestId("settings-button").count()).toBe(0);
    if (path === "/app/dev") {
      // At the end of the training page's route capsule, which has no
      // search bar.
      await expect(sideDrawer(page).getByTestId("settings-button")).toBeVisible();
    } else {
      // At the end of the route's capsule, as at the search bar's once
      // the route is closed, as Maps' account is.
      await expect(sideDrawer(page).getByTestId("settings-button")).toBeVisible();
      await page.goto(path);
      await settle(page);
      await expect(sideDrawer(page).getByTestId("settings-button")).toBeVisible();
      expect(await page.locator("[data-map-controls]").getByTestId("settings-button").count()).toBe(0);
    }

    // The settings, the console's last tab, hold the chart controls.
    await openSettings(page);
    await expect(page.getByTestId("base-chart-select")).toBeVisible();
    await expect(page.getByTestId("tac-toggle")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test(`${path}: the full-screen button takes the whole screen and gives it back`, async ({ page }) => {
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    // The map has to have drawn something before this test can say
    // anything about it redrawing. `settle` waits a fixed 1.5s, which
    // is plenty when the planner is idle and not always enough when
    // three other workers are asking it for chart tiles.
    await expect(page.locator("img.leaflet-tile").first()).toBeAttached();
    // Drawn only where it would work: Chromium allows it, an iPad
    // does, an iPhone does not and the button is absent there rather
    // than present and refusing (see `FullscreenButton`).
    expect(await page.evaluate(() => document.fullscreenEnabled)).toBe(true);
    const button = page.getByTestId("fullscreen-button");
    await expect(button).toHaveAttribute("aria-label", "Full screen");

    await button.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(button).toHaveAttribute("aria-label", "Leave full screen");
    // The map re-measured rather than keeping its old size: it is
    // still drawing tiles (`ResizeAware` watches the container).
    await expect(page.locator("img.leaflet-tile").first()).toBeAttached();

    await button.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(button).toHaveAttribute("aria-label", "Full screen");
  });
}
