import { test, expect, type Locator, type Page } from "@playwright/test";
import { grabberTo, openPanel, settle, sideDrawer, airportSearch } from "./helpers";

/**
 * The Recents taken off one at a time, by a swipe to the left that
 * uncovers a Delete (SwipeToDelete), or all at once by Clear, at the
 * pilot's ask ("I should be able to clear recents or delete individual
 * ones by sliding left") -- the airports' under the search bar, the
 * airplanes' on the Aircraft card and the routes' under FPL's Saved. Each
 * tab shows its latest three, headed as the Favorites are, See All the
 * rest and Clear, at the owner's asks ("Can we have recents under saved
 * ?", "consistent look just like Favorites of Airport with See All on the
 * right side").
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

async function seed(page: Page, recentAirports = AIRPORTS, recentRoutes: unknown[] = []) {
  await page.addInitScript(({ recentAirports, recentAircraft, recentRoutes }) => {
    // Once: a reload keeps what the test took off.
    if (sessionStorage.getItem("recents-seeded")) return;
    sessionStorage.setItem("recents-seeded", "1");
    localStorage.setItem("vfr.preferences", JSON.stringify({ state: { recentAirports, recentAircraft, recentRoutes }, version: 0 }));
  }, { recentAirports, recentAircraft: AIRCRAFT, recentRoutes });
}

/** A swipe to the left, as the browser's own scrolling takes it: the row's scroller to its end. */
async function swipeLeft(row: Locator) {
  await row.evaluate(el => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeGreaterThan(40);
}

test("a swipe to the left uncovers a Delete that takes an airport off the Recents, and Clear takes them all", async ({ page }) => {
  await seed(page);
  await page.goto("/app/plan");
  await settle(page);
  // Airport's, all the way up.
  await airportSearch(page);
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
  // Its right edge on the row's, the two measured together and waited
  // for: scroll-snap settles it over a few frames, and the row narrows
  // when the sheet's list grows a scroll bar.
  const del = first.getByTestId("swipe-delete");
  await expect.poll(async () => {
    const [d, r] = [(await del.boundingBox())!, (await first.boundingBox())!];
    return d.x + d.width - (r.x + r.width);
  }).toBeLessThanOrEqual(1);
  const shown = (await del.boundingBox())!;
  // As high as the row, so the 44 points are the row's.
  expect(shown.height).toBeGreaterThanOrEqual(44);
  await expect(first.getByTestId("swipe-delete")).toHaveAccessibleName("Remove KDLH from Recents");
  await first.getByTestId("swipe-delete").click();
  await expect(recents).toHaveCount(2);
  await expect(recents.first()).toContainText("KMSP");
  // Kept so: a reload still has two.
  await page.reload();
  await settle(page);
  await airportSearch(page);
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

  // Clear, asked first, with the Recents in full (their See All).
  await panel.getByTestId("airport-recents-all").click();
  await expect(panel.getByTestId("airport-recents-page")).toBeVisible();
  await panel.getByTestId("recents-clear").click();
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(recents).toHaveCount(0);
});

test("the airports' Recents show the latest three, and See All the rest, Back to the search", async ({ page }) => {
  await seed(page, [
    ...AIRPORTS,
    { ident: "KMSN", name: "Dane County Regional Airport", municipality: "Madison" },
    { ident: "KOSH", name: "Wittman Regional Airport", municipality: "Oshkosh" },
  ]);
  await page.goto("/app/plan");
  await settle(page);
  await airportSearch(page);
  await grabberTo(page, "full");
  const panel = sideDrawer(page);
  const section = panel.getByTestId("airport-recents");
  await expect(section.getByTestId("airport-recent")).toHaveCount(3);
  await expect(section.getByTestId("airport-recent").first()).toContainText("KDLH");
  // See All at the heading's right, in the tint, as the Favorites' is.
  const all = panel.getByTestId("airport-recents-all");
  await expect(all).toHaveText("See All");
  await all.click();
  const page_ = panel.getByTestId("airport-recents-page");
  await expect(page_).toBeVisible();
  await expect(panel.getByTestId("airport-recent")).toHaveCount(5);
  await panel.getByTestId("airport-recents-page-back").click();
  await expect(section.getByTestId("airport-recent")).toHaveCount(3);
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

  await card.getByTestId("aircraft-recents-all").click();
  await expect(card.getByTestId("aircraft-recents-page")).toBeVisible();
  await card.getByTestId("aircraft-recents-clear").click();
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(recents).toHaveCount(0);
});

test("FPL's Recents under Saved: the latest routes planned as tiles, See All the rest, a tap plans one again and it comes first", async ({ page }) => {
  const day = (d: number) => Date.UTC(2026, 9, d, 15);
  await seed(page, AIRPORTS, [
    { dep: "C81", dest: "KDLH", stops: [], at: day(15) },
    { dep: "KRFD", dest: "KMKE", stops: [], at: day(14) },
    { dep: "C81", dest: "KMSP", stops: ["KLSE"], at: day(13) },
    { dep: "C81", dest: "KMSN", stops: [], at: day(12) },
  ]);
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  // Under Saved, both headed as Airport's Favorites are: See All at the right.
  await expect(panel.getByTestId("pill-section-saved-all")).toHaveText("See All");
  // Tiles, as Saved's are: the route and the day, its stops said to a
  // screen reader.
  const section = panel.getByTestId("route-recents");
  await expect(section.getByTestId("route-recents-strip").getByTestId("route-recent")).toHaveCount(4);
  await expect(section.getByTestId("route-recent").first()).toContainText("C81→KDLH");
  await expect(section.getByTestId("route-recent").nth(2)).toHaveAccessibleName(/C81 to KMSP by KLSE/);

  // The rest, all the way up, and a tap on the oldest plans it again.
  await section.getByTestId("route-recents-all").click();
  await expect(panel.getByTestId("route-recents-page")).toBeVisible();
  const all = panel.getByTestId("route-recent");
  await expect(all).toHaveCount(4);
  await all.last().click();
  await expect(page).toHaveURL(/[?&]dep=C81&dest=KMSN/);
  // Kept first once the planner has answered it.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("vfr.preferences")!).state.recentRoutes[0]?.dest), { timeout: 30_000 })
    .toBe("KMSN");
  // Cleared from the route's box, the sheet out where the box is.
  await openPanel(page);
  await panel.getByTestId("route-box-clear").click();
  await expect(panel.getByTestId("route-recent").first()).toContainText("C81→KMSN");

  // Clear, asked first, from the Recents in full: none under Saved then.
  await panel.getByTestId("route-recents-all").click();
  await panel.getByTestId("route-recents-clear").click();
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(panel.getByTestId("route-recent")).toHaveCount(0);
  await panel.getByTestId("route-recents-page-back").click();
  await expect(panel.getByTestId("route-recents")).toHaveCount(0);
  await expect(panel.getByTestId("pill-section-saved")).toBeVisible();
});

test("Saved's See All opens the flights in full with Back to FPL, as the Recents' does", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  await panel.getByTestId("pill-section-saved-all").click();
  await expect(page).toHaveURL(/[?&]saved=1/);
  await expect(panel.getByTestId("saved-page")).toContainText("Saved");
  await panel.getByTestId("saved-page-back").click();
  await expect(page).not.toHaveURL(/[?&]saved=/);
  await expect(panel.getByTestId("pill-section-saved")).toBeVisible();
});
