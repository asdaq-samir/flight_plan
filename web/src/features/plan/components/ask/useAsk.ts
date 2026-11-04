/**
 * The conversation with the assistant about the flight on screen, kept
 * while the page is: each question with its answer as it streams in
 * (lib/api/assistant), the tool it is using said as a passing status
 * line, the reports it rests on, and what went wrong, said in the card
 * itself (lib/problems' rule: an error where it happens, never a toast).
 * One store, so the Brief's Ask card (AskCard), the route's ••• menu and
 * the map's microphone (RadioLayer's Ask chip) share it.
 *
 * The context goes with every question, read as it is asked: the plan
 * as the Brief has it (lib/briefPlan), where the airplane is
 * (lib/map/ownShip) and what the app knows of the pilot -- their
 * personal minimums (lib/minimums) and currency (the logbook's
 * CurrencyDto), null where it knows neither. The conversation is
 * append-only: an answer goes back as the next assistant message, and
 * no earlier turn is ever edited.
 *
 * A change to the plan the assistant proposes ("add a fuel stop at
 * Rhinelander") comes as an `action` event and is kept on its turn as a
 * chip's words (actionLabel); the assistant never makes it. The pilot's
 * tap on the chip applies it (`apply`) through the setters the route box
 * uses, which the planning workspace registers as `applyChange` while
 * it is up -- the address changes, and the plan is made again.
 */
import { create } from "zustand";
import { askAssistant, type AssistantChange, type AssistantContext, type AssistantMessage, type Source } from "../../../../lib/api/assistant";
import { describeError } from "../../../../lib/api/client";
import type { Currency } from "../../../../lib/api/types";
import { useBriefPlan } from "../../../../lib/briefPlan";
import { clockTime, localDay } from "../../../../lib/clock";
import { useOwnShip } from "../../../../lib/map/ownShip";
import { usePreferences } from "../../../../lib/preferences";
import { currencyQuery, queryClient } from "../../../../lib/queryClient";
import { speak } from "../../../../lib/speech";
import { feet } from "../../../../lib/units";

/** A change the assistant proposed, as its chip shows it: the words on
 *  the chip (actionLabel), the word once applied (doneLabel), and whether
 *  the pilot has tapped it. */
export interface AskAction {
  change: AssistantChange;
  /** The assistant's one sentence on what it would do. */
  words: string;
  label: string;
  done: string;
  applied: boolean;
}

export interface AskTurn {
  id: number;
  question: string;
  /** The answer so far. */
  answer: string;
  /** What the assistant is doing right now ("The weather at KDLH"), while
   *  it is; null once words are coming. */
  status: string | null;
  sources: Source[];
  /** The changes to the plan it proposed, each a chip to tap. */
  actions: AskAction[];
  error: string | null;
  done: boolean;
  /** Asked by voice: read aloud once it is in. */
  spoken: boolean;
}

interface AskState {
  turns: AskTurn[];
  /** A question is in flight. */
  busy: boolean;
  /** What applies a proposed change to the plan: the planning workspace's
   *  route, altitude and departure setters, registered while it is up
   *  (PlanWorkspace); null where there is no plan to change. */
  applyChange: ((change: AssistantChange) => void) | null;
  /** The pilot's tap on a chip: the change applied, the chip marked done.
   *  Nothing is applied without it. */
  apply: (change: AssistantChange) => void;
  /** The map's microphone is listening for a question for the card
   *  (AskCard's mic), not for a command of its own. */
  listeningFor: "ask" | null;
  ask: (question: string, options?: { speak?: boolean }) => Promise<void>;
  /** The question in flight given up; its answer stays as far as it got. */
  stop: () => void;
  /** The conversation forgotten: a new one starts. */
  clear: () => void;
}

let inFlight: AbortController | null = null;
let nextId = 1;

/**
 * The pilot's currency in a line each, as the assistant is told it, from
 * the dates the logbook works out (CurrencyDto): passengers by day and by
 * night (14 CFR 61.57(a) and (b)), the flight review (61.56), instrument
 * currency (61.57(c) and (d)) and the medical (61.23). Only what is
 * logged: a date the logbook has none for says nothing, rather than
 * "not current".
 */
