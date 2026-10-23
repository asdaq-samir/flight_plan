import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, settled, showTabs, sideDrawer, stripShows } from "./helpers";

/**
 * Each tab's pill, the tabs, at the owner's ask ("When no route is entered,
 * let's have tabs on the pill"), FPL's route's figures pinned under them
 * ("If a route is entered, then let's pin the calculations at the
 * bottom"). Half way, one height on every tab, each tab's own under its
 * head -- Airport's and Aircraft's Favorites. And a card's way back on a
 * phone: Back at the top left of the minimized tabs' line, a close at its
 * right.
 */

const KDLH = { ident: "KDLH", name: "Duluth International Airport", municipality: "Duluth", lat: 46.842, lon: -92.194 };

async function keep(page: Page, state: Record<string, unknown>) {
  await page.addInitScript(kept => {
    if (sessionStorage.getItem("pills-seeded")) return;
    sessionStorage.setItem("pills-seeded", "1");
    localStorage.setItem("vfr.preferences", JSON.stringify({ state: kept, version: 0 }));
  }, state);
}

/** A finger's pointer events across the panel, `by` points sideways: on
 *  the tab bar's row, in its margin beside the tabs, as what is under the
 *  row changes with the tab, a row that slides sideways keeps the finger,
 *  and on the tabs themselves a finger slides their lens. */
async function swipeAcross(page: Page, by: number) {
  const panel = sideDrawer(page);
  const row = (await panel.getByTestId("tab-bar").locator("xpath=..").boundingBox())!;
  const x0 = by > 0 ? row.x + 5 : row.x + row.width - 5;
  const y = row.y + row.height / 2;
  await panel.evaluate((el, [from, to, at]) => {
    const target = document.elementFromPoint(from, at) ?? el;
    const opts = { bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerId: 7, pointerType: "touch" };
    target.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: from, clientY: at }));
    target.dispatchEvent(new PointerEvent("pointerup", { ...opts, clientX: to, clientY: at + 4 }));
  }, [x0, x0 + by, y]);
}

/** A tab picked half way. */
async function pickHalf(page: Page, tab: string) {
  await showTabs(page);
  await page.getByTestId(tab).click();
  await grabberTo(page, "half");
}

test("each tab's pill is the tabs, FPL's with a route its figures in their place at the same height, and half way is one height on every tab", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  const height = async () => {
    await settled(panel);
    return (await panel.boundingBox())!.height;
  };
  await expect(panel.getByTestId("flight-line")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("tab-bar")).toBeHidden();
  const fpl = await height();
  // Another tab picked at the pill: half way, then down: the tabs alone.
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await grabberTo(page, "peek");
  await expect(panel.getByTestId("tab-bar")).toBeVisible();
  await expect(panel.getByTestId("search-airports")).toBeHidden();
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);
  // The same height as FPL's figures (the owner's "keeping it the same size").
  expect(Math.abs(await height() - fpl)).toBeLessThan(1);
  // Half way one height on every tab, FPL's with its route too (the
  // owner's "Keep the half card consistent in size for all tabs including
  // fpl").
  await grabberTo(page, "half");
  const half = await height();
  for (const tab of ["tab-aircraft", "tab-fpl", "setup-button"]) {
    await page.getByTestId(tab).click();
    await expect(panel).toHaveAttribute("data-panel", "half");
    expect(Math.abs(await height() - half)).toBeLessThan(1);
  }
  // Setup's account within it (the owner's "so email in setup fits at the
  // bottom"): its title, the address now the role menu's (AccountMenu).
  const address = panel.getByTestId("role-menu").or(panel.getByTestId("setup-pill-account")).first();
  const [row, sheet] = [(await address.boundingBox())!, (await panel.boundingBox())!];
  expect(row.y + row.height).toBeLessThanOrEqual(sheet.y + sheet.height);
});

