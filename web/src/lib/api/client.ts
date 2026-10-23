import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import type { paths as WebappPaths } from "./webapp-schema";
import type { Aircraft, AircraftBases, HandbookFigures, AircraftChoice, AircraftProfiles, AircraftRequest, AirportPhotos, AirportPlace, AirportSearch, AirportServices, ForecastWind, AirportsInView, AirspaceAt, AlertsAhead, Alternates, AltitudeChoice, AppleSignedIn, Briefing, ChartInfo, ChartPages, ChartRefreshStarted, ChecklistDto, CheckpointDescriptionMessage, CheckpointNoteSaved, Checkpoints, ClassBResponse, Classification, Course, Currency, CurrencyDatesRequest, Detour, DeviceCode, DevServices, DevServiceStarted, Flight, FlightDetail, FlightPlanFiled, FlightPlanFilingRequest, FlightRoute, FlightServiceStatus, FlightStatus, FlightSummary, GoogleMaps, InspectionsRequest, Instructor, InstructorRequest, LogbookEntry, LogbookEntryRequest, LogbookImportResult, ModelComparison, NarrativeMessage, NarrativeRequest, NavLogMessage, NearestAirports, OralGrade, OralGradeRequest, OralQuestion, OralQuestionRequest, PastFlight, PastFlights, PickDeleted, PickSaved, Pilot, PilotContactRequest, PlacesFound, PlateOverlay, ProcedureDrawing, ProcedureList, Rating, Reminders, RetrainStarted, Role, RouteProfile, RouteStops, SavedTrack, SaveFlightRequest, SignRequest, SignInCapabilities, SpeedDay, Squawk, SquawkRequest, Status, StreamMessage, Subscription, Tfrs, Totals, Traffic, TrafficFound, Training, VorCheckRequest, WaypointsInView } from "./types";

/**
 * Every call the pages make. Both servers' calls go through
 * openapi-fetch, typed end to end from each one's own OpenAPI document
 * (`npm run types` regenerates ./schema.d.ts for the planner and
 * ./webapp-schema.d.ts for this app's Spring Boot endpoints): a renamed
 * query parameter or response field is a compile error at the call
 * site, not a silent 404 or `undefined` -- every response type named
 * below is a generated one, and `data` checks it against the path's own.
 * The two calls no schema describes (Spring Security's own logout, and
 * the narrative the webapp forwards to an agent untouched) are plain
 * fetches that keep the same two rules.
 */

export class ApiError extends Error {
  /** `reasons` and `advice`: why, and what to do, where the server says
   *  (a nav log with no legal altitude), apart from the message;
   *  `classB`, Class B airspace is what stops it, and `detours` the
   *  waypoints round it, best first; `brief`, all of it in a few words. */
  constructor(
    message: string, readonly status: number, readonly reasons: string[] = [], readonly advice: string | null = null,
    readonly classB = false, readonly detours: Detour[] = [], readonly brief: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The CSRF header for a request that changes state, and nothing for a
 * GET. The server sets the token as a readable cookie and expects it
 * echoed back; session cookies are attached by the browser on their
 * own, which is the condition CSRF exploits, so this is what tells our
 * own request apart from someone else's page making the same one. The
 * one place the rule lives -- both clients' middleware and both plain
 * fetches ask it.
 */
function csrfHeaders(method: string): Record<string, string> {
  if (method.toUpperCase() === "GET") return {};
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match?.[1] ? { "X-XSRF-TOKEN": decodeURIComponent(match[1]) } : {};
}

/** The server's own word for what went wrong: `detail` is the
 *  planner's (and the webapp's proxies'), `error` is Spring's where it
 *  sends one. A 401 carries no body at all (Spring Security's own entry
 *  point), and falls through to the status text. FastAPI's own 422 --
 *  a query parameter it could not parse -- sends `detail` as a list of
 *  {loc, msg}, which read "[object Object]" in the toast. */
export async function detailOf(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { detail?: unknown; error?: string };
  const detail = Array.isArray(body.detail)
    ? body.detail.map(d => (d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d))).join("; ")
    : typeof body.detail === "string" ? body.detail : undefined;
  return detail || body.error || response.statusText || "request failed";
}

/** A response that is not OK, as the `ApiError` every caller expects --
 *  so every call either resolves with its data or rejects. */
async function failIfNotOk(response: Response): Promise<void> {
  if (!response.ok) throw new ApiError(await detailOf(response), response.status);
}

/** The two rules above, for an openapi-fetch client. */
const csrfAndFailures: Middleware = {
  onRequest({ request }) {
    for (const [name, value] of Object.entries(csrfHeaders(request.method))) request.headers.set(name, value);
    return request;
  },
  async onResponse({ response }) {
    await failIfNotOk(response);
  },
};

/**
 * Everything chart- and plan-related is served by the Python planner,
 * reached through the Spring Boot gateway rather than directly: one
 * origin means one session and one set of access rules, and the
 * planner itself publishes no port. The schema's `/api/…` paths are
 * served under `/api/planner/…` (PlannerProxyController), and this is
 * the Request the planner's client makes, the prefix written into its
 * address as it is made.
 *
 * It was a middleware that made a second Request of the first, which
 * hands a body over as a stream -- and Safari cannot send one
 * ("ReadableStream uploading is not supported"), so on an iPhone every
 * POST to the planner failed before it left: a rating, a note, a build.
 * Made here, the body is the JSON openapi-fetch serialised.
 */
export class GatewayRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === "string" ? input.replace(/^([a-z]+:\/\/[^/]+)?\/api\//i, "$1/api/planner/") : input, init);
  }
}

