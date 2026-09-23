import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import type { paths as WebappPaths } from "./webapp-schema";
import type {
  Aircraft, AircraftChoice, AircraftProfiles, AircraftRequest, AirportSearch, AltitudeChoice, Briefing, BuildJob,
  BuiltRoutes, ChartRefreshStarted, CheckpointDescriptionMessage, CheckpointNoteSaved, Checkpoints, Classification, Course,
  Flight, FlightSummary, ModelComparison, NarrativeMessage, NarrativeRequest, NavLogMessage, PickDeleted, PickSaved,
  ClassBResponse, DevServices, DevServiceStarted, PicksResponse, Pilot, Rating, RetrainStarted, Role, SaveFlightRequest,
  SignInCapabilities,
  Status, StreamMessage,
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
  constructor(message: string, readonly status: number) {
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
 *  point), and falls through to the status text. */
async function detailOf(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { detail?: string; error?: string };
  return body.detail ?? body.error ?? response.statusText ?? "request failed";
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
 * served under `/api/planner/…` (PlannerProxyController), which this
 * middleware writes in.
 */
const throughGateway: Middleware = {
  onRequest({ request }) {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/^\/api\//, "/api/planner/");
    return new Request(url, request);
  },
};

const planner = createClient<paths>({ baseUrl: "" });
planner.use(throughGateway, csrfAndFailures);

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
export function describeError(err: unknown, fallback = "request failed"): string {
  const firstLine = err instanceof Error ? err.message.split("\n")[0] : undefined;
  return firstLine || fallback;
}

/** `describeError` for a query's `error` field, which is null while
 *  nothing has failed -- and so is this. */
export const errorMessage = (err: unknown, fallback: string) => (err ? describeError(err, fallback) : null);

export const api = {
  /** The leg itself: sub-second, and enough to draw before any tile is read. */
  course: (dep: string, dest: string) =>
    planner.GET("/api/course", { params: { query: { dep, dest } } }).then(data<Course>),

  /** Scored candidates and the subset worth flying. Fast -- the model is
   *  loaded and the features are already built. */
  checkpoints: (dep: string, dest: string) =>
    planner.GET("/api/checkpoints", { params: { query: { dep, dest } } }).then(data<Checkpoints>),

  /**
   * The slow half: terrain, the obstacle file, the airspace shapefile
   * and live winds. Asked for separately so none of it delays the
   * chart, and streamed rather than one blocking response so a pilot
   * sees which of those it's actually doing right now. `depart`, an ISO
   * instant, picks the winds forecast period; absent means about now.
   * `altitudeChoice` is which of the planner's three plans the legs
   * fly, meaningful only without a typed altitude.
   */
  async *navlog(
    dep: string, dest: string, altitudeFt?: string, aircraft?: AircraftChoice, altitudeChoice?: AltitudeChoice,
    depart?: string, signal?: AbortSignal,
  ): AsyncGenerator<NavLogMessage> {
    const result = await planner.GET("/api/navlog", {
      params: {
        query: {
          dep, dest,
          altitude_ft: altitudeFt ? Number(altitudeFt) : undefined,
          altitude_choice: altitudeChoice && altitudeChoice !== "lowest" ? altitudeChoice : undefined,
          aircraft: aircraft?.profile,
          cruise_tas_kt: aircraft?.cruiseTasKt,
          fuel_burn_gph: aircraft?.fuelBurnGph,
          usable_fuel_gal: aircraft?.usableFuelGal,
          depart: depart || undefined,
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

  /** Which of the services the developer console links to are
   *  running, and whether starting one is possible here at all. */
  devServices: () => planner.GET("/api/dev/services").then(data<DevServices>),

  /** Start one, if it is not already up. Already running is a success:
   *  the console asks on every click so the link always works. */
  startDevService: (service: string) =>
    planner.POST("/api/dev/services/{service}/start", { params: { path: { service } } })
      .then(data<DevServiceStarted>),

  /** The stock performance profiles the nav log can be computed for. */
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
  briefing: (dep: string, dest: string) =>
    planner.GET("/api/briefing", { params: { query: { dep, dest } } }).then(data<Briefing>),

  /** Corridors the feature store already covers. */
  routes: () => planner.GET("/api/routes").then(data<BuiltRoutes>),

  /** Start collecting a corridor: minutes of Overpass, FAA and elevation
   *  calls, so it returns a job id rather than holding the request open. */
  startBuild: (dep: string, dest: string) =>
    planner.POST("/api/build", { body: { departure_ident: dep, destination_ident: dest } }).then(data<BuildJob>),

  buildStatus: (jobId: string) =>
    planner.GET("/api/build/{job_id}", { params: { path: { job_id: jobId } } }).then(data<BuildJob>),

  /** What the chart draws at a point, so an added pick is categorised from
   *  the pixels rather than from whatever a dropdown was left on. */
  classify: (lat: number, lon: number) =>
    planner.GET("/api/classify", { params: { query: { lat, lon } } }).then(data<Classification>),

  picks: (dep: string, dest: string) =>
    planner.GET("/api/picks", { params: { query: { dep, dest } } }).then(data<PicksResponse>),

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
    dep: string, dest: string, altitudeFt?: string, signal?: AbortSignal,
  ): AsyncGenerator<CheckpointDescriptionMessage> {
    const result = await planner.GET("/api/checkpoint-notes", {
      params: { query: { dep, dest, altitude_ft: altitudeFt ? Number(altitudeFt) : undefined } },
      parseAs: "stream", signal,
    });
    yield* ndjson<CheckpointDescriptionMessage>(result.data as ReadableStream | undefined);
  },

  /** A pilot's own edit to one checkpoint's identification note. */
  saveCheckpointNote: (dep: string, dest: string, lat: number, lon: number, description: string) =>
    planner.POST("/api/checkpoint-notes", {
      body: { departure_ident: dep, destination_ident: dest, lat, lon, description },
    }).then(data<CheckpointNoteSaved>),

  /** How the currently promoted model was actually chosen -- every
   *  algorithm retrain() tried, not just the winner. */
  modelComparison: () => planner.GET("/api/model-comparison").then(data<ModelComparison>),

  /** DEP/DEST's own autocomplete -- airports whose ident or name
   *  starts with `q`. Empty `q` short-circuits server-side to `[]`, so
   *  this is safe to call on every keystroke including the first. */
  airportSearch: (q: string) =>
    planner.GET("/api/airports/search", { params: { query: { q } } }).then(data<AirportSearch>).then(r => r.airports),

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

  /**
   * What signing in can do here. Public, and asked before any session
   * exists: a deployment with no Google or Apple credentials and no
   * mail host cannot hold a role at all, which is what decides whether
   * the developer's switch is offered to a caller with no session.
   */
  capabilities: () => webapp.GET("/api/auth/capabilities").then(data<SignInCapabilities>),

  /** POSTs to Spring Security's own default logout endpoint, which no
   *  schema describes and whose response is a redirect (a login page's
   *  HTML), not JSON -- the caller re-checks `me()` afterwards; session
   *  cookies are cleared either way. */
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

  /** A signed-in pilot's own aeroplanes -- also a Spring Boot call,
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

  /** A signed-in pilot's own filed flights. */
  flights: {
    list: () => webapp.GET("/api/flights").then(data<FlightSummary[]>),
    get: (id: number) => webapp.GET("/api/flights/{id}", { params: { path: { id } } }).then(data<Flight>),
    save: (request: SaveFlightRequest) => webapp.POST("/api/flights", { body: request }).then(data<Flight>),
    remove: async (id: number): Promise<void> => {
      await webapp.DELETE("/api/flights/{id}", { params: { path: { id } } });
    },
  },
};
