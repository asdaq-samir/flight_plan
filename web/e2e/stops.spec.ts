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

  // Add Stop, beside the aeroplane and the time: the airport picker.
  await sideDrawer(page).getByTestId("add-stop").click();
  await page.getByPlaceholder(/Search/).fill("KMSN");
  await page.getByRole("option", { name: /KMSN/ }).first().click();
  await expect(page).toHaveURL(/[?&]stops=KMSN(&|$)/);
  const stop = sideDrawer(page).getByTestId("stop");
  await expect(stop).toHaveCount(1);
  await expect(stop).toContainText("KMSN");

  // The nav log lands at it, at the field's elevation, and the fuel is
  // checked flight by flight.
  await sideDrawer(page).getByText("Nav Log", { exact: true }).click();
  const landing = sideDrawer(page).locator("tr", { hasText: "KMSN" });
  await expect(landing).toBeVisible({ timeout: slow(30000) });
  const fuel = sideDrawer(page).getByTestId("fuel-check");
  await expect(fuel).toContainText("C81 → KMSN", { timeout: slow(30000) });
  await expect(fuel).toContainText("KMSN → KDLH");

  // Lowered, the capsule names the route through it.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.getByTestId("capsule-title")).toHaveText("C81 → KMSN → KDLH");

  // Taken off again: the route as it was.
  await openPanel(page);
  await stop.getByRole("button", { name: "Remove the stop at KMSN" }).click();
  await expect(page).not.toHaveURL(/[?&]stops=/);
  await expect(sideDrawer(page).getByTestId("stop")).toHaveCount(0);
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

test("a stop may be a VFR waypoint, found in the picker after the airports and flown through", async ({ page }) => {
  // Nothing of the route through it is asked of the planner past its
  // course: its two hops' chart would be read on CI's runner.
  await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname) && url.searchParams.get("stops") === "VPBNG",
    route => route.abort());
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);

  await sideDrawer(page).getByTestId("add-stop").click();
  await page.getByPlaceholder("Search airports and waypoints").fill("VPBNG");
  const waypoint = page.getByRole("option", { name: /VPBNG · VFR waypoint/ });
  await expect(waypoint).toBeVisible({ timeout: slow(10000) });
  await waypoint.click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG(&|$)/);

  // On the map in the sectional's magenta, not as an airport's chip.
  await expect(page.locator(".leaflet-marker-icon", { hasText: "VPBNG" }).first()).toBeVisible({ timeout: slow(15000) });
});
