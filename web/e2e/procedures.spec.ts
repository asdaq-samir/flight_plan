import { test, expect, type Locator } from "@playwright/test";
import { grabberTo, openTab, settle, settled, sideDrawer, slow } from "./helpers";

// A runway line opened stays open while the spec picks from it: the app
// folds it after two seconds untouched, which a loaded runner can spend
// between opening it and the pick (ProceduresRoute's runwayLineFoldMs).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("vfr.runwayFoldMs", "600000"); } catch { /* no storage */ } });
});

/**
 * The route's Procedures (ProceduresRoute), FPL's list, at the pilot's ask: a field's
 * traffic pattern picked by its runway, kept in the address, and drawn on
 * the map round the runway with its 45° entry (PatternLayer).
 */
/** A field's runway line opened where it is folded to the runway picked
 *  (PatternChips), at the owner's ask ("can the runway line collapse to
 *  the selected runway?"). */
async function openRunways(field: Locator) {
  // The field's runways in first: the list is drawn again as a sheet over
  // it closes, the field gone from it for a moment.
  await expect(field.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(20000) });
  const folded = field.locator("[data-folded]");
  if (await folded.count()) await folded.click();
  await expect(field.locator("[data-folded]")).toHaveCount(0);
}

test("a field's traffic pattern is picked by its runway, kept in the address and drawn on the map", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openTab(page, "Nav Log");
  const procedures = page.getByTestId("procedures");
  // The route's fields in the order they are flown, each its runways as
  // chips under its arrival and approach.
  await expect(procedures.getByRole("heading").first()).toHaveText("C81");
  const destination = procedures.getByRole("region", { name: "KDLH · Arrive" });
  await expect(destination.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(20000) });
  await openRunways(destination);
  const runway = destination.getByRole("radio", { name: /^Runway / }).and(page.locator(':not([disabled]):not([aria-checked="true"])')).first();
  const name = (await runway.innerText()).trim();
  await runway.click();
  // The line folded to the runway picked.
  const folded = destination.locator("[data-folded]");
  await expect(folded).toHaveText(name);
  await expect(folded).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(new RegExp(`[?&]pattern=[^&]*KDLH(%3A|:)${name}(%2C|,|&|$)`));
  await expect(page.locator("path.traffic-pattern.pattern-at-KDLH")).toHaveCount(1, { timeout: slow(10000) });

  // No None: every landing is on a runway (the owner's "Why is none even an
  // option?"), and the chip picked tapped again keeps it.
  await openRunways(destination);
  await expect(destination.getByRole("radio", { name: /None/ })).toHaveCount(0);
  await destination.getByRole("radio", { name: new RegExp(`^Runway ${name}\\b`) }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]pattern=[^&]*KDLH(%3A|:)${name}(%2C|,|&|$)`));
});

// KDLH's ILS as the planner would send it (vfr.procedures), stubbed: the
// FAA's file is not read on CI's runner.
const LIST = {
  airport: "KDLH", cycle: "261001",
  procedures: [
    { kind: "approach", id: "I09", name: "ILS RWY 09", runway: "09", transitions: ["DLH"], runway_transitions: [] },
    { kind: "arrival", id: "SKETC1", name: "SKETC1", runway: null, transitions: [], runway_transitions: ["ALL"] },
  ],
};
const DRAWN = {
  airport: "KDLH", kind: "approach", id: "I09", name: "ILS RWY 09", transition: "DLH", cycle: "261001",
  lines: [
    { role: "transition", name: "DLH", points: [[46.80, -92.36], [46.84, -92.40]] },
    { role: "final", name: null, points: [[46.84, -92.40], [46.84, -92.30], [46.842, -92.21]] },
    { role: "missed", name: null, points: [[46.842, -92.21], [46.843, -92.17], [46.80, -92.36]] },
  ],
  holds: [{ fix: "DLH", turn: "R", inbound_deg: 90, missed: true, points: [[46.80, -92.36], [46.79, -92.34], [46.78, -92.36], [46.80, -92.36]] }],
  fixes: [
    { ident: "DLH", lat: 46.80, lon: -92.36, roles: ["hold"], min_ft: 3500, max_ft: null, speed_kt: null, missed: false },
    { ident: "OFOFO", lat: 46.84, lon: -92.40, roles: ["IAF", "IF"], min_ft: 3500, max_ft: null, speed_kt: null, missed: false },
    { ident: "FAKER", lat: 46.84, lon: -92.30, roles: ["FAF"], min_ft: 2700, max_ft: 2700, speed_kt: null, missed: false },
  ],
};

// KDLH's arrival in the stubbed list, drawn: its common route alone.
const ARRIVAL_DRAWN = {
  airport: "KDLH", kind: "arrival", id: "SKETC1", name: "SKETC1", transition: null, cycle: "261001",
  lines: [{ role: "common", name: null, points: [[46.95, -92.60], [46.84, -92.40]] }],
  holds: [],
  fixes: [{ ident: "OFOFO", lat: 46.84, lon: -92.40, roles: [], min_ft: null, max_ft: null, speed_kt: null, missed: false }],
};

test("a field's approach is picked on its own page with its transition, drawn on the map as it is chosen, and added to the route with Add to Route, as ForeFlight picks one", async ({ page }) => {
  const asked: string[] = [];
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    asked.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/KDLH/procedures")) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: { ...DRAWN, transition: url.searchParams.get("transition") } });
    return route.fulfill({ json: { airport: "C81", cycle: "261001", procedures: [] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openTab(page, "Nav Log");
  const procedures = page.getByTestId("procedures");
  // C81 publishes no departure, so none is offered there; the tops of climb
  // and descent are the nav log's alone (the owner's cleanup: "no need to
  // have the toc and tod", "no need to take space for departures/arrivals
  // if it's not available").
  const c81 = procedures.getByRole("region", { name: "C81 · Depart" });
  await expect(c81.getByTestId("procedure-patterns")).toBeVisible({ timeout: slow(10000) });
  await expect(c81.getByTestId("procedure-kind")).toHaveCount(0);
  await expect(procedures.getByTestId("route-toc")).toHaveCount(0);
  await expect(procedures.getByTestId("route-tod")).toHaveCount(0);
  // The destination's approaches, a page of their own.
  const kdlh = procedures.getByRole("region", { name: "KDLH · Arrive" });
  // Its pull-down's foot: the field's whole list.
  await kdlh.locator('[data-testid=procedure-kind][data-kind=approach]').click();
  await page.getByTestId("procedure-menu-all").click();
  await expect(page.getByRole("heading", { name: "KDLH approaches" })).toBeVisible();
  // Its own page: drawn on the map from vectors as it opens, before it is
  // added -- the route's address untouched.
  await page.getByTestId("procedure-option").filter({ hasText: "ILS RWY 09" }).click();
  await expect(page.getByRole("heading", { name: "KDLH ILS RWY 09" })).toBeVisible();
  await expect.poll(() => asked, { timeout: slow(10000) }).toContain("/api/planner/airport/KDLH/procedures/I09");
  await expect(page.locator("path.instrument-procedure").first()).toBeAttached({ timeout: slow(10000) });
  await expect(page).not.toHaveURL(/[?&]procs=/);
  // Its fixes as they are flown, with the altitudes they are crossed at.
  const fixes = page.getByTestId("procedure-fixes");
  await expect(fixes).toContainText(/OFOFO\s*3,500 ft or above/);
  await expect(fixes).toContainText(/FAKER\s*2,700 ft/);
  // The close goes back, to the field's approaches: no Back (the owner's
  // "close button should behave as the back button").
  await expect(page.getByTestId("procedures-close")).toHaveAccessibleName("Back");
  await page.getByTestId("procedures-close").click();
  await expect(page.getByRole("heading", { name: "KDLH approaches" })).toBeVisible();
  await expect(page.getByTestId("procedures-close")).toHaveAccessibleName("Close");
  await page.getByTestId("procedure-option").filter({ hasText: "ILS RWY 09" }).click();
  // By DLH, drawn as it is chosen.
  await page.getByTestId("procedure-transition").filter({ hasText: "DLH" }).click();
  await expect.poll(() => asked, { timeout: slow(10000) }).toContain("/api/planner/airport/KDLH/procedures/I09?transition=DLH");
  await expect(page).not.toHaveURL(/[?&]procs=/);
  // Add to Route: in the address, and the sheet put away.
  await page.getByTestId("procedure-add").click();
  await expect(page).toHaveURL(/[?&]procs=KDLH(%3A|:)I09(%3A|:)DLH(&|$)/);
  await expect(page.getByRole("heading", { name: "KDLH ILS RWY 09" })).toBeHidden();

  // On the map: the transition and the final, the missed approach dashed,
  // its hold, and the fixes with their altitudes.
  await expect(page.locator("path.instrument-procedure")).toHaveCount(2, { timeout: slow(10000) });
  await expect(page.locator("path.instrument-procedure-missed")).toHaveCount(1);
  await expect(page.locator("path.instrument-procedure-hold")).toHaveCount(1);
  await expect(page.locator("[data-procedure-fix]")).toHaveCount(3);
  // Said in the route's box after the destination's pill, and a tap there
  // opens the Procedures.
  const chip = sideDrawer(page).getByTestId("route-procedure");
  await expect(chip).toHaveText("ILS 09 · DLH");
  // Before the destination's pill, as it is flown into the field.
  const dest = sideDrawer(page).getByTestId("route-dest");
  expect((await chip.boundingBox())!.x).toBeLessThan((await dest.boundingBox())!.x);
  await expect(chip).toHaveAccessibleName(/ILS RWY 09, from DLH/);
  await chip.click();
  await expect(page.getByRole("heading", { name: "KDLH approaches" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Gone, and the panel at rest, before it is dragged: a drag on the
  // sheet's way out was its own.
  await expect(page.getByRole("heading", { name: "KDLH approaches" })).toHaveCount(0);
  await settled(sideDrawer(page));

  // Checked in the list, and on its page Remove from Route takes it off
  // the address, and off the map once the sheet is put away.
  await openTab(page, "Nav Log");
  await expect(kdlh.locator('[data-testid=procedure-kind][data-kind=approach]')).toContainText("ILS 09 · DLH");
  await kdlh.locator('[data-testid=procedure-kind][data-kind=approach]').click();
  await page.getByTestId("procedure-menu-all").click();
  const ils = page.getByTestId("procedure-option").filter({ hasText: "ILS RWY 09" });
  await expect(ils).toContainText("In the route, from DLH");
  await ils.click();
  await page.getByTestId("procedure-remove").click();
  await expect(page).not.toHaveURL(/[?&]procs=/);
  await expect(page.getByTestId("procedure-add")).toBeVisible();
  // Put away by its own close.
  await page.getByTestId("procedures-close").click();
  await expect(page.getByTestId("procedure-add")).toHaveCount(0);
  await expect(page.locator("path.instrument-procedure")).toHaveCount(0);
});

/**
 * An approach and the field's runway kept in step, at the owner's ask
 * ("only certain scenarios can allow picking another runway such as ILS
 * circling"): the approach added puts the runway chip on its own runway,
 * landed straight in; another is let only where the plate publishes
 * circling minimums, a circle to land; and no pattern is drawn then.
 */
test("an approach puts its field's runway on its own, and another is let only where its plate publishes circling minimums", async ({ page }) => {
  let circling = false;
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/KDLH/procedures")) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/KDLH/procedures/I09/plate")) {
      // Off the map's way: placed far from the route, as the test reads only its circling.
      return route.fulfill({ json: { cycle: "2610", name: "ILS OR LOC RWY 09", south: 0, west: 0, north: 0.1, east: 0.1, fixes: [], circling } });
    }
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: { ...DRAWN, transition: url.searchParams.get("transition") } });
    if (url.pathname.endsWith("/KDLH/procedures/SKETC1")) return route.fulfill({ json: ARRIVAL_DRAWN });
    return route.fulfill({ json: { airport: "C81", cycle: "261001", procedures: [] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&pattern=KDLH:27");
  await settle(page);
  await openTab(page, "Nav Log");
  const procedures = page.getByTestId("procedures");
  const kdlh = procedures.getByRole("region", { name: "KDLH · Arrive" });
  await expect(kdlh.getByRole("radio", { name: /^Runway 27/ })).toHaveAttribute("aria-checked", "true", { timeout: slow(20000) });
  await expect(page.locator("path.traffic-pattern.pattern-at-KDLH")).toHaveCount(1, { timeout: slow(10000) });
  // The ILS to 9 added from its pull-down, from DLH: the runway is 9,
  // landed straight in, and no pattern drawn.
  await kdlh.locator('[data-testid=procedure-kind][data-kind=approach]').click();
  const menu = page.getByTestId("procedure-menu");
  await expect(menu.getByText("Runway 9", { exact: false })).toBeVisible({ timeout: slow(10000) });
  await menu.getByTestId("procedure-menu-item").filter({ hasText: "ILS" }).click();
  // Its transitions in the menu's own place, on the screen: side by side,
  // a phone's ran off its edge (the owner's screenshot).
  await expect(menu.getByTestId("procedure-menu-close")).toHaveAccessibleName("Back");
  const placed = (await menu.boundingBox())!;
  expect(placed.x + placed.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByTestId("procedure-menu-transition").filter({ hasText: "From DLH" }).click();
  await expect(page).toHaveURL(/[?&]procs=KDLH(%3A|:)I09(%3A|:)DLH(&|$)/);
  await expect(page).toHaveURL(/[?&]pattern=[^&]*KDLH(%3A|:)9(%2C|,|&|$)/);
  await settled(sideDrawer(page));
  await openTab(page, "Nav Log");
  await expect(kdlh.getByRole("radio", { name: /^Runway 9\b/ })).toHaveAttribute("aria-checked", "true");
  await expect(kdlh.locator('[data-testid=procedure-kind][data-kind=approach]')).toContainText("ILS 09 · DLH");
  // The field's arrival, a pull-down beside it once the list is in.
  await kdlh.locator('[data-testid=procedure-kind][data-kind=arrival]').click();
  await page.getByTestId("procedure-menu").getByTestId("procedure-menu-item").filter({ hasText: "SKETC1" }).click();
  await expect(page).toHaveURL(/[?&]procs=[^&]*KDLH(%3A|:)SKETC1/);
  await settled(sideDrawer(page));
  await openTab(page, "Nav Log");
  // The plate switched off from the approach's pull-down, and on again.
  await kdlh.locator("[data-testid=procedure-kind][data-kind=approach]").click();
  const plate = page.getByTestId("procedure-menu-plate");
  await expect(plate).toHaveAttribute("aria-checked", "true");
  await plate.click();
  await expect(plate).toHaveAttribute("aria-checked", "false");
  await plate.click();
  await expect(plate).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  // Said in the runway's chip's name, the info button gone (the owner's
  // "No need for info button").
  await expect(kdlh.getByRole("radio", { name: /Straight in/ })).toBeVisible();
  await expect(page.locator("path.traffic-pattern.pattern-at-KDLH")).toHaveCount(0);
  // Its plate has no circling line: no other runway. By its number: the
  // live wind may name 27 into it first.
  await openRunways(kdlh);
  await expect(kdlh.getByRole("radio", { name: /^Runway 27\b.*, no circling on the ILS 09/ })).toBeDisabled();

  // One that publishes circling minimums: 27 is a circle to land.
  circling = true;
  await page.goto(page.url());
  await settle(page);
  await openTab(page, "Nav Log");
  await expect(kdlh.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(20000) });
  await openRunways(kdlh);
  const circle = kdlh.getByRole("radio", { name: /^Runway 27/ });
  await expect(circle).toBeEnabled({ timeout: slow(20000) });
  await circle.click();
  await expect(page).toHaveURL(/[?&]pattern=[^&]*KDLH(%3A|:)27(%2C|,|&|$)/);
  await expect(kdlh.getByRole("radio", { name: /Circle to land/ })).toBeVisible();
  await expect(page.locator("path.traffic-pattern.pattern-at-KDLH")).toHaveCount(0);
});

/**
 * The field the route lands at has its runway into the wind picked as the
 * route comes in, at the owner's ask ("a preselected runway into the
 * wind"), and no approach; a runway the pilot picks over it is kept, not
 * picked over again. An older address's "NONE" (the None chip, gone) is no
 * pick, so the wind's is made there. Flown three hours from now, by the
 * forecast's wind, stubbed an easterly: Duluth's 9.
 */
test("the destination's runway into the wind is picked as the route comes in, and a pilot's own is kept", async ({ page }) => {
  await page.route(url => /\/airport\/[^/]+\/forecast-wind$/.test(url.pathname), route => route.fulfill({
    json: { ident: "KDLH", distance_nm: 0, dir_true_deg: 90, speed_kt: 14, gust_kt: null, valid_from: 0, valid_to: 4_000_000_000 },
  }));
  const depart = encodeURIComponent(new Date(Date.now() + 3 * 60 * 60_000).toISOString());
  await page.goto(`/app/plan?dep=C81&dest=KDLH&depart=${depart}&pattern=KDLH:NONE`);
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = page.getByTestId("procedures").getByRole("region", { name: "KDLH · Arrive" });
  await expect(kdlh.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(20000) });
  await expect(kdlh.getByRole("radio", { name: /^Runway 9, into the wind/ })).toHaveAttribute("aria-checked", "true", { timeout: slow(60_000) });
  await expect(page).not.toHaveURL(/NONE/);
  await expect(page).not.toHaveURL(/[?&]procs=/);
  await openRunways(kdlh);
  const other = kdlh.getByRole("radio", { name: /^Runway / }).and(page.locator(':not([disabled]):not([aria-checked="true"])')).first();
  const name = (await other.innerText()).trim();
  await other.click();
  await expect(page).toHaveURL(new RegExp(`[?&]pattern=[^&]*KDLH(%3A|:)${name}(%2C|,|&|$)`));
  await page.goto(page.url());
  await settle(page);
  await openTab(page, "Nav Log");
  await expect(kdlh.locator("[data-folded]")).toHaveText(name, { timeout: slow(20000) });
});

/**
 * A field typed by its FAA identifier is named by its ICAO code once its
 * card is in, at the owner's ask ("K is not showing in front of ORD"),
 * the pick made under the old name kept; its arrivals are offered by the
 * d-TPP's own code for a STAR ("STR"); and its many runways stay one line,
 * scrolled sideways.
 */
test("a field typed as ORD is KORD, its arrivals offered and its runways one line", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=ORD&pattern=ORD:9L");
  await expect(page).toHaveURL(/[?&]dest=KORD(&|$)/, { timeout: slow(20000) });
  await expect(page).toHaveURL(/[?&]pattern=[^&]*KORD(%3A|:)9L(%2C|,|&|$)/);
  await settle(page);
  await openTab(page, "Nav Log");
  const kord = page.getByTestId("procedures").getByRole("region", { name: "KORD · Arrive" });
  await expect(kord.locator('[data-testid=procedure-kind][data-kind=arrival]')).toBeVisible({ timeout: slow(20000) });
  const chips = kord.getByTestId("procedure-pattern");
  await expect(chips.first()).toBeVisible({ timeout: slow(20000) });
  // Folded to 9L, picked; opened, every runway on one line.
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveText("9L");
  await openRunways(kord);
  const tops = await chips.evaluateAll(all => all.map(c => Math.round(c.getBoundingClientRect().top)));
  expect(tops.length).toBeGreaterThan(5);
  expect(new Set(tops).size).toBe(1);
  // The runway picked scrolled into sight, in the line's middle where it
  // can be, its neighbours either side (the owner's ask), or as near as
  // the line's end lets it.
  const nineLeft = kord.getByRole("radio", { name: /^Runway 9L/ });
  await expect(nineLeft).toBeInViewport();
  await expect.poll(() => nineLeft.evaluate(chip => {
    const line = chip.closest<HTMLElement>("[data-slides]")!;
    const box = line.getBoundingClientRect(), c = chip.getBoundingClientRect();
    const off = Math.abs((c.left + c.width / 2) - (box.left + box.width / 2));
    const atEnd = line.scrollLeft <= 0 || line.scrollLeft >= line.scrollWidth - line.clientWidth - 1;
    return off <= 2 || atEnd;
  })).toBe(true);
});

/**
 * A departure's pull-down sits over its field's runway chips, as an
 * arrival's and approach's do, at the owner's ask ("Departure selection
 * should also be before runways just like arrival/approach").
 */
test("a field's departure is picked after its runways, as its arrival and approach are", async ({ page }) => {
  await page.goto("/app/plan?dep=KORD&dest=C81");
  await settle(page);
  await openTab(page, "Nav Log");
  const kord = page.getByTestId("procedures").getByRole("region", { name: "KORD · Depart" });
  const menu = kord.locator("[data-testid=procedure-kind][data-kind=departure]");
  await expect(menu).toBeVisible({ timeout: slow(20000) });
  // None picked: a dashed "+ Departure" after the runways, at the owner's
  // pick ("Can the selection for procedures be after runways so when
  // selected can expand", option C).
  await expect(menu).toHaveText(/^\+ Departure/);
  await expect(menu).toHaveAttribute("data-look", "add");
  const chips = kord.getByTestId("procedure-pattern").locator("visible=true").first();
  await expect(chips).toBeVisible();
  // On the runways' own line after them, at the owner's asks ("Can arrival
  // and approach pills be next to the runway when runway is collapsed?",
  // "Same with departure", "Approach doesn't need to go next line just let
  // it slide with runways"): beside the runway picked, or sliding with them.
  await expect.poll(async () => {
    const [m, c] = [await menu.boundingBox(), await chips.boundingBox()];
    if (!m || !c) return false;
    return m.x > c.x + c.width - 1 && Math.abs((m.y + m.height / 2) - (c.y + c.height / 2)) < 8;
  }).toBe(true);
  // And the departure's time on its own step, not in the route's box.
  await expect(kord.getByTestId("depart-date")).toHaveText(/^Now/);
});

/**
 * A route from where the airplane is (Fly Here's "@lat,lon") lists its
 * destination as where it arrives, not a departure (the owner's screenshot:
 * KSTL with a "Depart" pull-down and its runways as a takeoff's).
 */
test("a route from the present position arrives at its destination", async ({ page }) => {
  await page.goto("/app/plan?dep=@42.2333,-87.9883&dest=KSTL");
  await settle(page);
  await openTab(page, "Nav Log");
  const route = page.getByTestId("procedures");
  await expect(route.getByRole("region", { name: "KSTL · Arrive" })).toBeVisible({ timeout: slow(30000) });
  await expect(route.getByRole("region", { name: "KSTL · Depart" })).toHaveCount(0);
});

test.describe("on the owner's phone's width, to a finger", () => {
  // A finger's 17-point words (pointer: coarse), on 393 points.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 695 } });

  test("a pull-down opens on a finger's lift, not its touch, so a scroll begun on it opens nothing", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "a phone's finger");
    await page.goto("/app/plan?dep=C81&dest=ORD");
    await settle(page);
    await openTab(page, "Nav Log");
    const trigger = page.locator("[data-testid=procedure-kind][data-kind=approach]");
    await expect(trigger).toBeVisible({ timeout: slow(20000) });
    // Once it has stopped moving: the route's rows coming in, the runway
    // picked into the wind and its line folding move it down the list, and
    // a touch's lift where it no longer is was no tap (a flake on
    // 48a36f99 as well, one run in two).
    let last = "";
    await expect.poll(async () => {
      const at = JSON.stringify(await trigger.boundingBox());
      const still = at === last;
      last = at;
      return still;
    }, { timeout: slow(30000), intervals: [700] }).toBe(true);
    const box = (await trigger.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    // Touched and held, no lift: closed.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(400);
    await expect(page.getByTestId("procedure-menu")).toHaveCount(0);
    // Lifted where it was touched: a tap, open.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByTestId("procedure-menu")).toBeVisible();
  });

  test("a route with a procedure's chip and three fields stays one line in the route's box, the field past its end taking no line of its own", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "a phone's box");
  // The owner's recording: C81 → its ILS 09 via DLH → KDLH → KRFD, where
  // the empty field after KRFD wrapped onto a second line.
  await page.route(url => /\/airport\/KDLH\/procedures\/I09/.test(url.pathname), route => route.fulfill({ json: { ...DRAWN, transition: "DLH" } }));
  await page.goto("/app/plan?dep=C81&stops=KDLH&dest=KRFD&procs=KDLH:I09:DLH");
  await settle(page);
  // Half way, the sheet in from the screen's sides, its box the narrower.
  await grabberTo(page, "half");
  const box = sideDrawer(page).getByTestId("route-box");
  await expect(box.getByTestId("route-procedure")).toBeVisible({ timeout: slow(10000) });
  // Its lines', the buttons under them in the box since the owner's ask.
  expect((await box.getByTestId("route-slide").boundingBox())!.height).toBeLessThanOrEqual(48);
});
});

test("a procedure picked lengthens the plan by its path: the fuel and the time to the field are the flight flown", async ({ page }) => {
  // The owner's word ("Yes"), after the plan said 909 nm to Jacksonville
  // where the dry run flew 1053 by BENKY6 into O'Hare: the planner flies
  // the leg in by the approach picked, its miles more in the figures.
  const figures = async () => {
    await expect(page.getByTestId("navlog-fuel")).toHaveText(/^\d+\.\d gal$/, { timeout: slow(120_000) });
    return { fuel: parseFloat((await page.getByTestId("navlog-fuel").textContent())!), ete: (await page.getByTestId("navlog-ete").textContent())! };
  };
  const minutes = (ete: string) => {
    const [, h, m] = /^(?:(\d+)h )?(\d+)m$/.exec(ete.trim())!;
    return Number(h ?? 0) * 60 + Number(m);
  };
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const straight = await figures();
  // Out to PLANE, south-east of the field, and round onto the final.
  await page.goto("/app/plan?dep=C81&dest=KDLH&procs=KDLH:R27:PLANE");
  await settle(page);
  await expect.poll(async () => (await figures()).fuel, { timeout: slow(120_000) }).toBeGreaterThan(straight.fuel);
  const flown = await figures();
  expect(minutes(flown.ete)).toBeGreaterThan(minutes(straight.ete));
  // The breakdown says where the gallons more come from.
  await page.getByTestId("fuel-breakdown-open").click();
  await expect(page.getByTestId("fuel-breakdown")).toContainText(/\d+\.\d nm more by the procedures picked/);
});

test("an approach can be flown direct to one of its fixes, as ATC sends an airplane, and back as charted", async ({ page }) => {
  // The owner's ask: "the procedures should give the ability to go direct
  // to a fix as told by ATC".
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/KDLH/procedures")) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/plate")) return route.fulfill({ status: 404, json: { detail: "none" } });
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: { ...DRAWN, transition: url.searchParams.get("transition") } });
    return route.fulfill({ json: { airport: "C81", cycle: "261001", procedures: [] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&procs=KDLH:I09:DLH");
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = page.getByTestId("procedures").getByRole("region", { name: "KDLH · Arrive" });
  const approach = kdlh.locator("[data-testid=procedure-kind][data-kind=approach]");
  await expect(approach).toContainText("ILS 09 · DLH", { timeout: slow(20000) });
  await approach.click();
  const menu = page.getByTestId("procedure-menu");
  await expect(menu.getByTestId("procedure-menu-direct")).toContainText("As charted");
  await menu.getByTestId("procedure-menu-direct").click();
  // The procedure's own fixes, the missed approach's and the runway's not.
  await expect(menu.getByTestId("procedure-menu-direct-fix")).toHaveText(["As charted", "DLH", "OFOFO", "FAKER"]);
  await menu.getByTestId("procedure-menu-direct-fix").filter({ hasText: "FAKER" }).click();
  await expect(page).toHaveURL(/[?&]procs=KDLH(%3A|:)I09(%3A|:)DLH(%3A|:)FAKER(&|$)/);
  await settled(sideDrawer(page));
  await openTab(page, "Nav Log");
  await expect(approach).toContainText("ILS 09 · direct FAKER");
  // Back as charted.
  await approach.click();
  await menu.getByTestId("procedure-menu-direct").click();
  await menu.getByTestId("procedure-menu-direct-fix").filter({ hasText: "As charted" }).click();
  await expect(page).toHaveURL(/[?&]procs=KDLH(%3A|:)I09(%3A|:)DLH(&|$)/);
});

test("a procedure's fixes branch off the route, each sent direct to or given an altitude to cross it at, from the list or the map", async ({ page }) => {
  // The owner's pick, option 4 of the fix canvas: "expandable list of
  // connected points like git graph", any fix direct to or an altitude
  // to cross it at, its card opened from the list or the map.
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/KDLH/procedures")) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/plate")) return route.fulfill({ status: 404, json: { detail: "none" } });
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: { ...DRAWN, transition: url.searchParams.get("transition") } });
    return route.fulfill({ json: { airport: "C81", cycle: "261001", procedures: [] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&procs=KDLH:I09:DLH");
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = page.getByTestId("procedures").getByRole("region", { name: "KDLH · Arrive" });
  const toggle = kdlh.getByTestId("fix-branch-toggle");
  // The branch's head, after the runways: the approach's name with the
  // fold's arrow beside it, its kind and its fixes under it, and the
  // button to pick another at its right, at the owner's ask.
  const branchHead = kdlh.getByTestId("fix-branch");
  await expect(branchHead).toContainText("ILS 09 · DLH", { timeout: slow(20000) });
  await expect(branchHead).toContainText("Approach · 3 fixes");
  await expect(kdlh.locator("[data-testid=procedure-kind][data-look=button]")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const rows = kdlh.getByTestId("fix-branch-row");
  await expect(rows).toHaveCount(3);
  // Direct to FAKER from its row: kept in the address, the fixes before it skipped.
  await rows.filter({ hasText: "FAKER" }).getByTestId("fix-branch-menu").click();
  await page.getByTestId("fix-branch-menu-direct").click();
  await expect(page).toHaveURL(/[?&]procs=KDLH(%3A|:)I09(%3A|:)DLH(%3A|:)FAKER(&|$)/);
  await settled(sideDrawer(page));
  await openTab(page, "Nav Log");
  // Opened again where the plan made again folded it.
  await expect(async () => {
    if (!(await rows.first().isVisible())) await toggle.click();
    await expect(rows.filter({ hasText: "FAKER" })).toContainText("direct to", { timeout: 2000 });
  }).toPass({ timeout: slow(15000) });
  await expect(rows.filter({ hasText: "OFOFO" })).toContainText("skipped");
  // OFOFO given 3,000 to cross at, from its card.
  await rows.filter({ hasText: "OFOFO" }).getByTestId("fix-branch-menu").click();
  await page.getByTestId("fix-branch-menu-altitude").click();
  const card = page.getByTestId("fix-card");
  await expect(card).toBeVisible();
  await card.getByTestId("fix-card-altitude").fill("3000");
  await card.getByTestId("fix-card-set").click();
  await expect(page).toHaveURL(/[?&]cross=OFOFO(%3A|:)3000(&|$)/);
  await expect(card.getByTestId("fix-card-charted")).toBeVisible();
  await card.getByTestId("fix-card-charted").click();
  await expect(page).not.toHaveURL(/[?&]cross=/);
  await card.getByTestId("fix-card-close").click();
  await expect(card).toHaveCount(0);
  // The same card from the fix on the map: a tap's click on its mark, under
  // the sheet here, as the map's marks are tapped in the other specs.
  await page.locator('[data-procedure-fix="FAKER"]').dispatchEvent("click");
  await expect(page.getByTestId("fix-card")).toBeVisible();
  await expect(page.getByTestId("fix-card-direct")).toContainText("as charted");
});
