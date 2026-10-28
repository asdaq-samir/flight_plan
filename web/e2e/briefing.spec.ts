import { test, expect } from "@playwright/test";
import { slow, settle, tapTheChart, settled, closeCard, sideDrawer, expectDrawerClosed, expectDrawerOpen, closeSidebarWithTheStockKey, openedDrawerBox, openBrief, openBriefing, openTab, openSection, panelTabs, grabberTo, controlsInSight, openNavLog, closeNavLog, navLogSheet, briefPage } from "./helpers";

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
  await grabberTo(page, "full");
  const drawer = sideDrawer(page);
  const devBox = await openedDrawerBox(page);
  expect(devBox).not.toBeNull();

  // The flight planning panel: the URL says briefing, and it is the
  // same panel in the same place -- a strip of map beside it from md
  // up; on a phone the sheet, the screen's width all the way out, as
  // Maps' is.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  await expect(page).toHaveURL(/[?&]view=briefing/);
  const box = await openedDrawerBox(page);
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - devBox!.width)).toBeLessThan(2);
  expect(Math.abs(box!.x - devBox!.x)).toBeLessThan(2);
  if (viewport.width >= 768) expect(box!.width).toBeLessThan(viewport.width);
  else expect(Math.round(box!.width)).toBe(viewport.width);

  // The panel's controls are the two inputs the log is computed from
  // -- the airplane in the route's box, the departure time on the
  // departure's step in the route's list (the owner's ask) -- and nothing
  // else of the log's.
  await controlsInSight(page);
  await expect(drawer.getByTestId("aircraft-select")).toBeVisible();
  await expect(drawer.getByTestId("procedures").getByTestId("depart-date")).toBeVisible();
  await expect(drawer.getByTestId("ai-narrative-button")).toHaveCount(0);
  expect(await drawer.locator('[role="tabpanel"] [data-testid="aircraft-select"]').count()).toBe(0);
  // The panel's tabs, in the pilot's order, the nav log's up: it holds
  // the totals and the descriptions button above the table.
  // "Perf" on its tab, its name whole (PanelTabs). No Airports tab: the
  // airports are the Brief's sections, at the pilot's ask.
  // The route's pages, the Brief's, all the way up.
  await openBrief(page);
  await grabberTo(page, "full");
  // Opened on its cards, one a part of the flight (the owner's D′), each
  // opening its page; the pages' tabs over a page.
  await expect(drawer.getByTestId("brief-glance").locator("button[data-testid^='brief-glance-']")).toHaveCount(4);
  await briefPage(page, "Preflight");
  await expect(panelTabs(page).getByRole("tab")).toHaveText(["Preflight", "Depart", "En route", "Arrive"]);
  // All four on the panel's line, none past its edge.
  const tabsBox = (await panelTabs(page).boundingBox())!;
  for (const tab of await panelTabs(page).getByRole("tab").all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(tabsBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(tabsBox.x + tabsBox.width + 1);
  }
  await expect(panelTabs(page).getByRole("tab", { name: "Preflight" })).toHaveAttribute("aria-selected", "true");
  // FPL all the way up, the route in order; the nav log in its own sheet,
  // the descriptions' wand at its head.
  await openTab(page, "Nav Log");
  await expect(drawer.getByTestId("procedures")).toBeVisible();
  await openNavLog(page);
  await expect(navLogSheet(page).getByRole("table", { name: /Navigation log from/i })).toBeVisible();
  await expect(navLogSheet(page).getByTestId("generate-descriptions-button")).toBeVisible();
  await closeNavLog(page);
  // The altitude, its chip beside the airplane in the pill, once the log
  // has streamed in.
  await controlsInSight(page);
  await expect(drawer.getByTestId("altitude-why")).toHaveAccessibleName(/\d,\d{3} feet|FL\d{3}/, { timeout: slow(60000) });
  await grabberTo(page, "full");
  await expect(drawer.locator('[data-slot="section-summary"]').first()).toContainText(/\d nm/, { timeout: slow(60000) });
  // Leaving's weather on Depart, laid open, the nav log out of the page.
  await openTab(page, "Depart");
  await expect(drawer.locator('[data-tab="depart"]').getByRole("heading", { name: "Weather" })).toBeVisible();
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toHaveCount(0);

  // Back on FPL all the way up, the route's box over its chips and side
  // view, where the pill has them, the figures pinned at the foot;
  // Settings a tab, not a gear in the head.
  await openTab(page, "Nav Log");
  await expect(drawer.getByTestId("flight-line")).toBeVisible();
  expect(await page.locator("header").getByLabel("Departure", { exact: true }).count()).toBe(1);
  expect(await page.locator("header").getByTestId("setup-button").count()).toBe(0);

  // The route's buttons, the Brief (where the Nav log was) and Share, at
  // the end of the airplane's, the altitude's and the time's line, at the
  // pilot's ask; Save, filing the flight plan and the route's close in
  // Share -- printing in the Brief's and the nav log's own (below).
  const [approachesBox, shareBox] = await Promise.all(["route-brief", "share-route"]
    .map(async id => (await drawer.getByTestId(id).boundingBox())!));
  expect(approachesBox.x).toBeLessThan(shareBox.x);
  expect(Math.abs(approachesBox.y - shareBox.y)).toBeLessThan(2);
  // The departure's time on its step in the route's list, not in this
  // line, at the owner's ask: the airplane's chip leads the line instead.
  const airplane = (await drawer.getByTestId("aircraft-select").boundingBox())!;
  expect(approachesBox.x).toBeGreaterThan(airplane.x);
  expect(Math.abs(shareBox.y + shareBox.height / 2 - (airplane.y + airplane.height / 2))).toBeLessThan(12);
  await expect(drawer.getByTestId("procedures").getByTestId("depart-date")).toBeVisible();
  await drawer.getByTestId("share-route").click();
  // And, signed in, Save this flight among them.
  for (const id of ["save-flight-button", "file-flight-plan"]) {
    await expect(page.getByRole("menu").getByTestId(id)).toBeVisible();
  }
  await expect(page.getByRole("menu").getByTestId("print-briefing")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("each card's Share is its own: the Brief's prints the briefing, the nav log's the nav log, and neither has the route's", async ({ page }) => {
  // The owner's asks ("every share button needs to be specific to that
  // card. So printing briefing should only be in brief card"; "printing
  // navlog should be in navlog").
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  const drawer = sideDrawer(page);
  const menu = page.getByRole("menu");
  await openBrief(page);
  await page.getByTestId("tab-share").click();
  await expect(menu.getByTestId("print-briefing")).toBeVisible();
  await expect(menu.getByTestId("print-kneeboard")).toHaveCount(0);
  await expect(menu.getByTestId("route-clear")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await settled(drawer);
  await closeCard(page, "brief-close");
  await expect(drawer.getByTestId("brief-card")).toHaveCount(0);
  await openNavLog(page);
  await page.getByTestId("tab-share").click();
  await expect(menu.getByTestId("print-kneeboard")).toHaveText("Print the nav log");
  await expect(menu.getByTestId("print-briefing")).toHaveCount(0);
  await expect(menu.getByTestId("route-clear")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("plan page: the nav log and the summary on screen, the 'planning aid only' reminder no longer under them", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);

  await openBriefing(page);
  // In Settings' About now, at the pilot's ask, not at the foot of the
  // tabs; never a toast, which covered the nav log's last rows.
  await expect(sideDrawer(page).getByTestId("planning-aid-note")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]", { hasText: "planning aid for VFR flight" })).toHaveCount(0);

  // FPL's route in order, the nav log a sheet of its own, and the briefing
  // in the Brief's pages. No "Flight Plan Summary": the line at the foot
  // carries the totals, its chip beside the airplane the altitude.
  const drawer = sideDrawer(page);
  await openTab(page, "Nav Log");
  const route = drawer.getByTestId("procedures");
  await expect(route).toBeVisible();
  await expect(drawer.getByText("Flight Plan Summary")).toHaveCount(0);
  await openNavLog(page);
  await expect(navLogSheet(page).getByRole("table", { name: /Navigation log from/i })).toBeVisible();
  await closeNavLog(page);
  // Another tab takes its place, and back.
  await openTab(page, "Brief");
  await openSection(page, "C81 · Departure");
  await expect(drawer.locator('[data-tab="depart"] [data-title="C81 · Departure"]')).toBeVisible();
  // Kept, hidden, for the way back (Activity).
  await expect(route).toBeHidden();
  await openTab(page, "Nav Log");
  await expect(route).toBeVisible();
});

test("plan page: the Brief is a tab after the Nav Log, its narrative from LangGraph or CrewAI as the settings say", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);

  await openBriefing(page);

  // LangGraph and CrewAI (nav-log-agent's and crewai-agent's own real,
  // billed Claude calls) are a setting; the Brief tab asks for the one it
  // names once it opens -- answered here by a line of the test's own,
  // nothing billed.
  const asked: string[] = [];
  page.on("request", r => { if (r.url().includes("/api/comparison")) asked.push(new URL(r.url()).searchParams.get("framework") ?? ""); });
  // The Brief's cards as it opens, and nothing asked for until a tap:
  // each is billed, and the Brief is opened for every route looked at.
  await openBrief(page);
  await expect(sideDrawer(page).getByTestId("brief-glance")).toBeVisible();
  await openTab(page, "Preflight");
  await openSection(page, "Narrative");
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
  await page.getByTestId("brief-narrative-write").click();
  const narrative = page.getByTestId("brief-narrative");
  await expect(narrative).toContainText("A test narrative.", { timeout: slow(60000) });
  await expect.poll(() => asked).toEqual(["langgraph"]);
  // CrewAI's instead, from the settings: asked for as the console goes.
  // The developer's pick now (the developer's Status page): set as it
  // sets it, in the stored preferences.
  await page.evaluate(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? "{\"state\":{},\"version\":1}");
    kept.state = { ...kept.state, narrative: "crewai" };
    localStorage.setItem("vfr.preferences", JSON.stringify(kept));
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await openTab(page, "Preflight");
  await openSection(page, "Narrative");
  await page.getByTestId("brief-narrative-write").click({ timeout: slow(60000) });
  await expect.poll(() => asked, { timeout: slow(60000) }).toEqual(["langgraph", "crewai"]);
});

test("plan page: the drawer closes the way the stock components close, and nothing else", async ({ page }) => {
  // This app binds no key of its own to the drawer. A hand-written
  // Escape listener used to, and it is gone: a phone's drawer is a
  // Radix Sheet and closes on Escape by itself, a desktop's is
  // shadcn's panel and toggles on Cmd/Ctrl+B. Whatever those do is
  // what this does.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);

  await openBriefing(page);
  const drawer = sideDrawer(page);
  await openTab(page, "Weather");
  await expect(drawer.getByRole("heading", { name: "Adverse Conditions" })).toBeVisible();
  // No toggle to a narrower nav log: the drawer has the one width.
  expect(await drawer.getByTestId("sidebar-expand-toggle").count()).toBe(0);

  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
});

test("plan page: a pasted briefing link opens the panel, and its grabber closes and reopens it", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  const drawer = sideDrawer(page);
  await expect(drawer).toBeVisible();
  // All the way up the route's box and chips with Share, the figures
  // pinned at the foot.
  await expect(drawer.getByTestId("flight-line")).toBeVisible();
  await expect(drawer.getByTestId("share-route")).toBeVisible();

  // No letter shortcuts on this page any more: the arrows walk the
  // checkpoints and everything else has a button. `n` used to toggle
  // this drawer and now does nothing.
  await page.keyboard.press("n");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/[?&]view=briefing/);

  const grabber = page.getByTestId("sidebar-trigger-button");
  // Down a size at a tap: half, the address dropping the parameter, the
  // route's box and its chips' Share in sight; then the pill, its one
  // line; back all the way up.
  await grabber.click();
  await expect(drawer).toHaveAttribute("data-panel", "half");
  await expect(page).not.toHaveURL(/[?&]view=briefing/);
  await expect(drawer.getByTestId("route-box")).toBeVisible();
  await expect(drawer.getByTestId("share-route")).toBeVisible();
  await grabber.click();
  await expectDrawerClosed(page);
  await expect(drawer.getByTestId("flight-line")).toBeVisible();

  await grabberTo(page, "full");
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expect(drawer.getByTestId("flight-line")).toBeVisible();
});

// A tap on the grabber steps the three sizes up from the pill and back
// down again, as the October 11 panel the owner picked back did.
test("plan page: the panel's grabber cycles it up and back down, a tap on the map beside it leaves it out, and Escape lowers it", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const grabber = page.getByTestId("sidebar-trigger-button");
  const panel = sideDrawer(page);
  const size = () => panel.getAttribute("data-panel");
  for (const height of ["half", "full", "half", "peek"]) {
    await grabber.click();
    await expect.poll(size).toBe(height);
  }
  await grabberTo(page, "full");
  await grabber.click();
  await expect.poll(size).toBe("half");
  await grabberTo(page, "full");
  await expectDrawerOpen(page);
  // Not modal: the map beside the card stays live, and a click there is
  // the map's. (On a phone the sheet all the way up leaves no map
  // beside it.)
  // Somewhere on the chart with nothing on it (tapTheChart): a fixed
  // point beside the card could land on a field's mark, whose card opening
  // lowered the panel (CI, 2026-10-28, three tries of three).
  if (viewport.width >= 768) {
    await tapTheChart(page);
    await expectDrawerOpen(page);
  }
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
});
