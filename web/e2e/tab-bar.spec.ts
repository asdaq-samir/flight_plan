import { test, expect, type Page } from "@playwright/test";
import { closeCard, closeConsole, closeProfile, grabberTo, openMapSettings, openProfile, openTab, openPanel, settle, settled, showTabs, sideDrawer, slow } from "./helpers";

/**
 * The planner's tab bar, at the pilot's ask in place of the map's buttons
 * on its left: FPL, Airport, Aircraft and Setup -- on a phone docked at the
 * screen's foot at every size, the sheet sliding above it (the owner's
 * pick, 2026-11-04), at rest the pill with the grabber over it, or a
 * route's figures over it; from `md` up the card's first row -- over a
 * card its name, Share and the close.
 */

/** Whether the tabs are docked at the screen's foot: a phone's. */
const dockedHere = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

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

test("a route rests as its figures over the docked tabs, and half way another tab keeps the panel's height and the route", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  // At rest the route's figures; on a phone over the tabs, docked at the
  // screen's foot, two rows (the owner's pick, 2026-11-04); from `md` up in
  // the tabs' place, the pill as tall as the tabs' (the owner's "When a
  // route is entered the calculations should replace the tabs in the pill
  // while keeping it the same size"). A tap on them half way.
  await expect(panel).toHaveAttribute("data-capsule", "true");
  const figures = panel.getByTestId("flight-line");
  await expect(figures).toContainText(/\d+ nm/, { timeout: slow(30000) });
  await expect(panel.getByTestId("mini-profile")).toBeHidden();
  await settled(panel);
  const docked = dockedHere(page);
  if (docked) {
    const tabs = page.getByTestId("tab-dock").getByTestId("tab-bar");
    await expect(tabs).toBeVisible();
    // The figures' row from the sheet's top to the tabs', nothing between.
    const [sheet, foot, row] = [(await panel.boundingBox())!, (await panel.getByTestId("panel-foot").boundingBox())!, (await page.getByTestId("tab-dock").boundingBox())!];
    expect(Math.abs(foot.y - sheet.y)).toBeLessThan(1.5);
    expect(Math.abs(foot.y + foot.height - row.y)).toBeLessThan(1.5);
  } else {
    await expect(panel.getByTestId("tab-bar")).toBeHidden();
    // The row's 62 and the eight it keeps clear of the screen's edge.
    expect((await panel.boundingBox())!.height).toBeLessThan(72);
  }
  const pillBar = docked ? (await page.getByTestId("tab-bar").boundingBox())! : null;
  await panel.getByTestId("panel-foot").click();
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  // Measured at rest: caught on its way up, the bar was still at the pill's.
  await settled(panel);
  const bar = (await page.getByTestId("tab-bar").boundingBox())!;
  const sheet = (await panel.boundingBox())!;
  if (pillBar) {
    // Docked: where it was in the pill, the figures pinned over it.
    expect(Math.abs(bar.y - pillBar.y)).toBeLessThan(0.5);
    const line = (await panel.getByTestId("panel-foot").boundingBox())!;
    expect(line.y + line.height).toBeLessThanOrEqual(bar.y + 1.5);
  } else {
    // From `md` up, the card's first row.
    expect(bar.y).toBeGreaterThanOrEqual(sheet.y);
    expect(bar.y).toBeLessThan(sheet.y + 40);
  }
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

test("on a phone the tabs are docked at the screen's foot: in one place at every size and through a drag, nothing of the sheet under them, and no room under their words but what centres them", async ({ page }) => {
  test.skip(!dockedHere(page), "a phone's dock");
  // The owner (2026-11-04): "The tab bar seems to be moving from bottom as
  // I am moving it between detents ... what about the space below the tabs
  // icons/text, can that be slimmer?"
  await page.goto("/app/plan");
  await settle(page);
  const panel = sideDrawer(page);
  const tabs = page.getByTestId("tab-dock").getByTestId("tab-bar");
  await expect(tabs).toBeVisible();
  const viewport = page.viewportSize()!;
  const place = async () => {
    await settled(panel);
    return (await tabs.boundingBox())!;
  };
  const pill = await place();
  // On the screen's foot: no margin under the row (Chromium has no home
  // indicator's inset), the row 52 -- the tabs 50 and two over them.
  const dock = (await page.getByTestId("tab-dock").boundingBox())!;
  expect(Math.abs(dock.y + dock.height - viewport.height)).toBeLessThan(0.5);
  expect(dock.height).toBeLessThanOrEqual(53);
  expect(pill.height).toBeGreaterThanOrEqual(44);
  // The pill is the grabber's band over the tabs.
  const sheet = (await panel.boundingBox())!;
  expect(dock.y - sheet.y).toBeGreaterThanOrEqual(9);
  expect(dock.y - sheet.y).toBeLessThan(16);
  // Under the words, only the half of the tab's room that centres its
  // glyph and word in it: as much under the word as over the glyph.
  const fpl = page.getByTestId("tab-fpl");
  const [button, glyph, word] = [(await fpl.boundingBox())!, (await fpl.locator("svg").first().boundingBox())!, (await fpl.locator("span").last().boundingBox())!];
  const over = glyph.y - button.y, under = button.y + button.height - (word.y + word.height);
  expect(Math.abs(over - under)).toBeLessThan(1.5);
  expect(dock.y + dock.height - (word.y + word.height)).toBeLessThan(6);
  for (const size of ["half", "full", "half", "peek"] as const) {
    await grabberTo(page, size);
    const at = await place();
    expect(Math.abs(at.y - pill.y), `the tabs at ${size}`).toBeLessThan(0.5);
    // The sheet's content ends on the tabs' top: the body's foot over it.
    if (size !== "peek") {
      const body = (await panel.locator("[data-panel-body]").boundingBox())!;
      expect(body.y + body.height).toBeLessThanOrEqual(dock.y + 1);
    }
  }
  // And under a finger, frame by frame, up from the pill and let go.
  await page.evaluate(() => {
    const w = window as unknown as { __tabsAt: number[] };
    w.__tabsAt = [];
    const t0 = performance.now();
    const tick = () => {
      w.__tabsAt.push(document.querySelector("[data-tab-dock] [data-testid=tab-bar]")!.getBoundingClientRect().top);
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const from = { x: pill.x + pill.width * 0.4, y: pill.y + pill.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(from.x, from.y - step * 25);
  await page.mouse.up();
  await expect(panel).not.toHaveAttribute("data-panel", "peek");
  await page.waitForTimeout(1600);
  const seen = await page.evaluate(() => (window as unknown as { __tabsAt: number[] }).__tabsAt);
  expect(seen.length).toBeGreaterThan(10);
  for (const top of seen) expect(Math.abs(top - pill.y)).toBeLessThan(0.5);
  // The drag's release picked no tab.
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");

  // Held at the foot of a drag down from half, the sheet lower than its
  // head: under the tabs nothing of the sheet's content, only its glass --
  // the route's box was drawn through them (2026-11-04's review).
  await grabberTo(page, "half");
  await settled(panel);
  const grabber = (await page.getByTestId("sidebar-trigger-button").boundingBox())!;
  const x = grabber.x + grabber.width / 2;
  await page.mouse.move(x, grabber.y + 3);
  await page.mouse.down();
  for (let y = grabber.y + 18; y < viewport.height - 1; y += 18) await page.mouse.move(x, y);
  await page.mouse.move(x, viewport.height - 1);
  await page.waitForTimeout(300);
  const under = await page.evaluate(() => {
    const top = document.querySelector("[data-tab-dock]")!.getBoundingClientRect().top;
    return [0.1, 0.3, 0.5, 0.7, 0.9].flatMap(across => [4, 26, 48].flatMap(down => document.elementsFromPoint(window.innerWidth * across, top + down)
      .filter(el => el.closest("[data-sheet-content]"))
      .map(el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} at ${Math.round(across * 100)}%, ${down} down`)));
  });
  await page.mouse.up();
  expect(under).toEqual([]);

  // A card from a control over the tab, the tabs in sight under it: the
  // tab up tapped puts it away, as an iOS tab tapped goes back to its
  // first screen, the sheet where it was -- it lowered the sheet under it.
  await grabberTo(page, "half");
  await openMapSettings(page);
  await expect(panel).toHaveAttribute("data-panel", "half");
  await page.getByTestId("tab-fpl").click();
  await expect(page.getByTestId("map-settings")).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-panel", "half");
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
});

test("FPL with no route rests as the tabs alone, its route's box half way", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  // The pill: the tabs alone, no figures.
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
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

test("the side view is a card of its own, Profile, opened by the map's Play; FPL's foot is the figures alone", async ({ page }) => {
  // The owner's asks: "FPL is simple with route, navlog, profile and
  // calculations"; then (2026-10-20) "profile view can move next to the
  // navlog button and open like brief and navlog opens instead of the
  // swipe".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  // Half way, where the map's Play is in sight over the sheet (all the
  // way up, the map's buttons are under it).
  for (const height of ["half"] as const) {
    await grabberTo(page, height);
    await expect(panel.getByTestId("flight-line")).toBeVisible({ timeout: slow(30000) });
    await expect(panel.getByTestId("mini-profile")).toHaveCount(0);
    await openProfile(page);
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
  // Its cards, a part of the flight each (the owner's D′), its pages a tap away.
  await expect(card.getByTestId("brief-glance").locator("button[data-testid^='brief-glance-']")).toHaveCount(4);
  await expect(panel.getByTestId("route-box")).toBeHidden();
  await expect(panel.getByTestId("flight-line")).toBeHidden();
  await expect(page).toHaveURL(/[?&]brief=1/);
  // En route's without the legs, FPL's own.
  await openTab(page, "En route");
  await expect(card.locator('[data-tab="enroute"] [data-title="Cruise Altitude"]')).toBeAttached();
  await expect(card.locator('[data-tab="enroute"] [data-title="Legs"]')).toHaveCount(0);
  // The close: back to the Brief's cards, then FPL as it was before the
  // Brief, all the way up on its route.
  await closeCard(page, "brief-close");
  await expect(card.getByTestId("brief-glance")).toBeVisible();
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
  await page.locator('[data-testid="tab-bar"] button[aria-current="page"]').click();
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

  test("a tap on a tab picks it, and a finger's slide along the tabs picks nothing", async ({ page }) => {
    // The lens of iOS 26 went with the sheet's rewrite (2026-11-04): the
    // tabs are plain buttons, the one up in its tinted capsule.
    await page.goto("/app/plan");
    await settle(page);
    const panel = sideDrawer(page);
    await showTabs(page);
    const size = (await panel.getAttribute("data-panel"))!;
    const tabs = page.getByTestId("tab-bar");
    const at = await tabMiddles(page);
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByTestId("tab-fpl").getByTestId("tab-bubble")).toBeVisible();
    const touch = await finger(page);
    // Slid along from FPL to Aircraft and let go: nothing picked, and the
    // sheet where it was.
    await touch("touchStart", at(0));
    for (let step = 1; step <= 12; step++) {
      await touch("touchMove", { x: at(0).x + ((at(2).x - at(0).x) * step) / 12, y: at(0).y + 2 });
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await page.waitForTimeout(300);
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    await expect(panel).toHaveAttribute("data-panel", size);
    // A tap on Aircraft picks it, its capsule with it.
    await touch("touchStart", at(2));
    await touch("touchEnd");
    await expect(tabs.getByTestId("tab-aircraft")).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByTestId("tab-aircraft").getByTestId("tab-bubble")).toBeVisible();
    await expect(tabs.getByTestId("tab-fpl").getByTestId("tab-bubble")).toHaveCount(0);
  });

  test("up or down, a finger on the tabs drags the sheet, no tab picked", async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
    await page.goto("/app/plan");
    await settle(page);
    const panel = sideDrawer(page);
    await showTabs(page);
    await grabberTo(page, "half");
    await settled(panel);
    const tabs = page.getByTestId("tab-bar");
    const at = await tabMiddles(page);
    const touch = await finger(page);
    // Up from Airport's place, a drag of the sheet: all the way up, FPL
    // still the tab.
    const from = at(1);
    await touch("touchStart", from);
    for (let step = 1; step <= 20; step++) {
      await touch("touchMove", { x: from.x + step * 0.5, y: from.y - step * 20 });
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await expect(panel).toHaveAttribute("data-panel", "full");
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
    // And down from there, on the tabs: half.
    await settled(panel);
    await showTabs(page);
    const down = (await tabs.getByTestId("tab-airport").boundingBox())!;
    const start = { x: down.x + down.width / 2, y: down.y + down.height / 2 };
    await touch("touchStart", start);
    for (let step = 1; step <= 20; step++) {
      await touch("touchMove", { x: start.x, y: start.y + step * 20 });
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await expect(panel).toHaveAttribute("data-panel", "half");
    await expect(tabs.getByTestId("tab-fpl")).toHaveAttribute("aria-current", "page");
  });
});
