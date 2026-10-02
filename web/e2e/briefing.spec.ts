import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, expectDrawerClosed, expectDrawerOpen, closeSidebarWithTheStockKey, openedDrawerBox, openBriefing } from "./helpers";

/**
 * The flight planning panel: how it opens -- from its grabber, a pasted
 * link, a route arriving as it opens -- and closes, what its head
 * holds, and how the briefing in it ends.
 */

test("plan page: the flight planning drawer opens the way the Model Training drawer does, the same panel beside the map, with the two inputs and the narrative and Print in its header and the totals and the descriptions button in the nav log's own section", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");

  // The Model Training drawer first, on the dev page: where it sits
  // and how wide it is.
  await page.goto("/app/dev");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const drawer = sideDrawer(page);
  const devBox = await openedDrawerBox(page);
  expect(devBox).not.toBeNull();

  // The flight planning panel: the URL says briefing, and it is the
  // same panel in the same place -- a strip of map beside it from md
  // up; on a phone the sheet, the screen's width.
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page).toHaveURL(/[?&]view=briefing/);
  const box = await openedDrawerBox(page);
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - devBox!.width)).toBeLessThan(2);
  expect(Math.abs(box!.x - devBox!.x)).toBeLessThan(2);
  if (viewport.width >= 768) expect(box!.width).toBeLessThan(viewport.width);
  else expect(Math.round(box!.width)).toBe(viewport.width);

  // The panel's controls are the two inputs the log is computed from
  // -- the aeroplane and the departure time -- and nothing else of the
  // log's: neither is inside a section.
  await expect(drawer.getByTestId("aircraft-select")).toBeVisible();
  await expect(drawer.getByTestId("depart-picker")).toBeVisible();
  // And, signed in, Save this flight beside the narrative and Print.
  await expect(drawer.getByTestId("save-flight-button")).toBeVisible();
  await expect(drawer.getByTestId("ai-narrative-button")).toBeVisible();
  expect(await drawer.locator('[data-slot="accordion-content"] [data-testid="aircraft-select"]').count()).toBe(0);
  expect(await drawer.locator('[data-slot="accordion-content"] [data-testid="depart-picker"]').count()).toBe(0);
  // Every section starts closed, the nav log's own first among them:
  // the drawer opens as the list of what the briefing holds.
  await expect(drawer.getByText("Nav Log", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Adverse Conditions")).toBeVisible();
  await expect(drawer.getByText("Airport Information")).toBeVisible();
  expect(await drawer.locator('[data-slot="accordion-content"][data-state="open"]').count()).toBe(0);
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeHidden();
  // Opened, the nav log's section holds the totals and the
  // descriptions button above the table -- inside the section, not
  // the header.
  await drawer.getByText("Nav Log", { exact: true }).click();
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeVisible();
  await expect(drawer.locator('[data-slot="accordion-content"] [data-testid="generate-descriptions-button"]')).toBeVisible();
  // The altitude, the Alt column's own heading, once the log has
  // streamed in.
  await expect(drawer.locator('[data-slot="accordion-content"] [data-testid="altitude-why"]')).toBeVisible({ timeout: slow(60000) });
  await expect(drawer.locator('[data-slot="section-summary"]').first()).toContainText(/\d nm/, { timeout: slow(60000) });
  expect(await drawer.locator('[data-slot="accordion-content"][data-state="open"]').count()).toBe(1);

  // The panel's head is still in sight: the route form, and the
  // console's button among the map's.
  expect(await page.locator("header").getByLabel("Departure", { exact: true }).count()).toBe(1);
  expect(await page.locator("[data-map-controls]").getByTestId("settings-button").count()).toBe(1);

  // The briefing's actions are beside the route, in the panel's top
  // row: the AI button (LangGraph/CrewAI are tabs inside the popover it
  // opens), then More (Print, Keep charts offline), left to right on one
  // row.
  const aiBox = await drawer.getByTestId("ai-narrative-button").boundingBox();
  const moreBox = await drawer.getByTestId("plan-more-button").boundingBox();
  expect(aiBox).not.toBeNull();
  expect(moreBox).not.toBeNull();
  expect(aiBox!.x).toBeLessThan(moreBox!.x);
  expect(Math.abs(aiBox!.y - moreBox!.y)).toBeLessThan(10);
  // In the route's row, after the route.
  expect(await page.locator("header").getByTestId("plan-more-button").count()).toBe(1);
  const departure = (await page.locator("header").getByLabel("Departure", { exact: true }).boundingBox())!;
  expect(aiBox!.x).toBeGreaterThan(departure.x);
});

