/**
 * The assistant a pilot asks about the flight, in text or by voice
 * (AskCard, RadioLayer's Ask chip): POST /api/planner/assistant through
 * the gateway, the answer streamed back as newline-delimited JSON. The
 * shapes here are written by hand, mirroring planning-service
 * app/assistant.py: `npm run types` has no schema for it yet, and the
 * planner's OpenAPI document gains it later (then these move to ./types).
 *
 * The client keeps the conversation: each answer's text goes back as the
 * next `assistant` message and the whole list is sent every time,
 * appended to and never edited (useAsk).
 */
import { ApiError, csrfHeaders, failIfNotOk, ndjson } from "./client";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/** What the pilot asked for, as the plan has it (lib/briefPlan). */
export interface AssistantPlan {
  dep: string;
  dest: string;
  stops: string[];
  aircraft: string | null;
  altitude_ft: number | null;
  /** ISO; null for about now. */
  depart: string | null;
}

/** Where the airplane is (lib/map/ownShip's fix), where the phone has one. */
export interface AssistantOwnShip {
  lat: number;
  lon: number;
  altitude_ft: number | null;
  track_deg: number | null;
  groundspeed_kt: number | null;
}

/** The pilot's own minimums (lib/minimums) and currency, in words
 *  (useAsk's currencyWords); null where the app knows neither. */
export interface AssistantPilot {
  personal_minimums: { ceiling_ft: number | null; visibility_sm: number | null; wind_kt: number | null; crosswind_kt: number | null } | null;
  currency: string[];
}

export interface AssistantContext extends AssistantPlan {
  own_ship: AssistantOwnShip | null;
  pilot: AssistantPilot | null;
}

export interface AssistantRequest {
  messages: AssistantMessage[];
  context: AssistantContext;
}

/** A report the answer rests on, as it was sent: shown raw, never
 *  reformatted (SourceChips). */
export interface Source {
  id: string;
  label: string;
  text: string;
}

/** A change to the plan the assistant proposes (the planner's
 *  propose_change): only the fields that change, the stops all of them
 *  as the route would then make them, idents upper-cased. The app shows
 *  it as a chip, and nothing is applied until the pilot taps it (useAsk's
 *  apply). */
export interface AssistantChange {
  dep?: string;
  dest?: string;
  stops?: string[];
  altitude_ft?: number;
  /** ISO 8601 UTC. */
  depart?: string;
}

/** One line of the stream: a tool the assistant is using, said as a
 *  passing status line; a piece of the answer; a change it proposes,
 *  after the words; the sources; the end; or what went wrong, in words
 *  for the pilot. */
export type AssistantEvent =
  | { type: "tool"; name: string; label: string }
  | { type: "text"; text: string }
  | { type: "action"; change: AssistantChange; words: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done" }
  | { type: "error"; words: string };

/**
 * Hands each event of a stream to `onEvent` as it comes, whole lines
 * only across the chunks (client's `ndjson`), and stops at the first
 * `done` or `error`: the planner sends nothing after either, and a line
 * after one would be a bug read as a second answer.
 */
export async function readAssistantStream(stream: ReadableStream | undefined, onEvent: (event: AssistantEvent) => void): Promise<void> {
  for await (const event of ndjson<AssistantEvent>(stream)) {
    onEvent(event);
    if (event.type === "done" || event.type === "error") return;
  }
}

/**
 * Asks, and streams the answer's events to `onEvent`; resolves once the
 * stream ends, rejects where the request itself failed (the connection,
 * a 5xx, a 401 -- a billed Claude call needs a session, and Spring's 401
 * carries no body to say so). `signal` gives it up: a new question, or
 * the pilot's Stop.
 */
export async function askAssistant(body: AssistantRequest, onEvent: (event: AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  // A plain fetch, not openapi-fetch: the schema has no such path yet
  // (above), and the planner's client would refuse one it does not know.
  // The gateway's prefix is written in as GatewayRequest writes it.
  const res = await fetch("/api/planner/assistant", {
    method: "POST", signal, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...csrfHeaders("POST") },
  });
  if (res.status === 401) throw new ApiError("Sign in to ask about the flight", 401);
  await failIfNotOk(res);
  await readAssistantStream(res.body ?? undefined, onEvent);
}
