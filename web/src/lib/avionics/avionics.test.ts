import { describe, expect, it } from "vitest";
import { fplOf } from "./fpl";
import { garminText, namedPoints, type PlanPoint } from "./points";

/** KDLH to KMSP as the planner lays it out: the Duluth VOR, Victor 505 to
 *  Gopher (NASR: "PRIOR GEP DLH" on V505), a checkpoint at Medicine Lake,
 *  and Minneapolis, its types and regions as /api/waypoint-codes gives
 *  them (the CIFP's K3). */
const route: PlanPoint[] = [
  { ident: "KDLH", name: "Duluth International Airport", kind: "airport", lat: 46.842091, lon: -92.193649, code: { type: "AIRPORT", region: "K3" } },
  { ident: "DLH", name: "Duluth", kind: "fix", lat: 46.802164, lon: -92.202869, code: { type: "VOR", region: "K3" } },
  { ident: "GEP", name: "Gopher", kind: "fix", lat: 45.145685, lon: -93.373181, code: { type: "VOR", region: "K3" } },
  { ident: "", name: "Medicine Lake & beach", kind: "checkpoint", lat: 45.008, lon: -93.417 },
  { ident: "KMSP", name: "Minneapolis-St Paul Intl/Wold-Chamberlain", kind: "airport", lat: 44.881956, lon: -93.221767, code: { type: "AIRPORT", region: "K3" } },
];
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
