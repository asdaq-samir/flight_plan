import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow, openTab, openSettings, closeConsole, grabberTo } from "./helpers";

/**
 * A route that lands on the way, as Maps' Add Stop: a stop added in the
 * panel's second row goes into the address, the capsule names the route
 * through it, the nav log lands at it, and each flight between two
 * landings has its own fuel check. Took off again, the route is as it
 * was.
 *
 * C81 to KDLH through KMSN is the planner's own answer, recorded: its two
 * hops' chart has never been read on CI's runner, and reading it would
 * be minutes of a two-minute run. The route without the stop is the live
 * planner's, and so is the chart's edition, so the tiles still draw.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// A recorded route's course is asked for as soon as the route goes in
// (PlanWorkspace's setRoute), and a test that has what it came for can
// end with its live half still on the way: it is let go, not failed on.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function recordedStops(page: Page) {
  const course = JSON.parse(fixture("stops-course.json"));
  await page.route(url => url.pathname.endsWith("/course") && url.searchParams.get("stops") === "KMSN", async route => {
    const live = new URL(route.request().url());
    live.searchParams.delete("stops");
    const chart = await (await route.fetch({ url: live.toString() })).json();
    const { departure, destination, stops, distance_nm, bearing_deg, course_line } = course;
    await route.fulfill({ json: { ...chart, departure, destination, stops, distance_nm, bearing_deg, course_line } });
  });
  await page.route(url => url.pathname.endsWith("/checkpoints") && url.searchParams.get("stops") === "KMSN", route =>
    route.fulfill({ contentType: "application/json", body: fixture("stops-checkpoints.json") }));
  await page.route(url => url.pathname.endsWith("/navlog") && url.searchParams.get("stops") === "KMSN", route =>
    route.fulfill({ contentType: "application/x-ndjson", body: fixture("stops-navlog.ndjson") }));
}

test("a stop added in the panel lands the route there: the capsule, the nav log and a fuel check for each flight", async ({ page }) => {
  await recordedStops(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);

  // Typed at the arrow between the two, the airports that answer offered
  // under the box.
  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  await sideDrawer(page).getByTestId("route-type").fill("KMSN");
  await page.getByTestId("route-suggestions").getByRole("option", { name: /KMSN/ }).first().click();
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
  const stop = sideDrawer(page).getByTestId("stop");
  await expect(stop).toHaveCount(1);
  await expect(stop).toContainText("KMSN");

  // The nav log lands at it, at the field's elevation, and the fuel is
  // checked flight by flight.
  await openTab(page, "Nav Log");
  const landing = sideDrawer(page).locator("tr", { hasText: "KMSN" });
  await expect(landing).toBeVisible({ timeout: slow(30000) });
  const fuel = sideDrawer(page).getByTestId("fuel-check");
  await expect(fuel).toContainText("C81 → KMSN", { timeout: slow(30000) });
  await expect(fuel).toContainText("KMSN → KDLH");

  // Lowered, the capsule names the route through it.
  await grabberTo(page, "peek");
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KMSN → KDLH");

  // Taken off again from its menu -- a right-click with a mouse, a press
  // and hold on a phone: the route as it was.
  await openPanel(page);
  await stop.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]stops=/);
  await expect(sideDrawer(page).getByTestId("stop")).toHaveCount(0);
});

test("the route's box reads its points with an arrow between each two, a tap on one a stop typed there, what is typed after the last the new destination with the old a stop; any point comes out from a hold, a right-click or Delete", async ({ page }) => {
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname), route => route.abort());
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KRYV,KMSN");
  await settle(page);
  await openPanel(page);
  const lines = sideDrawer(page).getByTestId("route-slide");
  // In that order, and no cross on any pill.
  const order = await lines.evaluate(el => [...el.querySelectorAll("[role=group], [data-testid=route-type], [data-testid=route-arrow]")]
    .map(n => n.getAttribute("data-testid") ?? ""));
  expect(order).toEqual(["route-dep", "route-arrow", "stop", "route-arrow", "stop", "route-arrow", "route-dest", "route-type"]);
  expect(await lines.getByRole("button", { name: /^Remove/ }).count()).toBe(0);

  // What is typed after the last point is the new destination, the old
  // one a stop on the way.
  const field = sideDrawer(page).getByTestId("route-type");
  await field.fill("KMSP");
  await field.press("Enter");
  await expect(page).toHaveURL(/[?&]dest=KMSP(&|$)/);
  await expect(page).toHaveURL(/[?&]stops=KRYV%2CKMSN%2CKDLH(&|$)|[?&]stops=KRYV,KMSN,KDLH(&|$)/);
  // Taken back out: the route as it was but for the new destination.
  await lines.getByRole("group", { name: "Stop 3 KDLH" }).focus();
  await page.keyboard.press("Delete");
  await expect(page).toHaveURL(/[?&]stops=KRYV%2CKMSN(&|$)|[?&]stops=KRYV,KMSN(&|$)/);

  // A finger held on a pill: its menu.
  const kmsn = lines.getByRole("group", { name: "Stop 2 KMSN" });
  const box = (await kmsn.boundingBox())!;
  const at = { clientX: box.x + 12, clientY: box.y + box.height / 2, pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true };
  await kmsn.dispatchEvent("pointerdown", at);
  // Its menu after the hold (the page under it is then hidden from a
  // reader, the pill with it, so the finger is not lifted here).
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(page).toHaveURL(/[?&]stops=KRYV(&|$)/);

  // The departure taken out with a right-click: the next airport along is
  // the departure.
  await lines.getByRole("group", { name: "Departure C81" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(page).toHaveURL(/[?&]dep=KRYV(&|$)/);
  await expect(page).not.toHaveURL(/[?&]stops=/);

  // Of two, Delete on the destination: half a route, the departure kept,
  // the destination still to be typed.
  await lines.getByRole("group", { name: "Destination KMSP" }).focus();
  await page.keyboard.press("Delete");
  await expect(page).not.toHaveURL(/[?&]dest=/);
  await expect(page).toHaveURL(/[?&]dep=KRYV(&|$)/);
  await expect(sideDrawer(page).getByTestId("route-type")).toHaveAttribute("placeholder", "Destination");
  // And the last: no route, the search back.
  await lines.getByRole("group", { name: "Departure KRYV" }).focus();
  await page.keyboard.press("Delete");
  await expect(page).not.toHaveURL(/[?&]dep=/);
  await expect(page.getByTestId("search-airports")).toBeVisible();
});

// A finger, as Chromium takes one from a touch screen: put down on one
// pill and held, then moved in steps onto another, held over it a moment
// and let go. Both measured first, once the box has settled from the last
// change: a menu out hides the page from the role queries.
async function touchHold(page: Page, from: Locator, to: Locator) {
  const middle = async (pill: Locator) => {
    // The box the poll found, not a second measure after it: the pill
    // drawn again between the two (the address just changed) measured
    // null the second time, now and then. And the same twice a tenth of
    // a second apart: the course coming in restyles the pills -- their
    // airspace's colour and width -- and a drag measured before it was
    // let go beside its target (CI, 2026-10-07).
    type Box = { x: number; y: number; width: number; height: number };
    let box: Box | null = null;
    let last: Box | null = null;
    await expect.poll(async () => {
      box = await pill.boundingBox();
      const still = !!box && !!last && box.x === last.x && box.y === last.y && box.width === last.width;
      last = box;
      return still;
    }, { intervals: [100] }).toBe(true);
    const { x, y, width, height } = box!;
    return { x: x + width / 2, y: y + height / 2 };
  };
  const [start, end] = [await middle(from), await middle(to)];
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, p?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ ...p, id: 1 }] : [] });
  await touch("touchStart", start);
  return async function moveOn() {
    // A frame apart, as a finger's moves come.
    for (let i = 1; i <= 20; i++) {
      await touch("touchMove", { x: start.x + (end.x - start.x) * i / 20, y: start.y + (end.y - start.y) * i / 20 });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
    await touch("touchEnd");
  };
}

// Held past the drag's quarter second and well short of the menu's half,
// a slow runner's lag included.
async function touchDrag(page: Page, from: Locator, to: Locator) {
  const moveOn = await touchHold(page, from, to);
  await page.waitForTimeout(320);
  await moveOn();
}

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("any point dragged anywhere, the ends too: before the departure it is the departure, after the destination the destination; held, its menu, which a move puts away for the drag", async ({ page }) => {
    await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname), route => route.abort());
    await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KRYV,KMSN");
    await settle(page);
    await openPanel(page);
    const lines = sideDrawer(page).getByTestId("route-slide");
    const stopsAre = (list: string) => new RegExp(`[?&]stops=(${list.replace(",", "%2C")}|${list})(&|$)`);

    await touchDrag(page, lines.getByTestId("route-dest"), lines.getByTestId("route-dep"));
    await expect(page).toHaveURL(/[?&]dep=KDLH(&|$)/);
    await expect(page).toHaveURL(/[?&]dest=KMSN(&|$)/);
    await expect(page).toHaveURL(stopsAre("C81,KRYV"));

    await touchDrag(page, lines.getByTestId("route-dep"), lines.getByTestId("route-dest"));
    await expect(page).toHaveURL(/[?&]dep=C81(&|$)/);
    await expect(page).toHaveURL(/[?&]dest=KDLH(&|$)/);
    await expect(page).toHaveURL(stopsAre("KRYV,KMSN"));

    // Held past the menu's half second, then moved: the menu goes, and the
    // stop goes where it was taken.
    const menu = page.getByRole("menuitem", { name: "Remove", exact: true });
    const moveOn = await touchHold(page, lines.getByRole("group", { name: "Stop 1 KRYV" }), lines.getByRole("group", { name: "Stop 2 KMSN" }));
    await expect(menu).toBeVisible();
    await moveOn();
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(stopsAre("KMSN,KRYV"));
  });
});

// The route cleared, its box asks for the route, at the pilot's ask: the
// first airport typed is the departure, and then it asks for the
// destination.
test("a cleared route's box takes the departure first, then asks for the destination", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  // Taken after the destination, the field has an arrow on from it: what
  // is typed there is the new destination.
  await expect(sideDrawer(page).getByTestId("route-arrow-on")).toHaveCount(0);
  await sideDrawer(page).getByTestId("route-type").click();
  await expect(sideDrawer(page).getByTestId("route-arrow-on")).toBeVisible();
  await sideDrawer(page).getByTestId("route-clear").click();
  await expect(page).not.toHaveURL(/[?&]dep=/);
  const field = sideDrawer(page).getByTestId("route-type");
  await expect(field).toHaveAttribute("placeholder", "Route");
  await field.fill("KMSN");
  await field.press("Enter");
  await expect(page).toHaveURL(/[?&]dep=KMSN(&|$)/);
  await expect(page).not.toHaveURL(/[?&]dest=/);
  await expect(field).toHaveAttribute("placeholder", "Destination");
});

test("a link with a stop opens on the route through it", async ({ page }) => {
  await recordedStops(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KMSN");
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KMSN → KDLH", { timeout: slow(15000) });
  // Its airport on the map, as the route's two ends are.
  await expect(page.locator(".leaflet-marker-icon", { hasText: "KMSN" }).first()).toBeVisible({ timeout: slow(15000) });
});

test("a flight saved with a stop is filed with it and the altitude set there, and its nav log lands there", async ({ page }) => {
  await recordedStops(page);
  const filed: { stops?: string[]; altitudes?: string | null; checkpoints: { category: string; name: string }[] }[] = [];
  await page.route("**/api/me", route => route.fulfill({
    json: { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false },
  }));
  await page.route("**/api/aircraft", route => route.fulfill({ json: [] }));
  await page.route("**/api/flights", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    filed.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { id: 1 } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KMSN&altitudes=KMSN:2400&view=briefing");
  const save = page.getByRole("button", { name: "Save this flight" });
  await expect(save).toBeEnabled({ timeout: slow(30000) });
  await save.click();

  await expect.poll(() => filed.length).toBe(1);
  expect(filed[0]!.stops).toEqual(["KMSN"]);
  // With the altitude the pilot set there, to be planned at again.
  expect(filed[0]!.altitudes).toBe("KMSN:2400");
  expect(filed[0]!.checkpoints.filter(c => c.category === "stop").map(c => c.name)).toEqual(["KMSN"]);
});

