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
  departure: { ident: string; name: string; lat: number; lon: number; elevation_ft: number | null };
  destination: { ident: string; name: string; lat: number; lon: number; elevation_ft: number | null };
  distance_nm: number;
  bearing_deg: number;
  course_line: [number, number][];
  map_service_url: string;
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

/** One line of the per-checkpoint description stream. "saved" means it
 *  came back from a pilot's own earlier edit, not a fresh LLM call. */
export type CheckpointDescriptionMessage =
  | { type: "start"; count: number }
  | {
      type: "checkpoint";
      lat: number;
      lon: number;
      osm_id: number;
      // null on "error" -- that one checkpoint's own LLM call failed
      // for a reason specific to it, but every other checkpoint is
      // independent and the stream keeps going regardless.
      description: string | null;
      source: "generated" | "saved" | "error";
    }
  // A failure that applies to every checkpoint the same way (a bad
  // key, an exhausted rate limit) rather than to one of them -- sent
  // once instead of as 21 identical per-checkpoint "error" lines, and
  // the stream ends right after it.
  | { type: "error"; detail: string }
  | { type: "done" };

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

/** One line of the nav log's own stream -- a "stage" line before each
 *  real piece of work (scoring, altitude selection, the live
 *  aviationweather.gov fetch) so a pilot sees what's actually taking
 *  the time, an "altitude" line the moment that's decided (well
 *  before any leg -- the checkpoints already on screen from
 *  /api/checkpoints can show it immediately), one "leg" line per leg
 *  as it's actually computed, then one "done" line with the totals,
 *  which need every leg in before they mean anything. */
export type NavLogMessage =
  | { type: "stage"; detail: string }
  | { type: "error"; detail: string }
  | ({ type: "altitude" } & Pick<NavLog, "altitude_ft" | "altitude_selection" | "aircraft">)
  | ({ type: "leg" } & Leg)
  | ({ type: "done"; totals: Totals });

/** A SIGMET/AIRMET whose hazard polygon the route line actually
 *  crosses. */
export interface Hazard {
  hazard: string | null;
  type: string | null;
  altitude_low_ft: number | null;
  altitude_high_ft: number | null;
  raw: string | null;
}

export interface Forecast {
  min_ceiling_ft: number | null;
  min_visibility_sm: number | null;
  stations: { icaoId: string; ceiling_ft: number | null; visibility_sm: number | null }[];
}

export interface Metar {
  raw: string | null;
  flight_category: "VFR" | "MVFR" | "IFR" | "LIFR" | null;
  ceiling_ft: number | null;
  visibility_sm: number | null;
  wind_dir_true_deg: number | null;
  wind_speed_kt: number | null;
  temp_c: number | null;
  dewpoint_c: number | null;
}

export interface Runway {
  ends: string | null;
  length_ft: number | null;
  width_ft: number | null;
  surface: string | null;
  lighted: boolean;
  closed: boolean;
}

export interface Frequency {
  type: string | null;
  description: string | null;
  frequency_mhz: number | null;
}

/** Everything the nav log's own leg math doesn't cover -- the Flight
 *  Briefing page's own data, fetched once (not streamed: every piece
 *  here is one quick independent call, not a slow per-leg loop). */
export interface Briefing {
  hazards: Hazard[];
  forecast: Forecast;
  /** Keyed by ident; null for one aviationweather.gov has no current
   *  report for. */
  metars: Record<string, Metar | null>;
  airports: Record<string, { runways: Runway[]; frequencies: Frequency[] }>;
}

/** What the briefing narrative endpoint needs to write prose about --
 *  the data the Flight Briefing page already has, not idents alone:
 *  that endpoint's job is turning known facts into a spoken-style
 *  paragraph, not a second fetch of its own. */
export interface BriefingNarrativeRequest {
  departure_ident: string;
  destination_ident: string;
  distance_nm: number;
  bearing_deg: number;
  altitude_ft: number;
  aircraft_name: string;
  total_time_min: number | null;
  total_fuel_gal: number | null;
  hazards: Hazard[];
  metars: Record<string, Metar | null>;
  forecast: Forecast;
  legs: Leg[];
}

/** `GET /api/me` -- a Spring Boot endpoint, not proxied through the
 *  planner, so the client calls it directly. 401 (not this shape)
 *  when signed out. */
