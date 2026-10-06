import { describe, expect, it } from "vitest";
import { foreflightRoute, fplOf, gpxOf, type PlanPoint } from "./flightPlanFiles";

const points: PlanPoint[] = [
  { ident: "C81", name: "Campbell Airport", kind: "airport", lat: 42.3246, lon: -88.0741 },
  { ident: "", name: "Bangs Lake & dam", kind: "checkpoint", lat: 42.37, lon: -88.08 },
  { ident: "VPBNG", name: "VFR waypoint by Bangs Lake", kind: "fix", lat: 42.38, lon: -88.09 },
  { ident: "KDLH", name: "Duluth International Airport", kind: "airport", lat: 46.8421, lon: -92.1936 },
];

describe("flight plan files", () => {
  it("a Garmin flight plan: airports by ident, the VFR waypoint a fix, a checkpoint a user waypoint", () => {
    const fpl = fplOf(points, "C81 to KDLH", new Date("2026-10-04T12:00:00Z"));
    expect(fpl).toContain("<created>2026-10-04T12:00:00Z</created>");
    expect(fpl.match(/<waypoint-identifier>[^<]+/g)!.map(m => m.slice(21))).toEqual(["C81", "CP01", "VPBNG", "KDLH"]);
    expect(fpl).toContain("<type>INT-VRP</type>");
    expect(fpl).toContain("<type>USER WAYPOINT</type>");
    expect(fpl).toContain("<comment>BANGS LAKE &amp; DAM</comment>");
    expect(fpl).toContain("<lat>46.842100</lat>");
  });

  it("an airport twice -- a round trip -- is in the table once and the route twice", () => {
    const fpl = fplOf([points[0]!, points[1]!, points[0]!], "C81 local");
    expect(fpl.match(/<waypoint>/g)).toHaveLength(2);
    expect(fpl.match(/<route-point>/g)).toHaveLength(3);
  });

  it("ForeFlight's link: the route in order, a checkpoint at its place, and the altitude", () => {
    expect(foreflightRoute(points, 4500)).toBe("foreflightmobile://maps/search?q=C81+42.3700/-88.0800+VPBNG+KDLH+4500ft");
    expect(foreflightRoute(points, null)).toBe("foreflightmobile://maps/search?q=C81+42.3700/-88.0800+VPBNG+KDLH");
  });

  it("a GPX route through the same points", () => {
    const gpx = gpxOf(points, "C81 to KDLH");
    expect(gpx.match(/<rtept /g)).toHaveLength(4);
    expect(gpx).toContain('<rtept lat="42.370000" lon="-88.080000"><name>CP01</name><desc>Bangs Lake &amp; dam</desc></rtept>');
  });
});