test("the route's box is round and two lines tall beside its close and its Procedures stacked, Add stop after its destination, with no plus beside it, and Enter takes the first airport offered for what is typed", async ({ page }) => {
  await recordedStops(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const box = sideDrawer(page).getByTestId("route-box");
  await expect(box).toBeVisible();
  expect(await sideDrawer(page).getByTestId("add-stop").count()).toBe(0);
  // Round as the search bar's field is, two lines tall, the route's close
  // and its Procedures stacked beside it, the close on its first line.
  const shape = await box.evaluate(el => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), height: el.getBoundingClientRect().height }));
  expect(shape.radius).toBeGreaterThanOrEqual(20);
  expect(shape.height).toBeGreaterThanOrEqual(80);
  const close = (await sideDrawer(page).getByTestId("route-clear").boundingBox())!;
  const procedures = (await sideDrawer(page).getByTestId("route-approaches").boundingBox())!;
  expect(Math.abs(close.x - procedures.x)).toBeLessThanOrEqual(1);
  expect(procedures.y).toBeGreaterThan(close.y + close.height);
  await expect(sideDrawer(page).getByTestId("route-type")).toHaveAttribute("placeholder", "Add stop");

  // A town's name at the arrow: its field offered first, and Enter takes
  // it, as a stop.
  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  const field = sideDrawer(page).getByTestId("route-type");
  // A stop's rows come from the airports' copy at once and the planner's
  // answer (with the waypoints) a debounce and a request later; Enter
  // before it keeps what was typed (useAirportSearch `answered`), so on a
  // slow CI stack the first row showing was not yet the one Enter takes.
  const answer = page.waitForResponse(r => /\/airports\/search\?/i.test(r.url()) && /madison/i.test(r.url()), { timeout: slow(15000) });
  await field.fill("madison");
  const first = page.getByTestId("route-suggestions").getByRole("option").first();
  await expect(first).toContainText("KMSN", { timeout: slow(10000) });
  await answer;
  await page.waitForTimeout(300);
  await field.press("Enter");
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
  await expect(page).toHaveURL(/[?&]dest=KDLH(&|$)/);
});

