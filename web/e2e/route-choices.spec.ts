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
  const current = sideDrawer(page).getByTestId("route-choice-current");
  await expect(current).toContainText("Crosses thunderstorms forecast at KCWA", { timeout: slow(30_000) });

  const fastest = sideDrawer(page).getByTestId("route-choice-fastest");
  await expect(fastest).toContainText("Fastest · Fewest Stops");
  await expect(fastest).toContainText("3 h 1 min");
  await expect(fastest).toContainText("No stops · 352 nm");
  await expect(fastest).toContainText("Round thunderstorms forecast at KCWA");
  const best = sideDrawer(page).getByTestId("route-choice-weather");
  await expect(best).toContainText("3 h 40 min");
  await expect(best).toContainText("1 fuel stop · 371 nm");
  // The route's own weather by the clock under the cards, its storm said.
  await expect(sideDrawer(page).getByTestId("route-weather-strip")).toContainText("thunderstorms");

  // Both on the chart beside the route, each its chip.
  const chips = page.locator("[data-route-way]");
  await expect(chips).toHaveCount(2);
  await expect(chips.filter({ hasText: "Best Weather · 3 h 40 min" })).toHaveCount(1);

  // What matters reorders them: Fewest Stops puts the one with none first.
  await sideDrawer(page).getByTestId("route-want-stops").click();
  await expect(sideDrawer(page).getByTestId("route-want-stops")).toHaveAttribute("aria-pressed", "true");

  // A card tapped shows that way; Use puts it in the route.
  await best.click();
  await expect(best).toHaveAttribute("aria-pressed", "true");
  await sideDrawer(page).getByTestId("route-choice-use").click();
  await expect(page).toHaveURL(/[?&]stops=KEAU(&|$)/);
  await expect(page).toHaveURL(/[?&]fuel=KEAU(&|$)/);
  // The one picked is the route now, the other still beside it.
  await expect(chips).toHaveCount(1);

  // The straight line one tap back.
  await sideDrawer(page).getByTestId("route-choice-direct").click();
  await expect(page).not.toHaveURL(/[?&]stops=/);
});
