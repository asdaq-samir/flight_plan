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

const PAGES = ["/app/plan", "/app/dev"] as const;

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
    await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
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
    expect(await page.locator('[data-slot="map-drawer"]').count()).toBe(0);
  });

  test("sidebar opens from its own trigger, closes on Escape", async ({ page }) => {
    await page.goto("/app/dev");
    await settle(page);
    await openSidebar(page);
  });

  test("the old labeling address still lands here, route and all", async ({ page }) => {
    await page.goto("/app/label?dep=C81&dest=KDLH");
    await page.waitForURL("**/app/dev?dep=C81&dest=KDLH");
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

/** The briefing is the nav log drawer opened wide: open the drawer
 *  from its header toggle, then widen it from its own. */
async function openBriefing(page: Page) {
  await page.getByTestId("sidebar-trigger-button").click();
  await page.getByTestId("sidebar-expand-toggle").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
}

test.describe("/app/plan", () => {
  // One header row, the same shape as Dev's: no tabs (the briefing is
  // the nav log drawer opened wide, not a second view), and the nav
  // log's toggle in the header's own trailing group, not floating over
  // the map.
  test("the header is one row with no tabs, and the sidebar trigger toggles the nav log from it", async ({ page }) => {
    await page.goto("/app/plan");
    await settle(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport configured");

    await expect(page.locator("header").getByRole("tablist")).toHaveCount(0);
    const loadBox = await page.getByRole("button", { name: "Load" }).boundingBox();
    const triggerBox = await page.getByTestId("sidebar-trigger-button").boundingBox();
    expect(loadBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.y).toBeLessThan(viewport.height - 100);
    // Trailing the form: to its right, on its row (a desktop) or the
    // row under it (a phone), never above it.
    expect(triggerBox!.x).toBeGreaterThan(loadBox!.x);
    expect(triggerBox!.y).toBeGreaterThanOrEqual(loadBox!.y - 20);

    const sidebar = page.locator('[data-slot="map-drawer"]');
    await page.getByTestId("sidebar-trigger-button").click();
    await expect(sidebar).toBeVisible();
  });
});

test("dev page: the toggle-view action sits in the header next to the sidebar trigger, not floating over the map", async ({ page }) => {
  await page.goto("/app/dev");
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

test("plan page: the nav log drawer opens wide as the briefing, with the narrative and Print in its own header, the map still beside it", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  // Narrow first: the table beside the map.
  await page.getByTestId("sidebar-trigger-button").click();
  const drawer = page.locator('[data-slot="map-drawer"][data-side="right"]');
  await expect(drawer).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  const narrowBox = await drawer.boundingBox();
  expect(narrowBox).not.toBeNull();

  // Wide: the same drawer, the URL says briefing, and it grew -- to the
  // whole map area on a phone, most of it on a desktop, never all of
  // it: the map stays visible beside the briefing.
  await page.getByTestId("sidebar-expand-toggle").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expect(drawer).toBeVisible();
  const wideBox = await drawer.boundingBox();
  expect(wideBox!.width).toBeGreaterThan(narrowBox!.width);
  if (viewport.width < 640) expect(wideBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  else expect(wideBox!.width).toBeLessThan(viewport.width);

  // The page's own header is still there above it: the route form,
  // and the one Dev-mode switch this page has.
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  await expect(page.locator("header").getByRole("switch", { name: "Dev mode" })).toHaveCount(1);

  // The briefing's actions live in the drawer's own header: the AI
  // button (LangGraph/CrewAI are tabs inside the popover it opens),
  // then Print, left to right on one row.
  const aiBox = await drawer.getByTestId("ai-narrative-button").boundingBox();
  const printBox = await drawer.getByTestId("print-button").boundingBox();
  expect(aiBox).not.toBeNull();
  expect(printBox).not.toBeNull();
  expect(aiBox!.x).toBeLessThan(printBox!.x);
  expect(Math.abs(aiBox!.y - printBox!.y)).toBeLessThan(10);
  // Inside the drawer, not the page header.
  expect(await page.locator("header").getByTestId("print-button").count()).toBe(0);
});

test("plan page: opening the briefing pops a 'planning aid only' warning toast, with the nav log and the summary on screen", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);
  // No more permanently docked banner -- a toast instead (see
  // FlightBriefingView's own comment), same sonner instance the
  // page's progress/error toasts use.
  await expect(page.locator("[data-sonner-toast]", { hasText: "Planning aid only" })).toBeVisible();

  // One nav log: the same semantic table the narrow drawer shows, now
  // folded into its own closed section at the top so every section's
  // title is on screen at once, and opened on a click. No summary
  // section: the drawer's own header already carries the totals, the
  // altitude and the aeroplane.
  // By CSS, not role: a table inside a closed <details> is out of the
  // accessibility tree, which is the point being checked.
  const drawer = page.locator('[data-slot="map-drawer"][data-side="right"]');
  const navLog = drawer.locator("table");
  await expect(navLog).toHaveCount(1);
  await expect(navLog).toBeHidden();
  await expect(drawer.getByText("Nav log", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Flight Plan Summary")).toHaveCount(0);
  await expect(drawer.getByText("Adverse Conditions")).toBeVisible();
  await expect(drawer.getByText("Airport Information")).toBeVisible();
  await drawer.getByText("Nav log", { exact: true }).click();
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeVisible();
});

test("plan page: the briefing offers one AI button, not a named button per framework", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);

  // LangGraph and CrewAI (nav-log-agent's and crewai-agent's own real,
  // billed Claude calls) live as two tabs inside the popover this one
  // button opens, not as their own separate triggers -- checked
  // without opening it, the same restraint the old per-framework
  // buttons' own test had around not actually triggering "generate".
  const aiButton = page.getByTestId("ai-narrative-button");
  await expect(aiButton).toBeVisible();
  await expect(aiButton).toBeEnabled();
  expect(await page.getByTestId("langgraph-narrative-button").count()).toBe(0);
  expect(await page.getByTestId("crewai-narrative-button").count()).toBe(0);
});

test("plan page: the briefing narrows back to the nav log from its own toggle, and Escape closes the drawer", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);
  const drawer = page.locator('[data-slot="map-drawer"][data-side="right"]');
  await expect(drawer.getByText("Adverse Conditions")).toBeVisible();

  // Back to the nav log: the drawer stays open, narrow, the URL no
  // longer says briefing, and the briefing's sections are gone.
  await page.getByTestId("sidebar-expand-toggle").click();
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Adverse Conditions")).toHaveCount(0);
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeVisible();

  // Escape from the briefing closes the whole drawer, URL included.
  await page.getByTestId("sidebar-expand-toggle").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="map-drawer"]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
});