test("a town's name typed with the airports shown takes the first of them at Enter, before the planner's waypoints answer", async ({ page }) => {
  // The planner's search held back: what is shown is the airports' copy
  // alone (lib/airportIndex). "madison" is no point's ident, so Enter
  // takes the first airport shown -- it was put in as typed, which is
  // nothing, and the box emptied (a CI run, 2026-10-10).
  await recordedStops(page);
  await page.route(url => url.pathname.includes("/airports/search"), () => new Promise(() => undefined));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  const field = sideDrawer(page).getByTestId("route-type");
  await field.fill("madison");
  await expect(page.getByTestId("route-suggestions").getByRole("option").first()).toContainText("KMSN", { timeout: slow(10000) });
  await field.press("Enter");
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
});

test("a short town's name (four letters) takes the first airport shown at Enter, as a long one does", async ({ page }) => {
  // "reno" is two to five letters and digits, which stopOf takes for an
  // ident; it is no row's ident, so Enter takes the first row all the same.
  await recordedStops(page);
  await page.route(url => url.pathname.includes("/airports/search"), () => new Promise(() => undefined));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  const field = sideDrawer(page).getByTestId("route-type");
  await field.fill("reno");
  const first = page.getByTestId("route-suggestions").getByRole("option").first();
  await expect(first).toBeVisible({ timeout: slow(10000) });
  const ident = (await first.innerText()).match(/\b[A-Z0-9]{3,4}\b/)?.[0];
  await field.press("Enter");
  await expect(page).toHaveURL(new RegExp(`[?&]stops=${ident}(&|$)`));
});

