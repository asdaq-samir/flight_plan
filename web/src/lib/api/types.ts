/**
 * The shapes the API returns.
 *
 * Everything the Python planner sends is generated from
 * planning-service/openapi.json into ./schema.d.ts (`npm run types`)
 * and re-exported here under the names the pages use, so a field
 * renamed in planning-service/app/schemas.py is a compile error at
 * every call site rather than a silent `undefined` at runtime. The
 * Spring Boot shapes at the bottom are still written by hand.
 */
import type { components } from "./schema";

type Schemas = components["schemas"];

// ---------------------------------------------------------------------
// The planner.

export type Airport = Schemas["AirportEnd"];
export type Course = Schemas["Course"];
/** A scored OSM candidate. `selected` is set by the server's greedy pass. */
export type Candidate = Schemas["Candidate"];
export type Checkpoints = Schemas["Checkpoints"];
export type Wind = Schemas["Wind"];
/** One dead-reckoning leg. `wind` is null when no winds-aloft station is
 *  near enough, which is not the same as calm; groundspeed/ETE/fuel are
 *  null when the wind exceeds true airspeed and the leg cannot be flown. */
export type Leg = Schemas["Leg"];
export type Totals = Schemas["Totals"];
export type Hazard = Schemas["Hazard"];
export type AirspaceTransit = Schemas["AirspaceTransit"];
export type AltitudeBreakdown = Schemas["AltitudeBreakdown"];
export type AircraftProfile = Schemas["AircraftProfile"];
/** One line of the nav log's stream: "stage" before each piece of work,
 *  "altitude" the moment that's decided, one "leg" per leg, then "done"
 *  with the totals; "error" for an unflyable route. */
export type NavLogMessage = Schemas["NavLogMessage"];
export type Forecast = Schemas["Forecast"];
export type Metar = Schemas["Metar"];
export type Runway = Schemas["Runway"];
export type Frequency = Schemas["Frequency"];
export type Briefing = Schemas["Briefing"];
export type BuildJob = Schemas["BuildJob"];
export type BuiltRoute = Schemas["BuiltRoute"];
export type BuiltRoutes = Schemas["BuiltRoutes"];
export type AirportSuggestion = Schemas["AirportSuggestion"];
export type AirportSearch = Schemas["AirportSearch"];
export type ModelComparisonEntry = Schemas["ModelComparisonEntry"];
export type ModelComparison = Schemas["ModelComparison"];
export type ScoredCheckpoint = Schemas["ScoredCheckpoint"];
export type PlaygroundScore = Schemas["PlaygroundScore"];
/** One line of the per-checkpoint description stream. */
export type CheckpointDescriptionMessage = Schemas["CheckpointNoteMessage"];
export type CheckpointNoteSaved = Schemas["CheckpointNoteSaved"];

/** Legs and totals plus what the "altitude" message carried: the page's
 *  own assembled nav log. `altitude_selection` is null when a pilot
 *  supplied their own altitude, since nothing was computed to break
 *  down. */
export interface NavLog {
  legs: Leg[];
  totals: Totals;
  altitude_ft: number;
  altitude_selection: AltitudeBreakdown | null;
  aircraft: AircraftProfile;
}

// ---------------------------------------------------------------------
// The chart: what the detector found and what a pilot marked.

/** A point the chart-vision detector found. `rating` is null until a
 *  pick claims it; `rated` is derived from it. */
export type Detection = Schemas["Detection"];
/** A pick no detection claimed: a miss, or one whose detection has moved. */
export type LoosePick = Schemas["Pick"];
export type PickSummary = Schemas["PickSummary"];
export type PicksResponse = Schemas["PicksResponse"];
export type PickSaved = Schemas["PickSaved"];
export type PickDeleted = Schemas["PickDeleted"];
export type Classification = Schemas["Classification"];
/** One line of the detection stream. */
export type StreamMessage = Schemas["DetectMessage"];

export type Role = NonNullable<Detection["role"]>;
export type Source = LoosePick["source"];
export type Rating = NonNullable<Detection["rating"]>;

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

// ---------------------------------------------------------------------
// Spring Boot's own endpoints, camelCase (Jackson's default) and typed
// by hand.

/** `GET /api/me`. 401 (not this shape) when signed out. */
export interface Pilot {
  id: number;
  email: string;
  displayName: string;
}

/** One framework's own result from ComparisonProxyController -- either
 *  shape can come back for either framework, independent of the other
 *  (nav-log-agent down doesn't stop crewai-agent's own result from
 *  showing, and vice versa). */
export type FrameworkResult =
  | { altitude_selection: AltitudeBreakdown; legs: unknown[]; briefing: string }
  | { briefing: string }
  | { error: string };

/** The identical nav-log-briefing task, run through nav-log-agent's
 *  LangGraph build and/or crewai-agent's CrewAI build. The Brief tab's
 *  narrative buttons request one at a time, so only that key comes
 *  back; a pilot picking one shouldn't also pay for the other. */
export interface FrameworkComparison {
  langgraph?: FrameworkResult;
  crewai?: FrameworkResult;
}

/** A pilot's own aeroplane, from `/api/aircraft`. */
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
  departureIdent: string;
  destinationIdent: string;
  cruiseAltitudeFt: number | null;
  totalDistanceNm: number | null;
  totalEteMin: number | null;
  totalFuelGal: number | null;
  plannedFor: string | null;
  checkpoints: FlightCheckpointRequest[];
}
