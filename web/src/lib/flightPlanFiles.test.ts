import { describe, expect, it } from "vitest";
import { foreflightRoute, type PlanPoint } from "./flightPlanFiles";

const points: PlanPoint[] = [
  { ident: "C81", name: "Campbell Airport", kind: "airport", lat: 42.3246, lon: -88.0741 },
  { ident: "", name: "Bangs Lake & dam", kind: "checkpoint", lat: 42.37, lon: -88.08 },
  { ident: "VPBNG", name: "VFR waypoint by Bangs Lake", kind: "fix", lat: 42.38, lon: -88.09 },
  { ident: "KDLH", name: "Duluth International Airport", kind: "airport", lat: 46.8421, lon: -92.1936 },
];

describe("the route to ForeFlight", () => {
  it("ForeFlight's link: the route in order, a checkpoint at its place, and the altitude", () => {
    expect(foreflightRoute(points, 4500)).toBe("foreflightmobile://maps/search?q=C81+42.3700/-88.0800+VPBNG+KDLH+4500ft");
    expect(foreflightRoute(points, null)).toBe("foreflightmobile://maps/search?q=C81+42.3700/-88.0800+VPBNG+KDLH");
    // By name, its pack's waypoint, once the pack is in ForeFlight.
    const named = points.map(p => (p.kind === "checkpoint" ? { ...p, waypoint: "BANGS_LAKE" } : p));
    expect(foreflightRoute(named, 4500, true)).toBe("foreflightmobile://maps/search?q=C81+CONTPACK@BANGS_LAKE+VPBNG+KDLH+4500ft");
    expect(foreflightRoute(named, 4500)).toContain("+42.3700/-88.0800+");
  });
});
