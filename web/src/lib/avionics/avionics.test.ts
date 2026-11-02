import { describe, expect, it } from "vitest";
import { fplOf } from "./fpl";
import { gfpOf, gtnApproach, gtnPlace, gtnRunway, isApproach } from "./gfp";
import { garminText, namedPoints, type PlanPoint } from "./points";
import { DYNON_HEADER, dynonUserWaypointsOf, gpxOf, gtnUserWaypointsOf } from "./waypointFiles";

/** KDLH to KMSP as the planner lays it out: the Duluth VOR, Victor 505 to
 *  Gopher (NASR: "PRIOR GEP DLH" on V505), a checkpoint at Medicine Lake,
 *  and Minneapolis, its types and regions as /api/waypoint-codes gives
 *  them (the CIFP's K3). */
const route: PlanPoint[] = [
  { ident: "KDLH", name: "Duluth International Airport", kind: "airport", lat: 46.842091, lon: -92.193649, code: { type: "AIRPORT", region: "K3" } },
  { ident: "DLH", name: "Duluth", kind: "fix", lat: 46.802164, lon: -92.202869, code: { type: "VOR", region: "K3" } },
  { ident: "GEP", name: "Gopher", kind: "fix", lat: 45.145685, lon: -93.373181, airway: "V505", code: { type: "VOR", region: "K3" } },
  { ident: "", name: "Medicine Lake & beach", kind: "checkpoint", lat: 45.008, lon: -93.417 },
  { ident: "KMSP", name: "Minneapolis-St Paul Intl/Wold-Chamberlain", kind: "airport", lat: 44.881956, lon: -93.221767, code: { type: "AIRPORT", region: "K3" } },
];
// At Minneapolis: the BAINY FOUR from MILAC (the CIFP's BAINY4) and the
// ILS to 30L, by vectors.
const procedures = {
  arrival: { ident: "KMSP", id: "BAINY4", transition: "MILAC" },
  approach: { ident: "KMSP", id: "I30L", transition: null },
};
const created = new Date("2026-11-02T12:00:00Z");

