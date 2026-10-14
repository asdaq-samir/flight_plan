import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, settled, showTabs, sideDrawer } from "./helpers";

/**
 * Each tab's pill, one row, as the panel of 2026-10-11 had it and the owner
 * picked it back ("pill to half to full worked really well"): FPL the
 * route's box or its one line, Airport and Aircraft their search bars,
 * Setup the tabs. Half way each tab's own strip under its head -- Airport's
 * and Aircraft's Favorites. And a card's way back on a phone: Back at the
 * top left of the minimized tabs' line, a close at its right.
 */

const KDLH = { ident: "KDLH", name: "Duluth International Airport", municipality: "Duluth", lat: 46.842, lon: -92.194 };

async function keep(page: Page, state: Record<string, unknown>) {
  await page.addInitScript(kept => {
    if (sessionStorage.getItem("pills-seeded")) return;
    sessionStorage.setItem("pills-seeded", "1");
    localStorage.setItem("vfr.preferences", JSON.stringify({ state: kept, version: 0 }));
  }, state);
}

/** A tab picked, then the sheet down to its pill. */
async function pickAtRest(page: Page, tab: string) {
  await showTabs(page);
  await page.getByTestId(tab).click();
  await grabberTo(page, "peek");
  await expect(sideDrawer(page)).toHaveAttribute("data-capsule", "true");
}

/** A tab picked half way. */
async function pickHalf(page: Page, tab: string) {
  await showTabs(page);
  await page.getByTestId(tab).click();
  await grabberTo(page, "half");
}

test("each tab's pill is one row: FPL's route line, Airport's and Aircraft's search bars, Setup's tabs", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  const height = async () => {
    await settled(panel);
    return (await panel.boundingBox())!.height;
  };
  // A row: the search field's 41 points and the pill's padding, never the
  // tall pill of the minimal layout.
  await expect(panel.getByTestId("route-line")).toBeVisible({ timeout: 30_000 });
  expect(await height()).toBeLessThan(90);
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);
  await pickAtRest(page, "tab-airport");
  await expect(panel.getByTestId("search-airports")).toBeVisible();
  await expect(panel.getByTestId("pill-favorites")).toBeHidden();
  expect(await height()).toBeLessThan(90);
  await pickAtRest(page, "tab-aircraft");
  await expect(panel.getByTestId("aircraft-search")).toBeVisible();
  expect(await height()).toBeLessThan(90);
  // Setup's pill is the tabs, the way back to the others.
  await showTabs(page);
  await page.getByTestId("setup-button").click();
  await grabberTo(page, "peek");
  await expect(panel.getByTestId("tab-bar")).toBeVisible();
  expect(await height()).toBeLessThan(100);
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
  // filter": its title a menu, the Favorites first, the questions after
  // them, and the Map switch at the row's right.
  await expect(panel.getByTestId("aircraft-question")).toHaveText(/Favorites/i);
  await expect(panel.getByTestId("aircraft-map-only")).toHaveAttribute("aria-checked", "false");
  await panel.getByTestId("aircraft-question").click();
  await page.getByTestId("question-near").click();
  await expect(panel.getByTestId("aircraft-question")).toHaveText(/Nearest/i);
  await expect(panel.getByTestId("pill-aircraft-mine")).toHaveCount(0);
  await panel.getByTestId("aircraft-question").click();
  await page.getByTestId("question-favorites").click();
  await expect(panel.getByTestId("pill-aircraft-mine")).toBeVisible();

  // Airport's one strip, its title's menu the nearest fields too (NRST
  // folded in, four tabs), or with no position the way to show it.
  await pickHalf(page, "tab-airport");
  await expect(panel.getByTestId("airport-strip-shows")).toHaveText(/Favorites/i);
  await panel.getByTestId("airport-strip-shows").click();
  await page.getByTestId("airport-shows-nearest").click();
  await expect(panel.getByTestId("nearest-strip").or(panel.getByTestId("nearest-strip-position"))).toBeVisible();
  await expect(panel.getByTestId("pill-favorites")).toHaveCount(0);
  await panel.getByTestId("airport-strip-shows").click();
  await page.getByTestId("airport-shows-favorites").click();
  await expect(tile).toBeVisible();
  await expect(page.getByTestId("tab-nrst")).toHaveCount(0);
  await tile.click();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
});

