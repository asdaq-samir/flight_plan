/**
 * A field's forecast, as the briefing's weather reads it (WeatherAlongRoute)
 * and the Brief's glance says it (lib/glance): the places of the route in
 * order, a field's own TAF or the nearest within NEAREST_TAF_NM, and the
 * flight category for when the flight is there.
 */
import type { Briefing, Course } from "../../../../lib/api/types";
import { distanceNm } from "../../../../lib/geo";
import { categoryOf } from "../../../../lib/map/flightCategory";

export type Station = Briefing["forecast"]["stations"][number];

export const NEAREST_TAF_NM = 25;

export interface Place {
  ident: string;
  role: string;
  lat: number;
  lon: number;
  alongNm: number;
}

export function placesOf(course: Course): Place[] {
  const points = [course.departure, ...(course.stops ?? []), course.destination];
  // A local flight, one field to itself, is one place.
  if (points.length === 2 && points[0]!.ident === points[1]!.ident) {
    const p = points[0]!;
    return [{ ident: p.ident, role: "Local", lat: p.lat, lon: p.lon, alongNm: 0 }];
  }
  let along = 0;
  return points.flatMap((p, i) => {
    if (i > 0) along += distanceNm(points[i - 1]!, p);
    if (p.kind === "fix") return [];
    const role = i === 0 ? "Departure" : i === points.length - 1 ? "Destination" : "Stop";
    return [{ ident: p.ident, role, lat: p.lat, lon: p.lon, alongNm: along }];
  });
}

export const ownStation = (stations: Station[], ident: string) =>
  stations.find(s => s.icaoId === ident || (ident.length === 3 && s.icaoId === `K${ident}`));

export const categoryAt = (station: Station) => categoryOf(station.eta_ceiling_ft, station.eta_visibility_sm);

/** The nearest TAF to a field without its own, within NEAREST_TAF_NM, and
 *  how far it is; none past that. */
export function nearestStation(stations: Station[], place: { lat: number; lon: number }): { s: Station; nm: number } | undefined {
  return stations
    .map(s => ({ s, nm: s.lat != null && s.lon != null ? distanceNm(place, { lat: s.lat, lon: s.lon }) : Infinity }))
    .filter(x => x.nm <= NEAREST_TAF_NM)
    .sort((a, b) => a.nm - b.nm)[0];
}

/** A field's flight category for when the flight is there, as its
 *  Forecast row says it: its own TAF's, else the nearest's; else its
 *  METAR's; null where none says. The Brief's glance (lib/glance). */
export function fieldCategory(briefing: Briefing, course: Course, ident: string): string | null {
  const stations = briefing.forecast.stations;
  const place = placesOf(course).find(p => p.ident === ident);
  const station = ownStation(stations, ident) ?? (place ? nearestStation(stations, place)?.s : undefined);
  return (station ? categoryAt(station) : null) ?? briefing.metars[ident]?.flight_category ?? null;
}
