import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import type { paths as WebappPaths } from "./webapp-schema";
import type {
  Aircraft, AircraftChoice, AircraftProfiles, AircraftRequest, AirportPlace, AirportSearch, AirportsInView, AltitudeChoice, Briefing,
  ChartInfo, ChartPages, ChartRefreshStarted, PlacesFound, CheckpointDescriptionMessage, CheckpointNoteSaved, Checkpoints, Classification, Course, Detour,
  Flight, FlightSummary, ModelComparison, NarrativeMessage, NarrativeRequest, NavLogMessage, PickDeleted, PickSaved,
  AirspaceAt, ClassBResponse, NearestAirports, RouteProfile, Tfrs, DevServices, DevServiceStarted, Pilot, Rating, RetrainStarted, Role, SaveFlightRequest,
  SignInCapabilities, AppleSignedIn, LogbookEntry, LogbookEntryRequest, Currency, CurrencyDatesRequest,
  Status, StreamMessage, Totals, WaypointsInView, Training, SavedTrack,
  OralQuestion, OralQuestionRequest, OralGrade, OralGradeRequest,
} from "./types";

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
async function* ndjson<T>(stream: ReadableStream | undefined): AsyncGenerator<T> {
  if (!stream) return;
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as T;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T;
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

export function describeError(err: unknown, fallback = "request failed"): string {
  if (err instanceof TypeError && NO_ANSWER.test(err.message)) {
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
    checkpoints = true,
  ): AsyncGenerator<NavLogMessage> {
    const result = await planner.GET("/api/navlog", {
      params: {
        query: {
          dep, dest, stops: stopsParam(stops),
          altitude_ft: altitudeFt ? Number(altitudeFt) : undefined,
          altitude_choice: altitudeChoice && altitudeChoice !== "fastest" ? altitudeChoice : undefined,
          aircraft: aircraft?.profile,
          cruise_tas_kt: aircraft?.cruiseTasKt,
          fuel_burn_gph: aircraft?.fuelBurnGph,
          usable_fuel_gal: aircraft?.usableFuelGal,
          climb_tas_kt: aircraft?.climbTasKt,
          climb_fuel_burn_gph: aircraft?.climbFuelBurnGph,
          cruise_power_pct: aircraft?.cruisePowerPct,
          depart: depart || undefined,
          class_b_clearance: classBClearance || undefined,
          altitudes: altitudes || undefined,
          checkpoints: checkpoints ? undefined : false,
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
  /** A flight from one airport back to it, with no stops -- the pattern,
   *  practice approaches: its time aloft at the airplane's burn, and the
   *  fuel check. */
  localFlight: (ident: string, durationMin: number, aircraft?: AircraftChoice, depart?: string) =>
    planner.GET("/api/local-flight", {
      params: {
        query: {
          dep: ident, dest: ident, duration_min: durationMin, aircraft: aircraft?.profile,
          cruise_tas_kt: aircraft?.cruiseTasKt, fuel_burn_gph: aircraft?.fuelBurnGph, usable_fuel_gal: aircraft?.usableFuelGal,
          climb_tas_kt: aircraft?.climbTasKt, climb_fuel_burn_gph: aircraft?.climbFuelBurnGph,
          cruise_power_pct: aircraft?.cruisePowerPct, depart: depart || undefined,
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

  /** DEP/DEST's own autocomplete -- airports whose ident or name
   *  starts with `q`. Empty `q` short-circuits server-side to `[]`, so
   *  this is safe to call on every keystroke including the first. */
  /** Every US airport the search answers with, for the phone to search
   *  on its own as a pilot types (lib/airportIndex): rows of ident, name,
   *  town, state, size rank and the other idents each is found by. */
  airportIndex: () =>
    // Behind what the page needs first: half a megabyte, wanted only when
    // a pilot types.
    planner.GET("/api/airports/index", { priority: "low" }).then(r => r.data as unknown as { airports: unknown[][] }),

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

  /** The VFR waypoints in the map's view (VPBNG), for its diamonds. */
  waypointsInView: (box: { south: number; west: number; north: number; east: number }) =>
    planner.GET("/api/waypoints/in-view", { params: { query: box } }).then(data<WaypointsInView>).then(r => r.waypoints),

  /**
   * The signed-in pilot, or null when signed out -- a Spring Boot
   * endpoint, not proxied through the planner. A 401 here is the normal
   * signed-out case, not a failure, so this resolves to null instead of
   * throwing.
   */
  async me(): Promise<Pilot | null> {
    try {
      return await webapp.GET("/api/me").then(data<Pilot>);
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
  },

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
