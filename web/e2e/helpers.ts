import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What the browser suite's specs share: the two pages, the waits CI
 * doubles, and the drawer opened and closed the way the stock
 * components open and close it. The head of layout.spec.ts, when
 * that file held nearly every test.
 */

export const PAGES = ["/app/plan", "/app/dev"] as const;

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

/** The panel out half way, where its head is the route form, the
 *  workspace's actions and the controls: at rest a route is a capsule
 *  (MapPanel's compact), whose chip opens it. Nothing when it is out
 *  already or rests on its form. */
export async function openPanel(page: Page) {
  const panel = sideDrawer(page);
  await panel.waitFor();
  if (await panel.getAttribute("data-capsule") === null) return;
  await page.getByTestId("capsule-detail").click();
  await expect(panel).toHaveAttribute("data-panel", "half");
}

/** The settings: the console's last tab, the console opened from its
 *  button -- on the planner's search bar, on the training page among the
 *  map's -- and all the way out. Escape closes the console again. */
export async function openSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("console-sheet").getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expandConsole(page);
}

/** A setting changed on the planner before a route is loaded: its
 *  console's button is on the search bar alone (MapPage), which a route
 *  takes the place of, so a setting a route's map should show is set
 *  first -- remembered per browser -- and the route loaded after. */
export async function beforeTheRoute(page: Page, change: () => Promise<void>) {
  await page.goto("/app/plan");
  await openSettings(page);
  await change();
  await closeConsole(page);
}

/** The console all the way out. On a phone it opens half way, at iOS's
 *  medium detent (ConsoleSheet), with the rest of its tab past the
 *  screen's middle and out of a click's reach; a drag on its head away
 *  from its edge brings it all the way, as a finger's does. Elsewhere it
 *  has one height, and this does nothing. */
export async function expandConsole(page: Page) {
  const sheet = page.getByTestId("console-sheet");
  if ((await sheet.getAttribute("data-detent")) !== "medium") return;
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
  if (!(await sheet.isVisible())) await page.getByTestId("settings-button").click();
  await expect(sheet).toBeVisible();
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
    if (await sheet.count()) await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
}
/** The console: a stock Sheet from the top from `md` up, a sheet up from
 *  the bottom edge on a phone (shadcn's Drawer). */
export const consoleSheet = (page: Page) => page.getByTestId("console-sheet");

/** The pilot console's Library, on one of its three: the tab, then the
 *  segment. */
export async function library(scope: Page | Locator, section: "Aircraft" | "Flights" | "Logbook") {
  await scope.getByRole("tab", { name: "Library" }).click();
  await scope.getByTestId("library-section").getByRole("radio", { name: section }).click();
}

/** At rest: only its head in sight. */
export async function expectDrawerClosed(page: Page) {
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
}

/** Out: half the screen or the whole of it. */
export async function expectDrawerOpen(page: Page) {
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", /^(half|full)$/);
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
 *  at once from the planner's kept read, three times running on CI). */
export async function settled(locator: Locator) {
  await locator.evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(a => a.effect?.getTiming().iterations !== Infinity)
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
  await sidebarTrigger.click();
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
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page).toHaveURL(/[?&]view=briefing/);
  await expectDrawerOpen(page);
}

/** One of the planning panel's tabs: Nav Log (Local, for one airport to
 *  itself), Brief, Weather, Performance or Airports. The Brief asks for its
 *  narrative as it opens -- a real, billed Claude call -- so here it is
 *  answered with a line of its own. */
export async function openTab(page: Page, name: "Brief" | "Nav Log" | "Local" | "Weather" | "Performance" | "Airports") {
  if (name === "Brief") {
    await page.route(url => url.pathname.endsWith("/api/comparison"), route => route.fulfill({
      status: 200, contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "done", briefing: "A test narrative." }) + "\n",
    }));
  }
  await sideDrawer(page).getByRole("tab", { name, exact: true }).click();
  await expect(sideDrawer(page).getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
}

/** A tap on the chart itself, somewhere nothing else is: not a marker,
 *  a popup, the panel over the map or its buttons -- found by asking the
 *  browser what is under each candidate point. */
export async function tapTheChart(page: Page) {
  const at = await page.locator(".leaflet-container").evaluate(map => {
    const r = map.getBoundingClientRect();
    for (let fy = 0.85; fy > 0.1; fy -= 0.1) {
      for (let fx = 0.15; fx < 0.9; fx += 0.1) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && map.contains(hit) && (hit.matches("img.leaflet-tile") || hit.matches(".leaflet-container, .leaflet-pane, .leaflet-layer, .leaflet-tile-container"))) return { x, y };
      }
    }
    return null;
  });
  expect(at, "somewhere on the chart with nothing on it").not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
}