export interface Pilot {
  id: number;
  email: string;
  displayName: string;
}

/** What retrain() actually compared before picking the currently
 *  promoted model -- Playground's own "why this algorithm" panel. */
/** One algorithm's own comparison entry -- `metric` names which
 *  number `score` actually is (cv_mae for the sklearn family and
 *  Spark, whose own CrossValidator produces one too; held_out_mae for
 *  PyTorch/TensorFlow, which don't) rather than pretending every
 *  entry is on the same footing. Lower is better either way. */
export interface ModelComparisonEntry {
  name: string;
  metric: "cv_mae" | "held_out_mae";
  score: number;
  promoted: boolean;
}

export interface ModelComparison {
  models: ModelComparisonEntry[];
  trained_at: string | null;
  n_labeled: number | null;
}

/** One checkpoint as scored by a specific algorithm -- the
 *  Playground's own algorithm picker, via /api/playground/score. */
export interface ScoredCheckpoint {
  osm_id: string;
  category: string;
  name: string;
  lat: number;
  lon: number;
  along_track_nm: number;
  predicted_score: number;
}

export interface PlaygroundScore {
  departure_ident: string;
  destination_ident: string;
  checkpoints: ScoredCheckpoint[];
  model_type: string;
}

/** Controlled airspace the route passes through -- informational (a
 *  radio call to make), not a ceiling constraint. */
export interface AirspaceTransit {
  name: string;
  class: string;
  floor_ft_msl: number | null;
  requires: string;
  along_track_nm: number;
}

/** The full reasoning behind one recommended cruise altitude --
 *  Playground's "how is this number actually decided" panel. Also
 *  exactly what /api/navlog's own "altitude" message carries, just
 *  reachable independent of a Plan-page session. */
export interface AltitudeBreakdown {
  recommended_ft: number | null;
  floor_ft: number;
  airspace_ceiling_ft: number | null;
  airspace_transits: AirspaceTransit[];
  freezing_level_ft: number | null;
  band_ceiling_ft: number | null;
  min_ceiling_ft: number | null;
  min_visibility_sm: number | null;
  hazards: Hazard[];
  low_ceiling_or_visibility: boolean;
}

/** A pilot's own aeroplane -- from Spring Boot's `/api/aircraft`, so
 *  camelCase (Jackson's default), unlike every snake_case type above
 *  this one that comes from the Python planner. */
export interface Aircraft {
  id: number;
  tailNumber: string;
  typeDesignator: string;
  cruiseTasKt: number;
  fuelBurnGph: number;
  createdAt: string;
}

export interface AircraftRequest {
  tailNumber: string;
  typeDesignator: string;
  cruiseTasKt: number;
  fuelBurnGph: number;
}

/** One row of "My Flights" -- totals only; `Flight` (below) carries
 *  the full filed nav log, fetched one flight at a time. */
export interface FlightSummary {
  id: number;
  departureIdent: string;
  destinationIdent: string;
  aircraftTailNumber: string | null;
  cruiseAltitudeFt: number | null;
  totalDistanceNm: number | null;
  totalEteMin: number | null;
  totalFuelGal: number | null;
  plannedFor: string | null;
  createdAt: string;
}

export interface FlightCheckpointRequest {
  sequenceNo: number;
  name: string;
  category: string;
  lat: number;
  lon: number;
  alongTrackNm: number;
  legDistanceNm: number | null;
  trueCourseDeg: number | null;
  magneticHeadingDeg: number | null;
  groundspeedKt: number | null;
  eteMin: number | null;
  fuelGal: number | null;
}

export interface Flight extends FlightSummary {
  checkpoints: FlightCheckpointRequest[];
}

/** POST /api/flights body -- files (replacing any previous one) a nav
 *  log for a route this pilot planned. */
export interface SaveFlightRequest {
  aircraftId: number | null;
  routeId: number | null;
  departureIdent: string;
  destinationIdent: string;
  cruiseAltitudeFt: number | null;
  totalDistanceNm: number | null;
  totalEteMin: number | null;
  totalFuelGal: number | null;
  plannedFor: string | null;
  checkpoints: FlightCheckpointRequest[];
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
