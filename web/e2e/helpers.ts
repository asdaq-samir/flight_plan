import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What the browser suite's specs share: the two pages, the waits CI
 * doubles, and the drawer opened and closed the way the stock
 * components open and close it. The head of layout.spec.ts, when
 * that file held nearly every test.
 */

export const PAGES = ["/app/plan", "/app/dev"] as const;

/** The first-run tips (lib/tips) marked seen, every one, in the page's
 *  storage: for page.evaluate, or page.addInitScript where a spec starts
 *  with none of the suite's saved session. */
export function noTips() {
  localStorage.setItem("vfr.tips", JSON.stringify({ state: { seen: ["*"] }, version: 0 }));
  // The first-launch acknowledgement (lib/limits) given too: its dialog
  // takes every click. limits.spec starts without it.
  localStorage.setItem("vfr.limits", JSON.stringify({ state: { acknowledged: true }, version: 0 }));
  // The route's VFR checkpoints on, as a student has them: off by default
  // (lib/preferences), and most specs read the route through them.
  if (!localStorage.getItem("vfr.preferences")) localStorage.setItem("vfr.preferences", JSON.stringify({ state: { waypoints: true }, version: 1 }));
}

/** An explicit wait, doubled in CI: playwright.config.ts doubles the
 *  default waits there, and a wait written out here would otherwise
 *  stay at its local figure -- which on a runner carrying the stack,
 *  the browsers and a planner rendering tiles on four cores ran out. */
export const slow = (ms: number) => ms * (process.env.CI ? 2 : 1);

export async function settle(page: Page) {
  // The map's first layout pass: its first tile attached, which is
  // after the container has been measured and the chart asked for --
  // these tests assert on structure and position, not on the route's
  // data arriving. Capped at the flat 1.5 s this used to sleep every
  // time (44 times a run, 66 s summed), for a page with no map to wait
  // on; usually it is a few hundred milliseconds.
  await page.locator("img.leaflet-tile").first().waitFor({ state: "attached", timeout: 1500 }).catch(() => {});
}

/** The panel over the map (MapPanel): a sheet up from the bottom of a
 *  phone, a card over the chart otherwise. Out or not is its
 *  `data-panel`: peek at rest, half or full when it is out. */
export const sideDrawer = (page: Page) => page.locator('[data-slot="map-panel"]');

/** The tab bar's tabs in sight: the sheet's first row at half and all the
 *  way up, minimized to the tab up's name over a card (TabBar), tapped to
 *  show them all. Not in the pill, which is one row (MapPanel): the sheet
 *  half way for them. */
export async function showTabs(page: Page) {
  const title = page.getByTestId("tab-title");
  // The minimized line can turn back into the tabs by itself as it is
  // tapped -- the card it named put away by the step before -- so the tap
  // is tried, and what is asked is the tabs in sight.
  if (await title.isVisible()) await title.click({ timeout: 5000 }).catch(() => {});
  await expect(page.getByTestId("tab-title")).toBeHidden();
  if (!(await page.getByTestId("tab-bar").isVisible())) await grabberTo(page, "half");
}

/** The panel's head in sight: half way, with the route's box and its
 *  chips (Share, Procedures, Saved), a tab's search bar, a card. Nothing
 *  when it is out already, half or all the way up. */
export async function openPanel(page: Page) {
  const panel = sideDrawer(page);
  await panel.waitFor();
  if (await panel.getAttribute("data-capsule") === null) return;
  await grabberTo(page, "half");
}

/** The route's Share menu out, the panel half way: its sharing, Save,
 *  File flight plan, Print and Clear the route (PlanWorkspace), at the
 *  pilot's ask all under Share beside the chips. */
