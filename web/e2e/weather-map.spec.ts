import { test, expect } from "@playwright/test";
import { openMapSettings, settle, slow } from "./helpers";

/**
 * The weather on the map, at the owner's pick (the canvas's map weather,
 * A: the map's own button): the radar and satellite tiles (IEM's, not
 * fetched here), the SIGMETs and G-AIRMETs as areas, the PIREPs and the
 * winds aloft, each turned on or off from the map's button; an area's card
 * says how the route crosses it. The planner's answer stubbed.
 */

// Over the route from C81 to Duluth, about half way: a convective SIGMET.
const AREA = {
  id: "sigmet-0", kind: "convective", hazard: "CONVECTIVE", severity: null, low_ft: null, high_ft: 45000, from_freezing_level: false,
  valid_from: Date.now() / 1000 - 600, valid_to: Date.now() / 1000 + 3000, raw: "CONVECTIVE SIGMET 12C",
  coords: [[44.0, -91.2], [45.2, -91.2], [45.2, -89.0], [44.0, -89.0]],
};
const PIREP = { lat: 43.5, lon: -89.6, altitude_ft: 6500, aircraft: "C172", urgent: false, turbulence: "MOD", icing: null, observed_at: "2026-10-20T14:12:00Z", raw: "UA /OV MSN310012/TM 1412/FL065/TP C172/TB MOD" };
const WIND = { ident: "MSN", lat: 43.14, lon: -89.34, dir_true_deg: 265, speed_kt: 34, temp_c: -6 };

test("the map's button turns the weather on and off, and an area's card says how the route crosses it", async ({ page }) => {
  await page.route(url => url.hostname === "mesonet.agron.iastate.edu", route => route.abort());
  const asked: URL[] = [];
  await page.route(url => url.pathname.endsWith("/weather/map"), route => {
    const url = new URL(route.request().url());
    asked.push(url);
    const winds = url.searchParams.get("altitude_ft") ? { altitude_ft: Number(url.searchParams.get("altitude_ft")), period: null, stations: [WIND] } : null;
    return route.fulfill({ json: { at: Date.now() / 1000, advisories: [AREA], pireps: [PIREP], winds, radar_valid: "2026-10-20T21:15:00Z" } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // The SIGMET on by default, in its colour; the radar's tiles asked of IEM.
  const area = page.locator('path.leaflet-interactive[stroke="#c2410c"]');
  await expect(area).toHaveCount(1, { timeout: slow(30000) });
  // A tap on it: what it is, and the route through it at the plan's altitude.
  await area.click();
  const card = page.getByTestId("weather-area-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("weather-area-route")).toContainText(/Your route crosses it for \d+ nm/);

  // PIREPs and the winds at 9,000 ft, from the map's button.
  await openMapSettings(page);
  await expect(page.getByTestId("weather-areas-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("weather-pireps-toggle").click();
  await page.getByTestId("weather-winds").click();
  await page.getByTestId("weather-winds-9000").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".leaflet-marker-icon", { hasText: "065" })).toHaveCount(1);
  await expect.poll(() => asked.some(u => u.searchParams.get("altitude_ft") === "9000")).toBe(true);
  await expect(page.locator('.leaflet-marker-icon[title^="MSN: 265° true at 34 kt"]')).toHaveCount(1);
  // The areas off: gone from the chart.
  await openMapSettings(page);
  await page.getByTestId("weather-areas-toggle").click();
  await page.keyboard.press("Escape");
  await expect(area).toHaveCount(0);
});
