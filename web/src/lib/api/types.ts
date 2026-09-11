/**
 * The shapes the API actually returns. Written from the responses rather
 * than from the Python source, so a field that is documented but absent
 * cannot be typed into existence.
 *
 * These types are the reason for TypeScript here. The costliest bug in
 * this page's history was renaming `judged` to `rated` and missing a
 * call site -- silent at runtime, a compile error now.
 */

export type Role = "dr" | "visual";
export type Source = "detected" | "added";
export type Rating = 0 | 1 | 2 | 3 | 4 | 5;

/** A point the chart-vision detector found. */
export interface Detection {
  lat: number;
  lon: number;
  category: string;
  area_m2: number;
  score: number;
  along_track_nm: number;
  cross_track_nm: number;
  /** null until a pick claims it. The rating is the fact; `rated` is derived. */
  rating: Rating | null;
  role: Role | null;
  rated: boolean;
}

/** A pick no detection claimed: a miss, or one whose detection has moved. */
export interface LoosePick {
  lat: number;
  lon: number;
  category: string;
  role: Role;
  source: Source;
  rating: Rating | null;
  rated: boolean;
  along_track_nm: number;
  cross_track_nm: number;
  area_m2: number;
}

/** The ends of the leg. Steppable and described, but never rated. */
export interface Endpoint {
  endpoint: true;
  ident: string;
  name: string;
  lat: number;
  lon: number;
  along_track_nm: number;
  category: "departure" | "destination";
}

/** Anything the walk can land on. */
export type Point = Detection | LoosePick | Endpoint;

export function isEndpoint(p: Point): p is Endpoint {
  return (p as Endpoint).endpoint === true;
}

export interface Course {
  departure: { ident: string; name: string; lat: number; lon: number };
  destination: { ident: string; name: string; lat: number; lon: number };
  distance_nm: number;
  bearing_deg: number;
  course_line: [number, number][];
  tile_url: string;
  max_zoom: number;
  min_zoom: number;
}

export interface PickSummary {
  total: number;
  accepted: number;
  rejected: number;
  added: number;
  by_rating: Record<string, number>;
  by_role: Record<Role, number>;
}

/** One line of the detection stream. */
export type StreamMessage =
  | { type: "start"; route: string }
  | {
      type: "block";
      block: number;
      blocks: number;
      tiles: number;
      missing: number;
      detections: Detection[];
    }
  | { type: "done"; total: number; added: LoosePick[]; summary: PickSummary };

// ---------------------------------------------------------------------
// The planner. Separate from the labeling types above because it is a
// different pipeline: these come from the OSM feature store and the
// model, not from reading chart pixels.

export interface Airport {
  ident: string;
  name: string;
  lat: number;
  lon: number;
}

/** A scored OSM candidate. `selected` is set by the server's greedy pass. */
export interface Candidate {
  osm_id: number;
  name: string | null;
  category: string;
  lat: number;
  lon: number;
  predicted_score: number;
  along_track_nm: number;
  selected: boolean;
}

export interface Wind {
  wind_dir_true_deg: number;
  wind_speed_kt: number;
}

/**
 * One dead-reckoning leg.
 *
 * `wind` is null when no winds-aloft station is near enough, and that is
 * not the same as calm -- groundspeed then falls back to true airspeed.
 * The table shades those rows for exactly that reason.
 */
export interface Leg {
  from: string;
  to: string;
  distance_nm: number;
  true_course_deg: number;
  wind: Wind | null;
  wca_deg: number;
  true_heading_deg: number;
  magnetic_variation_deg: number;
  magnetic_heading_deg: number;
  /** null when the wind exceeds true airspeed: the leg cannot be flown. */
  groundspeed_kt: number | null;
  ete_min: number | null;
  fuel_gal: number | null;
}

export interface Totals {
  distance_nm: number;
  ete_min: number | null;
  fuel_gal: number | null;
  legs_without_wind: number;
}

export interface Checkpoints {
  departure: Airport;
  destination: Airport;
  candidates: Candidate[];
  selected: Candidate[];
}

export interface NavLog {
  legs: Leg[];
  totals: Totals;
  altitude_ft: number;
  altitude_selection: { floor_ft: number } | null;
  aircraft: { name: string };
}

export interface BuiltRoute {
  departure_ident: string;
  destination_ident: string;
}

export interface BuildJob {
  job_id: string | null;
  state: "queued" | "running" | "done" | "failed";
  step: string;
  detail?: string | null;
}
