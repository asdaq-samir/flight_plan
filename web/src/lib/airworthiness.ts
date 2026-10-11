import type { Inspections } from "./api/types";
import type { RiskFactor } from "./frat";

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
 */
export function inspectionFactors(i: Inspections, day: string, ifr: boolean): RiskFactor[] {
  const past = (goodThrough: string | null | undefined) => !!goodThrough && goodThrough < day;
  const factors: RiskFactor[] = [];
  if (past(i.annualGoodThrough)) {
    factors.push({ key: "annual", label: "The airplane's annual inspection is past due", why: "91.409(a)", points: 0, stop: true });
  }
  if (past(i.eltInspectionGoodThrough)) {
    factors.push({ key: "elt", label: "The ELT's inspection is past due", why: "91.207(d), but for 91.207(f)'s exceptions", points: 0, stop: true });
  }
  // The battery is to be replaced by the date marked: on it, it is due.
  if (i.eltBatteryDueOn && i.eltBatteryDueOn <= day) {
    factors.push({ key: "eltBattery", label: "The ELT's battery is past its replacement date", why: "91.207(c), but for 91.207(f)'s exceptions", points: 0, stop: true });
  }
  if (ifr && past(i.staticCheckGoodThrough)) {
    factors.push({ key: "static", label: "The altimeter and static test is past due: no IFR in controlled airspace", why: "91.411(a)", points: 0, stop: true });
  }
  if (past(i.transponderCheckGoodThrough)) {
    factors.push({
      key: "transponder", label: "The transponder test is past due: stay out of the airspace that needs one", why: "91.413(a), 91.215(b)", points: 3,
    });
  }
  if (i.hundredHourDueAtHours != null && i.hoursNow != null && i.hoursNow >= i.hundredHourDueAtHours) {
    factors.push({ key: "hundredHour", label: "The 100-hour inspection is due", why: "91.409(b): for hire, or instruction in an airplane you provide", points: 2 });
  }
  return factors;
}