export function currencyWords(c: Currency, today: string): string[] {
  const current = (until: string | null) => until !== null && until >= today;
  const out: string[] = [];
  if (c.dayPassengersUntil !== null) out.push(current(c.dayPassengersUntil) ? `Day passengers current through ${c.dayPassengersUntil}` : "Day passengers not current");
  if (c.nightPassengersUntil !== null) out.push(current(c.nightPassengersUntil) ? `Night passengers current through ${c.nightPassengersUntil}` : "Night passengers not current");
  if (c.flightReviewUntil !== null) out.push(current(c.flightReviewUntil) ? `Flight review current through ${c.flightReviewUntil}` : "Flight review lapsed");
  if (c.instrumentCurrentUntil !== null) out.push(current(c.instrumentCurrentUntil) ? `Instrument current through ${c.instrumentCurrentUntil}` : "Instrument currency lapsed");
  if (c.medicalExpiresOn !== null) out.push(current(c.medicalExpiresOn) ? `Medical good through ${c.medicalExpiresOn}` : "Medical expired");
  return out;
}

/** The route as the chip's words compare a change against it: the plan
 *  on screen (lib/briefPlan) as the change arrived. */
export interface RouteNow {
  dep: string;
  dest: string;
  stops: string[];
}

/**
 * A change with something in it, each field in the shape the app
 * applies: the planner sends none without, and one that is malformed is
 * dropped rather than shown as a chip that would do nothing.
 */
export function isChange(c: AssistantChange | null | undefined): c is AssistantChange {
  if (!c) return false;
  const fields = [
    c.dep === undefined ? null : typeof c.dep === "string" && c.dep !== "",
    c.dest === undefined ? null : typeof c.dest === "string" && c.dest !== "",
    c.stops === undefined ? null : Array.isArray(c.stops) && c.stops.every(s => typeof s === "string" && s !== ""),
    c.altitude_ft === undefined ? null : Number.isFinite(c.altitude_ft),
    c.depart === undefined ? null : typeof c.depart === "string" && !Number.isNaN(Date.parse(c.depart)),
  ];
  return fields.some(f => f !== null) && fields.every(f => f !== false);
}

const upper = (idents: string[]) => idents.map(s => s.toUpperCase());

/** The stops a change puts in over the plan's, and takes out of it. */
function stopsChanged(stops: string[], now: RouteNow): { added: string[]; removed: string[] } {
  const was = upper(now.stops), will = upper(stops);
  return { added: will.filter(s => !was.includes(s)), removed: was.filter(s => !will.includes(s)) };
}

/**
 * What a proposed change says on its chip, from its fields: "Add stop
 * KRHI" (the stops it puts in over the plan's, or takes out), "KDLH →
 * KMSN" for a different end, "Plan at 6,500 ft", "Leave at 15:10" (this
 * device's clock); more than one, in that order with a dot between.
 */
export function actionLabel(change: AssistantChange, now: RouteNow): string {
  const parts: string[] = [];
  if (change.dep !== undefined || change.dest !== undefined) {
    const dep = change.dep ?? now.dep, dest = change.dest ?? now.dest;
    parts.push(dep && dest ? [dep, ...(change.stops ?? []), dest].join(" → ") : dep ? `From ${dep}` : `To ${dest}`);
  } else if (change.stops !== undefined) {
    const { added, removed } = stopsChanged(change.stops, now);
    if (added.length && !removed.length) parts.push(`Add ${added.length > 1 ? "stops" : "stop"} ${added.join(", ")}`);
    else if (removed.length && !added.length) parts.push(`Remove ${removed.length > 1 ? "stops" : "stop"} ${removed.join(", ")}`);
    else parts.push(change.stops.length ? `Stops ${change.stops.join(", ")}` : "No stops");
  }
  if (change.altitude_ft !== undefined) parts.push(`Plan at ${feet(change.altitude_ft)}`);
  if (change.depart !== undefined) parts.push(`Leave at ${clockTime(new Date(change.depart))}`);
  return parts.join(" · ");
}

/** The chip's word once the change is applied: "Added" for a stop put
 *  in, "Removed" for one taken out, "Set" for the time alone, "Planned"
 *  for the rest. */
export function doneLabel(change: AssistantChange, now: RouteNow): string {
  const routeKept = change.dep === undefined && change.dest === undefined;
  if (routeKept && change.stops !== undefined) {
    const { added, removed } = stopsChanged(change.stops, now);
    if (added.length && !removed.length) return "Added";
    if (removed.length && !added.length) return "Removed";
  }
  if (routeKept && change.stops === undefined && change.altitude_ft === undefined) return "Set";
  return "Planned";
}

