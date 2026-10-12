import { test, expect, type Locator, type Page } from "@playwright/test";
import { grabberTo, settle, sideDrawer } from "./helpers";

/**
 * The Recents taken off one at a time, by a swipe to the left that
 * uncovers a Delete (SwipeToDelete), or all at once by Clear, at the
 * pilot's ask ("I should be able to clear recents or delete individual
 * ones by sliding left") -- the airports' under the search bar and the
 * airplanes' on the Aircraft card.
 */

const AIRPORTS = [
  { ident: "KDLH", name: "Duluth International Airport", municipality: "Duluth" },
  { ident: "KMSP", name: "Minneapolis-St Paul International Airport", municipality: "Minneapolis" },
  { ident: "C81", name: "Campbell Airport", municipality: "Grayslake" },
];
const AIRCRAFT = [
  { hex: "a0b7d8", name: "N14511", type: "B39M" },
  { hex: "a1c2d3", name: "N200XY", type: "C172" },
];

async function seed(page: Page) {
  await page.addInitScript(({ recentAirports, recentAircraft }) => {
    // Once: a reload keeps what the test took off.
    if (sessionStorage.getItem("recents-seeded")) return;
    sessionStorage.setItem("recents-seeded", "1");
    localStorage.setItem("vfr.preferences", JSON.stringify({ state: { recentAirports, recentAircraft }, version: 0 }));
  }, { recentAirports: AIRPORTS, recentAircraft: AIRCRAFT });
}

/** A swipe to the left, as the browser's own scrolling takes it: the row's scroller to its end. */
async function swipeLeft(row: Locator) {
  await row.evaluate(el => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeGreaterThan(40);
}

/** A box once it has stopped moving: two reads a frame apart that agree. */
async function settledBox(locator: Locator) {
  let last = (await locator.boundingBox())!;
  await expect.poll(async () => {
    const now = (await locator.boundingBox())!;
    const still = Math.abs(now.x - last.x) < 0.01 && Math.abs(now.width - last.width) < 0.01;
    last = now;
    return still;
  }, { intervals: [50] }).toBe(true);
  return last;
}

test("a swipe to the left uncovers a Delete that takes an airport off the Recents, and Clear takes them all", async ({ page }) => {
  await seed(page);
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "full");
  const panel = sideDrawer(page);
  const recents = panel.getByTestId("airport-recent");
  await expect(recents).toHaveCount(3);

  // The Delete is behind the row until the swipe: out past its right edge.
  const first = panel.getByTestId("swipe-row").first();
  const box = (await first.boundingBox())!;
  const hidden = (await first.getByTestId("swipe-delete").boundingBox())!;
  expect(hidden.x).toBeGreaterThanOrEqual(box.x + box.width - 1);
  await swipeLeft(first);
  // Measured once the snap has settled: still moving, it was a fraction
  // of a pixel past the row's edge.
  const shown = await settledBox(first.getByTestId("swipe-delete"));
  expect(shown.x + shown.width).toBeLessThanOrEqual(box.x + box.width + 1);
  // As high as the row, so the 44 points are the row's.
  expect(shown.height).toBeGreaterThanOrEqual(44);
  await expect(first.getByTestId("swipe-delete")).toHaveAccessibleName("Remove KDLH from Recents");
  await first.getByTestId("swipe-delete").click();
  await expect(recents).toHaveCount(2);
  await expect(recents.first()).toContainText("KMSP");
  // Kept so: a reload still has two.
  await page.reload();
  await settle(page);
  await grabberTo(page, "full");
  await expect(recents).toHaveCount(2);

  // A tap on a row whose Delete is out covers it, rather than opening it.
  const row = panel.getByTestId("swipe-row").first();
  await swipeLeft(row);
  // At the row's left, where it is still in sight: a locator's click
  // would scroll it whole into sight first, covering it itself.
  const at = (await row.boundingBox())!;
  await page.mouse.click(at.x + 24, at.y + at.height / 2);
  await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBe(0);
  await expect(page).not.toHaveURL(/[?&]place=/);

  // The keyboard's way: the Delete is in the tab order, named.
  await row.getByTestId("swipe-delete").focus();
  await page.keyboard.press("Enter");
  await expect(recents).toHaveCount(1);

  // Clear, asked first.
  await panel.getByTestId("recents-clear").click();
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(recents).toHaveCount(0);
});

test("the airplanes' Recents: a long press or a right click offers the Delete too, and Clear takes them all", async ({ page }) => {
  await seed(page);
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  await grabberTo(page, "full");
  const card = page.getByTestId("aircraft-card");
  const recents = card.getByTestId("aircraft-recent");
  await expect(recents).toHaveCount(2);

  await card.getByTestId("swipe-row").first().click({ button: "right" });
  await page.getByTestId("swipe-menu-delete").click();
  await expect(recents).toHaveCount(1);
  await expect(recents.first()).toContainText("N200XY");

  await card.getByTestId("aircraft-recents-clear").click();
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(recents).toHaveCount(0);
});
