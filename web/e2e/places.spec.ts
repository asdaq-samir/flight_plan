import { test, expect, type Page } from "@playwright/test";
import { expectDrawerClosed, expectDrawerOpen, settle, sideDrawer, slow, tapTheChart } from "./helpers";

/**
 * Airports as places, as Maps has them: a tap on one on the chart opens
 * its card in the panel -- its name, what kind of field it is, the
 * weather there as pilots read it -- with Fly Here, Weather and
 * Frequencies; the card is the address's (?place=) and puts itself away.
 */

const card = (page: Page) => sideDrawer(page).getByTestId("place-card");

test("an airport's card names the field, its airspace and tower, how far it is, and the weather there", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  await expectDrawerOpen(page);
  await expect(card(page).getByTestId("place-name")).toHaveText("Duluth International Airport");
  // Measured from the route's departure while the pilot's own position
  // is not known.
  await expect(card(page)).toContainText(/KDLH · Class [BCD] · Towered · \d+ nm NW of C81/);
  await expect(card(page).getByTestId("place-category")).toBeVisible();
  for (const id of ["fly-here", "place-weather", "place-frequencies"]) await expect(card(page).getByTestId(id)).toBeVisible();

  // Frequencies brings its section into sight, the panel all the way up.
  await card(page).getByTestId("place-frequencies").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  await expect(card(page).getByText("118.300")).toBeInViewport();

  // Put away: the address forgets it, and the nav log is the panel again.
  await card(page).getByTestId("place-close").click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expectDrawerClosed(page);
});

/** Closer in over the departure, where the chart's airports are drawn big
 *  enough to tap -- the wheel over its marker, a level at a time (Leaflet
 *  zooms about the cursor, so C81 stays under it) -- and where one is
 *  whose middle nothing else covers: not the route's own marker, not the
 *  panel. */
async function airportToTap(page: Page) {
  // Once the map has stopped: the panel coming back to rest fits the route
  // again (MapShell), and a wheel turned while it flies is lost to it.
  let was = "";
  await expect(async () => {
    const now = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".leaflet-map-pane, .leaflet-tile-container")]
      .map(el => el.style.transform).join("|"));
    const still = now === was;
    was = now;
    await page.waitForTimeout(300);
    expect(still).toBe(true);
  }).toPass({ timeout: slow(10_000) });
  const departure = page.locator(".leaflet-marker-icon", { hasText: "C81" }).first();
  await expect(departure).toBeVisible({ timeout: slow(30000) });
  const box = (await departure.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(400);
  }
  // Its chip, or this close in, its grey one for no report; further out
  // an invisible target where it reports nothing.
  const AIRPORTS = ".leaflet-airports-pane .leaflet-marker-icon, .leaflet-airports-pane path.leaflet-airport-target";
  await expect.poll(() => page.locator(AIRPORTS).count(), { timeout: slow(20000) }).toBeGreaterThan(1);
  // And until they have all come: the view's own answer redraws them, and
  // a tap as it does lands on the chart.
  let drawn = -1;
  await expect(async () => {
    const now = await page.locator(AIRPORTS).count();
    const still = now === drawn;
    drawn = now;
    await page.waitForTimeout(500);
    expect(still).toBe(true);
  }).toPass({ timeout: slow(15_000) });
  const at = await page.evaluate(selector => {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) return { x, y };
    }
    return null;
  }, AIRPORTS);
  expect(at, "an airport on the chart with nothing over it").not.toBeNull();
  return at!;
}

test("a tap on an airport on the chart opens its card, a tap elsewhere puts it away, and Fly Here makes it the destination", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const at = await airportToTap(page);
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/[?&]place=[A-Z0-9]+/);
  await expect(card(page).getByTestId("place-name")).not.toBeEmpty();
  await expectDrawerOpen(page);

  // A tap on the chart elsewhere puts it away, as in Maps, and the panel
  // back at its capsule brings the whole route back into sight
  // (MapShell); an airport tapped again brings a card back.
  await tapTheChart(page);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(card(page)).toHaveCount(0);
  await expectDrawerClosed(page);
  const again = await airportToTap(page);
  await page.mouse.click(again.x, again.y);
  await expect(card(page).getByTestId("place-name")).not.toBeEmpty();

  // Fly Here: the field becomes the destination, from the route's
  // departure, and the card goes.
  const ident = new URL(page.url()).searchParams.get("place")!;
  await card(page).getByTestId("fly-here").click();
  await expect(page).toHaveURL(new RegExp(`[?&]dest=${ident}(&|$)`));
  await expect(page).toHaveURL(/[?&]dep=C81(&|$)/);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(card(page)).toHaveCount(0);
});