const planner = createClient<paths>({ baseUrl: "", Request: GatewayRequest });
planner.use(csrfAndFailures);

/** The Spring Boot endpoints, on this same origin. */
const webapp = createClient<WebappPaths>({ baseUrl: "" });
webapp.use(csrfAndFailures);

/** A schema's shape as openapi-fetch hands it back: every fixed-length
 *  tuple ([lat, lon]) widened to a plain array. */
type Widened<T> = T extends readonly (infer E)[] ? Widened<E>[] : T extends object ? { [K in keyof T]: Widened<T[K]> } : T;

/** The data of a call that resolved (the middleware above has already
 *  thrown for anything else), as the named shape from ./types -- the
 *  same schema with its tuples restored. Checked, not merely cast: the
 *  call's own response type must be `T` widened, so naming the wrong
 *  schema, or a field the schema has since lost, is a compile error. */
const data = <T>(result: { data?: Widened<T> }): T => result.data as T;

/**
 * Newline-delimited JSON, one line at a time as the bytes arrive: the
 * nav log, the detections, the checkpoint notes and the narratives all
 * stream this shape. A chunk can split a line, so only whole lines are
 * parsed; the decoder is the browser's own.
 */
export async function* ndjson<T>(stream: ReadableStream | undefined): AsyncGenerator<T> {
  if (!stream) return;
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await quietFor(reader, STREAM_QUIET_MS);
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield parsed<T>(line);
    }
  }
  if (buffer.trim()) yield parsed<T>(buffer);
}

/** How long a stream may say nothing before it is given up, ms: the
 *  planner's nav log sends a line every 8 s while it works (its
 *  HEARTBEAT_S), and the narratives' first words come within a minute. A
 *  stalled one kept "Asking the planner…" up for the gateway's ten
 *  minutes (the audit's finding). */
export const STREAM_QUIET_MS = 90_000;

/** The reader's next piece, or a TimeoutError -- "No answer in time"
 *  (describeError) -- once it has been quiet for `ms`, the stream given up. */
async function quietFor<R>(reader: ReadableStreamDefaultReader<R>, ms: number): Promise<ReadableStreamReadResult<R>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quiet = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Refused before the reader is let go: its cancel settles the read
      // waiting on it as a clean end, which would win the race.
      reject(new DOMException("The planner went quiet", "TimeoutError"));
      void reader.cancel().catch(() => undefined);
    }, ms);
  });
  try {
    return await Promise.race([reader.read(), quiet]);
  } finally {
    clearTimeout(timer);
  }
}

/** One line of a stream, or one plain error where it is not JSON -- a
 *  gateway's HTML error page in the middle of a stream read "Unexpected
 *  token <" to the pilot. */
function parsed<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new Error("The planner's answer came back garbled");
  }
}

/**
 * What to tell the pilot about a failure: the error's own message (an
 * `ApiError` carries the server's detail) when it has one, the caller's
 * fallback otherwise. Only the first line -- a server's detail can run
 * to a traceback, and a toast is not the place for one.
 */
/** The browsers' own words for a fetch that never got an answer --
 *  Safari's "Load failed", Chrome's "Failed to fetch", Firefox's
 *  "NetworkError when attempting to fetch resource" -- and Safari's for
 *  the same on a page a service worker answers for, "FetchEvent.respondWith
 *  received an error: TypeError: Load failed", which a pilot read on a
 *  phone, word for word, in a toast. */
const NO_ANSWER = /load failed|failed to fetch|networkerror|respondwith/i;

/** Whether a request got no answer at all: the connection dropped, not
 *  the server saying no. */
export function isDropped(err: unknown): boolean {
  return err instanceof TypeError && NO_ANSWER.test(err.message);
}

export function describeError(err: unknown, fallback = "request failed"): string {
  if (isDropped(err)) {
    return "The connection dropped before the answer arrived";
  }
  // A fetch that gave up on its own `AbortSignal.timeout` -- the
  // developer console's probes -- rejects with the DOM's "signal timed
  // out", which a phone showed in a toast, word for word.
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "No answer in time";
  }
  const firstLine = err instanceof Error ? err.message.split("\n")[0] : undefined;
  return firstLine || fallback;
}

/** `describeError` for a query's `error` field, which is null while
 *  nothing has failed -- and so is this. */
export const errorMessage = (err: unknown, fallback: string) => (err ? describeError(err, fallback) : null);

/** A route's stops as the planner takes them, "KDSM,KLNK"; none, none. */
const stopsParam = (stops?: string[]) => (stops?.length ? stops.join(",") : undefined);

/** The airport index's shape (vfr.airports.search_index), in its address
 *  so a day's copy in the browser of an older shape is not read as this
 *  one: 2, each field's place after its size (2026-10-22). */
const INDEX_VERSION = 2;

