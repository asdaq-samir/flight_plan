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
