/**
 * A route's points as the files a panel GPS imports take them (the other
 * modules here: Garmin's .fpl and .gfp, the GTN's user.wpt, GPX, Dynon's
 * waypoints): each with the identifier its database knows it by, its
 * Garmin type and ICAO region (the planner's /api/waypoint-codes, from the
 * FAA's CIFP and NASR), and the airway flown into it. A checkpoint, which
 * no database holds, is a user waypoint at its place, named by its own
 * name in the six letters and digits a GTN keeps (190-01007-F0 3.2).
 */

export interface PlanPoint {
  ident: string;
  /** What the log calls it: the airport's name, the checkpoint's. */
  name: string;
  kind: "airport" | "fix" | "checkpoint";
  lat: number;
  lon: number;
  /** A checkpoint's waypoint in the route's ForeFlight pack (LAKE_ZURICH). */
  waypoint?: string | null;
  /** The airway the leg into it is flown along ("V191"), where it is. */
  airway?: string | null;
  /** Its Garmin type and ICAO region, where the planner found them. */
  code?: { type: string | null; region: string | null } | null;
}

/** The types of a Garmin flight plan (FlightPlanv1.xsd WaypointType_t). */
export type GarminType = "AIRPORT" | "VOR" | "NDB" | "INT" | "INT-VRP" | "USER WAYPOINT";
const GARMIN_TYPES = new Set<string>(["AIRPORT", "VOR", "NDB", "INT", "INT-VRP"]);

export interface NamedPoint extends PlanPoint {
  /** Its identifier in the files: the database's, or the user waypoint's name. */
  id: string;
  type: GarminType;
  /** Its ICAO region ("K3"), empty for a user waypoint or one not found. */
  region: string;
}

/** Text as a Garmin comment or route name takes it: capitals, figures,
 *  spaces and "/" only, 25 at most (FlightPlanv1.xsd Comment_t and
 *  RouteName_t; the GTN's user.wpt comment, 190-01007-F0 3.2). */
export function garminText(text: string, max = 25): string {
  return text.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 /]+/g, " ").replace(/\s+/g, " ").trim()
    .slice(0, max).trim();
}

/** A VFR waypoint's identifier: the FAA names them VP and three letters. */
const VFR_WAYPOINT = /^VP[A-Z0-9]{3}$/;

/** Each point with its identifier, type and region: a checkpoint a user
 *  waypoint named from its own name, six characters at most and none the
 *  same as another point's. */
export function namedPoints(points: PlanPoint[]): NamedPoint[] {
  const taken = new Set(points.filter(p => p.kind !== "checkpoint").map(p => p.ident.toUpperCase()));
  const names = new Map<PlanPoint, string>();
  for (const p of points) {
    if (p.kind !== "checkpoint" || names.has(p)) continue;
    const base = garminText(p.name).replace(/[^A-Z0-9]/g, "").slice(0, 6) || "CP";
    let id = base;
    for (let n = 1; taken.has(id); n += 1) id = base.slice(0, 6 - String(n).length) + n;
    taken.add(id);
    names.set(p, id);
  }
  return points.map(p => {
    if (p.kind === "checkpoint") return { ...p, id: names.get(p)!, type: "USER WAYPOINT", region: "" };
    const id = p.ident.toUpperCase();
    const known = p.code?.type && GARMIN_TYPES.has(p.code.type) ? (p.code.type as GarminType) : null;
    const type: GarminType = known ?? (p.kind === "airport" ? "AIRPORT" : VFR_WAYPOINT.test(id) ? "INT-VRP" : "INT");
    return { ...p, id, type, region: p.code?.region && /^[A-Z0-9]{2}$/.test(p.code.region) ? p.code.region : "" };
  });
}

/** The panels' limit: a GTN cuts a flight plan after 99 waypoints (GTN Xi
 *  Pilot's Guide 190-02327-03, Import a Flight Plan), a SkyView reads the
 *  first 99 route points (SkyView HDX Pilot's User Guide Rev J, 5-47). */
export const PANEL_MAX_POINTS = 99;

/** A file name a panel's card reader takes: letters, figures, "-" and "_"
 *  (190-01007-F0 2.1). */
export function panelFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "ROUTE";
}
