import type { Inspections, Squawk } from "./api/types";
import type { GonogoFactor } from "./engine/contract";
import { callEngine } from "./engine/engine";
import type { RiskFactor } from "./frat";

/** A factor as the engine answers it, with its mark (the contract's). */
export type EngineFactor = GonogoFactor;

/** A factor as the pages read it: `stop` only where it is one, the mark
 *  theirs to draw (RiskAssessment), a self check's group kept. */
export function riskFactor({ key, label, why, points, stop, group, finding }: EngineFactor): RiskFactor & { group?: string } {
  return { key, label, ...(why != null ? { why } : {}), points, ...(stop ? { stop } : {}), ...(group ? { group } : {}), ...(finding ? { finding } : {}) };
}

/** The inspections as the engine reads them, in snake_case. */
export function inspectionsInput(i: Inspections) {
  return {
    annual_good_through: i.annualGoodThrough ?? null, elt_inspection_good_through: i.eltInspectionGoodThrough ?? null,
    elt_battery_due_on: i.eltBatteryDueOn ?? null, static_check_good_through: i.staticCheckGoodThrough ?? null,
    transponder_check_good_through: i.transponderCheckGoodThrough ?? null,
    hundred_hour_due_at_hours: i.hundredHourDueAtHours ?? null, hours_now: i.hoursNow ?? null,
  };
}

/** The squawks as the engine reads them. */
export function squawksInput(open: Squawk[]) {
  return open.map(s => ({ text: s.text, inoperative: s.inoperative, deferred_for: s.deferredFor ?? null }));
}

/**
 * Whether the pilot's own airplane may be flown on the day, by the
 * inspections and tests its owner has recorded (the aircraft's
 * Inspections): each recorded one past its last good day is a factor in
 * the risk assessment (lib/frat). The webapp works the days out from the
 * rules' calendar months; what has not been recorded says nothing, either
 * way.
 *
 * - The annual (14 CFR 91.409(a)) and the ELT's inspection (91.207(d)) or
 *   its battery past the date marked on it (91.207(c)): no flight as
 *   planned. The ELT's are not owed on a training flight within 50 nm of
 *   its departure, among 91.207(f)'s exceptions, which the pilot weighs.
 * - The altimeter and static test (91.411(a)): no IFR in controlled
 *   airspace, so a stop under IFR and nothing under VFR.
 * - The transponder test (91.413(a)): the transponder may not be used,
 *   which keeps the flight out of the airspace 91.215(b) requires one in --
 *   a caution, as a flight can stay out of it.
 * - The 100-hour (91.409(b)): owed only for hire, or for instruction in an
 *   airplane the instructor provides -- a caution, as the pilot knows
 *   which this flight is.
 *
 * The rules, their points and their sources are the shared engine's
 * (native/crates/brief/src/gonogo/frat.rs, through lib/engine), the planner's
 * and the phones' own.
 */
export function inspectionFactors(i: Inspections, day: string, ifr: boolean): RiskFactor[] {
  return callEngine("gonogo_inspection_factors", { inspections: inspectionsInput(i), day, ifr }).map(riskFactor);
}

/**
 * The airplane's open squawks on the day: an instrument or equipment that
 * does not work stops the flight unless its 91.213(d) determination --
 * not required, removed or deactivated and placarded, no hazard -- was
 * made for this kind of flight (by day, at night, under IFR: what 91.205
 * does not ask by day it may at night or under IFR); the others are a
 * caution to read before flight (91.7(b)).
 */
export function squawkFactors(open: Squawk[], night: boolean, ifr: boolean): RiskFactor[] {
  return callEngine("gonogo_squawk_factors", { squawks: squawksInput(open), night, ifr }).map(riskFactor);
}
