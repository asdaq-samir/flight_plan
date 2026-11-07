/**
 * A flight risk assessment before each flight (the roadmap's FRAT,
 * after the FAA Risk Management Handbook's PAVE and IMSAFE, FAA-H-8083-2):
 * points for what raises the risk of this flight -- from the briefing
 * (VFR not recommended, the pilot's own minimums, a TFR on the route,
 * SIGMETs and G-AIRMETs, night), from the nav log's fuel check, from the
 * pilot's own airplane's inspections (lib/airworthiness), from the
 * pilot's logbook (the flight review, the medical, recent landings) --
 * and for what only the pilot knows: IMSAFE, and the pressures on the
 * day.
 *
 * The points and where they turn the assessment amber and red are the
 * planner's own guide, not the FAA's and not a rule: the decision is
 * the pilot in command's (91.3, 91.103). What makes a flight unlawful --
 * alcohol within 8 hours, a lapsed flight review or medical, tanks that
 * do not hold the fuel, an annual past due -- is high whatever else is.
 *
 * The rules, their points and their sources are the shared engine's
 * (native/crates/brief/src/gonogo/frat.rs, through lib/engine), the planner's
 * and the phones' own; SELF_CHECKS, the levels and their words stay here
 * as the page's labels, held to the engine's by gonogoEngine.test.ts.
 */
import { create } from "zustand";
import type { Currency, Inspections, Squawk } from "./api/types";
import { inspectionsInput, riskFactor, squawksInput } from "./airworthiness";
import { callEngine, type EngineAnswer } from "./engine/engine";

export type RiskLevel = EngineAnswer<"gonogo_risk">["level"];

export interface RiskFactor {
  key: string;
  label: string;
  /** Why it counts: the rule or the reason. */
  why?: string;
  points: number;
  /** A factor that makes the flight unlawful as planned: high, whatever
   *  the points. */
  stop?: boolean;
}

/** What only the pilot can say, ticked where it is so: the IMSAFE
 *  checklist and PAVE's pressures and unfamiliarity. */
export const SELF_CHECKS: (RiskFactor & { group: string })[] = [
  { key: "illness", group: "You", label: "Ill, or not over it yet", why: "IMSAFE: illness", points: 5 },
  { key: "medication", group: "You", label: "On a medication that could impair you", why: "61.53, IMSAFE: medication", points: 5 },
  { key: "stress", group: "You", label: "Under stress: work, home or money", why: "IMSAFE: stress", points: 3 },
  { key: "alcohol", group: "You", label: "Alcohol in the last 8 hours, or still feeling it", why: "91.17", points: 0, stop: true },
  { key: "fatigue", group: "You", label: "Under 8 hours' sleep, or a long day already", why: "IMSAFE: fatigue", points: 4 },
  { key: "eating", group: "You", label: "Hungry or thirsty", why: "IMSAFE: eating", points: 1 },
  { key: "pressure", group: "The day", label: "Somewhere to be by a time, or people counting on it", why: "PAVE: external pressures", points: 3 },
  { key: "unfamiliar", group: "The day", label: "A field or a route new to you", why: "PAVE: environment", points: 2 },
  { key: "rusty", group: "The day", label: "Not flown this airplane in 30 days", why: "PAVE: aircraft", points: 3 },
];

/** At these points the assessment is amber, and at these red. */
export const CAUTION_FROM = 6;
export const HIGH_FROM = 12;

export interface FratInput {
  vfrNotRecommended: boolean;
  underMinimums: string[];
  tfrOnRoute: boolean;
  /** SIGMETs and G-AIRMETs along the route during the flight. */
  hazards: number;
  night: boolean;
  /** The nav log's fuel margin, gallons; below zero the tanks do not
   *  hold the fuel and its reserve. */
  fuelMarginGal: number | null;
  /** Planned under IFR: its reserve is 14 CFR 91.167's. */
  ifr?: boolean;
  /** Under IFR in one of the pilot's own airplanes: its VOR check's last
   *  good day and whether its error was within limits (91.171), or null
   *  with none recorded; undefined for a stock profile, which has none. */
  vorCheck?: { goodThrough: string; withinLimit: boolean } | null;
  /** In one of the pilot's own airplanes: its inspections and tests as
   *  recorded (lib/airworthiness); undefined for a stock profile. */
  inspections?: Inspections | null;
  /** Its squawks not yet fixed (lib/airworthiness). */
  squawks?: Squawk[] | null;
  /** The pilot's currency, where they keep a logbook here. */
  currency: Currency | null;
  /** The day of the flight, yyyy-MM-dd, to read the currency's dates on. */
  day: string;
  ticked: Record<string, boolean>;
}

export interface Assessment {
  score: number;
  level: RiskLevel;
  /** What raised it, the briefing's and the logbook's first. */
  factors: RiskFactor[];
}

/** The whole assessment: the factors found and the ones ticked, their
 *  points, and the level they make. */
export function assess(input: FratInput): Assessment {
  const c = input.currency;
  const a = callEngine("gonogo_risk", {
    vfr_not_recommended: input.vfrNotRecommended, under_minimums: input.underMinimums, tfr_on_route: input.tfrOnRoute,
    hazards: input.hazards, night: input.night, fuel_margin_gal: input.fuelMarginGal, ifr: input.ifr ?? false,
    // Left out for a stock profile, which has none; null for the pilot's
    // own airplane with none recorded.
    ...(input.vorCheck !== undefined
      ? { vor_check: input.vorCheck && { good_through: input.vorCheck.goodThrough, within_limit: input.vorCheck.withinLimit } } : {}),
    inspections: input.inspections ? inspectionsInput(input.inspections) : null,
    squawks: input.squawks ? squawksInput(input.squawks) : null,
    currency: c && {
      flights: c.flights, total_hours: c.totalHours, day_passengers_until: c.dayPassengersUntil ?? null,
      night_passengers_until: c.nightPassengersUntil ?? null, instrument_current_until: c.instrumentCurrentUntil ?? null,
      ipc_needed_after: c.ipcNeededAfter ?? null, flight_review_until: c.flightReviewUntil ?? null, medical_expires_on: c.medicalExpiresOn ?? null,
    },
    day: input.day, ticked: input.ticked,
  });
  return { score: a.score, level: a.level, factors: a.factors.map(riskFactor) };
}

export const LEVEL_TONE: Record<RiskLevel, string> = {
  low: "text-go-ink",
  caution: "text-caution-ink",
  high: "text-destructive-ink",
};

/** An assessment in a few words, for the section's title and a saved
 *  flight's row: "Raised · 8 points". */
export function riskLine(a: { level: string; score: number }): string {
  return callEngine("gonogo_risk_line", { level: a.level, score: a.score });
}

export const LEVEL_WORDS: Record<RiskLevel, string> = {
  low: "Go, with the usual care.",
  caution: "Bring it down where you can (a later time, a shorter leg, an instructor along), or talk it over.",
  high: "Don't go as planned.",
};

/**
 * The assessment for the flight on screen, shared between the briefing
 * that works it out and the Save button in the drawer's header that
 * files it with the flight; and what the pilot ticked, which is about
 * them today, not the route, so it stays for the session.
 */
export const useRisk = create<{
  ticked: Record<string, boolean>;
  assessment: Assessment | null;
  tick: (key: string, on: boolean) => void;
  setAssessment: (assessment: Assessment | null) => void;
}>(set => ({
  ticked: {},
  assessment: null,
  tick: (key, on) => set(s => ({ ticked: { ...s.ticked, [key]: on } })),
  setAssessment: assessment => set({ assessment }),
}));
