import { test, expect } from "@playwright/test";
import { openMapSettings, openSection, openTab, settle, sideDrawer, slow } from "./helpers";

/**
 * Each hazard in the Brief says which legs of the route it is on and when
 * the airplane is there against the hazard's own valid time -- the
 * planner's `on_route` (app.exposure) -- and a tap shows those legs on
 * the map, a second puts them away. And the map's settings say how old
 * its weather layers' data is.
 */
test("a SIGMET says its legs and times, and a tap shows the legs on the map", async ({ page }) => {
  const now = Date.now();
  const iso = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch();
    const json = await response.json();
    // Three fixes at least, from the planner's own answer: the route's.
    const fixes = json.leg_fixes.length >= 3 ? json.leg_fixes : [json.leg_fixes[0], json.leg_fixes[0], ...json.leg_fixes.slice(1)];
    Object.assign(json, {
      leg_fixes: fixes,
      gairmets: [], vfr_not_recommended: [], fields_below_vfr: [],
      hazards: [{
        hazard: "CONVECTIVE", type: "SIGMET", altitude_low_ft: null, altitude_high_ft: 43000, raw: "CONVECTIVE SIGMET 45C",
        on_route: { legs: [0, 1], from_nm: 20, to_nm: 60, enter: iso(20), leave: iso(45), valid_from: iso(-10), valid_to: iso(60),
          when: "during", source: "Convective SIGMET", issued: iso(-15) },
      }],
    });
    await route.fulfill({ response, json });
  });

  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Weather");
  await openSection(page, "Adverse Conditions");
  const row = sideDrawer(page).getByTestId("on-route").first();
  await expect(row).toHaveText(/^Legs 1–2 · \d\d:\d\d–\d\d:\d\d, valid till \d\d:\d\d$/, { timeout: slow(90000) });

  const highlight = page.locator('.leaflet-overlay-pane path[stroke="#ff9500"]');
  await expect(highlight).toHaveCount(0);
  await row.click();
  await expect(highlight).toHaveCount(1);
  await expect(row).toHaveAttribute("data-shown", "true");
  await row.click();
  await expect(highlight).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the map's settings say when the METARs and TFRs were fetched", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/map/ages"), route => route.fulfill({ json: {
    metars_at: new Date(Date.now() - 4 * 60_000).toISOString(), tfrs_at: null,
  } }));
  await page.goto("/app/plan");
  await settle(page);
  await openMapSettings(page);
  await expect(page.getByTestId("metars-age")).toContainText("aviationweather.gov · 4 min ago");
  // Not fetched yet: the source alone, no age made up.
  await expect(page.getByTestId("tfrs-age")).toHaveText(/TFR data\s*tfr\.faa\.gov$/);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