export const api = {
  /** The leg itself, through any stops: sub-second, and enough to draw
   *  before any tile is read. */
  course: (dep: string, dest: string, stops?: string[], signal?: AbortSignal) =>
    planner.GET("/api/course", { params: { query: { dep, dest, stops: stopsParam(stops) } }, signal }).then(data<Course>),

  /** Scored candidates and the subset worth flying, hop by hop. Fast --
   *  the model is loaded and the features are already built -- once the
   *  chart is read along the route, which on a new one is seconds: given
   *  up with `signal` when the route changes (checkpointsQuery). */
  checkpoints: (dep: string, dest: string, stops?: string[], signal?: AbortSignal) =>
    planner.GET("/api/checkpoints", { params: { query: { dep, dest, stops: stopsParam(stops) } }, signal }).then(data<Checkpoints>),

  /**
   * The slow half: terrain, the obstacle file, the airspace shapefile
   * and live winds. Asked for separately so none of it delays the
   * chart, and streamed rather than one blocking response so a pilot
   * sees which of those it's actually doing right now. `depart`, an ISO
   * instant, picks the winds forecast period; absent means about now.
   * `altitudeChoice` is which of the planner's four plans the legs
   * fly, meaningful only without a typed altitude.
   */
  async *navlog(
    dep: string, dest: string, altitudeFt?: string, aircraft?: AircraftChoice, altitudeChoice?: AltitudeChoice,
    depart?: string, signal?: AbortSignal, stops?: string[], classBClearance?: boolean, altitudes?: string,
    checkpoints = true, rules: "vfr" | "ifr" = "vfr", alternate = "", procedures = "", crossings = "", ground = "", holds = "",
    altitudeNearest = false, runways = "",
  ): AsyncGenerator<NavLogMessage> {
    const result = await planner.GET("/api/navlog", {
      params: {
        query: {
          dep, dest, stops: stopsParam(stops),
          altitude_ft: altitudeFt ? Number(altitudeFt) : undefined,
          // Picked on the wheel: each leg at its nearest legal altitude.
          altitude_nearest: altitudeFt && altitudeNearest ? true : undefined,
          altitude_choice: altitudeChoice && altitudeChoice !== "fastest" ? altitudeChoice : undefined,
          aircraft: aircraft?.profile,
          cruise_tas_kt: aircraft?.cruiseTasKt,
          fuel_burn_gph: aircraft?.fuelBurnGph,
          usable_fuel_gal: aircraft?.usableFuelGal,
          climb_tas_kt: aircraft?.climbTasKt,
          climb_fuel_burn_gph: aircraft?.climbFuelBurnGph,
          cruise_power_pct: aircraft?.cruisePowerPct,
          service_ceiling_ft: aircraft?.serviceCeilingFt,
          depart: depart || undefined,
          class_b_clearance: classBClearance || undefined,
          altitudes: altitudes || undefined,
          checkpoints: checkpoints ? undefined : false,
          // Under IFR (the planner's vfr.ifr); VFR, the default, unsaid.
          rules: rules === "ifr" ? rules : undefined,
          // The IFR alternate filed, whose fuel is in the totals.
          alternate: rules === "ifr" && alternate ? alternate : undefined,
          // The procedures picked, which the legs are flown by and the
          // descents planned to.
          procedures: procedures || undefined,
          // The runway each departure picked is left from.
          runways: runways || undefined,
          // The altitudes given to cross their fixes at.
          crossings: crossings || undefined,
          ground: ground || undefined,
          // The pilot's holds, flown on the legs leaving their points.
          holds: holds || undefined,
        },
      },
      parseAs: "stream", signal,
    });
    yield* ndjson<NavLogMessage>(result.data as ReadableStream | undefined);
  },

  /** Every Class B airport, with its current weather and the terminal
   *  chart covering it. One call for all thirty rather than one per
   *  marker on hover: the planner has the airspace and both national
   *  weather caches in memory already. */
  classB: () => planner.GET("/api/class-b").then(data<ClassBResponse>).then(r => r.airports),
  tfrs: () => planner.GET("/api/tfrs").then(data<Tfrs>).then(r => r.tfrs),
  nearestAirports: (lat: number, lon: number) =>
    planner.GET("/api/airports/nearest", { params: { query: { lat, lon, limit: 10 } } }).then(data<NearestAirports>).then(r => r.airports),
  /** Where a place typed is -- an airport, a town, an address -- for
   *  Nearest to find the fields near it. */
  placesSearch: (q: string) =>
    planner.GET("/api/places/search", { params: { query: { q } } }).then(data<PlacesFound>).then(r => r.places),

  /** Which of the services the developer console links to are
   *  running, and whether starting one is possible here at all. */
  devServices: () => planner.GET("/api/dev/services").then(data<DevServices>),

  /** Start one, if it is not already up. Already running is a success:
   *  the console asks on every click so the link always works. */
  startDevService: (service: string) =>
    planner.POST("/api/dev/services/{service}/start", { params: { path: { service } } })
      .then(data<DevServiceStarted>),

  /** The stock performance profiles the nav log can be computed for. */
  /** Under IFR: the destination's "1-2-3" (14 CFR 91.169(b)) for an ETA,
   *  the pilot's alternate checked at its own (91.169(c)), and the nearest
   *  fields that will do, reached at `tasKt`. */
  alternate: (dest: string, eta: string, tasKt: number, alternate?: string) =>
    planner.GET("/api/alternate", { params: { query: { dest, eta, tas_kt: tasKt, alternate: alternate || undefined } } })
      .then(data<Alternates>),

  /** A flight from one airport back to it, with no stops -- the pattern,
   *  practice approaches: its time aloft at the airplane's burn, and the
   *  fuel check. */
  localFlight: (ident: string, durationMin: number, aircraft?: AircraftChoice, depart?: string, rules: "vfr" | "ifr" = "vfr") =>
    planner.GET("/api/local-flight", {
      params: {
        query: {
          dep: ident, dest: ident, duration_min: durationMin, aircraft: aircraft?.profile,
          cruise_tas_kt: aircraft?.cruiseTasKt, fuel_burn_gph: aircraft?.fuelBurnGph, usable_fuel_gal: aircraft?.usableFuelGal,
          climb_tas_kt: aircraft?.climbTasKt, climb_fuel_burn_gph: aircraft?.climbFuelBurnGph,
          cruise_power_pct: aircraft?.cruisePowerPct, service_ceiling_ft: aircraft?.serviceCeilingFt, depart: depart || undefined,
          rules: rules === "ifr" ? rules : undefined,
        },
      },
    }).then(data<Totals>),

  aircraftProfiles: () => planner.GET("/api/aircraft-profiles").then(data<AircraftProfiles>).then(r => r.profiles),

  /** The whole stack in one snapshot -- the developer console. */
  status: () => planner.GET("/api/status").then(data<Status>),

  /** One run of the training DAG through Airflow; 501 with the CLI
   *  alternative when the planner has no Airflow to reach. */
  retrain: () => planner.POST("/api/retrain").then(data<RetrainStarted>),

  /** Fetch and render the FAA's current chart cycle now, in the
   *  planner's own background subprocess (it also does this daily). */
  refreshCharts: () => planner.POST("/api/charts/refresh").then(data<ChartRefreshStarted>),

  /** Adverse conditions, current/forecast weather, and airport info
   *  for the briefing -- one plain response, not a stream: every piece
   *  is a single quick call, not navlog's slow per-leg loop. */
  /** The briefing for the flight: its forecast is read from `depart`
   *  (now when empty) to an hour past arrival, `eteMin` later. */
  /** The route from the side: the ground and the airspace along it. */
  routeProfile: (dep: string, dest: string, stops?: string[]) =>
    planner.GET("/api/route-profile", { params: { query: { dep, dest, stops: stopsParam(stops) } } }).then(data<RouteProfile>),

  briefing: (dep: string, dest: string, depart?: string, eteMin?: number, stops?: string[], signal?: AbortSignal) =>
    planner.GET("/api/briefing", {
      params: { query: { dep, dest, stops: stopsParam(stops), depart, ete_min: eteMin } }, signal,
    }).then(data<Briefing>),

  /** The chart the map draws, for a map with no route on it yet. */
  chart: () => planner.GET("/api/chart").then(data<ChartInfo>),

  /** What the chart draws at a point, so an added pick is categorised from
   *  the pixels rather than from whatever a dropdown was left on. */
  classify: (lat: number, lon: number) =>
    planner.GET("/api/classify", { params: { query: { lat, lon } } }).then(data<Classification>),

  savePick: (pick: {
    departure_ident: string;
    destination_ident: string;
    lat: number;
    lon: number;
    source: "detected" | "added";
    category: string;
    role?: Role;
    rating: Rating | null;
    area_m2?: number | null;
  }) => planner.POST("/api/picks", { body: pick }).then(data<PickSaved>),

  deletePick: (dep: string, dest: string, lat: number, lon: number) =>
    planner.DELETE("/api/picks", { params: { query: { dep, dest, lat, lon } } }).then(data<PickDeleted>),

  /**
   * Detections, streamed a block at a time from the departure end, so
   * the map fills where the work starts while the rest is still being
   * read.
   */
  async *detect(dep: string, dest: string, signal?: AbortSignal): AsyncGenerator<StreamMessage> {
    const result = await planner.GET("/api/detect/stream", { params: { query: { dep, dest } }, parseAs: "stream", signal });
    yield* ndjson<StreamMessage>(result.data as ReadableStream | undefined);
  },

  /**
   * One "how to spot it" line per checkpoint, in route order -- the
   * same streaming shape as `detect`, so a slow LLM call on one
   * checkpoint doesn't hold up the ones that already arrived.
   */
  async *describeCheckpoints(
    dep: string, dest: string, signal?: AbortSignal, stops: string[] = [],
  ): AsyncGenerator<CheckpointDescriptionMessage> {
    // A POST: each checkpoint without a note is a billed Claude call.
    const result = await planner.POST("/api/checkpoint-notes/generate", {
      body: { departure_ident: dep, destination_ident: dest, stops },
      parseAs: "stream", signal,
    });
    yield* ndjson<CheckpointDescriptionMessage>(result.data as ReadableStream | undefined);
  },

  /** A pilot's own edit to one checkpoint's identification note. */
  saveCheckpointNote: (dep: string, dest: string, lat: number, lon: number, description: string, stops: string[] = []) =>
    planner.POST("/api/checkpoint-notes", {
      body: { departure_ident: dep, destination_ident: dest, stops, lat, lon, description },
    }).then(data<CheckpointNoteSaved>),

  /** How the currently promoted model was actually chosen -- every
   *  algorithm retrain() tried, not just the winner. */
  modelComparison: () => planner.GET("/api/model-comparison").then(data<ModelComparison>),

  /** Every US airport the search answers with, for the phone to search
   *  on its own as a pilot types (lib/airportIndex): rows of ident, name,
   *  town, state, size rank and the other idents each is found by. */
  airportIndex: () =>
    // Behind what the page needs first: half a megabyte, wanted only when
    // a pilot types.
    planner.GET("/api/airports/index", { params: { query: { v: INDEX_VERSION } }, priority: "low" }).then(r => r.data as unknown as { airports: unknown[][] }),

  /** The same answer's bytes, unread, into the browser's cache and the
   *  service worker's, where airportIndex finds them when a pilot types:
   *  the download ahead of time, the reading (a long task) only then. */
  warmAirportIndex: () =>
    planner.GET("/api/airports/index", { params: { query: { v: INDEX_VERSION } }, priority: "low", parseAs: "blob" }).then(() => true),

  /** DEP/DEST's own autocomplete -- airports whose ident or name
   *  starts with `q`. Empty `q` short-circuits server-side to `[]`, so
   *  this is safe to call on every keystroke including the first. */
  airportSearch: (q: string, fixes = false, near = "") =>
    planner.GET("/api/airports/search", { params: { query: { q, fixes: fixes || undefined, near: near || undefined } } })
      .then(data<AirportSearch>).then(r => r.airports),

  /** One airport's card: where it is, the airspace over it, its runways
   *  and radio, and the weather there now. Ahead of the chart's tiles,
   *  as the fields in view are (`priority`). */
  /** The mock oral (the planner's app.oral): a question about this
   *  flight, and an answer graded. The developer's, for now. */
  oral: {
    question: (body: OralQuestionRequest) => planner.POST("/api/oral/question", { body }).then(data<OralQuestion>),
    grade: (body: OralGradeRequest) => planner.POST("/api/oral/grade", { body }).then(data<OralGrade>),
  },
  airport: (ident: string) =>
    planner.GET("/api/airport/{ident}", { params: { path: { ident } }, priority: "high" }).then(data<AirportPlace>),
  /** The pictures an airport's card swipes through behind its diagram. */
  airportPhotos: (ident: string) =>
    planner.GET("/api/airport/{ident}/photos", { params: { path: { ident } } }).then(data<AirportPhotos>),
  /** The fields along the route to stop at, for the map's Stops: asked
   *  again while some of their places are still being read (`pending`). */
  routeStops: (dep: string, dest: string, stops: string) =>
    planner.GET("/api/route-stops", { params: { query: { dep, dest, stops } } }).then(data<RouteStops>),
  /** What the field offers on the ground, for a stop: its own request, as
   *  the places near it take the planner a second or two the first time. */
  airportServices: (ident: string) =>
    planner.GET("/api/airport/{ident}/services", { params: { path: { ident } } }).then(data<AirportServices>),
  /** The wind a TAF forecasts at a field for a time (ISO), its own or the
   *  nearest's within 30 nm; null where none covers it. */
  forecastWind: (ident: string, at: string) =>
    planner.GET("/api/airport/{ident}/forecast-wind", { params: { path: { ident }, query: { at } } }).then(data<ForecastWind | null>),
  /** The field's instrument procedures -- approaches, arrivals and
   *  departures -- from the FAA's CIFP, for the route's Procedures. */
  procedures: (ident: string) =>
    planner.GET("/api/airport/{ident}/procedures", { params: { path: { ident } } }).then(data<ProcedureList>),
  /** One of them drawn for the map, with the transition picked. */
  procedure: (ident: string, procedure: string, transition: string | null) =>
    planner.GET("/api/airport/{ident}/procedures/{procedure}", {
      params: { path: { ident, procedure }, query: transition ? { transition } : {} },
    }).then(data<ProcedureDrawing>),
  /** An approach's plate's plan view placed on the map, where the planner
   *  could place it (vfr.plates); 404 where it could not. */
  plate: (ident: string, procedure: string) =>
    planner.GET("/api/airport/{ident}/procedures/{procedure}/plate", { params: { path: { ident, procedure } } }).then(data<PlateOverlay>),
  /** The pages of one of the FAA's charts, by its address, drawn by the
   *  planner -- of a booklet, the ones naming `airport`. */
  faaChart: (url: string, airport: string) =>
    planner.GET("/api/faa-chart", { params: { query: { url, airport } } }).then(data<ChartPages>),

  /** The landing fields inside a box, the biggest first, each with its
   *  METAR's flight category: what the map lays its chips and tap
   *  targets over, so the chart's own airports open cards. `reporting`,
   *  the ones with a METAR alone. Asked for ahead of the chart's tiles
   *  (`priority`): over plain http a browser opens six connections to
   *  a host, and on a zoom sixty tiles queued in front of it. */
  airportsInView: (box: { south: number; west: number; north: number; east: number; limit?: number; reporting?: boolean }) =>
    planner.GET("/api/airports/in-view", { params: { query: box }, priority: "high" })
      .then(data<AirportsInView>).then(r => r.airports),

  /** The airspace over a point, from the ground up: the classes in
   *  bands with their minimums, the Mode C veil, special use and TFRs. */
  airspaceAt: (lat: number, lon: number) =>
    planner.GET("/api/airspace/at", { params: { query: { lat, lon } } }).then(data<AirspaceAt>),

  /** What is ahead of own ship in the air (lib/map/ahead): airspace,
   *  special-use areas and TFRs its track goes into, the ground and
   *  obstacles it comes near. */
  airspaceAhead: (ask: { lat: number; lon: number; track: number; gs: number; alt?: number; vs: number }) =>
    planner.GET("/api/airspace/ahead", { params: { query: ask } }).then(data<AlertsAhead>),

  /** The airplanes ADS-B receivers hear within `radius` nm of a point,
   *  from adsb.lol's open data (TrafficLayer). */
  traffic: (ask: { lat: number; lon: number; radius: number }) =>
    planner.GET("/api/traffic", { params: { query: ask } }).then(data<Traffic>),

  /** Where airplanes are based, the field their last flights keep to; the
   *  ones still being looked up pending (the Aircraft tab's "based at"). */
  trafficBased: (hexes: string[]) =>
    planner.GET("/api/traffic/based", { params: { query: { hex: hexes.join(",") } } }).then(data<AircraftBases>),

  /** The airplanes in the air a pilot names, by callsign, registration or
   *  ICAO address, to track one (AircraftCard); with none in the air, the
   *  FAA's record of the one named, to open its card all the same. */
  /** An airplane's planning figures read off a photo of its handbook page
   *  (the planner's app.handbook), for the pilot to check and save. */
  readHandbook: (imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp") =>
    planner.POST("/api/handbook/read", { body: { image_base64: imageBase64, media_type: mediaType } }).then(data<HandbookFigures>),
  trafficFind: (q: string) =>
    planner.GET("/api/traffic/find", { params: { query: { q } } }).then(data<TrafficFound>),

  /** A tracked flight's airplane, where it took off and its path today,
   *  and a US airplane's FAA registration. */
  /** An airplane's flights of the last seven days, newest first. */
  /** Its last ten flights found, or those before a day (`until`) and a
   *  takeoff (`before`, the last listed): the list's next page. */
  trafficHistory: (hex: string, from?: { until?: string; before?: number }) =>
    planner.GET("/api/traffic/flight/{hex_id}/history", {
      params: { path: { hex_id: hex }, query: { until: from?.until, before: from?.before } },
    }).then(data<PastFlights>),
  /** One of them, its reports, for its track log and its replay. */
  trafficPastFlight: (hex: string, id: number) =>
    planner.GET("/api/traffic/flight/{hex_id}/history/{flight_id}", { params: { path: { hex_id: hex, flight_id: id } } })
      .then(data<PastFlight>),
  trafficFlight: (hex: string) =>
    planner.GET("/api/traffic/flight/{hex_id}", { params: { path: { hex_id: hex } } }).then(data<FlightDetail>),
  /** Its state now, seconds old, for the alerts a pilot sets on it: in
   *  the air or not, where, and the field it left or has landed at. */
  trafficStatus: (hex: string) =>
    planner.GET("/api/traffic/flight/{hex_id}/status", { params: { path: { hex_id: hex } } }).then(data<FlightStatus>),

  /** The deployment's key for Google's map tiles; a 404 where it has
   *  none (OverlayTiles). */
  googleMaps: () => planner.GET("/api/map/google").then(data<GoogleMaps>),

  /** The route a flight number is scheduled to fly, and whether the
   *  airplane where it is now is on it; null for none known. */
  trafficRoute: (ask: { callsign: string; lat?: number; lon?: number }) =>
    planner.GET("/api/traffic/route", { params: { query: ask } }).then(data<FlightRoute | null>),

  /** The VFR waypoints in the map's view (VPBNG), for its diamonds. */
  waypointsInView: (box: { south: number; west: number; north: number; east: number }) =>
    planner.GET("/api/waypoints/in-view", { params: { query: box } }).then(data<WaypointsInView>).then(r => r.waypoints),

  /**
   * The signed-in pilot, or null when signed out -- a Spring Boot
   * endpoint, not proxied through the planner. Signed out it answers 204,
   * nothing (PilotController); a 401, from a server before that, is the
   * same answer, so this resolves to null instead of throwing.
   */
  async me(): Promise<Pilot | null> {
    try {
      return (await webapp.GET("/api/me").then(data<Pilot>)) ?? null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },

  /** The iOS app's Sign in with Apple: the native sheet's identity
   *  token, which the webapp checks before signing the pilot in on this
   *  session (AppleNativeSignInController); answers where to go next. */
  signInWithAppleNative: (identityToken: string) =>
    webapp.POST("/api/auth/apple/native", { body: { identityToken } }).then(data<AppleSignedIn>),

  /** A code for this TV to be signed in with from a phone
   *  (DeviceSignInController): shown, with the address to type it at. */
  deviceCode: () => webapp.POST("/api/auth/device").then(data<DeviceCode>),

  /** Whether this TV's code has been typed in on a phone: not yet
   *  ("waiting"), signed in now with where to go, or run out ("gone"),
   *  for which the TV asks for a new one. */
  deviceToken: async (deviceCode: string): Promise<AppleSignedIn | "waiting" | "gone"> => {
    try {
      const { data: answer, response } = await webapp.POST("/api/auth/device/token", { body: { deviceCode } });
      return response.status === 202 ? "waiting" : answer as AppleSignedIn;
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) return "gone";
      throw err;
    }
  },

  /** The code a TV shows, typed in by the pilot signed in here: the TV
   *  is signed in as them at its next ask. */
  approveDevice: async (userCode: string): Promise<void> => {
    await webapp.POST("/api/auth/device/approve", { body: { userCode } });
  },

  /** The signed-in pilot's telephone number and home base, both at once,
   *  for a flight plan's item 19 (PilotController); blank is none. */
  setContact: (body: PilotContactRequest) => webapp.PUT("/api/me/contact", { body }).then(data<Pilot>),

  /** Deletes the signed-in pilot's account and everything that was
   *  theirs, on every device, and signs them out (a 204). A 502 deleted
   *  nothing: the planner could not take their notes. */
  async deleteAccount(): Promise<void> {
    await webapp.DELETE("/api/me");
  },

  /**
   * What signing in can do here. Public, and asked before any session
   * exists: a deployment with no Google or Apple credentials and no
   * mail host cannot hold a role at all, which is what decides whether
   * the developer's switch is offered to a caller with no session.
   */
  capabilities: () => webapp.GET("/api/auth/capabilities").then(data<SignInCapabilities>),

  /** POSTs to Spring Security's own logout endpoint, which no schema
   *  describes: a 204 once the session is gone (SecurityConfig). The
   *  caller re-checks `me()` afterwards. */
  async logout(): Promise<void> {
    const res = await fetch("/logout", { method: "POST", headers: csrfHeaders("POST") });
    await failIfNotOk(res);
  },

  /**
   * Starts a magic-link sign-in -- always resolves (202) regardless of
   * whether the address has ever signed in before, the server's own
   * enumeration-safe answer. Throws only on a genuine failure (a
   * malformed address the server's own validation rejects with 400).
   */
  requestMagicLink: async (email: string): Promise<void> => {
    await webapp.POST("/api/auth/magic-link", { body: { email } });
  },

  /**
   * The last step of an emailed-link sign-in: the one POST that spends
   * the token (MagicLinkController#verify), made from the planner's own
   * dialog. Answers where the server sent the browser -- the planner,
   * or the dev page for a developer -- for the caller to open, now with
   * the new session's cookie. A link already used or past its 15
   * minutes throws an ApiError with status 400.
   */
  finishMagicLink: async (token: string): Promise<string> => {
    const res = await fetch("/api/auth/magic-link/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...csrfHeaders("POST") },
      body: new URLSearchParams({ token }),
    });
    await failIfNotOk(res);
    if (!res.redirected) return "/app/plan";
    const landing = new URL(res.url);
    return landing.pathname + landing.search;
  },

  /**
   * One framework's narrative for the nav log on screen, streamed as
   * Claude writes it -- a separate top-level controller
   * (ComparisonProxyController), since neither nav-log-agent (LangGraph)
   * nor crewai-agent (CrewAI) is planning-service's concern. Each is a
   * real, billed Claude call, and a pilot picking one shouldn't pay for
   * the other. The same NDJSON shape as `navlog`: text deltas, then
   * `done` or `error`.
   */
  async *frameworkNarrative(
    framework: "langgraph" | "crewai", request: NarrativeRequest, signal?: AbortSignal,
  ): AsyncGenerator<NarrativeMessage> {
    // A plain fetch: the webapp forwards this body to the agent as it
    // is, so its schema describes it only as a string.
    const res = await fetch(`/api/comparison?${new URLSearchParams({ framework })}`, {
      method: "POST", signal, body: JSON.stringify(request),
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
    });
    // Once anyone can sign in, a narrative -- a billed Claude call --
    // needs a session, and Spring's 401 carries no body to say so.
    if (res.status === 401) throw new ApiError("Sign in to generate a narrative", 401);
    await failIfNotOk(res);
    yield* ndjson<NarrativeMessage>(res.body ?? undefined);
  },

  /** A signed-in pilot's own airplanes -- also a Spring Boot call,
   *  like `me()`: nothing here is planning-service's concern. */
  aircraft: {
    list: () => webapp.GET("/api/aircraft").then(data<Aircraft[]>),
    add: (request: AircraftRequest) => webapp.POST("/api/aircraft", { body: request }).then(data<Aircraft>),
    update: (id: number, request: AircraftRequest) =>
      webapp.PUT("/api/aircraft/{id}", { params: { path: { id } }, body: request }).then(data<Aircraft>),
    remove: async (id: number): Promise<void> => {
      await webapp.DELETE("/api/aircraft/{id}", { params: { path: { id } } });
    },
    /** Its VOR check for IFR, recorded (14 CFR 91.171(d)). */
    vorCheck: (id: number, request: VorCheckRequest) =>
      webapp.PUT("/api/aircraft/{id}/vor-check", { params: { path: { id } }, body: request }).then(data<Aircraft>),
    /** Its inspections and tests, recorded all at once (14 CFR 91.409,
     *  91.411, 91.413, 91.207). */
    inspections: (id: number, request: InspectionsRequest) =>
      webapp.PUT("/api/aircraft/{id}/inspections", { params: { path: { id } }, body: request }).then(data<Aircraft>),
    /** Its checklist, as its owner wrote it, and that replaced whole. */
    checklist: (id: number) =>
      webapp.GET("/api/aircraft/{id}/checklist", { params: { path: { id } } }).then(data<ChecklistDto>),
    saveChecklist: (id: number, checklist: ChecklistDto) =>
      webapp.PUT("/api/aircraft/{id}/checklist", { params: { path: { id } }, body: checklist }).then(data<ChecklistDto>),
    /** Its squawks, newest first; one written, changed or fixed, or taken out. */
    squawks: (id: number) => webapp.GET("/api/aircraft/{id}/squawks", { params: { path: { id } } }).then(data<Squawk[]>),
    addSquawk: (id: number, squawk: SquawkRequest) =>
      webapp.POST("/api/aircraft/{id}/squawks", { params: { path: { id } }, body: squawk }).then(data<Squawk>),
    updateSquawk: (id: number, squawkId: number, squawk: SquawkRequest) =>
      webapp.PUT("/api/aircraft/{id}/squawks/{squawkId}", { params: { path: { id, squawkId } }, body: squawk }).then(data<Squawk>),
    removeSquawk: async (id: number, squawkId: number): Promise<void> => {
      await webapp.DELETE("/api/aircraft/{id}/squawks/{squawkId}", { params: { path: { id, squawkId } } });
    },
  },

  /** The signed-in pilot's subscription to the paid features, and the
   *  free month started: once an account, a 409 after. */
  subscription: {
    get: () => webapp.GET("/api/subscription").then(data<Subscription>),
    startTrial: () => webapp.POST("/api/subscription/trial").then(data<Subscription>),
  },

  /** Flight Service's filing through the app (FlightServiceController):
   *  whether it is connected, and a flight plan filed in the pilot's name. */
  flightService: {
    status: () => webapp.GET("/api/flight-service").then(data<FlightServiceStatus>),
    file: (plan: FlightPlanFilingRequest) =>
      webapp.POST("/api/flight-service/flight-plans", { body: plan }).then(data<FlightPlanFiled>),
  },

  /** The web app's speed, a day at a time (SpeedController): the
   *  developer's Speed page. */
  speedTrend: (days = 90) => webapp.GET("/api/speed", { params: { query: { days } } }).then(data<SpeedDay[]>),

  /** A signed-in pilot's logbook and currency. */
  logbook: {
    list: () => webapp.GET("/api/logbook").then(data<LogbookEntry[]>),
    add: (request: LogbookEntryRequest) => webapp.POST("/api/logbook", { body: request }).then(data<LogbookEntry>),
    update: (id: number, request: LogbookEntryRequest) =>
      webapp.PUT("/api/logbook/{id}", { params: { path: { id } }, body: request }).then(data<LogbookEntry>),
    remove: async (id: number): Promise<void> => {
      await webapp.DELETE("/api/logbook/{id}", { params: { path: { id } } });
    },
    currency: () => webapp.GET("/api/logbook/currency").then(data<Currency>),
    setCurrencyDates: (request: CurrencyDatesRequest) => webapp.PUT("/api/logbook/currency", { body: request }).then(data<Currency>),
    /** Whether the pilot is emailed before their currency runs out. */
    reminders: () => webapp.GET("/api/logbook/reminders").then(data<Reminders>),
    setReminders: (on: boolean) => webapp.PUT("/api/logbook/reminders", { body: { on } }).then(data<Reminders>),
    /** Flights from a file, those already in the logbook left out. */
    importAll: (entries: LogbookEntryRequest[]) =>
      webapp.POST("/api/logbook/import", { body: { entries } }).then(data<LogbookImportResult>),
  },

  /** A student's way to the checkride, beside the logbook. */
  training: {
    get: () => webapp.GET("/api/training").then(data<Training>),
    setKnowledgeTest: (codes: string[]) =>
      webapp.PUT("/api/training/knowledge-test", { body: { codes } }).then(data<Training>),
    endorse: (code: string, endorsedOn: string) =>
      webapp.PUT("/api/training/endorsements/{code}", { params: { path: { code } }, body: { endorsedOn } }).then(data<Training>),
    withdraw: (code: string) =>
      webapp.DELETE("/api/training/endorsements/{code}", { params: { path: { code } } }).then(data<Training>),
    /** Their name as their certificate gives it, which endorsements use. */
    setName: (fullName: string) => webapp.PUT("/api/training/name", { body: { fullName } }).then(data<Training>),
    /** An instructor asked in by address, who is emailed. */
    askInstructor: (email: string) => webapp.POST("/api/training/instructors", { body: { email } }).then(data<Training>),
    dropInstructor: (id: number) =>
      webapp.DELETE("/api/training/instructors/{id}", { params: { path: { id } } }).then(data<Training>),
    /** A saved flight put to an instructor for its solo cross-country review. */
    askReview: (body: { flightId: number; instructorId: number; makeModel: string; flightOn: string; note: string | null }) =>
      webapp.POST("/api/training/reviews", { body }).then(data<Training>),
    withdrawReview: (id: number) =>
      webapp.DELETE("/api/training/reviews/{id}", { params: { path: { id } } }).then(data<Training>),
  },

  /** The pilot as a flight instructor: their certificate, students,
   *  reviews and the endorsements they sign. */
  instructor: {
    get: () => webapp.GET("/api/instructor").then(data<Instructor>),
    set: (body: InstructorRequest) => webapp.PUT("/api/instructor", { body }).then(data<Instructor>),
    stop: () => webapp.DELETE("/api/instructor").then(data<Instructor>),
    accept: (linkId: number) =>
      webapp.POST("/api/instructor/students/{linkId}/accept", { params: { path: { linkId } } }).then(data<Instructor>),
    leave: (linkId: number) =>
      webapp.DELETE("/api/instructor/students/{linkId}", { params: { path: { linkId } } }).then(data<Instructor>),
    student: (studentId: number) =>
      webapp.GET("/api/instructor/students/{studentId}/training", { params: { path: { studentId } } }).then(data<Training>),
    sign: (studentId: number, body: SignRequest) =>
      webapp.POST("/api/instructor/students/{studentId}/endorsements", { params: { path: { studentId } }, body }).then(data<Training>),
    voidEndorsement: (id: number) =>
      webapp.POST("/api/instructor/endorsements/{id}/void", { params: { path: { id } } }).then(data<Instructor>),
    decline: (id: number, note: string) =>
      webapp.POST("/api/instructor/reviews/{id}/decline", { params: { path: { id } }, body: { note } }).then(data<Instructor>),
  },

  /** A signed-in pilot's own filed flights. */
  flights: {
    list: () => webapp.GET("/api/flights").then(data<FlightSummary[]>),
    save: (request: SaveFlightRequest) => webapp.POST("/api/flights", { body: request }).then(data<Flight>),
    remove: async (id: number): Promise<void> => {
      await webapp.DELETE("/api/flights/{id}", { params: { path: { id } } });
    },
    /** One flight with its nav log, for its debrief. */
    get: (id: number) => webapp.GET("/api/flights/{id}", { params: { path: { id } } }).then(data<Flight>),
    /** Its track as saved to the account, or null where none is. */
    track: (id: number): Promise<SavedTrack | null> =>
      webapp.GET("/api/flights/{id}/track", { params: { path: { id } } }).then(data<SavedTrack>).catch(err => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    saveTrack: async (id: number, track: SavedTrack): Promise<void> => {
      await webapp.PUT("/api/flights/{id}/track", { params: { path: { id } }, body: track });
    },
    deleteTrack: async (id: number): Promise<void> => {
      await webapp.DELETE("/api/flights/{id}/track", { params: { path: { id } } });
    },
  },
};
