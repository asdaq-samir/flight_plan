import { test, expect, type Page } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * FPL's Routes, at the owner's ask ("smart to reroute for fastest time
 * along safe weather, over terrain, best tailwinds, refueling and giving
 * pilot flexibility to make changes as they please", 2026-10-23; picks:
 * 2-3 options, keep the pilot's edits and flag what they meet): what the
 * route meets, the ways round it with their time, stops and miles, and a
 * tap putting one in the route, its fuel stops named as such.
 *
 * The ways are the planner's (vfr.route_options, tested there); here
 * /api/route-options is answered, so the page is tried without the day's
 * weather.
 */

const WAYS = {
  options: [
    { kind: "fastest", kinds: ["fastest", "stops"], title: "Fastest", stops: ["DLH/180/40.0"], fuel: [],
      path: [[42.23, -88.0], [46.0, -92.2], [46.84, -92.19]], distance_nm: 352.4, air_min: 181, ground_min: 0,
      fuel_gal: 25.6, landings: 0, crosses: [], marginal: [], bands: [{ kind: "vfr", min: 181 }], tail_kt: 12, floor_ft: 2200 },
    { kind: "weather", kinds: ["weather"], title: "Best weather", stops: ["KEAU"], fuel: ["KEAU"],
      path: [[42.23, -88.0], [44.87, -91.48], [46.84, -92.19]], distance_nm: 371.2, air_min: 190, ground_min: 30,
      fuel_gal: 27.0, landings: 1, crosses: [], marginal: [1],
      bands: [{ kind: "vfr", min: 90 }, { kind: "mvfr", min: 40 }, { kind: "vfr", min: 60 }], tail_kt: 4, floor_ft: 2400 },
  ],
  own: null,
  direct: [0], ends: [], current: [], current_marginal: [],
  current_along: { bands: [{ kind: "vfr", min: 60 }, { kind: "storm", min: 30 }, { kind: "vfr", min: 82 }], tail_kt: 6, floor_ft: 2100 },
  hazards: [
    { kind: "storm", name: "Thunderstorms forecast at KCWA" },
    { kind: "marginal", name: "KRHI forecast marginal (ceiling 2,500 ft)" },
  ],
  unchecked: [],
};

async function ways(page: Page) {
  await page.route(url => url.pathname.endsWith("/route-options"), route => route.fulfill({ json: WAYS }));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("FPL's Routes say what the route meets and put a way round it in the route, its fuel stop named", async ({ page }) => {
  await ways(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  // A route in the address was picked before (a saved flight, a link):
  // planned at once, its Routes a tap away in the route box.
  await expect(sideDrawer(page).getByTestId("route-choices")).toHaveCount(0);
  await sideDrawer(page).getByTestId("route-routes").click();
  const current = sideDrawer(page).getByTestId("route-choice-current");
  await expect(current).toContainText("Your Route · Crosses storms", { timeout: slow(30_000) });

  // Each card its time, its arrival and miles, and its name.
  const fastest = sideDrawer(page).getByTestId("route-choice-fastest");
  // Its time on the route's own clock (gridScale), so not the stub's to the minute.
  await expect(fastest).toContainText(/\d+ h \d+ min/);
  await expect(fastest).toContainText("352 nm");
  // Its name alone: the planner's fewest-stops way is not one of the four.
  await expect(fastest).toContainText("Fastest");
  await expect(fastest).not.toContainText("Fewest");
  const best = sideDrawer(page).getByTestId("route-choice-weather");
  await expect(best).toContainText(/\d+ h \d+ min/);
  await expect(best).toContainText("371 nm");
  await expect(best).toContainText("371 nm · 1 fuel stop");
  await expect(best).toContainText("Best Weather");
  // The route's own weather as a strip, its storm said to a screen reader.
  await expect(current.getByRole("img")).toHaveAttribute("aria-label", /thunderstorms/);

  // Both on the chart beside the route, each its callout.
  const chips = page.locator("[data-route-way]");
  await expect(chips).toHaveCount(2);
  // A way's callout tapped puts it in FPL as its card comes into sight --
  // the route box and the course line its own -- the other still beside it.
  // Nothing planned while the routes are browsed (the owner's "Don't
  // plan anything unless a route is picked", 2026-10-24).
  const planned: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/navlog")) planned.push(new URL(request.url()).searchParams.get("stops") ?? "");
  });
  // By its way, not its place in the pane: the one shown is drawn again
  // with its name, and goes to the end.
  await page.locator('[data-route-way="weather"]').click();
  await expect(page).toHaveURL(/[?&]stops=KEAU(&|$)/);
  await expect(page).toHaveURL(/[?&]fuel=KEAU(&|$)/);
  await expect(chips).toHaveCount(1);
  await page.waitForTimeout(1_000);
  expect(planned.filter(stops => stops.includes("KEAU"))).toEqual([]);
  // Use keeps a way: it is the route, the cards put away and it planned.
  await sideDrawer(page).getByTestId("route-choice-weather-use").click();
  await expect(page).toHaveURL(/[?&]stops=KEAU(&|$)/);
  await expect(sideDrawer(page).getByTestId("route-choices")).toHaveCount(0);
  await expect.poll(() => planned.some(stops => stops.includes("KEAU")), { timeout: slow(15_000) }).toBe(true);

});
