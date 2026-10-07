import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, expectDrawerClosed, expectDrawerOpen, closeSidebarWithTheStockKey, openedDrawerBox, openBriefing, openTab, openSettings, closeConsole } from "./helpers";

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
  // up; on a phone the sheet, the screen's width all the way out, as
  // Maps' is.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
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
  await expect(drawer.getByTestId("depart-date")).toBeVisible();
  // And, signed in, Save this flight beside More.
  await expect(drawer.getByTestId("save-flight-button")).toBeVisible();
  await expect(drawer.getByTestId("ai-narrative-button")).toHaveCount(0);
  expect(await drawer.locator('[role="tabpanel"] [data-testid="aircraft-select"]').count()).toBe(0);
  expect(await drawer.locator('[role="tabpanel"] [data-testid="depart-date"]').count()).toBe(0);
  // The panel's tabs, in the pilot's order, the nav log's up: it holds
  // the totals and the descriptions button above the table.
  await expect(drawer.getByRole("tab")).toHaveText(["Nav Log", "Brief", "Weather", "Performance", "Airports"]);
  // All five on the panel's line, none past its edge.
  const tabsBox = (await drawer.getByRole("tablist").boundingBox())!;
  for (const tab of await drawer.getByRole("tab").all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(tabsBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(tabsBox.x + tabsBox.width + 1);
  }
  await expect(drawer.getByRole("tab", { name: "Nav Log" })).toHaveAttribute("aria-selected", "true");
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeVisible();
  await expect(drawer.locator('[role="tabpanel"] [data-testid="generate-descriptions-button"]')).toBeVisible();
  // The altitude, its chip beside the aeroplane, once the log has
  // streamed in.
  await expect(drawer.getByTestId("altitude-why")).toHaveAccessibleName(/FL\d{3}/, { timeout: slow(60000) });
  await expect(drawer.locator('[data-slot="section-summary"]').first()).toContainText(/\d nm/, { timeout: slow(60000) });
  // The weather in its own tab, laid open, the nav log out of the page.
  await openTab(page, "Weather");
  await expect(drawer.getByRole("heading", { name: "Adverse Conditions" })).toBeVisible();
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toHaveCount(0);

  // The panel's head is still in sight: the route's box, and under the
  // route's close the console's button.
  expect(await page.locator("header").getByLabel("Departure", { exact: true }).count()).toBe(1);
  await expect(page.locator("header").getByTestId("settings-button")).toBeVisible();

  // The panel's actions, Save, Share and Print, round buttons at the end
  // of the aeroplane's, the altitude's and the time's line under the
  // route: the route's box has the top row to itself.
  const [saveBox, shareBox, printBox] = await Promise.all(["save-flight-button", "share-route", "print-button"]
    .map(async id => (await drawer.getByTestId(id).boundingBox())!));
  expect(saveBox.x).toBeLessThan(shareBox.x);
  expect(shareBox.x).toBeLessThan(printBox.x);
  expect(Math.abs(saveBox.y - printBox.y)).toBeLessThan(2);
  expect(await page.locator("header").getByTestId("print-button").count()).toBe(0);
  const departure = (await drawer.getByTestId("depart-date").boundingBox())!;
  expect(saveBox.x).toBeGreaterThan(departure.x);
  expect(Math.abs(printBox.y + printBox.height / 2 - (departure.y + departure.height / 2))).toBeLessThan(12);
});

test("plan page: the briefing ends on its 'planning aid only' reminder, with the nav log and the summary on screen", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);

  await openBriefing(page);
  // At the foot of the drawer, not a toast: as a toast it covered the
  // nav log's last rows and hid the route's own warnings behind it.
  await expect(sideDrawer(page).getByTestId("planning-aid-note")).toContainText("Planning aid only");
  await expect(page.locator("[data-sonner-toast]", { hasText: "Planning aid only" })).toHaveCount(0);

  // One nav log, its tab up as the panel opens, and the briefing in the
  // other tabs. No "Flight Plan Summary": the nav log's line carries the
  // totals, its chip beside the aeroplane the altitude.
  const drawer = sideDrawer(page);
  const navLog = drawer.locator("table");
  await expect(drawer.getByRole("table", { name: /Navigation log from/i })).toBeVisible();
  await expect(drawer.getByText("Flight Plan Summary")).toHaveCount(0);
  // Another tab takes its place, and back.
  await openTab(page, "Airports");
  await expect(drawer.getByRole("heading", { name: "C81 · Departure" })).toBeVisible();
  // Kept, hidden, for the way back (Activity).
  await expect(navLog).toBeHidden();
  await openTab(page, "Nav Log");
  await expect(navLog).toBeVisible();
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
  await expect(sideDrawer(page).getByRole("tab", { name: "Nav Log" })).toHaveAttribute("aria-selected", "true");
  expect(asked).toEqual([]);
  await openTab(page, "Brief");
  const narrative = page.getByTestId("brief-narrative");
  await expect(narrative).toContainText("A test narrative.", { timeout: slow(60000) });
  await expect.poll(() => asked).toEqual(["langgraph"]);
  // CrewAI's instead, from the settings: asked for as the console goes.
  await page.goto("/app/plan");
  await openSettings(page);
  await page.getByTestId("narrative-framework").getByRole("radio", { name: "CrewAI" }).click();
  await closeConsole(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await openTab(page, "Brief");
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
  await expect(drawer.getByTestId("print-button")).toBeVisible();

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
  await expect(drawer.getByTestId("print-button")).toBeVisible();
});

test("plan page: the panel's grabber raises and lowers it, a tap on the map beside it leaves it out, and Escape lowers it", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
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
