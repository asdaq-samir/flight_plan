import type { Where } from "./verdict";
import { clockTime, zuluTime } from "./clock";

/**
 * The passengers' briefing on the Brief, ticked off before engine start:
 * what 14 CFR 91.107 asks of the pilot in command before every takeoff --
 * each person shown how to fasten and unfasten their belt and harness
 * ((a)(1)), and told to have them fastened to taxi, take off and land
 * ((a)(2), (3)) -- and what is good practice besides, said as such.
 */
export interface PassengerItem extends Partial<Where> {
  key: string;
  title: string;
  /** The rule that asks for it, or "Good practice". */
  rule: string;
}

export const PASSENGER_ITEMS: PassengerItem[] = [
  { key: "pax-belts", title: "How to fasten and unfasten their belts and harnesses", rule: "14 CFR 91.107(a)(1)" },
  { key: "pax-fastened", title: "Belts fastened to taxi, take off and land", rule: "14 CFR 91.107(a)(2), (3)" },
  { key: "pax-doors", title: "The doors, and how to get out", rule: "Good practice" },
  { key: "pax-emergency", title: "The fire extinguisher, and what to do in an emergency", rule: "Good practice" },
  { key: "pax-quiet", title: "Quiet during radio calls, and to point out traffic", rule: "Good practice" },
];

/** The flight in a few lines for the passengers, to send them: where to,
 *  when it leaves and lands (this device's clock, and UTC), and the
 *  destination's weather now, where it reports. */
export function passengerMessage(f: {
  dep: string;
  dest: string;
  destName: string | null;
  depart: Date | null;
  eteMin: number | null;
  /** The destination's report now, in words ("VFR, 10 sm"). */
  weather: string | null;
}): string {
  const minutes = f.eteMin == null ? null : Math.round(f.eteMin);
  const flying = minutes == null ? null : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  const lands = f.depart && minutes != null ? new Date(f.depart.getTime() + minutes * 60_000) : null;
  return [
    `${f.dep} to ${f.destName ? `${f.destName} (${f.dest})` : f.dest}`,
    f.depart
      ? `Leaving ${clockTime(f.depart)} (${zuluTime(f.depart)})${flying ? `, about ${flying} in the air` : ""}${lands ? `, landing about ${clockTime(lands)}` : ""}.`
      : flying ? `About ${flying} in the air.` : null,
    f.weather ? `Weather at ${f.dest} now: ${f.weather}.` : null,
  ].filter(Boolean).join("\n");
}
