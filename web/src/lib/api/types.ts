/**
 * The shapes the API returns.
 *
 * Everything either server sends is generated from its own OpenAPI
 * document by `npm run types` -- the Python planner's from
 * planning-service/openapi.json into ./schema.d.ts, this app's Spring
 * Boot endpoints from springboot-app/openapi.json into
 * ./webapp-schema.d.ts -- and re-exported here under the names the pages
 * use, so a field renamed in planning-service/app/schemas.py or in a
 * Java DTO is a compile error at every call site rather than a silent
 * `undefined` at runtime. What is written by hand below is only what
 * no server schema describes: the page's own compositions, and the
 * narrative agents' request and stream.
 */
import type { components } from "./schema";
import type { components as WebappComponents } from "./webapp-schema";

type Schemas = components["schemas"];
type Webapp = WebappComponents["schemas"];

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
export type AltitudeSegment = Schemas["AltitudeSegment"];
/** One of the three plans: lowest, highest, fastest for the winds. */
export type AltitudeOption = Schemas["AltitudeOption"];
export type AltitudeStep = Schemas["AltitudeStep"];
export type AltitudeChoice = AltitudeOption["kind"];
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
export type Status = Schemas["Status"];
export type CorridorStatus = Schemas["CorridorStatus"];
export type RetrainStarted = Schemas["RetrainStarted"];
export type ChartRefreshStarted = Schemas["ChartRefreshStarted"];
export type AircraftProfileSummary = Schemas["AircraftProfileSummary"];
export type AircraftProfiles = Schemas["AircraftProfiles"];
/** One Class B airport, with what the weather is doing there and which
 *  terminal chart covers it. Every weather field is optional and often
 *  absent, and absent must read as absent rather than as "nothing to
 *  worry about". */
export type ClassBAirport = Schemas["ClassBAirport"];
export type ClassBResponse = Schemas["ClassBResponse"];
/** One service the developer console links to, and whether it is up.
 *  `state` is Docker's own word -- running, exited, created -- or
 *  "absent" where compose has never created the container. */
export type DevService = Schemas["DevService"];
/** `available` is false where the planner has no Docker API to talk
 *  to, which is every deployment that is not the local stack. */
export type DevServices = Schemas["DevServices"];
export type DevServiceStarted = Schemas["DevServiceStarted"];

/** Which aeroplane the nav log is computed for: a stock profile by
 *  name, optionally with a pilot's own aeroplane's cruise TAS and fuel
 *  burn laid over it (and its id, so a saved flight records it). */
export interface AircraftChoice {
  profile: string;
  label: string;
  cruiseTasKt?: number;
  fuelBurnGph?: number;
  usableFuelGal?: number;
  aircraftId?: number;
}
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
  /** The first leg's -- a plan may step; each leg carries its own. */
  altitude_ft: number;
  altitude_selection: AltitudeBreakdown | null;
  /** The three plans and the one the legs fly -- empty and null when
   *  the pilot supplied the altitude. */
  options: AltitudeOption[];
  choice: AltitudeChoice | null;
  /** Which winds-aloft forecast period the legs were flown on: "06",
   *  "12" or "24" hours out, from the departure time. */
  winds_forecast_hr: string;
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
// Spring Boot's own endpoints, camelCase (Jackson's default).

/** `GET /api/me`. 401 (not this shape) when signed out. `developer` is
 *  whether the training workspace and the developer console are theirs:
 *  granted with an UPDATE on the pilots table, never inherited -- see
 *  the V7 migration. */
export type Pilot = Webapp["PilotDto"];

/** What signing in can do in this deployment, asked before anyone has
 *  (`/api/auth/capabilities`). */
export type SignInCapabilities = Webapp["Capabilities"];

/** A pilot's own aeroplane, from `/api/aircraft`. `usableFuelGal` is
 *  null when the owner has not said, and then the nav log makes no
 *  fuel check. */
export type Aircraft = Webapp["AircraftDto"];
export type AircraftRequest = Webapp["AircraftRequest"];

/** One row of "My Flights" -- totals only; `Flight` carries the full
 *  filed nav log, fetched one flight at a time. */
export type FlightSummary = Webapp["FlightSummaryDto"];
export type Flight = Webapp["FlightDto"];
/** One checkpoint of a filed nav log. `altitudeFt` is the altitude of
 *  the leg arriving here -- a plan may step. */
export type FlightCheckpointRequest = Webapp["SaveFlightCheckpointRequest"];
/** POST /api/flights body -- files (replacing any previous one) a nav
 *  log for a route this pilot planned. */
export type SaveFlightRequest = Webapp["SaveFlightRequest"];

// ---------------------------------------------------------------------
// The narrative agents, reached through ComparisonProxyController, which
// forwards the body as it is: no server schema describes it, so it is
// composed here from the planner's own types.

/** The nav log on screen, handed to an agent to write about -- what
 *  `/api/comparison` forwards to nav-log-agent or crewai-agent. Both
 *  agents check it on arrival against vfr.narrative.NarrativeRequest: a
 *  missing field, or one it does not know, is a 422 naming it. */
export interface NarrativeRequest {
  departure_ident: string;
  destination_ident: string;
  /** Omitted, the planner's default aeroplane. */
  aircraft_name?: string | null;
  altitude_ft: number;
  altitude_selection: AltitudeBreakdown | null;
  legs: Leg[];
}

/** One line of a narrative stream: text as Claude writes it, then the
 *  whole briefing, or why there is none. */
export type NarrativeMessage =
  | { type: "delta"; text: string }
  | { type: "done"; briefing: string }
  | { type: "error"; detail: string };
