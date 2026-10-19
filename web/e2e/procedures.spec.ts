import { test, expect } from "@playwright/test";
import { grabberTo, openTab, settle, settled, sideDrawer, slow } from "./helpers";

/**
 * The route's Procedures (ProceduresRoute), FPL's list, at the pilot's ask: a field's
 * traffic pattern picked by its runway, kept in the address, and drawn on
 * the map round the runway with its 45° entry (PatternLayer); None takes
 * it off.
 */
test("a field's traffic pattern is picked by its runway, kept in the address and drawn on the map", async ({ page }) => {
  // C81's own runway set to none, so the one drawn is Duluth's.
  await page.goto("/app/plan?dep=C81&dest=KDLH&pattern=C81:NONE");
  await settle(page);
  await openTab(page, "Nav Log");
  const procedures = page.getByTestId("procedures");
  // The route's fields in the order they are flown, each its runways as
  // chips under its arrival and approach.
  await expect(procedures.getByRole("heading").first()).toHaveText("C81 · Depart");
  const destination = procedures.getByRole("region", { name: "KDLH · Arrive" });
  const runway = destination.getByTestId("procedure-pattern").and(page.locator(":not([disabled])")).first();
  await expect(runway).toBeVisible({ timeout: slow(20000) });
  const name = (await runway.innerText()).trim();
  await runway.click();
  await expect(runway).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(new RegExp(`[?&]pattern=[^&]*KDLH(%3A|:)${name}(%2C|,|&|$)`));
  await expect(page.locator("path.traffic-pattern")).toHaveCount(1, { timeout: slow(10000) });
  await expect(page.locator("path.traffic-pattern-entry")).toHaveCount(1);

  // None: off the map, and kept as none in the address, so the runway into
  // the wind is not picked for it again.
  await destination.getByRole("radio", { name: /None/ }).click();
  await expect(page.locator("path.traffic-pattern")).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]pattern=[^&]*KDLH(%3A|:)NONE(%2C|,|&|$)/);
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
  // Back, the round button at the head's start, to the field's approaches.
  await page.getByTestId("procedures-back").click();
  await expect(page.getByRole("heading", { name: "KDLH approaches" })).toBeVisible();
  await expect(page.getByTestId("procedures-back")).toHaveCount(0);
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
  await expect(chip).toHaveAccessibleName(/ILS RWY 09 via DLH/);
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
  await expect(ils).toContainText("In the route, via DLH");
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
  await page.goto("/app/plan?dep=C81&dest=KDLH&pattern=KDLH:27,C81:NONE");
  await settle(page);
  await openTab(page, "Nav Log");
  const procedures = page.getByTestId("procedures");
  const kdlh = procedures.getByRole("region", { name: "KDLH · Arrive" });
  await expect(kdlh.getByRole("radio", { name: /^Runway 27/ })).toHaveAttribute("aria-checked", "true", { timeout: slow(20000) });
  await expect(page.locator("path.traffic-pattern")).toHaveCount(1, { timeout: slow(10000) });
  // The ILS to 9 added from its pull-down, from DLH: the runway is 9,
  // landed straight in, and no pattern drawn.
  await kdlh.locator('[data-testid=procedure-kind][data-kind=approach]').click();
  const menu = page.getByTestId("procedure-menu");
  await expect(menu.getByText("Runway 9", { exact: false })).toBeVisible({ timeout: slow(10000) });
  await menu.getByTestId("procedure-menu-item").filter({ hasText: "ILS" }).click();
  // Its transitions in the menu's own place, on the screen: side by side,
  // a phone's ran off its edge (the owner's screenshot).
  await expect(menu.getByTestId("procedure-menu-back")).toBeVisible();
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
  // Said in the field's info, by its name.
  await kdlh.getByTestId("field-info").click();
  await expect(page.getByTestId("procedure-landing")).toHaveText("Straight in");
  await page.keyboard.press("Escape");
  await expect(page.locator("path.traffic-pattern")).toHaveCount(0);
  // Its plate has no circling line: no other runway, and none is no
  // choice either.
  await expect(kdlh.getByRole("radio", { name: /^Runway 27, no circling on the ILS 09/ })).toBeDisabled();
  await expect(kdlh.getByRole("radio", { name: /None/ })).toBeDisabled();

  // One that publishes circling minimums: 27 is a circle to land.
  circling = true;
  await page.goto(page.url());
  await settle(page);
  await openTab(page, "Nav Log");
  const circle = kdlh.getByRole("radio", { name: /^Runway 27/ });
  await expect(circle).toBeEnabled({ timeout: slow(20000) });
  await circle.click();
  await expect(page).toHaveURL(/[?&]pattern=[^&]*KDLH(%3A|:)27(%2C|,|&|$)/);
  await kdlh.getByTestId("field-info").click();
  await expect(page.getByTestId("procedure-landing")).toHaveText("Circle to land");
  await page.keyboard.press("Escape");
  await expect(page.locator("path.traffic-pattern")).toHaveCount(0);
});

/**
 * The field the route lands at has its runway into the wind picked as the
 * route comes in, at the owner's ask ("a preselected runway into the
 * wind"), and no approach; a pilot's None is kept, not picked over again.
 * By the field's own wind: with none, or calm, there is nothing to pick.
 */
test("the destination's runway into the wind is picked as the route comes in, and a pilot's none is kept", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = page.getByTestId("procedures").getByRole("region", { name: "KDLH · Arrive" });
  await expect(kdlh.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(20000) });
  const windward = kdlh.getByRole("radio", { name: /into the wind/ });
  test.skip(await windward.count() === 0, "Duluth's wind is calm or unreported now");
  await expect(windward).toHaveAttribute("aria-checked", "true");
  await expect(page).not.toHaveURL(/[?&]procs=/);
  await kdlh.getByRole("radio", { name: /None/ }).click();
  await expect(page).toHaveURL(/[?&]pattern=[^&]*KDLH(%3A|:)NONE(%2C|,|&|$)/);
  await page.goto(page.url());
  await settle(page);
  await openTab(page, "Nav Log");
  await expect(kdlh.getByRole("radio", { name: /None/ })).toHaveAttribute("aria-checked", "true", { timeout: slow(20000) });
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
  const tops = await chips.evaluateAll(all => all.map(c => Math.round(c.getBoundingClientRect().top)));
  expect(tops.length).toBeGreaterThan(5);
  expect(new Set(tops).size).toBe(1);
  // The runway picked scrolled into sight.
  await expect(kord.getByRole("radio", { name: /^Runway 9L/ })).toBeInViewport();
});

test.describe("on the owner's phone's width, to a finger", () => {
  // A finger's 17-point words (pointer: coarse), on 393 points.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 695 } });

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
  expect((await box.boundingBox())!.height).toBeLessThanOrEqual(48);
});
});
