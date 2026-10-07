import type { AltitudeOption, Leg, Runway, Totals } from "../../lib/api/types";
import { SCORE_STEPS } from "../../lib/scoreScale";
import { altFt, flightLevel } from "../../lib/units";

export { altFt };

/**
 * The planner's pure half: colours and number formatting.
 *
 * Split out for the same reason the training workspace's logic was -- these are the
 * parts with edge cases (a heading of exactly 360, a leg that cannot be
 * flown, a route whose nav log has not arrived yet), and they are only
 * testable while they have no map and no DOM attached.
 */

/** Score bands, on the rating scale's own steps (lib/scoreScale) so a
 *  colour means one thing across both views. */
export function scoreColor(s: number): string {
  if (s >= 4.5) return SCORE_STEPS[4];
  if (s >= 4.0) return SCORE_STEPS[3];
  if (s >= 3.5) return SCORE_STEPS[2];
  if (s >= 3.0) return SCORE_STEPS[1];
  return SCORE_STEPS[0];
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
  if (option.steps.length <= 1) return `${flightLevel(option.steps[0]?.altitude_ft)} all the way`;
  return option.steps.map(s => `${flightLevel(s.altitude_ft)} to ${s.to}`).join(", ");
}

/** One altitude plan's time: the flying time plus what its climbs
 *  cost, which is what the fastest is chosen on. */
export function describeTime(option: AltitudeOption): string {
  return option.ete_min === null ? "unflyable" : hhmm(option.ete_min);
}

/** One altitude plan's fuel, its climbs' included -- what the
 *  economical plan is chosen on. "—" while a leg cannot be flown. */
export function describeFuel(option: AltitudeOption): string {
  return option.fuel_gal === null ? "—" : `${one(option.fuel_gal)} gal`;
}

/** A figure over several legs: "112", or its range, "111–113". */
function range(values: number[], show: (n: number) => string, between = "–"): string {
  const low = show(Math.min(...values)), high = show(Math.max(...values));
  return low === high ? low : `${low}${between}${high}`;
}

/** The legs' cruise in their own air, a line per altitude flown --
 *  "6,500 ft: 2 to 4 °C, density altitude 6,900–7,200 ft, 111–112 kt,
 *  8.5 gph" -- with "full throttle, 62%" where the engine could not make
 *  the cruise power there. A range where legs at one altitude met
 *  different forecasts; no temperature for legs a standard day was
 *  assumed for, which had none. */
export function cruiseByAltitude(legs: Leg[], cruisePowerPct: number | null | undefined): string[] {
  const byAltitude = new Map<number, Leg[]>();
  for (const leg of legs) byAltitude.set(leg.altitude_ft, [...(byAltitude.get(leg.altitude_ft) ?? []), leg]);
  return [...byAltitude.entries()].sort(([a], [b]) => a - b).map(([altitude, at]) => {
    const temps = at.flatMap(leg => (leg.oat_c == null ? [] : [leg.oat_c]));
    const power = Math.min(...at.map(leg => leg.power_pct));
    return `${altFt(altitude)} ft: `
      + (temps.length ? `${range(temps, t => String(Math.round(t)), " to ")} °C, ` : "")
      + `density altitude ${range(at.map(leg => leg.density_altitude_ft), d => altFt(Math.round(d / 100) * 100))} ft, `
      + `${range(at.map(leg => leg.tas_kt), t => String(Math.round(t)))} kt, ${range(at.map(leg => leg.fuel_burn_gph), b => b.toFixed(1))} gph`
      + (cruisePowerPct != null && power < cruisePowerPct - 0.5 ? ` (full throttle, ${Math.round(power)}%)` : "");
  });
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

const SURFACE_NAMES: Record<string, string> = {
  ASP: "asphalt", ASPH: "asphalt", CON: "concrete", CONC: "concrete", TURF: "turf", GRS: "grass", GRASS: "grass",
  GRVL: "gravel", GRAVEL: "gravel", DIRT: "dirt", WATER: "water", SNOW: "snow",
  // Composite, as OurAirports codes it: "cop" on Campbell's 06/24 read as a word.
  COP: "composite", COM: "composite",
};

/** A runway's surface in words: OurAirports' "ASPH-G" is asphalt. */
export function surfaceName(surface: string | null | undefined): string | null {
  if (!surface) return null;
  const code = (surface.split(/[-/ ]/)[0] ?? "").toUpperCase();
  return SURFACE_NAMES[code] ?? surface.toLowerCase();
}

/** The reported wind on the end it favours, as a pilot says it:
 *  "Favors 27: 10 kt headwind, 6 kt crosswind from the right, 9 in the
 *  gusts" -- a tailwind where every end has one. */
export function runwayWind(wind: NonNullable<Runway["wind"]>): string {
  if (wind.headwind_kt === 0 && wind.crosswind_kt === 0 && wind.gust_crosswind_kt == null) return `Calm on ${wind.end}`;
  const along = wind.headwind_kt >= 0 ? `${wind.headwind_kt} kt headwind` : `${-wind.headwind_kt} kt tailwind`;
  const side = wind.crosswind_kt > 0 ? " from the right" : wind.crosswind_kt < 0 ? " from the left" : "";
  const gusts = wind.gust_crosswind_kt != null && Math.abs(wind.gust_crosswind_kt) !== Math.abs(wind.crosswind_kt)
    ? `, ${Math.abs(wind.gust_crosswind_kt)} in the gusts` : "";
  return `Favors ${wind.end}: ${along}, ${Math.abs(wind.crosswind_kt)} kt crosswind${side}${gusts}`;
}

/** Ceiling and visibility the way a briefer says them. */
export function ceilingAndVisibility(ceilingFt: number | null | undefined, visibilitySm: number | null | undefined): string {
  return `${ceilingFt == null ? "no ceiling" : `${altFt(ceilingFt)} ft`} · ${visibilitySm == null ? "—" : `${visibilitySm} sm`}`;
}
