import { test, expect, type Page } from "@playwright/test";
import { closeCard, grabberTo, settle, showTabs, sideDrawer, slow, stripShows } from "./helpers";

/**
 * Tracking an airplane, as FlightAware and ForeFlight do, at the pilot's
 * ask: the Aircraft button under Nearest, its list and its search, a tap
 * on one on the map, its card and its path flown; and own ship's own
 * path. adsb.lol is stubbed through the planner: its sky is not the
 * suite's.
 */

const UAL = {
  hex: "a0b7d8", callsign: "UAL2088", registration: "N14511", type: "A21N", lat: 42.35, lon: -88.0,
  altitude_ft: 7000, pressure_altitude: false, track_deg: 90, speed_kt: 250, vertical_fpm: -1200, seen_s: 0.5, squawk: "3324",
};
const CESSNA = {
  hex: "a128b9", callsign: "N174HA", registration: "N174HA", type: "C172", lat: 42.30, lon: -88.12,
  altitude_ft: 2500, pressure_altitude: false, track_deg: 320, speed_kt: 94, vertical_fpm: 0, seen_s: 0.3, squawk: "1200",
};
const FAA = {
  n_number: "N14511", mode_s_hex: "a0b7d8", serial: "11775", manufacturer: "Airbus S A S", model: "A321-271NX", year: 2024,
  aircraft_type: "Fixed wing multi engine", engines: 2, seats: 246, engine: "IAE PW1133G-JM", engine_type: "Turbo-fan",
  horsepower: null, thrust_lb: 33110, owner: "United Airlines Inc", owner_type: "Corporation", co_owners: 0, city: "Chicago",
  state: "IL", country: "US", certificate_issued: "2024-04-05", expires: "2031-04-30", airworthiness: "Standard (transport)",
  airworthiness_date: "2024-04-08", kit: null, fractional: false, status: "Valid", standing: "valid",
};
const ROUTE = {
  airports: [
    { ident: "TJSJ", name: "Luis Munoz Marin International Airport", location: "San Juan" },
    { ident: "KORD", name: "Chicago O'Hare International Airport", location: "Chicago" },
  ],
  plausible: true,
};
const DETAIL = {
  hex: "a0b7d8", faa: FAA, registration: "N14511", type: "A21N", description: "AIRBUS A-321neo", operator: "UNITED AIRLINES INC", year: "2024",
  departed: { ident: "TJSJ", name: "Luis Munoz Marin International Airport", at: Date.now() / 1000 - 4 * 3600 },
  trail: [
    { t: Date.now() / 1000 - 600, lat: 42.35, lon: -88.6, alt_ft: 12000 },
    { t: Date.now() / 1000 - 300, lat: 42.35, lon: -88.3, alt_ft: 9000 },
    { t: Date.now() / 1000 - 10, lat: 42.35, lon: -88.01, alt_ft: 7000 },
  ],
};

