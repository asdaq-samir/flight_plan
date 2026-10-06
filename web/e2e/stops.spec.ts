import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

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

  // Typed into the route's box, the airports that answer offered under it.
  await sideDrawer(page).getByTestId("route-type").fill("KMSN");
  await page.getByTestId("route-suggestions").getByRole("option", { name: /KMSN/ }).first().click();
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
  const stop = sideDrawer(page).getByTestId("stop");
  await expect(stop).toHaveCount(1);
  await expect(stop).toContainText("KMSN");

  // The nav log lands at it, at the field's elevation, and the fuel is
  // checked flight by flight.
  await sideDrawer(page).getByRole("button", { name: "Nav Log", exact: true }).click();
  const landing = sideDrawer(page).locator("tr", { hasText: "KMSN" });
  await expect(landing).toBeVisible({ timeout: slow(30000) });
  const fuel = sideDrawer(page).getByTestId("fuel-check");
  await expect(fuel).toContainText("C81 → KMSN", { timeout: slow(30000) });
  await expect(fuel).toContainText("KMSN → KDLH");

  // Lowered, the capsule names the route through it.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KMSN → KDLH");

  // Taken off again from its menu -- a right-click with a mouse, a press
  // and hold on a phone: the route as it was.
  await openPanel(page);
  await stop.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove the stop at KMSN" }).click();
  await expect(page).not.toHaveURL(/[?&]stops=/);
  await expect(sideDrawer(page).getByTestId("stop")).toHaveCount(0);
});

test("the route's box reads departure, stops, the field to add one, an arrow, then the destination; a point comes out from a hold, a right-click or Delete", async ({ page }) => {
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname), route => route.abort());
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KRYV,KMSN");
  await settle(page);
  await openPanel(page);
  const lines = sideDrawer(page).getByTestId("route-slide");
  // In that order, and no cross on any pill.
  const order = await lines.evaluate(el => [...el.querySelectorAll("[role=group], [data-testid=route-type], [data-testid=route-arrow]")]
    .map(n => n.getAttribute("data-testid") ?? ""));
  expect(order).toEqual(["route-dep", "stop", "stop", "route-type", "route-arrow", "route-dest"]);
  expect(await lines.getByRole("button", { name: /^Remove/ }).count()).toBe(0);

  // A finger held on a pill: its menu.
  const kmsn = lines.getByRole("group", { name: "Stop 2 KMSN" });
  const box = (await kmsn.boundingBox())!;
  const at = { clientX: box.x + 12, clientY: box.y + box.height / 2, pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true };
  await kmsn.dispatchEvent("pointerdown", at);
  // Its menu after the hold (the page under it is then hidden from a
  // reader, the pill with it, so the finger is not lifted here).
  await page.getByRole("menuitem", { name: "Remove the stop at KMSN" }).click();
  await expect(page).toHaveURL(/[?&]stops=KRYV(&|$)/);

  // Delete on a focused pill, from the keyboard.
  await lines.getByRole("group", { name: "Stop 1 KRYV" }).focus();
  await page.keyboard.press("Delete");
  await expect(page).not.toHaveURL(/[?&]stops=/);
  // Two points left: the ends stay.
  await lines.getByRole("group", { name: "Destination KDLH" }).focus();
  await page.keyboard.press("Delete");
  await expect(lines.getByRole("group")).toHaveCount(2);
});

