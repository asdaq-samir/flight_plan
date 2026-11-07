import type { Briefing } from "./api/types";
import { callEngine } from "./engine/engine";
import { altFt } from "./units";

type GAirmet = Briefing["gairmets"][number];
type Pirep = Briefing["pireps"][number];
type RouteTfr = Briefing["tfrs"][number];

/*
 * How the FAA's own words are written -- its capitals in sentence case
 * with its codes kept, names, the advisories' intensities and hazards, a
 * special-use area's limits -- is the shared engine's
 * (native/crates/wording/src/wording, through lib/engine): the very rules the
 * planner's Go / No-Go and the iPhone write them by. Only how a figure
 * is printed and a date laid out are made here.
 */

/** A name the FAA writes in capitals, written as a name is: "CHICAGO
 *  CLASS B" as "Chicago Class B", "ROCKFORD" as "Rockford" -- a place's, a
 *  facility's, an airspace's -- where its prose is set in sentence case
 *  (faaWords). */
export function titleCase(text: string): string {
  // One text answers one string (a list of texts answers a list).
  return callEngine("title_case", { text }) as string;
}

/** The first letter a capital, the rest as it is: "road or rail" as "Road
 *  or rail", a line of the app's own words opening a row. */
export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The FAA's capitalised text -- a special-use area's times of use, a
 * G-AIRMET's cause, a TFR's purpose -- in sentence case, its codes kept:
 * "INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE" reads "Intermittent by
 * NOTAM 4 hours in advance", an airspace's class as the AIM writes it,
 * "Class B" (AIM 3-2-1). Text with any lower case is someone's own
 * writing and is left as it is, and so are raw reports, which pilots read
 * as sent.
 */
export function faaWords(text: string | null | undefined): string {
  // One text answers one string (a list of texts answers a list).
  return text ? (callEngine("faa_words", { text }) as string) : "";
}

/** A place's name as it is written, each word capitalised: the FAA's and
 *  the airport file's capitals ("EAU CLAIRE", "LA CROSSE", "STERLING/
 *  ROCKFALLS") as a town is spelt -- "Eau Claire", "La Crosse",
 *  "Sterling/Rockfalls", "McCook" -- where faaWords' sentence case read
 *  "La crosse" (the owner's screenshot, 2026-10-26). A name already in
 *  mixed case is kept as it is. */
export function placeWords(text: string | null | undefined): string {
  // One text answers one string (a list of texts answers a list).
  return text ? (callEngine("place_name", { text }) as string) : "";
}

/** A SIGMET's hazard in words: "Convective", "Mountain obscuration". */
export const sigmetHazard = (hazard: string | null | undefined, kind?: string | null) =>
  callEngine("sigmet_hazard", { hazard: hazard ?? null, kind: kind ?? null });

/** A G-AIRMET's hazard and how bad: "Icing, moderate". */
export function gairmetTitle(g: GAirmet): string {
  return callEngine("gairmet_title", { hazard: g.hazard, severity: g.severity ?? null });
}

/** How high a G-AIRMET reaches: "Freezing level to 22,000 ft",
 *  "5,000 to 18,000 ft"; nothing for one with no altitudes (IFR). */
export function gairmetAltitudes(g: GAirmet): string | null {
  const top = g.altitude_high_ft != null && g.altitude_high_ft > 0 ? `${altFt(g.altitude_high_ft)} ft` : null;
  if (!top) return g.from_freezing_level ? "From the freezing level" : null;
  const bottom = g.from_freezing_level ? "Freezing level" : g.altitude_low_ft != null ? altFt(g.altitude_low_ft) : "Surface";
  return `${bottom} to ${top}`;
}

/** What a PIREP reports of the turbulence and icing, in words:
 *  "Turbulence moderate · No icing". */
export function pirepConditions(p: Pirep): string | null {
  return callEngine("pirep_conditions", { turbulence: p.turbulence ?? null, icing: p.icing ?? null });
}

/** How high a TFR reaches: "Surface to 10,000 ft MSL", "Surface to
 *  400 ft AGL". */
export function tfrAltitudes(t: Pick<RouteTfr, "floor_ft" | "floor_ref" | "ceiling_ft" | "ceiling_ref">): string | null {
  if (t.ceiling_ft == null) return null;
  const floor = !t.floor_ft ? "Surface" : `${altFt(t.floor_ft)} ft${t.floor_ref && t.floor_ref !== t.ceiling_ref ? ` ${t.floor_ref}` : ""}`;
  return `${floor} to ${altFt(t.ceiling_ft)} ft ${t.ceiling_ref ?? ""}`.trim();
}

/** When a TFR is in force, in local time: "Tue 6 Oct 18:00 – 20:00",
 *  "from Thu 1 Oct 11:00 until further notice". */
export function tfrTimes(t: Pick<RouteTfr, "effective" | "expires">): string | null {
  const from = t.effective ? new Date(t.effective) : null;
  const to = t.expires ? new Date(t.expires) : null;
  if (from && to) return `${dayTime(from)} – ${from.toDateString() === to.toDateString() ? clock(to) : dayTime(to)}`;
  if (from) return `From ${dayTime(from)} until further notice`;
  if (to) return `Until ${dayTime(to)}`;
  return null;
}

// "Tue 6 Oct 18:00" by the browser's own Intl, not date-fns, which this
// one use kept on the first load (19.5 KB, the 20 Oct audit).
const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });
const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clock = (d: Date) => CLOCK.format(d);
function dayTime(d: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => DAY.formatToParts(d).find(p => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${clock(d)}`;
}

/** A special-use area's floor and ceiling as the chart's tables write
 *  them: "Surface to 18,000 ft", "8,000 ft to FL180", "500 ft AGL to
 *  FL180" -- the one way the app says them; a ceiling the FAA's data
 *  gives as STD is a flight level, a 29.92 pressure level (14 CFR 1.1).
 *  In a sentence's middle (`midSentence`) the surface is "the surface". */
export function suaAltitudes(
  a: { floor_ft?: number | null; floor_ref?: string | null; ceiling_ft?: number | null; ceiling_ref?: string | null },
  { midSentence = false }: { midSentence?: boolean } = {},
): string {
  return callEngine("sua_altitudes", {
    floor_ft: a.floor_ft ?? null, floor_ref: a.floor_ref ?? null, ceiling_ft: a.ceiling_ft ?? null, ceiling_ref: a.ceiling_ref ?? null,
    mid_sentence: midSentence,
  });
}

/** A TFR's own page on tfr.faa.gov, its NOTAM number's slash an
 *  underscore ("4/1234" is detail_4_1234). */
export const tfrPage = (notamId: string) => `https://tfr.faa.gov/tfr3/?page=detail_${notamId.replace("/", "_")}`;