/** The planner's traffic, an airplane's flight and a search, stubbed. */
async function sky(page: Page, detail: object = DETAIL) {
  const reported = Date.now();
  await page.route(url => url.pathname.endsWith("/api/planner/traffic"), route =>
    // Seconds old, as the planner's answer is -- never past the half
    // minute the map carries an airplane on for (CARRY_S), however long
    // the test has run: a slow run's airplanes had all aged off the map.
    route.fulfill({ json: { aircraft: [UAL, CESSNA], age_s: Math.min(5, (Date.now() - reported) / 1000), source: "adsb.lol", license: "ODbL 1.0" } }));
  await page.route(url => url.pathname.startsWith("/api/planner/traffic/flight/"), route => route.fulfill({ json: detail }));
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/route"), route =>
    route.fulfill({ json: new URL(route.request().url()).searchParams.get("callsign") === "UAL2088" ? ROUTE : null }));
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/find"), route =>
    route.fulfill({ json: { aircraft: new URL(route.request().url()).searchParams.get("q") === "UAL2088" ? [UAL] : [] } }));
  // No photo of it, unless a test gives one: Planespotters' sky is not the suite's either.
  await page.route(url => url.hostname === "api.planespotters.net", route => route.fulfill({ json: { photos: [] } }));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Aircraft is a tab, finds an airplane by its callsign, and a tap on one tracks it: its card, its path, the map on it", async ({ page }) => {
  await sky(page);
  await page.goto("/app/plan");
  await settle(page);
  // Out of the tabs alone, which a fresh load opens as.
  await grabberTo(page, "full");
  // The tab bar's Aircraft, at the pilot's ask, where it was a button under Nearest's.
  await showTabs(page);
  await page.getByTestId("tab-aircraft").click();
  await showTabs(page);
  await expect(page.getByTestId("tab-aircraft")).toHaveAttribute("aria-current", "page");
  // A tab tapped opens at the pill's size (TabBar); its list all the way up.
  await grabberTo(page, "full");
  const list = page.getByTestId("aircraft-card");
  // No list of everything about, nor its filters, at the owner's ask
  // ("don't need the extra filters at the bottom"): found by the search.
  await expect(list.getByTestId("filter-row")).toHaveCount(0);
  await page.getByTestId("aircraft-search").fill("UAL2088");
  await list.getByTestId("aircraft-found").filter({ hasText: "UAL2088" }).first().click();
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  const card = page.getByTestId("flight-card");
  // At the pill's size, as every card opens; its pages all the way up.
  await grabberTo(page, "full");
  await expect(page.getByTestId("tab-title")).toHaveText("UAL2088");
  await expect(card.getByTestId("flight-line")).toHaveCount(0);
  // Its callsign large over its pictures, what it is and who flies it
  // under it (the owner's pick of the redesign, A2).
  await expect(card.getByTestId("flight-name")).toHaveText("UAL2088");
  await expect(card.getByTestId("flight-what")).toHaveText("Airbus A-321neo · United Airlines Inc");
  // The flight it is on in a card under the actions, as FlightAware's:
  // where it left and where it is bound, and how it is flying.
  await expect(card.getByTestId("flight-departed")).toContainText("TJSJ");
  await expect(card.getByTestId("flight-bound")).toContainText("KORD");
  await expect(card.getByTestId("flight-altitude")).toContainText("7,000 ft");
  // What it is, in the one scroll: its make and model and who flies it.
  // Its flight number's route, and its FAA registration, at the pilot's ask.
  await expect(card.getByTestId("flight-route")).toContainText("TJSJ → KORD");
  await expect(card.getByTestId("flight-route")).toContainText("San Juan to Chicago");
  await expect(card.getByTestId("flight-model")).toHaveText("Airbus A-321neo");
  await expect(card.getByTestId("flight-operator")).toHaveText("United Airlines Inc");
  await expect(card.getByTestId("faa-owner")).toContainText("United Airlines Inc · Corporation · Chicago, IL");
  await expect(card.getByTestId("faa-status")).toContainText("Valid");
  await expect(card.getByTestId("faa-status")).toContainText(/expires (Apr 30, 2031|30 Apr 2031)/);
  await expect(card.getByTestId("faa-aircraft")).toContainText("Airbus S A S A321-271NX");
  await expect(card.getByTestId("faa-engine")).toContainText("2 engines · Turbo-fan · 33,110 lb thrust");
  await expect(card.getByTestId("flight-follow")).toHaveAttribute("aria-pressed", "true");
  // Ringed on the map, its path behind it in its heights' colours.
  await expect(page.locator("[data-traffic-tracked]")).toHaveCount(1);
  await expect(page.locator(".leaflet-overlay-pane path.tracked-path").first()).toBeAttached();
  // Put away: the list again, as an airport's card over Nearest.
  await closeCard(page, "flight-close");
  await expect(page).not.toHaveURL(/[?&]flight=/);
  await expect(list).toBeVisible();
});

test("an airplane is found by its callsign, and a tap on one on the map tracks it too", async ({ page }) => {
  await sky(page, { ...DETAIL, departed: null });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  await page.getByTestId("aircraft-search").fill("ual 2088");
  const found = page.getByTestId("aircraft-card").getByTestId("aircraft-found").filter({ hasText: "UAL2088" });
  await expect(found.first()).toBeVisible({ timeout: slow(15_000) });
  await page.getByTestId("aircraft-search").press("Enter");
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  // No field it took off from in its track: no Departed row.
  await expect(page.getByTestId("tab-title")).toHaveText("UAL2088");
  await expect(page.getByTestId("flight-departed")).toHaveCount(0);
  // One tapped on the map: the Cessna, the second heard.
  await closeCard(page, "flight-close");
  const hits = page.locator("[data-traffic-hit]");
  await expect(hits).toHaveCount(2);
  await hits.nth(1).dispatchEvent("click");
  await expect(page).toHaveURL(/[?&]flight=a128b9/);
  await expect(page.getByTestId("tab-title")).toHaveText("N174HA");
});

test("a search finds the airplanes about as it is typed, and asks the planner one name at a time, the last typed", async ({ page }) => {
  await sky(page);
  // The planner's search held four seconds, as adsb.lol's pace can: past
  // the typing below however slow the runner, so the name typed last is
  // what is there as the first answer comes. Held two, a loaded runner's
  // fills can run past it and have "N654F" asked (this test failed twice in
  // a row on a busy Mac, 2026-10-29, and passed 6 of 6 on a quieter one).
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/find"), async route => {
    const q = new URL(route.request().url()).searchParams.get("q")!;
    asked.push(q);
    await new Promise(done => setTimeout(done, 4000));
    await route.fulfill({ json: { aircraft: q === "N654FL" ? [{ ...CESSNA, hex: "a89c1e", callsign: "N654FL", registration: "N654FL" }] : [] } });
  });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  const card = page.getByTestId("aircraft-card");
  const search = page.getByTestId("aircraft-search");
  // On the map already: found as it is typed, before any answer.
  await search.fill("N17");
  await expect(card.getByTestId("aircraft-found")).toHaveText([/N174HA/]);
  // A name typed with pauses, as on a phone's keyboard: only the first and
  // the last are asked about, never the ones between.
  for (const typed of ["N65", "N654", "N654F", "N654FL"]) {
    await search.fill(typed);
    await page.waitForTimeout(700);
  }
  await expect(card.getByTestId("aircraft-found")).toHaveText([/N654FL/], { timeout: slow(15_000) });
  expect(asked.at(-1)).toBe("N654FL");
  expect(asked.filter(q => q === "N654" || q === "N654F")).toEqual([]);
});

