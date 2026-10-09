import { test, expect, type Page } from "@playwright/test";
import { expectDrawerClosed, expectDrawerOpen, grabberTo, openPanel, settle, sideDrawer, slow, tapTheChart } from "./helpers";

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
  await expect(card(page)).toContainText(/KDLH · Class [BCD] · Towered/);
  // Its elevation under that, and how far it is beside it.
  await expect(card(page)).toContainText(/Elevation [\d,]+ ft · \d+ nm NW of C81/);
  await expect(card(page).getByTestId("place-category")).toBeVisible();
  for (const id of ["fly-here", "place-call", "place-address"]) await expect(card(page).getByTestId(id)).toBeVisible();

  // The Freq. tab brings the frequencies into sight, the panel all the way up.
  await card(page).getByTestId("place-tab-radio").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  await expect(card(page).getByText("118.300")).toBeInViewport();

  // Put away: the address forgets it, and the route is the panel again,
  // the layer under the card, at the height the panel was.
  await card(page).getByTestId("place-close").click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  await expect(sideDrawer(page).getByTestId("panel-tab-navlog")).toBeVisible();
});

test("an airport's card calls the field and finds it in Maps, from the FAA's airport file", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), phone: "218-727-2968", address: "4701 Grinden Dr, Duluth, MN 55811" } });
  });
  await page.route(url => url.pathname.endsWith("/api/planner/airport/C81"), async route => {
    const answer = await route.fetch();
    // And no list of charts at all, as a planner older than the list
    // answers: the card still draws.
    await route.fulfill({ response: answer, json: { ...await answer.json(), phone: null, address: null, procedures: undefined } });
  });
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await expect(card(page).getByTestId("place-call")).toHaveAttribute("href", "tel:218-727-2968", { timeout: slow(15000) });
  await expect(card(page).getByTestId("place-address")).toHaveAttribute(
    "href", "https://maps.apple.com/?q=Duluth%20International%20Airport&address=4701%20Grinden%20Dr%2C%20Duluth%2C%20MN%2055811");

  // A field the FAA lists no phone for: Call greyed, and Address by where it is.
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await expect(card(page).getByTestId("place-call")).toBeDisabled({ timeout: slow(15000) });
  await expect(card(page).getByTestId("place-address")).toHaveAttribute("href", /^https:\/\/maps\.apple\.com\/\?q=.+&ll=42\.\d+,-88\.\d+$/);
});

test("an airport's card has four tabs under its tiles, the radio first, and a tab takes the panel up", async ({ page }) => {
  // C81 has no airport diagram, and an approach.
  await page.route(url => url.pathname.endsWith("/api/planner/airport/C81"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: {
      ...await answer.json(), airport_diagram_url: null, airport_diagram_cycle: null,
      procedures: [{ kind: "IAP", name: "RNAV (GPS) RWY 24", url: "https://aeronav.faa.gov/d-tpp/2610/05887R24.PDF" }],
    } });
  });
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const tabs = card(page).getByRole("tab");
  await expect(tabs).toHaveText(["Freq.", "Weather", "Runways", "Diagrams"], { timeout: slow(15000) });
  await expect(card(page).getByTestId("place-tab-radio")).toHaveAttribute("aria-selected", "true");
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");

  await card(page).getByTestId("place-tab-runways").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  await expect(card(page).getByRole("tabpanel")).toContainText("Pattern altitude");
  await expect(card(page).getByRole("tabpanel")).toContainText(/Runway \d/);

  // Diagrams: the airport's (none here), and its approach as the FAA
  // prints its title, opening its PDF.
  await card(page).getByTestId("place-tab-diagrams").click();
  await expect(card(page).getByRole("tabpanel")).toContainText("The FAA publishes no airport diagram for this field");
  const approach = card(page).getByRole("tabpanel").getByTestId("terminal-chart");
  await expect(approach).toHaveText(/RNAV \(GPS\) RWY 24/);
  await expect(approach).toHaveAttribute("href", "https://aeronav.faa.gov/d-tpp/2610/05887R24.PDF");
});

