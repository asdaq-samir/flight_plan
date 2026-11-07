import type { MapPirep, WeatherArea } from "./api/types";
import { callEngine } from "./engine/engine";
import { bearingDeg, destination, distanceNm, type LatLon } from "./geo";

/** Each area's colour by what it warns of, as aviationweather.gov's own
 *  map tells them apart: convective red-orange, icing blue, turbulence
 *  amber, IFR and mountains obscured violet and stone, the winds teal. */
export const AREA_COLOURS: Record<string, string> = {
  convective: "#c2410c",
  Icing: "#2563eb", ICE: "#2563eb",
  Turbulence: "#d97706", TURB: "#d97706",
  "IFR conditions": "#7c3aed", IFR: "#7c3aed",
  "Mountains obscured": "#78716c", "MTN OBSCN": "#78716c",
  "Low-level wind shear": "#be185d",
  "Strong surface winds": "#0f766e",
  ASH: "#57534e",
};

export function areaColour(area: Pick<WeatherArea, "kind" | "hazard">): string {
  if (area.kind === "convective") return AREA_COLOURS.convective!;
  return AREA_COLOURS[area.hazard ?? ""] ?? "#9333ea";
}

/** An altitude as the map's weather writes it, in hundreds of feet after
 *  "FL" (FL045 for 4,500 ft MSL), at the owner's pick (2026-10-20, "make
 *  the altitude to be FL"), kept on 2026-11-06 ("Keep Fl for now") when
 *  asked whether to match the rest of the app (lib/readback altitudeWords:
 *  feet below 18,000, a flight level from it). A flight level proper is a
 *  pressure altitude on 29.92, flown only from 18,000 ft (14 CFR 1.1,
 *  91.121(a)(2)), so below that the figure is still feet MSL. */
export function altitudeWords(feet: number): string {
  return `FL${String(Math.round(feet / 100)).padStart(3, "0")}`;
}

/** What an area is, in words: its title ("G-AIRMET · Icing", "Convective
 *  SIGMET") and its altitudes ("Freezing level to FL160"). */
export function areaWords(area: WeatherArea): { title: string; altitudes: string | null } {
  const kind = area.kind === "gairmet" ? "G-AIRMET" : area.kind === "convective" ? "Convective SIGMET" : area.kind === "airmet" ? "AIRMET" : "SIGMET";
  // A SIGMET's or AIRMET's hazard code in the engine's words (faa.rs
  // sigmet_hazard), the briefing's own; a G-AIRMET's come in words already.
  const hazard = area.kind === "convective" ? null : area.hazard
    ? area.kind === "gairmet" ? area.hazard : callEngine("sigmet_hazard", { hazard: area.hazard, kind: null }) : null;
  const low = area.from_freezing_level ? "Freezing level" : area.low_ft == null ? "Surface" : altitudeWords(area.low_ft);
  const high = area.high_ft == null ? null : altitudeWords(area.high_ft);
  return { title: hazard ? `${kind} · ${hazard}` : kind, altitudes: high ? `${low} to ${high}` : area.low_ft != null ? `${low} and up` : null };
}

/** Whether a point is inside an area's outline ([lat, lon] pairs), by
 *  the even-odd rule: areas are a few hundred miles across, near enough
 *  flat for it. */
export function inside(point: LatLon, ring: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i] as [number, number], [yj, xj] = ring[j] as [number, number];
    if ((yi > point.lat) !== (yj > point.lat) && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** How the route crosses an area: the miles of it inside (the course line
 *  walked a mile at a time), and whether the planned altitude is under,
 *  in or over its altitudes there; null where it does not cross. */
export function routeThrough(area: WeatherArea, line: [number, number][], altitudeFt: number | null): { nm: number; relation: "below" | "in" | "above" | null } | null {
  let nm = 0;
  for (let i = 1; i < line.length; i++) {
    const a = { lat: line[i - 1]![0], lon: line[i - 1]![1] }, b = { lat: line[i]![0], lon: line[i]![1] };
    const length = distanceNm(a, b), course = bearingDeg(a, b);
    for (let s = 0.5; s < length; s += 1) if (inside(destination(a, course, s), area.coords)) nm += Math.min(1, length - s + 0.5);
  }
  if (nm < 0.5) return null;
  if (altitudeFt == null || area.from_freezing_level) return { nm, relation: null };
  const low = area.low_ft ?? -Infinity, high = area.high_ft ?? Infinity;
  return { nm, relation: altitudeFt < low ? "below" : altitudeFt > high ? "above" : "in" };
}

/** A pilot report's mark: what it met, worst first -- urgent, turbulence,
 *  icing, else the sky -- and its altitude in hundreds of feet, as a
 *  PIREP writes it ("065"). */
export function pirepMark(p: MapPirep): { glyph: string; colour: string; level: string } {
  const level = p.altitude_ft == null ? "---" : String(Math.round(p.altitude_ft / 100)).padStart(3, "0");
  if (p.urgent) return { glyph: "!", colour: "#dc2626", level };
  if (p.turbulence && !/NEG|NONE/i.test(p.turbulence)) return { glyph: "⌁\uFE0E", colour: "#d97706", level };
  if (p.icing && !/NEG|NONE/i.test(p.icing)) return { glyph: "❄\uFE0E", colour: "#2563eb", level };
  return { glyph: "☁\uFE0E", colour: "#57534e", level };
}

/**
 * A wind barb, as a station model draws one (the NWS's): the staff points
 * where the wind comes from, a pennant for each 50 kt, a full barb each 10
 * and a half barb for 5; under 3 kt, a circle, calm. Its SVG, 44 square,
 * the station at its middle.
 */
export function barbSvg(dirTrueDeg: number, speedKt: number): string {
  const c = 22;
  if (speedKt < 3) return `<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="${c}" cy="${c}" r="5" fill="none" stroke="#111" stroke-width="2"/></svg>`;
  let left = Math.round(speedKt / 5) * 5;
  const marks: string[] = [];
  let y = c - 20;
  while (left >= 50) { marks.push(`<path d="M${c} ${y} L${c + 10} ${y + 3} L${c} ${y + 6} Z" fill="#111"/>`); y += 7; left -= 50; }
  while (left >= 10) { marks.push(`<line x1="${c}" y1="${y}" x2="${c + 10}" y2="${y - 4}" stroke="#111" stroke-width="2"/>`); y += 4; left -= 10; }
  if (left >= 5) marks.push(`<line x1="${c}" y1="${y}" x2="${c + 5}" y2="${y - 2}" stroke="#111" stroke-width="2"/>`);
  return `<svg width="44" height="44" viewBox="0 0 44 44"><g transform="rotate(${Math.round(dirTrueDeg)} ${c} ${c})" stroke-linecap="round">`
    + `<line x1="${c}" y1="${c}" x2="${c}" y2="${c - 20}" stroke="#fff" stroke-width="4"/><line x1="${c}" y1="${c}" x2="${c}" y2="${c - 20}" stroke="#111" stroke-width="2"/>`
    + `${marks.join("")}</g><circle cx="${c}" cy="${c}" r="2.5" fill="#111"/></svg>`;
}