async function openShareMenu(page: Page) {
  await openPanel(page);
  await controlsInSight(page);
  await sideDrawer(page).getByTestId("share-route").click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** The route cleared, from its Share menu. */
export async function clearTheRoute(page: Page) {
  await openShareMenu(page);
  await page.getByTestId("route-clear").click();
}

const RANK = { peek: 0, half: 1, full: 2 } as const;

/** The panel to a height by its grabber (MapPanel): the pill, half and all
 *  the way up, a step at a time by the grabber's arrow keys, as a keyboard
 *  and VoiceOver move it. Each step waited on. */
export async function grabberTo(page: Page, state: "peek" | "half" | "full") {
  const panel = sideDrawer(page);
  await panel.waitFor();
  const grabber = page.getByTestId("sidebar-trigger-button");
  const size = async () => (await panel.getAttribute("data-panel")) as keyof typeof RANK;
  for (let steps = 0; steps < 6; steps++) {
    const now = await size();
    if (now === state) return;
    // Pressed again if it did not take: a layer opening in the panel (the
    // console's) takes the focus as it comes, and an arrow pressed just
    // then went to it (the iOS audit's iPad).
    // Not pressed again once it has moved: a press that took long to land
    // on a busy page, pressed twice, went on past the size asked for.
    await expect(async () => {
      if (await size() !== now) return;
      await grabber.focus();
      await page.keyboard.press(RANK[state] > RANK[now] ? "ArrowUp" : "ArrowDown");
      await expect.poll(size, { timeout: 4000 }).not.toBe(now);
    }).toPass({ timeout: 15_000 });
  }
  await expect(panel).toHaveAttribute("data-panel", state);
}

/** The route's controls in sight -- its box, the airplane, the time,
 *  Share -- all the way up, where the pill has them too (MapPanel), with
 *  room for what a chip opens. */
export async function controlsInSight(page: Page) {
  const panel = sideDrawer(page);
  await panel.waitFor();
  await grabberTo(page, "full");
  await settled(panel);
}

/** The panel all the way out, as a finger takes it: a drag on its
 *  grabber to the screen's far edge from half; from the pill, the
 *  grabber's arrow keys. */
async function panelFull(page: Page) {
  const panel = sideDrawer(page);
  await panel.waitFor();
  if ((await panel.getAttribute("data-panel")) === "full") return;
  if ((await panel.getAttribute("data-panel")) === "peek") {
    await grabberTo(page, "full");
    return;
  }
  await settled(panel);
  const box = (await panel.boundingBox())!;
  const grab = (await page.getByTestId("sidebar-trigger-button").boundingBox())!;
  const x = grab.x + grab.width / 2, y = grab.y + grab.height / 2;
  // From the bottom of a phone the grabber is the sheet's top: up. From
  // the top, its foot: down.
  const up = Math.abs(y - box.y) < Math.abs(y - (box.y + box.height));
  const viewport = page.viewportSize()!;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, up ? y - 40 : y + 40, { steps: 4 });
  await page.mouse.move(x, up ? 8 : viewport.height - 8, { steps: 10 });
  await page.mouse.up();
  await expect(panel).toHaveAttribute("data-panel", "full");
  await settled(panel);
}

/** The console out -- the tab bar's Settings -- half way at the least: at
 *  the pill, Settings picked keeps the pill (its quick controls), and the
 *  tab tapped again opens it, as every tab's does. */
export async function openConsole(page: Page) {
  await showTabs(page);
  const settings = page.getByTestId("setup-button");
  await settings.click();
  // Setup is the panel's on every screen and both pages (MapPage), which
  // at the pill is out of sight.
  // Opened at the pill's size, Setup's pill; all the way up for the rest.
  await expect(settings).toHaveAttribute("aria-current", "page");
  await grabberTo(page, "full");
}

/** The settings: the console's last tab, the console opened from its
 *  button -- on the planner's search bar, on the training page among the
 *  map's -- and all the way out. Escape closes the console again. */
export async function openSettings(page: Page) {
  await openConsole(page);
  await consolePage(page.getByTestId("console-sheet"), "Settings");
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expandConsole(page);
}

/** The map's settings: the sheet of the map's own button, first among
 *  the map's buttons (MapSettingsButton), as Maps' map button holds its
 *  map's. Escape puts it away. */
export async function openMapSettings(page: Page) {
  // The map's buttons are under a phone's sheet all the way up: the pill.
  if ((page.viewportSize()?.width ?? 0) < 768 && await sideDrawer(page).getAttribute("data-panel") === "full") await grabberTo(page, "peek");
  await page.locator("[data-map-controls]").getByTestId("map-settings-button").click();
  await expect(page.getByTestId("map-settings")).toBeVisible();
}

/** A map setting changed on the planner before a route is loaded --
 *  remembered per browser -- and the route loaded after, for a route's
 *  map that should show it. */
export async function beforeTheRoute(page: Page, change: () => Promise<void>) {
  await page.goto("/app/plan");
  await openMapSettings(page);
  await change();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-settings")).toHaveCount(0);
}

