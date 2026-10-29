import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow, openTab, openSection, panelTabs, openBrief, closeCard } from "./helpers";

/**
 * The planning panel's tabs, the flight's phases in the order flown (the
 * owner's pick of the redesign, "C"): Preflight's Go / No-Go over every
 * tab's findings (lib/verdict), each row opening where it was found, and
 * preflight action (14 CFR 91.103) to tick; Depart's and Arrive's fields,
 * their weather, runway check and radio; En route's weather on the way.
 * Each tab's sections one under another, no pills. The briefing's answer
 * is changed where a test needs one answer.
 */

/** The briefing's answer, changed by `change` on its way in. */
async function briefingAs(page: Page, change: (json: Record<string, unknown>) => void) {
  await page.route("**/api/planner/briefing?*", async route => {
    // A briefing asked for again as the test ends -- the runways picked
    // into the wind plan the route again with their patterns, and the
    // briefing follows the plan's new times -- finds the page gone: not a
    // failure of the test (CI, 2026-10-28, all three tries of the Brief's
    // cards passing their checks and failing here).
    const response = await route.fetch().catch(() => null);
    if (!response) return;
    const json = await response.json();
    change(json);
    await route.fulfill({ response, json }).catch(() => {});
  });
}

async function planned(page: Page) {
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(120000) });
}

