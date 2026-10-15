import { test, expect } from "@playwright/test";
import { closeCard, closeConsole, grabberTo, openTab, openPanel, settle, settled, showTabs, sideDrawer, slow } from "./helpers";

/**
 * The planner's tab bar, at the pilot's ask in place of the map's buttons
 * on its left: FPL, Airport, Aircraft and Setup, the sheet's first row at
 * every size -- at rest the pill itself, at the owner's ask ("When no route
 * is entered, let's have tabs on the pill"), a route's figures pinned under
 * them -- over a card its name, Back and the close.
 */

test("the tabs swap the panel's head and body, FPL's empty box with no route", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const bar = page.getByTestId("tab-bar");
  // The pill at first, the tabs, FPL the tab up, at the owner's ask ("Fpl
  // should be the default selected"); out half way, the route's box.
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
  await expect(bar).toBeVisible();
  await expect(sideDrawer(page).getByTestId("route-type")).toBeHidden();
  await grabberTo(page, "half");
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
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
  // Escape until it is away: with the focus on the panel, the first lowers
  // the panel (closeConsole).
  await closeConsole(page);
  await showTabs(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
});

test("a route rests as its figures in the tabs' place, the pill's own height, and half way another tab keeps the panel's height and the route", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  // At rest the route's figures in the tabs' place, the pill as tall as the
  // tabs', at the owner's ask ("When a route is entered the calculations
  // should replace the tabs in the pill while keeping it the same size");
  // a tap on them half way.
  await expect(panel).toHaveAttribute("data-capsule", "true");
  const figures = panel.getByTestId("flight-line");
  await expect(figures).toContainText(/\d+ nm/, { timeout: slow(30000) });
  await expect(panel.getByTestId("tab-bar")).toBeHidden();
  await expect(panel.getByTestId("mini-profile")).toBeHidden();
  await settled(panel);
  expect((await panel.boundingBox())!.height).toBeLessThan(64);
  await panel.getByTestId("panel-foot").click();
  await expect(panel).toHaveAttribute("data-panel", "half");
  // Half way, the tabs still the sheet's first row.
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

test("FPL with no route rests as the tabs alone, its route's box half way", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  // The pill: the tabs alone, no figures.
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
  await expect(sideDrawer(page).getByTestId("tab-bar")).toBeVisible();
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

test("a card opens half way; on a phone, lowered to the pill it is its name and its close, which puts it away", async ({ page }) => {
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "half");
  const name = panel.getByTestId("place-card").getByTestId("place-name");
  await expect(name).toBeVisible({ timeout: slow(15000) });
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the tabs minimize to a card's name on a phone only");
  // Down to the pill: the minimized tabs, the card's name, Back and the close.
  await grabberTo(page, "peek");
  await expect(page.getByTestId("tab-title")).toContainText("KDLH");
  await expect(panel.getByTestId("place-frequencies")).toBeHidden();
  await page.getByTestId("tab-close").click();
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
    // Once it is at rest: measured while it moved, the pointer landed on
    // the map, whose own wheel zooms it.
    await settled(panel);
    const box = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
  };
  // A flick: four wheel events in one go, as a wheel's notch or a
  // trackpad's flick sends them, a frame or so apart -- Playwright's own
  // came a quarter of a second apart, past the pause (180 ms) that ends a
  // gesture, and one flick was now and then heard as two.
  const flick = async (dx: number, dy: number) => {
    await over();
    await page.evaluate(([dx, dy]) => {
      const box = document.querySelector("[data-slot=map-panel]")!.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + 30;
      const target = document.elementFromPoint(x, y)!;
      for (let i = 0; i < 4; i++) target.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, [dx, dy]);
    // The gesture's end, before the next.
    await page.waitForTimeout(400);
    await settled(panel);
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

test("a tab's own page is there at once as its tab is picked, as Airport's is: Aircraft's and Setup's neither fade nor slide in", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "half");
  // The entrances running on what was tapped to, or on what holds it
  // within the panel: a card's fade and rise (PanelCard), a page's fade
  // (ConsolePages). Asked as soon as it shows, inside the half second
  // either took.
  const entering = (testId: string) => sideDrawer(page).getByTestId(testId).first().evaluate(el => {
    const all = el.getAnimations({ subtree: true });
    for (let up = el.parentElement; up && !up.matches('[data-slot="map-panel"]'); up = up.parentElement) all.push(...up.getAnimations());
    return all.filter(a => a instanceof CSSAnimation && a.playState === "running").map(a => a.animationName);
  });
  for (let round = 0; round < 2; round++) {
    await page.getByTestId("tab-airport").click();
    await expect(sideDrawer(page).getByTestId("search-airports")).toBeVisible();
    await page.getByTestId("tab-aircraft").click();
    await expect(sideDrawer(page).getByTestId("aircraft-card")).toBeAttached();
    expect(await entering("aircraft-card")).toEqual([]);
    await page.getByTestId("setup-button").click();
    await expect(sideDrawer(page).getByTestId("quick-controls").first()).toBeVisible();
    expect(await entering("quick-controls")).toEqual([]);
    await closeConsole(page);
  }
});
