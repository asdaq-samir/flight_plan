/**
 * The Brief's and the debrief's plain-language readings, each with the
 * reports it rests on (WordsSection), and the flight watch on the
 * gateway (FlightWatch). The shapes are written by hand, mirroring
 * planning-service app/words.py for the words and the webapp's
 * FlightWatchController for the watch: `npm run types` has no schema for
 * either yet, and they move to ./types once the documents carry them.
 */
import { ApiError, csrfHeaders, failIfNotOk } from "./client";
import type { Source } from "./assistant";

export type { Source };

/** One sentence of a reading, with the sources it rests on by id. */
export interface WordsSentence {
  text: string;
  sources: string[];
}

export interface WordsAnswer {
  sentences: WordsSentence[];
  sources: Source[];
  /** The model that wrote them ("claude-haiku-5-5"); null with `unavailable`. */
  model: string | null;
  /** Why there are no words -- the model could not be reached -- said in
   *  the section's own small text, never a toast; null where there are. */
  unavailable: string | null;
}

export interface DebriefWordsAnswer extends WordsAnswer {
  /** A line for the pilot's instructor, where the reading has one. */
  instructor_note: string | null;
}

/** The route and its time, as /api/briefing is asked (usePlan). */
export interface WordsRoute {
  dep: string;
  dest: string;
  stops: string[];
  /** ISO; null for about now. */
  depart: string | null;
}

/** The weather's, with the flight's time en route and its legs, the
 *  same as the briefing is asked with once the nav log has them
 *  (briefingLegs): null until it does. */
export interface WeatherWordsRequest extends WordsRoute {
  ete_min: number | null;
  fixes: string | null;
  /** Each leg's minutes, comma-joined, as briefingLegs writes them. */
  leg_min: string | null;
}

export interface RiskWordsRequest {
  /** The Go / No-Go as the Brief has it (lib/verdict): its line and each
   *  finding. */
  verdict: { finding: string; words: string; items: { key: string; label: string; finding: string; detail: string }[] };
  pilot: { personal_minimums: Record<string, number | null> | null; currency: string[] } | null;
}

/** A POST to the planner through the gateway, its JSON back; the
 *  gateway's prefix written in as GatewayRequest writes it. A plain
 *  fetch, as ./assistant's: the schema has no such path yet. */
async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST", signal, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
  });
  // A billed Claude call needs a session, and Spring's 401 carries no body.
  if (res.status === 401) throw new ApiError("Sign in for the words", 401);
  await failIfNotOk(res);
  return res.json() as Promise<T>;
}

export const words = {
  /** The NOTAMs that bear on the flight, in words. */
  notams: (route: WordsRoute, signal?: AbortSignal) => postJson<WordsAnswer>("/api/planner/words/notams", route, signal),
  /** The weather along the route and at its fields, in words. */
  weather: (request: WeatherWordsRequest, signal?: AbortSignal) => postJson<WordsAnswer>("/api/planner/words/weather", request, signal),
  /** The Go / No-Go read against the pilot's own minimums and currency. */
  risk: (request: RiskWordsRequest, signal?: AbortSignal) => postJson<WordsAnswer>("/api/planner/words/risk", request, signal),
  /** What a flown flight says to practise next (lib/debrief's answer). */
  debrief: (debrief: unknown, signal?: AbortSignal) => postJson<DebriefWordsAnswer>("/api/planner/words/debrief", { debrief }, signal),
};

/** A watch on a saved flight: the gateway checks its weather and NOTAMs
 *  again until it leaves, and says what changed. */
export interface FlightWatch {
  flightId: number;
  /** ISO. */
  departAt: string;
  checkedAt: string;
  changedAt: string | null;
  changes: WordsSentence[];
  sources: Source[];
}

export const flightWatch = {
  /** Started, or its departure moved: the same POST either way. */
  start: async (flightId: number, departAt: string): Promise<FlightWatch> => {
    const res = await fetch(`/api/flights/${flightId}/watch`, {
      method: "POST", body: JSON.stringify({ departAt }),
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
    });
    await failIfNotOk(res);
    return res.json() as Promise<FlightWatch>;
  },
  /** The watch as it stands, or null where there is none (a 404). */
  get: async (flightId: number, signal?: AbortSignal): Promise<FlightWatch | null> => {
    const res = await fetch(`/api/flights/${flightId}/watch`, { signal });
    if (res.status === 404) return null;
    await failIfNotOk(res);
    return res.json() as Promise<FlightWatch>;
  },
  stop: async (flightId: number): Promise<void> => {
    const res = await fetch(`/api/flights/${flightId}/watch`, { method: "DELETE", headers: csrfHeaders("DELETE") });
    await failIfNotOk(res);
  },
};
