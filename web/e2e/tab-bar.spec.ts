import { test, expect, type Page } from "@playwright/test";
import { closeCard, closeConsole, closeProfile, grabberTo, openTab, openPanel, panelTabs, settle, settled, showTabs, sideDrawer, slow } from "./helpers";

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
  await page.getByTestId("pill-menu-change").click();
  await expect(page.getByPlaceholder("Search for a destination")).toBeVisible();
});

test("the side view is a card of its own, Profile, from its button beside the nav log's, half way and all the way up; FPL's foot is the figures alone", async ({ page }) => {
  // The owner's asks: "FPL is simple with route, navlog, profile and
  // calculations"; then (2026-10-20) "profile view can move next to the
  // navlog button and open like brief and navlog opens instead of the
  // swipe".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  for (const height of ["half", "full"] as const) {
    await grabberTo(page, height);
    await expect(panel.getByTestId("flight-line")).toBeVisible({ timeout: slow(30000) });
    await expect(panel.getByTestId("mini-profile")).toHaveCount(0);
    await panel.getByTestId("altitude-why").click();
    // At the height FPL was, the route's name under the card's, the side
    // view over the figures.
    await expect(panel).toHaveAttribute("data-panel", height);
    const card = panel.getByTestId("profile-card");
    await expect(card.getByTestId("profile-name")).toHaveText("C81 → KDLH");
    await expect(card).toContainText("C81 → KDLH");
    const profile = card.getByTestId("mini-profile");
    await expect(profile).toBeVisible();
    await settled(panel);
    const [side, line] = [(await profile.boundingBox())!, (await panel.getByTestId("flight-line").boundingBox())!];
    expect(side.y + side.height).toBeLessThanOrEqual(line.y + 1);
    // A picture, with nothing to open.
    await expect(profile).toHaveAttribute("role", "img");
    await closeProfile(page);
    await expect(panel).toHaveAttribute("data-panel", height);
  }
  // FPL all the way up is the route in order alone: no pages, no other
  // section, no side view.
  const log = panel.getByTestId("navlog-scroller");
  await expect(log.getByTestId("procedures")).toBeVisible();
  await expect(panel.locator('[role="tablist"][data-tip="tabs"]')).toHaveCount(0);
  await expect(log.locator("[data-title]")).toHaveCount(1);
});

test("the Brief is a card over FPL, from the chips' Brief: Preflight, Depart, En route and Arrive, with Back to the nav log", async ({ page }) => {
  // The owner's ask: "we don't need the folder button because we have a
  // saved section with tiles instead. So then we can have a brief button
  // which can open a new brief card to have everything preflight, depart,
  // enroute, arrive. But FPL is simple with route, navlog, profile and
  // calculations".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("route-saved")).toHaveCount(0);
  await panel.getByTestId("route-brief").click();
  // At the height FPL was, all the way up (the owner's "Brief opens in
  // half card when clicked on full fpl tab"); the route's name at its
  // head, its pages under it, the route's box and figures out of sight.
  await expect(panel).toHaveAttribute("data-panel", "full");
  const card = panel.getByTestId("brief-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("brief-name")).toHaveText("C81 → KDLH");
  await expect(card.getByTestId("brief-line")).toContainText("Campbell to Duluth");
  await expect(panelTabs(page).getByRole("tab")).toHaveText(["Preflight", "Depart", "En route", "Arrive"]);
  await expect(panel.getByTestId("route-box")).toBeHidden();
  await expect(panel.getByTestId("flight-line")).toBeHidden();
  await expect(page).toHaveURL(/[?&]brief=1/);
  // En route's without the legs, FPL's own.
  await openTab(page, "En route");
  await expect(card.locator('[data-tab="enroute"] [data-title="Cruise Altitude"]')).toBeAttached();
  await expect(card.locator('[data-tab="enroute"] [data-title="Legs"]')).toHaveCount(0);
  // Back: FPL as it was before the Brief, all the way up on its route.
  await closeCard(page, "brief-close");
  await expect(card).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]brief=/);
  await expect(panel).toHaveAttribute("data-panel", "full");
  await expect(panel.getByTestId("navlog-scroller").getByTestId("procedures")).toBeVisible();
});