/** The console all the way out. On a phone it is a layer of the map's
 *  panel (MapPage), opened half way with the rest of its tab out of a
 *  click's reach: its grabber brings the panel all the way, as a finger's
 *  drag does. Elsewhere it has one height, and this does nothing. */
export async function expandConsole(page: Page) {
  const sheet = page.getByTestId("console-sheet");
  if ((await sheet.getAttribute("data-detent")) !== "medium") return;
  if (await sheet.evaluate(el => !!el.closest('[data-slot="map-panel"]'))) {
    await grabberTo(page, "full");
    await expect(sheet).toHaveAttribute("data-detent", "large");
    await sideDrawer(page).evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => undefined))));
    return;
  }
  // Once it has slid in.
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const box = (await sheet.boundingBox())!;
  const away = (await sheet.getAttribute("data-edge")) === "top" ? 1 : -1;
  const x = box.x + box.width / 2, y = box.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + away * 100, { steps: 5 });
  await page.mouse.move(x, y + away * 400, { steps: 10 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-detent", "large");
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
}

/** The console's title, a menu of roles -- Pilot, Developer for whoever
 *  may use dev mode, then Sign out for whoever is signed in -- opened,
 *  with the console out first. Nobody signed in and no dev mode, there
 *  is no menu (the title is plain), and neither item is there. Escape
 *  closes the menu; closeConsole puts the console away after it. */
export async function roleMenu(page: Page) {
  const sheet = page.getByTestId("console-sheet");
  if (!(await sheet.isVisible())) await openConsole(page);
  await expect(sheet).toBeVisible();
  // In the Account row (AccountMenu), first on Setup's page (the developer's
  // console has it on its Account tab).
  await consolePage(sheet, "Account");
  const trigger = sheet.getByTestId("role-menu");
  // The menu comes with who is signed in, or dev mode, once known.
  await trigger.waitFor({ timeout: 3000 }).catch(() => {});
  if (await trigger.count()) {
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
  }
  return {
    pilot: page.getByRole("menuitemradio", { name: "Pilot" }),
    developer: page.getByRole("menuitemradio", { name: "Developer" }),
  };
}

/** Escape until the console is away: a menu open in it takes the first. */
export async function closeConsole(page: Page) {
  const sheet = page.getByTestId("console-sheet");
  await expect(async () => {
    // Escape, as a keyboard puts it away, wherever the focus is.
    if (await sheet.count()) await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
}
/** The console: a stock Sheet from the top from `md` up, a sheet up from
 *  the bottom edge on a phone (shadcn's Drawer). */
export const consoleSheet = (page: Page) => page.getByTestId("console-sheet");

/** The pilot console's Personal tab (it was Library), on one of its
 *  four pages: the tab, back to its list from a page open on it, then
 *  the page's row. */
export async function library(scope: Page | Locator, section: "Aircraft" | "Flights" | "Logbook" | "Minimums") {
  await consolePage(scope, "Account");
  const list = scope.getByTestId("library-section");
  const back = scope.getByRole("button", { name: "Account", exact: true });
  await expect(list.or(back)).toBeVisible();
  if (!(await list.isVisible())) await back.click();
  await list.getByRole("button", { name: new RegExp(`^${section}`) }).click();
}

/** At rest: only its head in sight. */
export async function expectDrawerClosed(page: Page) {
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
  // And come to rest there: easing down it is still the half's layout and
  // height, over what a tap next would be aimed at. The panel's own
  // easing, not what is in it: a button's easing in the body, put out of
  // sight on the way, can stay unfinished (settled).
  await sideDrawer(page).evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined))));
}

/** Out: all the way up. */
export async function expectDrawerOpen(page: Page) {
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
}

/** Lowering the panel is one shape everywhere: Escape, pressed in it.
 *  The sheet on a phone is vaul's, a Radix dialog, whose own Escape the
 *  page turns into lowering it; the card elsewhere lowers on an Escape
 *  pressed inside it. The pointer off the panel first, as a finger is:
 *  left on the toggle, a tooltip could take the Escape. And the panel at
 *  rest first: an Escape pressed while it was still moving left it out,
 *  now and then, on a loaded machine. */