test("each tab half way shows its own: Airport its Favorites and Nearest, Aircraft its Favorites and a question", async ({ page }) => {
  await keep(page, { favoriteAirports: [KDLH] });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);

  // Airport: the Favorites, small, a tap opening the field's card; its
  // search bar over them.
  await pickHalf(page, "tab-airport");
  const tile = panel.getByTestId("pill-favorites").getByTestId("pill-favorite");
  await expect(tile).toHaveText(/KDLH/);
  const search = panel.getByTestId("search-airports");
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.y).toBeLessThan((await tile.boundingBox())!.y);
  // A finger's 44 points.
  expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Aircraft, with no airplane kept: Plane all the same, with Add.
  await pickHalf(page, "tab-aircraft");
  await expect(panel.getByTestId("pill-aircraft-mine")).toHaveText(/Plane\s*Add/);
  await expect(panel.getByTestId("aircraft-search")).toBeVisible();

  // One strip, the owner's "one row, it can have the favorites with the
  // filter": its title the Favorites' way to them in full, what it shows a
  // menu at the row's right -- the Favorites first, the questions after
  // them -- and Only these on the map at its top, at the owner's ask ("Can
  // the aircraft map toggle be part of the filter, maybe on top?").
  const question = panel.getByTestId("pill-section-question");
  await expect(question.getByTestId("pill-section-question-more")).toHaveText("Favorites");
  await panel.getByTestId("aircraft-question").click();
  const onMap = page.getByTestId("aircraft-map-only");
  await expect(onMap).toHaveAttribute("aria-checked", "false");
  await onMap.click();
  await panel.getByTestId("aircraft-question").click();
  await expect(page.getByTestId("aircraft-map-only")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("question-near").click();
  // A question's title names it, with no list in full to open.
  await expect(question.getByRole("heading", { name: "Nearest" })).toBeVisible();
  await expect(question.getByTestId("pill-section-question-more")).toHaveCount(0);
  await expect(panel.getByTestId("pill-aircraft-mine")).toHaveCount(0);
  await panel.getByTestId("aircraft-question").click();
  await page.getByTestId("question-favorites").click();
  await expect(panel.getByTestId("pill-aircraft-mine")).toBeVisible();

  // Airport's one strip, the nearest fields too from the menu at its
  // heading's right (NRST folded in, four tabs), or with no position the
  // way to show it; its title the way to the list in full.
  await pickHalf(page, "tab-airport");
  await expect(panel.getByTestId("pill-section-favorites-more")).toHaveText("Favorites");
  await panel.getByTestId("airport-strip-shows").click();
  await page.getByTestId("airport-shows-nearest").click();
  await expect(panel.getByTestId("pill-section-nearest-more")).toHaveText("Nearest");
  await expect(panel.getByTestId("nearest-strip").or(panel.getByTestId("nearest-strip-position"))).toBeVisible();
  await expect(panel.getByTestId("pill-favorites")).toHaveCount(0);
  await panel.getByTestId("airport-strip-shows").click();
  await page.getByTestId("airport-shows-favorites").click();
  await expect(tile).toBeVisible();
  await expect(page.getByTestId("tab-nrst")).toHaveCount(0);
  await tile.click();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
});

