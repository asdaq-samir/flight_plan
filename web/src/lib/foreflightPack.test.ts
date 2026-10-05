import { describe, expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { contentPack, packFiles, waypointDescription, waypointNames, type PackRoute } from "./foreflightPack";

const ROUTE: PackRoute = {
  dep: "C81",
  dest: "KDLH",
  stops: [],
  line: [[42.32, -88.09], [46.84, -92.19]],
  checkpoints: [
    { name: "Town", category: "town", lat: 42.372, lon: -88.0928, score: 5, alongNm: 2.9, headingDeg: 322, altitudeFt: 4500, minutesFlown: 2.4 },
    { name: "Lake", category: "water", lat: 42.9773, lon: -88.6116, score: 3.18, alongNm: 45.8 },
    { name: "Road or railway", category: "road_or_rail", lat: 43.1313, lon: -88.7558, score: 2.62, alongNm: 57 },
  ],
};
const CREATED = new Date("2026-10-05T19:45:00Z");

describe("a ForeFlight content pack of the route's checkpoints", () => {
  test("waypoint names follow ForeFlight's rules and name the route", () => {
    const names = waypointNames(ROUTE);
    expect(names).toEqual(["C81DLH01", "C81DLH02", "C81DLH03"]);
    for (const name of names) {
      // Capitals, one word, at least three characters, a letter among them.
      expect(name).toMatch(/^[A-Z0-9_]{3,}$/);
      expect(name).toMatch(/[A-Z]/);
    }
  });

  test("each waypoint's line fits the 30 to 40 characters ForeFlight shows", () => {
    expect(waypointDescription(ROUTE.checkpoints[0]!)).toBe("Town, 5.0/5, 3 nm");
    for (const cp of ROUTE.checkpoints) expect(waypointDescription(cp).length).toBeLessThanOrEqual(30);
  });

  test("one folder: a manifest, the waypoints, a page per waypoint named for it, and the course layer", () => {
    const files = packFiles(ROUTE, CREATED);
    const paths = Object.keys(files).sort();
    expect(paths).toEqual([
      "Wingtip-C81-DLH/layers/C81-DLH course.kml",
      "Wingtip-C81-DLH/manifest.json",
      "Wingtip-C81-DLH/navdata/C81DLH01Checkpoint 1 of 3, Town.txt",
      "Wingtip-C81-DLH/navdata/C81DLH02Checkpoint 2 of 3, Lake.txt",
      "Wingtip-C81-DLH/navdata/C81DLH03Checkpoint 3 of 3, Road or railway.txt",
      "Wingtip-C81-DLH/navdata/Checkpoints.kml",
    ]);
    const manifest = JSON.parse(files["Wingtip-C81-DLH/manifest.json"]!);
    expect(manifest).toMatchObject({ name: "Wingtip checkpoints C81-KDLH", abbreviation: "WT.C81DLH", organizationName: "Wingtip Maps", effectiveDate: "20261005T19:45:00Z" });
    expect(manifest.version).toBe(20261005.1945);
    const kml = files["Wingtip-C81-DLH/navdata/Checkpoints.kml"]!;
    expect(kml).toContain("<name>C81DLH02</name><description>Lake, 3.2/5, 46 nm</description><Point><coordinates>-88.611600,42.977300,0</coordinates></Point>");
  });

  test("a page says what to look for, the leg flown to it where known, and what comes next", () => {
    const files = packFiles(ROUTE, CREATED);
    const first = files["Wingtip-C81-DLH/navdata/C81DLH01Checkpoint 1 of 3, Town.txt"]!;
    expect(first).toContain("Checkpoint 1 of 3, C81 → KDLH");
    expect(first).toContain("the yellow of its built-up area");
    expect(first).toContain("5.0 of 5");
    expect(first).toContain("322°");
    expect(first).toContain("4,500 ft");
    expect(first).toContain("0:02");
    expect(first).toContain("N42°22.3′ W088°05.6′");
    expect(first).toContain("Next: Lake, 42.9 nm on.");
    const last = files["Wingtip-C81-DLH/navdata/C81DLH03Checkpoint 3 of 3, Road or railway.txt"]!;
    expect(last).not.toContain("Magnetic heading");
    expect(last).toContain("The last checkpoint before KDLH.");
  });

  test("zipped, it opens to the same files, each folder an entry of its own", async () => {
    const zipped = await contentPack(ROUTE, CREATED);
    const out = unzipSync(zipped);
    const files = packFiles(ROUTE, CREATED);
    expect(Object.keys(out).filter(path => !path.endsWith("/")).sort()).toEqual(Object.keys(files).sort());
    expect(Object.keys(out).filter(path => path.endsWith("/")).sort()).toEqual(["Wingtip-C81-DLH/", "Wingtip-C81-DLH/layers/", "Wingtip-C81-DLH/navdata/"]);
    expect(strFromU8(out["Wingtip-C81-DLH/manifest.json"]!)).toBe(files["Wingtip-C81-DLH/manifest.json"]);
  });
});
