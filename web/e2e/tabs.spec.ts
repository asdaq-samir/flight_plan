import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow, openTab, openSection, panelTabs, sectionTab } from "./helpers";

/**
 * The planning panel's tabs, each opening on its conclusion: the Brief's
 * Go / No-Go over every tab's findings (lib/verdict), each row opening
 * where it was found, and preflight action (14 CFR 91.103) to tick; the
 * Weather place by place along the route; the Performance tab's runway
 * check; the Airports a section a field. The briefing's answer is
 * changed where a test needs one answer.
 */

/** The briefing's answer, changed by `change` on its way in. */
async function briefingAs(page: Page, change: (json: Record<string, unknown>) => void) {
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch();
    const json = await response.json();
    change(json);
    await route.fulfill({ response, json });
  });
}

async function planned(page: Page) {
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
}

test("the Brief opens on its Go / No-Go: VFR not recommended is no-go, marked on the Weather tab, and its row opens the Weather", async ({ page }) => {
  await briefingAs(page, json => {
    Object.assign(json, { vfr_not_recommended: ["KDLH currently reporting IFR"], tfrs: [] });
  });
  await planned(page);
  const drawer = sideDrawer(page);
  await expect(page.getByTestId("panel-tab-mark-weather")).toHaveAttribute("data-finding", "stop");
  await openTab(page, "Brief");
  const weather = drawer.getByTestId("verdict-weather");
  await expect(weather).toHaveAttribute("data-finding", "stop");
  await expect(weather).toContainText("VFR not recommended: KDLH currently reporting IFR");
  await expect(drawer.getByTestId("verdict-line")).toContainText(/^No-go as planned: Weather/);
  // Every tab's finding, in the order a pilot goes through them.
  await expect(drawer.locator("[data-testid^='verdict-'][data-finding]")).toHaveCount(8);

  await weather.click();
  await expect(panelTabs(page).getByRole("tab", { name: "Weather", exact: true })).toHaveAttribute("aria-selected", "true");
  // On its section's pill (SectionTabs), the section under it, flagged.
  await expect(sectionTab(page, "Adverse Conditions")).toHaveAttribute("aria-pressed", "true");
  await expect(sectionTab(page, "Adverse Conditions").getByTestId("section-tab-mark")).toHaveAttribute("data-finding", "stop");
  await expect(drawer.locator('[data-tab="weather"] [data-title="Adverse Conditions"]')).toBeInViewport();
  await expect(drawer.getByTestId("vnr-flag")).toBeVisible();

  // And the runways' row opens the Performance tab at its runway check.
  await openTab(page, "Brief");
  await drawer.getByTestId("verdict-runways").click();
  await expect(panelTabs(page).getByRole("tab", { name: "Performance", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(sectionTab(page, "Takeoff & Landing")).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.locator('[data-tab="performance"] [data-title="Takeoff & Landing"]')).toBeInViewport();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("preflight action is 14 CFR 91.103's list to tick, with what the planner found for each", async ({ page }) => {
  await planned(page);
  const drawer = sideDrawer(page);
  await openTab(page, "Brief");
  await openSection(page, "Preflight Action");
  await expect(drawer.getByTestId("preflight-count")).toHaveText("0 of 7 reviewed");
  await expect(drawer.getByTestId("preflight-runways")).toContainText(/C81 [\d,]+ ft · KDLH [\d,]+ ft/);
  await expect(drawer.getByTestId("preflight-distances")).toContainText("91.103(b)");
  await drawer.getByTestId("preflight-weather").click();
  await drawer.getByTestId("preflight-fuel").click();
  await expect(drawer.getByTestId("preflight-fuel")).toHaveAttribute("aria-checked", "true");
  await expect(drawer.getByTestId("preflight-count")).toHaveText("2 of 7 reviewed");
});

test("the Weather goes place by place, each TAF read for when the flight is there, the pilot reports where they were made", async ({ page }) => {
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
  await openTab(page, "Weather");
  // The Weather's parts as its section tabs; the places, in the order
  // flown, under Along the Route.
  await expect(sideDrawer(page).locator('[data-tab="weather"] [data-testid="section-tab"]'))
    .toHaveText(["Adverse Conditions", "Along the Route", "Winds Aloft"]);
  await openSection(page, "Along the Route");
  const places = sideDrawer(page).getByTestId("weather-places");
  await expect(places).toBeVisible();
  await expect(places.locator("h3")).toHaveText(["C81 · Departure", "En route", "KDLH · Destination"]);
  // The pilot report 120 nm along before the TAF 210 nm along.
  await expect(places.locator("[data-testid='pirep'], [data-testid='enroute-taf']")).toHaveText([/PIREP · 5,500 ft/, /KHYR/]);
  const destination = places.getByTestId("place-taf").last();
  await expect(destination).toContainText(/Forecast, \d\d:\d\d/);
  await expect(destination).toContainText("800 ft · 2 sm");
  await expect(destination).toContainText("IFR");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the Performance tab opens on the runway check: a runway too short is red, on the tab and the Brief", async ({ page }) => {
  await briefingAs(page, json => {
    const airports = json.airports as Record<string, { runways: Record<string, unknown>[] }>;
    airports.C81!.runways = [{
      ends: "09/27", length_ft: 900, width_ft: 40, surface: "ASP", lighted: true, closed: false,
      wind: { end: "27", headwind_kt: 4, crosswind_kt: 2 }, runway_ends: [],
    }];
  });
  await planned(page);
  const drawer = sideDrawer(page);
  await expect(page.getByTestId("panel-tab-mark-performance")).toHaveAttribute("data-finding", "stop");
  await openTab(page, "Performance");
  await expect(drawer.getByTestId("tl-flag")).toContainText("Runway too short");
  const takeoff = drawer.getByTestId("runway-takeoff");
  await expect(takeoff).toContainText(/ft past the end/);
  await expect(drawer.getByTestId("density-altitude").first()).toContainText(/Pressure altitude [\d,]+ ft/);
  // The runways before the loading: what is read there first.
  const titles = await drawer.locator("[data-tab='performance'] [data-slot='open-section'] > div > h3").allInnerTexts();
  expect(titles.indexOf("Takeoff & Landing")).toBeLessThan(titles.indexOf("Weight & Balance"));
  await openTab(page, "Brief");
  await expect(drawer.getByTestId("verdict-runways")).toContainText("Too short at C81");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the Airports tab is a section for each field, in the order flown, its pattern and calls with its runways", async ({ page }) => {
  await planned(page);
  const drawer = sideDrawer(page);
  await openTab(page, "Airports");
  const sections = drawer.getByTestId("airport-section");
  await expect(sections).toHaveCount(2);
  // Each field a section tab, the first up.
  await expect(sectionTab(page, "C81 · Departure")).toHaveAttribute("aria-pressed", "true");
  await expect(sectionTab(page, "KDLH · Destination")).toHaveAttribute("aria-pressed", "false");
  await expect(sections.nth(0)).toBeVisible();
  await expect(sections.nth(1)).toBeHidden();
  await expect(sections.nth(0).getByTestId("radio-phase")).toContainText("Leaving C81");
  await expect(sections.nth(1).getByTestId("radio-phase")).toContainText("Into KDLH");
  // Each frequency as the field's card lists it: its name in words and
  // its glyph, the figure as pilots write it.
  const tower = sections.nth(1).getByTestId("airport-frequency").filter({ hasText: "Tower" }).first();
  await expect(tower).toContainText("118.3");
  await expect(tower.locator("svg").first()).toBeAttached();
});

test("a route from the pilot's position has a section for its airports alone, none for the position", async ({ page }) => {
  await page.goto("/app/plan?dep=%4042.2340%2C-87.9877%2C700&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  const drawer = sideDrawer(page);
  await openTab(page, "Airports");
  await expect(drawer.getByRole("heading", { name: "KDLH · Destination" })).toBeVisible();
  await expect(drawer.getByTestId("airport-section")).toHaveCount(1);
  await expect(drawer.getByRole("heading", { name: /Departure/ })).toHaveCount(0);
});
