import type { Inspections, Squawk } from "./api/types";
import type { GonogoFactor } from "./engine/contract";
import type { RiskFactor } from "./frat";

/** A factor as the engine answers it, with its mark (the contract's). */
export type EngineFactor = GonogoFactor;

/** A factor as the pages read it: `stop` only where it is one, the mark
 *  theirs to draw (RiskAssessment), a self check's group kept. */
export function riskFactor({ key, label, why, points, stop, group }: EngineFactor): RiskFactor & { group?: string } {
  return { key, label, ...(why != null ? { why } : {}), points, ...(stop ? { stop } : {}), ...(group ? { group } : {}) };
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