test("Preflight opens on its Go / No-Go: VFR not recommended is no-go, marked on En route, and its row opens En route's adverse conditions", async ({ page }) => {
  await briefingAs(page, json => {
    Object.assign(json, { vfr_not_recommended: ["KDLH currently reporting IFR"], tfrs: [] });
  });
  await planned(page);
  const drawer = sideDrawer(page);
  // Marked on the chips' Brief, and in the Brief on En route.
  await expect(drawer.getByTestId("route-brief")).toHaveAttribute("data-finding", "stop");
  await openTab(page, "Brief");
  await expect(page.getByTestId("panel-tab-mark-enroute")).toHaveAttribute("data-finding", "stop");
  const weather = drawer.getByTestId("verdict-weather");
  await expect(weather).toHaveAttribute("data-finding", "stop");
  await expect(weather).toContainText("VFR not recommended: KDLH currently reporting IFR");
  await expect(drawer.getByTestId("verdict-line")).toContainText(/^No-go as planned: Weather/);
  // Every tab's finding, in the order a pilot goes through them.
  await expect(drawer.locator("[data-testid^='verdict-'][data-finding]")).toHaveCount(8);

  await weather.click();
  await expect(panelTabs(page).getByRole("tab", { name: "En route", exact: true })).toHaveAttribute("aria-selected", "true");
  // Scrolled to its section, flagged.
  await expect(drawer.locator('[data-tab="enroute"] [data-title="Adverse Conditions"]')).toBeInViewport();
  await expect(drawer.getByTestId("vnr-flag")).toBeVisible();

  // And the runways' row opens Depart at its takeoff.
  await openTab(page, "Preflight");
  await drawer.getByTestId("verdict-runways").click();
  await expect(panelTabs(page).getByRole("tab", { name: "Depart", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(drawer.locator('[data-tab="depart"] [data-title="Takeoff"]')).toBeInViewport();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Preflight's checks are the Go / No-Go's and 14 CFR 91.103's, a tile each, counted as they are looked at", async ({ page }) => {
  // The owner's pick of the redesign: the answer first, every check a tile
  // opening where it is said in full, the paperwork folded under them.
  await planned(page);
  const drawer = sideDrawer(page);
  await openTab(page, "Brief");
  await expect(drawer.getByTestId("preflight-count")).toHaveText("0 of 10 looked at");
  // The two the planner does not fetch, where a pilot reads them.
  await expect(drawer.getByTestId("check-notams")).toHaveAttribute("href", "https://www.1800wxbrief.com");
  await expect(drawer.getByTestId("check-delays")).toHaveAttribute("href", "https://www.fly.faa.gov");
  // A tile opened is a check looked at: the weather's opens En route.
  await drawer.getByTestId("verdict-weather").click();
  await expect(panelTabs(page).getByRole("tab", { name: "En route", exact: true })).toHaveAttribute("aria-selected", "true");
  await openTab(page, "Preflight");
  await expect(drawer.getByTestId("verdict-weather")).toHaveAttribute("data-looked", "true");
  // The loading's opens its own section here, folded until then.
  const balance = drawer.locator('[data-tab="preflight"] [data-title="Weight & Balance"]');
  await expect(balance).toHaveAttribute("data-state", "closed");
  await drawer.getByTestId("verdict-balance").click();
  await expect(balance).toHaveAttribute("data-state", "open");
  await expect(drawer.getByTestId("preflight-count")).toHaveText("2 of 10 looked at");
});

test("the weather goes place by place, each TAF read for when the flight is there, the pilot reports where they were made", async ({ page }) => {
  await briefingAs(page, json => {
    const arrive = new Date(Date.now() + 150 * 60_000).toISOString();
    const pass = new Date(Date.now() + 60 * 60_000).toISOString();
    (json.forecast as { stations: unknown[] }).stations = [
      { icaoId: "KHYR", ceiling_ft: 3000, visibility_sm: 6, lat: 46.03, lon: -91.44, along_track_nm: 210, eta: pass, eta_ceiling_ft: 3000, eta_visibility_sm: 6, raw: "TAF KHYR ..." },
      { icaoId: "KDLH", ceiling_ft: 800, visibility_sm: 2, lat: 46.84, lon: -92.19, along_track_nm: 300, eta: arrive, eta_ceiling_ft: 800, eta_visibility_sm: 2, raw: "TAF KDLH 071720Z ..." },
    ];
    (json as { pireps: unknown[] }).pireps = [
      { observed_at: new Date().toISOString(), altitude_ft: 5500, aircraft: "C172", urgent: false, turbulence: "LGT", icing: null, raw: "UA /OV ...", along_track_nm: 120 },
    ];
  });
  await planned(page);
  // The Brief's En route, its sections one under another: the legs are
  // FPL's own, and the side view the one pinned at its foot.
  await openTab(page, "En route");
  await expect.poll(() => sideDrawer(page).locator('[data-tab="enroute"] [data-title]')
    .evaluateAll(sections => sections.map(s => s.getAttribute("data-title"))))
    .toEqual(["Cruise Altitude", "Adverse Conditions", "Along the Route", "Winds Aloft"]);
  await openSection(page, "Along the Route");
  const enRoute = sideDrawer(page).locator('[data-tab="enroute"]').getByTestId("weather-places");
  await expect(enRoute).toBeVisible();
  await expect(enRoute.locator("h3")).toHaveText(["En route"]);
  // The pilot report 120 nm along before the TAF 210 nm along.
  await expect(enRoute.locator("[data-testid='pirep'], [data-testid='enroute-taf']")).toHaveText([/PIREP · 5,500 ft/, /KHYR/]);
  // Each field's own on its phase's tab: the destination's on Arrive.
  await openTab(page, "Arrive");
  const arrive = sideDrawer(page).locator('[data-tab="arrive"]').getByTestId("weather-places");
  await expect(arrive.locator("h3")).toHaveText(["KDLH"]);
  const destination = arrive.getByTestId("place-taf");
  await expect(destination).toContainText(/Forecast, \d\d:\d\d/);
  await expect(destination).toContainText("800 ft · 2 sm");
  await expect(destination).toContainText("IFR");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Depart has the takeoff's runway check: a runway too short is red, on the tab and in Preflight's Go / No-Go", async ({ page }) => {
  await briefingAs(page, json => {
    const airports = json.airports as Record<string, { runways: Record<string, unknown>[] }>;
    airports.C81!.runways = [{
      ends: "09/27", length_ft: 900, width_ft: 40, surface: "ASP", lighted: true, closed: false,
      wind: { end: "27", headwind_kt: 4, crosswind_kt: 2 }, runway_ends: [],
    }];
  });
  await planned(page);
  const drawer = sideDrawer(page);
  await expect(drawer.getByTestId("route-brief")).toHaveAttribute("data-finding", "stop");
  await openTab(page, "Depart");
  await expect(page.getByTestId("panel-tab-mark-depart")).toHaveAttribute("data-finding", "stop");
  await expect(drawer.getByTestId("tl-flag")).toContainText("Runway too short");
  const takeoff = drawer.getByTestId("runway-takeoff");
  await expect(takeoff).toContainText(/ft past the end/);
  await expect(drawer.getByTestId("density-altitude").first()).toContainText(/Pressure altitude [\d,]+ ft/);
  // Leaving's order: the field's weather, the takeoff, the field.
  await expect.poll(() => drawer.locator("[data-tab='depart'] [data-title]")
    .evaluateAll(sections => sections.map(s => s.getAttribute("data-title"))))
    .toEqual(["Weather", "Takeoff", "C81 · Departure"]);
  await openTab(page, "Preflight");
  await expect(drawer.getByTestId("verdict-runways")).toContainText("Too short at C81");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("each field is a section of its phase's tab, its pattern and calls first, each frequency said once", async ({ page }) => {
  await planned(page);
  const drawer = sideDrawer(page);
  // The departure's on Depart, the destination's on Arrive.
  await openTab(page, "Depart");
  const leaving = drawer.locator('[data-tab="depart"]').getByTestId("airport-section");
  await expect(leaving).toHaveCount(1);
  await expect(leaving.getByTestId("radio-phase")).toContainText("Leaving C81");
  await openTab(page, "Arrive");
  const into = drawer.locator('[data-tab="arrive"]').getByTestId("airport-section");
  await expect(into).toHaveCount(1);
  await expect(into.getByTestId("radio-phase")).toContainText("Into KDLH");
  // The calls first, each with its frequency, the figure as pilots write
  // it; the frequencies no call is on listed after them, the tower's not
  // again (the owner's pick of the redesign, each fact once).
  const tower = into.getByTestId("radio-call").filter({ hasText: "Tower" }).first();
  await expect(tower).toContainText("118.3");
  await expect(into.getByTestId("airport-frequency").filter({ hasText: "Tower" })).toHaveCount(0);
});

test("a route from the pilot's position has a section for its airports alone, none for the position", async ({ page }) => {
  await page.goto("/app/plan?dep=%4042.2340%2C-87.9877%2C700&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(120000) });
  const drawer = sideDrawer(page);
  await openTab(page, "Arrive");
  await openSection(page, "KDLH · Destination");
  await expect(drawer.locator('[data-tab="arrive"] [data-title="KDLH · Destination"]')).toBeVisible();
  await openTab(page, "Depart");
  await expect(drawer.locator('[data-tab="depart"]').getByTestId("airport-section")).toHaveCount(0);
});

test("the Brief opens on whether to go and a card for each part of the flight, a card opens its page, and the close goes back to them", async ({ page }) => {
  // The owner's pick of the redesign (D′): the cards stacked, all four in
  // one scroll, a tap on one its page; the close goes back (the owner's
  // "close button should behave as the back button").
  await briefingAs(page, json => {
    Object.assign(json, { vfr_not_recommended: ["KDLH currently reporting IFR"], tfrs: [] });
  });
  await planned(page);
  const drawer = sideDrawer(page);
  await openBrief(page);
  const glance = drawer.getByTestId("brief-glance");
  await expect(glance.getByTestId("brief-verdict")).toContainText(/^No-go as planned: Weather/, { timeout: slow(30_000) });
  await expect(glance.getByTestId("brief-glance-enroute")).toHaveAttribute("data-finding", "stop");
  await expect(glance.getByTestId("brief-glance-enroute")).toContainText("VFR not recommended: KDLH currently reporting IFR");
  // The verdict the one red wash: a no-go card as plain as the others, its
  // red in its icon and figures alone (the design review, 2026-10-28).
  const fill = (id: string) => glance.getByTestId(id).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await fill("brief-glance-enroute")).toBe(await fill("brief-glance-depart"));
  expect(await fill("brief-verdict")).not.toBe(await fill("brief-glance-depart"));
  await expect(glance.getByTestId("brief-glance-depart")).toContainText("C81");
  await expect(glance.getByTestId("brief-glance-arrive")).toContainText("KDLH");
  await expect(glance.getByTestId("brief-glance-arrive")).toContainText(/Runway/);
  await expect(panelTabs(page)).toHaveCount(0);

  await glance.getByTestId("brief-glance-enroute").click();
  await expect(panelTabs(page).getByRole("tab", { name: "En route", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(glance).toHaveCount(0);
  // Back to the cards, the Brief still open.
  await closeCard(page, "brief-close");
  await expect(drawer.getByTestId("brief-glance")).toBeVisible();
  await expect(drawer.getByTestId("brief-card")).toBeVisible();
});