test("each tab's one strip picks its list from the filter at its heading's right, the title opening that list in full", async ({ page }) => {
  // The owner's ask: "apply the filter to other cards too so for example
  // saved and recents in fpl can be filtered or favorites and recents in
  // airport/aircraft".
  await keep(page, {
    favoriteAirports: [KDLH],
    recentAirports: [{ ident: "KMSN", name: "Dane County Regional Airport", municipality: "Madison" }],
    recentAircraft: [{ hex: "a1c2d3", name: "N200XY", type: "C172" }],
    recentRoutes: [{ dep: "C81", dest: "KDLH", stops: [], at: Date.UTC(2026, 9, 15, 15) }],
  });
  await page.goto("/app/plan");
  await settle(page);
  const panel = sideDrawer(page);

  // FPL: Saved first, then the routes planned last.
  await pickHalf(page, "tab-fpl");
  await expect(panel.getByTestId("pill-section-saved-more")).toHaveText("Saved");
  await stripShows(page, "fpl-strip-shows", "fpl-shows-recents");
  await expect(panel.getByTestId("route-recents-more")).toHaveText("Recents");
  await expect(panel.getByTestId("route-recent")).toContainText("C81→KDLH");

  // Airport: the Favorites, the airports opened last, the nearest fields.
  await pickHalf(page, "tab-airport");
  await expect(panel.getByTestId("pill-section-favorites-more")).toHaveText("Favorites");
  await stripShows(page, "airport-strip-shows", "airport-shows-recents");
  await expect(panel.getByTestId("airport-recents-more")).toHaveText("Recents");
  await expect(panel.getByTestId("airport-recent")).toContainText("KMSN");
  await panel.getByTestId("airport-recents-more").click();
  await expect(panel.getByTestId("airport-recents-page")).toBeVisible();
  await panel.getByTestId("airport-recents-page-close").click();
  await expect(panel.getByTestId("airport-recent")).toContainText("KMSN");

  // Aircraft: the Favorites, the airplanes opened last, then the questions.
  await pickHalf(page, "tab-aircraft");
  await expect(panel.getByTestId("pill-section-question-more")).toHaveText("Favorites");
  await stripShows(page, "aircraft-question", "question-recents");
  await expect(panel.getByTestId("aircraft-recents-more")).toHaveText("Recents");
  await expect(panel.getByTestId("pill-aircraft-recents").getByTestId("aircraft-recent")).toContainText("N200XY");
  await panel.getByTestId("aircraft-recents-more").click();
  await expect(panel.getByTestId("aircraft-recents-page")).toBeVisible();
  await panel.getByTestId("aircraft-recents-page-close").click();
  await expect(panel.getByTestId("pill-aircraft-recents")).toBeVisible();
});

test("a list in full keeps its place as a card does: another tab and back, Setup and back, a link to it; the tab up tapped again puts it away", async ({ page }) => {
  // The owner's pick ("Yes to both"): lists keep their place as cards do.
  await keep(page, { favoriteAirports: [KDLH] });
  await page.goto("/app/plan");
  await settle(page);
  const panel = sideDrawer(page);
  await pickHalf(page, "tab-airport");
  await panel.getByTestId("pill-section-favorites-more").click();
  const list = panel.getByTestId("favorites-list");
  await expect(list).toBeVisible();
  await expect(page).toHaveURL(/[?&]list=favorites/);
  // Another tab, and back to Airport: the list again.
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await expect(list).toHaveCount(0);
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await expect(list).toBeVisible();
  // Setup, and back.
  await showTabs(page);
  await page.getByTestId("setup-button").click();
  await expect(panel.getByTestId("setup-page")).toBeVisible();
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await expect(list).toBeVisible();
  // A link to it -- the address as it is -- lands on the list all the way
  // up, as a link to a card does. A reload starts clean, as before
  // (lib/freshLoad): the owner's fresh start, as Maps opens.
  await page.goto(page.url());
  await settle(page);
  await expect(list).toBeVisible();
  await expect(panel).toHaveAttribute("data-panel", "full");
  // The tab up tapped again puts it away, the sheet where it is, as it
  // puts a card away.
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await expect(list).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]list=/);
  await expect(panel).toHaveAttribute("data-panel", "full");
});

test("a Favorite is taken off as a Recent is: a swipe to the left uncovers its Delete", async ({ page }) => {
  // The owner's pick of one way to remove ("Yes to both"): a swipe on
  // every kept list, Edit's minus bringing out the same Delete.
  await keep(page, { favoriteAirports: [KDLH] });
  await page.goto("/app/plan?list=favorites");
  await settle(page);
  const list = sideDrawer(page).getByTestId("favorites-list");
  await expect(list).toBeVisible();
  const row = list.getByTestId("swipe-row").filter({ hasText: "KDLH" });
  await row.evaluate(el => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeGreaterThan(40);
  await row.getByTestId("swipe-delete").click();
  await expect(list).toContainText("A star on an airport's card adds it here");
});

test("on a phone, an airport's card opened from another tab has Share at the top left of the tabs' line, and its close goes back", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the tabs minimize on a phone only");
  // An airport's card over FPL (a route's field): the bar its kind, Share
  // where Back was and the close going back as Back did, at the owner's
  // ask ("replace the back button on airport/aircraft with the share
  // button. The close button should behave like the back button").
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  const share = page.getByTestId("tab-share");
  await expect(share).toHaveAccessibleName("Share KDLH");
  await expect(page.getByTestId("tab-back")).toHaveCount(0);
  const title = (await page.getByTestId("tab-title").boundingBox())!;
  const shareBox = (await share.boundingBox())!;
  // At the left, on the tab label's line; the card's own close gone.
  expect(shareBox.x + shareBox.width).toBeLessThan(title.x);
  expect(Math.abs(shareBox.y + shareBox.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(2);
  // Out of sight, kept for a keyboard and a screen reader (CardClose).
  expect(await panel.getByTestId("place-close").evaluate(el => !!el.closest(".sr-only"))).toBe(true);
  const close = page.getByTestId("tab-close");
  expect((await close.boundingBox())!.x).toBeGreaterThan(title.x + title.width);
  // Shared: the field's card on the planner, by its address.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: (item: { url: string }) => { (window as unknown as { shared: string }).shared = item.url; return Promise.resolve(); } });
  });
  await share.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared?: string }).shared)).toMatch(/\/app\/plan\?place=KDLH$/);
  // The close: one card back, as Back went.
  await close.click();
  await expect(page).not.toHaveURL(/[?&]place=/);
  // At the tab's own screen neither: nothing to go back to.
  await expect(share).toHaveCount(0);
});

