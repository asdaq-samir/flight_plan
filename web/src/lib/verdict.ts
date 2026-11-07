/**
 * The Brief's Go / No-Go: every tab's own finding about the flight in one
 * list, each a row that opens where it was found -- the weather, the
 * airspace on the route, the altitude, the fuel, the runways, the loading
 * and the risk -- and one line over them saying what they come to. What
 * the pilot reads first on opening the Brief, as a flight service
 * briefer opens with adverse conditions and whether VFR is recommended
 * (AIM 7-1-5(b)(1), (b)(2)).
 * The findings are the planner's; the decision is the pilot in command's
 * (14 CFR 91.3), and the line says so.
 *
 * Worked out by the shared engine (native/crates/brief/src/gonogo/verdict.rs,
 * through lib/engine), the very code behind the planner's POST
 * /api/go-no-go and the phones' wt_call: the rules, their words and
 * their sources live there. Only the shapes are made here.
 */
import { create } from "zustand";
import { callEngine } from "./engine/engine";
import type { Finding } from "./status";

/** Where a finding is shown in full: a tab of the planning panel, and a
 *  section of it by its title. */
export interface Where {
  tab: "preflight" | "depart" | "enroute" | "arrive";
  section?: string;
}

export interface VerdictItem extends Where {
  key: "weather" | "airspace" | "altitude" | "fuel" | "runways" | "balance" | "risk";
  label: string;
  finding: Finding;
  /** What was found, in a line. */
  detail: string;
}

export interface VerdictInput {
  weather: {
    /** The briefing is still being fetched, or failed (its words). */
    pending: boolean;
    failed: string | null;
    /** AIM 7-1-5's "VFR flight not recommended", its reasons. */
    vfrNotRecommended: string[];
    /** Under the pilot's own minimums (lib/minimums). */
    underMinimums: string[];
    /** Under IFR, icing possible at an altitude flown (lib/icing), in a
     *  line. */
    icing?: string | null;
    /** The SIGMETs and G-AIRMETs along the route, by name. */
    hazards: string[];
    /** The sources that did not answer, by name. */
    unchecked: string[];
    /** The worst the forecast says along the route, in words. */
    worst: string | null;
  };
  airspace: {
    pending: boolean;
    /** tfr.faa.gov did not answer. */
    unchecked: boolean;
    /** TFRs the route goes through while in force when it gets there. */
    inForce: string[];
    /** TFRs near the route that are not. */
    near: number;
    /** Special-use areas the legs cross, as their times of use read for
     *  the pass (lib/passTimes). */
    specialUse: { name: string; when: "active" | "not-scheduled" | "by-notam" | "unknown" }[];
  };
  altitude: {
    pending: boolean;
    /** No VFR altitude fits, in a line. */
    problem: string | null;
    /** A pilot's own altitude's broken rules (AltitudeCaution). */
    cautions: string[];
    /** The altitude flown, as the FL chip says it. */
    flown: string | null;
  };
  fuel: {
    pending: boolean;
    /** The least the tanks hold over the fuel and its reserve, any flight
     *  of the route; null where the usable fuel is not known. */
    marginGal: number | null;
    requiredGal: number | null;
    reserveMin: number | null;
    /** Under IFR: the reserve is 14 CFR 91.167's, not 91.151's. */
    ifr?: boolean;
  };
  runways: {
    pending: boolean;
    /** Not worked out: no POH tables for this airplane. */
    worked: boolean;
    short: string[];
    crosswind: string[];
    /** Fields whose distances were read past the POH's table. */
    beyond: string[];
    /** Fields whose distances could not be held to the runway: its length
     *  or the field's elevation not known. */
    unchecked: string[];
  };
  balance: {
    pending: boolean;
    worked: boolean;
    problems: string[];
    takeoff: string | null;
  };
  risk: { level: "low" | "caution" | "high"; line: string } | null;
}

/** The input as the engine reads it, the planner's VerdictInput in
 *  snake_case. */
function engineInput({ weather, airspace, altitude, fuel, runways, balance, risk }: VerdictInput) {
  return {
    weather: {
      pending: weather.pending, failed: weather.failed, vfr_not_recommended: weather.vfrNotRecommended,
      under_minimums: weather.underMinimums, icing: weather.icing ?? null, hazards: weather.hazards, unchecked: weather.unchecked,
      worst: weather.worst,
    },
    airspace: {
      pending: airspace.pending, unchecked: airspace.unchecked, in_force: airspace.inForce, near: airspace.near,
      special_use: airspace.specialUse,
    },
    altitude,
    fuel: { pending: fuel.pending, margin_gal: fuel.marginGal, required_gal: fuel.requiredGal, reserve_min: fuel.reserveMin, ifr: fuel.ifr ?? false },
    runways,
    balance,
    risk,
  };
}

/** Each tab's finding, in the order a pilot goes through them. */
export function verdictItems(input: VerdictInput): VerdictItem[] {
  // The engine's items are plain strings; its keys, tabs and findings are
  // the ones VerdictItem names (gonogo/verdict.rs verdict_items).
  return callEngine("gonogo_verdict_items", engineInput(input)) as VerdictItem[];
}

/** What the findings come to, in a line over them. */
export function verdictLine(items: VerdictItem[]): { finding: Finding; words: string } {
  return callEngine("gonogo_verdict_line", { items: items.map(i => ({ ...i, section: i.section ?? null })) });
}

/** The findings for the flight on screen, published once (as the risk
 *  is, lib/frat) for the tabs' marks. */
export const useVerdict = create<{ items: VerdictItem[]; setItems: (items: VerdictItem[]) => void }>(set => ({
  items: [],
  setItems: items => set({ items }),
}));