export async function closeSidebarWithTheStockKey(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  await page.mouse.move(viewport.width - 4, viewport.height / 2);
  await settled(sideDrawer(page));
  await page.getByTestId("sidebar-trigger-button").focus();
  await page.keyboard.press("Escape");
}

/** Every finite animation on and under an element run out -- a
 *  sheet's slide, the panel's width easing in. A spinner's spin is
 *  endless and left alone: waited on, it never finished. And one
 *  cancelled on the way is as done as one that ran out: its `finished`
 *  rejects, with an AbortError, and Promise.all used to take that for
 *  the whole wait failing (the Model Training drawer, its table drawn
 *  at once from the planner's kept read, three times running on CI).
 *  Nor one out of sight in a tab not up (PanelTabs' tab-away,
 *  content-visibility: hidden) or scrolled out of sight under
 *  content-visibility: auto: the browser stops updating it there, and
 *  its `finished` never comes -- the nav log's rows, arriving as the
 *  Weather tab opened, held this for two minutes on CI, and the
 *  briefing's Write button, its visibility easing as the sheet came
 *  down to the pill, for a minute. */
export async function settled(locator: Locator) {
  await locator.evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(a => a.effect?.getTiming().iterations !== Infinity)
    .filter(a => {
      const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
      return !target || target.checkVisibility({ contentVisibilityAuto: true });
    })
    .map(a => a.finished.catch(() => undefined))));
}

/** The panel's box once it is out and done moving: measured 300 ms
 *  after the tap, a drawer was 29 px short of its width on a loaded
 *  runner. */
export async function openedDrawerBox(page: Page) {
  await expectDrawerOpen(page);
  await settled(sideDrawer(page));
  return sideDrawer(page).boundingBox();
}

export async function openSidebar(page: Page) {
  const sidebarTrigger = page.getByTestId("sidebar-trigger-button");
  // All the way up, the grabber's Up arrow (grabberTo).
  await grabberTo(page, "full");
  await expectDrawerOpen(page);
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(sidebarTrigger).toBeEnabled();

  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "false");
}

/** The briefing is the flight planning panel: open it from its
 *  toggle, and the URL says so. */
export async function openBriefing(page: Page) {
  await grabberTo(page, "full");
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expectDrawerOpen(page);
}

/** One of the planning panel's tabs: Nav Log (Local, for one airport to
 *  itself), Brief, Weather, Performance or Airports. The Brief asks for its
 *  narrative as it opens -- a real, billed Claude call -- so here it is
 *  answered with a line of its own. */
/** The planning panel's tabs by the names they had before they were the
 *  flight's phases (the owner's pick of the redesign, "C"): the Brief's
 *  go / no-go is Preflight's, the nav log and the weather on the way En
 *  route's, the takeoff Depart's. */
const PHASE_OF = { Brief: "Preflight", "Nav Log": "En route", Local: "En route", Weather: "En route", Performance: "Depart" } as const;
type PhaseTab = "Preflight" | "Depart" | "En route" | "Arrive";

