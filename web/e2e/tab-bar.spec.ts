import { test, expect } from "@playwright/test";
import { closeCard, grabberTo, openTab, openPanel, settle, settled, showTabs, sideDrawer, slow } from "./helpers";

/**
 * The planner's tab bar, at the pilot's ask in place of the map's buttons
 * on its left: FPL, Airport, Aircraft and Setup, the sheet's first row half
 * way and all the way up. At rest the pill is one row, as the panel of
 * 2026-10-11 had it and the owner picked it back: FPL the route's box
 * (empty with no route, to type one in) or the route's one line, the others
 * their search bar, a card its name; Setup's pill the tabs.
 */

test("the tabs swap the panel's head and body, FPL's empty box with no route", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const bar = page.getByTestId("tab-bar");
  // The pill at first, one row, FPL the tab up, at the owner's ask ("Fpl
  // should be the default selected"); out half way, the tabs over it.
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
  await expect(bar).toBeHidden();
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
  await grabberTo(page, "half");
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await expect(sideDrawer(page).getByTestId("search-airports")).toBeVisible();
  await showTabs(page);
  await expect(bar.getByTestId("setup-button")).toBeVisible();

  await showTabs(page);
  await page.getByTestId("tab-aircraft").click();
  await expect(page).toHaveURL(/[?&]aircraft=1/);
  await expect(sideDrawer(page).getByTestId("aircraft-search")).toBeVisible();

  // Four tabs, Nearest Airport's now (the owner's pick of the redesign).
  await showTabs(page);
  await expect(bar.getByRole("button")).toHaveCount(4);

  // FPL with no route: the route's box, empty to type one in.
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await showTabs(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("search-airports")).toHaveCount(0);

  // Settings, the last tab: the console, the tab up while it is out, and
  // put away the tab it was opened from again.
  await showTabs(page);
  await bar.getByTestId("setup-button").click();
  await showTabs(page);
  await expect(bar.getByTestId("setup-button")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await showTabs(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
});

test("a route rests as its one line, and half way another tab keeps the panel's height and the route", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  // At rest the route's one line, where to, how far and how long, as the
  // panel of 2026-10-11 had it.
  await expect(panel).toHaveAttribute("data-capsule", "true");
  const line = panel.getByTestId("route-line");
  await expect(line).toContainText(/KDLH · \d+ nm/, { timeout: slow(30000) });
  await expect(panel.getByTestId("tab-bar")).toBeHidden();
  // A tap on it: half way, the tabs the sheet's first row.
  await line.click();
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  // Measured at rest: caught on its way up, the bar was still at the pill's.
  await settled(panel);
  const bar = (await page.getByTestId("tab-bar").boundingBox())!;
  const sheet = (await panel.boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(sheet.y);
  expect(bar.y).toBeLessThan(sheet.y + 40);
  // Another tab half way: half kept, the route still there.
  await page.getByTestId("tab-airport").click();
  await expect(page.getByTestId("tab-airport")).toHaveAttribute("aria-current", "page");
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(page).toHaveURL(/dep=C81/);
  await expect(panel.getByTestId("search-airports")).toBeVisible();
  // FPL again: its figures pinned at the sheet's foot.
  await page.getByTestId("tab-fpl").click();
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(panel.getByTestId("flight-line")).toBeVisible();
});

test("FPL with no route rests as its route box, to type one in", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  // The pill: the route's box alone, to type one in; no figures.
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("panel-foot")).toHaveCount(0);
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
});

test("an airport tapped in the route opens its card, and is changed from its menu", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const destination = page.getByLabel("Destination", { exact: true });
  await destination.click();
  // Its card over the route, as a tap on it on the chart opens it.
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  const card = sideDrawer(page).getByTestId("place-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("KDLH");
  // Closed, the route again, on FPL.
  await closeCard(page, "place-close");
  await expect(card).toHaveCount(0);
  await showTabs(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  // Changed from the pill's menu: its search, as a tap was.
  await destination.click({ button: "right" });
  await page.getByTestId("change-point").click();
  await expect(page.getByPlaceholder("Search for a destination")).toBeVisible();
});

test("half way the side view is over the figures at the foot, and all the way up it is the nav log's Profile, under its Legs", async ({ page }) => {
  // The owner's asks: "pin the profile above calculations but transition
  // to just below the legs. Make the subtabs into sections Legs, Profile".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  const profile = panel.getByTestId("mini-profile");
  await expect(profile).toBeVisible({ timeout: slow(30000) });
  const figures = panel.getByTestId("flight-line");
  const [side, line] = [(await profile.boundingBox())!, (await figures.boundingBox())!];
  expect(side.y + side.height).toBeLessThanOrEqual(line.y + 1);
  await grabberTo(page, "full");
  await expect(figures).toBeVisible();
  // Folded away with the sheet up, the nav log's sections one under another.
  const fold = panel.locator("[data-pill-hides]:has([data-testid=mini-profile])");
  await expect.poll(async () => (await fold.boundingBox())?.height ?? 0).toBeLessThan(1);
  await openTab(page, "En route");
  const log = panel.locator('[data-tab="enroute"]');
  await expect(log.locator('[data-testid="section-tabs"]')).toHaveCount(0);
  const legs = log.locator('[data-title="Legs"]');
  const route = log.locator('[data-title="Profile"]');
  await expect(legs.getByRole("heading", { name: "Legs" })).toBeVisible();
  await expect(route.getByRole("heading", { name: "Profile" })).toBeAttached();
  expect((await route.boundingBox())!.y).toBeGreaterThan((await legs.boundingBox())!.y);
});

test("a card opens half way, lowered to the pill it is its name and its close, which puts it away", async ({ page }) => {
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "half");
  const name = panel.getByTestId("place-card").getByTestId("place-name");
  await expect(name).toBeVisible({ timeout: slow(15000) });
  // Down to the pill: one row, the card's name, a tap on it half way again.
  await grabberTo(page, "peek");
  const line = panel.getByTestId("route-line");
  await expect(line).toContainText("KDLH");
  await expect(panel.getByTestId("place-frequencies")).toBeHidden();
  await line.click();
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(name).toBeVisible();
  // Its close in the pill: the card put away, the tab's own pill.
  await grabberTo(page, "peek");
  await panel.getByTestId("card-line-close").click();
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(panel).toHaveAttribute("data-panel", "peek");
});