test("a link with a stop opens on the route through it", async ({ page }) => {
  await recordedStops(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KMSN");
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KMSN → KDLH", { timeout: slow(15000) });
  // Its airport on the map, as the route's two ends are.
  await expect(page.locator(".leaflet-marker-icon", { hasText: "KMSN" }).first()).toBeVisible({ timeout: slow(15000) });
});

test("a flight saved with a stop is filed with it, and its nav log lands there", async ({ page }) => {
  await recordedStops(page);
  const filed: { stops?: string[]; checkpoints: { category: string; name: string }[] }[] = [];
  await page.route("**/api/me", route => route.fulfill({
    json: { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false },
  }));
  await page.route("**/api/aircraft", route => route.fulfill({ json: [] }));
  await page.route("**/api/flights", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    filed.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { id: 1 } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&stops=KMSN&view=briefing");
  const save = page.getByRole("button", { name: "Save this flight" });
  await expect(save).toBeEnabled({ timeout: slow(30000) });
  await save.click();

  await expect.poll(() => filed.length).toBe(1);
  expect(filed[0]!.stops).toEqual(["KMSN"]);
  expect(filed[0]!.checkpoints.filter(c => c.category === "stop").map(c => c.name)).toEqual(["KMSN"]);
});

test("the route's box is round at its ends with no plus beside it, and Enter takes the first airport offered for what is typed", async ({ page }) => {
  await recordedStops(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const box = sideDrawer(page).getByTestId("route-box");
  await expect(box).toBeVisible();
  expect(await sideDrawer(page).getByTestId("add-stop").count()).toBe(0);
  const shape = await box.evaluate(el => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), height: el.getBoundingClientRect().height }));
  expect(shape.radius).toBeGreaterThanOrEqual(shape.height / 2 - 1);

  // A town's name: its field offered first, and Enter takes it.
  const field = sideDrawer(page).getByTestId("route-type");
  await field.fill("madison");
  const first = page.getByTestId("route-suggestions").getByRole("option").first();
  await expect(first).toContainText("KMSN", { timeout: slow(10000) });
  await field.press("Enter");
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
  await expect(field).toHaveValue("");
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
  await page.mouse.move(from.x + 8, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
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

  await sideDrawer(page).getByTestId("route-type").fill("VPBNG");
  const waypoint = page.getByTestId("route-suggestions").getByRole("option", { name: /VPBNG · VFR waypoint/ });
  await expect(waypoint).toBeVisible({ timeout: slow(10000) });
  await waypoint.click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG(&|$)/);

  // On the map in the sectional's magenta, not as an airport's chip.
  await expect(page.locator(".leaflet-marker-icon", { hasText: "VPBNG" }).first()).toBeVisible({ timeout: slow(15000) });
});

test("an airport's card adds it as a stop, where it bends the route least; the route's own airports have no Add Stop", async ({ page }) => {
  await recordedStops(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await expect(page.getByTestId("place-card")).toBeVisible({ timeout: slow(30000) });
  await expect(page.getByTestId("fly-here")).toBeVisible();
  await expect(page.getByTestId("place-add-stop")).toHaveCount(0);

  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KMSN");
  const add = page.getByTestId("place-add-stop");
  await expect(add).toBeVisible({ timeout: slow(30000) });
  const drawn = page.waitForResponse(r => r.url().includes("/course") && r.url().includes("stops=KMSN"));
  await add.click();
  await expect(page).toHaveURL(/[?&]stops=KMSN/);
  await expect(page.getByTestId("place-card")).toHaveCount(0);
  // The route through it, once it is drawn: in the capsule at rest, or
  // the panel's stops.
  await drawn;
  await expect(page.getByTestId("capsule-title").or(sideDrawer(page).getByTestId("stop")).first())
    .toContainText("KMSN", { timeout: slow(30000) });
});

test("a VFR waypoint on the chart is a diamond, and its card adds it as a stop", async ({ page }) => {
  // The planner's own, through the webapp: Chicago's VFR waypoints.
  const answer = await page.request.get("/api/planner/waypoints/in-view?south=41.5&west=-88.5&north=42.5&east=-87.5");
  expect(answer.ok()).toBe(true);
  expect((await answer.json()).waypoints.map((w: { ident: string }) => w.ident)).toContain("VPBNG");

  // One waypoint, where it is: VPBNG, by Campbell. In close enough for
  // the diamonds -- the wheel over C81, a level at a time.
  await page.route(url => url.pathname.endsWith("/waypoints/in-view"), route =>
    route.fulfill({ json: { waypoints: [{ ident: "VPBNG", lat: 42.2673, lon: -88.1311 }] } }));
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
  await diamond.click();
  const add = page.getByTestId("waypoint-add-stop");
  await expect(add).toBeVisible();
  await add.click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG/);
});