test("plan page: a pasted briefing link opens the drawer wide, and 'n' toggles it", async ({ page }) => {
  await page.goto("/app/plan?view=briefing");
  await settle(page);
  const drawer = page.locator('[data-slot="map-drawer"][data-side="right"]');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("print-button")).toBeVisible();

  await page.keyboard.press("n");
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("print-button")).toHaveCount(0);

  await page.keyboard.press("n");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expect(drawer.getByTestId("print-button")).toBeVisible();
});

test("plan page: the arrow keys and a click walk the nav log's checkpoints, in the drawer and in the briefing alike", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const table = page.getByRole("table", { name: /Navigation log from/i });
  // The rows arrive with the scored checkpoints; wait for more than
  // the departure and the destination.
  await expect.poll(async () => table.locator("tbody tr[data-selected], tbody tr").count(), { timeout: 15000 }).toBeGreaterThan(4);
  const selectedRow = table.locator("tbody tr[data-selected]");
  await expect(selectedRow).toHaveCount(0);

  // Down from nothing selects the departure; down again, the first
  // checkpoint.
  await page.keyboard.press("ArrowDown");
  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow.first().locator("td").first()).toHaveText("C81");
  await page.keyboard.press("ArrowDown");
  await expect(selectedRow.first().locator("td").first()).not.toHaveText("C81");
  const afterTwo = await selectedRow.first().locator("td").first().textContent();

  // Up goes back to the departure.
  await page.keyboard.press("ArrowUp");
  await expect(selectedRow.first().locator("td").first()).toHaveText("C81");

  // A click selects that row directly.
  const rows = table.locator("tbody tr[tabindex='0']");
  await rows.nth(2).click();
  await expect(selectedRow.first().locator("td").first()).toHaveText(await rows.nth(2).locator("td").first().innerText());

  // The same walk with the briefing open and its nav log section
  // unfolded: the map is still mounted beside it, so nothing changes.
  await page.getByTestId("sidebar-expand-toggle").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await page.getByText("Nav log", { exact: true }).click();
  await expect(table).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(selectedRow.first().locator("td").first()).toHaveText(afterTwo ?? "");
});