test("on a phone, a tap anywhere on the tabs' minimized line shows the tabs, but Back goes back", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the tabs minimize on a phone only");
  // The owner's ask: "Clicking anywhere on the tabs bar should show tabs
  // except the back/close button should do their action".
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  const title = page.getByTestId("tab-title");
  const back = (await page.getByTestId("tab-share").boundingBox())!;
  const close = (await page.getByTestId("tab-close").boundingBox())!;
  const line = (await title.boundingBox())!;
  // Between Share and the title, off both: the tabs.
  await page.mouse.click((back.x + back.width + line.x) / 2, line.y + line.height / 2);
  await expect(page.getByTestId("tab-fpl")).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  // The close on a fresh load does its own, not the tabs'.
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  expect(close.x).toBeGreaterThan(line.x);
  await page.getByTestId("tab-close").click();
  await expect(page).not.toHaveURL(/[?&]place=/);
});

test("Plane, the pilot's own, is first among the Aircraft card's Favorites, with Add until one is kept, and kept from the search's pick", async ({ page }) => {
  await keep(page, { recentAircraft: [{ hex: "a1c2d3", name: "N200XY", type: "C172" }] });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  const card = page.getByTestId("aircraft-card");
  // The pill's strip, where it is at the pill's size, Plane first.
  const mine = card.getByTestId("pill-aircraft-mine");
  await expect(mine).toContainText("Plane");
  await expect(mine).toContainText("Add");
  // Add: the search asked for the pilot's own airplane, and a recent tapped is kept as it.
  await mine.click();
  await expect(card.getByTestId("aircraft-picking-mine")).toBeVisible();
  await expect(page.getByPlaceholder("Search for your airplane")).toBeVisible();
  await card.getByTestId("aircraft-recent").click();
  await expect(mine).toContainText("N200XY");
  await expect(card.getByTestId("aircraft-picking-mine")).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]flight=/);
  // Tapped now, its card.
  await mine.click();
  await expect(page).toHaveURL(/[?&]flight=a1c2d3/);
});