test("the route's box has a clear at its end while it holds a route", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const clear = sideDrawer(page).getByTestId("route-box-clear");
  await expect(clear).toBeVisible();
  // The sheet come to rest: measured while it rose from the pill, the box
  // was narrower than the clear's place a moment later.
  await settled(sideDrawer(page));
  // Inside the box, at its end.
  const box = (await sideDrawer(page).getByTestId("route-box").boundingBox())!;
  const at = (await clear.boundingBox())!;
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width);
  expect(at.x).toBeGreaterThan(box.x + box.width / 2);
  // While something is typed, its own clear alone, not the route's too.
  await sideDrawer(page).getByTestId("route-type").fill("LA");
  await expect(clear).toHaveCount(0);
  await expect(sideDrawer(page).getByTestId("field-clear")).toHaveCount(1);
  await sideDrawer(page).getByTestId("field-clear").click();
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(page).not.toHaveURL(/[?&]dep=/);
  await expect(clear).toHaveCount(0);
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
});

test("all the way up with no route, the empty box stays out", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await grabberTo(page, "full");
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
});


test("each tab keeps the card open over it: another tab picked and this one again, the airport's card is back", async ({ page }) => {
  // A link's card is over FPL, the tab up (the owner's "tapping the
  // airport from FPL ... back to fpl"), and kept there.
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const name = sideDrawer(page).getByTestId("place-name");
  await expect(name).toContainText("KDLH", { timeout: slow(15000) });
  await showTabs(page);
  await page.getByTestId("tab-aircraft").click();
  await expect(page).not.toHaveURL(/[?&]place=/);
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  await expect(name).toContainText("KDLH");
  // The tab up tapped again puts it away, as an iOS tab's first screen.
  await showTabs(page);
  await sideDrawer(page).locator('[data-testid="tab-bar"] button[aria-current="page"]').click();
  await expect(page).not.toHaveURL(/[?&]place=/);
  await showTabs(page);
  await page.getByTestId("tab-aircraft").click();
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await expect(page).not.toHaveURL(/[?&]place=/);
});

test("the grabber steps the pill, half and all the way up and back, as the panel last moved", async ({ page }) => {
  // The panel of 2026-10-11, the owner's pick back ("pill to half to full
  // worked really well").
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  const grabber = page.getByTestId("sidebar-trigger-button");
  const size = () => panel.getAttribute("data-panel");
  await expect.poll(size).toBe("peek");
  const seen: (string | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const before = await size();
    await grabber.click();
    await expect.poll(size).not.toBe(before);
    seen.push(await size());
  }
  expect(seen).toEqual(["half", "full", "half", "peek"]);
});

test("all the way up, another tab tapped is that tab all the way up; the tab up tapped brings it down half way", async ({ page }) => {
  // The owner's ask: "tapping on other tabs when card is fully open should
  // switch to that tab".
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await grabberTo(page, "full");
  const panel = sideDrawer(page);
  await page.getByTestId("tab-aircraft").click();
  await expect(page.getByTestId("tab-aircraft")).toHaveAttribute("aria-current", "page");
  await expect(panel).toHaveAttribute("data-panel", "full");
  await page.getByTestId("setup-button").click();
  await expect(panel).toHaveAttribute("data-panel", "full");
  await expect(panel.getByTestId("setup-page")).toBeVisible();
  await page.getByTestId("tab-airport").click();
  await expect(panel).toHaveAttribute("data-panel", "full");
  await page.getByTestId("tab-airport").click();
  await expect(panel).toHaveAttribute("data-panel", "half");
});

test("with a mouse's wheel, down over the panel brings it up a size, up takes it down, and sideways goes to the tab beside", async ({ page }) => {
  // The owner's ask: "on a desktop, the scrolling should transition the
  // layout and tabs".
  test.skip((page.viewportSize()?.width ?? 0) < 768, "a desktop's wheel");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  const over = async () => {
    const box = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
  };
  const flick = async (dx: number, dy: number) => {
    await over();
    for (let i = 0; i < 4; i++) await page.mouse.wheel(dx, dy);
    // The gesture's end, before the next.
    await page.waitForTimeout(400);
  };
  await flick(0, 40);
  await expect(panel).toHaveAttribute("data-panel", "half");
  await flick(0, 40);
  await expect(panel).toHaveAttribute("data-panel", "full");
  await flick(0, -40);
  await expect(panel).toHaveAttribute("data-panel", "half");
  await flick(40, 0);
  await expect(page.getByTestId("tab-airport")).toHaveAttribute("aria-current", "page");
  await flick(-40, 0);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
});