test("the route's Approaches opens its destination's card on its approaches, and Nearest is on the map's left", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), procedures: [
      { kind: "MIN", name: "TAKEOFF MINIMUMS", url: "https://aeronav.faa.gov/d-tpp/2610/NC1TO.PDF" },
      { kind: "IAP", name: "ILS OR LOC RWY 09", url: "https://aeronav.faa.gov/d-tpp/2610/00125IL9.PDF" },
      { kind: "IAP", name: "RNAV (GPS) RWY 27", url: "https://aeronav.faa.gov/d-tpp/2610/00125R27.PDF" },
    ] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  // Nearest among the map's buttons, on the left of the screen; the
  // map's own on its right.
  const nearest = page.locator("[data-map-controls-left]").getByTestId("nearest-button");
  const settings = page.locator("[data-map-controls]").getByTestId("map-settings-button");
  const width = page.viewportSize()!.width;
  expect((await nearest.boundingBox())!.x).toBeLessThan(width / 2);
  expect((await settings.boundingBox())!.x).toBeGreaterThan(width / 2);

  await sideDrawer(page).getByTestId("route-approaches").click();
  await expect(card(page).getByTestId("place-name")).toHaveText("Duluth International Airport", { timeout: slow(15000) });
  await expect(card(page).getByTestId("place-tab-diagrams")).toHaveAttribute("aria-selected", "true");
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  const approaches = card(page).locator('[data-chart-group="Approaches"]');
  await expect(approaches.getByTestId("terminal-chart")).toHaveText([/ILS OR LOC RWY 09/, /RNAV \(GPS\) RWY 27/]);
  await expect(approaches).toBeInViewport();
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
  // The departure to the middle of the map first: with the whole route
  // fitted to a phone it sits just above the capsule, and the airports
  // round it closer in were under the capsule and the route's markers.
  const viewport = page.viewportSize()!;
  let box = (await departure.boundingBox())!;
  const middle = { x: viewport.width / 2, y: viewport.height * 0.4 };
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  box = (await departure.boundingBox())!;
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
  // One whose middle nothing else covers, asked again while the map is
  // still drawing under a busy runner.
  const find = () => page.evaluate(selector => {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) return { x, y };
    }
    return null;
  }, AIRPORTS);
  await expect.poll(find, { timeout: slow(10000), message: "an airport on the chart with nothing over it" }).not.toBeNull();
  const at = await find();
  expect(at, "an airport on the chart with nothing over it").not.toBeNull();
  return at!;
}

// A card opened from a Favorite -- here, from the address on a page just
// loaded -- names the field and has its tiles in their places, and the map
// is on the field with its ring, before the card's answer is in: on a
// phone the answer queued behind the page's first requests, and the card
// stood empty under its ident with the map on the pilot's position.
test("a Favorite's card names it and the map goes to it before the card's answer is in", async ({ page }) => {
  await page.addInitScript(() => {
    const kept = { ident: "KBUR", name: "Hollywood Burbank/Bob Hope Airport", municipality: "Burbank", lat: 34.2007, lon: -118.3587 };
    localStorage.setItem("vfr.preferences", JSON.stringify({ state: { favoriteAirports: [kept] }, version: 0 }));
  });
  let answer: () => void = () => {};
  const held = new Promise<void>(go => { answer = go; });
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KBUR"), async route => {
    await held;
    await route.fallback();
  });
  await page.goto("/app/plan?place=KBUR");
  await settle(page);
  await expect(card(page).getByTestId("place-name")).toHaveText("Hollywood Burbank/Bob Hope Airport");
  await expect(card(page).getByTestId("fly-here")).toBeDisabled();
  await expect(page.locator("[data-selected-airport]")).toBeInViewport({ timeout: slow(10_000) });

  answer();
  await expect(card(page).getByTestId("fly-here")).toBeEnabled({ timeout: slow(15_000) });
  await expect(card(page)).toContainText(/KBUR · Class [BCD]/);
});