test("an airplane not in the air is found by its registration, and its card says when it was last heard", async ({ page }) => {
  const piper = {
    ...FAA, n_number: "N654FL", mode_s_hex: "a89c1e", manufacturer: "Piper", model: "PA-28-140", year: 1971, engines: 1, seats: 4,
    engine: "Lycoming 0-320 Series", engine_type: "Reciprocating", horsepower: 180, thrust_lb: null, owner: "Roca Roja LLC", owner_type: "LLC",
    city: "Meridian", state: "ID",
  };
  const landed = Date.now() / 1000 - 3600;
  await sky(page, { hex: "a89c1e", faa: piper, registration: "N654FL", departed: null,
    trail: [{ t: landed - 600, lat: 43.5, lon: -116.3, alt_ft: 3000 }, { t: landed, lat: 43.56, lon: -116.22, alt_ft: null }] });
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/find"), route => route.fulfill({ json: { aircraft: [], registered: piper } }));
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  await page.getByTestId("aircraft-search").fill("N654FL");
  const row = page.getByTestId("aircraft-card").getByTestId("aircraft-registered");
  await expect(row).toContainText("N654FL", { timeout: slow(15_000) });
  await expect(row).toContainText("Piper PA-28-140 · not in the air now");
  await row.click();
  await expect(page).toHaveURL(/[?&]flight=a89c1e/);
  const card = page.getByTestId("flight-card");
  // Named by its FAA record, not its address, with no trace today to name it.
  await expect(page.getByTestId("tab-title")).toHaveText("N654FL");
  // Not heard now: on its flights, and its sketch says when it was last
  // heard, on the ground where its trace ends there.
  await grabberTo(page, "full");
  await expect(card.getByTestId("flight-now")).toHaveCount(0);
  await expect(card.getByTestId("flight-chip")).toContainText("Last heard");
  await expect(card.getByTestId("flight-state")).toHaveText("GND");
  await expect(card.getByTestId("faa-owner")).toContainText("Roca Roja LLC · LLC · Meridian, ID");
});

test("while adsb.lol is busy a search shows what it can -- the FAA's record -- and asks again until it is answered", async ({ page }) => {
  // What the pilot met with N654FL: adsb.lol answers one request every few
  // seconds, and the planner answers a search it could not ask with
  // `checked` false and the registry's record.
  const piper = { ...FAA, n_number: "N654FL", mode_s_hex: "a89c1e", manufacturer: "Piper", model: "PA-28-140" };
  const flying = { ...CESSNA, hex: "a89c1e", callsign: "N654FL", registration: "N654FL", type: "P28A", lat: 42.4, lon: -88.2 };
  await sky(page);
  let asked = 0;
  let busy = 1;
  await page.route(url => url.pathname.endsWith("/api/planner/traffic/find"), route => {
    asked += 1;
    return route.fulfill({ json: asked <= busy ? { aircraft: [], registered: piper, checked: false } : { aircraft: [flying], checked: true } });
  });
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  const card = page.getByTestId("aircraft-card");
  await page.getByTestId("aircraft-search").fill("N654FL");
  // At once, the registration, not "Couldn't search"; then the airplane in the air.
  await expect(card.getByTestId("aircraft-registered")).toContainText("Piper PA-28-140 · not yet known whether it is flying", { timeout: slow(15_000) });
  await expect(card.getByTestId("aircraft-unchecked")).toBeVisible();
  await expect(card.getByTestId("aircraft-found").first()).toContainText("N654FL", { timeout: slow(20_000) });
  await expect(card.getByTestId("aircraft-unchecked")).toHaveCount(0);
  await expect(card.getByText("Couldn't search")).toHaveCount(0);

  // Busy every time: the record stays, and after three tries again it says so and stops asking.
  busy = Infinity;
  asked = 0;
  await page.getByTestId("aircraft-search").fill("N12345");
  await expect(card.getByTestId("aircraft-unchecked")).toContainText("Try again in a moment", { timeout: slow(40_000) });
  await page.waitForTimeout(8000);
  expect(asked).toBe(4);
});

