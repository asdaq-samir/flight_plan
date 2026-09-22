import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import type {
  Aircraft, AircraftChoice, AircraftProfileSummary, AircraftRequest, AirportSearch, AltitudeChoice, Briefing, BuildJob,
  BuiltRoutes, ChartRefreshStarted, CheckpointDescriptionMessage, CheckpointNoteSaved, Checkpoints, Classification, Course,
  Flight, FlightSummary, ModelComparison, NarrativeMessage, NarrativeRequest, NavLogMessage, PickDeleted, PickSaved,
  ClassBAirport, DevServices, PicksResponse, Pilot, Rating, RetrainStarted, Role, SaveFlightRequest,
  SignInCapabilities,
  Status, StreamMessage,
} from "./types";

/**
 * Every call the pages make. The planner's calls go through
 * openapi-fetch, typed end to end from planning-service's own OpenAPI
 * schema (`npm run types` regenerates ./schema.d.ts): a renamed query
 * parameter or response field is a compile error at the call site, not
 * a silent 404 or `undefined`. The Spring Boot calls at the bottom are
 * a plain fetch until that service publishes a schema of its own.
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The CSRF token, which the server sets as a readable cookie and expects
 * echoed back on anything that changes state. Session cookies are
 * attached by the browser on their own, which is the condition CSRF
 * exploits, so this is what distinguishes our own form post from someone
 * else's page making the same request.
 */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The server's own word for what went wrong: `detail` is the
 *  planner's (and this client's), `error` is Spring's where it sends
 *  one. A 401 carries no body at all (Spring Security's own entry
 *  point), and falls through to the status text. */
async function detailOf(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { detail?: string; error?: string };
  return body.detail ?? body.error ?? response.statusText ?? "request failed";
}

/**
 * Everything chart- and plan-related is served by the Python planner,
 * reached through the Spring Boot gateway rather than directly: one
 * origin means one session and one set of access rules, and the
 * planner itself publishes no port. The schema's `/api/…` paths are
 * served under `/api/planner/…` (PlannerProxyController), which this
 * middleware writes in, along with the CSRF header on anything that is
 * not a GET; a response that is not OK is thrown as an `ApiError`, so
 * every call either resolves with its data or rejects.
 */
const throughGateway: Middleware = {
  onRequest({ request }) {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/^\/api\//, "/api/planner/");
    const next = new Request(url, request);
    const token = request.method === "GET" ? null : csrfToken();
    if (token) next.headers.set("X-XSRF-TOKEN", token);
    return next;
  },
  async onResponse({ response }) {
    if (!response.ok) throw new ApiError(await detailOf(response), response.status);
  },
};

const planner = createClient<paths>({ baseUrl: "" });
planner.use(throughGateway);

/** The data of a call that resolved (the middleware above has already
 *  thrown for anything else), as the named shape from ./types -- the
 *  same schema, without openapi-fetch's widening of its tuples. */
const data = <T>(result: { data?: unknown }): T => result.data as T;

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

/** The Spring Boot endpoints: a plain fetch with the CSRF header on
 *  anything that changes state, and the same `ApiError` on failure. */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const token = method === "GET" ? null : csrfToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, ...(token ? { "X-XSRF-TOKEN": token } : {}) },
  });
  if (!res.ok) throw new ApiError(await detailOf(res), res.status);
  return res.status === 204 ? (undefined as T) : res.json().catch(() => undefined as T);
}

const jsonBody = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

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
  classB: () => planner.GET("/api/class-b").then(data<{ airports: ClassBAirport[] }>).then(r => r.airports),

  /** Which of the services the developer console links to are
   *  running, and whether starting one is possible here at all. */
  devServices: () => planner.GET("/api/dev/services").then(data<DevServices>),

  /** Start one, if it is not already up. Already running is a success:
   *  the console asks on every click so the link always works. */
  startDevService: (service: string) =>
    planner.POST("/api/dev/services/{service}/start", { params: { path: { service } } })
      .then(data<{ service: string; state: string; started: boolean }>),

  /** The stock performance profiles the nav log can be computed for. */
  aircraftProfiles: () => planner.GET("/api/aircraft-profiles").then(data<{ profiles: AircraftProfileSummary[] }>).then(r => r.profiles),

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
   * The signed-in pilot, or null when signed out -- a plain Spring
   * Boot endpoint, not proxied through the planner. A 401 here is the
   * normal signed-out case, not a failure, so this resolves to null
   * instead of throwing.
   */
  async me(): Promise<Pilot | null> {
    const res = await fetch("/api/me");
    if (res.status === 401) return null;
    if (!res.ok) throw new ApiError("could not check sign-in status", res.status);
    return res.json();
  },

  /**
   * What signing in can do here. Public, and asked before any session
   * exists: a deployment with no Google or Apple credentials and no
   * mail host cannot hold a role at all, which is what decides whether
   * the developer's switch is offered to a caller with no session.
   */
  capabilities: () => json<SignInCapabilities>("/api/auth/capabilities"),

  /** POSTs to Spring's own default logout endpoint, whose response is
   *  a redirect (a login page's HTML), not JSON -- the caller re-checks
   *  `me()` afterwards; session cookies are cleared either way. */
  async logout(): Promise<void> {
    const token = csrfToken();
    const res = await fetch("/logout", { method: "POST", headers: token ? { "X-XSRF-TOKEN": token } : {} });
    if (!res.ok) throw new ApiError("could not log out", res.status);
  },

  /**
   * Starts a magic-link sign-in -- always resolves (202) regardless of
   * whether the address has ever signed in before, the server's own
   * enumeration-safe answer. Throws only on a genuine failure (a
   * malformed address the server's own validation rejects with 400).
   */
  requestMagicLink: (email: string) => json<void>("/api/auth/magic-link", jsonBody({ email })),

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
    const token = csrfToken();
    const res = await fetch(`/api/comparison?${new URLSearchParams({ framework })}`, {
      ...jsonBody(request), signal,
      headers: { "Content-Type": "application/json", ...(token ? { "X-XSRF-TOKEN": token } : {}) },
    });
    if (!res.ok) throw new ApiError(await detailOf(res), res.status);
    yield* ndjson<NarrativeMessage>(res.body ?? undefined);
  },

  /** A signed-in pilot's own aeroplanes -- also a direct Spring Boot
   *  call, like `me()`: nothing here is planning-service's concern. */
  aircraft: {
    list: () => json<Aircraft[]>("/api/aircraft"),
    add: (request: AircraftRequest) => json<Aircraft>("/api/aircraft", jsonBody(request)),
    update: (id: number, request: AircraftRequest) =>
      json<Aircraft>(`/api/aircraft/${id}`, { ...jsonBody(request), method: "PUT" }),
    remove: (id: number) => json<void>(`/api/aircraft/${id}`, { method: "DELETE" }),
  },

  /** A signed-in pilot's own filed flights. */
  flights: {
    list: () => json<FlightSummary[]>("/api/flights"),
    get: (id: number) => json<Flight>(`/api/flights/${id}`),
    save: (request: SaveFlightRequest) => json<Flight>("/api/flights", jsonBody(request)),
    remove: (id: number) => json<void>(`/api/flights/${id}`, { method: "DELETE" }),
  },
};