test("on a phone, a card opened from another tab has Back at the top left of the tabs' line, and its close puts the sheet down", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the tabs minimize on a phone only");
  // An airport's card over FPL (a route's field): the bar its kind and
  // Back to FPL, at the owner's ask ("don't make the tabs into a centered
  // label unless going from another tab").
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  const back = page.getByTestId("tab-back");
  const title = (await page.getByTestId("tab-title").boundingBox())!;
  const backBox = (await back.boundingBox())!;
  // At the left, on the tab label's line; the card's own close gone.
  expect(backBox.x + backBox.width).toBeLessThan(title.x);
  expect(Math.abs(backBox.y + backBox.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(2);
  // Out of sight, kept for a keyboard and a screen reader (CardClose).
  expect(await panel.getByTestId("place-close").evaluate(el => !!el.closest(".sr-only"))).toBe(true);
  const close = page.getByTestId("tab-close");
  expect((await close.boundingBox())!.x).toBeGreaterThan(title.x + title.width);
  await back.click();
  await expect(page).not.toHaveURL(/[?&]place=/);
  // At the tab's own screen no Back: nothing to go back to.
  await expect(back).toHaveCount(0);

  // Opened again, the close: the card put away and the sheet down to its pill.
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  await page.getByTestId("tab-close").click();
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(panel).toHaveAttribute("data-panel", "peek");
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
  const back = (await page.getByTestId("tab-back").boundingBox())!;
  const close = (await page.getByTestId("tab-close").boundingBox())!;
  const line = (await title.boundingBox())!;
  // Between Back and the title, off both: the tabs.
  await page.mouse.click((back.x + back.width + line.x) / 2, line.y + line.height / 2);
  await expect(page.getByTestId("tab-fpl")).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  // Back on a fresh load does its own, not the tabs'.
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  expect(close.x).toBeGreaterThan(line.x);
  await page.getByTestId("tab-back").click();
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

test("on a phone, each tab's pill starts its row on one line: FPL's box and the search bars", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's pill");
  // The owner's notices: FPL's box sat lower than the other tabs' bars.
  await page.goto("/app/plan");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-capsule", "true");
  // The rounded box round each field, not the field itself.
  const boxTop = async (testId: string) => {
    await settled(panel);
    return (await panel.getByTestId(testId).locator("xpath=ancestor-or-self::*[contains(@class,'rounded')][1]").boundingBox())!.y;
  };
  const fpl = await boxTop("route-type");
  await pickAtRest(page, "tab-airport");
  expect(Math.abs(await boxTop("search-airports") - fpl)).toBeLessThan(1.5);
  await pickAtRest(page, "tab-aircraft");
  expect(Math.abs(await boxTop("aircraft-search") - fpl)).toBeLessThan(1.5);
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

test("a finger's swipe across the panel goes to the tab beside it, and a short one does nothing", async ({ page }) => {
  // The owner's ask: "Can swiping left/right switch tabs?"
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  // A finger's pointer events, from one point to another on the panel.
  const swipe = async (fromX: number, toX: number) => {
    const box = (await panel.boundingBox())!;
    // On the tab bar's row: what is under it changes with the tab, and
    // a row that slides sideways keeps the finger.
    const bar = (await panel.getByTestId("tab-bar").boundingBox())!;
    const y = bar.y + bar.height / 2;
    await panel.evaluate((el, [x0, x1, at]) => {
      const target = document.elementFromPoint(x0, at) ?? el;
      const opts = { bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerId: 7, pointerType: "touch" };
      target.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: x0, clientY: at }));
      target.dispatchEvent(new PointerEvent("pointerup", { ...opts, clientX: x1, clientY: at + 4 }));
    }, [box.x + fromX, box.x + toX, y]);
  };
  const up = () => panel.locator('[data-testid="tab-bar"] button[aria-current="page"]');
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  // FPL first (the owner's "Swap fpl and aircraft tab positions"): to the
  // right, nothing before it; to the left, the next, Airport; back.
  await swipe(120, 250);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  await swipe(250, 120);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-airport");
  await swipe(120, 250);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  // Short of 50 points: nothing.
  await swipe(200, 170);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  // On through Airport and Aircraft to Setup, the last. (From md up its
  // console is a sheet of its own, over the page, which the swipe back
  // would land on.)
  for (const next of ["tab-airport", "tab-aircraft", "setup-button"]) {
    await swipe(250, 120);
    await showTabs(page);
    await expect(up()).toHaveAttribute("data-testid", next);
  }
});