/** The schema's own patterns (www8.garmin.com/xmlschemas/FlightPlanv1.xsd). */
const XSD = {
  identifier: /^[A-Z0-9]{1,12}$/,
  type: /^(USER WAYPOINT|AIRPORT|NDB|VOR|INT|INT-VRP)$/,
  countryCode: /^([A-Z0-9]{2})?$/,
  comment: /^([A-Z0-9 /]{1,25})?$/,
};
const values = (text: string, tag: string) => [...text.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map(m => m[1]!);

describe("a Garmin flight plan (.fpl)", () => {
  const fpl = fplOf(route, "KDLH to KMSP via Medicine Lake's beach & dam", created);

  it("is the file the golden copy holds", async () => {
    await expect(fpl).toMatchFileSnapshot("./golden/KDLH-KMSP.fpl");
  });

  it("keeps to the schema's patterns, the route name and comments in its characters", () => {
    for (const id of [...values(fpl, "identifier"), ...values(fpl, "waypoint-identifier")]) expect(id).toMatch(XSD.identifier);
    for (const type of [...values(fpl, "type"), ...values(fpl, "waypoint-type")]) expect(type).toMatch(XSD.type);
    for (const code of [...values(fpl, "country-code"), ...values(fpl, "waypoint-country-code")]) expect(code).toMatch(XSD.countryCode);
    for (const comment of [...values(fpl, "comment"), ...values(fpl, "route-name")]) expect(comment).toMatch(XSD.comment);
    expect(values(fpl, "route-name")).toEqual(["KDLH TO KMSP VIA MEDICINE"]);
    // Every route point in the table, by identifier, type and region (the
    // schema's key and keyref).
    const table = new Set(fpl.split("<waypoint>").slice(1).map(w => `${values(w, "identifier")}|${values(w, "type")}|${values(w, "country-code")}`));
    for (const point of fpl.split("<route-point>").slice(1)) {
      expect(table.has(`${values(point, "waypoint-identifier")}|${values(point, "waypoint-type")}|${values(point, "waypoint-country-code")}`)).toBe(true);
    }
  });

  it("writes each point's region, a user waypoint's empty, and its own type", () => {
    expect(fpl).toContain("<identifier>KDLH</identifier>\n      <type>AIRPORT</type>\n      <country-code>K3</country-code>");
    expect(fpl).toContain("<identifier>DLH</identifier>\n      <type>VOR</type>");
    expect(fpl).toContain("<identifier>MEDICI</identifier>\n      <type>USER WAYPOINT</type>\n      <country-code></country-code>");
  });

  it("without the planner's codes, an airport by name, a VFR waypoint a VRP, any other point an intersection", () => {
    const named = namedPoints([
      { ident: "C81", name: "Campbell", kind: "airport", lat: 42.32, lon: -88.07 },
      { ident: "VPBNG", name: "Bangs Lake", kind: "fix", lat: 42.27, lon: -88.13 },
      { ident: "BAEBE", name: "Baebe", kind: "fix", lat: 43, lon: -88 },
    ]);
    expect(named.map(p => [p.id, p.type, p.region])).toEqual([["C81", "AIRPORT", ""], ["VPBNG", "INT-VRP", ""], ["BAEBE", "INT", ""]]);
  });

  it("an airport twice -- a round trip -- is in the table once and the route twice", () => {
    const fpl = fplOf([route[0]!, route[3]!, route[0]!], "KDLH local");
    expect(fpl.match(/<waypoint>/g)).toHaveLength(2);
    expect(fpl.match(/<route-point>/g)).toHaveLength(3);
  });
});

describe("checkpoints as user waypoints", () => {
  it("named from their own names, six characters, none the same as another point's", () => {
    const named = namedPoints([
      { ident: "MEDICI", name: "Medici", kind: "fix", lat: 45, lon: -93 },
      { ident: "", name: "Medicine Lake", kind: "checkpoint", lat: 45.01, lon: -93.4 },
      { ident: "", name: "Medicine Lake north", kind: "checkpoint", lat: 45.02, lon: -93.4 },
      { ident: "", name: "!!", kind: "checkpoint", lat: 45.03, lon: -93.4 },
    ]);
    expect(named.map(p => p.id)).toEqual(["MEDICI", "MEDIC1", "MEDIC2", "CP"]);
  });

  it("their comments in the characters Garmin takes", () => {
    expect(garminText("Bangs Lake & dam (north)")).toBe("BANGS LAKE AND DAM NORTH");
    expect(garminText("Minneapolis-St Paul Intl/Wold-Chamberlain")).toBe("MINNEAPOLIS ST PAUL INTL/");
  });
});

describe("a GTN flight plan (.gfp)", () => {
  const gfp = gfpOf(route, procedures);

  it("is the file the golden copy holds", async () => {
    await expect(gfp.text).toMatchFileSnapshot("./golden/KDLH-KMSP.gfp");
  });

  it("one line of Garmin's characters, the airway between its entry and exit, the arrival and approach at the end", () => {
    expect(gfp.text).toMatch(/^FPN\/RI:[A-Z0-9:(),.]+$/);
    expect(gfp.text).toBe(
      "FPN/RI:F:KDLH,N46505W092116:F:DLH,N46481W092122.V505.GEP,N45087W093224:F:N45005W093250"
      + ":AA:KMSP:A:BAINY4.MILAC(30L):AP:I30L");
    expect(gfp.waypoints).toBe(5);
    expect(gfp.leftOut).toEqual([]);
  });

  it("matches Garmin's own examples (190-01007-F0 2.5), its places aside", () => {
    const pdx: PlanPoint[] = [
      { ident: "KPDX", name: "Portland", kind: "airport", lat: 45.5887, lon: -122.5975 },
      { ident: "YKM", name: "Yakima", kind: "fix", lat: 46.57, lon: -120.44 },
      { ident: "ELN", name: "Ellensburg", kind: "fix", lat: 47.02, lon: -120.45, airway: "V448" },
      { ident: "GEG", name: "Spokane", kind: "fix", lat: 47.56, lon: -117.62, airway: "V448" },
      { ident: "HQM", name: "Hoquiam", kind: "fix", lat: 46.94, lon: -124.15, airway: "V204" },
      { ident: "SEA", name: "Seattle", kind: "fix", lat: 47.435, lon: -122.31 },
      { ident: "KHIO", name: "Hillsboro", kind: "airport", lat: 45.54, lon: -122.95 },
    ];
    const text = gfpOf(pdx, {
      departure: { ident: "KPDX", id: "LAVAA5", transition: "YKM" }, takeoffRunway: "10R",
      arrival: { ident: "KHIO", id: "HELNS5", transition: "SEA" }, approach: { ident: "KHIO", id: "R13", transition: null },
    }).text.replace(/,[NS]\d{5}[EW]\d{6}/g, "");
    // Garmin's, but for SEA's place, which it gives and this leaves to the
    // strip above, and the arrival's runway, the approach's 13 here where
    // Garmin wrote 13O ("none specified").
    expect(text).toBe("FPN/RI:DA:KPDX:D:LAVAA5.YKM:R:10R:F:YKM.V448.GEG.V204.HQM:F:SEA:AA:KHIO:A:HELNS5.SEA(13O):AP:R13");
    expect(gfpOf([
      { ident: "KSLE", name: "Salem", kind: "airport", lat: 44.91, lon: -123.0 },
      { ident: "", name: "One", kind: "checkpoint", lat: 45.3717, lon: -121.6983 },
      { ident: "", name: "Two", kind: "checkpoint", lat: 42.9467, lon: -122.1117 },
      { ident: "KSLE", name: "Salem", kind: "airport", lat: 44.91, lon: -123.0 },
    ], { approach: { ident: "KSLE", id: "I31", transition: "JAIME" } }).text.replace(/,[NS]\d{5}[EW]\d{6}/g, ""))
      .toBe("FPN/RI:F:KSLE:F:N45223W121419:F:N42568W122067:AA:KSLE:AP:I31.JAIME");
  });

  it("places, runways and approaches as the GTN writes them", () => {
    expect(gtnPlace(44.91, -123.001667)).toBe("N44546W123001");
    expect(gtnPlace(-31.4, 136.836667)).toBe("S31240E136502");
    expect(gtnRunway("9")).toBe("09O");
    expect(gtnRunway("27L")).toBe("27L");
    expect(gtnRunway("NE")).toBeNull();
    expect(["I30L", "R12LZ", "I35-Z", "H35-Y", "VDM-A", "LDA-B"].map(gtnApproach)).toEqual(["I30L", "R12L", "I35", "H35", "CVDM", null]);
    expect(["I30L", "VDM-A", "BAINY4", "LAVAA5"].map(isApproach)).toEqual([true, true, false, false]);
  });

  it("an approach the GTN has no code for is left out, and said", () => {
    const gfp = gfpOf(route, { approach: { ident: "KMSP", id: "LDA-B", transition: null } });
    expect(gfp.leftOut).toEqual(["LDA-B"]);
    expect(gfp.text.endsWith(":F:KMSP,N44529W093133")).toBe(true);
  });
});

describe("the panels' user waypoint files", () => {
  it("a GTN's user.wpt: name, comment, latitude, longitude, a carriage return after each", async () => {
    const wpt = gtnUserWaypointsOf(route);
    expect(wpt).toBe("MEDICI,MEDICINE LAKE AND BEACH,45.008000,-93.417000\r\n");
    await expect(wpt).toMatchFileSnapshot("./golden/user.wpt");
  });

  it("a SkyView's CSV under Dynon's header, word for word", async () => {
    const csv = dynonUserWaypointsOf(route);
    expect(csv.split("\r\n")[0]).toBe(DYNON_HEADER);
    expect(csv.split("\r\n")[1]).toBe('MEDICI,MEDICINE LAKE AND BEAC,45.008000,-93.417000,,PIN_BLUE,"Medicine Lake & beach"');
    await expect(csv).toMatchFileSnapshot("./golden/KDLH-KMSP-waypoints.csv");
  });

  it("a GPX route with every point, named as the .fpl names them", async () => {
    const gpx = gpxOf(route, "KDLH to KMSP");
    expect(gpx.match(/<rtept /g)).toHaveLength(5);
    expect(gpx).toContain('<rtept lat="45.008000" lon="-93.417000"><name>MEDICI</name><desc>Medicine Lake &amp; beach</desc></rtept>');
    await expect(gpx).toMatchFileSnapshot("./golden/KDLH-KMSP.gpx");
  });
});