test("plan page: the briefing's nav log scrolls inside the drawer, not the page", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);
  await page.waitForTimeout(500);

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

test("the Dev-mode switch leads the route form, flips to the dev page with the route, and back to where it was flipped from", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openBriefing(page);

  // Off on Plan, and on the route form's left -- the one control that
  // switches roles, in the same place on both pages.
  const devSwitch = page.locator("header").getByRole("switch", { name: "Dev mode" });
  await expect(devSwitch).toHaveAttribute("aria-checked", "false");
  const switchBox = await devSwitch.boundingBox();
  const loadBox = await page.getByRole("button", { name: "Load" }).boundingBox();
  expect(switchBox).not.toBeNull();
  expect(loadBox).not.toBeNull();
  expect(switchBox!.x).toBeLessThan(loadBox!.x);

  // On: the dev page, with the route on screen carried along and
  // Plan's own briefing parameter left behind.
  await devSwitch.click();
  await page.waitForURL(/\/app\/dev\?dep=C81&dest=KDLH$/);
  await page.waitForTimeout(300);
  await expect(page.locator("header").getByRole("switch", { name: "Dev mode" })).toHaveAttribute("aria-checked", "true");

  // Off again: back to exactly where it was flipped from (`state.from`,
  // DevSwitch's own), the open briefing included, not a flat /app/plan.
  await page.locator("header").getByRole("switch", { name: "Dev mode" }).click();
  await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH&view=briefing$/);
  await expect(page.locator('[data-slot="map-drawer"][data-side="right"]').getByTestId("print-button")).toBeVisible();
});

test("the dev page's header is grey, the planner's is not", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const pilotBg = await page.locator("header").evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator("header")).toHaveAttribute("data-mode", "pilot");
  await page.goto("/app/dev");
  await settle(page);
  const devBg = await page.locator("header").evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator("header")).toHaveAttribute("data-mode", "dev");
  expect(devBg).not.toBe(pilotBg);
});

test("plan page: the nav log's altitude opens the planner's own reasoning, and the briefing's Cruise Altitude section carries the same steps", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  // The altitude arrives with the nav log stream, after the checkpoints.
  const why = page.getByTestId("altitude-why");
  await expect(why).toBeVisible({ timeout: 60000 });
  await expect(why).toContainText(/\d ft · lowest/);
  await why.click();
  const popover = page.locator("[data-slot=popover-content]");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Floor");
  await expect(popover).toContainText("Ceiling");
  await expect(popover).toContainText("14 CFR 91.159");
  await expect(popover).toContainText("Three plans");
  await expect(popover).toContainText("Checked, not part of the choice");
  // The three plans are buttons, the flown one pressed; picking another
  // re-plans on it and the URL carries the choice.
  for (const kind of ["lowest", "highest", "fastest"]) {
    await expect(popover.getByTestId(`altitude-plan-${kind}`)).toBeVisible();
  }
  await expect(popover.getByTestId("altitude-plan-lowest")).toHaveAttribute("aria-pressed", "true");
  await popover.getByTestId("altitude-plan-fastest").click();
  await expect(page).toHaveURL(/[?&]altitude_choice=fastest/);
  await expect(page.getByTestId("altitude-why")).toContainText("fastest", { timeout: 30000 });
  await page.getByTestId("altitude-why").click();
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId("altitude-plan-fastest")).toHaveAttribute("aria-pressed", "true");

  // A custom altitude: the fourth row under the plans. Typed and flown,
  // the whole log is at it, the header says it is the pilot's own, and
  // the plans stay offered beside it with none pressed.
  await popover.getByTestId("custom-altitude").fill("3500");
  await popover.getByTestId("custom-altitude-fly").click();
  await expect(page).toHaveURL(/[?&]altitude_ft=3500/);
  await expect(page.getByTestId("altitude-why")).toContainText("3,500 ft · yours", { timeout: 30000 });
  await expect(page.locator('[data-slot="map-drawer"] table tbody tr[tabindex="0"]').nth(1).locator("td").nth(1)).toHaveText("3,500", { timeout: 30000 });
  await page.getByTestId("altitude-why").click();
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId("altitude-plan-fastest")).toHaveAttribute("aria-pressed", "false");
  // Back to a plan: the custom box empties and the URL drops it.
  await popover.getByTestId("altitude-plan-lowest").click();
  await expect(page).not.toHaveURL(/[?&]altitude_ft=/);
  await expect(page.getByTestId("altitude-why")).toContainText("lowest", { timeout: 30000 });
  // No altitude box in the table's head any more: Alt is a plain heading.
  await expect(page.locator('[data-slot="map-drawer"] table thead')).not.toContainText("Cruise altitude");
  expect(await page.locator('[data-slot="map-drawer"] table thead input').count()).toBe(0);

  // Escape closes the popover and leaves the drawer open.
  await page.getByTestId("altitude-why").click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(page.locator('[data-slot="map-drawer"]')).toBeVisible();

  await page.getByTestId("sidebar-expand-toggle").click();
  await page.waitForTimeout(300);
  const drawer = page.locator('[data-slot="map-drawer"][data-side="right"]');
  await drawer.getByText("Cruise Altitude", { exact: true }).click();
  await expect(drawer.getByText("14 CFR 91.159")).toBeVisible();
});

