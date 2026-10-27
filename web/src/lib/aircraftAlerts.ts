import { create } from "zustand";
import type { FlightStatus } from "./api/types";
import { clockTime } from "./clock";
import { compassPoint, saidPoint } from "./compass";
import { bearingDeg, distanceNm } from "./geo";
import { altFt } from "./units";

/**
 * What a pilot can ask to be told of an airplane, from its card's Alert,
 * at the owner's pick of the redesign ("Tell me when N654FL…"): that it
 * takes off, that it lands, that it comes near own ship or near an
 * airport. Watched while the app is open (AircraftAlerts, every
 * FlightStatus a few seconds old), each said once on the map and aloud
 * as it happens, then let go, as FlightAware's alert for a flight is.
 */
export type AircraftAlertKind = "takeoff" | "land" | "near-me" | "near-airport";

export interface AircraftAlert {
  hex: string;
  /** Its name as its card shows it, for the banner and the voice. */
  name: string;
  kind: AircraftAlertKind;
  /** Near me: how near, nm (NEAR_ME_NM). */
  nm?: number;
  /** Near an airport: which. */
  airport?: { ident: string; name: string | null; lat: number; lon: number };
}

/** How near own ship an airplane is to come before it is said: the
 *  menu's choices, 10 nm first offered, as the mockup had it. */
export const NEAR_ME_NM = [5, 10, 20] as const;
export const NEAR_ME_DEFAULT_NM = 10;
/** How near an airport it is to come: ten miles, about five minutes out
 *  for a light airplane, time to be at the field to meet it. */
export const NEAR_AIRPORT_NM = 10;

/** An alert's own key, one of each kind an airplane. */
export const alertKey = (a: Pick<AircraftAlert, "hex" | "kind">) => `${a.hex}:${a.kind}`;

/** What the watcher keeps of an airplane between its answers: whether
 *  it was in the air -- null where that was not known -- and, for each
 *  alert near something, whether it was already that near. */
export interface Watched {
  airborne: boolean | null;
  inside: Record<string, boolean>;
}

/** An alert as it went off: the banner's words and the voice's. */
export interface FiredAlert {
  id: string;
  hex: string;
  name: string;
  title: string;
  detail: string | null;
  spoken: string;
  /** When, this device's clock (ms). */
  at: number;
}

/** Unheard this long, s, and not known to have landed, an airplane not
 *  heard taking off is taken to be on the ground: parked out of the
 *  receivers' hearing, not flying out of it. */
const PARKED_UNHEARD_S = 30 * 60;

/**
 * Whether the airplane is in the air, from its state and what was known
 * before: in the air where it is heard there; on the ground where it has
 * landed somewhere, or where nothing was known and it has not been heard
 * for a long while or ever; else what was known, as an airplane gone
 * quiet in the pattern has not landed until it is known to have.
 */
export function airborneNow(before: boolean | null, now: FlightStatus): boolean | null {
  if (now.airborne) return true;
  if (now.arrived) return false;
  if (before === null) return now.heard_s == null || now.heard_s >= PARKED_UNHEARD_S ? false : null;
  return before;
}

/** "N654FL took off from 10C", "N654FL landed at KDAW", "N654FL is 8 nm
 *  from you": the banner's and the voice's words for one alert, or null
 *  where it has not gone off. `me` is own ship's fix, where it has one. */
export function fired(
  alert: AircraftAlert, before: Watched, airborne: boolean | null, now: FlightStatus,
  me: { lat: number; lon: number } | null, at: number,
): { alert: FiredAlert | null; inside?: boolean } {
  const id = `${alertKey(alert)}:${at}`;
  const base = { id, hex: alert.hex, name: alert.name, at };
  const when = clockTime(new Date(at));
  if (alert.kind === "takeoff") {
    if (before.airborne !== false || airborne !== true) return { alert: null };
    const from = now.departed;
    return {
      alert: {
        ...base,
        title: from ? `${alert.name} took off from ${from.ident}` : `${alert.name} took off`,
        detail: [from?.city ?? from?.name, when].filter(Boolean).join(" · "),
        spoken: from ? `${alert.name} took off from ${from.name ?? from.ident}.` : `${alert.name} took off.`,
      },
    };
  }
  if (alert.kind === "land") {
    if (before.airborne !== true || airborne !== false || !now.arrived) return { alert: null };
    const field = now.arrived;
    return {
      alert: {
        ...base,
        title: `${alert.name} landed at ${field.ident}`,
        detail: [field.city ?? field.name, clockTime(new Date(field.at * 1000))].filter(Boolean).join(" · "),
        spoken: `${alert.name} landed at ${field.name ?? field.ident}.`,
      },
    };
  }
  // Near something: where it is now, against own ship or the airport.
  const plane = now.aircraft;
  const to = alert.kind === "near-me" ? me : alert.airport ?? null;
  if (!plane || !to) return { alert: null };
  const nm = distanceNm(to, plane);
  const limit = alert.kind === "near-me" ? alert.nm ?? NEAR_ME_DEFAULT_NM : NEAR_AIRPORT_NM;
  const inside = nm <= limit;
  if (!inside || before.inside[alertKey(alert)]) return { alert: null, inside };
  const miles = Math.max(1, Math.round(nm));
  const way = compassPoint(bearingDeg(to, plane));
  const height = plane.altitude_ft == null ? null : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`;
  const where = alert.kind === "near-me" ? "you" : alert.airport!.ident;
  return {
    inside,
    alert: {
      ...base,
      title: `${alert.name} is ${miles} nm from ${where}`,
      detail: [`${way} of ${alert.kind === "near-me" ? "you" : alert.airport!.ident}`, height, when].filter(Boolean).join(" · "),
      spoken: alert.kind === "near-me"
        ? `${alert.name}, ${miles} miles ${saidPoint(way)}${height ? `, ${height.replace(" ft", " feet")}` : ""}.`
        : `${alert.name} is ${miles} miles from ${alert.airport!.name ?? alert.airport!.ident}.`,
    },
  };
}

/** The alerts gone off and not yet put away, newest last (AircraftAlerts). */
export const useFiredAlerts = create<{ fired: FiredAlert[] }>(() => ({ fired: [] }));

export const dismissFired = (id: string) => useFiredAlerts.setState(s => ({ fired: s.fired.filter(f => f.id !== id) }));

/** "When it lands", "When it takes off or comes within 10 nm of you": the
 *  line under the card's name while alerts wait, as the mockup set one. */
export function alertsLine(alerts: AircraftAlert[]): string | null {
  const words = alerts.map(a => (a.kind === "takeoff" ? "takes off"
    : a.kind === "land" ? "lands"
      : a.kind === "near-me" ? `comes within ${a.nm ?? NEAR_ME_DEFAULT_NM} nm of you`
        : `comes within ${NEAR_AIRPORT_NM} nm of ${a.airport?.ident ?? "an airport"}`));
  if (!words.length) return null;
  const listed = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
  return `When it ${listed}`;
}
