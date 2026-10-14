import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import type { TrafficAircraft } from "../../../lib/api/types";
import { type AircraftFilter, filtering, inEmergency, keptFilter, matches, relationTo, sameField } from "../../../lib/fbo";
import { distanceNm, type LatLon } from "../../../lib/geo";
import { usePreferences } from "../../../lib/preferences";

const NONE: TrafficAircraft[] = [];

/** How far round an airport its traffic is asked for, nm (lib/fbo
 *  RELATION_NM, an inbound airplane's reach). */
const AIRPORT_TRAFFIC_NM = 40;
/** Asked again this often, ms: adsb.lol's pace, a region's (vfr.traffic). */
const FILTER_REFRESH_MS = 10_000;

/**
 * The questions the Aircraft pill's second strip asks, its title's menu,
 * at the owner's pick of the redesign: the airplanes nearest the pilot,
 * those about an airport, inbound to it, departing it, based at it, or
 * squawking an emergency. Each is a setting of the one filter the full
 * list had (lib/fbo).
 */
export type Question = "near" | "around" | "inbound" | "departing" | "based" | "emergency";

export const QUESTIONS: { value: Question; label: string; airport: boolean }[] = [
  { value: "near", label: "Nearest me", airport: false },
  { value: "around", label: "Around an airport", airport: true },
  { value: "inbound", label: "Inbound to an airport", airport: true },
  { value: "departing", label: "Departing an airport", airport: true },
  { value: "based", label: "Based at an airport", airport: true },
  { value: "emergency", label: "Emergencies", airport: false },
];

/** The question a filter asks; one asking nothing yet is the nearest. */
export function questionOf(f: AircraftFilter): Question {
  if (f.emergency && f.place === "map") return "emergency";
  if (f.place === "airport") return f.relation;
  return "near";
}

/** The filter's setting for a question, the rest of it (kind, height,
 *  operator) kept. */
export function filterFor(q: Question): Partial<AircraftFilter> {
  if (q === "near") return { place: "near", emergency: false };
  if (q === "emergency") return { place: "map", emergency: true };
  return { place: "airport", relation: q, emergency: false };
}

/** The filter as asked: one asking nothing yet is the nearest, at the
 *  owner's pick of a NEAREST strip (it listed nothing until asked). */
function asAsked(f: AircraftFilter): AircraftFilter {
  return f.place === "map" && !filtering(f) ? { ...f, place: "near" } : f;
}

export { useTrafficFocus } from "../../../lib/map/tracking";

/**
 * The airplanes the strip's question keeps, of those its place gives: the
 * map's, those near the pilot, or round an airport (asked of the planner),
 * then its relation and emergency (lib/fbo). The kind, height and operator
 * the full list's filters set once are let go: that list is gone, at the
 * owner's ask ("don't need the extra filters at the bottom").
 */
