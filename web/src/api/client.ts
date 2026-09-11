import type {
  BuildJob, BuiltRoute, Checkpoints, Course, LoosePick, NavLog,
  PickSummary, Rating, Role, StreamMessage,
} from "./types";

/**
 * Every call the pages make. One place, so a change to a route or a
 * payload is a compile error at each call site rather than a silent 404
 * -- which is close to what happened when an endpoint was fixed while
 * the page went on calling a different one.
 */

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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

export const api = {
  /** The leg itself: sub-second, and enough to draw before any tile is read. */
  course: (dep: string, dest: string) =>
    json<Course>(`/api/course?dep=${dep}&dest=${dest}`),

  /** Scored candidates and the subset worth flying. Fast -- the model is
   *  loaded and the features are already built. */
  checkpoints: (dep: string, dest: string) =>
    json<Checkpoints>(`/api/checkpoints?dep=${dep}&dest=${dest}`),

  /** The slow half: terrain, the obstacle file, the airspace shapefile and
   *  live winds. Asked for separately so none of it delays the chart. */
  navlog: (dep: string, dest: string, altitudeFt?: string) => {
    const params = new URLSearchParams({ dep, dest });
    if (altitudeFt) params.set("altitude_ft", altitudeFt);
    return json<NavLog>(`/api/navlog?${params}`);
  },

  /** Corridors the feature store already covers. */
  routes: () => json<{ routes: BuiltRoute[] }>("/api/routes"),

  /** Start collecting a corridor: minutes of Overpass, FAA and elevation
   *  calls, so it returns a job id rather than holding the request open. */
  startBuild: (dep: string, dest: string) =>
    json<BuildJob>("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departure_ident: dep, destination_ident: dest }),
    }),

  buildStatus: (jobId: string) => json<BuildJob>(`/api/build/${jobId}`),

  /** What the chart draws at a point, so an added pick is categorised from
   *  the pixels rather than from whatever a dropdown was left on. */
  classify: (lat: number, lon: number) =>
    json<{ category: string | null }>(`/api/classify?lat=${lat}&lon=${lon}`),

  picks: (dep: string, dest: string) =>
    json<{ picks: LoosePick[]; summary: PickSummary }>(
      `/api/picks?dep=${dep}&dest=${dest}`,
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
    json<{ ok: boolean; pick: LoosePick; summary: PickSummary }>("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pick),
    }),

  deletePick: (dep: string, dest: string, lat: number, lon: number) =>
    json<{ ok: boolean; summary: PickSummary }>(
      `/api/picks?dep=${dep}&dest=${dest}&lat=${lat}&lon=${lon}`,
      { method: "DELETE" },
    ),

  /**
   * Detections, streamed a block at a time from the departure end, so the
   * map fills where the work starts while the rest is still being read.
   * Newline-delimited JSON: a chunk can split a line, so only whole lines
   * are parsed and the remainder carried forward.
   */
  async *detect(dep: string, dest: string): AsyncGenerator<StreamMessage> {
    const res = await fetch(`/api/detect/stream?dep=${dep}&dest=${dest}`);
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(body.detail ?? "detection failed", res.status);
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
        if (line.trim()) yield JSON.parse(line) as StreamMessage;
      }
    }
  },
};