test("a card opens half way; on a phone, lowered to the pill it is its name and its close, which puts it away", async ({ page }) => {
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "half");
  const name = panel.getByTestId("place-card").getByTestId("place-name");
  await expect(name).toBeVisible({ timeout: slow(15000) });
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the tabs minimize to a card's name on a phone only");
  // Down to the pill: the minimized tabs, the card's name, Share and the
  // close, which goes back to the tab as Back did.
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
  // Setup and back to the tab under it: the card still over it, as it
  // was left -- not the tab up tapped again (the owner's notice of an
  // airplane's card gone after Setup).
  await showTabs(page);
  await page.getByTestId("setup-button").click();
  await expect(sideDrawer(page).getByTestId("setup-page")).toBeVisible();
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await expect(sideDrawer(page).getByTestId("setup-page")).toBeHidden();
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

test("with a mouse's wheel, down over the panel brings it up a size, up takes it down, and sideways switches no tab", async ({ page }) => {
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
  // Sideways: no tab (the owner's "let's not support swipe to switch tabs").
  await flick(40, 0);
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

test.describe("the tabs under a finger", () => {
  test.use({ hasTouch: true });

  /** One finger, through Chromium's own touches (CDP). */
  async function finger(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    return (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ ...at, id: 1 }] : [] });
  }

  /** The middle of each of the tab bar's tabs. */
  async function tabMiddles(page: Page) {
    const bar = page.getByTestId("tab-bar");
    const box = (await bar.boundingBox())!;
    const count = await bar.locator("button").count();
    return (i: number) => ({ x: box.x + (box.width / count) * (i + 0.5), y: box.y + box.height / 2 });
  }

  test("a finger held on the tabs lifts the lens, the pill growing; slid along, the lens follows, and let go it picks the tab under it", async ({ page }) => {
    // The owner's recording of iOS 26's tab bar, Netflix's (2026-10-16).
    await page.goto("/app/plan");
    await settle(page);
    const panel = sideDrawer(page);
    await showTabs(page);
    const size = (await panel.getAttribute("data-panel"))!;
    const tabs = panel.getByTestId("tab-bar");
    const bubble = panel.getByTestId("tab-bubble");
    const at = await tabMiddles(page);
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    const touch = await finger(page);
    await touch("touchStart", at(0));
    // Held, the lens is up, and the pill -- a phone's panel at rest -- is
    // a little bigger, still clear of the screen's sides.
    await expect(bubble).toHaveAttribute("data-lifted", "");
    if (size === "peek") {
      await expect.poll(() => panel.evaluate(el => Number(getComputedStyle(el).scale))).toBeGreaterThan(1.01);
      const grown = (await panel.boundingBox())!;
      expect(grown.x).toBeGreaterThanOrEqual(2);
      expect(grown.x + grown.width).toBeLessThanOrEqual(page.viewportSize()!.width - 2);
    }
    // Slid along to Aircraft, a frame a move: the tab under the lens is
    // lit on the way, Airport half way, and the sheet stays where it is.
    for (let step = 1; step <= 12; step++) {
      await touch("touchMove", { x: at(0).x + ((at(2).x - at(0).x) * step) / 12, y: at(0).y + 2 });
      await page.waitForTimeout(16);
      if (step === 6) await expect(tabs.getByTestId("tab-airport")).toHaveAttribute("data-lit", "true");
    }
    await expect(tabs.getByTestId("tab-aircraft")).toHaveAttribute("data-lit", "true");
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    await expect(panel).toHaveAttribute("data-panel", size);
    // Let go: Aircraft is the tab up, as a tap on it makes it, and the lens
    // and the pill are as they were.
    await touch("touchEnd");
    await expect(tabs.getByTestId("tab-aircraft")).toHaveAttribute("aria-current", "page");
    await expect(bubble).not.toHaveAttribute("data-lifted");
    await expect.poll(() => panel.evaluate(el => getComputedStyle(el).scale)).toMatch(/^(none|1)$/);
  });

  test("the lens let go on the tab it was lifted from leaves the tab and the sheet as they were, and up or down the tabs drag the sheet, the lens staying down", async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
    await page.goto("/app/plan");
    await settle(page);
    const panel = sideDrawer(page);
    await showTabs(page);
    await grabberTo(page, "half");
    await settled(panel);
    const tabs = panel.getByTestId("tab-bar");
    const at = await tabMiddles(page);
    const touch = await finger(page);
    // Out to Airport and back to FPL, held: FPL as it was, the sheet half
    // way -- not lowered, as a tap on the tab up lowers it.
    await touch("touchStart", at(0));
    await expect(panel.getByTestId("tab-bubble")).toHaveAttribute("data-lifted", "");
    for (const x of [at(0).x + 30, at(1).x, at(0).x + 30, at(0).x]) {
      await touch("touchMove", { x, y: at(0).y });
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    await page.waitForTimeout(500);
    await expect(panel).toHaveAttribute("data-panel", "half");
    // Up from Airport's place, a drag of the sheet: all the way up, FPL
    // still the tab, and the lens never lifted under it.
    await page.evaluate(() => {
      const seen = window as unknown as { lensLifted: number };
      seen.lensLifted = 0;
      new MutationObserver(() => { if (document.querySelector("[data-lifted]")) seen.lensLifted++; })
        .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-lifted"] });
    });
    const from = at(1);
    await touch("touchStart", from);
    for (let step = 1; step <= 20; step++) {
      await touch("touchMove", { x: from.x + step * 0.5, y: from.y - step * 20 });
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await expect(panel).toHaveAttribute("data-panel", "full");
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => (window as unknown as { lensLifted: number }).lensLifted)).toBe(0);
  });
});
