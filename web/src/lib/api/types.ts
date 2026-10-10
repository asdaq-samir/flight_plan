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
/** A waypoint that keeps a route out of the Class B that stops it. */
export type Detour = Schemas["Detour"];
/** An altitude the pilot set for a hop and what is wrong with it (the
 *  planner's own_altitude_caution): a warning, not a refusal. */
export type AltitudeCaution = Schemas["AltitudeCaution"];
/** One chart kind the map may draw, with its zooms -- and, for an
 *  overlay, its sheets and where each is. */
export type ChartLayer = Schemas["ChartLayer"];
export type ChartSheet = Schemas["ChartSheet"];
/** A scored OSM candidate. `selected` is set by the server's greedy pass. */
export type Candidate = Schemas["Candidate"];
export type Checkpoints = Schemas["Checkpoints"];
export type Wind = Schemas["Wind"];
/** One dead-reckoning leg. `wind` is null when no winds-aloft station is
 *  near enough, which is not the same as calm; groundspeed/ETE/fuel are
 *  null when the wind exceeds true airspeed and the leg cannot be flown. */
export type Leg = Schemas["Leg"];
/** Where a leg's climb tops out (TOC), from the leg's start, and the
 *  climb's speeds on the way up. */
export type TopOfClimb = Schemas["TopOfClimb"];
/** Where a leg's descent starts (TOD), to what and at what rate. */
export type TopOfDescent = Schemas["TopOfDescent"];
export type Totals = Schemas["Totals"];
export type Hazard = Schemas["Hazard"];
export type AltitudeBreakdown = Schemas["AltitudeBreakdown"];
export type AltitudeSegment = Schemas["AltitudeSegment"];
/** One of the four plans: lowest, highest, fastest for the winds, and
 *  economical, the least fuel, climb and cruise. */
export type AltitudeOption = Schemas["AltitudeOption"];
export type AltitudeChoice = AltitudeOption["kind"];
export type AircraftProfile = Schemas["AircraftProfile"];
/** How an airplane is loaded: its POH's stations, limits and envelope. */
export type Loading = Schemas["Loading"];
/** A POH's short-field takeoff or landing distances. */
export type ShortField = Schemas["ShortField"];
/** One line of the nav log's stream: "stage" before each piece of work,
 *  "altitude" the moment that's decided, one "leg" per leg, then "done"
 *  with the totals; "error" for an unflyable route. */
export type NavLogMessage = Schemas["NavLogMessage"];
export type Forecast = Schemas["Forecast"];
export type Runway = Schemas["Runway"];
export type Frequency = Schemas["Frequency"];
export type Briefing = Schemas["Briefing"];
export type ChartInfo = Schemas["ChartInfo"];
export type AirportSearch = Schemas["AirportSearch"];
export type AirportPlace = Schemas["AirportPlace"];
export type TerminalChart = Schemas["TerminalChart"];
export type ChartPages = Schemas["ChartPages"];
/** The mock oral's question, its answer graded, and what each is asked with. */
export type OralQuestion = Schemas["OralQuestion"];
export type OralQuestionRequest = Schemas["OralQuestionRequest"];
export type OralGrade = Schemas["OralGrade"];
export type OralGradeRequest = Schemas["OralGradeRequest"];
export type OralCitation = Schemas["OralCitation"];
export type AirportPin = Schemas["AirportPin"];
export type AirportsInView = Schemas["AirportsInView"];
export type WaypointsInView = Schemas["WaypointsInView"];
export type ModelComparisonEntry = Schemas["ModelComparisonEntry"];
export type ModelComparison = Schemas["ModelComparison"];
export type Status = Schemas["Status"];
export type RetrainStarted = Schemas["RetrainStarted"];
export type ChartRefreshStarted = Schemas["ChartRefreshStarted"];
export type AircraftProfileSummary = Schemas["AircraftProfileSummary"];
export type AircraftProfiles = Schemas["AircraftProfiles"];
/** One Class B airport, with what the weather is doing there. Every
 *  weather field is optional and often absent, and absent must read as
 *  absent rather than as "nothing to worry about". Which terminal chart
 *  covers it is the map's own lookup (tiles.ts, sheetAt). */
