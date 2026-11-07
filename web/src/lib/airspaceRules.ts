/**
 * What a pilot needs to fly into a Class B, C or D airspace area, and the
 * speeds in and under it, as 14 CFR part 91 says them (eCFR, current on
 * 2026-10-30): each a rule and the section it comes from, for the
 * airspace's card (AirspaceLayer). VFR, in the 48 states, for a civil
 * airplane with an engine-driven electrical system: the exceptions for
 * gliders, balloons and the rest (91.215(b)(3), 91.225(e)) are left out.
 *
 * The shared engine's (native/crates/airspace/src/rules.rs entry_rules, through
 * lib/engine), beside the rules of each band of the airspace over a point
 * the planner and the phones answer, from the same figures.
 */
import { callEngine, type EngineAnswer } from "./engine/engine";

export type AirspaceRule = EngineAnswer<"airspace_entry_rules">["rules"][number];

export function entryRules(airspaceClass: "B" | "C" | "D"): AirspaceRule[] {
  return callEngine("airspace_entry_rules", { class: airspaceClass }).rules;
}

/** The frequencies to call before entering, from the primary airport's
 *  (NASR FRQ): approach for a Class B or C, the tower for a Class D. */
export function callTypes(airspaceClass: "B" | "C" | "D"): string[] {
  return callEngine("airspace_entry_rules", { class: airspaceClass }).call;
}