test("Aircraft's Favorites' title opens the airplanes kept in full, Edit letting one go and moving another", async ({ page }) => {
  // The owner's "What about aircraft fav?": as Airport's Favorites are,
  // the title the way in ("make saved, favorites and recents into links").
  await keep(page, {
    myAircraft: { hex: "a0b7d8", name: "N14511", type: "B39M" },
    favoriteAircraft: [{ hex: "a1c2d3", name: "N200XY", type: "C172" }, { hex: "a2c2d3", name: "N300XY", type: "PA28" }, { hex: "a3c2d3", name: "N400XY", type: "SR22" }],
  });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  await grabberTo(page, "full");
  const panel = sideDrawer(page);
  // The title at the heading's left; at its right what the strip shows,
  // the map's choice inside that menu now.
  const all = panel.getByTestId("pill-section-question-more");
  await expect(all).toHaveText("Favorites");
  const title = (await all.boundingBox())!;
  const menu = (await panel.getByTestId("aircraft-question").boundingBox())!;
  expect(title.x + title.width).toBeLessThan(menu.x);
  await expect(panel.getByTestId("aircraft-map-only")).toHaveCount(0);
  await all.click();
  const list = panel.getByTestId("aircraft-favorites-list");
  await expect(list.getByTestId("aircraft-favorites-mine")).toContainText("N14511");
  await expect(list.getByTestId("aircraft-favorites-row")).toHaveCount(3);
  // Edit: one let go, another moved up a place with the keyboard.
  await list.getByTestId("aircraft-favorites-edit").click();
  // Its minus brings out the row's Delete, as iOS's does (SwipeToDelete).
  await list.getByRole("button", { name: "Remove N300XY from Favorites…", exact: true }).click();
  await list.getByRole("button", { name: "Remove N300XY from Favorites", exact: true }).click();
  // Exactly: "Remove N400XY…" holds "move N400XY" too.
  await list.getByRole("button", { name: "Move N400XY", exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await list.getByTestId("aircraft-favorites-edit").click();
  await expect(list.getByTestId("aircraft-favorites-row")).toHaveText([/N400XY/, /N200XY/]);
  // Back: the strip as the list left it.
  await panel.getByTestId("aircraft-favorites-page-close").click();
  await expect(panel.getByTestId("pill-aircraft-favorite")).toHaveText([/N400XY/, /N200XY/]);
});

test("on a phone, all the way up, Setup's page starts where Airport's search bar does", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the console is the panel's layer on a phone only");
  // The owner's notice: "Why do the tabs within their setup seem lower
  // than other cards?" -- they were the sheet's sixteen points down; Setup
  // is one page now, its account row first.
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "full");
  const panel = sideDrawer(page);
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await grabberTo(page, "full");
  await settled(panel);
  const search = (await panel.getByTestId("search-airports").locator("xpath=ancestor-or-self::*[contains(@class,'rounded')][1]").boundingBox())!.y;
  await showTabs(page);
  await page.getByTestId("setup-button").click();
  await grabberTo(page, "full");
  await settled(panel);
  // Its first row, the account as the half card has it (SetupPill).
  const first = (await panel.getByTestId("setup-head").boundingBox())!.y;
  expect(Math.abs(first - search)).toBeLessThan(1.5);
});

test("a finger's swipe across the panel switches no tab, and on a Setup page to the right goes back", async ({ page }) => {
  // The owner's ask: "let's not support swipe to switch tabs. A glass
  // bubble can be dragged on tabs though like iOS... Swipe should only
  // support going back." (It was: "Can swiping left/right switch tabs?")
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's panel");
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  const up = () => panel.locator('[data-testid="tab-bar"] button[aria-current="page"]');
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  for (const by of [-130, 130]) {
    await swipeAcross(page, by);
    await showTabs(page);
    await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  }
  // A Setup page open (Minimums, a tile of the account's): to the right,
  // back to the Account, as its close takes it.
  await page.getByTestId("setup-button").click();
  await grabberTo(page, "full");
  await panel.getByTestId("library-section").getByRole("button", { name: /^Minimums/ }).click();
  const back = panel.getByRole("button", { name: "Back to Account", exact: true });
  await expect(back).toBeVisible();
  await swipeAcross(page, 130);
  await expect(back).toHaveCount(0);
  await expect(panel.getByTestId("library-section")).toBeVisible();
});

test("with Back showing, a swipe across the panel goes back, not to the tab beside", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "Back shows where the tabs minimize, on a phone");
  // The owner's ask: "When back button is visible then swiping should go
  // back instead of switching tabs". An airport's card over FPL.
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  await expect(page.getByTestId("tab-share")).toBeVisible();
  // To the left, nothing: no tab beside, and nothing forward.
  await swipeAcross(page, -130);
  await page.waitForTimeout(300);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  // To the right, back: the card put away, FPL as it was.
  await swipeAcross(page, 130);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(page.getByTestId("tab-share")).toHaveCount(0);
  await showTabs(page);
  await expect(panel.locator('[data-testid="tab-bar"] button[aria-current="page"]')).toHaveAttribute("data-testid", "tab-fpl");
});
