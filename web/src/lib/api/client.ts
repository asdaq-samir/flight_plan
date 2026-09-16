import type {
  Aircraft, AircraftRequest, AltitudeBreakdown, Briefing, BriefingNarrativeRequest, BuildJob, BuiltRoute,
  CheckpointDescriptionMessage, Checkpoints, Course, Flight, FlightSummary, LoosePick, ModelComparison,
  NavLogMessage, PickSummary, Pilot, PlaygroundScore, Rating, Role, SaveFlightRequest, StreamMessage,
} from "./types";

/**
 * Every call the pages make. One place, so a change to a route or a
 * payload is a compile error at each call site rather than a silent 404
 * -- which is close to what happened when an endpoint was fixed while
 * the page went on calling a different one.
 */

/**
 * Everything chart- and plan-related is served by the Python planner,
 * reached through the Spring Boot gateway rather than directly. One
 * origin means one session and one set of access rules; the planner
 * itself publishes no port.
 */
const PLANNER = "/api/planner";

/**
 * The CSRF token, which the server sets as a readable cookie and expects
 * echoed back on anything that changes state. Session cookies are
 * attached by the browser on their own, which is the condition CSRF
 * exploits, so this is what distinguishes our own form post from someone
 * else's page making the same request.
 */
function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match?.[1] ? { "X-XSRF-TOKEN": decodeURIComponent(match[1]) } : {};
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(url, {
    ...init,
    headers: method === "GET" ? init?.headers : { ...init?.headers, ...csrfHeader() },
  });
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  if (!res.ok) throw new ApiError(body.detail ?? "request failed", res.status);
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Newline-delimited JSON, one line at a time as the bytes arrive --
 * `detect`, `describeCheckpoints` and `navlog` all stream this same
 * shape (a fetch + reader + decoder + buffer, since a chunk can split
 * a line and only whole lines are ever parsed), written once here
 * instead of three copies that could drift line-splitting behavior
 * apart from each other.
 */
async function* streamNdjson<T>(
  url: string, signal: AbortSignal | undefined, failureMessage: string,
): AsyncGenerator<T> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(body.detail ?? failureMessage, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as T;
    }
  }
}

