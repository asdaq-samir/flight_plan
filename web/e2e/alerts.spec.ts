import { test, expect, type Page, type Route } from "@playwright/test";
import { closeConsole, openSettings, settle, slow } from "./helpers";

/**
 * What is ahead of own ship in the air (lib/map/ahead), said over the map
 * beside its buttons (AlertsBanner) and drawn where it is (AheadLayer).
 * The GPS is a fake one in flight -- east at 120 kt, 3,000 ft, near
 * Campbell Airport (C81) -- and the planner's answer is stubbed: what it
 * finds ahead is vfr.alerts' to test (tests/test_alerts.py).
 */

test.use({ permissions: ["geolocation"] });

/** A GPS in the air: every second the same fix, going `speedKt` on 090. */
async function flying(page: Page, speedKt = 120, accuracyM = 10) {
  await page.addInitScript(([knots, accuracy]) => {
    const position = () => ({
      coords: {
        latitude: 42.3246, longitude: -88.0741, accuracy, heading: 90, speed: knots / 1.943844,
        altitude: 3000 / 3.28084, altitudeAccuracy: 10, toJSON() { return this; },
      },
      timestamp: Date.now(), toJSON() { return this; },
    }) as unknown as GeolocationPosition;
    // Answered later, as a real GPS answers: own ship starts watching as
    // its store is made, before the store is there to take a fix.
    Geolocation.prototype.watchPosition = function (success: PositionCallback) {
      window.setTimeout(() => success(position()), 0);
      return window.setInterval(() => success(position()), 1000);
    };
    Geolocation.prototype.clearWatch = function (id: number) { window.clearInterval(id); };
    Geolocation.prototype.getCurrentPosition = function (success: PositionCallback) {
      window.setTimeout(() => success(position()), 0);
    };
    localStorage.setItem("vfr.ownship",
      JSON.stringify({ state: { enabled: true, follow: true, lastFix: { lat: 42.325, lon: -88.074 } }, version: 0 }));
  }, [speedKt, accuracyM] as const);
}

const CLASS_B = {
  id: "airspace:B:CHICAGO CLASS B", kind: "airspace", level: "warning", name: "CHICAGO CLASS B", class: "B",
  need: "An ATC clearance before entering (91.131(a)(1)).", inside: false, seconds: 130, distance_nm: 4.2,
  lat: 42.3246, lon: -87.98, floor_ft: 3000, ceiling_ft: 10000, top_ft: null, clearance_ft: null,
};
const TOWER = {
  id: "obstacle:42.3246,-88.0500", kind: "obstacle", level: "caution", name: "TOWER", class: null,
  need: "Within 500 ft of the airplane's altitude: climb or turn (91.119(c)).", inside: false, seconds: 40,
  distance_nm: 1.3, lat: 42.3246, lon: -88.05, floor_ft: null, ceiling_ft: null, top_ft: 2700, clearance_ft: 300,
};

/** The planner's answer to what is ahead, and the asks it was given. */
async function ahead(page: Page, answer: (route: Route) => Promise<void>) {
  const asks: URL[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/airspace/ahead"), route => {
    asks.push(new URL(route.request().url()));
    return answer(route);
  });
  return asks;
}

const banner = (page: Page) => page.locator("[data-alerts-banner]");

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("in the air, what is ahead is said over the map, a warning first, and drawn where it is", async ({ page }) => {
  await flying(page);
  const asks = await ahead(page, route => route.fulfill({ json: { alerts: [CLASS_B, TOWER], unavailable: [] } }));
  await page.goto("/app/plan");
  await settle(page);
  const title = banner(page).getByTestId("alerts-banner-title");
  await expect(title).toContainText("Chicago Class B", { timeout: slow(15_000) });
  await expect(title).toContainText("In 2 min · 4.2 nm · 1 more");
  // A warning is said at once to a screen reader.
  await expect(banner(page).getByRole("alert")).toBeVisible();
  // Asked from the GPS's own track, speed and height.
  const ask = asks[0]!.searchParams;
  expect([ask.get("track"), ask.get("gs"), ask.get("alt")]).toEqual(["90", "120", "3000"]);
  // Opened: each with what it asks and its rule.
  await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "true");
  // Under the line, not inside its button (shadcn's Collapsible).
  await expect(banner(page)).toContainText("91.131(a)(1)");
  await expect(banner(page)).toContainText("Tower 2,700 ft: In 40 s · 300 ft below you");
  // A ring where each is and a line out to it, in its colour.
  await expect(page.locator(".leaflet-overlay-pane path.ahead-warning")).toHaveCount(2);
  await expect(page.locator(".leaflet-overlay-pane path.ahead-caution")).toHaveCount(2);
  // OK puts them away, and they stay away while they are what is ahead.
  await banner(page).getByTestId("alerts-acknowledge").click();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator(".leaflet-overlay-pane path.ahead-warning")).toHaveCount(0);
});

