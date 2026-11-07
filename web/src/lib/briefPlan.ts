/**
 * The flight as the Brief is reading it, published once by the planning
 * workspace (PlanWorkspace) for what the Brief's cards draw outside the
 * route's props: the assistant's context (useAsk), the words sections'
 * requests (BriefWords) and the flight watch's saved flight
 * (FlightWatch). Read from the same places the Brief's own head reads
 * them -- the address's route and time, the airplane picked, the nav
 * log's altitude and totals -- so the assistant is asked about the plan
 * on screen, not one remembered.
 */
import { create } from "zustand";
import type { FlightToSave } from "../features/plan/components/briefing/SaveFlight";

export interface BriefPlan {
  dep: string;
  dest: string;
  /** The airports landed at on the way, in order. */
  stops: string[];
  /** The airplane's profile ("c172"), as the nav log is asked for it. */
  aircraft: string | null;
  /** The cruise altitude flown, from the nav log; null until it is in. */
  altitudeFt: number | null;
  /** The departure as an ISO instant, or "" for about now. */
  depart: string;
  /** The flight's time en route from the nav log's totals, or a local
   *  flight's time aloft; null until the log is in. */
  eteMin: number | null;
  /** The nav log's legs as the briefing is asked with them (briefingLegs),
   *  for the weather's words to be placed on the same legs. */
  legs: { fixes: string; legMin: string } | null;
  /** A route planned whole, its nav log in. */
  routed: boolean;
  /** One airport to itself. */
  local: boolean;
  /** The plan on screen as Save would file it (FlightBriefingView). */
  flight: FlightToSave | null;
}

export const NO_PLAN: BriefPlan = {
  dep: "", dest: "", stops: [], aircraft: null, altitudeFt: null, depart: "", eteMin: null, legs: null, routed: false, local: false, flight: null,
};

export const useBriefPlan = create<BriefPlan & { set: (plan: BriefPlan) => void }>(set => ({
  ...NO_PLAN,
  set: plan => set(plan),
}));

/** The route as one string, for a query's key. */
export const routeKeyOf = (plan: Pick<BriefPlan, "dep" | "dest" | "stops" | "depart">) =>
  `${plan.dep}|${plan.stops.join(",")}|${plan.dest}|${plan.depart}`;
