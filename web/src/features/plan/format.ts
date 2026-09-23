import type { AltitudeOption, Totals } from "../../lib/api/types";
import { compassPoint } from "../../lib/compass";
import { altFt } from "../../lib/units";

export { altFt, compassPoint };

/**
 * The planner's pure half: colours and number formatting.
 *
 * Split out for the same reason the training workspace's logic was -- these are the
 * parts with edge cases (a heading of exactly 360, a leg that cannot be
 * flown, a route whose nav log has not arrived yet), and they are only
 * testable while they have no map and no DOM attached.
 */

/** Score bands, matching the rating scale so a colour means one thing
 *  across both views. */
export function scoreColor(s: number): string {
  if (s >= 4.5) return "#1a7f37";
  if (s >= 4.0) return "#4a9d4a";
  if (s >= 3.5) return "#b8860b";
  if (s >= 3.0) return "#c2681a";
  return "#b3261e";
}

/**
 * A bearing as a pilot writes it: three digits, and 360 shown as 000.
 *
 * The modulo is not cosmetic. Rounding 359.7 gives 360, which is a
 * heading no chart or clearance ever uses.
 */
export function deg(d: number): string {
  return String(Math.round(d) % 360).padStart(3, "0") + "°";
}

/** One decimal, or an em dash. null and undefined are ordinary here --
 *  an unflyable leg has no ETE and no fuel burn. */
export function one(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(1);
}


/** Signed to one decimal: a wind correction of -3 reads as a correction,
 *  where "3" reads as a magnitude. */
export function signed(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "°";
}

/** Total time as hours and minutes. Minutes are padded so the width does
 *  not jump as the number crosses ten. Rounded to whole minutes first:
 *  rounding the remainder on its own turned 179.6 minutes into "2h 60m". */
export function hhmm(minutes: number | null): string {
  if (minutes === null) return "ETE n/a";
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, "0")}m`;
}

/** Totals for the nav-log bar. Returns parts rather than markup so the
 *  warning can be styled without parsing a string back apart. */
export function totalsParts(t: Totals) {
  return {
    distance: `${t.distance_nm} nm`,
    time: hhmm(t.ete_min),
    fuel: `${t.fuel_gal === null ? "—" : t.fuel_gal} gal`,
    warning: t.legs_without_wind
      ? `${t.legs_without_wind} leg${t.legs_without_wind === 1 ? "" : "s"} without wind data`
      : null,
  };
}

/** One altitude plan's steps: "2,500 ft all the way", or "2,500 ft to
 *  Mill Pond, 6,500 ft to Big Falls Flowage, 2,500 ft to KDLH". */
export function describeSteps(option: AltitudeOption): string {
  if (option.steps.length <= 1) return `${altFt(option.steps[0]?.altitude_ft)} ft all the way`;
  return option.steps.map(s => `${altFt(s.altitude_ft)} ft to ${s.to}`).join(", ");
}

/** One altitude plan's time: the flying time plus what its climbs
 *  cost, which is what the plans are compared on. */
export function describeTime(option: AltitudeOption): string {
  return option.total_min === null ? "unflyable" : hhmm(option.total_min);
}

/** A clock time, "09:05", in the browser's own zone -- an ETA. */
export function clockTime(at: Date): string {
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** When a leg ends: the departure instant plus the minutes flown to
 *  it -- "—" while the minutes are unknown (a leg not yet in, or one
 *  that cannot be flown). */
export function etaAt(departIso: string, minutes: number | null): string {
  if (minutes === null) return "—";
  return clockTime(new Date(new Date(departIso).getTime() + minutes * 60_000));
}

/** Elapsed time on a build job, as m:ss. */
export function elapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