test("a planner that does not answer is said, not shown as a clear sky", async ({ page }) => {
  await flying(page);
  await ahead(page, route => route.fulfill({ status: 502, json: { detail: "planner service unreachable" } }));
  await page.goto("/app/plan");
  await settle(page);
  await expect(banner(page).getByTestId("alerts-banner-title"))
    .toHaveText("No alerts ahead: the planner did not answer", { timeout: slow(15_000) });
});

test("on the ground nothing is asked, and nothing is said", async ({ page }) => {
  await flying(page, 8);
  const asks = await ahead(page, route => route.fulfill({ json: { alerts: [CLASS_B], unavailable: [] } }));
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.locator('[data-own-ship="on"]')).toBeVisible({ timeout: slow(10_000) });
  await page.waitForTimeout(1500);
  expect(asks).toHaveLength(0);
  await expect(banner(page)).toHaveCount(0);
});

test("switched off in the map's settings, nothing is asked", async ({ page }) => {
  await flying(page);
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, alerts: false } }));
  });
  const asks = await ahead(page, route => route.fulfill({ json: { alerts: [CLASS_B], unavailable: [] } }));
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.locator('[data-own-ship="on"]')).toBeVisible({ timeout: slow(10_000) });
  await page.waitForTimeout(1500);
  expect(asks).toHaveLength(0);
  await expect(banner(page)).toHaveCount(0);
});

/** A voice that keeps what it is asked to say, in `window.said`. */
async function listening(page: Page) {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { speak: (line: SpeechSynthesisUtterance) => said.push(line.text), cancel() {}, getVoices: () => [] },
    });
  });
  return () => page.evaluate(() => (window as unknown as { said: string[] }).said);
}

test("spoken, each alert ahead is said once as it comes, and turned on it says so", async ({ page }) => {
  await flying(page);
  const said = await listening(page);
  let answer = [CLASS_B];
  await ahead(page, route => route.fulfill({ json: { alerts: answer, unavailable: [] } }));
  await page.goto("/app/plan");
  await settle(page);
  await expect(banner(page).getByTestId("alerts-banner-title")).toContainText("Chicago Class B", { timeout: slow(15_000) });
  // Off by default: nothing said.
  expect(await said()).toEqual([]);

  // Settings' In Flight, with the alerts themselves.
  await openSettings(page);
  const spoken = page.getByTestId("speak-alerts-toggle");
  await expect(spoken).toHaveAttribute("aria-checked", "false");
  await spoken.click();
  await expect(spoken).toHaveAttribute("aria-checked", "true");
  await closeConsole(page);
  // Turned on in the air: it says so, then what is ahead.
  await expect.poll(said).toEqual(["Alerts will be spoken.", "Chicago Class B, in 2 minutes."]);

  // The next answer adds the tower: it alone is said.
  answer = [CLASS_B, TOWER];
  await expect.poll(said, { timeout: slow(30_000) }).toEqual([
    "Alerts will be spoken.", "Chicago Class B, in 2 minutes.", "Tower 2,700 feet, 300 feet below you, in 40 seconds.",
  ]);
});

test("a position that is the phone's approximate one, Precise Location off, is said so, once, and a GPS's is not", async ({ page }) => {
  await ahead(page, route => route.fulfill({ json: [] }));
  await flying(page, 120, 3000);
  await page.goto("/app/plan");
  await settle(page);
  const alert = page.getByTestId("error-alert");
  await expect(alert).toContainText("Approximate position");
  await expect(alert).toContainText("Precise Location is off");
  // OK from md up; on a phone the sheet's close in its title row.
  await alert.getByRole("button", { name: /^(OK|Close)$/ }).click();
  // Not again at each second's fix.
  await page.waitForTimeout(2500);
  await expect(alert).toHaveCount(0);
});

test("a GPS's position says nothing of its accuracy", async ({ page }) => {
  await ahead(page, route => route.fulfill({ json: [] }));
  await flying(page);
  await page.goto("/app/plan");
  await settle(page);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("error-alert")).toHaveCount(0);
});
