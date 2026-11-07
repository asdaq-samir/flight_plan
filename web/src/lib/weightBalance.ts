/**
 * The airplane's weight and balance against its POH's loading: the
 * weights, the centre-of-gravity envelope and each station's most (the
 * POH's section 6; 14 CFR 91.9(a)). Worked out by the shared engine
 * (native/crates/brief/src/gonogo/weight_balance.rs, through lib/engine), the
 * planner's and the phones' own; only the shapes are made here.
 */
import type { Loading } from "./api/types";
import { callEngine } from "./engine/engine";

/** What the pilot loads: the airplane's own empty weight and arm (from
 *  its weight and balance record), each station's pounds in the
 *  loading's order, and the fuel at the start, in gallons. */
export interface Load {
  emptyWeightLb: number;
  emptyArmIn: number;
  stationsLb: number[];
  fuelGal: number;
}

export interface Condition {
  weightLb: number;
  /** The centre of gravity, inches aft of the datum; null where the
   *  weight is zero and there is none. */
  armIn: number | null;
}

/** A condition's centre of gravity as the pages write it. */
export function armText(c: Condition): string {
  return c.armIn === null ? "no CG" : `${c.armIn.toFixed(1)} in`;
}

export interface Balance {
  takeoff: Condition;
  landing: Condition;
  /** What is out of limits, each a sentence; empty when it is within. */
  problems: string[];
}

/** The loading's own sample (its POH's), and a pilot of 170 lb. */
export function defaultLoad(loading: Loading, fuelGal: number): Load {
  const d = callEngine("gonogo_default_load", {
    loading, fuel_gal: fuelGal,
  });
  return { emptyWeightLb: d.empty_weight_lb, emptyArmIn: d.empty_arm_in, stationsLb: d.stations_lb, fuelGal: d.fuel_gal };
}

/**
 * The weight and centre of gravity at takeoff -- the ramp's, less the
 * start and taxi fuel -- and at landing, less the trip's fuel, each
 * against the loading's limits: the most it may weigh, the envelope, and
 * each station's and the baggage's own most.
 */
export function balance(loading: Loading, load: Load, tripFuelGal: number | null): Balance {
  const b = callEngine(
    "gonogo_balance", {
      loading,
      load: { empty_weight_lb: load.emptyWeightLb, empty_arm_in: load.emptyArmIn, stations_lb: load.stationsLb, fuel_gal: load.fuelGal },
      trip_fuel_gal: tripFuelGal,
    });
  // The engine's arm is null where the weight is zero (no centre of
  // gravity); it stays null for the pages to say so.
  const condition = (c: { weight_lb: number; arm_in: number | null }): Condition => ({ weightLb: c.weight_lb, armIn: c.arm_in });
  return { takeoff: condition(b.takeoff), landing: condition(b.landing), problems: b.problems };
}