export type ClassBAirport = Schemas["ClassBAirport"];
export type ClassBResponse = Schemas["ClassBResponse"];
/** A temporary flight restriction, with its areas, for the map. */
export type Tfr = Schemas["Tfr"];
export type Tfrs = Schemas["Tfrs"];
/** The fields nearest a position: how far, which way, the longest runway. */
export type NearestAirports = Schemas["NearestAirports"];
export type NearestAirport = Schemas["NearestAirport"];
export type PlaceFound = Schemas["PlaceFound"];
export type PlacesFound = Schemas["PlacesFound"];
/** The route from the side: the ground and the controlled airspace. */
export type RouteProfile = Schemas["RouteProfile"];
export type AirspaceAt = Schemas["AirspaceAt"];
export type AirspaceBand = Schemas["AirspaceBand"];
export type VfrMinimums = Schemas["VfrMinimums"];
/** `available` is false where the planner has no Docker API to talk
 *  to, which is every deployment that is not the local stack. */
export type DevServices = Schemas["DevServices"];
export type DevServiceStarted = Schemas["DevServiceStarted"];

/** Which airplane the nav log is computed for: a stock profile by
 *  name, optionally with a pilot's own airplane's speeds and fuel
 *  burns, climb and cruise, laid over it (and its id, so a saved
 *  flight records it). */
export interface AircraftChoice {
  profile: string;
  label: string;
  cruiseTasKt?: number;
  fuelBurnGph?: number;
  /** The power the cruise figures are at, in percent. */
  cruisePowerPct?: number;
  climbTasKt?: number;
  climbFuelBurnGph?: number;
  usableFuelGal?: number;
  aircraftId?: number;
}
/** One line of the per-checkpoint description stream. */
export type CheckpointDescriptionMessage = Schemas["CheckpointNoteMessage"];
export type CheckpointNoteSaved = Schemas["CheckpointNoteSaved"];

/** What the nav log stream's "altitude" message carries -- the generated
 *  shape, less its `type`. */
export type NavLogAltitude = Omit<Schemas["NavLogAltitude"], "type">;

// ---------------------------------------------------------------------
// The chart: what the detector found and what a pilot marked.

/** A point the chart-vision detector found. `rating` is null until a
 *  pick claims it; `rated` is derived from it. */
export type Detection = Schemas["Detection"];
/** A pick no detection claimed: a miss, or one whose detection has moved. */
export type LoosePick = Schemas["Pick"];
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

/** How this deployment is reached -- SIGN_IN, OPEN or CLOSED -- asked
 *  before anyone has signed in (`/api/auth/capabilities`). */
export type SignInCapabilities = Webapp["Capabilities"];
/** The iOS app's Apple sign-in, done: where to go next. */
export type AppleSignedIn = Webapp["SignedIn"];

/** A pilot's own airplane, from `/api/aircraft`. `usableFuelGal` is
 *  null when the owner has not said, and then the nav log makes no
 *  fuel check. */
export type Aircraft = Webapp["AircraftDto"];
export type AircraftRequest = Webapp["AircraftRequest"];

/** One row of "My Flights" -- totals only; `Flight` carries the full
 *  filed nav log, fetched one flight at a time. */
export type FlightSummary = Webapp["FlightSummaryDto"];
export type Flight = Webapp["FlightDto"];
/** A flight's flown track as saved to the account (lib/track). */
export type SavedTrack = Webapp["TrackDto"];
/** POST /api/flights body -- files (replacing any previous one) a nav
 *  log for a route this pilot planned. */
export type SaveFlightRequest = Webapp["SaveFlightRequest"];

/** A flight in the pilot's logbook, from `/api/logbook`. */
export type LogbookEntry = Webapp["LogbookEntryDto"];
export type LogbookEntryRequest = Webapp["LogbookEntryRequest"];
/** Where the pilot stands -- passengers by day and at night, the flight
 *  review, the medical -- and the logbook's totals. */
export type Currency = Webapp["CurrencyDto"];
export type CurrencyDatesRequest = Webapp["CurrencyDatesRequest"];
/** A student's way to the checkride: 61.109's experience from the
 *  logbook, the knowledge test report's ACS codes, the endorsements. */
export type Training = Webapp["TrainingDto"];
export type ExperienceItem = Webapp["ExperienceItemDto"];

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
  /** Omitted, the planner's default airplane. */
  aircraft_name?: string | null;
  altitude_ft: number;
  altitude_selection: AltitudeBreakdown | null;
  /** Whose altitudes the legs fly: a plan's name, or "custom" for the
   *  pilot's own -- what the agents brief as the altitude's provenance. */
  flown?: AltitudeChoice | "custom";
  legs: Leg[];
}

/** One line of a narrative stream: text as Claude writes it, then the
 *  whole briefing, or why there is none. */
export type NarrativeMessage =
  | { type: "delta"; text: string }
  | { type: "done"; briefing: string }
  | { type: "error"; detail: string };