test("plan page: the briefing ends on its 'planning aid only' reminder, with the nav log and the summary on screen", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);
  // At the foot of the drawer, not a toast: as a toast it covered the
  // nav log's last rows and hid the route's own warnings behind it.
  await expect(sideDrawer(page).getByTestId("planning-aid-note")).toContainText("Planning aid only");
  await expect(page.locator("[data-sonner-toast]", { hasText: "Planning aid only" })).toHaveCount(0);

  // One nav log, in a section of its own at the top, and every
  // briefing section under it, every one closed. No "Flight Plan
  // Summary" section: the nav log's own section carries the totals
  // and the altitude, and the drawer's header the aeroplane.
  const drawer = sideDrawer(page);
  const navLog = drawer.locator("table");
  // A closed accordion section has no content in the page at all.
  await expect(navLog).toHaveCount(0);
  await expect(drawer.getByText("Nav Log", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Flight Plan Summary")).toHaveCount(0);
  await expect(drawer.getByText("Adverse Conditions")).toBeVisible();
  await expect(drawer.getByText("Airport Information")).toBeVisible();
  // A section unfolds on its title and folds again.
  await drawer.getByText("Nav Log", { exact: true }).click();
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeVisible();
  await expect(navLog).toHaveCount(1);
  await drawer.getByText("Nav Log", { exact: true }).click();
  await expect(navLog).toHaveCount(0);
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

test("plan page: the drawer closes the way the stock components close, and nothing else", async ({ page }) => {
  // This app binds no key of its own to the drawer. A hand-written
  // Escape listener used to, and it is gone: a phone's drawer is a
  // Radix Sheet and closes on Escape by itself, a desktop's is
  // shadcn's panel and toggles on Cmd/Ctrl+B. Whatever those do is
  // what this does.
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);
  const drawer = sideDrawer(page);
  await expect(drawer.getByText("Adverse Conditions")).toBeVisible();
  // No toggle to a narrower nav log: the drawer has the one width.
  expect(await drawer.getByTestId("sidebar-expand-toggle").count()).toBe(0);

  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
});

// An address that names no route gets the first collected one written
// in when the list of routes arrives. A tap on the toggle just before
// that was undone by it -- the route was worked out from the address as
// it stood before the tap -- and the drawer shut again with no
// view=briefing. On a processor slowed sixfold, with the list arriving
// just after the tap, it was every time.
test("plan page: the briefing opened just as the default route arrives stays open", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  // Six times slower here, where that is what made the old race show;
  // twice in CI, whose runner is slow enough already.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: process.env.CI ? 2 : 6 });
  let release = () => {};
  const listed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/planner/routes", async route => { await listed; await route.continue(); });
  await page.goto("/app/plan");
  await page.getByTestId("sidebar-trigger-button").click();
  release();
  await expect(page).toHaveURL(/[?&]dest=/);
  await expect(page).toHaveURL(/[?&]view=briefing/);
});

test("plan page: a pasted briefing link opens the panel, and its grabber closes and reopens it", async ({ page }) => {
  await page.goto("/app/plan?view=briefing");
  await settle(page);
  const drawer = sideDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("plan-more-button")).toBeVisible();

  // No letter shortcuts on this page any more: the arrows walk the
  // checkpoints and everything else has a button. `n` used to toggle
  // this drawer and now does nothing.
  await page.keyboard.press("n");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  // Closing it: a tap on its grabber. The address drops the parameter.
  await page.getByTestId("sidebar-trigger-button").click();
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  await expectDrawerClosed(page);

  await page.getByTestId("sidebar-trigger-button").click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expect(drawer.getByTestId("plan-more-button")).toBeVisible();
});

test("plan page: the panel's grabber raises and lowers it, a tap on the map beside it leaves it out, and Escape lowers it", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const grabber = page.getByTestId("sidebar-trigger-button");
  await grabber.click();
  await expectDrawerOpen(page);
  await grabber.click();
  await expectDrawerClosed(page);
  await grabber.click();
  await expectDrawerOpen(page);
  // Not modal: the map beside the card stays live, and a click there is
  // the map's. (On a phone the sheet all the way up leaves no map
  // beside it.)
  if (viewport.width >= 768) {
    await page.mouse.click(viewport.width - 200, viewport.height / 2);
    await expectDrawerOpen(page);
  }
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
});
