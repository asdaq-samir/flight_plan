/**
 * A flown track as a pilot's apps export it -- ForeFlight's, Garmin
 * Pilot's, a GPS's -- read in the browser: GPX's track points, or KML's
 * gx:Track (ForeFlight's track log), each with its time, and its
 * altitude where it has one. GPS altitude, above sea level: not what
 * the altimeter read, and the debrief says so.
 *
 * Nothing here leaves the device: a track is the pilot's, kept in this
 * browser (keepTrack) unless they save it to their account.
 */

export interface TrackPoint {
  /** When, ms since the epoch. */
  t: number;
  lat: number;
  lon: number;
  /** GPS altitude, feet above sea level; null where the file has none. */
  altFt: number | null;
}

const FEET_PER_METRE = 3.28084;

/** Something the file is not, in words for the pilot. */
export class TrackError extends Error {}

function valid(p: TrackPoint): boolean {
  return Number.isFinite(p.t) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0);
}

function elevation(text: string | null | undefined): number | null {
  if (text == null || text.trim() === "") return null;
  const metres = Number(text);
  return Number.isFinite(metres) ? metres * FEET_PER_METRE : null;
}

function gpx(doc: Document): TrackPoint[] {
  return [...doc.getElementsByTagNameNS("*", "trkpt")].map(el => ({
    t: Date.parse(el.getElementsByTagNameNS("*", "time")[0]?.textContent ?? ""),
    lat: Number(el.getAttribute("lat")),
    lon: Number(el.getAttribute("lon")),
    altFt: elevation(el.getElementsByTagNameNS("*", "ele")[0]?.textContent),
  }));
}

/** KML's gx:Track: its `when`s and its `gx:coord`s ("lon lat alt"), in
 *  step. A plain LineString has no times, and no use here. */
function kml(doc: Document): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const track of doc.getElementsByTagNameNS("*", "Track")) {
    const whens = [...track.getElementsByTagNameNS("*", "when")];
    const coords = [...track.getElementsByTagNameNS("*", "coord")];
    whens.forEach((when, i) => {
      const [lon, lat, alt] = (coords[i]?.textContent ?? "").trim().split(/\s+/).map(Number);
      points.push({ t: Date.parse(when.textContent ?? ""), lat: lat ?? NaN, lon: lon ?? NaN, altFt: alt == null || Number.isNaN(alt) ? null : alt * FEET_PER_METRE });
    });
  }
  return points;
}

/** A track file's points in time order, the unreadable ones dropped;
 *  a TrackError where it has none to use. */
export function readTrack(text: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new TrackError("This file is not a GPX or KML track.");
  const root = doc.documentElement.localName.toLowerCase();
  const raw = root === "gpx" ? gpx(doc) : root === "kml" ? kml(doc) : null;
  if (!raw) throw new TrackError("This file is not a GPX or KML track.");
  const points = raw.filter(valid).sort((a, b) => a.t - b.t);
  if (points.length < 2) {
    throw new TrackError(raw.length
      ? "The track's points have no times: export it with them (a GPX track, or ForeFlight's KML track log)."
      : "There is no track in this file.");
  }
  return points.filter((p, i) => i === 0 || p.t > points[i - 1]!.t);
}

/** A track thinned to at most `most` points, the first and the last
 *  kept: for keeping it, where a second-by-second log of two hours is
 *  seven thousand. Even steps through it, which keep its shape at a
 *  light aeroplane's speeds. */
export function thin(points: TrackPoint[], most = 4000): TrackPoint[] {
  if (points.length <= most) return points;
  const step = (points.length - 1) / (most - 1);
  return Array.from({ length: most }, (_, i) => points[Math.round(i * step)]!);
}

const KEY = (flightId: number) => `wingtip.track.${flightId}`;

/** A flight's track as kept in this browser, or null: none kept, or
 *  storage not to be had (a private window). */
export function keptTrack(flightId: number): { source: string; points: TrackPoint[] } | null {
  try {
    const raw = localStorage.getItem(KEY(flightId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Keeps a flight's track in this browser, or forgets it (null). False
 *  where storage cannot be had or is full. */
export function keepTrack(flightId: number, track: { source: string; points: TrackPoint[] } | null): boolean {
  try {
    if (track) localStorage.setItem(KEY(flightId), JSON.stringify(track));
    else localStorage.removeItem(KEY(flightId));
    return true;
  } catch {
    return false;
  }
}
