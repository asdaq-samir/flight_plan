/**
 * Flash-card drills (the roadmap's light-gun and 91.155 drills): what a
 * student is asked on the oral and has to know cold, as cards to go
 * through until it is -- the tower's light signals (14 CFR 91.125) and
 * the basic VFR weather minimums (91.155), each worded as the regulation
 * words it.
 *
 * Spaced repetition by Leitner's boxes: a card known moves up a box and
 * comes back later (the same session, then a day, three, a week, a
 * fortnight); a card missed goes back to the first box and comes round
 * again before the session ends. Kept in this browser: a student's own
 * progress, nobody else's to read.
 */

export type Light = "green" | "red" | "white";

export interface Card {
  id: string;
  prompt: string;
  answer: string;
  /** What else the regulation says about it, where it says more. */
  detail?: string;
  /** The light shown, for the light-gun cards: its colours in turn, and
   *  whether it flashes. */
  light?: { colors: Light[]; flashing: boolean };
}

export interface Deck {
  key: DeckKey;
  title: string;
  /** Where the words come from, and where to read them. */
  source: string;
  url: string;
  cards: Card[];
}

export type DeckKey = "light-gun" | "vfr-minimums";

const SIGNALS: { id: string; name: string; colors: Light[]; flashing: boolean; surface: string; flight: string; flightDetail?: string }[] = [
  { id: "steady-green", name: "Steady green", colors: ["green"], flashing: false, surface: "Cleared for takeoff", flight: "Cleared to land" },
  { id: "flashing-green", name: "Flashing green", colors: ["green"], flashing: true, surface: "Cleared to taxi", flight: "Return for landing", flightDetail: "To be followed by steady green at the proper time." },
  { id: "steady-red", name: "Steady red", colors: ["red"], flashing: false, surface: "Stop", flight: "Give way to other aircraft and continue circling" },
  { id: "flashing-red", name: "Flashing red", colors: ["red"], flashing: true, surface: "Taxi clear of the runway in use", flight: "Airport unsafe: do not land" },
  { id: "flashing-white", name: "Flashing white", colors: ["white"], flashing: true, surface: "Return to starting point on airport", flight: "Not applicable", flightDetail: "Flashing white means nothing to an aircraft in flight." },
  { id: "alternating", name: "Alternating red and green", colors: ["red", "green"], flashing: true, surface: "Exercise extreme caution", flight: "Exercise extreme caution" },
];

const LIGHT_GUN: Deck = {
  key: "light-gun",
  title: "Light gun signals",
  source: "14 CFR 91.125",
  url: "https://www.ecfr.gov/current/title-14/part-91/section-91.125",
  cards: SIGNALS.flatMap(s => [
    { id: `${s.id}-surface`, prompt: `${s.name}, on the ground`, answer: s.surface, light: { colors: s.colors, flashing: s.flashing } },
    { id: `${s.id}-flight`, prompt: `${s.name}, in flight`, answer: s.flight, detail: s.flightDetail, light: { colors: s.colors, flashing: s.flashing } },
  ]),
};

const STANDARD = "3 sm; 500 ft below, 1,000 ft above, 2,000 ft horizontal";
const HIGH = "5 sm; 1,000 ft below, 1,000 ft above, 1 sm horizontal";

const VFR_MINIMUMS: Deck = {
  key: "vfr-minimums",
  title: "VFR weather minimums",
  source: "14 CFR 91.155",
  url: "https://www.ecfr.gov/current/title-14/part-91/section-91.155",
  cards: [
    { id: "a", prompt: "Class A", answer: "Not applicable", detail: "Class A is flown under IFR (91.135)." },
    { id: "b", prompt: "Class B", answer: "3 sm; clear of clouds" },
    { id: "c", prompt: "Class C", answer: STANDARD },
    { id: "d", prompt: "Class D", answer: STANDARD },
    { id: "e-low", prompt: "Class E, below 10,000 ft MSL", answer: STANDARD },
    { id: "e-high", prompt: "Class E, at or above 10,000 ft MSL", answer: HIGH },
    { id: "g-low-day", prompt: "Class G, 1,200 ft or less above the surface, by day", answer: "1 sm; clear of clouds" },
    {
      id: "g-low-night", prompt: "Class G, 1,200 ft or less above the surface, at night", answer: STANDARD,
      detail: "Under 3 sm but not under 1 sm at night, an airplane in the traffic pattern within 1/2 mile of the runway may fly clear of clouds (91.155(b)(2)).",
    },
    { id: "g-mid-day", prompt: "Class G, more than 1,200 ft above the surface but below 10,000 ft MSL, by day", answer: "1 sm; 500 ft below, 1,000 ft above, 2,000 ft horizontal" },
    { id: "g-mid-night", prompt: "Class G, more than 1,200 ft above the surface but below 10,000 ft MSL, at night", answer: STANDARD },
    { id: "g-high", prompt: "Class G, more than 1,200 ft above the surface and at or above 10,000 ft MSL", answer: HIGH },
  ],
};

export const DECKS: Record<DeckKey, Deck> = { "light-gun": LIGHT_GUN, "vfr-minimums": VFR_MINIMUMS };

/** Days until a card in each box comes round again: the first box the
 *  same session. */
export const INTERVAL_DAYS = [0, 1, 3, 7, 16] as const;
const DAY = 86_400_000;

/** Where each card of a deck stands: its box (1 to 5) and when it is due. */
export type Progress = Record<string, { box: number; due: number }>;

/** A card answered: known, up a box and away for its interval; missed,
 *  back to the first box and due now. */
export function answered(progress: Progress, cardId: string, knew: boolean, now: number): Progress {
  const box = knew ? Math.min(INTERVAL_DAYS.length, (progress[cardId]?.box ?? 1) + 1) : 1;
  return { ...progress, [cardId]: { box, due: now + INTERVAL_DAYS[box - 1]! * DAY } };
}

/** The deck's cards due now -- never seen, or past their day -- the
 *  lowest box first, in the deck's order within a box. */
export function dueCards(deck: Deck, progress: Progress, now: number): Card[] {
  const at = (c: Card) => progress[c.id] ?? { box: 0, due: 0 };
  return deck.cards.filter(c => at(c).due <= now).sort((a, b) => at(a).box - at(b).box);
}

/** When the next card comes due, or null where none is waiting. */
export function nextDue(deck: Deck, progress: Progress, now: number): number | null {
  const later = deck.cards.map(c => progress[c.id]?.due ?? 0).filter(due => due > now);
  return later.length ? Math.min(...later) : null;
}

const KEY = (deck: DeckKey) => `wingtip.drill.${deck}`;

/** A deck's progress as kept in this browser; none where storage cannot
 *  be had. */
export function keptProgress(deck: DeckKey): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY(deck)) ?? "{}") as Progress;
  } catch {
    return {};
  }
}

export function keepProgress(deck: DeckKey, progress: Progress): void {
  try {
    localStorage.setItem(KEY(deck), JSON.stringify(progress));
  } catch {
    // A private window: the session still runs, and starts afresh next time.
  }
}