test("a long route's box wraps its points onto two lines and scrolls down to the rest, never sideways", async ({ page }) => {
  // Nothing past the course asked of the planner: the box is the claim.
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname), route => route.abort());
  // The most stops a route takes (MAX_STOPS): ten points.
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KRYV,KMSN,KEAU,KOSH,KCWA,KSTE,KATW,KGRB");
  await settle(page);
  await openPanel(page);
  const lines = sideDrawer(page).getByTestId("route-slide");
  await expect(lines.locator("[role=group]")).toHaveCount(10);
  const box = await lines.evaluate(el => ({
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
    tops: [...new Set([...el.querySelectorAll("[role=group]")].map(g => Math.round(g.getBoundingClientRect().top)))].length,
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  expect(box.tops).toBeGreaterThanOrEqual(3);
  // Two lines in sight and the top of a third, the rest a scroll down: the
  // destination not whole in sight until then.
  expect(box.clientHeight).toBeLessThanOrEqual(100);
  expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
  const destination = sideDrawer(page).getByTestId("route-dest");
  await expect(destination).not.toBeInViewport({ ratio: 1 });
  await lines.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(destination).toBeInViewport({ ratio: 1 });

  // A pill dragged from the first line onto the second: the route flown in
  // the new order (a reorder that broke would fly it in the wrong one).
  await lines.evaluate(el => el.scrollTo(0, 0));
  const from = (await lines.getByRole("group", { name: "Stop 1 KRYV" }).boundingBox())!;
  const to = (await lines.getByRole("group", { name: "Stop 6 KSTE" }).boundingBox())!;
  expect(to.y).toBeGreaterThan(from.y + from.height / 2);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  // Held there a moment, as a finger is, for the pills to make room.
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(page).toHaveURL(/[?&]stops=KMSN%2CKEAU%2CKOSH%2CKCWA%2CKSTE%2CKRYV%2CKATW%2CKGRB(&|$)|[?&]stops=KMSN,KEAU,KOSH,KCWA,KSTE,KRYV,KATW,KGRB(&|$)/);
});

test("a stop may be a VFR waypoint, offered after the airports as it is typed and flown through", async ({ page }) => {
  // Nothing of the route through it is asked of the planner past its
  // course: its two hops' chart would be read on CI's runner.
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname) && url.searchParams.get("stops") === "VPBNG",
    route => route.abort());
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);

  await sideDrawer(page).getByRole("button", { name: "Type a stop between C81 and KDLH" }).click();
  await sideDrawer(page).getByTestId("route-type").fill("VPBNG");
  const waypoint = page.getByTestId("route-suggestions").getByRole("option", { name: /VPBNG · VFR waypoint/ });
  await expect(waypoint).toBeVisible({ timeout: slow(10000) });
  await waypoint.click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG(&|$)/);

  // On the map in the sectional's magenta, not as an airport's chip.
  await expect(page.locator(".leaflet-marker-icon", { hasText: "VPBNG" }).first()).toBeVisible({ timeout: slow(15000) });
});