export const api = {
  /** The leg itself: sub-second, and enough to draw before any tile is read. */
  course: (dep: string, dest: string) =>
    json<Course>(`${PLANNER}/course?dep=${dep}&dest=${dest}`),

  /** Scored candidates and the subset worth flying. Fast -- the model is
   *  loaded and the features are already built. */
  checkpoints: (dep: string, dest: string) =>
    json<Checkpoints>(`${PLANNER}/checkpoints?dep=${dep}&dest=${dest}`),

  /**
   * The slow half: terrain, the obstacle file, the airspace shapefile
   * and live winds. Asked for separately so none of it delays the
   * chart, and streamed rather than one blocking response so a pilot
   * sees which of those it's actually doing right now.
   */
  navlog(dep: string, dest: string, altitudeFt?: string): AsyncGenerator<NavLogMessage> {
    const params = new URLSearchParams({ dep, dest });
    if (altitudeFt) params.set("altitude_ft", altitudeFt);
    return streamNdjson<NavLogMessage>(`${PLANNER}/navlog?${params}`, undefined, "building the nav log failed");
  },

  /** Adverse conditions, current/forecast weather, and airport info
   *  for the Flight Briefing page -- one plain response, not a stream:
   *  every piece is a single quick call, not navlog's slow per-leg
   *  loop. */
  briefing: (dep: string, dest: string) =>
    json<Briefing>(`${PLANNER}/briefing?dep=${dep}&dest=${dest}`),

  /** The Flight Briefing page's own spoken/read narrative -- a single
   *  Claude call turning data the page already has into a short
   *  paragraph, not a second fetch. Pilot-triggered, not automatic:
   *  every call is a real, billed request. */
  briefingNarrative: (payload: BriefingNarrativeRequest) =>
    json<{ narrative: string }>(`${PLANNER}/briefing/narrative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  /** Corridors the feature store already covers. */
  routes: () => json<{ routes: BuiltRoute[] }>(`${PLANNER}/routes`),

  /** Start collecting a corridor: minutes of Overpass, FAA and elevation
   *  calls, so it returns a job id rather than holding the request open. */
  startBuild: (dep: string, dest: string) =>
    json<BuildJob>(`${PLANNER}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departure_ident: dep, destination_ident: dest }),
    }),

  buildStatus: (jobId: string) => json<BuildJob>(`${PLANNER}/build/${jobId}`),

  /** What the chart draws at a point, so an added pick is categorised from
   *  the pixels rather than from whatever a dropdown was left on. */
  classify: (lat: number, lon: number) =>
    json<{ category: string | null }>(`${PLANNER}/classify?lat=${lat}&lon=${lon}`),

  picks: (dep: string, dest: string) =>
    json<{ picks: LoosePick[]; summary: PickSummary }>(
      `${PLANNER}/picks?dep=${dep}&dest=${dest}`,
    ),

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
  }) =>
    json<{ ok: boolean; pick: LoosePick; summary: PickSummary }>(`${PLANNER}/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pick),
    }),

  deletePick: (dep: string, dest: string, lat: number, lon: number) =>
    json<{ ok: boolean; summary: PickSummary }>(
      `${PLANNER}/picks?dep=${dep}&dest=${dest}&lat=${lat}&lon=${lon}`,
      { method: "DELETE" },
    ),

  /**
   * Detections, streamed a block at a time from the departure end, so
   * the map fills where the work starts while the rest is still being
   * read.
   */
  detect(dep: string, dest: string): AsyncGenerator<StreamMessage> {
    return streamNdjson<StreamMessage>(`${PLANNER}/detect/stream?dep=${dep}&dest=${dest}`, undefined, "detection failed");
  },

  /**
   * One "how to spot it" line per checkpoint, in route order -- the
   * same streaming shape as `detect`, so a slow LLM call on one
   * checkpoint doesn't hold up the ones that already arrived.
   */
  describeCheckpoints(
    dep: string, dest: string, altitudeFt?: string, signal?: AbortSignal,
  ): AsyncGenerator<CheckpointDescriptionMessage> {
    const params = new URLSearchParams({ dep, dest });
    if (altitudeFt) params.set("altitude_ft", altitudeFt);
    return streamNdjson<CheckpointDescriptionMessage>(
      `${PLANNER}/checkpoint-notes?${params}`, signal, "describing checkpoints failed",
    );
  },

  /** A pilot's own edit to one checkpoint's identification note. */
  saveCheckpointNote: (dep: string, dest: string, lat: number, lon: number, description: string) =>
    json<{ ok: boolean; note: { description: string } }>(`${PLANNER}/checkpoint-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        departure_ident: dep, destination_ident: dest, lat, lon, description,
      }),
    }),

  /**
   * The signed-in pilot, or null when signed out -- a plain Spring
   * Boot endpoint, not proxied through the planner (there's nothing
   * for planning-service to do with "who is this"). A 401 here is
   * the normal signed-out case, not a failure, so this resolves to
   * null instead of throwing.
   */
  async me(): Promise<Pilot | null> {
    const res = await fetch("/api/me");
    if (res.status === 401) return null;
    if (!res.ok) throw new ApiError("could not check sign-in status", res.status);
    return res.json();
  },

  /** POSTs to Spring's own default logout endpoint. The Playground
   *  re-checks `me()` afterward rather than trusting this call's own
   *  response shape, which is a redirect (a login page's HTML), not
   *  JSON -- session cookies are cleared either way. */
  logout: () => fetch("/logout", { method: "POST", headers: csrfHeader() }),

  /** How the currently promoted model was actually chosen -- every
   *  algorithm retrain() tried, not just the winner. */
  modelComparison: () => json<ModelComparison>(`${PLANNER}/model-comparison`),

  /** The full reasoning behind one recommended cruise altitude, for
   *  any route -- independent of whatever the Plan page has open. */
  altitudeBreakdown: (dep: string, dest: string, aircraft?: string) => {
    const params = new URLSearchParams({ dep, dest });
    if (aircraft) params.set("aircraft", aircraft);
    return json<AltitudeBreakdown>(`${PLANNER}/altitude-breakdown?${params}`);
  },

  /** Scored checkpoints from one specific algorithm -- current
   *  (whatever's promoted) / pytorch / tensorflow / spark. */
  playgroundScore: (dep: string, dest: string, model: string) =>
    json<PlaygroundScore>(`${PLANNER}/playground/score?${new URLSearchParams({ dep, dest, model })}`),

  /** A signed-in pilot's own aeroplanes -- also a direct Spring Boot
   *  call, like `me()`: nothing here is planning-service's concern. */
  aircraft: {
    list: () => json<Aircraft[]>("/api/aircraft"),
    add: (request: AircraftRequest) =>
      json<Aircraft>("/api/aircraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    update: (id: number, request: AircraftRequest) =>
      json<Aircraft>(`/api/aircraft/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    remove: (id: number) => json<void>(`/api/aircraft/${id}`, { method: "DELETE" }),
  },

  /** A signed-in pilot's own filed flights. */
  flights: {
    list: () => json<FlightSummary[]>("/api/flights"),
    get: (id: number) => json<Flight>(`/api/flights/${id}`),
    save: (request: SaveFlightRequest) =>
      json<Flight>("/api/flights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    remove: (id: number) => json<void>(`/api/flights/${id}`, { method: "DELETE" }),
  },
};
