import type { AltitudeOption, Leg, Runway, Totals } from "../../lib/api/types";
import { SCORE_STEPS } from "../../lib/scoreScale";
import { altFt, bearing, flightLevel, one } from "../../lib/units";
import { clockTime, hoursMinutes, zuluTime } from "../../lib/clock";
import type { WindPick } from "../../lib/pattern";
import { calmOnRunway, isCalm } from "../../lib/wind";

export { altFt, bearing, one };

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


/** Total time as hours and minutes. Minutes are padded so the width does
 *  not jump as the number crosses ten. Rounded to whole minutes first:
 *  rounding the remainder on its own turned 179.6 minutes into "2h 60m". */
/** A field's part in the route as the pilot reads it: a stop between is a
 *  fuel stop, at the owner's ask ("instead of stop, say fuel stop",
 *  2026-10-21), the turnaround on the ground its time to refuel. */
export function roleWords(role: string): string {
  return role === "Stop" ? "Fuel stop" : role;
}

export function hhmm(minutes: number | null): string {
  if (minutes === null) return "ETE n/a";
  const t = hoursMinutes(minutes);
  return `${t.hours}h ${String(t.minutes).padStart(2, "0")}m`;
}

/** Total time in decimal hours, as a logbook keeps it: "19.9h", where
 *  the flight's line has no room for "19h 50m" (FlightLine). Up to the
 *  next tenth, so the time is never said short of what it is; whole
 *  minutes first, as hhmm's are. */
export function decimalHours(minutes: number): string {
  return `${(Math.ceil(Math.round(minutes) / 6) / 10).toFixed(1)}h`;
}

/** The nav log's warning that some legs were worked out with no wind:
 *  "3 legs without wind data", or null with every leg's. (Its totals'
 *  distance, time and fuel were made here too, and read nowhere.) */
export function legsWithoutWind(t: Totals): string | null {
  return t.legs_without_wind
    ? `${t.legs_without_wind} leg${t.legs_without_wind === 1 ? "" : "s"} without wind data`
    : null;
}

/** When a plan was made and the winds-aloft forecast it flies, as paper
 *  says them: "Planned 1712Z · winds for use 1400–2100Z"; "" where the
 *  totals do not say. */
export function plannedWords(t: Totals | null): string {
  if (!t?.planned_at) return "";
  const planned = `Planned ${zuluTime(new Date(t.planned_at))}`;
  return t.winds ? `${planned} · winds for use ${zuluTime(new Date(t.winds.use_from)).slice(0, 4)}–${zuluTime(new Date(t.winds.use_to))}` : planned;
}

/** Whether the winds a plan flies are not for its flight: the departure
 *  (`depart`, an ISO instant, or now where "" or past) outside their
 *  forecast's "for use" period (AC 00-45H, table 5-21) -- past its end as a
 *  plan for "now" left open all day is, or a later flight's no product
 *  covers. Its headings, times and fuel then out of date. */
export function windsOutOfDate(t: Totals | null, now: number, depart = ""): boolean {
  if (!t?.winds) return false;
  const [from, to] = [Date.parse(t.winds.use_from), Date.parse(t.winds.use_to)];
  const planned = Date.parse(depart);
  const at = Number.isFinite(planned) && planned > now ? planned : now;
  return (Number.isFinite(to) && at > to) || (Number.isFinite(from) && at < from);
}

/** An altitude plan's name, as the Brief and the Go / No-Go say it
 *  ("Fastest plan"): the planner's four (vfr.navlog.altitude_profiles). */
export const PLAN_NAME: Record<AltitudeOption["kind"], string> = {
  lowest: "Lowest", highest: "Highest", fastest: "Fastest", economical: "Economical",
};

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

/** A clock time, "09:05", 24-hour in the browser's own zone -- an ETA
 *  (lib/clock, where the app's times are written). */
export { clockTime };

/** When a leg ends: the departure instant plus the minutes flown to
 *  it -- "—" while the minutes are unknown (a leg not yet in, or one
 *  that cannot be flown). */