test("plan page: a departure time gives every checkpoint an ETA and picks the winds forecast period", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const table = page.getByRole("table", { name: /Navigation log from/i });
  await expect(table.locator("thead")).not.toContainText("ETA");

  // The day after tomorrow at 15:00 in the browser's own zone: always
  // more than 18 hours out, so the 24-hour winds product, and daytime
  // in Chicago whether the browser keeps UTC (a test container) or
  // Central time, so the day reserve.
  const when = new Date();
  when.setDate(when.getDate() + 2);
  when.setHours(15, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T15:00`;
  await page.getByTestId("depart-input").fill(local);
  await expect(page).toHaveURL(/[?&]depart=/);
  await expect(table.locator("thead")).toContainText("ETA");
  // The ETA column by its heading: the print-only ATA and fuel columns
  // sit after it, empty on screen.
  const etaIndex = (await table.locator("thead th").allTextContents()).indexOf("ETA");
  expect(etaIndex).toBeGreaterThan(0);
  // The departure row's own ETA is the departure time itself.
  await expect(table.locator("tbody tr[tabindex='0']").first().locator("td").nth(etaIndex)).toHaveText("15:00");
  await expect(page.getByTestId("winds-forecast")).toContainText("24-hour forecast", { timeout: 60000 });
  // Every later row has a time once its leg is in.
  await expect.poll(async () => (await table.locator("tbody tr[tabindex='0']").last().locator("td").nth(etaIndex).textContent())?.trim(), { timeout: 60000 }).toMatch(/^\d\d:\d\d$/);
  // And the fuel check, against the stock C172's 40 usable gallons,
  // with the day reserve for a mid-afternoon flight.
  await expect(page.getByTestId("fuel-check")).toContainText("of 40 usable", { timeout: 60000 });
  await expect(page.getByTestId("fuel-check")).toContainText("30 min day reserve");
});

test("dev page opened on its own: the switch falls back to the planner with the dev page's own route", async ({ page }) => {
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await page.locator("header").getByRole("switch", { name: "Dev mode" }).click();
  await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH$/);
});

test("the old Settings address lands on the planner", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForURL("**/app/plan");
});

test("plan page: the pilot console drops down over the map with sign-in, aeroplanes and flights, one drawer at a time with the nav log", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  expect(await page.locator('[data-slot="map-drawer"]').count()).toBe(0);

  await page.getByTestId("pilot-button").click();
  const pilot = page.locator('[data-slot="map-drawer"][data-side="top"]');
  await expect(pilot).toBeVisible();
  await expect(pilot.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(pilot.getByRole("heading", { name: "Aircraft" })).toBeVisible();
  await expect(pilot.getByRole("heading", { name: "My Flights" })).toBeVisible();
  // Under the header, like every drawer: the route form above it stays
  // usable. Polled: a top drawer slides down into place, and a box
  // measured mid-slide sits above where it ends up.
  const headerBox = await page.locator("header").boundingBox();
  await expect.poll(async () => (await pilot.boundingBox())!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

  // The nav log takes its place; Escape clears whichever is open.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.locator('[data-slot="map-drawer"][data-side="right"]')).toBeVisible();
  await expect(pilot).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="map-drawer"]')).toHaveCount(0);
});

test("dev page: the dev console drops down over the chart, one drawer at a time with the waypoint list", async ({ page }) => {
  await page.goto("/app/dev");
  await settle(page);
  // The labeling workspace is the page -- the console stays off screen
  // until its own trigger is opened.
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  expect(await page.locator('[data-slot="map-drawer"]').count()).toBe(0);

  await page.getByTestId("dev-console-button").click();
  const devMl = page.locator('[data-slot="map-drawer"][data-side="top"]');
  await expect(devMl).toBeVisible();
  await expect(devMl.getByText("Model comparison")).toBeVisible();
  // The developer's console: one tab per thing the repo does that a
  // pilot never sees.
  for (const name of ["Model", "Corridors", "System"]) {
    await expect(devMl.getByRole("tab", { name })).toBeVisible();
  }
  await devMl.getByRole("tab", { name: "System" }).click();
  await expect(devMl.getByText("planning-service", { exact: true })).toBeVisible();
  await devMl.getByRole("tab", { name: "Model" }).click();
  // The same kind of drawer as the waypoint list, dropping down from
  // the top of the map area rather than over the header -- the header
  // stays usable above it.
  const headerBox = await page.locator("header").boundingBox();
  await expect.poll(async () => (await devMl.boundingBox())!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

  // One drawer at a time over the same map: opening the waypoint list
  // closes Dev ML, and Escape closes whichever is open.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.locator('[data-slot="map-drawer"][data-side="right"]')).toBeVisible();
  await expect(devMl).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="map-drawer"]')).toHaveCount(0);
});

test("plan page: the pilot console's theme toggle cycles system, light, dark, and the choice survives a reload", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("pilot-button").click();
  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");
  await expect(html).not.toHaveClass(/dark/);   // "system", and the test browser prefers light
  await toggle.click();
  await expect(html).not.toHaveClass(/dark/);   // light
  await toggle.click();
  await expect(html).toHaveClass(/dark/);       // dark
  await page.reload();
  await page.waitForTimeout(300);
  await expect(html).toHaveClass(/dark/);
});

test("plan page: the nav log is computed for an aeroplane the pilot picks in its own header", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const picker = page.getByTestId("aircraft-select");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("C172");
  await picker.click();
  await page.getByRole("option", { name: /PA28/ }).click();
  await expect(picker).toContainText("PA28");
  // Remembered per browser: the same aeroplane after a reload.
  await page.reload();
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.getByTestId("aircraft-select")).toContainText("PA28");
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

test("dev page: the waypoint drawer is a worklist -- every candidate in flight order, walked with the keys, rated from the selected row", async ({ page }) => {
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const drawer = page.locator('[data-slot="map-drawer"][data-side="right"]');
  await expect(drawer.getByText("Waypoints", { exact: true })).toBeVisible();
  const table = drawer.getByRole("table", { name: /Waypoints from/i });
  const rows = table.locator("tbody tr[tabindex='0']");
  // Detections stream in: far more rows than the two endpoints, the
  // unrated ones included -- the old list showed only rated points.
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBeGreaterThan(10);
  await expect(drawer.getByText(/of \d+ rated/)).toBeVisible();
  await expect(rows.first()).toContainText("C81");

  // A click selects the row, and its own rating buttons open under it.
  await rows.nth(2).click();
  await expect(rows.nth(2)).toHaveAttribute("data-selected", "true");
  await expect(drawer.getByRole("button", { name: "Rate 5" })).toBeVisible();

  // Down, with focus in the list, walks the list top to bottom.
  await page.keyboard.press("ArrowDown");
  await expect(table.locator("tbody tr[data-selected]")).toHaveCount(1);
  await expect(rows.nth(3)).toHaveAttribute("data-selected", "true");

  // The filters live in a popover from the drawer's header, one named
  // row per axis.
  await drawer.getByTestId("waypoint-filters-button").click();
  for (const axis of ["Role", "Source", "Status"]) {
    await expect(page.getByText(axis, { exact: true })).toBeVisible();
  }
});

test("plan page: every text field is at least 16px on a phone, so iOS never zooms the page in on focus", async ({ page }) => {
  // iOS Safari zooms the whole page in when a field under 16px takes
  // focus, and leaves it zoomed once the field blurs and the drawer
  // closes -- with the header and the route form off the top of the
  // screen. Chromium never does this, so the check is on the computed
  // font size itself, over every field the page can show: the route
  // form, and the nav log's altitude box and description boxes.
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 768) return;   // `md` and up keep the small type
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await expect.poll(() => page.locator("textarea").count(), { timeout: 15000 }).toBeGreaterThan(0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input, textarea, select")]
      .map(el => ({
        field: el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.tagName,
        px: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter(f => f.px < 16));
  expect(small).toEqual([]);
});

for (const path of PAGES) {
  test(`${path}: the info popover's chart-layers checkbox draws the terminal area chart over the sectional, close in`, async ({ page }) => {
    // Off by default: no TAC tiles are asked for. Switched on, and
    // zoomed in over C81 (inside the Chicago TAC), the map asks for
    // TAC tiles and at least one of them actually renders -- the
    // planner draws it from the FAA's own TAC raster, which on a cold
    // tile cache is a quarter of a second per tile for a screenful of
    // them at each zoom passed through; hence the longer budget.
    test.setTimeout(90000);
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    const tacTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/tac/"]');
    const sectionalTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/sec/"]');
    await expect(page.locator("img.leaflet-tile").first()).toBeAttached({ timeout: 15000 });
    expect(await tacTiles.count()).toBe(0);

    await page.getByTestId("guide-button").click();
    const toggle = page.getByTestId("tac-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // Wheel-zoom in over the departure marker, a level at a time
    // (Leaflet's own 60 px per level), until the overlay's zoom range
    // is reached; Leaflet zooms about the cursor, so C81 stays under it.
    const marker = page.locator(".leaflet-marker-icon", { hasText: "C81" }).first();
    await expect(marker).toBeVisible();
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8 && (await tacTiles.count()) === 0; i++) {
      await page.mouse.wheel(0, -60);
      await page.waitForTimeout(500);
    }
    // Close in, both chart layers are asked for: the sectional (which
    // the whole-route fit sits below the zoom range of) and the TAC.
    await expect(sectionalTiles.first()).toBeAttached({ timeout: 10000 });
    await expect(tacTiles.first()).toBeAttached({ timeout: 10000 });
    await expect.poll(
      () => page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile[src*="/api/planner/chart-tile/tac/"]')]
          .some(img => img.complete && img.naturalWidth > 0)),
      { timeout: 45000 },
    ).toBe(true);

    // The setting is remembered: a reload still draws the overlay
    // (and the checkbox still shows it on).
    await page.reload();
    await settle(page);
    await page.getByTestId("guide-button").click();
    await expect(page.getByTestId("tac-toggle")).toHaveAttribute("aria-checked", "true");
  });

  test(`${path}: the base chart can be the IFR low enroute chart, and back`, async ({ page }) => {
    // The sectional by default; picking "IFR low" in the info popover
    // swaps the base layer for the IFR enroute chart's own tiles (and
    // the TAC checkbox, meaningless over it, is disabled); picking
    // "Sectional" brings the sectional back.
    test.setTimeout(90000);
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    const ifrTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/ifr_low/"]');
    const sectionalTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/sec/"]');
    await expect(sectionalTiles.first()).toBeAttached({ timeout: 15000 });
    expect(await ifrTiles.count()).toBe(0);

    await page.getByTestId("guide-button").click();
    await page.getByTestId("base-chart-select").click();
    await page.getByRole("option", { name: "IFR low" }).click();
    await expect(page.getByTestId("tac-toggle")).toBeDisabled();
    await expect(ifrTiles.first()).toBeAttached({ timeout: 10000 });
    await expect.poll(
      () => page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile[src*="/api/planner/chart-tile/ifr_low/"]')]
          .some(img => img.complete && img.naturalWidth > 0)),
      { timeout: 45000 },
    ).toBe(true);
    expect(await sectionalTiles.count()).toBe(0);

    await page.getByTestId("base-chart-select").click();
    await page.getByRole("option", { name: "Sectional" }).click();
    await expect(sectionalTiles.first()).toBeAttached({ timeout: 10000 });
    await expect(page.getByTestId("tac-toggle")).toBeEnabled();
  });
}
