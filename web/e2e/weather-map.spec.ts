import { test, expect } from "@playwright/test";
import { drawn, mapStill, openMapSettings, settle, slow } from "./helpers";

/**
 * The weather on the map, at the owner's pick (the canvas's map weather,
 * A: the map's own button): the radar and satellite tiles (IEM's, not
 * fetched here), the SIGMETs and G-AIRMETs as areas, the PIREPs and the
 * winds aloft, each turned on or off from the map's button; an area's card
 * says how the route crosses it. The planner's answer stubbed.
 */

// Over the route from C81 to Duluth, its middle and north: a convective
// SIGMET, large enough that part of it is always clear of the sheet and
// the airports' marks for the tap below.
const AREA = {
  id: "sigmet-0", kind: "convective", hazard: "CONVECTIVE", severity: null, low_ft: null, high_ft: 45000, from_freezing_level: false,
  valid_from: Date.now() / 1000 - 600, valid_to: Date.now() / 1000 + 3000, raw: "CONVECTIVE SIGMET 12C",
  coords: [[44.0, -93.0], [47.5, -93.0], [47.5, -88.0], [44.0, -88.0]],
};
const PIREP = { lat: 43.5, lon: -89.6, altitude_ft: 6500, aircraft: "C172", urgent: false, turbulence: "MOD", icing: null, observed_at: "2026-10-20T14:12:00Z", raw: "UA /OV MSN310012/TM 1412/FL065/TP C172/TB MOD" };
const WIND = { ident: "MSN", lat: 43.14, lon: -89.34, dir_true_deg: 265, speed_kt: 34, temp_c: -6 };

test("the map's button turns the weather on and off, and an area's card says how the route crosses it", { tag: "@smoke" }, async ({ page }) => {
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
  // The weather is off until asked for: nothing asked of the planner.
  expect(asked).toHaveLength(0);

  // The areas, the PIREPs and the winds at 9,000 ft, from the map's button.
  await openMapSettings(page);
  await expect(page.getByTestId("weather-areas-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("weather-areas-toggle").click();
  await page.getByTestId("weather-pireps-toggle").click();
  await page.getByTestId("weather-winds").click();
  await page.getByTestId("weather-winds-9000").click();
  // Put away, and gone before the map's button is tapped again. One
  // Escape was not always enough after the winds' menu: the settings
  // stayed open (run 42221930776), so the next tap on the map's button
  // found them open, as runs 42219994020 and 42221133228 did.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-settings")).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: slow(10000) });
  // The SIGMET in its colour, the PIREP at its level, the wind at MSN.
  // The area on the map's canvas, as its probe says (WeatherGl).
  const areas = async () => (await drawn(page, "weather-areas")).filter(a => a.colour === "#c2410c");
  await expect.poll(async () => (await areas()).length, { timeout: slow(30000) }).toBeGreaterThan(0);
  await expect(page.locator(".maplibregl-marker", { hasText: "065" })).toHaveCount(1);
  await expect.poll(() => asked.some(u => u.searchParams.get("altitude_ft") === "9000")).toBe(true);
  await expect(page.locator('.maplibregl-marker[title^="MSN: 265° true at 34 kt"]')).toHaveCount(1);

  // The areas off: gone from the chart; and on again for the tap below.
  // Both before any card is open: on a phone a card is a sheet over the
  // map and its buttons, and the map's button was not reached after one
  // was put away (runs 42219044827 and 42219994020).
  await openMapSettings(page);
  await page.getByTestId("weather-areas-toggle").click();
  await expect.poll(async () => (await areas()).length).toBe(0);
  await page.getByTestId("weather-areas-toggle").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-settings")).toHaveCount(0);
  await expect.poll(async () => (await areas()).length).toBeGreaterThan(0);

  // A tap on it: what it is, and the route through it at the plan's
  // altitude. The tap is where the area itself is the top element and as
  // high on the screen as it can be, clear of the sheet, the map's buttons
  // and the airports' marks (which cover its middle; CI's run 42214657620
  // its corner too), and made once the map is still and again if a move
  // took the spot away -- a spot found in a move had a mark slide over it
  // (run 42219044827). A real pointer's click, as a finger's.
  const card = page.getByTestId("weather-area-card");
  await expect(async () => {
    await mapStill(page);
    const [first] = await areas();
    const spot = first && await page.evaluate(([x0, y0, x1, y1]) => {
      const map = document.querySelector(".maplibregl-map")!.getBoundingClientRect();
      const width = window.innerWidth;
      // Clear of the marks on the canvas (their probes) by a finger's reach.
      const marks: { x: number; y: number }[] = [];
      for (const probe of document.querySelectorAll<HTMLElement>("[data-airport-marks], [data-navaid-marks]")) {
        for (const m of JSON.parse(probe.getAttribute(`data-${probe.dataset.glProbe}`) ?? "[]") as { x: number; y: number }[]) marks.push({ x: map.left + m.x, y: map.top + m.y });
      }
      const clear = (x: number, y: number) => marks.every(m => Math.abs(m.x - x) > 34 || Math.abs(m.y - y) > 34);
      for (let fy = 0.05; fy < 1; fy += 0.05) {
        for (let fx = 0.1; fx < 1; fx += 0.1) {
          const x = map.left + x0! + (x1! - x0!) * fx, y = map.top + y0! + (y1! - y0!) * fy;
          if (y < 80 || x < 20 || x > width - 64) continue;
          if (clear(x, y) && document.elementFromPoint(x, y)?.matches("canvas.maplibregl-canvas")) return { x, y };
        }
      }
      return null;
    }, first.box as number[]);
    expect(spot, "a part of the area with nothing over it").not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    await expect(card).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: slow(30000) });
  await expect(card.getByTestId("weather-area-route")).toContainText(/Your route crosses it for \d+ nm/);
});
