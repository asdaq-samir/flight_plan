import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { library, openConsole, showTabs } from "./helpers";

/**
 * A flown approach debriefed against its procedure (components/
 * ApproachDebrief, lib/approachDebrief): a saved flight to KBUR, its GPX
 * track down the ILS Y RWY 08's final -- a mile left of it from 4.5 to
 * 2.5 nm out -- and a missed approach begun 12 s past the runway. The
 * flight's page finds the approach among KBUR's, draws it, and lists
 * what was off. Spring's flight endpoints and the planner's procedures
 * (the CIFP drawings the unit tests use) are mocked.
 */
const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };
const DRAWINGS = JSON.parse(readFileSync(new URL("../src/lib/fixtures/approachKbur.json", import.meta.url), "utf8")) as Record<string, unknown>;
const KVNY = { lat: 34.2098, lon: -118.4898 };
const RW08 = { lat: 34.197911, lon: -118.369142 };
const SILEX = { lat: 34.201058, lon: -118.611636 };

const checkpoint = (sequenceNo: number, name: string, category: string, at: { lat: number; lon: number }, alongTrackNm: number, leg: boolean) => ({
  sequenceNo, name, category, ...at, alongTrackNm,
  legDistanceNm: leg ? 20 : null, trueCourseDeg: leg ? 90 : null, magneticHeadingDeg: leg ? 78 : null,
  groundspeedKt: leg ? 120 : null, eteMin: leg ? 10 : null, fuelGal: leg ? 1.5 : null, altitudeFt: leg ? 3700 : null,
});
const SUMMARY = {
  id: 12, departureIdent: "KVNY", destinationIdent: "KBUR", stops: [], cruiseAltitudeFt: 3700, aircraftTailNumber: null,
  createdAt: "2026-10-30T12:00:00Z", plannedFor: null, totalDistanceNm: 20, totalEteMin: 10, totalFuelGal: 1.5,
  risk: null, picks: "procs=KBUR%3AI08-Y",
};
const FLIGHT = {
  ...SUMMARY, altitudes: null,
  checkpoints: [checkpoint(0, "KVNY", "departure", KVNY, 0, false), checkpoint(1, "KBUR", "destination", RW08, 20, true)],
};
const LIST = {
  airport: "KBUR", cycle: "261001", stale: false,
  procedures: [
    { kind: "approach", id: "I08-Y", name: "ILS Y RWY 08", runway: "08", transitions: ["LAX"], runway_transitions: [] },
    { kind: "approach", id: "R08-Z", name: "RNAV (GPS) Z RWY 08", runway: "08", transitions: ["MIKEI"], runway_transitions: [] },
  ],
};

/** Down the ILS's final at 120 kt, a point a second: from 2 nm west of
 *  SILEX at 3,700, then 3,000 to the glide slope and down its 3° to the
 *  runway's 787 ft, a mile left from 4.5 to 2.5 nm out; level 12 s past
 *  the runway, then climbing at 1,000 fpm for two minutes. */