/** The context as it stands the moment a question is asked. */
export function contextNow(): AssistantContext {
  const plan = useBriefPlan.getState();
  const fix = useOwnShip.getState().fix;
  const m = usePreferences.getState().minimums;
  const minimums = m.ceilingFt != null || m.visibilitySm != null || m.windKt != null || m.crosswindKt != null
    ? { ceiling_ft: m.ceilingFt, visibility_sm: m.visibilitySm, wind_kt: m.windKt, crosswind_kt: m.crosswindKt } : null;
  // The logbook's currency as the console last fetched it, where the
  // pilot keeps one here; not fetched for the question's sake.
  const currency = queryClient.getQueryData<Currency>(currencyQuery.queryKey) ?? null;
  const lines = currency ? currencyWords(currency, localDay()) : [];
  return {
    dep: plan.dep, dest: plan.dest, stops: plan.stops, aircraft: plan.aircraft, altitude_ft: plan.altitudeFt, depart: plan.depart || null,
    own_ship: fix ? { lat: fix.lat, lon: fix.lon, altitude_ft: fix.altitudeFt, track_deg: fix.headingDeg, groundspeed_kt: fix.speedKt } : null,
    pilot: minimums || lines.length ? { personal_minimums: minimums, currency: lines } : null,
  };
}

/** The conversation as it is sent: every finished turn's question and
 *  answer, then the one asked now. A turn that failed or was stopped
 *  short is left out, so the assistant is not told it said something it
 *  did not. */
function messagesOf(turns: AskTurn[], question: string): AssistantMessage[] {
  const out: AssistantMessage[] = [];
  for (const t of turns) {
    if (!t.done || t.error || !t.answer) continue;
    out.push({ role: "user", content: t.question }, { role: "assistant", content: t.answer });
  }
  out.push({ role: "user", content: question });
  return out;
}

export const useAsk = create<AskState>((set, get) => ({
  turns: [],
  busy: false,
  listeningFor: null,
  applyChange: null,
  apply: change => {
    const applyChange = get().applyChange;
    if (!applyChange) return;
    applyChange(change);
    set(s => ({ turns: s.turns.map(t => ({ ...t, actions: t.actions.map(a => (a.change === change ? { ...a, applied: true } : a)) })) }));
  },
  // Aborted, and left to `ask`'s own tail to settle: it clears `busy`
  // once it sees its controller is still the one in flight.
  stop: () => inFlight?.abort(),
  clear: () => {
    get().stop();
    set({ turns: [], busy: false });
  },
  ask: async (asked, options = {}) => {
    const question = asked.trim();
    if (!question) return;
    // One question at a time: a new one gives the last up.
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const id = nextId++;
    const spoken = !!options.speak;
    const patch = (change: Partial<AskTurn>) => set(s => ({ turns: s.turns.map(t => (t.id === id ? { ...t, ...change } : t)) }));
    const messages = messagesOf(get().turns, question);
    set(s => ({ busy: true, turns: [...s.turns, { id, question, answer: "", status: "Asking…", sources: [], actions: [], error: null, done: false, spoken }] }));
    // A spoken answer in place of whatever was being read.
    if (spoken) speak("");
    try {
      await askAssistant({ messages, context: contextNow() }, event => {
        if (event.type === "tool") patch({ status: event.label });
        else if (event.type === "text") set(s => ({ turns: s.turns.map(t => (t.id === id ? { ...t, status: null, answer: t.answer + event.text } : t)) }));
        else if (event.type === "action") {
          // Its words worked out against the plan as it is now, and kept:
          // "Add stop KRHI" stays so once the stop is in.
          if (!isChange(event.change)) return;
          const now = useBriefPlan.getState();
          const action: AskAction = { change: event.change, words: event.words, label: actionLabel(event.change, now), done: doneLabel(event.change, now), applied: false };
          set(s => ({ turns: s.turns.map(t => (t.id === id ? { ...t, actions: [...t.actions, action] } : t)) }));
        } else if (event.type === "sources") patch({ sources: event.sources });
        else if (event.type === "error") patch({ status: null, error: event.words, done: true });
        else patch({ status: null, done: true });
      }, controller.signal);
    } catch (err) {
      // Given up by the pilot or by a newer question: no error to say.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        patch({ status: null, error: describeError(err, "The assistant cannot be reached"), done: true });
      }
    }
    if (inFlight === controller) {
      inFlight = null;
      set({ busy: false });
    }
    const turn = get().turns.find(t => t.id === id);
    if (turn) {
      if (!turn.done) patch({ status: null, done: true });
      if (spoken && turn.answer && !controller.signal.aborted) speak(turn.answer);
    }
  },
}));
