import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, showTabs, sideDrawer } from "./helpers";

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

test("each tab's pill shows its own: FPL the route's figures, Airport its Favorites, Aircraft its search, NRST the nearest", async ({ page }) => {
  await keep(page, { favoriteAirports: [KDLH] });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "peek");
  await expect(panel.getByTestId("flight-line")).toBeVisible();

  // Airport: the Favorites, small, a tap opening the field's card; no figures.
  await pickAtRest(page, "tab-airport");
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);
  const tile = panel.getByTestId("pill-favorites").getByTestId("pill-favorite");
  await expect(tile).toHaveText(/KDLH/);
  // A finger's 44 points.
  expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Aircraft, with no airplanes starred: its search bar, asking for input.
  await pickAtRest(page, "tab-aircraft");
  await expect(panel.getByTestId("aircraft-search")).toBeVisible();
  await expect(panel.getByTestId("flight-line")).toHaveCount(0);

  // NRST: the nearest fields, or with no position the way to show it.
  await pickAtRest(page, "tab-nrst");
  await expect(panel.getByTestId("nearest-strip").or(panel.getByTestId("nearest-strip-position"))).toBeVisible();

  // Out of the pill, each tab its usual head again: Airport's search bar.
  await pickAtRest(page, "tab-airport");
  await tile.click();
  await expect(page).toHaveURL(/[?&]place=KDLH/);
});

test("the Settings tab's pill is quick controls, each a switch", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "the console is the panel's layer on a phone only");
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("settings-button").click();
  // Opened half way, as a card opens; lowered, the pill is its quick controls.
  const panel = sideDrawer(page);
  await expect(panel).toHaveAttribute("data-panel", "half");
  await grabberTo(page, "peek");
  const traffic = panel.getByTestId("quick-traffic");
  await expect(traffic).toHaveAttribute("aria-pressed", "false");
  await traffic.click();
  await expect(traffic).toHaveAttribute("aria-pressed", "true");
  await traffic.click();
  await expect(traffic).toHaveAttribute("aria-pressed", "false");
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
