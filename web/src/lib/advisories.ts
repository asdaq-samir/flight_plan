import { format } from "date-fns";
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
]);
const DAYS: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

/**
 * The FAA's capitalised text -- a special-use area's times of use, a
 * G-AIRMET's cause, a TFR's purpose -- in sentence case, its codes kept:
 * "INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE" reads "Intermittent by
 * NOTAM 4 hours in advance". A word with a figure in it (20KTS, FL180,
 * 0700) is a code too. Text with any lower case is someone's own writing
 * and is left as it is, and so are raw reports, which pilots read as
 * sent.
 */
export function faaWords(text: string | null | undefined): string {
  if (!text) return "";
  if (/[a-z]/.test(text)) return text;
  const words = text.replace(/[A-Z0-9]+/g, word => {
    if (/\d/.test(word) || CODES.has(word)) return word;
    if (word === "NOTAMS") return "NOTAMs";
    return DAYS[word] ?? word.toLowerCase();
  });
  // A sentence's first letter, and after a full stop.
  return words.replace(/(^|[.!?]\s+)([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
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
  const day = "EEE d MMM HH:mm";
  if (from && to) return `${format(from, day)} – ${format(to, from.toDateString() === to.toDateString() ? "HH:mm" : day)}`;
  if (from) return `From ${format(from, day)} until further notice`;
  if (to) return `Until ${format(to, day)}`;
  return null;
}

/** A special-use area's floor and ceiling as the chart's tables write
 *  them: "Surface to 18,000 ft", "8,000 ft to FL180", "500 ft AGL to
 *  FL180". */
export function suaAltitudes(a: { floor_ft?: number | null; floor_ref?: string | null; ceiling_ft?: number | null; ceiling_ref?: string | null }): string {
  const height = (ft: number | null | undefined, ref: string | null | undefined, bottom: boolean) => {
    if (ref === "SFC" || (bottom && ft === 0)) return "Surface";
    if (ft == null) return "unstated";
    if (ref === "STD") return `FL${Math.round(ft / 100)}`;
    return `${altFt(ft)} ft${ref === "AGL" ? " AGL" : ""}`;
  };
  return `${height(a.floor_ft, a.floor_ref, true)} to ${height(a.ceiling_ft, a.ceiling_ref, false)}`;
}
