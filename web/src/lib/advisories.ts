import type { Briefing } from "./api/types";
import { altFt } from "./units";

type GAirmet = Briefing["gairmets"][number];
type Pirep = Briefing["pireps"][number];
type RouteTfr = Briefing["tfrs"][number];

/** The intensities PIREPs and G-AIRMETs report, in words. */
const INTENSITY: Record<string, string> = {
  NEG: "none", NEGCLR: "none", SMTH: "smooth", TRC: "trace", LGT: "light", "LGT-MOD": "light to moderate",
  MOD: "moderate", "MOD-SEV": "moderate to severe", SEV: "severe", EXTRM: "extreme",
};
const intensity = (code: string) => INTENSITY[code.toUpperCase()] ?? code.toLowerCase();

/** What the FAA's own capitalised text keeps in capitals once it is set
 *  in sentence case: the codes a pilot reads as written -- the services
 *  and the airspace, the references, and the weather contractions of a
 *  G-AIRMET's or SIGMET's "due to" (CIG BLW 010 VIS BLW 3SM BR FG). */
const CODES = new Set([
  "NOTAM", "TFR", "MOA", "ATC", "ATCAA", "ARTCC", "FAA", "FSS", "DOD", "US", "USA",
  "VFR", "IFR", "MVFR", "LIFR", "AGL", "MSL", "SFC", "UTC", "FL", "NM", "SM",
  "AIRMET", "SIGMET", "PIREP", "METAR", "TAF", "LLWS", "ICG", "TURB",
  "CIG", "BLW", "VIS", "BR", "FG", "HZ", "FU", "DU", "SA", "RA", "SN", "DZ", "TS", "PCPN", "MTN", "MTNS", "OBSC", "OBSCN",
  "CLDS", "BKN", "OVC", "SCT", "FEW", "N", "S", "E", "W", "NE", "NW", "SE", "SW",
  // A field's radio, as its frequencies are listed (lib/frequencies).
  "APP", "DEP", "TWR", "GND", "CTAF", "UNICOM", "ATIS", "AWOS", "ASOS", "CLNC", "DEL", "RDO", "ANG",
]);
const DAYS: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

/** A name the FAA writes in capitals, written as a name is: "CHICAGO
 *  CLASS B" as "Chicago Class B", "ROCKFORD" as "Rockford" -- a place's, a
 *  facility's, an airspace's -- where its prose is set in sentence case
 *  (faaWords). Three places had a copy of it. */
export function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * The FAA's capitalised text -- a special-use area's times of use, a
 * G-AIRMET's cause, a TFR's purpose -- in sentence case, its codes kept:
 * "INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE" reads "Intermittent by
 * NOTAM 4 hours in advance". A word with a figure in it (20KTS, FL180,
 * 0700) is a code too, its letters before a hyphen and all (R-4401A),
 * and an airspace's class is written as the AIM writes it, "Class B"
 * (AIM 3-2-1). Text with any lower case is someone's own writing and is
 * left as it is, and so are raw reports, which pilots read as sent.
 */
export function faaWords(text: string | null | undefined): string {
  if (!text) return "";
  if (/[a-z]/.test(text)) return text;
  const words = text.replace(/\bCLASS ([A-G])\b|[A-Z]+-\d[A-Z0-9]*|[A-Z0-9]+/g, (word, letter?: string) => {
    if (letter) return `Class ${letter}`;
    if (/\d/.test(word) || CODES.has(word)) return word;
    if (word === "NOTAMS") return "NOTAMs";
    return DAYS[word] ?? word.toLowerCase();
  });
  // A sentence's first letter, and after a full stop.
  return words.replace(/(^|[.!?]\s+)([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** A place's name as it is written, each word capitalised: the FAA's and
 *  the airport file's capitals ("EAU CLAIRE", "LA CROSSE", "STERLING/
 *  ROCKFALLS") as a town is spelt -- "Eau Claire", "La Crosse",
 *  "Sterling/Rockfalls" -- where faaWords' sentence case read "La crosse"
 *  (the owner's screenshot, 2026-10-26). A name already in mixed case is
 *  kept as it is. */
export function placeWords(text: string | null | undefined): string {
  if (!text) return "";
  if (/[a-z]/.test(text)) return text;
  return text.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
    // "Mc" names as they are written: McCook, McAlester.
    .replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`);
}

/** A SIGMET's hazard in words: "Convective", "Mountain obscuration". */
const SIGMET_HAZARDS: Record<string, string> = {
  CONVECTIVE: "Convective", TURB: "Turbulence", ICE: "Icing", IFR: "IFR", "MTN OBSCN": "Mountain obscuration",
  ASH: "Volcanic ash", TS: "Thunderstorms", DS: "Dust storm", SS: "Sandstorm",
};
export const sigmetHazard = (hazard: string | null | undefined, kind?: string | null) =>
  (hazard && (SIGMET_HAZARDS[hazard.toUpperCase()] ?? faaWords(hazard))) || kind || "Hazard";

/** A G-AIRMET's hazard and how bad: "Icing, moderate". */
export function gairmetTitle(g: GAirmet): string {
  return g.severity ? `${g.hazard}, ${intensity(g.severity)}` : g.hazard;
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
 *  "Turbulence moderate · no icing". */
export function pirepConditions(p: Pirep): string | null {
  const parts = [
    p.turbulence && `Turbulence ${intensity(p.turbulence)}`,
    p.icing && (["NEG", "NEGCLR"].includes(p.icing.toUpperCase()) ? "No icing" : `Icing ${intensity(p.icing)}`),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
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
 *  FL180" -- the one way the app says them, where the airspace card wrote
 *  "8,000 MSL to 18,000 STD" and the altitude reasoning "8,000 ft to
 *  18,000 ft" for the same area: a ceiling the FAA's data gives as STD
 *  is a flight level, a 29.92 pressure level (14 CFR 1.1). In a
 *  sentence's middle (`midSentence`) the surface is "the surface". */
export function suaAltitudes(
  a: { floor_ft?: number | null; floor_ref?: string | null; ceiling_ft?: number | null; ceiling_ref?: string | null },
  { midSentence = false }: { midSentence?: boolean } = {},
): string {
  const height = (ft: number | null | undefined, ref: string | null | undefined, bottom: boolean) => {
    if (ref === "SFC" || (bottom && ft === 0)) return midSentence ? "the surface" : "Surface";
    if (ft == null) return "unstated";
    if (ref === "STD") return `FL${Math.round(ft / 100)}`;
    return `${altFt(ft)} ft${ref === "AGL" ? " AGL" : ""}`;
  };
  return `${height(a.floor_ft, a.floor_ref, true)} to ${height(a.ceiling_ft, a.ceiling_ref, false)}`;
}
