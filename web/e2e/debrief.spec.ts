import { test, expect, type Page } from "@playwright/test";

/**
 * A saved flight's debrief (FlightPage, lib/debrief, lib/track): its page
 * from the console's Flights, a GPX track log imported against its nav
 * log, kept on the device, then saved to the account. Spring's flight
 * endpoints are mocked; the planner's pattern altitudes are real.
 */
const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };
const C81 = { lat: 42.3172, lon: -88.0905 }, KUGN = { lat: 42.4222, lon: -87.8679 };
const LAKE = { lat: (C81.lat + KUGN.lat) / 2, lon: (C81.lon + KUGN.lon) / 2 };

const checkpoint = (sequenceNo: number, name: string, category: string, at: { lat: number; lon: number }, alongTrackNm: number, leg: boolean) => ({
  sequenceNo, name, category, ...at, alongTrackNm,
  legDistanceNm: leg ? 6 : null, trueCourseDeg: leg ? 56 : null, magneticHeadingDeg: leg ? 59 : null,
  groundspeedKt: leg ? 100 : null, eteMin: leg ? 3.6 : null, fuelGal: leg ? 0.5 : null, altitudeFt: leg ? 2500 : null,
});
const SUMMARY = {
  id: 9, departureIdent: "C81", destinationIdent: "KUGN", stops: [], cruiseAltitudeFt: 2500, aircraftTailNumber: null,
  createdAt: "2026-10-01T12:00:00Z", plannedFor: null, totalDistanceNm: 12, totalEteMin: 7.2, totalFuelGal: 1,
  risk: { score: 3, level: "low", factors: ["Under 100 hours in your logbook"] },
};
const FLIGHT = {
  ...SUMMARY,
  checkpoints: [
    checkpoint(0, "C81", "departure", C81, 0, false),
    checkpoint(1, "Lake", "lake", LAKE, 6, true),
    checkpoint(2, "KUGN", "destination", KUGN, 12, true),
  ],
};

/** Two minutes' taxi at C81, the line to KUGN at 100 kt and 2,500 ft
 *  (down to the pattern in its last two miles), and a taxi there: GPX,
 *  a point every 5 seconds, elevations in metres. */
function gpx(): string {
  const t0 = Date.parse("2026-10-02T15:00:00Z");
  const points: { t: number; lat: number; lon: number; ft: number }[] = [];
  for (let s = 0; s < 120; s += 5) points.push({ t: t0 + s * 1000, ...C81, ft: 900 });
  const flight = 12 / 100 * 3600;
  for (let s = 0; s <= flight; s += 5) {
    const f = s / flight, nm = 12 * f;
    const ft = nm < 1 ? 900 + nm * 1600 : nm > 10 ? 2500 - (nm - 10) * 400 : 2500;
    points.push({ t: t0 + 120_000 + s * 1000, lat: C81.lat + f * (KUGN.lat - C81.lat), lon: C81.lon + f * (KUGN.lon - C81.lon), ft });
  }
  for (let s = 5; s < 120; s += 5) points.push({ t: t0 + 120_000 + flight * 1000 + s * 1000, ...KUGN, ft: 730 });
  const trkpts = points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${(p.ft / 3.28084).toFixed(1)}</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${trkpts.join("")}</trkseg></trk></gpx>`;
}

async function signedIn(page: Page, saved: { body: unknown }[]) {
  await page.route("**/api/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  await page.route("**/api/aircraft", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/flights", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([SUMMARY]) }));
  await page.route("**/api/flights/9", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FLIGHT) }));
  await page.route("**/api/flights/9/track", async route => {
    const method = route.request().method();
    if (method === "PUT") {
      saved.push({ body: route.request().postDataJSON() });
      return route.fulfill({ status: 204, body: "" });
    }
    if (method === "DELETE") {
      saved.length = 0;
      return route.fulfill({ status: 204, body: "" });
    }
    return saved.length
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved.at(-1)!.body) })
      : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
  });
}

test("a saved flight's page, and its debrief from a GPX track: kept on the device, then saved to the account", async ({ page }) => {
  const saved: { body: unknown }[] = [];
  await signedIn(page, saved);
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  await page.getByRole("tab", { name: "Flights" }).click();
  await page.getByRole("button", { name: /C81 → KUGN/ }).click();

  const flightPage = page.getByTestId("console-page");
  await expect(flightPage.getByRole("heading", { name: "C81 → KUGN" })).toBeVisible();
  await expect(flightPage).toContainText("Under 100 hours in your logbook");
  await expect(flightPage.getByTestId("flight-open")).toBeVisible();

  await flightPage.getByTestId("debrief-file").setInputFiles({ name: "flight.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx()) });
  await expect(flightPage.getByTestId("debrief-source")).toContainText("on this device");
  const legs = flightPage.getByTestId("debrief-leg");
  await expect(legs).toHaveCount(2);
  await expect(legs.first()).toContainText("within 200 ft of 2,500 ft");
  await expect(legs.first().getByLabel("Within")).toBeVisible();
  const checkpoints = flightPage.getByTestId("debrief-checkpoint");
  await expect(checkpoints.first()).toContainText("Lake");
  await expect(checkpoints.first()).toContainText("passed 0:04");
  await expect(checkpoints.last()).toContainText("landed");
  await expect(flightPage.getByTestId("debrief-pattern")).toContainText("KUGN");
  await expect(flightPage.getByTestId("debrief-profile")).toBeVisible();

  // Kept on the device: back to the list and in again, it is still there.
  await page.getByRole("button", { name: "Flights", exact: true }).click();
  await page.getByRole("button", { name: /C81 → KUGN/ }).click();
  await expect(flightPage.getByTestId("debrief-source")).toContainText("on this device");

  await flightPage.getByTestId("debrief-save").click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]!.body).toMatchObject({ source: "flight.gpx" });
  await expect(flightPage.getByTestId("debrief-unsave")).toBeVisible();
  await flightPage.getByTestId("debrief-forget").click();
  await expect(flightPage.getByTestId("debrief-source")).toContainText("saved to your account");
  await flightPage.getByTestId("debrief-unsave").click();
  await expect(flightPage.getByTestId("debrief-source")).toHaveCount(0);
});

test("Show on the map draws the flown track over its route, and the map's button hides it", async ({ page }) => {
  await signedIn(page, []);
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  await page.getByRole("tab", { name: "Flights" }).click();
  await page.getByRole("button", { name: /C81 → KUGN/ }).click();
  await page.getByTestId("debrief-file").setInputFiles({ name: "flight.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx()) });
  await page.getByTestId("debrief-show").click();

  await expect(page).toHaveURL(/dep=C81/);
  await expect(page).toHaveURL(/dest=KUGN/);
  // Drawn once the route is: near-black where within the tolerances.
  await expect(page.locator('path[stroke="#1d1d1f"]').first()).toBeAttached({ timeout: 60_000 });
  await page.getByTestId("flown-track-button").click();
  await page.getByTestId("flown-track-hide").click();
  await expect(page.getByTestId("flown-track-button")).toHaveCount(0);
  await expect(page.locator('path[stroke="#1d1d1f"]')).toHaveCount(0);
});

test("a file that is not a track says so where it was imported", async ({ page }) => {
  await signedIn(page, []);
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  await page.getByRole("tab", { name: "Flights" }).click();
  await page.getByRole("button", { name: /C81 → KUGN/ }).click();
  await page.getByTestId("debrief-file").setInputFiles({ name: "notes.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from("<gpx><trk/></gpx>") });
  await expect(page.getByTestId("debrief-problem")).toContainText("There is no track in this file.");
});