// A planner out of reach for a moment (restarted, say) is not an airport
// that does not exist: the card says it could not look it up, and asks
// again where it is.
test("an airport's card that could not be had says so, and Try again brings it", async ({ page }) => {
  let down = true;
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), route =>
    (down ? route.fulfill({ status: 502, body: "" }) : route.fallback()));
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await expect(card(page)).toContainText("KDLH · could not be looked up", { timeout: slow(30_000) });
  down = false;
  await card(page).getByTestId("place-retry").click();
  await expect(card(page).getByTestId("place-name")).toHaveText("Duluth International Airport");
  await expect(card(page).getByTestId("place-retry")).toHaveCount(0);
});

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

test("the airport whose card is open wears a ring round its chip, clear of it on every side", async ({ page }) => {
  // C81 reporting VFR, so it wears a chip at its card's zoom.
  await page.route(url => url.pathname.endsWith("/api/planner/airports/in-view"), route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ airports: [
      { ident: "C81", name: "Campbell", lat: 42.3246, lon: -88.0741, kind: "small", flight_category: "VFR", military: null },
    ] }),
  }));
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const chip = page.locator(".leaflet-airports-pane .leaflet-marker-icon", { hasText: "C81" }).locator("span");
  const ring = page.locator("[data-selected-airport]");
  await expect(chip).toBeVisible({ timeout: slow(15000) });
  await expect(ring).toBeVisible();
  // Measured once the map has stopped moving the two together.
  await expect(async () => {
    const c = (await chip.boundingBox())!, r = (await ring.boundingBox())!;
    expect(Math.abs(c.x + c.width / 2 - (r.x + r.width / 2))).toBeLessThan(1);
    expect(Math.abs(c.y + c.height / 2 - (r.y + r.height / 2))).toBeLessThan(1);
    // Its yellow 3 wide and 3 clear of the chip: the circle it was,
    // smaller than the chip, lay under it all but a sliver.
    expect(r.width - c.width).toBeGreaterThanOrEqual(11);
    expect(r.height - c.height).toBeGreaterThanOrEqual(11);
  }).toPass({ timeout: slow(10000) });

  // Put away, the ring goes with the card.
  await card(page).getByTestId("place-close").click();
  await expect(ring).toHaveCount(0);
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

  // One whose middle nothing else covers, found and tapped again while
  // the map is still settling from the zoom (a CI runner's last frames
  // moved the chip from under the tap).
  await expect(async () => {
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
    await expect(page).toHaveURL(new RegExp(`[?&]place=${at!.ident}`), { timeout: 2000 });
  }).toPass({ timeout: slow(20000) });
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

  // Lowered, the route is a capsule; the route's close, in the panel,
  // clears it -- its box, the controls and the tabs left in their places
  // for another, what needs a route greyed -- and pressed again puts the
  // route away for the layer under it, as Maps' directions are: the card
  // it was flown to from. The panel the height it was throughout; the
  // card's own close, the search.
  await grabberTo(page, "peek");
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KDLH");
  await page.getByTestId("capsule-detail").click();
  await sideDrawer(page).getByTestId("route-clear").click();
  await expect(page).not.toHaveURL(/dep=/);
  await expect(sideDrawer(page).getByTestId("route-type")).toBeVisible();
  await expect(sideDrawer(page).getByTestId("aircraft-select")).toBeEnabled();
  await expect(sideDrawer(page).getByTestId("print-button")).toBeDisabled();
  await expect(sideDrawer(page).getByTestId("panel-tab-navlog")).toBeVisible();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  await sideDrawer(page).getByTestId("route-clear").click();
  await expect(card(page).getByTestId("place-name")).toHaveText("Duluth International Airport");
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  await card(page).getByTestId("place-close").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  await expect(search).toBeVisible();

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
  // With the radio, under Freq.: it is the mic that turns them on.
  await card(page).getByTestId("place-tab-radio").click();
  const lights = card(page).getByTestId("place-lighting");
  await expect(lights.first()).toContainText("Activate REIL runway 08 & 26");
  await expect(card(page)).toContainText("Key the mic on the frequency 7 times within 5 seconds for high intensity, 5 for medium, 3 for low.");
  await expect(card(page)).toContainText("Weather advisory - CTAF 5 clicks");
});
