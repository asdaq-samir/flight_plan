import { test, expect } from "@playwright/test";
import { PAGES, settle, expectDrawerClosed, expectDrawerOpen, openSidebar } from "./helpers";

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
  // No collapsible toolbar anywhere in this app anymore -- the route
  // form is the whole reason a pilot opened either map page, not a
  // settings drawer worth a tap to reveal (see PlanWorkspace's/TrainWorkspace's
  // own comments on their headers).
  test("the route form is visible immediately, not behind a trigger", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
    expect(await page.getByTestId("toolbar-trigger").count()).toBe(0);
  });

  test("sidebar starts closed on load, every load", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    await expectDrawerClosed(page);
  });

  test("sidebar opens from its own trigger, closes on Escape", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
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
  test("the route form is visible immediately, not behind a trigger", async ({ page }) => {
    await page.goto("/app/dev");
    await settle(page);
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
  "/app/plan": "Plan a route — VFR Route",
  "/app/dev": "Dev — VFR Route",
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
  // One header row, the same shape as Dev's: no tabs (the briefing is
  // the flight planning drawer, not a second view), and the drawer's
  // toggle in the header's own trailing group, not floating over the
  // map.
  test("the header is one row with no tabs, the screen's bottom row on a phone and its top row from md up, and the sidebar trigger toggles the nav log from it", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport configured");

    await expect(page.locator("header").getByRole("tablist")).toHaveCount(0);
    // On a phone the bottom row, where a thumb reaches it; from md up
    // the top one.
    const headerBox = (await page.locator("header").boundingBox())!;
    if (viewport.width < 768) expect(Math.round(headerBox.y + headerBox.height)).toBe(viewport.height);
    else expect(headerBox.y).toBe(0);
    const departureBox = await page.getByLabel("Departure", { exact: true }).boundingBox();
    const triggerBox = await page.getByTestId("sidebar-trigger-button").boundingBox();
    expect(departureBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.y).toBeGreaterThanOrEqual(headerBox.y);
    expect(triggerBox!.y + triggerBox!.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
    // Leading the form, on the drawer's own side: to its left.
    expect(triggerBox!.x + triggerBox!.width).toBeLessThan(departureBox!.x);

    await page.getByTestId("sidebar-trigger-button").click();
    await expectDrawerOpen(page);
  });
});

for (const path of PAGES) {
  test(`${path}: the zoom toggle sits on the map's right edge, clear of the header, and the settings are the header's, right of the console`, async ({ page }) => {
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport configured");

    const headerBox = await page.locator("header").boundingBox();
    const actionBox = await page.getByTestId("map-action-button").boundingBox();
    expect(headerBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    // On the map, flush with its right edge -- the same on both pages:
    // below the header from md up, and just above it on a phone, whose
    // header is the bottom row, where a thumb reaches it.
    if (viewport.width < 768) {
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(headerBox!.y);
      expect(headerBox!.y - (actionBox!.y + actionBox!.height)).toBeLessThan(120);
    } else {
      expect(actionBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    }
    expect(viewport.width - (actionBox!.x + actionBox!.width)).toBeLessThan(16);
    expect(await page.locator("header").getByTestId("map-action-button").count()).toBe(0);

    // The settings in the header, the last of its buttons: right of the
    // console's.
    const header = page.locator("header");
    const settingsBox = (await header.getByTestId("settings-button").boundingBox())!;
    const consoleBox = (await header.getByTestId(/^(pilot|dev-console)-button$/).boundingBox())!;
    expect(settingsBox.x).toBeGreaterThan(consoleBox.x + consoleBox.width - 1);

    // The settings hold the chart controls.
    await page.getByTestId("settings-button").click();
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