export async function openTab(page: Page, name: keyof typeof PHASE_OF | PhaseTab) {
  // The tabs are past the half panel's foot, which ends at the flight's
  // line: all the way out, as a finger drags it, to reach them.
  await panelFull(page);
  const phase: PhaseTab = name in PHASE_OF ? PHASE_OF[name as keyof typeof PHASE_OF] : name as PhaseTab;
  if (phase === "Preflight") {
    await page.route(url => url.pathname.endsWith("/api/comparison"), route => route.fulfill({
      status: 200, contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "done", briefing: "A test narrative." }) + "\n",
    }));
  }
  // Not the tab up already: tapped again all the way up, it lowers the
  // panel to half (PanelTabs).
  const tab = panelTabs(page).getByRole("tab", { name: phase, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** The planning panel's own tabs. */
export const panelTabs = (page: Page) => sideDrawer(page).locator('[role="tablist"][data-tip="tabs"]');

const PHASES: PhaseTab[] = ["Preflight", "Depart", "En route", "Arrive"];

/** A section by its title, brought into sight: on the tab up, or on
 *  whichever of the phases' tabs holds it (an airport's on Depart or
 *  Arrive, the winds on En route), its sections one under another. */
export async function openSection(page: Page, title: string) {
  const panel = sideDrawer(page);
  const here = panel.locator(`[role="tabpanel"][data-state="active"] [data-title="${title}"]`).first();
  if (!(await here.isVisible().catch(() => false))) {
    for (const phase of PHASES) {
      const tab = panelTabs(page).getByRole("tab", { name: phase, exact: true });
      if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
      if (await here.waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
    }
  }
  // A section drawn again as its tab's content arrives can be detached
  // between finding it and scrolling to it: tried until it holds still.
  await expect(async () => { await here.scrollIntoViewIfNeeded({ timeout: 2000 }); }).toPass({ timeout: 10000 });
}

/** Once the map has stopped moving: its panes where they were 300 ms
 *  before, and no zoom animating. A route being fitted, or a card
 *  moving the map to keep the route clear of the panel, moves it after
 *  the page looks settled. */
export async function mapStill(page: Page) {
  await expect.poll(() => page.locator(".leaflet-map-pane").evaluate(async pane => {
    const before = (pane as HTMLElement).style.transform;
    await new Promise(r => setTimeout(r, 300));
    return before === (pane as HTMLElement).style.transform && !pane.closest(".leaflet-zoom-anim");
  }), { timeout: slow(10000) }).toBe(true);
}

/** A tap on the chart itself, somewhere nothing else is: not a marker,
 *  a popup, the panel over the map or its buttons -- found by asking the
 *  browser what is under each candidate point. */
export async function tapTheChart(page: Page) {
  // Once the map is still: a spot found empty in a move had a field's
  // chip slide under it before the tap (KCWI, on CI's desktop).
  await mapStill(page);
  const at = await page.locator(".leaflet-container").evaluate(map => {
    const r = map.getBoundingClientRect();
    // Clear of every mark by more than a near miss (AirportsLayer's 22),
    // which a tap there would select.
    const marks = [...map.querySelectorAll(".leaflet-marker-icon, .leaflet-airport-target")].map(m => m.getBoundingClientRect());
    const clear = (x: number, y: number) => marks.every(m => x < m.left - 30 || x > m.right + 30 || y < m.top - 30 || y > m.bottom + 30);
    for (let fy = 0.85; fy > 0.1; fy -= 0.1) {
      for (let fx = 0.15; fx < 0.9; fx += 0.1) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && map.contains(hit) && clear(x, y) && (hit.matches("img.leaflet-tile") || hit.matches(".leaflet-container, .leaflet-pane, .leaflet-layer, .leaflet-tile-container"))) return { x, y };
      }
    }
    return null;
  });
  expect(at, "somewhere on the chart with nothing on it").not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
}

/** A card put away by its way back: on a phone with the sheet up, the
 *  minimized tab bar's Back at its top left (TabBar), at the owner's ask,
 *  in place of the card's close; elsewhere the card's own close. */
export async function closeCard(page: Page, closeTestId: string) {
  const back = page.getByTestId("tab-back");
  if (await back.isVisible()) {
    await back.click();
    return;
  }
  // Else the card's own close, out of sight but for a keyboard (CardClose).
  const close = page.getByTestId(closeTestId);
  await close.focus();
  await page.keyboard.press("Enter");
}

/** The console's Personal tab, where who is signed in and the mode are
 *  (AccountMenu), at the owner's ask: they were the console's title row. */
export async function openAccount(page: Page) {
  await consolePage(page.getByTestId("console-sheet"), "Account");
}

/** One of the console's places by name: the developer's console's tab of
 *  that name; the pilot's console is one page now (Setup, at the owner's
 *  pick of the redesign), its account first and Settings, Guide and About
 *  rows that open their pages -- Account is the page itself. */
export async function consolePage(scope: Page | Locator, name: "Account" | "Settings" | "Guide" | "About" | "Status") {
  const tab = scope.getByRole("tab", { name, exact: true });
  const setup = scope.getByTestId("setup-page");
  await expect(tab.or(setup).first()).toBeVisible();
  if (await tab.count()) {
    await tab.click();
    return;
  }
  // Back to the page's list from a page open on it.
  const back = scope.getByRole("button", { name: "Account", exact: true });
  if (await back.isVisible()) await back.click();
  if (name !== "Account") await setup.getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

/** Airport's search bar, in sight: on the Airport tab, its pill's one row
 *  or its head half way (FPL is the tab a fresh load opens on). */
export async function airportSearch(page: Page) {
  const search = page.getByTestId("search-airports");
  if (await search.isVisible()) return search;
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await expect(search).toBeVisible();
  return search;
}