test("in the air, own ship's path flown is drawn behind it", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.addInitScript(() => {
    const started = Date.now();
    // East at 360 kt, a tenth of a mile a second, at 3,000 ft.
    const position = () => ({
      coords: {
        latitude: 42.3246, longitude: -88.0741 + ((Date.now() - started) / 1000) * 0.1 / (60 * 0.7392),
        accuracy: 10, heading: 90, speed: 360 / 1.943844, altitude: 3000 / 3.28084, altitudeAccuracy: 10, toJSON() { return this; },
      },
      timestamp: Date.now(), toJSON() { return this; },
    }) as unknown as GeolocationPosition;
    Geolocation.prototype.watchPosition = function (success: PositionCallback) {
      window.setTimeout(() => success(position()), 0);
      return window.setInterval(() => success(position()), 1000);
    };
    Geolocation.prototype.clearWatch = function (id: number) { window.clearInterval(id); };
    localStorage.removeItem("vfr.owntrail");
    localStorage.setItem("vfr.ownship",
      JSON.stringify({ state: { enabled: true, follow: true, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 }));
  });
  await page.route(url => url.pathname.endsWith("/api/planner/airspace/ahead"), route => route.fulfill({ json: { alerts: [], unavailable: [] } }));
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.locator(".leaflet-overlay-pane path.own-trail")).toBeAttached({ timeout: slow(15_000) });
});

test("an airplane's past flights are listed on its card, and one is drawn on the map, replayed and logged", async ({ page }) => {
  // N654FL's morning as FlightAware has it: LWM to LCI, then LCI to LWM.
  const off = Date.now() / 1000 - 6 * 3600;
  const lci = { ident: "LCI", name: "Laconia Municipal Airport", city: "Laconia", region: "US-NH" };
  const lwm = { ident: "LWM", name: "Lawrence Municipal Airport", city: "Lawrence", region: "US-MA" };
  const points = Array.from({ length: 80 }, (_, i) => ({
    t: off + i * 60, lat: 43.57 - i * 0.0107, lon: -71.42 + i * 0.0038, alt_ft: 800 + Math.min(i, 79 - i) * 120,
    gs_kt: 100, track_deg: 165, vrate_fpm: i < 40 ? 500 : -500,
  }));
  await sky(page);
  await page.route(url => /\/api\/planner\/traffic\/flight\/a0b7d8\/history$/.test(url.pathname), route => route.fulfill({ json: {
    hex: "a0b7d8", registration: "N654FL", type: "P28A", flights: [
      { id: Math.floor(off), origin: lci, destination: lwm, off, on: off + 79 * 60, landed: true, in_air: false, max_alt_ft: 5520 },
      { id: Math.floor(off) - 7200, origin: lwm, destination: lci, off: off - 7200, on: off - 4400, landed: true, in_air: false, max_alt_ft: 4100 },
    ] } }));
  await page.route(url => /\/api\/planner\/traffic\/flight\/a0b7d8\/history\/\d+$/.test(url.pathname),
    route => route.fulfill({ json: { id: Math.floor(off), points } }));
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  // At the pill's size, as every card opens; its flights all the way up.
  await grabberTo(page, "full");
  const rows = card.getByTestId("past-flight");
  await expect(rows).toHaveCount(2, { timeout: slow(15_000) });
  // FlightAware's row: how it ended and how long, then each end's field,
  // its town and when.
  await expect(rows.first()).toContainText("Landed · 1h 19m");
  await expect(rows.first()).toContainText(/LCI\s*Laconia, NH/);
  await expect(rows.first()).toContainText(/LWM\s*Lawrence, MA/);
  await rows.first().click();
  // Its own card over the airplane's, at the pilot's ask: the replay, its
  // figures and its track log; drawn on the map in its heights' colours.
  await expect(page).toHaveURL(/[?&]past=\d+/);
  const flight = page.getByTestId("past-flight-card");
  await expect(flight.getByTestId("past-flight-name")).toHaveText("LCI → LWM");
  await expect(flight.getByTestId("past-flight-off")).toContainText("LCI");
  await expect(flight.getByTestId("past-flight-on")).toContainText("LWM");
  await expect(flight.getByTestId("past-flight-flown")).toContainText(/\d+ nm/);
  await expect(page.locator("path.past-flight-path").first()).toBeAttached({ timeout: slow(10_000) });
  // All the way up, the controls and the whole graph, its time axis too,
  // in sight: the axis was cut off on the owner's phone.
  await grabberTo(page, "full");
  await expect.poll(async () => (await flight.getByTestId("replay-chart-box").boundingBox())!.height).toBeGreaterThanOrEqual(72);
  await expect(flight.getByTestId("replay-chart-box")).toBeInViewport({ ratio: 1 });
  // The graph drawn to its box, axis and all.
  await expect.poll(async () => (await flight.getByTestId("replay-chart-box").locator("svg.recharts-surface").boundingBox())?.height)
    .toBeGreaterThanOrEqual(72);
  await expect(flight.getByTestId("track-log").locator("tbody tr")).toHaveCount(60);
  await flight.getByTestId("track-log-all").click();
  await expect(flight.getByTestId("track-log").locator("tbody tr")).toHaveCount(80);
  // Played at 200 times: where the airplane is, said under the controls.
  await flight.getByTestId("replay-speed").getByText("200×").click();
  await flight.getByTestId("replay-play").click();
  await expect(flight.getByTestId("replay-now")).toContainText(/ft · 100 kt · S/);
  // Another tab and back, at the owner's ask: the past flight still out
  // over the Aircraft tab, its replay on where it was.
  await showTabs(page);
  await page.getByTestId("tab-fpl").click();
  await expect(flight).toHaveCount(0);
  await showTabs(page);
  await page.getByTestId("tab-aircraft").click();
  await expect(page).toHaveURL(/[?&]past=\d+/);
  await expect(flight.getByTestId("replay-now")).toContainText(/ft · 100 kt · S/);
  // At the pill's size, as a tab tapped opens; its controls all the way up.
  await grabberTo(page, "full");
  await flight.getByTestId("replay-stop").click();
  await expect(flight.getByTestId("replay-now")).toHaveCount(0);
  // Closed: back to the airplane's card, the path put away.
  await closeCard(page, "past-flight-close");
  await expect(page).not.toHaveURL(/[?&]past=/);
  await expect(card.getByTestId("flight-earlier")).toBeVisible();
  await expect(page.locator("path.past-flight-path")).toHaveCount(0);
});