export function etaAt(departIso: string, minutes: number | null): string {
  if (minutes === null) return "—";
  return clockTime(new Date(new Date(departIso).getTime() + minutes * 60_000));
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

/** A runway's wind in its parts, signed as vfr.runway_wind's are (a
 *  tailwind negative, a crosswind from the right positive): the planner's
 *  Runway["wind"] and lib/pattern's WindPick alike. */
export interface WindParts {
  headwindKt: number;
  crosswindKt: number;
  gustCrosswindKt: number | null;
}

const partsOf = (wind: NonNullable<Runway["wind"]>): WindParts =>
  ({ headwindKt: wind.headwind_kt, crosswindKt: wind.crosswind_kt, gustCrosswindKt: wind.gust_crosswind_kt ?? null });

/** The crosswind unsigned and the gust's where it says more than the
 *  steady one (a gust's crosswind rounded to the steady's adds nothing),
 *  and which side it is from. */
function across(wind: WindParts): { kt: number; gustKt: number | null; side: "right" | "left" | null } {
  const kt = Math.abs(wind.crosswindKt);
  const gust = wind.gustCrosswindKt == null ? null : Math.abs(wind.gustCrosswindKt);
  return { kt, gustKt: gust != null && gust !== kt ? gust : null, side: wind.crosswindKt > 0 ? "right" : wind.crosswindKt < 0 ? "left" : null };
}

/** The reported wind on the end it favours, as a pilot says it:
 *  "Favors 27: 10 kt headwind, 6 kt crosswind from the right, 9 in the
 *  gusts" -- a tailwind where every end has one. */
export function runwayWind(wind: NonNullable<Runway["wind"]>): string {
  if (calmOnRunway(wind)) return `Calm on ${wind.end}`;
  return `Favors ${wind.end}: ${windOnRunway(wind)}`;
}

/** The wind's parts on the runway it favours, without naming it: "13 kt
 *  headwind, 8 kt crosswind from the left, 13 in the gusts" -- for a row
 *  that names the runway itself (TakeoffLandingSection). */
export function windOnRunway(wind: NonNullable<Runway["wind"]>): string {
  if (calmOnRunway(wind)) return "Calm";
  const parts = partsOf(wind);
  const along = parts.headwindKt >= 0 ? `${parts.headwindKt} kt headwind` : `${-parts.headwindKt} kt tailwind`;
  const cross = across(parts);
  return `${along}, ${cross.kt} kt crosswind${cross.side ? ` from the ${cross.side}` : ""}${cross.gustKt != null ? `, ${cross.gustKt} in the gusts` : ""}`;
}

/** The wind a runway is picked by (lib/pattern's windPick), in words, as
 *  its symbols in FPL's list say it: "24 into the wind: headwind 8 kt,
 *  crosswind 2 gusting 9 kt (KUGN, 11 nm)", or "Wind calm". The crosswind
 *  left out where there is none, steady or in the gusts. */
export function windPickWords(wind: WindPick): string {
  const from = wind.from ? ` (${wind.from.ident}, ${wind.from.nm} nm)` : "";
  if (wind.calm) return `Wind calm${wind.ident ? `, ${wind.ident}${wind.inUse ? " in use" : ""}` : ""}${from}`;
  const cross = across(wind);
  const crosswind = cross.kt > 0 || cross.gustKt != null ? `, crosswind ${cross.kt}${cross.gustKt != null ? ` gusting ${cross.gustKt}` : ""} kt` : "";
  const along = wind.headwindKt >= 0 ? `headwind ${wind.headwindKt} kt` : `tailwind ${-wind.headwindKt} kt`;
  return `${wind.ident} into the wind: ${along}${crosswind}${from}`;
}

/** The crosswind and its gust's of a picked wind, for its symbol: "2",
 *  "2G9", null with none either way. */
export function windPickCrosswind(wind: WindPick): string | null {
  const cross = across(wind);
  return cross.kt > 0 || cross.gustKt != null ? `${cross.kt}${cross.gustKt != null ? `G${cross.gustKt}` : ""}` : null;
}

/** The wind as a METAR reports it, true: "240° at 15 kt, gusts 25",
 *  "Calm" (00000KT, lib/wind's isCalm), "Variable at 4 kt" (VRB) --
 *  FAA Order JO 7900.5's codes as the planner reads them; "Not reported"
 *  with no speed. The airport's card's and the Brief's. */
export function windLine(metar: { wind_speed_kt?: number | null; wind_dir_true_deg?: number | null; wind_gust_kt?: number | null }): string {
  if (metar.wind_speed_kt == null) return "Not reported";
  if (isCalm(metar.wind_speed_kt)) return "Calm";
  const from = metar.wind_dir_true_deg == null ? "Variable" : bearing(metar.wind_dir_true_deg);
  return `${from} at ${Math.round(metar.wind_speed_kt)} kt${metar.wind_gust_kt ? `, gusts ${Math.round(metar.wind_gust_kt)}` : ""}`;
}

/** A wind reported or forecast at a field, as FPL's list writes it on the
 *  field's button: its true direction marked "T" ("240°T", "VRB") over
 *  its speed ("12G20", knots), and in words for a screen reader
 *  ("240 true at 12 knots, gusts 20"); "calm" (isCalm), or null with no
 *  speed to go by. */
export type ReportedWind = "calm" | { dir: string; speed: string; spoken: string };

export function reportedWind(dirTrueDeg: number | null | undefined, speedKt: number | null | undefined, gustKt: number | null | undefined): ReportedWind | null {
  if (speedKt == null) return null;
  if (isCalm(speedKt)) return "calm";
  const kt = Math.round(speedKt), gust = gustKt ? Math.round(gustKt) : null;
  return {
    dir: dirTrueDeg == null ? "VRB" : `${bearing(dirTrueDeg)}T`, speed: gust ? `${kt}G${gust}` : `${kt}`,
    spoken: `${dirTrueDeg == null ? "variable" : `${Math.round(dirTrueDeg)} true`} at ${kt} knots${gust ? `, gusts ${gust}` : ""}`,
  };
}

/** A wind aloft as the nav log writes it, true: "270°/15", direction
 *  over speed in knots -- the form of the nav log's own columns (headed
 *  °/kt); running text adds " kt". */
export function windAloft(dirTrueDeg: number, speedKt: number): string {
  return `${bearing(dirTrueDeg)}/${Math.round(speedKt)}`;
}

/** Ceiling and visibility the way a briefer says them. */
export function ceilingAndVisibility(ceilingFt: number | null | undefined, visibilitySm: number | null | undefined): string {
  return `${ceilingFt == null ? "no ceiling" : `${altFt(ceilingFt)} ft`} · ${visibilitySm == null ? "—" : `${visibilitySm} sm`}`;
}
