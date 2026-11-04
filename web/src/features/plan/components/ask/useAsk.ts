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
 */
import { create } from "zustand";
import { askAssistant, type AssistantContext, type AssistantMessage, type Source } from "../../../../lib/api/assistant";
import { describeError } from "../../../../lib/api/client";
import type { Currency } from "../../../../lib/api/types";
import { useBriefPlan } from "../../../../lib/briefPlan";
import { localDay } from "../../../../lib/clock";
import { useOwnShip } from "../../../../lib/map/ownShip";
import { usePreferences } from "../../../../lib/preferences";
import { currencyQuery, queryClient } from "../../../../lib/queryClient";
import { speak } from "../../../../lib/speech";

export interface AskTurn {
  id: number;
  question: string;
  /** The answer so far. */
  answer: string;
  /** What the assistant is doing right now ("The weather at KDLH"), while
   *  it is; null once words are coming. */
  status: string | null;
  sources: Source[];
  error: string | null;
  done: boolean;
  /** Asked by voice: read aloud once it is in. */
  spoken: boolean;
}

interface AskState {
  turns: AskTurn[];
  /** A question is in flight. */
  busy: boolean;
  /** The Ask section asked for from outside the Brief (the route's •••
   *  menu): counted up, and the field focuses itself once drawn. */
  wanted: number;
  /** The map's microphone is listening for a question for the card
   *  (AskCard's mic), not for a command of its own. */
  listeningFor: "ask" | null;
  ask: (question: string, options?: { speak?: boolean }) => Promise<void>;
  /** The question in flight given up; its answer stays as far as it got. */
  stop: () => void;
  /** The conversation forgotten: a new one starts. */
  clear: () => void;
  want: () => void;
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
  wanted: 0,
  listeningFor: null,
  want: () => set(s => ({ wanted: s.wanted + 1 })),
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
    set(s => ({ busy: true, turns: [...s.turns, { id, question, answer: "", status: "Asking…", sources: [], error: null, done: false, spoken }] }));
    // A spoken answer in place of whatever was being read.
    if (spoken) speak("");
    try {
      await askAssistant({ messages, context: contextNow() }, event => {
        if (event.type === "tool") patch({ status: event.label });
        else if (event.type === "text") set(s => ({ turns: s.turns.map(t => (t.id === id ? { ...t, status: null, answer: t.answer + event.text } : t)) }));
        else if (event.type === "sources") patch({ sources: event.sources });
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