test("a point's menu has its altitude before Remove: an airport's pattern in feet, a waypoint's cruise as a flight level, each the pilot's to set and give back", async ({ page }) => {
  // The route through the waypoint asks no more of the planner than its
  // course: its two hops' chart would be read on CI's runner.
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname) && url.searchParams.get("stops") === "VPBNG",
    route => route.abort());
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=VPBNG");
  await settle(page);
  await openPanel(page);
  const lines = sideDrawer(page).getByTestId("route-slide");
  const item = page.getByTestId("point-altitude");

  // Duluth's pattern, from the course: its field and the pattern over it.
  await lines.getByRole("group", { name: "Destination KDLH" }).click({ button: "right" });
  await expect(item).toContainText("Pattern altitude");
  await expect(item).toContainText(/\d,\d00 ft/, { timeout: slow(15000) });
  await item.click();
  await page.getByTestId("point-altitude-input").fill("2600");
  await page.getByTestId("point-altitude-set").click();
  await expect(page).toHaveURL(/[?&]altitudes=KDLH%3A2600(&|$)|[?&]altitudes=KDLH:2600(&|$)/);

  // The waypoint's, a flight level over its dashes.
  await lines.getByRole("group", { name: /VPBNG/ }).click({ button: "right" });
  await expect(item).toContainText("Altitude");
  await item.click();
  await page.getByTestId("point-altitude-input").fill("055");
  await page.getByTestId("point-altitude-set").click();
  await expect(page).toHaveURL(/KDLH(%3A|:)2600(%2C|,)VPBNG(%3A|:)5500(&|$)/);
  await lines.getByRole("group", { name: /VPBNG/ }).click({ button: "right" });
  await expect(item).toContainText("FL055");
  await page.keyboard.press("Escape");

  // Given back to the plan: Duluth's own is gone from the address.
  await lines.getByRole("group", { name: "Destination KDLH" }).click({ button: "right" });
  await expect(item).toContainText("2,600 ft");
  await item.click();
  await page.getByTestId("point-altitude-reset").click();
  await expect(page).toHaveURL(/[?&]altitudes=VPBNG(%3A|:)5500(&|$)/);
  // And a point taken out takes its altitude with it.
  await lines.getByRole("group", { name: /VPBNG/ }).focus();
  await page.keyboard.press("Delete");
  await expect(page).not.toHaveURL(/[?&]altitudes=/);
});