test("closer in, the airports that report wear their weather's colour, and a tap on one opens its card", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const chips = page.locator(".leaflet-airports-pane .leaflet-marker-icon");
  // Not at the whole route's zoom: a state's worth would bury the chart.
  await expect(page.locator(".leaflet-marker-icon", { hasText: "KDLH" }).first()).toBeVisible({ timeout: slow(30000) });
  expect(await chips.count()).toBe(0);

  const departure = page.locator(".leaflet-marker-icon", { hasText: "C81" }).first();
  const box = (await departure.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(400);
  }
  await expect.poll(() => chips.count(), { timeout: slow(20000) }).toBeGreaterThan(0);
  // The route's own airports keep their own chips: none drawn twice.
  expect(await chips.filter({ hasText: /^C81$/ }).count()).toBe(0);

  // One whose middle nothing else covers.
  const at = await chips.evaluateAll(els => {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (el.contains(document.elementFromPoint(x, y))) return { x, y, ident: el.textContent?.trim() ?? "" };
    }
    return null;
  });
  expect(at, "a chip with nothing over it").not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  await expect(page).toHaveURL(new RegExp(`[?&]place=${at!.ident}`));
  await expect(card(page).getByTestId("fly-here")).toBeVisible({ timeout: slow(15000) });
});

test("with no route the panel is a search bar: Home is set from Favorites, an airport found is starred onto Favorites, and Fly Here flies from Home", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  // A browser's own Favorites, from nothing.
  await page.evaluate(() => localStorage.removeItem("vfr.preferences"));
  await page.reload();
  await settle(page);
  const search = page.getByTestId("search-airports");
  // Half way up on the search, as a fresh load opens.
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");

  // Focused, the sheet comes all the way up on Favorites, Home not set yet;
  // its Add asks the search bar for the field.
  await search.click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  await expect(page.getByTestId("favorite-home")).toContainText("Add");
  await page.getByTestId("favorite-home").click();
  await expect(search).toHaveAttribute("placeholder", "Search for your home airport");
  await search.fill("C81");
  await page.getByTestId("search-result").filter({ hasText: "C81" }).first().click();
  await expect(page.getByTestId("favorite-home")).not.toContainText("Add");

  // A word of the town finds the field, the bigger one first; the star
  // on its card makes it a favorite.
  await search.click();
  await search.fill("duluth");
  const first = page.getByTestId("search-result").first();
  await expect(first).toContainText("KDLH", { timeout: slow(10000) });
  await first.click();
  await expect(card(page).getByTestId("place-name")).toHaveText("Duluth International Airport");
  await card(page).getByTestId("place-favorite").click();
  await expect(card(page).getByTestId("place-favorite")).toHaveAttribute("aria-pressed", "true");
  await card(page).getByTestId("place-close").click();
  await search.click();
  const kept = page.getByTestId("favorites").getByRole("button", { name: /^KDLH, Class [BCDEG]$/ });
  await expect(kept).toBeVisible();

  // Its tile opens its card, whose Fly Here goes from Home.
  await kept.click();
  await card(page).getByTestId("fly-here").click();
  await expect(page).toHaveURL(/dep=C81/);
  await expect(page).toHaveURL(/dest=KDLH/);
  await expect(page.getByLabel("Departure", { exact: true })).toContainText("C81");

  // Lowered, the route is a capsule, and its close rests the panel on
  // the search bar again.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KDLH");
  await page.getByTestId("clear-route").click();
  await expect(search).toBeVisible();
  await expect(page).not.toHaveURL(/dep=/);

  // Favorites in full: Edit lets KDLH go.
  await search.click();
  await page.getByTestId("favorites-all").click();
  const list = page.getByTestId("favorites-list");
  await expect(list).toContainText("KDLH");
  await list.getByTestId("favorites-edit").click();
  await list.getByRole("button", { name: "Remove KDLH from Favorites" }).click();
  await expect(list).toContainText("A star on an airport's card adds it here.");
});

test("an airport's card says which lights a pilot turns on with the mic, and the weather it reads out on so many clicks", async ({ page }) => {
  // 3CK, Lake in the Hills: its Chart Supplement remarks, from the FAA's
  // own airport data, in plain English.
  await page.goto("/app/plan?place=3CK");
  await expect(card(page).getByTestId("place-name")).not.toBeEmpty({ timeout: slow(15000) });
  const lights = card(page).getByTestId("place-lighting");
  await expect(lights.first()).toContainText("Activate REIL runway 08 & 26");
  await expect(card(page)).toContainText("Key the mic on the frequency 7 times within 5 seconds for high intensity, 5 for medium, 3 for low.");
  await expect(card(page)).toContainText("Weather advisory - CTAF 5 clicks");
});