function gpx(): string {
  const t0 = Date.parse("2026-10-30T15:00:00Z");
  const kx = Math.cos((34.2 * Math.PI) / 180) * 60;
  const startLon = SILEX.lon - 2 / kx;
  const total = (RW08.lon - startLon) * kx;
  const points: { t: number; lat: number; lon: number; ft: number }[] = [];
  for (let s = 0; ; s++) {
    const nm = (s * 120) / 3600;
    if (nm > total) break;
    const toGo = total - nm, f = nm / total;
    const path = 787 + toGo * 6076.12 * Math.tan((3 * Math.PI) / 180) + (toGo * 6076.12) ** 2 / (2 * 20_902_231);
    const ft = Math.min(path, toGo > 11 ? 3700 : 3000);
    const left = toGo < 4.5 && toGo > 2.5 ? 1 / 60 : 0;
    points.push({ t: t0 + s * 1000, lat: SILEX.lat + f * (RW08.lat - SILEX.lat) + left, lon: startLon + nm / kx, ft });
  }
  const end = points[points.length - 1]!;
  for (let s = 1; s <= 120; s++) {
    points.push({ t: end.t + s * 1000, lat: RW08.lat, lon: RW08.lon + ((s * 120) / 3600) / kx, ft: s <= 12 ? 787 : 787 + ((s - 12) * 1000) / 60 });
  }
  const trkpts = points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${(p.ft / 3.28084).toFixed(1)}</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${trkpts.join("")}</trkseg></trk></gpx>`;
}

async function signedIn(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/me", route => route.fulfill(json(A_PILOT)));
  await page.route("**/api/aircraft", route => route.fulfill(json([])));
  await page.route("**/api/flights", route => route.fulfill(json([SUMMARY])));
  await page.route("**/api/flights/12", route => route.fulfill(json(FLIGHT)));
  await page.route("**/api/flights/12/track", route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) }));
  // A URL predicate, not a glob: `**` spans a whole segment only.
  await page.route(url => url.pathname === "/api/airport/KBUR/procedures", route => route.fulfill(json(LIST)));
  await page.route(url => url.pathname.startsWith("/api/airport/KBUR/procedures/") && !url.pathname.endsWith("/plate"), route => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const transition = url.searchParams.get("transition");
    const drawn = DRAWINGS[transition ? `${id}:${transition}` : id];
    return drawn ? route.fulfill(json(drawn)) : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "No such transition here" }) });
  });
}

test("a track down the ILS's final is debriefed against it: the approach found, drawn, and what was off listed", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app/plan");
  await showTabs(page);
  await openConsole(page);
  await library(page, "Flights");
  await page.getByRole("button", { name: /^KVNY → KBUR/ }).click();
  const flightPage = page.getByTestId("console-page").last();
  await flightPage.getByTestId("debrief-file").setInputFiles({ name: "ils.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx()) });

  const approach = flightPage.getByTestId("approach-debrief");
  await expect(approach.getByTestId("approach-name")).toContainText("ILS Y RWY 08");
  await expect(approach.getByTestId("approach-name")).toContainText("The same final as the RNAV (GPS) Z RWY 08");
  await expect(approach.getByTestId("approach-plan")).toBeVisible();
  await expect(approach.getByTestId("approach-profile")).toBeVisible();
  const findings = approach.getByTestId("approach-finding");
  await expect(findings.filter({ hasText: /^Full scale left of the course for \d\.\d nm on final/ })).toHaveCount(1);
  await expect(findings.filter({ hasText: /^Missed approach started 1[0-4] s after the MAP$/ })).toHaveCount(1);
  await expect(findings.filter({ hasText: /^Lowest before the MAP: 787 ft$/ })).toHaveCount(1);

  // The pilot's minimums from the plate, typed: under them before the
  // missed approach is marked.
  await approach.getByTestId("approach-minimums").fill("1000");
  await expect(findings.filter({ hasText: "Down to 787 before the missed approach, 213 ft below 1,000" })).toHaveCount(1);
});

test("a track that flew no approach shows none", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app/plan");
  await showTabs(page);
  await openConsole(page);
  await library(page, "Flights");
  await page.getByRole("button", { name: /^KVNY → KBUR/ }).click();
  const flightPage = page.getByTestId("console-page").last();
  // The same flight two miles north of the final all the way.
  const north = gpx().replace(/lat="([\d.]+)"/g, (_, lat: string) => `lat="${(Number(lat) + 2 / 60).toFixed(6)}"`);
  await flightPage.getByTestId("debrief-file").setInputFiles({ name: "north.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(north) });
  await expect(flightPage.getByTestId("debrief-leg")).toHaveCount(1);
  await expect(flightPage.getByTestId("approach-debrief")).toHaveCount(0);
});