// Add Stop, beside Fly Here, at the pilot's ask: the field the route's
// next stop, after the ones it makes and before its destination; none on
// a card of the route's own points; with no route, the first point of one.
test("an airport's card adds it as the route's next stop; a card of the route's own points has none", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KMSN&place=KMSN");
  await expect(page.getByTestId("place-card")).toBeVisible({ timeout: slow(30000) });
  await expect(page.getByTestId("fly-here")).toBeVisible();
  await expect(page.getByTestId("place-add-stop")).toHaveCount(0);

  await page.goto("/app/plan?dep=C81&stops=KJVL&dest=KMSN&place=KDLH");
  const add = page.getByTestId("place-add-stop");
  await expect(add).toBeVisible({ timeout: slow(30000) });
  await expect(add).toHaveText("Add Stop");
  await add.click();
  await expect(page).toHaveURL(/[?&]stops=KJVL(%2C|,)KDLH(&|$)/);
  await expect(page).toHaveURL(/[?&]dest=KMSN/);
  await expect(page).toHaveURL(/[?&]dep=C81/);
  await expect(page.getByTestId("place-card")).toHaveCount(0);

  await page.goto("/app/plan?place=KDLH");
  await page.getByTestId("place-add-stop").click();
  await expect(page).toHaveURL(/[?&]dep=KDLH/);
  await expect(page).not.toHaveURL(/[?&]dest=/);
  await expect(sideDrawer(page).getByTestId("route-type")).toHaveAttribute("placeholder", "Destination");
});

test("a VFR waypoint on the chart is a diamond, and its card adds it as a stop", async ({ page }) => {
  // The planner's own, through the webapp: Chicago's VFR waypoints.
  const answer = await page.request.get("/api/planner/waypoints/in-view?south=41.5&west=-88.5&north=42.5&east=-87.5");
  expect(answer.ok()).toBe(true);
  expect((await answer.json()).waypoints.map((w: { ident: string }) => w.ident)).toContain("VPBNG");

  // One waypoint, where it is: VPBNG, by Campbell. In close enough for
  // the diamonds -- the wheel over C81, a level at a time.
  await page.route(url => url.pathname.endsWith("/waypoints/in-view"), route =>
    route.fulfill({ json: { waypoints: [{ ident: "VPBNG", lat: 42.2673, lon: -88.1311, description: "3 nm SW of Campbell" }] } }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  const departure = page.locator(".leaflet-marker-icon", { hasText: "C81" }).first();
  await expect(departure).toBeVisible({ timeout: slow(30000) });
  const box = (await departure.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(400);
  }
  const diamond = page.locator(".leaflet-waypoints-pane .leaflet-marker-icon");
  await expect(diamond).toHaveCount(1, { timeout: slow(20000) });
  // Once the map has stopped: a tap as the zoom eases in landed where the
  // diamond had been.
  let was = "";
  await expect(async () => {
    const now = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".leaflet-map-pane, .leaflet-tile-container, .leaflet-waypoints-pane .leaflet-marker-icon")]
      .map(el => el.style.transform).join("|"));
    const still = now === was;
    was = now;
    await page.waitForTimeout(300);
    expect(still).toBe(true);
  }).toPass({ timeout: slow(10_000) });
  // Tapped again until its card is up: on CI's runner the plan's stream
  // finishing could move the map under the first tap (its card never
  // came, now and then, on the phone's shard).
  const add = page.getByTestId("waypoint-add-stop");
  await expect(async () => {
    await diamond.click({ timeout: 2000 });
    await expect(add).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: slow(15000) });
  // What it is beside its ident, where it is on a line of its own.
  const popup = page.locator(".leaflet-popup");
  await expect(popup.getByText("VFR waypoint", { exact: true })).toBeVisible();
  await expect(popup.getByText("3 nm SW of Campbell", { exact: true })).toBeVisible();
  // And the map holds still under the open card, once it has panned it
  // into sight: it crept a point a second as the card was drawn again.
  await page.waitForTimeout(1000);
  const pane = () => page.evaluate(() => document.querySelector<HTMLElement>(".leaflet-map-pane")!.style.transform);
  const before = await pane();
  await page.waitForTimeout(2000);
  expect(await pane()).toBe(before);
  await add.click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG/);
});

test("the route's airports are coloured by their airspace, or by the weather from the settings", async ({ page }) => {
  await page.route(url => /\/(checkpoints|navlog)$/.test(url.pathname), route => route.abort());
  const background = () => sideDrawer(page).getByRole("group", { name: "Destination KDLH" }).evaluate(el => getComputedStyle(el).backgroundColor);
  // Duluth's Class D: a wash of the sectional's blue, inside a dashed line.
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect.poll(background, { timeout: slow(15000) }).toBe("rgba(36, 101, 184, 0.12)");

  // By the weather instead: its METAR's colour, or the grey of none.
  await page.goto("/app/plan");
  await openSettings(page);
  await page.getByTestId("route-colours-select").getByRole("radio", { name: "Weather" }).click();
  await closeConsole(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect.poll(background, { timeout: slow(15000) }).toMatch(/^rgb\(/);
});