export function useFilteredAircraft(seen: TrafficAircraft[], from: LatLon | null) {
  const filter = asAsked({ ...keptFilter(usePreferences(s => s.aircraftFilter)), kind: "any", band: "any", operator: "" });
  const ident = filter.place === "airport" ? filter.airport.trim().toUpperCase() : "";
  const { data: field, isError: noField } = useQuery({
    queryKey: ["airport", ident], queryFn: () => api.airport(ident), enabled: ident.length >= 3, staleTime: 5 * 60_000,
    meta: { silent: true },
  });
  // The traffic the place asks for: round the airport, or near the pilot;
  // the map's own where it is the map.
  const center = filter.place === "airport" ? (field ? { lat: field.lat, lon: field.lon } : null)
    : filter.place === "near" ? from : null;
  const radius = filter.place === "airport" ? AIRPORT_TRAFFIC_NM : filter.nearNm;
  const { data: around } = useQuery({
    queryKey: ["trafficFilter", center ? Math.round(center.lat * 20) / 20 : null, center ? Math.round(center.lon * 20) / 20 : null, radius],
    queryFn: () => api.traffic({ lat: center!.lat, lon: center!.lon, radius }), enabled: !!center,
    refetchInterval: FILTER_REFRESH_MS, meta: { silent: true },
  });
  const aroundPlanes = around?.aircraft;
  const pool = useMemo(() => (filter.place === "map" ? seen : aroundPlanes ?? NONE), [filter.place, seen, aroundPlanes]);
  const placed = useMemo(() => {
    if (filter.place === "near" && from) return pool.filter(p => distanceNm(from, p) <= filter.nearNm);
    if (filter.place !== "airport" || !field) return filter.place === "airport" ? [] : pool;
    const at = { lat: field.lat, lon: field.lon, elevationFt: field.elevation_ft ?? 0 };
    if (filter.relation === "based") return pool;
    return pool.filter(p => relationTo(p, at)[filter.relation as "around" | "inbound" | "departing"]);
  }, [pool, filter.place, filter.nearNm, filter.relation, field, from]);
  // Based at the field: where each about it keeps to (vfr.traffic.based),
  // asked again while some are still being looked up.
  const basedAsk = filter.place === "airport" && filter.relation === "based" && field ? placed.map(p => p.hex).slice(0, 60) : [];
  const { data: bases } = useQuery({
    queryKey: ["trafficBased", basedAsk.join(",")], queryFn: () => api.trafficBased(basedAsk), enabled: basedAsk.length > 0,
    refetchInterval: query => ((query.state.data?.pending.length ?? 0) > 0 ? 5_000 : false), meta: { silent: true },
  });
  const kept = placed.filter(p => matches(p, filter)
    && (filter.relation !== "based" || filter.place !== "airport" || (!!field && !!bases?.based[p.hex] && sameField(bases.based[p.hex]!.ident, field.ident))));
  const looking = filter.relation === "based" && filter.place === "airport" && (bases?.pending.length ?? 0) > 0;
  return { filter, field, noField, pool, kept, looking };
}

/** A field as the strip measures from: where it is and how high (NASR's
 *  elevation, the planner's airport record). */
type Field = LatLon & { elevation_ft?: number | null };

/**
 * What the strip says under each airplane, and its order, by question:
 * how far from the pilot; how high above the field, lowest first -- the
 * pattern first, a traffic pattern being flown 1,000 ft above it (AIM
 * 4-3-3); minutes out, soonest first, at its ground speed; how far out
 * from the field; the code squawked (7700, 7600, 7500: AIM 6-2-2, 6-4-2,
 * 6-3-4). Height above the field is the airplane's reported altitude less
 * the field's elevation: a band to look by, GNSS or pressure as sent.
 */
export function strip(q: Question, planes: TrafficAircraft[], from: LatLon | null, field: Field | null | undefined):
  { plane: TrafficAircraft; detail: string }[] {
  const nm = (a: LatLon | null | undefined, p: TrafficAircraft) => (a ? distanceNm(a, p) : Infinity);
  const miles = (n: number) => (Number.isFinite(n) ? `${Math.round(n)} nm` : "");
  const rows = planes.map(plane => {
    if (q === "near") return { plane, key: nm(from, plane), detail: miles(nm(from, plane)) };
    if (q === "emergency") {
      const code = ["7500", "7600", "7700"].includes(plane.squawk ?? "") ? plane.squawk! : inEmergency(plane) ? "Emergency" : "";
      const away = miles(nm(from, plane));
      return { plane, key: nm(from, plane), detail: away ? `${code} · ${away}` : code };
    }
    if (q === "around") {
      const above = plane.altitude_ft != null && field ? plane.altitude_ft - (field.elevation_ft ?? 0) : null;
      return { plane, key: above ?? Infinity, detail: above == null ? "" : `${(Math.round(above / 100) * 100).toLocaleString("en-US")} AGL` };
    }
    if (q === "inbound") {
      const out = nm(field, plane);
      const minutes = plane.speed_kt ? out / plane.speed_kt * 60 : null;
      return { plane, key: minutes ?? out, detail: minutes == null ? miles(out) : `${Math.max(1, Math.round(minutes))} min` };
    }
    return { plane, key: nm(field, plane), detail: miles(nm(field, plane)) };
  });
  return rows.sort((a, b) => a.key - b.key).map(({ plane, detail }) => ({ plane, detail }));
}