test("an airplane's last flights found are listed, the ones before them on asking, and from a day picked", async ({ page }) => {
  // The owner's ask: "make it last 10 flights you were able to find. But
  // also give an option to fetch more by date".
  const lci = { ident: "LCI", name: "Laconia Municipal Airport", city: "Laconia", region: "US-NH" };
  const lwm = { ident: "LWM", name: "Lawrence Municipal Airport", city: "Lawrence", region: "US-MA" };
  const flight = (off: number, from: typeof lci, to: typeof lci) =>
    ({ id: Math.floor(off), origin: from, destination: to, off, on: off + 3600, landed: true, in_air: false, max_alt_ft: 4500 });
  const now = Date.now() / 1000;
  const asked: URLSearchParams[] = [];
  await sky(page);
  await page.route(url => /\/api\/planner\/traffic\/flight\/a0b7d8\/history$/.test(url.pathname), route => {
    const query = new URL(route.request().url()).searchParams;
    asked.push(query);
    const base = { hex: "a0b7d8", registration: "N14511", type: "A21N" };
    if (query.get("before")) {
      return route.fulfill({ json: { ...base, flights: [flight(now - 20 * 86400, lci, lwm)], next_until: null } });
    }
    if (query.get("until")) {
      return route.fulfill({ json: { ...base, flights: [flight(now - 30 * 86400, lwm, lci)], next_until: null } });
    }
    return route.fulfill({ json: { ...base, flights: [flight(now - 86400, lci, lwm), flight(now - 2 * 86400, lwm, lci)], next_until: "2026-10-01" } });
  });
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  // At the pill's size, as every card opens; its flights all the way up.
  await grabberTo(page, "full");
  const rows = card.getByTestId("past-flight");
  await expect(rows).toHaveCount(2, { timeout: slow(15_000) });
  // The ones before, from where the list ends: before its last takeoff.
  await card.getByTestId("past-flights-more").click();
  await expect(rows).toHaveCount(3);
  expect(asked.at(-1)?.get("until")).toBe("2026-10-01");
  expect(Number(asked.at(-1)?.get("before"))).toBe(Math.floor(now - 2 * 86400));
  // The archive's end: no more to ask for.
  await expect(card.getByTestId("past-flights-more")).toHaveCount(0);
  // From a day picked, on the stock calendar: the first of this month,
  // in its grid and in the archive's six weeks.
  await card.getByTestId("past-flights-date").click();
  const picker = page.getByTestId("past-flights-picker");
  const { label, iso } = await page.evaluate(() => {
    const first = new Date();
    first.setDate(1);
    return { label: first.toLocaleDateString(), iso: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01` };
  });
  await picker.locator(`button[data-day="${label}"]`).click();
  await expect(rows).toHaveCount(1);
  expect(asked.at(-1)?.get("until")).toBe(iso);
  await expect(card).toContainText("On and before");
  await expect(card.getByTestId("past-flights-date")).not.toContainText("Pick a day");
  // Back to the latest: the list as it was, the earlier ones still with it.
  // Once the picker has gone: tapped again while it was going, a desktop's
  // popover took the tap that reopened it for one outside and shut again,
  // in CI's run (Latest never showed).
  await expect(picker).toHaveCount(0);
  await card.getByTestId("past-flights-date").click();
  await page.getByTestId("past-flights-latest").click();
  await expect(rows).toHaveCount(3);
  await expect(card.getByTestId("past-flights-date")).toContainText("Pick a day");
});

test("an airplane quiet for a fortnight is looked for further back by itself, and said to be unheard where the archive ends", async ({ page }) => {
  // The owner's N3429J: nothing in its first fortnight, "Look further
  // back" alone on the card.
  const asked: URLSearchParams[] = [];
  await sky(page);
  await page.route(url => /\/api\/planner\/traffic\/flight\/a0b7d8\/history$/.test(url.pathname), route => {
    const query = new URL(route.request().url()).searchParams;
    asked.push(query);
    const base = { hex: "a0b7d8", registration: "N3429J", type: "C150", flights: [] };
    const next = { "": "2026-09-28", "2026-09-28": "2026-09-14", "2026-09-14": null }[query.get("until") ?? ""] ?? null;
    return route.fulfill({ json: { ...base, next_until: next } });
  });
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  // At the pill's size, as every card opens; its flights all the way up.
  await grabberTo(page, "full");
  await expect(card.getByTestId("past-flights-none")).toHaveText("No flights heard in the last six weeks", { timeout: slow(15_000) });
  expect(asked.map(q => q.get("until"))).toEqual([null, "2026-09-28", "2026-09-14"]);
  await expect(card.getByTestId("past-flights-more")).toHaveCount(0);
});

test("an airplane opened is in the Aircraft card's Recents, and one starred on its card is in its Favorites, as airports are", async ({ page }) => {
  await sky(page);
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  await expect(page.getByTestId("tab-title")).toHaveText("UAL2088", { timeout: slow(15_000) });
  const star = card.getByTestId("flight-favorite");
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await closeCard(page, "flight-close");
  await page.goto("/app/plan?aircraft=1");
  await settle(page);
  const list = page.getByTestId("aircraft-card");
  await expect(list.getByTestId("pill-aircraft-favorite")).toHaveCount(1);
  await expect(list.getByTestId("pill-aircraft-favorite")).toContainText("N14511");
  // The Recents from the strip's filter, as every tab's lists are.
  await stripShows(page, "aircraft-question", "question-recents");
  await expect(list.getByTestId("aircraft-recent").first()).toContainText("N14511");
  await stripShows(page, "aircraft-question", "question-favorites");
  // A tile opens its card again.
  await list.getByTestId("pill-aircraft-favorite").click();
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  await expect(page.getByTestId("flight-card").getByTestId("flight-favorite")).toHaveAttribute("aria-pressed", "true");
});

test("an airplane's card on Aircraft is still open after Setup and back to Aircraft", async ({ page }) => {
  // The owner's notice: "When I open an aircraft card and go to setup and
  // come back, to aircraft tab, the card is not there anymore". Aircraft
  // was taken for the tab up tapped again, which puts its card away.
  await sky(page);
  await page.goto("/app/plan?aircraft=1&flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  await expect(card.getByTestId("flight-favorite")).toBeVisible({ timeout: slow(15_000) });
  await showTabs(page);
  await page.getByTestId("setup-button").click();
  await expect(sideDrawer(page).getByTestId("setup-page")).toBeVisible();
  await showTabs(page);
  await page.getByTestId("tab-aircraft").click();
  await expect(sideDrawer(page).getByTestId("setup-page")).toBeHidden();
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  await expect(card.getByTestId("flight-favorite")).toBeVisible();
});

test("the card's sketch of where an airplane has flown is in its heights' colours, as the map's path, with the fields it left and is bound for", async ({ page }) => {
  // The owner's ask: "Can the aircraft trace in the thumbnail have the
  // origin/destination airport? And the trace color green just like on
  // the map?"
  await sky(page);
  const fields: Record<string, { lat: number; lon: number; name: string }> = {
    TJSJ: { lat: 18.4394, lon: -66.0018, name: "Luis Munoz Marin International Airport" },
    KORD: { lat: 41.9786, lon: -87.9048, name: "Chicago O'Hare International Airport" },
  };
  await page.route(url => /\/api\/planner\/airport\/(TJSJ|KORD)$/.test(url.pathname), route => {
    const ident = route.request().url().split("/").pop()!;
    return route.fulfill({ json: { ident, ...fields[ident] } });
  });
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const sketch = page.getByTestId("flight-card").getByTestId("trail-sketch");
  await expect(sketch).toBeVisible({ timeout: slow(15_000) });
  // The fields, each its dot and its ident.
  await expect(sketch.locator('[data-sketch-field="TJSJ"]')).toHaveText("TJSJ");
  await expect(sketch.locator('[data-sketch-field="KORD"]')).toHaveText("KORD");
  // Its trace in the colours of its heights (heightColour), 7,000 to
  // 12,000 ft here, not the tint it was.
  const colours = await sketch.locator("[data-sketch-run]").evaluateAll(runs => runs.map(r => r.getAttribute("stroke")));
  expect(colours.length).toBeGreaterThan(0);
  for (const colour of colours) expect(colour).toMatch(/^hsl\(\d+ 85% 45%\)$/);
});

test("an airplane's card is laid out as an airport's: its pictures across the top and four actions under them, at the same places", async ({ page }) => {
  // The owner's ask: "Do airport and aircraft cards have same layouts?",
  // and their pick of the two cards' redesign (A2): the same head, the
  // same row of actions.
  await sky(page, { ...DETAIL, description: "PIPER PA-28-140/150/160/180 CHEROKEE" });
  const panel = sideDrawer(page);
  // Where the actions are from the pictures' top, half way.
  const places = async (head: string, action: string) => {
    await grabberTo(page, "half");
    const [top, tile, sheet] = await Promise.all([page.getByTestId(head), page.getByTestId(action).first(), panel].map(async l => (await l.boundingBox())!));
    return { head: Math.round(top.y - sheet.y), height: Math.round(top.height), actions: Math.round(tile.y - top.y), size: Math.round(tile.height) };
  };
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await expect(page.getByTestId("fly-here")).toBeEnabled({ timeout: slow(15_000) });
  const airport = await places("place-head", "place-call");
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  await expect(page.getByTestId("flight-alert")).toBeVisible({ timeout: slow(15_000) });
  const airplane = await places("flight-head", "flight-alert");
  expect(airplane).toEqual(airport);
  // The long model whole in its two lines over the pictures' foot.
  const what = page.getByTestId("flight-what");
  await expect(what).toContainText("Cherokee");
  const [line, head] = await Promise.all([what, page.getByTestId("flight-head")].map(async l => (await l.boundingBox())!));
  expect(line.y + line.height).toBeLessThanOrEqual(head.y + head.height);
});

test("an airplane's card has Follow, Alert, Debrief and the star in a row, Share and the close on its pictures, its flight's state and height in its summary, and its airport a tap away", async ({ page }) => {
  // The owner's pick of the redesign (A2): the actions a row of four
  // under the pictures, Follow filled, as Maps' are under a place's.
  await sky(page, { ...DETAIL, departed: { ident: "C81", name: "Campbell Airport", at: Date.now() / 1000 - 3600 } });
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  await expect(card.getByTestId("flight-follow")).toBeVisible({ timeout: slow(15_000) });
  const row = await Promise.all(["flight-follow", "flight-alert", "flight-debrief", "flight-favorite"].map(async id => (await card.getByTestId(id).boundingBox())!));
  for (let i = 1; i < row.length; i++) {
    expect(Math.abs(row[i]!.y - row[0]!.y), "one row").toBeLessThan(1);
    expect(Math.abs(row[i]!.width - row[0]!.width), "equal").toBeLessThan(1);
    expect(row[i]!.x, "each beside the one before").toBeGreaterThan(row[i - 1]!.x + row[i - 1]!.width);
  }
  // Following it as it opens, said on its action.
  await expect(card.getByTestId("flight-follow")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("flight-follow")).toContainText("Following");
  // Share and the close on the pictures, the bar's out of the pill.
  const head = (await card.getByTestId("flight-head").boundingBox())!;
  for (const id of ["flight-share", "flight-close"]) {
    const button = (await card.getByTestId(id).boundingBox())!;
    expect(button.y >= head.y && button.y + button.height <= head.y + head.height, `${id} on the pictures`).toBe(true);
  }
  await expect(card.getByTestId("flight-share")).toHaveAccessibleName("Share UAL2088");
  // Descending 1,200 ft a minute, at 7,000 ft and 250 kt: said in its summary.
  await expect(card.getByTestId("flight-state")).toHaveText("DES");
  await expect(card.getByTestId("flight-altitude")).toHaveText("7,000 ft ↓ 1,200 fpm · 250 kt · 090° true");
  // Its airport: the field it left, its card over the airplane's, and its
  // close back to the airplane's.
  const airport = card.getByTestId("flight-airport");
  await expect(airport).toContainText("C81");
  await airport.click();
  await expect(page).toHaveURL(/[?&]place=C81/);
  await expect(page.getByTestId("place-card")).toBeVisible({ timeout: slow(15_000) });
  await closeCard(page, "place-close");
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  await expect(page.getByTestId("flight-card")).toBeVisible();
});

test("an airplane not heard now has its last flight sketched, on the ground where it landed, and Debrief opens it", async ({ page }) => {
  // The owner's ask: "if it's not flying now, sketch the last flight."
  const off = Date.now() / 1000 - 30 * 3600;
  const lci = { ident: "LCI", name: "Laconia Municipal Airport", city: "Laconia", region: "US-NH" };
  const lwm = { ident: "LWM", name: "Lawrence Municipal Airport", city: "Lawrence", region: "US-MA" };
  const points = Array.from({ length: 80 }, (_, i) => ({
    t: off + i * 60, lat: 43.57 - i * 0.0107, lon: -71.42 + i * 0.0038, alt_ft: 800 + Math.min(i, 79 - i) * 120,
    gs_kt: 100, track_deg: 165, vrate_fpm: i < 40 ? 500 : -500,
  }));
  await sky(page, { hex: "a89c1e", registration: "N654FL", type: "P28A", departed: null, trail: [] });
  await page.route(url => /\/api\/planner\/traffic\/flight\/a89c1e\/history$/.test(url.pathname), route => route.fulfill({ json: {
    hex: "a89c1e", registration: "N654FL", type: "P28A",
    flights: [{ id: Math.floor(off), origin: lci, destination: lwm, off, on: off + 79 * 60, landed: true, in_air: false, max_alt_ft: 5520 }],
  } }));
  await page.route(url => /\/api\/planner\/traffic\/flight\/a89c1e\/history\/\d+$/.test(url.pathname),
    route => route.fulfill({ json: { id: Math.floor(off), points } }));
  await page.goto("/app/plan?flight=a89c1e");
  await settle(page);
  const card = page.getByTestId("flight-card");
  await expect(card.getByTestId("flight-chip")).toHaveText(/^Landed LWM \d{1,2} [A-Z][a-z]{2}$/, { timeout: slow(15_000) });
  await expect(card.getByTestId("flight-state")).toHaveText("GND");
  // No photo of it on Planespotters: a quiet stand-in on the tint across
  // the top, not an empty box; its last flight sketched a page across.
  await expect(card.getByTestId("flight-photo-none")).toBeInViewport();
  await expect(card.getByTestId("trail-sketch")).toBeAttached();
  // Its airport: where it landed.
  await expect(card.getByTestId("flight-airport")).toContainText("LWM");
  await card.getByTestId("flight-debrief").click();
  await expect(page).toHaveURL(new RegExp(`[?&]past=${Math.floor(off)}`));
  await expect(page.getByTestId("past-flight-card").getByTestId("past-flight-name")).toHaveText("LCI → LWM");
});

test("an airplane's photo is across its card's top, the photographer named on it and the photo linked to its page, its sketch a swipe across", async ({ page }) => {
  // The owner's ask: "I also like the idea of having the actual airframe
  // photo", as Planespotters' terms have it shown.
  await sky(page);
  await page.route(url => url.hostname === "api.planespotters.net", route => route.fulfill({ json: { photos: [{
    id: "1773250", thumbnail_large: { src: "https://t.plnspttrs.net/30652/1773250_280.jpg", size: { width: 420, height: 280 } },
    link: "https://www.planespotters.net/photo/1773250/n14511", photographer: "Jane Spotter",
  }] } }));
  await page.route(url => url.hostname === "t.plnspttrs.net", route => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  }));
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  const photo = card.getByTestId("flight-photo");
  await expect(photo).toHaveAttribute("href", "https://www.planespotters.net/photo/1773250/n14511", { timeout: slow(15_000) });
  await expect(photo).toHaveAttribute("target", "_blank");
  await expect(photo).not.toHaveAttribute("rel", /nofollow/);
  await expect(card.getByTestId("flight-photo-credit")).toHaveText("© Jane Spotter · Planespotters");
  // The photo first, as Maps opens a place on its photos; where it has
  // flown a page across.
  await expect(photo).toBeInViewport({ ratio: 0.9 });
  // The stock carousel's own next page (PictureSlides), as a swipe is.
  await card.locator('[data-slot="carousel"]').evaluate(el => el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  await expect(card.getByTestId("flight-trail")).toBeInViewport({ ratio: 0.9 });
});

test("an alert set on an airplane goes off on the map when it lands, once, and Show opens its card", async ({ page }) => {
  // The owner's pick: "Just the alert button for all alerts".
  await sky(page);
  let landed = false;
  let asked = 0;
  await page.route(url => /\/api\/planner\/traffic\/flight\/a0b7d8\/status$/.test(url.pathname), route => {
    asked += 1;
    return route.fulfill({ json: landed
      ? { hex: "a0b7d8", heard_s: 130, airborne: false, aircraft: null, departed: null,
          arrived: { ident: "KORD", name: "Chicago O'Hare International Airport", city: "Chicago", region: "US-IL", at: Date.now() / 1000 - 60 } }
      : { hex: "a0b7d8", heard_s: 1, airborne: true, aircraft: UAL, departed: null, arrived: null } });
  });
  await page.goto("/app/plan?flight=a0b7d8");
  await settle(page);
  const card = page.getByTestId("flight-card");
  await card.getByTestId("flight-alert").click();
  const menu = page.getByTestId("flight-alert-menu");
  await expect(menu).toContainText("Tell me when UAL2088");
  // In the air now: not "takes off"; and no own ship, so not "near me".
  await expect(menu.getByTestId("flight-alert-takeoff")).toHaveAttribute("aria-disabled", "true");
  await expect(menu.getByTestId("flight-alert-takeoff")).toContainText("It is in the air now");
  await expect(menu.getByTestId("flight-alert-near-me")).toContainText("Your position is off");
  await menu.getByTestId("flight-alert-land").click();
  await expect(menu.getByTestId("flight-alert-land")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(card.getByTestId("flight-alerts-set")).toHaveText("When it lands");
  // Watched with the card put away.
  await closeCard(page, "flight-close");
  await expect.poll(() => asked, { timeout: slow(15_000) }).toBeGreaterThan(0);
  landed = true;
  const banner = page.getByTestId("aircraft-alert");
  await expect(banner.getByTestId("aircraft-alert-title")).toHaveText("UAL2088 landed at KORD", { timeout: slow(45_000) });
  await expect(banner).toContainText("Chicago");
  await expect(banner).toHaveCount(1);
  // Show: its card again, the alert let go once said.
  await banner.getByTestId("aircraft-alert-show").click();
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]flight=a0b7d8/);
  await expect(page.getByTestId("flight-card").getByTestId("flight-alerts-set")).toHaveCount(0);
});
