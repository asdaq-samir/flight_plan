import type { Loading } from "./api/types";

/** What the pilot loads: the aeroplane's own empty weight and arm (from
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
  /** The centre of gravity, inches aft of the datum. */
  armIn: number;
}

export interface Balance {
  takeoff: Condition;
  landing: Condition;
  /** What is out of limits, each a sentence; empty when it is within. */
  problems: string[];
}

/** The loading's own sample (its POH's), and a pilot of 170 lb. */
export function defaultLoad(loading: Loading, fuelGal: number): Load {
  return {
    emptyWeightLb: loading.sample_empty_weight_lb,
    emptyArmIn: Math.round((loading.sample_empty_moment_lb_in / loading.sample_empty_weight_lb) * 100) / 100,
    stationsLb: loading.stations.map((_, i) => (i === 0 ? 170 : 0)),
    fuelGal: Math.min(fuelGal, loading.fuel_max_gal),
  };
}

/** Whether a (arm, weight) point is within the envelope, its edges
 *  included: the POH's sample loading sits on its top, at 2,550 lb. */
export function inEnvelope(envelope: [number, number][], arm: number, weight: number): boolean {
  const limits = limitsAt(envelope, weight);
  return !!limits && limits[0] - 1e-6 <= arm && arm <= limits[1] + 1e-6;
}

/** The forward and aft limits at a weight: the envelope's edges there. */
function limitsAt(envelope: [number, number][], weight: number): [number, number] | null {
  const arms: number[] = [];
  for (let i = 0, j = envelope.length - 1; i < envelope.length; j = i++) {
    const [xi, yi] = envelope[i]!, [xj, yj] = envelope[j]!;
    if ((yi <= weight && weight <= yj) || (yj <= weight && weight <= yi)) {
      arms.push(yi === yj ? Math.min(xi, xj) : xi + ((xj - xi) * (weight - yi)) / (yj - yi));
      if (yi === yj) arms.push(Math.max(xi, xj));
    }
  }
  return arms.length ? [Math.min(...arms), Math.max(...arms)] : null;
}

const pounds = (n: number) => `${Math.round(n).toLocaleString("en-US")} lb`;

/**
 * The weight and centre of gravity at takeoff -- the ramp's, less the
 * start and taxi fuel -- and at landing, less the trip's fuel, each
 * against the loading's limits: the most it may weigh, the envelope, and
 * each station's and the baggage's own most.
 */
export function balance(loading: Loading, load: Load, tripFuelGal: number | null): Balance {
  const fuelLb = load.fuelGal * loading.fuel_lb_per_gal;
  let weight = load.emptyWeightLb + fuelLb;
  let moment = load.emptyWeightLb * load.emptyArmIn + fuelLb * loading.fuel_arm_in;
  loading.stations.forEach((station, i) => {
    weight += load.stationsLb[i] ?? 0;
    moment += (load.stationsLb[i] ?? 0) * station.arm_in;
  });
  const takeoffWeight = weight - loading.start_taxi_fuel_lb;
  const takeoffMoment = moment - loading.start_taxi_fuel_lb * loading.fuel_arm_in;
  const burnedLb = Math.min(fuelLb - loading.start_taxi_fuel_lb, (tripFuelGal ?? 0) * loading.fuel_lb_per_gal);
  const landingWeight = takeoffWeight - burnedLb;
  const landingMoment = takeoffMoment - burnedLb * loading.fuel_arm_in;
  const takeoff = { weightLb: takeoffWeight, armIn: takeoffMoment / takeoffWeight };
  const landing = { weightLb: landingWeight, armIn: landingMoment / landingWeight };

  const problems: string[] = [];
  const envelope = loading.envelope as [number, number][];
  if (weight > loading.max_ramp_lb) problems.push(`The ramp weight, ${pounds(weight)}, is over its most, ${pounds(loading.max_ramp_lb)}`);
  if (takeoff.weightLb > loading.max_takeoff_lb) {
    problems.push(`The takeoff weight, ${pounds(takeoff.weightLb)}, is ${pounds(takeoff.weightLb - loading.max_takeoff_lb)} over its most`);
  }
  if (landing.weightLb > loading.max_landing_lb) {
    problems.push(`The landing weight, ${pounds(landing.weightLb)}, is ${pounds(landing.weightLb - loading.max_landing_lb)} over its most`);
  }
  for (const [name, c] of [["takeoff", takeoff], ["landing", landing]] as const) {
    if (c.weightLb > Math.max(...envelope.map(p => p[1]))) continue;   // said above, as a weight
    if (!inEnvelope(envelope, c.armIn, c.weightLb)) {
      const limits = limitsAt(envelope, c.weightLb);
      const side = limits && c.armIn < limits[0] ? `forward of its limit, ${limits[0].toFixed(1)} in`
        : limits ? `aft of its limit, ${limits[1].toFixed(1)} in` : "outside the envelope";
      problems.push(`At ${name} the centre of gravity, ${c.armIn.toFixed(1)} in, is ${side}`);
    }
  }
  loading.stations.forEach((station, i) => {
    if (station.max_lb != null && (load.stationsLb[i] ?? 0) > station.max_lb) {
      problems.push(`${station.name} holds ${pounds(load.stationsLb[i]!)}, over its ${pounds(station.max_lb)}`);
    }
  });
  const baggage = loading.stations.reduce((sum, s, i) => (s.name.toLowerCase().startsWith("baggage") ? sum + (load.stationsLb[i] ?? 0) : sum), 0);
  if (loading.baggage_combined_max_lb != null && baggage > loading.baggage_combined_max_lb) {
    problems.push(`The baggage, ${pounds(baggage)} in all, is over its ${pounds(loading.baggage_combined_max_lb)}`);
  }
  if (load.fuelGal > loading.fuel_max_gal) problems.push(`${load.fuelGal} gal is more than the tanks' usable ${loading.fuel_max_gal}`);
  return { takeoff, landing, problems };
}
