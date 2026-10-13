import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, settled, showTabs, sideDrawer } from "./helpers";

/**
 * Each tab's pill, at the owner's ask ("Fpl can show calculations but
 * other tabs should show something else"): under the tabs, FPL the
 * route's figures; Airport and Aircraft their Favorites as small tiles,
 * or their search bars where there are none; NRST the nearest fields;
 * Settings quick controls. And a card's way back on a phone: Back at the
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

async function pickAtRest(page: Page, tab: string) {
  await showTabs(page);
  await page.getByTestId(tab).click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
}

test("FPL with no route rests as its route box under the tabs, to type one in", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await grabberTo(page, "peek");
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-capsule", "true");
  // The owner's ask: "Fpl should show the route box if no route is entered".
  await expect(panel.getByTestId("route-type")).toBeVisible();
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);
});

test("each tab's pill shows its own: FPL its profile and figures, Airport its Favorites and Nearest, Aircraft its Favorites and a question, one height", async ({ page }) => {
  await keep(page, { favoriteAirports: [KDLH] });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  // At rest the tabs alone; the grabber the pill.
  await grabberTo(page, "peek");
  await expect(panel.getByTestId("flight-line")).toBeVisible();
  // Every tab's pill one height, FPL's with its box and chips, at the
  // owner's ask ("make the minimal layout to be this big").
  await settled(panel);
  const height = (await panel.boundingBox())!.height;
  const same = async () => {
    await settled(panel);
    expect(Math.abs((await panel.boundingBox())!.height - height)).toBeLessThan(1);
  };

  // Airport: the Favorites, small, a tap opening the field's card; no figures.
  await pickAtRest(page, "tab-airport");
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);
  const tile = panel.getByTestId("pill-favorites").getByTestId("pill-favorite");
  await expect(tile).toHaveText(/KDLH/);
  // Its search bar over them, the pill as tall as FPL's with its box, at
  // the owner's ask; the bar above the tiles.
  const search = panel.getByTestId("search-airports");
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.y).toBeLessThan((await tile.boundingBox())!.y);
  await same();
  // A finger's 44 points.
  expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Aircraft, with no airplane kept: Plane all the same, with Add.
  await pickAtRest(page, "tab-aircraft");
  await expect(panel.getByTestId("pill-aircraft-mine")).toHaveText(/Plane\s*Add/);
  await expect(panel.getByTestId("aircraft-search")).toBeVisible();
  await same();
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);

  // Its second strip, the question its title's menu asks (Nearest me
  // first), and the Map switch at the row's right, at the owner's picks.
  await expect(panel.getByTestId("aircraft-question")).toHaveText(/Nearest/i);
  await expect(panel.getByTestId("aircraft-map-only")).toHaveAttribute("aria-checked", "false");

  // Airport's second strip: the nearest fields (NRST folded in, four
  // tabs), or with no position the way to show it.
  await pickAtRest(page, "tab-airport");
  await expect(panel.getByTestId("nearest-strip").or(panel.getByTestId("nearest-strip-position"))).toBeVisible();
  await expect(page.getByTestId("tab-nrst")).toHaveCount(0);
  await same();
  // FPL with its route: the profile over the figures, the pill one height.
  await pickAtRest(page, "tab-fpl");
  await expect(panel.getByTestId("mini-profile")).toBeVisible({ timeout: 15_000 });
  expect((await panel.getByTestId("mini-profile").boundingBox())!.y).toBeLessThan((await panel.getByTestId("flight-line").boundingBox())!.y);
  await same();

  // Out of the pill, each tab its usual head again: Airport's search bar.
  await pickAtRest(page, "tab-airport");
  await tile.click();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
});

test("Setup's pill is the account, Aircraft and Logbook rows that open their pages, and the switches in a row", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the console is the panel's layer on a phone only");
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "peek");
  await page.getByTestId("settings-button").click();
  // Picked at the pill, the pill kept, as every tab keeps it: its quick
  // controls under the tabs.
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "peek");
  const traffic = panel.getByTestId("quick-traffic");
  await expect(traffic).toHaveAttribute("aria-pressed", "false");
  await traffic.click();
  await expect(traffic).toHaveAttribute("aria-pressed", "true");
  await traffic.click();
  await expect(traffic).toHaveAttribute("aria-pressed", "false");
  // One row of them, under the account and its rows (S3d, the owner's
  // pick), the row sliding sideways for the rest.
  const logbook = panel.getByTestId("setup-logbook");
  expect((await traffic.boundingBox())!.y).toBeGreaterThan((await logbook.boundingBox())!.y);
  expect((await panel.getByTestId("quick-weather").boundingBox())!.y).toBeCloseTo((await traffic.boundingBox())!.y, 0);
  // Aircraft opens the console all the way up on its page.
  await panel.getByTestId("setup-aircraft").click();
  await expect(panel).toHaveAttribute("data-panel", "full");
  await expect(panel.getByTestId("console-page")).toContainText("Aircraft");
});

test("on a phone, a card's way back is Back at the top left of the tabs' line, and its close puts the sheet down", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the tabs minimize on a phone only");
  await page.goto("/app/plan?place=KDLH");
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
  await page.goto("/app/plan?place=KDLH");
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
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("place-card")).toBeVisible();
  const title = page.getByTestId("tab-title");
  const back = (await page.getByTestId("tab-back").boundingBox())!;
  const close = (await page.getByTestId("tab-close").boundingBox())!;
  const line = (await title.boundingBox())!;
  // Between Back and the title, off both: the tabs.
  await page.mouse.click((back.x + back.width + line.x) / 2, line.y + line.height / 2);
  await expect(page.getByTestId("tab-airport")).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
  // Back on a fresh load does its own, not the tabs'.
  await page.goto("/app/plan?place=KDLH");
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
  const mine = card.getByTestId("aircraft-mine");
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

test("on a phone, each tab's pill starts its first row on one line: FPL's box, the search bars and Setup's controls", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "Setup's quick controls are the phone's pill");
  // The owner's notices: FPL's box sat lower than the other tabs' bars,
  // and Setup's controls lower than both.
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "peek");
  const panel = sideDrawer(page);
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
  await pickAtRest(page, "settings-button");
  await settled(panel);
  // Setup's first row, its account's group (SetupPill).
  expect(Math.abs((await panel.getByTestId("setup-pill").boundingBox())!.y - fpl)).toBeLessThan(1.5);
});

test("on a phone, half way up, Setup's own tabs start where Airport's search bar does", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the console is the panel's layer on a phone only");
  // The owner's notice: "Why do the tabs within their setup seem lower
  // than other cards?" -- they were the sheet's sixteen points down.
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  await showTabs(page);
  await page.getByTestId("tab-airport").click();
  await settled(panel);
  const search = (await panel.getByTestId("search-airports").locator("xpath=ancestor-or-self::*[contains(@class,'rounded')][1]").boundingBox())!.y;
  await showTabs(page);
  await page.getByTestId("settings-button").click();
  await settled(panel);
  const tabs = (await panel.getByRole("tablist").first().boundingBox())!.y;
  expect(Math.abs(tabs - search)).toBeLessThan(1.5);
});

test("a finger's swipe across the panel goes to the tab beside it, and a short one does nothing", async ({ page }) => {
  // The owner's ask: "Can swiping left/right switch tabs?"
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "peek");
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
  // To the right: the tab before, Airport; to the left, the next, FPL.
  await swipe(120, 250);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-airport");
  await swipe(250, 120);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  // Short of 50 points: nothing.
  await swipe(200, 170);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "tab-fpl");
  // On to Setup, the last. (From md up its console is a sheet of its own,
  // over the page, which the swipe back would land on.)
  await swipe(250, 120);
  await showTabs(page);
  await expect(up()).toHaveAttribute("data-testid", "settings-button");
});
