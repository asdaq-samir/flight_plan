/**
 * A flight risk assessment before each flight (the roadmap's FRAT,
 * after the FAA Risk Management Handbook's PAVE and IMSAFE, FAA-H-8083-2):
 * points for what raises the risk of this flight -- from the briefing
 * (VFR not recommended, the pilot's own minimums, a TFR on the route,
 * SIGMETs and G-AIRMETs, night), from the nav log's fuel check, from the
 * pilot's logbook (the flight review, the medical, recent landings) --
 * and for what only the pilot knows: IMSAFE, and the pressures on the
 * day.
 *
 * The points and where they turn the assessment amber and red are the
 * planner's own guide, not the FAA's and not a rule: the decision is
 * the pilot in command's (91.3, 91.103). What makes a flight unlawful --
 * alcohol within 8 hours, a lapsed flight review or medical, tanks that
 * do not hold the fuel -- is high whatever else is.
 */
import { create } from "zustand";
import type { Currency } from "./api/types";

export type RiskLevel = "low" | "caution" | "high";

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

/** What the briefing, the nav log and the logbook raise. */
export function found(input: FratInput): RiskFactor[] {
  const factors: RiskFactor[] = [];
  if (input.vfrNotRecommended) factors.push({ key: "vnr", label: "VFR flight not recommended", why: "The briefing (AIM 7-1-5)", points: HIGH_FROM });
  if (input.underMinimums.length) factors.push({ key: "minimums", label: "Under your personal minimums", why: input.underMinimums[0], points: HIGH_FROM });
  if (input.tfrOnRoute) factors.push({ key: "tfr", label: "A TFR on the route when you get there", why: "Route round it, or go another time", points: HIGH_FROM });
  if (input.hazards > 0) factors.push({ key: "hazards", label: `${input.hazards} SIGMET or G-AIRMET${input.hazards === 1 ? "" : "s"} along the route`, why: "Adverse conditions", points: Math.min(6, 2 * input.hazards) });
  if (input.night) factors.push({ key: "night", label: "At night", why: "PAVE: environment", points: 3 });
  if (input.fuelMarginGal != null && input.fuelMarginGal < 0) {
    factors.push({ key: "fuel", label: "The tanks do not hold the fuel and its reserve", why: "91.151", points: 0, stop: true });
  }
  const c = input.currency;
  if (c && c.flights > 0) {
    if (c.flightReviewUntil && c.flightReviewUntil < input.day) factors.push({ key: "review", label: "Your flight review has lapsed", why: "61.56", points: 0, stop: true });
    if (c.medicalExpiresOn && c.medicalExpiresOn < input.day) factors.push({ key: "medical", label: "Your medical has expired", why: "61.23", points: 0, stop: true });
    if (!c.dayPassengersUntil || c.dayPassengersUntil < input.day) factors.push({ key: "recent", label: "Not three landings in the last 90 days", why: "61.57(a): no passengers, and rusty", points: 3 });
    if (input.night && (!c.nightPassengersUntil || c.nightPassengersUntil < input.day)) {
      factors.push({ key: "recent-night", label: "Not three night landings in the last 90 days", why: "61.57(b)", points: 3 });
    }
    if (c.totalHours < 100) factors.push({ key: "low-time", label: "Under 100 hours in your logbook", why: "PAVE: pilot", points: 2 });
  }
  return factors;
}

/** The whole assessment: the factors found and the ones ticked, their
 *  points, and the level they make. */
export function assess(input: FratInput): Assessment {
  const factors = [...found(input), ...SELF_CHECKS.filter(check => input.ticked[check.key])];
  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const level: RiskLevel = factors.some(f => f.stop) || score >= HIGH_FROM ? "high" : score >= CAUTION_FROM ? "caution" : "low";
  return { score, level, factors };
}

export const LEVEL_TONE: Record<RiskLevel, string> = {
  low: "text-green-700 dark:text-green-400",
  caution: "text-amber-700 dark:text-amber-400",
  high: "text-red-700 dark:text-red-400",
};

const LEVEL_NAME: Record<RiskLevel, string> = { low: "Low", caution: "Raised", high: "High" };

/** An assessment in a few words, for the section's title and a saved
 *  flight's row: "Raised · 8 points". */
export function riskLine(a: { level: string; score: number }): string {
  return `${LEVEL_NAME[a.level as RiskLevel] ?? a.level} · ${a.score} point${a.score === 1 ? "" : "s"}`;
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
